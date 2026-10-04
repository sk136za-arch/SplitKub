begin;
select plan(14);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000501'),
  ('00000000-0000-4000-8000-000000000502');
insert into private.shared_bills
  (id, public_id, owner_user_id, title, currency, owner_token_hash, friend_token_hash, expires_at)
values ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000504',
  '00000000-0000-4000-8000-000000000501', 'Bill', 'THB', '\x01', '\x02', now() + interval '1 day');
insert into private.shared_participants (bill_id, id, name, position) values
  ('00000000-0000-4000-8000-000000000503', 'a', 'A', 0),
  ('00000000-0000-4000-8000-000000000503', 'b', 'B', 1);
insert into private.shared_receipts (bill_id, id, title, paid_by_participant_id, position)
  values ('00000000-0000-4000-8000-000000000503', 'r', 'Receipt', 'a', 0);
insert into private.shared_items (bill_id, receipt_id, id, name, price_minor, position)
  values ('00000000-0000-4000-8000-000000000503', 'r', 'i', 'Item', 100, 0);
insert into private.shared_item_participants (bill_id, receipt_id, item_id, participant_id) values
  ('00000000-0000-4000-8000-000000000503', 'r', 'i', 'a'),
  ('00000000-0000-4000-8000-000000000503', 'r', 'i', 'b');
insert into private.shared_bill_members (bill_id, user_id, role) values
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000501', 'owner'),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000502', 'friend');

select ok(to_regprocedure('api.set_shared_participation_for_participant(uuid,text,text,text,boolean,bigint)') is not null,
  'selection-bound participation RPC is installed');
select ok((select p.prosecdef from pg_catalog.pg_proc p
    where p.oid = 'api.set_shared_participation_for_participant(uuid,text,text,text,boolean,bigint)'::regprocedure),
  'selection-bound RPC is SECURITY DEFINER');
select ok((select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p
    where p.oid = 'api.set_shared_participation_for_participant(uuid,text,text,text,boolean,bigint)'::regprocedure),
  'selection-bound RPC has an empty fixed search_path');
select ok(has_function_privilege('authenticated', 'api.set_shared_participation_for_participant(uuid,text,text,text,boolean,bigint)', 'execute')
  and not has_function_privilege('anon', 'api.set_shared_participation_for_participant(uuid,text,text,text,boolean,bigint)', 'execute'),
  'selection-bound RPC is authenticated-only');
select ok(to_regprocedure('api.set_shared_participation(uuid,text,text,boolean,bigint)') is not null
  and has_function_privilege('authenticated', 'api.set_shared_participation(uuid,text,text,boolean,bigint)', 'execute'),
  'legacy participation signature remains available for compatibility');

-- Simulate two tabs for one anonymous auth user: A selects A, then B selects B.
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000502', true);
select is(api.claim_participant('00000000-0000-4000-8000-000000000503', 'a') ->> 'participantId',
  'a', 'tab A selects participant A');
select is(api.claim_participant('00000000-0000-4000-8000-000000000503', 'b') ->> 'participantId',
  'b', 'tab B selects participant B for the same auth user');
select is((select participant_id from private.shared_bill_members
  where bill_id = '00000000-0000-4000-8000-000000000503' and user_id = '00000000-0000-4000-8000-000000000502'),
  'b', 'shared member selection now reflects tab B');

select is((api.set_shared_participation_for_participant(
  '00000000-0000-4000-8000-000000000503', 'r', 'i', 'a', false, 1) ->> 'revision')::bigint,
  2::bigint, 'tab A toggle applies to its explicit participant A');
select ok(not exists (select 1 from private.shared_item_participants
  where bill_id = '00000000-0000-4000-8000-000000000503' and receipt_id = 'r' and item_id = 'i' and participant_id = 'a'),
  'A assignment changed');
select ok(exists (select 1 from private.shared_item_participants
  where bill_id = '00000000-0000-4000-8000-000000000503' and receipt_id = 'r' and item_id = 'i' and participant_id = 'b'),
  'B assignment was not changed by tab A');
select is((select participant_id from private.shared_bill_members
  where bill_id = '00000000-0000-4000-8000-000000000503' and user_id = '00000000-0000-4000-8000-000000000502'),
  'a', 'atomic toggle records the explicit participant choice');
select throws_ok($$select api.set_shared_participation_for_participant(
  '00000000-0000-4000-8000-000000000503', 'r', 'i', 'other', true, 2)$$,
  'P0002', 'PARTICIPANT_NOT_FOUND', 'participant from another or missing bill is rejected');

select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000501', true);
select throws_ok($$select api.set_shared_participation_for_participant(
  '00000000-0000-4000-8000-000000000503', 'r', 'i', 'a', true, 2)$$,
  '42501', 'PARTICIPANT_NOT_CLAIMED', 'owner cannot use friend participation RPC');

select * from finish();
rollback;
