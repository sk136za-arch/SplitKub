begin;
select plan(28);

-- Fixed identities exist only inside this rolled-back test transaction.
insert into auth.users (id) values
  ('00000000-0000-4000-8000-000000000401'),
  ('00000000-0000-4000-8000-000000000402'),
  ('00000000-0000-4000-8000-000000000403');
insert into private.shared_bills
  (id, public_id, owner_user_id, title, currency, owner_token_hash, friend_token_hash, expires_at)
values ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000405',
  '00000000-0000-4000-8000-000000000401', 'Bill', 'THB', '\x01', '\x02', now() + interval '1 day');
insert into private.shared_participants (bill_id, id, name, position) values
  ('00000000-0000-4000-8000-000000000404', 'a', 'A', 0),
  ('00000000-0000-4000-8000-000000000404', 'b', 'B', 1);
insert into private.shared_receipts (bill_id, id, title, paid_by_participant_id, position)
  values ('00000000-0000-4000-8000-000000000404', 'r', 'Receipt', 'a', 0);
insert into private.shared_items (bill_id, receipt_id, id, name, price_minor, position)
  values ('00000000-0000-4000-8000-000000000404', 'r', 'i', 'Item', 100, 0);
insert into private.shared_item_participants (bill_id, receipt_id, item_id, participant_id) values
  ('00000000-0000-4000-8000-000000000404', 'r', 'i', 'a'),
  ('00000000-0000-4000-8000-000000000404', 'r', 'i', 'b');
insert into private.shared_bill_members (bill_id, user_id, role) values
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000401', 'owner'),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000402', 'friend'),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000403', 'friend');

select ok(to_regclass('private.shared_bill_member_participant_idx') is null,
  'exclusive participant index was dropped');
