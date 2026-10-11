-- Additive receipt adjustments. Older receipts remain unadjusted; older clients
-- omitting the field preserve an existing receipt's adjustment configuration.
create function private.default_receipt_adjustments()
returns jsonb language sql immutable set search_path = ''
as $function$
  select '{"vatEnabled":false,"vatRateBps":700,"serviceChargeEnabled":false,"serviceChargeRateBps":1000,"preDiscountEnabled":false,"preDiscount":0,"postDiscountEnabled":false,"postDiscount":0}'::jsonb;
$function$;

create function private.valid_receipt_adjustments(p_value jsonb)
returns boolean language plpgsql immutable set search_path = ''
as $function$
declare v_vat numeric; v_service numeric; v_pre numeric; v_post numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'object'
    or pg_catalog.jsonb_typeof(p_value -> 'vatEnabled') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_value -> 'serviceChargeEnabled') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_value -> 'preDiscountEnabled') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_value -> 'postDiscountEnabled') is distinct from 'boolean'
    or pg_catalog.jsonb_typeof(p_value -> 'vatRateBps') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_value -> 'serviceChargeRateBps') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_value -> 'preDiscount') is distinct from 'number'
    or pg_catalog.jsonb_typeof(p_value -> 'postDiscount') is distinct from 'number'
    or (p_value ->> 'vatRateBps') !~ '^[0-9]+$'
    or (p_value ->> 'serviceChargeRateBps') !~ '^[0-9]+$'
    or (p_value ->> 'preDiscount') !~ '^[0-9]+$'
    or (p_value ->> 'postDiscount') !~ '^[0-9]+$' then return false;
  end if;
  v_vat := (p_value ->> 'vatRateBps')::numeric;
  v_service := (p_value ->> 'serviceChargeRateBps')::numeric;
  v_pre := (p_value ->> 'preDiscount')::numeric;
  v_post := (p_value ->> 'postDiscount')::numeric;
  return v_vat between 1 and 10000 and v_service between 1 and 10000
    and v_pre between 0 and 9007199254740991 and v_post between 0 and 9007199254740991
    and ((p_value ->> 'preDiscountEnabled')::boolean = false or v_pre > 0)
    and ((p_value ->> 'postDiscountEnabled')::boolean = false or v_post > 0);
exception when others then return false;
end;
$function$;

alter table private.shared_receipts
  add column adjustments jsonb not null default private.default_receipt_adjustments(),
  add constraint shared_receipt_adjustments_valid check (private.valid_receipt_adjustments(adjustments));

