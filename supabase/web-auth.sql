-- Additive hosted authentication; no owner, password, market or sessions seeded.
CREATE TABLE zhirox_web_private.deployment(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 market_id uuid NOT NULL UNIQUE REFERENCES zhirox_web_private.markets);
CREATE TABLE zhirox_web_private.login_attempts(
 username text PRIMARY KEY,failures integer NOT NULL DEFAULT 0,blocked_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX web_one_owner_per_market ON zhirox_web_private.users(market_id) WHERE role='owner';
ALTER TABLE zhirox_web_private.deployment ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhirox_web_private.login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON zhirox_web_private.deployment,zhirox_web_private.login_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON zhirox_web_private.deployment TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON zhirox_web_private.login_attempts TO service_role;
CREATE FUNCTION zhirox_web_private.user_view(u zhirox_web_private.users) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',u.id,'name',u.name,'username',u.username,'role',u.role,'active',u.active);
$$;
CREATE FUNCTION public.zhirox_web_auth_rpc(p_action text,p_session_hash text DEFAULT NULL,p_csrf text DEFAULT NULL,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE u zhirox_web_private.users; target zhirox_web_private.users; s zhirox_web_private.sessions;
 a zhirox_web_private.login_attempts; m uuid; uname text; raw_user jsonb; failure_count integer; new_session zhirox_web_private.sessions;
 result jsonb; rows_value jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN('state','setup','lookup','login.complete','logout','password.lookup','password.complete','users.list','users.create','users.update','audit.list') OR
    p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR octet_length(p_payload::text)>32768 THEN
  RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400'; END IF;
 SELECT market_id INTO m FROM zhirox_web_private.deployment WHERE singleton;
 IF p_action='setup' THEN
  -- Only the trusted server may authorize setup after checking its activation token.
  PERFORM pg_advisory_xact_lock(hashtextextended('zhirox_web_owner_setup',0));
  IF EXISTS(SELECT 1 FROM zhirox_web_private.deployment) OR EXISTS(SELECT 1 FROM zhirox_web_private.users WHERE role='owner') THEN
   RAISE EXCEPTION 'هەژماری خاوەن پێشتر دروست کراوە' USING ERRCODE='PT409'; END IF;
  IF coalesce(p_payload->>'username','') !~ '^[a-z0-9._-]{3,40}$' OR length(btrim(coalesce(p_payload->>'name',''))) NOT BETWEEN 1 AND 100 OR
     coalesce(p_payload->>'password_hash','') !~ '^[a-f0-9]{128}$' OR coalesce(p_payload->>'salt','') !~ '^[a-f0-9]{32}$' OR
     coalesce(p_payload->>'token_hash','') !~ '^[a-f0-9]{64}$' OR coalesce(p_payload->>'csrf','') !~ '^[A-Za-z0-9_-]{32}$' THEN
   RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400'; END IF;
  INSERT INTO zhirox_web_private.markets(name) VALUES('ZHIROX HyperMarket') RETURNING id INTO m;
  INSERT INTO zhirox_web_private.deployment VALUES(true,m);
  INSERT INTO zhirox_web_private.users(market_id,username,name,password_hash,salt,role)
   VALUES(m,p_payload->>'username',btrim(p_payload->>'name'),p_payload->>'password_hash',p_payload->>'salt','owner') RETURNING * INTO u;
  INSERT INTO zhirox_web_private.sessions VALUES(p_payload->>'token_hash',m,u.id,p_payload->>'csrf',now()+interval '12 hours') RETURNING * INTO new_session;
  INSERT INTO zhirox_web_private.audit(market_id,actor_id,action,target_id,details) VALUES(m,u.id,'owner.setup',u.id,'{}');
  RETURN jsonb_build_object('user',zhirox_web_private.user_view(u),'csrf',new_session.csrf,'expires_at',floor(extract(epoch FROM new_session.expires_at)*1000));
 END IF;
 IF p_action IN('lookup','login.complete') THEN
  uname=p_payload->>'username';
  IF coalesce(uname,'') !~ '^[a-z0-9._-]{3,40}$' THEN RAISE EXCEPTION 'زانیاریی چوونەژوورەوە نادروستە' USING ERRCODE='PT401'; END IF;
  INSERT INTO zhirox_web_private.login_attempts(username) VALUES(uname) ON CONFLICT DO NOTHING;
  SELECT * INTO a FROM zhirox_web_private.login_attempts WHERE username=uname FOR UPDATE;
  IF a.blocked_until>now() THEN RETURN jsonb_build_object('error_status',429); END IF;
  SELECT * INTO u FROM zhirox_web_private.users WHERE market_id=m AND username=uname FOR UPDATE;
  IF p_action='lookup' THEN
   RETURN jsonb_build_object('credentials',CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('password_hash',u.password_hash,'salt',u.salt) END);
  END IF;
  -- Compare against CURRENT credentials under the account lock, not an earlier lookup.
  IF u.id IS NULL OR NOT u.active OR u.password_hash IS DISTINCT FROM p_payload->>'password_hash' OR u.salt IS DISTINCT FROM p_payload->>'salt' THEN
   failure_count=CASE WHEN a.updated_at>now()-interval '60 seconds' THEN a.failures ELSE 0 END+1;
   UPDATE zhirox_web_private.login_attempts SET failures=failure_count,blocked_until=CASE WHEN failure_count>=5 THEN now()+interval '60 seconds' ELSE NULL END,updated_at=now() WHERE username=uname;
   RETURN jsonb_build_object('error_status',401);
  END IF;
  IF coalesce(p_payload->>'token_hash','') !~ '^[a-f0-9]{64}$' OR coalesce(p_payload->>'csrf','') !~ '^[A-Za-z0-9_-]{32}$' THEN RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400'; END IF;
  DELETE FROM zhirox_web_private.login_attempts WHERE username=uname;
  DELETE FROM zhirox_web_private.sessions WHERE expires_at<=now();
  INSERT INTO zhirox_web_private.sessions VALUES(p_payload->>'token_hash',m,u.id,p_payload->>'csrf',now()+interval '12 hours') RETURNING * INTO new_session;
  RETURN jsonb_build_object('user',zhirox_web_private.user_view(u),'csrf',new_session.csrf,'expires_at',floor(extract(epoch FROM new_session.expires_at)*1000));
 END IF;
 SELECT * INTO s FROM zhirox_web_private.sessions WHERE token_hash=p_session_hash AND expires_at>now();
 IF s.user_id IS NOT NULL AND p_action IN('password.lookup','password.complete') THEN
  SELECT username INTO uname FROM zhirox_web_private.users WHERE market_id=s.market_id AND id=s.user_id;
  IF uname IS NOT NULL THEN
   INSERT INTO zhirox_web_private.login_attempts(username) VALUES(uname) ON CONFLICT DO NOTHING;
   SELECT * INTO a FROM zhirox_web_private.login_attempts WHERE username=uname FOR UPDATE;
   IF a.blocked_until>now() THEN RETURN jsonb_build_object('error_status',429); END IF;
  END IF;
 END IF;
 IF s.user_id IS NOT NULL THEN
  SELECT * INTO u FROM zhirox_web_private.users WHERE market_id=s.market_id AND id=s.user_id FOR UPDATE;
  SELECT * INTO s FROM zhirox_web_private.sessions WHERE token_hash=p_session_hash AND user_id=u.id AND expires_at>now() FOR UPDATE;
 END IF;
 IF p_action='state' THEN
  IF s.user_id IS NULL OR NOT coalesce(u.active,false) THEN RETURN jsonb_build_object('setup_required',m IS NULL,'user',NULL,'csrf',NULL,'expires_at',NULL); END IF;
  RETURN jsonb_build_object('setup_required',false,'user',zhirox_web_private.user_view(u),'csrf',s.csrf,'expires_at',floor(extract(epoch FROM s.expires_at)*1000));
 END IF;
 IF s.user_id IS NULL OR NOT coalesce(u.active,false) THEN RAISE EXCEPTION 'تکایە بچۆ ژوورەوە' USING ERRCODE='PT401'; END IF;
 IF p_action IN('logout','password.lookup','password.complete','users.create','users.update') AND (p_csrf IS NULL OR p_csrf<>s.csrf) THEN RAISE EXCEPTION 'داواکاری پشتڕاست نەکراوەتەوە' USING ERRCODE='PT403'; END IF;
 IF p_action='logout' THEN
  DELETE FROM zhirox_web_private.sessions WHERE token_hash=p_session_hash;
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF p_action IN('password.lookup','password.complete') THEN
  IF p_action='password.lookup' THEN RETURN jsonb_build_object('credentials',jsonb_build_object('password_hash',u.password_hash,'salt',u.salt)); END IF;
  IF u.password_hash IS DISTINCT FROM p_payload->>'current_hash' OR u.salt IS DISTINCT FROM p_payload->>'old_salt' THEN
   failure_count=CASE WHEN a.updated_at>now()-interval '60 seconds' THEN a.failures ELSE 0 END+1;
   UPDATE zhirox_web_private.login_attempts SET failures=failure_count,blocked_until=CASE WHEN failure_count>=5 THEN now()+interval '60 seconds' ELSE NULL END,updated_at=now() WHERE username=u.username;
   RETURN jsonb_build_object('error_status',400);
  END IF;
  IF coalesce(p_payload->>'password_hash','') !~ '^[a-f0-9]{128}$' OR coalesce(p_payload->>'salt','') !~ '^[a-f0-9]{32}$' THEN RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400'; END IF;
  DELETE FROM zhirox_web_private.login_attempts WHERE username=u.username;
  UPDATE zhirox_web_private.users SET password_hash=p_payload->>'password_hash',salt=p_payload->>'salt' WHERE id=u.id;
  DELETE FROM zhirox_web_private.sessions WHERE market_id=u.market_id AND user_id=u.id;
  INSERT INTO zhirox_web_private.audit(market_id,actor_id,action,target_id,details) VALUES(u.market_id,u.id,'user.password_changed',u.id,'{}');
  RETURN jsonb_build_object('ok',true,'reauthentication_required',true);
 END IF;
 IF (p_action LIKE 'users.%' AND u.role<>'owner') OR (p_action='audit.list' AND u.role NOT IN('owner','manager')) THEN RAISE EXCEPTION 'دەسەڵاتت نییە' USING ERRCODE='PT403'; END IF;
 IF p_action='users.list' THEN
  SELECT coalesce(jsonb_agg(zhirox_web_private.user_view(x) ORDER BY x.username),'[]') INTO rows_value FROM zhirox_web_private.users x WHERE market_id=u.market_id;
  RETURN jsonb_build_object('users',rows_value);
 END IF;
 IF p_action='users.create' THEN
  IF coalesce(p_payload->>'username','') !~ '^[a-z0-9._-]{3,40}$' OR length(btrim(coalesce(p_payload->>'name',''))) NOT BETWEEN 1 AND 100 OR
     coalesce(p_payload->>'password_hash','') !~ '^[a-f0-9]{128}$' OR coalesce(p_payload->>'salt','') !~ '^[a-f0-9]{32}$' OR
     coalesce(p_payload->>'role','') NOT IN('manager','cashier','warehouse') THEN RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400'; END IF;
  INSERT INTO zhirox_web_private.users(market_id,username,name,password_hash,salt,role)
   VALUES(u.market_id,p_payload->>'username',btrim(p_payload->>'name'),p_payload->>'password_hash',p_payload->>'salt',p_payload->>'role') RETURNING * INTO target;
  INSERT INTO zhirox_web_private.audit(market_id,actor_id,action,target_id,details) VALUES(u.market_id,u.id,'user.created',target.id,jsonb_build_object('role',target.role));
  RETURN jsonb_build_object('user',zhirox_web_private.user_view(target));
 END IF;
 IF p_action='users.update' THEN
  SELECT * INTO target FROM zhirox_web_private.users WHERE market_id=u.market_id AND id=(p_payload->>'id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'کارمەند نەدۆزرایەوە' USING ERRCODE='PT404'; END IF;
  IF target.role='owner' THEN RAISE EXCEPTION 'ڕۆڵ و چالاکیی خاوەن ناگۆڕدرێت' USING ERRCODE='PT403'; END IF;
  IF (p_payload ? 'role' AND coalesce(p_payload->>'role','') NOT IN('manager','cashier','warehouse')) OR
     (p_payload ? 'active' AND jsonb_typeof(p_payload->'active')<>'boolean') OR NOT (p_payload ? 'role' OR p_payload ? 'active') THEN RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400'; END IF;
  UPDATE zhirox_web_private.users SET role=coalesce(p_payload->>'role',role),active=coalesce((p_payload->>'active')::boolean,active) WHERE id=target.id RETURNING * INTO target;
  DELETE FROM zhirox_web_private.sessions WHERE market_id=target.market_id AND user_id=target.id;
  INSERT INTO zhirox_web_private.audit(market_id,actor_id,action,target_id,details) VALUES(u.market_id,u.id,'user.access_changed',target.id,jsonb_build_object('to_role',target.role,'active',target.active));
  RETURN jsonb_build_object('user',zhirox_web_private.user_view(target));
 END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY created_at DESC,id DESC),'[]') INTO rows_value FROM (
  SELECT id,created_at,jsonb_build_object('id',id,'actor_id',actor_id,'action',action,'target_id',target_id,'details',details,'created_at',created_at) AS value
   FROM zhirox_web_private.audit WHERE market_id=u.market_id ORDER BY created_at DESC,id DESC LIMIT 200) x;
 RETURN jsonb_build_object('entries',rows_value);
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'هەژمار یان دانیشتن پێشتر هەیە' USING ERRCODE='PT409';
 WHEN invalid_text_representation OR not_null_violation OR check_violation THEN RAISE EXCEPTION 'داواکاری نادروستە' USING ERRCODE='PT400';
END;
$$;
REVOKE ALL ON FUNCTION zhirox_web_private.user_view(zhirox_web_private.users) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION zhirox_web_private.user_view(zhirox_web_private.users) TO service_role;
REVOKE ALL ON FUNCTION public.zhirox_web_auth_rpc(text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zhirox_web_auth_rpc(text,text,text,jsonb) TO service_role;
