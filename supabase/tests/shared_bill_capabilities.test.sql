begin;
select plan(4);

select ok(to_regprocedure('api.shared_bill_capabilities()') is not null,
  'settlement routing capability RPC is installed');
select ok(not has_function_privilege('anon', 'api.shared_bill_capabilities()', 'execute'),
  'unauthenticated callers cannot negotiate shared-bill capabilities');
select ok(has_function_privilege('authenticated', 'api.shared_bill_capabilities()', 'execute'),
  'authenticated anonymous sessions can negotiate capabilities');
select is((api.shared_bill_capabilities() ->> 'settlementRoutingVersion')::integer, 1,
  'capability RPC advertises collector routing version 1');

select * from finish();
rollback;
