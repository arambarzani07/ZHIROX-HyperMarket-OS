BEGIN;
SET LOCAL ROLE service_role;
DO $$
DECLARE v jsonb; u uuid; staff uuid; token_a text:=repeat('a',64);token_b text:=repeat('b',64);i integer;
BEGIN
 IF has_function_privilege('anon','public.zhirox_web_auth_rpc(text,text,text,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.zhirox_web_auth_rpc(text,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'QA public auth RPC'; END IF;
 v=public.zhirox_web_auth_rpc('state');
 IF v->>'setup_required'<>'true' THEN RAISE EXCEPTION 'QA target must be empty for rollback-only bootstrap test'; END IF;
 v=public.zhirox_web_auth_rpc('setup',NULL,NULL,jsonb_build_object('username','qaowner','name','QA owner','password_hash',repeat('1',128),'salt',repeat('2',32),'token_hash',token_a,'csrf',repeat('q',32)));
 u=(v->'user'->>'id')::uuid;
 IF u IS NULL OR v->'user' ? 'password_hash' OR v->'user' ? 'salt' THEN RAISE EXCEPTION 'QA setup/privacy'; END IF;
 BEGIN
  PERFORM public.zhirox_web_auth_rpc('setup',NULL,NULL,'{}');RAISE EXCEPTION 'QA duplicate owner';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 v=public.zhirox_web_auth_rpc('state',token_a);
 IF v->'user'->>'role'<>'owner' OR v->>'setup_required'<>'false' THEN RAISE EXCEPTION 'QA persistent session'; END IF;
 BEGIN
  PERFORM public.zhirox_web_auth_rpc('logout',token_a,'wrong');RAISE EXCEPTION 'QA csrf accepted';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
 FOR i IN 1..5 LOOP
  v=public.zhirox_web_auth_rpc('login.complete',NULL,NULL,jsonb_build_object('username','qaowner','password_hash',repeat('0',128),'salt',repeat('2',32)));
  IF v->>'error_status'<>'401' THEN RAISE EXCEPTION 'QA bad password';END IF;
 END LOOP;
 v=public.zhirox_web_auth_rpc('lookup',NULL,NULL,'{"username":"qaowner"}');
 IF v->>'error_status'<>'429' THEN RAISE EXCEPTION 'QA persistent throttle';END IF;
 DELETE FROM zhirox_web_private.login_attempts WHERE username='qaowner';
 v=public.zhirox_web_auth_rpc('lookup',NULL,NULL,'{"username":"qaowner"}');
 IF v->'credentials'->>'password_hash'<>repeat('1',128) THEN RAISE EXCEPTION 'QA server-only lookup';END IF;
 v=public.zhirox_web_auth_rpc('login.complete',NULL,NULL,jsonb_build_object('username','qaowner','password_hash',repeat('1',128),'salt',repeat('2',32),'token_hash',token_b,'csrf',repeat('r',32)));
 IF v->'user'->>'id'<>u::text THEN RAISE EXCEPTION 'QA login';END IF;
 v=public.zhirox_web_auth_rpc('users.create',token_a,repeat('q',32),jsonb_build_object('username','qastaff','name','QA staff','role','cashier','password_hash',repeat('3',128),'salt',repeat('4',32)));
 staff=(v->'user'->>'id')::uuid;
 IF staff IS NULL THEN RAISE EXCEPTION 'QA staff create';END IF;
 v=public.zhirox_web_auth_rpc('login.complete',NULL,NULL,jsonb_build_object('username','qastaff','password_hash',repeat('3',128),'salt',repeat('4',32),'token_hash',repeat('c',64),'csrf',repeat('s',32)));
 BEGIN
  PERFORM public.zhirox_web_auth_rpc('users.list',repeat('c',64));RAISE EXCEPTION 'QA cashier administers users';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
 PERFORM public.zhirox_web_auth_rpc('users.update',token_a,repeat('q',32),jsonb_build_object('id',staff,'active',false));
 v=public.zhirox_web_auth_rpc('state',repeat('c',64));
 IF v->'user'<>'null'::jsonb THEN RAISE EXCEPTION 'QA staff session not revoked';END IF;
 BEGIN
  PERFORM public.zhirox_web_auth_rpc('users.update',token_a,repeat('q',32),jsonb_build_object('id',u,'active',false));RAISE EXCEPTION 'QA owner disabled';
 EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL;END;
 -- A revoked/stale login hash must not issue a session after password rotation.
 PERFORM public.zhirox_web_auth_rpc('password.lookup',token_a,repeat('q',32));
 v=public.zhirox_web_auth_rpc('password.complete',token_a,repeat('q',32),jsonb_build_object('current_hash',repeat('1',128),'old_salt',repeat('2',32),'password_hash',repeat('5',128),'salt',repeat('6',32)));
 IF v->>'reauthentication_required'<>'true' THEN RAISE EXCEPTION 'QA rotation';END IF;
 IF EXISTS(SELECT 1 FROM zhirox_web_private.sessions WHERE user_id=u) THEN RAISE EXCEPTION 'QA old sessions remain';END IF;
 v=public.zhirox_web_auth_rpc('login.complete',NULL,NULL,jsonb_build_object('username','qaowner','password_hash',repeat('1',128),'salt',repeat('2',32),'token_hash',repeat('d',64),'csrf',repeat('t',32)));
 IF v->>'error_status'<>'401' THEN RAISE EXCEPTION 'QA stale password accepted';END IF;
 v=public.zhirox_web_auth_rpc('login.complete',NULL,NULL,jsonb_build_object('username','qaowner','password_hash',repeat('5',128),'salt',repeat('6',32),'token_hash',repeat('e',64),'csrf',repeat('v',32)));
 IF v->'user'->>'id'<>u::text THEN RAISE EXCEPTION 'QA new login';END IF;
 PERFORM public.zhirox_web_auth_rpc('logout',repeat('e',64),repeat('v',32));
 v=public.zhirox_web_auth_rpc('state',repeat('e',64));
 IF v->'user'<>'null'::jsonb THEN RAISE EXCEPTION 'QA logout';END IF;
 IF EXISTS(SELECT 1 FROM zhirox_web_private.audit WHERE details ? 'password_hash' OR details ? 'salt' OR details ? 'csrf') THEN RAISE EXCEPTION 'QA audit secrets';END IF;
END;
$$;
ROLLBACK;
SELECT 'web_auth_qa_passed_and_rolled_back' AS result;
