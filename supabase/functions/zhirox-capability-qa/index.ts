// v0.34 STAGING-QA ONLY. Separate from the existing production zhirox-sync function.
// Do not deploy this to any live Supabase project. No database writes or mutations.
import { createCapabilityQAHandler } from './handler.mjs';
Deno.serve(createCapabilityQAHandler({
 env: (key) => Deno.env.get(key)
}));