create or replace function private.write_session_contents(p_bill_id uuid, p_session jsonb)
returns void language plpgsql security definer set search_path = ''
as $function$
declare v_total_items integer; v_session jsonb;
begin
  if pg_catalog.jsonb_typeof(p_session -> 'receipts') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  select pg_catalog.jsonb_set(p_session, '{receipts}', coalesce(pg_catalog.jsonb_agg(
    case when r.value ? 'adjustments' then r.value
      else pg_catalog.jsonb_set(r.value, '{adjustments}', coalesce(
        (select old.adjustments from private.shared_receipts old
          where old.bill_id = p_bill_id and old.id = r.value ->> 'id'),
        private.default_receipt_adjustments())) end order by r.ordinality), '[]'::jsonb))
  into v_session
  from pg_catalog.jsonb_array_elements(p_session -> 'receipts') with ordinality as r(value, ordinality);
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_session -> 'receipts') as r(value)
    where not private.valid_receipt_adjustments(r.value -> 'adjustments')) then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if v_session is null or pg_catalog.jsonb_typeof(v_session) is distinct from 'object'
     or v_session ->> 'currency' not in ('THB', 'USD')
     or pg_catalog.length(pg_catalog.btrim(v_session ->> 'title')) not between 1 and 120
     or pg_catalog.jsonb_typeof(v_session -> 'participants') is distinct from 'array'
     or pg_catalog.jsonb_typeof(v_session -> 'receipts') is distinct from 'array'
     or pg_catalog.jsonb_array_length(v_session -> 'participants') > 100
     or pg_catalog.jsonb_array_length(v_session -> 'receipts') > 50 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select coalesce(sum(pg_catalog.jsonb_array_length(r.value -> 'items')), 0)::integer into v_total_items
  from pg_catalog.jsonb_array_elements(v_session -> 'receipts') as r(value);
  if v_total_items > 500 then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_session -> 'participants') as p(value)
    where pg_catalog.jsonb_typeof(p.value -> 'id') is distinct from 'string'
       or pg_catalog.length(pg_catalog.btrim(p.value ->> 'id')) not between 1 and 128
       or pg_catalog.jsonb_typeof(p.value -> 'name') is distinct from 'string'
       or pg_catalog.length(pg_catalog.btrim(p.value ->> 'name')) not between 1 and 120
       or pg_catalog.jsonb_typeof(coalesce(p.value -> 'promptPay', '""'::jsonb)) is distinct from 'string'
       or pg_catalog.length(coalesce(p.value ->> 'promptPay', '')) > 64
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(v_session -> 'receipts') as r(value)
    where pg_catalog.jsonb_typeof(r.value -> 'id') is distinct from 'string'
       or pg_catalog.length(pg_catalog.btrim(r.value ->> 'id')) not between 1 and 128
       or pg_catalog.jsonb_typeof(r.value -> 'title') is distinct from 'string'
       or pg_catalog.length(pg_catalog.btrim(r.value ->> 'title')) not between 1 and 120
       or pg_catalog.jsonb_typeof(coalesce(r.value -> 'paidByParticipantId', '""'::jsonb)) is distinct from 'string'
       or pg_catalog.jsonb_typeof(r.value -> 'items') is distinct from 'array'
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(v_session -> 'receipts') as r(value)
    cross join lateral pg_catalog.jsonb_array_elements(r.value -> 'items') as i(value)
    where pg_catalog.jsonb_typeof(i.value -> 'id') is distinct from 'string'
       or pg_catalog.length(pg_catalog.btrim(i.value ->> 'id')) not between 1 and 128
       or pg_catalog.jsonb_typeof(i.value -> 'name') is distinct from 'string'
       or pg_catalog.length(pg_catalog.btrim(i.value ->> 'name')) not between 1 and 120
       or pg_catalog.jsonb_typeof(i.value -> 'price') is distinct from 'number'
       or (i.value ->> 'price') !~ '^[0-9]+$'
       or (i.value ->> 'price')::numeric not between 1 and 9007199254740991
       or pg_catalog.jsonb_typeof(i.value -> 'participantIds') is distinct from 'array'
  ) then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  delete from private.shared_receipts where bill_id = p_bill_id;
  update private.shared_participants set position = position + 1000000 where bill_id = p_bill_id;
  insert into private.shared_participants (bill_id, id, name, prompt_pay, position)
  select p_bill_id, p.value ->> 'id', pg_catalog.btrim(p.value ->> 'name'),
    coalesce(p.value ->> 'promptPay', ''), (p.ordinality - 1)::integer
  from pg_catalog.jsonb_array_elements(v_session -> 'participants') with ordinality as p(value, ordinality)
  on conflict (bill_id, id) do update set name = excluded.name,
    prompt_pay = excluded.prompt_pay, position = excluded.position;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_session -> 'receipts') as r(value)
    where coalesce(r.value ->> 'paidByParticipantId', '') <> '' and not exists (
      select 1 from private.shared_participants p
      where p.bill_id = p_bill_id and p.id = r.value ->> 'paidByParticipantId'
    )
  ) then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;

  delete from private.shared_participants p where p.bill_id = p_bill_id and not exists (
    select 1 from pg_catalog.jsonb_array_elements(v_session -> 'participants') as incoming(value)
    where incoming.value ->> 'id' = p.id
  );

  insert into private.shared_receipts (bill_id, id, title, paid_by_participant_id, position)
  select p_bill_id, r.value ->> 'id', pg_catalog.btrim(r.value ->> 'title'),
    coalesce(r.value ->> 'paidByParticipantId', ''), (r.ordinality - 1)::integer
  from pg_catalog.jsonb_array_elements(v_session -> 'receipts') with ordinality as r(value, ordinality);

  insert into private.shared_items (bill_id, receipt_id, id, name, price_minor, position)
  select p_bill_id, r.value ->> 'id', i.value ->> 'id', pg_catalog.btrim(i.value ->> 'name'),
    (i.value ->> 'price')::bigint, (i.ordinality - 1)::integer
  from pg_catalog.jsonb_array_elements(v_session -> 'receipts') as r(value)
  cross join lateral pg_catalog.jsonb_array_elements(r.value -> 'items') with ordinality as i(value, ordinality);

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(v_session -> 'receipts') as r(value)
    cross join lateral pg_catalog.jsonb_array_elements(r.value -> 'items') as i(value)
    cross join lateral pg_catalog.jsonb_array_elements_text(i.value -> 'participantIds') as selected(participant_id)
    where not exists (select 1 from private.shared_participants p where p.bill_id = p_bill_id and p.id = selected.participant_id)
  ) then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;

  insert into private.shared_item_participants (bill_id, receipt_id, item_id, participant_id)
  select p_bill_id, r.value ->> 'id', i.value ->> 'id', selected.participant_id
  from pg_catalog.jsonb_array_elements(v_session -> 'receipts') as r(value)
  cross join lateral pg_catalog.jsonb_array_elements(r.value -> 'items') as i(value)
  cross join lateral pg_catalog.jsonb_array_elements_text(i.value -> 'participantIds') as selected(participant_id);
  update private.shared_receipts target set adjustments = source.value -> 'adjustments'
  from pg_catalog.jsonb_array_elements(v_session -> 'receipts') as source(value)
  where target.bill_id = p_bill_id and target.id = source.value ->> 'id';
