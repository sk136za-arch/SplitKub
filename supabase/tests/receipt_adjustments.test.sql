begin;
select plan(13);

select ok(exists (select 1 from pg_catalog.pg_attribute a
  where a.attrelid = 'private.shared_receipts'::regclass and a.attname = 'adjustments'
    and a.attnotnull and not a.attisdropped), 'receipt adjustments are required');
select ok(exists (select 1 from pg_catalog.pg_constraint c
  where c.conname = 'shared_receipt_adjustments_valid' and c.contype = 'c'),
  'stored adjustments have a database check');
select ok(private.valid_receipt_adjustments(private.default_receipt_adjustments()),
  'default configuration is valid');
select ok(not private.valid_receipt_adjustments('{"vatEnabled":true}'::jsonb),
  'partial adjustment object is rejected');
select ok(not private.valid_receipt_adjustments(private.default_receipt_adjustments() || '{"vatRateBps":0,"vatEnabled":true}'::jsonb),
  'enabled VAT rejects a zero rate');
select ok(not private.valid_receipt_adjustments(private.default_receipt_adjustments() || '{"preDiscountEnabled":true}'::jsonb),
  'enabled pre-discount rejects zero');
select is((api.shared_bill_capabilities() ->> 'receiptAdjustmentsVersion')::integer, 1,
  'capability advertises adjustment protocol version 1');
select ok(not has_table_privilege('authenticated', 'private.shared_receipts', 'update'),
  'friends cannot write receipt adjustments directly');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
  from pg_catalog.pg_proc p where p.oid = 'private.write_session_contents(uuid,jsonb)'::regprocedure),
  'receipt writer stays a fixed-search-path security definer');

insert into auth.users (id) values ('00000000-0000-4000-8000-000000000601');
insert into private.shared_bills (id, public_id, owner_user_id, title, currency, owner_token_hash, friend_token_hash, expires_at)
  values ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000603',
    '00000000-0000-4000-8000-000000000601', 'Bill', 'THB', '\x01', '\x02', now() + interval '1 day');
insert into private.shared_participants (bill_id, id, name, position)
  values ('00000000-0000-4000-8000-000000000602', 'a', 'A', 0);
insert into private.shared_receipts (bill_id, id, title, position)
  values ('00000000-0000-4000-8000-000000000602', 'r', 'Receipt', 0);
select is((select adjustments from private.shared_receipts where bill_id = '00000000-0000-4000-8000-000000000602' and id = 'r'),
  private.default_receipt_adjustments(), 'existing-style receipt gets disabled defaults');

select private.write_session_contents('00000000-0000-4000-8000-000000000602',
  '{"title":"Bill","currency":"THB","participants":[{"id":"a","name":"A","promptPay":""}],"receipts":[{"id":"r","title":"Receipt","paidByParticipantId":"a","adjustments":{"vatEnabled":true,"vatRateBps":700,"serviceChargeEnabled":false,"serviceChargeRateBps":1000,"preDiscountEnabled":false,"preDiscount":0,"postDiscountEnabled":false,"postDiscount":0},"items":[{"id":"i","name":"Item","price":100,"participantIds":["a"]}]}]}'::jsonb);
select is((select adjustments ->> 'vatEnabled' from private.shared_receipts where bill_id = '00000000-0000-4000-8000-000000000602' and id = 'r'),
  'true', 'writer stores enabled adjustment');
select is((private.shared_session_snapshot('00000000-0000-4000-8000-000000000603') -> 'receipts' -> 0 -> 'adjustments' ->> 'vatEnabled'),
  'true', 'canonical snapshot returns adjustment');

-- An older owner client omits adjustments; the writer preserves stored values.
select private.write_session_contents('00000000-0000-4000-8000-000000000602',
  '{"title":"Bill","currency":"THB","participants":[{"id":"a","name":"A","promptPay":""}],"receipts":[{"id":"r","title":"Receipt","paidByParticipantId":"a","items":[{"id":"i","name":"Item","price":100,"participantIds":["a"]}]}]}'::jsonb);
select is((select adjustments ->> 'vatEnabled' from private.shared_receipts where bill_id = '00000000-0000-4000-8000-000000000602' and id = 'r'),
  'true', 'old payload cannot silently erase existing adjustment');

select * from finish();
rollback;
