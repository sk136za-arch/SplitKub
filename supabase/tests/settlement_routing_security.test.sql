begin;
select plan(12);

select ok(
  exists (select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname = 'shared_bills' and a.attname = 'settlement_mode'
      and not a.attisdropped and a.attnotnull),
  'settlement mode is a required private bill column'
);
select ok(
  exists (select 1 from pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    join pg_catalog.pg_class c on c.oid = d.adrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname = 'shared_bills' and a.attname = 'settlement_mode'
      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) like '%direct%'),
  'existing bills default to direct mode'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint c
    where c.conname = 'shared_bill_settlement_shape' and c.contype = 'c'),
  'mode and collector shape is constrained'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint c
    where c.conname = 'shared_bill_collector_member_fk' and c.contype = 'f' and c.condeferrable
      and c.confrelid = 'private.shared_participants'::regclass),
  'collector has a deferred same-bill participant foreign key'
);
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
   from pg_catalog.pg_proc p where p.oid = 'api.apply_owner_action(uuid,bigint,jsonb)'::regprocedure),
  'revision checked owner RPC retains SECURITY DEFINER and fixed search path'
);
select ok(
  not has_function_privilege('anon', 'private.validate_settlement_config(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.validate_settlement_config(jsonb)', 'execute'),
  'untrusted callers cannot invoke private settlement validation directly'
);
select ok(
  not has_table_privilege('anon', 'private.shared_bills', 'update')
  and not has_table_privilege('authenticated', 'private.shared_bills', 'update'),
  'clients cannot modify routing columns through a direct table write'
);
select ok(
  to_regprocedure('api.set_shared_participation(uuid,text,text,boolean,bigint)') is not null,
  'friend participation RPC signature remains unchanged'
);

select throws_ok(
  $$select private.validate_settlement_config('{"settlementMode":"collector","collectorParticipantId":"","participants":[]}'::jsonb)$$,
  '22023', 'VALIDATION_ERROR', 'collector mode requires a selected participant'
);
select throws_ok(
  $$select private.validate_settlement_config('{"settlementMode":"collector","collectorParticipantId":"other-bill","participants":[{"id":"p"}]}'::jsonb)$$,
  '22023', 'VALIDATION_ERROR', 'collector must be in this session snapshot'
);
select throws_ok(
  $$select private.validate_settlement_config('{"settlementMode":"direct","collectorParticipantId":"p","participants":[{"id":"p"}]}'::jsonb)$$,
  '22023', 'VALIDATION_ERROR', 'direct mode rejects a stale collector'
);
select lives_ok(
  $$select private.validate_settlement_config('{"settlementMode":"collector","collectorParticipantId":"p","participants":[{"id":"p"}]}'::jsonb)$$,
  'valid same-session collector is accepted'
);

select * from finish();
rollback;
