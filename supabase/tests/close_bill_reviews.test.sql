begin;
select plan(24);

insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000701'),
  ('00000000-0000-4000-8000-000000000702');
insert into private.shared_bills
  (id, public_id, owner_user_id, title, currency, owner_token_hash, friend_token_hash, expires_at)
values ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000704',
  '00000000-0000-4000-8000-000000000701', 'Bill', 'THB', '\x01', '\x02', now() + interval '1 day');
insert into private.shared_participants (bill_id, id, name, position) values
  ('00000000-0000-4000-8000-000000000703', 'a', 'A', 0),
  ('00000000-0000-4000-8000-000000000703', 'b', 'B', 1);
insert into private.shared_bill_members (bill_id, user_id, role) values
  ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000701', 'owner'),
  ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000702', 'friend');

select is((api.shared_bill_capabilities() ->> 'closeBillVersion')::integer, 1,
  'close/review capability advertised');
select ok(not has_table_privilege('authenticated', 'private.participant_review_status', 'select')
  and not has_table_privilege('authenticated', 'private.participant_review_status', 'update'),
  'review table remains private');
select ok(has_function_privilege('authenticated', 'api.set_participant_confirmation(uuid,text,boolean,bigint)', 'execute')
  and not has_function_privilege('anon', 'api.set_participant_confirmation(uuid,text,boolean,bigint)', 'execute'),
  'confirmation RPC is authenticated-only');
select ok(has_function_privilege('authenticated', 'api.close_shared_bill(uuid,bigint,boolean)', 'execute')
  and not has_function_privilege('anon', 'api.close_shared_bill(uuid,bigint,boolean)', 'execute'),
  'close RPC is authenticated-only');
select ok(not has_function_privilege('authenticated', 'api.claim_participant_before_close(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'api.apply_owner_action_before_close(uuid,bigint,jsonb)', 'execute'),
  'renamed inner RPCs cannot bypass closed guards');

select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);
select is((api.set_participant_confirmation('00000000-0000-4000-8000-000000000703', 'a', true, 1) -> 'confirmations' -> 0 ->> 'participantId'),
  'a', 'friend membership can confirm its explicit selected identity');
select is((api.claim_participant('00000000-0000-4000-8000-000000000703', 'a') -> 'snapshot' ->> 'confirmationRevision')::bigint,
  1::bigint, 'viewing does not change confirmation revision');
select ok((select viewed_at is not null from private.participant_review_status
  where bill_id = '00000000-0000-4000-8000-000000000703' and participant_id = 'a'),
  'selection records viewed timestamp');
select is(pg_catalog.jsonb_array_length(private.shared_session_snapshot('00000000-0000-4000-8000-000000000704') -> 'confirmations'),
  0, 'unscoped friend snapshot reveals no review status');
select is((api.fetch_shared_bill_for_participant('00000000-0000-4000-8000-000000000703', 'a') -> 'snapshot' -> 'confirmations' -> 0 ->> 'participantId'),
  'a', 'friend fetch returns only tab A explicit status');
select is((api.claim_participant('00000000-0000-4000-8000-000000000703', 'b') ->> 'participantId'),
  'b', 'tab B selects B for the same friend membership');
select is((api.set_participant_confirmation('00000000-0000-4000-8000-000000000703', 'a', true, 1) -> 'confirmations' -> 0 ->> 'participantId'),
  'a', 'tab A confirms A after tab B changed shared member selection');
select is((api.fetch_shared_bill_for_participant('00000000-0000-4000-8000-000000000703', 'a') -> 'snapshot' -> 'confirmations' -> 0 ->> 'confirmedContentRevision')::bigint,
  1::bigint, 'tab A sees its own confirmation');
select is((api.fetch_shared_bill_for_participant('00000000-0000-4000-8000-000000000703', 'b') -> 'snapshot' -> 'confirmations' -> 0 ->> 'confirmedContentRevision'),
  null, 'tab B cannot see tab A review status');
select is((api.set_participant_confirmation('00000000-0000-4000-8000-000000000703', 'a', true, 1) ->> 'confirmationRevision')::bigint,
  1::bigint, 'same-state retry is idempotent');
select is((select revision from private.shared_bills where id = '00000000-0000-4000-8000-000000000703'),
  1::bigint, 'content revision unaffected by review');
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);
select throws_ok($$select api.close_shared_bill('00000000-0000-4000-8000-000000000703', 1, false)$$,
  '55000', 'CONFIRMATIONS_INCOMPLETE', 'unconfirmed participant blocks unacknowledged close');
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);
select is((api.set_participant_confirmation('00000000-0000-4000-8000-000000000703', 'b', true, 1) -> 'confirmations' -> 0 ->> 'participantId'),
  'b', 'tab B confirms B after tab A changed shared member selection');

select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000701', true);
select is(pg_catalog.jsonb_array_length(private.shared_session_snapshot('00000000-0000-4000-8000-000000000704') -> 'confirmations'),
  2, 'owner sees every participant status');
select ok((api.close_shared_bill('00000000-0000-4000-8000-000000000703', 1, true) ->> 'closedAt') <> '',
  'owner may explicitly acknowledge and close');
select throws_ok($$select api.apply_owner_action('00000000-0000-4000-8000-000000000703', 1, '{}'::jsonb)$$,
  '55000', 'BILL_CLOSED', 'closed bill rejects owner edit');
select throws_ok($$select api.close_shared_bill('00000000-0000-4000-8000-000000000703', 1, true)$$,
  '55000', 'BILL_CLOSED', 'closed bill cannot reopen or close twice');
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000702', true);
select throws_ok($$select api.claim_participant('00000000-0000-4000-8000-000000000703', 'a')$$,
  '55000', 'BILL_CLOSED', 'closed bill blocks identity changes');
select throws_ok($$select api.set_shared_participation_for_participant(
  '00000000-0000-4000-8000-000000000703', 'r', 'i', 'a', true, 1)$$,
  '55000', 'BILL_CLOSED', 'closed bill blocks participation updates');

select * from finish();
rollback;