end;
$function$;

create or replace function private.shared_session_snapshot(p_public_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_bill private.shared_bills%rowtype; v_snapshot jsonb;
begin
  select b.* into v_bill from private.shared_bills b
  where b.public_id = p_public_id and b.expires_at > pg_catalog.now();
  if not found then return null; end if;
  select pg_catalog.jsonb_build_object(
    'id', v_bill.id, 'title', v_bill.title, 'currency', v_bill.currency,
    'revision', v_bill.revision, 'expiresAt', v_bill.expires_at,
    'settlementMode', v_bill.settlement_mode,
    'collectorParticipantId', coalesce(v_bill.collector_participant_id, ''),
    'participants', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', p.id, 'name', p.name, 'promptPay', p.prompt_pay) order by p.position)
      from private.shared_participants p where p.bill_id = v_bill.id), '[]'::jsonb),
    'receipts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', r.id, 'title', r.title, 'paidByParticipantId', r.paid_by_participant_id,
      'adjustments', r.adjustments,
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', i.id, 'name', i.name, 'price', i.price_minor,
        'participantIds', coalesce((select pg_catalog.jsonb_agg(ip.participant_id order by p.position)
          from private.shared_item_participants ip join private.shared_participants p
            on p.bill_id = ip.bill_id and p.id = ip.participant_id
          where ip.bill_id = i.bill_id and ip.receipt_id = i.receipt_id and ip.item_id = i.id), '[]'::jsonb)
      ) order by i.position) from private.shared_items i where i.bill_id = r.bill_id and i.receipt_id = r.id), '[]'::jsonb)
    ) order by r.position) from private.shared_receipts r where r.bill_id = v_bill.id), '[]'::jsonb)
  ) into v_snapshot;
  return v_snapshot;
end;
$function$;

create or replace function api.shared_bill_capabilities()
returns jsonb language sql stable set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object('settlementRoutingVersion', 1, 'receiptAdjustmentsVersion', 1);
$function$;

revoke all on function private.default_receipt_adjustments() from public, anon, authenticated;
revoke all on function private.valid_receipt_adjustments(jsonb) from public, anon, authenticated;
revoke all on function private.write_session_contents(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.shared_session_snapshot(uuid) from public, anon, authenticated;