select ok(exists (select 1 from pg_catalog.pg_constraint c
    where c.conname = 'shared_bill_members_bill_id_participant_id_fkey'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%ON DELETE SET NULL (participant_id)%'),
  'participant deletion clears only member.participant_id');
select ok(has_function_privilege('authenticated', 'api.claim_participant(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'api.claim_participant(uuid,text)', 'execute'),
  'choice RPC remains authenticated-only');
select ok(not has_table_privilege('authenticated', 'private.shared_bill_members', 'update')
  and not has_table_privilege('authenticated', 'private.shared_item_participants', 'insert'),
  'clients still cannot directly mutate private rows');

select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000401', true);
select throws_ok($$select api.claim_participant('00000000-0000-4000-8000-000000000404', 'a')$$,
  '42501', 'OWNER_CANNOT_CLAIM_PARTICIPANT', 'owner cannot select a friend identity');
select is((select participant_id from private.shared_bill_members where user_id = '00000000-0000-4000-8000-000000000401'),
  null::text, 'owner member identity stays null');

select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000402', true);
select throws_ok($$select api.claim_participant('00000000-0000-4000-8000-000000000404', '')$$,
  '22023', 'VALIDATION_ERROR', 'empty participant ID rejected');
select throws_ok($$select api.claim_participant('00000000-0000-4000-8000-000000000404', repeat('x', 129))$$,
  '22023', 'VALIDATION_ERROR', 'overlong participant ID rejected');
select throws_ok($$select api.claim_participant('00000000-0000-4000-8000-000000000404', 'missing')$$,
  'P0002', 'PARTICIPANT_NOT_FOUND', 'unknown participant rejected');
select is((api.claim_participant('00000000-0000-4000-8000-000000000404', 'a') ->> 'participantId'),
  'a', 'first friend selects A');
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000403', true);
select is((api.claim_participant('00000000-0000-4000-8000-000000000404', 'a') ->> 'participantId'),
  'a', 'second friend can select the same A');
select is((select count(*)::integer from private.shared_bill_members where bill_id = '00000000-0000-4000-8000-000000000404' and participant_id = 'a'),
  2, 'two distinct member rows select A');
select is((api.claim_participant('00000000-0000-4000-8000-000000000404', 'b') ->> 'participantId'),
  'b', 'second friend can switch to B');
select is((api.claim_participant('00000000-0000-4000-8000-000000000404', 'a') ->> 'participantId'),
  'a', 'second friend can switch back to A');
select is((select count(*)::integer from private.shared_bill_members where bill_id = '00000000-0000-4000-8000-000000000404' and participant_id = 'a'),
  2, 'switching never creates a duplicate member row');
select is((select revision from private.shared_bills where id = '00000000-0000-4000-8000-000000000404'),
  1::bigint, 'name selection alone does not bump content revision');

select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000402', true);
select is((api.set_shared_participation('00000000-0000-4000-8000-000000000404', 'r', 'i', false, 1) ->> 'revision')::bigint,
  2::bigint, 'first friend removes A once');
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000403', true);
select is((api.set_shared_participation('00000000-0000-4000-8000-000000000404', 'r', 'i', true, 2) ->> 'revision')::bigint,
  3::bigint, 'second friend adds A once');
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000402', true);
select is((api.set_shared_participation('00000000-0000-4000-8000-000000000404', 'r', 'i', true, 2) ->> 'revision')::bigint,
  3::bigint, 'stale same-state retry succeeds without revision bump');
select throws_ok($$select api.set_shared_participation('00000000-0000-4000-8000-000000000404', 'r', 'i', false, 2)$$,
  '40001', 'REVISION_CONFLICT', 'stale opposite-state retry conflicts');
select throws_ok($$select api.set_shared_participation('00000000-0000-4000-8000-000000000404', 'r', 'i', true, null)$$,
  '22023', 'VALIDATION_ERROR', 'missing expected revision is not an idempotent retry');
select is((select count(*)::integer from private.shared_item_participants where bill_id = '00000000-0000-4000-8000-000000000404' and participant_id = 'a'),
  1, 'shared name produces only one assignment row');

select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000401', true);
select is((api.apply_owner_action('00000000-0000-4000-8000-000000000404', 3,
  '{"title":"Bill","currency":"THB","settlementMode":"direct","collectorParticipantId":"","participants":[{"id":"b","name":"B","promptPay":""}],"receipts":[{"id":"r","title":"Receipt","paidByParticipantId":"b","items":[{"id":"i","name":"Item","price":100,"participantIds":["b"]}]}]}'::jsonb) ->> 'revision')::bigint,
  4::bigint, 'owner can delete A and replace the snapshot atomically');
select is((select count(*)::integer from private.shared_bill_members where bill_id = '00000000-0000-4000-8000-000000000404' and role = 'friend' and participant_id is null),
  2, 'both friend memberships survive with cleared identity');
select ok(not exists (select 1 from private.shared_bill_members where bill_id = '00000000-0000-4000-8000-000000000404' and participant_id = 'a')
  and not exists (select 1 from private.shared_item_participants where bill_id = '00000000-0000-4000-8000-000000000404' and participant_id = 'a'),
  'deleted participant leaves no dangling membership or assignment');
select throws_ok($$select api.apply_owner_action('00000000-0000-4000-8000-000000000404', 3,
  '{"title":"Bill","currency":"THB","settlementMode":"direct","collectorParticipantId":"","participants":[{"id":"b","name":"B","promptPay":""}],"receipts":[]}'::jsonb)$$,
  '40001', 'REVISION_CONFLICT', 'stale owner replacement still conflicts');
select pg_catalog.set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000402', true);
select throws_ok($$select api.set_shared_participation('00000000-0000-4000-8000-000000000404', 'r', 'i', true, 4)$$,
  '42501', 'PARTICIPANT_NOT_CLAIMED', 'deleted selection cannot edit until a new name is selected');
select throws_ok($$select api.claim_participant('00000000-0000-4000-8000-000000000404', 'a')$$,
  'P0002', 'PARTICIPANT_NOT_FOUND', 'deleted name cannot be selected again');

select * from finish();
rollback;
