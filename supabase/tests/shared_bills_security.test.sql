begin;
select plan(12);

select ok(
  (select count(*) = 6 from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relkind = 'r' and c.relrowsecurity),
  'all six private shared-bill tables enforce RLS'
);

select ok(not has_table_privilege('anon', 'private.shared_bills', 'select'), 'anon cannot read shared bills directly');
select ok(not has_table_privilege('authenticated', 'private.shared_bills', 'select'), 'authenticated users cannot read shared bills directly');
select ok(not has_table_privilege('authenticated', 'private.shared_item_participants', 'insert'), 'authenticated users cannot edit assignments directly');

select ok(has_function_privilege('authenticated', 'api.create_shared_bill(jsonb)', 'execute'), 'authenticated can call create RPC');
select ok(not has_function_privilege('anon', 'api.create_shared_bill(jsonb)', 'execute'), 'anon role cannot call create RPC');
select ok(
  not exists (select 1 from pg_catalog.pg_proc p cross join lateral pg_catalog.aclexplode(
    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where p.oid = 'api.create_shared_bill(jsonb)'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'),
  'PUBLIC cannot call create RPC'
);

select ok(
  (select count(*) = 8 and bool_and(p.prosecdef) and bool_and(p.proconfig @> array['search_path=""'])
   from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'api'),
  'all eight exposed API functions are SECURITY DEFINER with an empty fixed search_path'
);

select ok(to_regprocedure('api.set_shared_participation(uuid,text,text,boolean,bigint)') is not null,
  'participation RPC takes receipt and item identifiers separately');
select ok(to_regprocedure('api.apply_owner_action(uuid,bigint,jsonb)') is not null,
  'owner action accepts a revision-checked complete session');

select ok(
  exists (select 1 from pg_catalog.pg_policies where schemaname = 'realtime' and tablename = 'messages'
    and policyname = 'SplitKub members receive private bill broadcasts' and cmd = 'SELECT'),
  'Realtime exposes only the member receive policy'
);

select ok(
  exists (select 1 from cron.job where jobname = 'splitkub-expired-shared-bills' and schedule = '17 3 * * *'),
  'daily expiry purge is scheduled'
);

select * from finish();
rollback;
