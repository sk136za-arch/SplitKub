-- Settlement routing is a configuration, never a persisted transfer list.
-- Existing sessions remain direct; the original migration is intentionally untouched.
alter table private.shared_bills
  add column settlement_mode text not null default 'direct'
    check (settlement_mode in ('direct', 'collector')),
  add column collector_participant_id text,
  add constraint shared_bill_settlement_shape check (
    (settlement_mode = 'direct' and collector_participant_id is null)
    or (settlement_mode = 'collector' and collector_participant_id is not null)
  );

-- The deferred same-bill FK permits an owner snapshot to add a participant and
-- select them as collector in one revision-checked transaction.
alter table private.shared_bills
  add constraint shared_bill_collector_member_fk
  foreign key (id, collector_participant_id)
  references private.shared_participants (bill_id, id)
  deferrable initially deferred;

create function private.validate_settlement_config(p_session jsonb)
returns void language plpgsql security definer set search_path = ''
as $function$
declare v_mode text := coalesce(p_session ->> 'settlementMode', 'direct');
        v_collector text := coalesce(p_session ->> 'collectorParticipantId', '');
begin
  if v_mode not in ('direct', 'collector')
     or (v_mode = 'direct' and v_collector <> '')
     or (v_mode = 'collector' and v_collector = '')
     or pg_catalog.jsonb_typeof(p_session -> 'participants') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if v_mode = 'collector' and not exists (
    select 1 from pg_catalog.jsonb_array_elements(p_session -> 'participants') as p(value)
    where p.value ->> 'id' = v_collector
  ) then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
end;
$function$;
revoke all on function private.validate_settlement_config(jsonb) from public, anon, authenticated;

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

create or replace function api.create_shared_bill(p_session jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user_id uuid := private.require_authenticated_user(); v_bill_id uuid; v_public_id uuid;
  v_owner_token text; v_friend_token text; v_snapshot jsonb;
begin
  if p_session is null or p_session ->> 'currency' not in ('THB', 'USD') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  perform private.validate_settlement_config(p_session);
  v_owner_token := pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_friend_token := pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into private.shared_bills (owner_user_id, title, currency, owner_token_hash, friend_token_hash, expires_at, settlement_mode, collector_participant_id)
  values (v_user_id, p_session ->> 'title', p_session ->> 'currency',
    extensions.digest(pg_catalog.convert_to(v_owner_token, 'UTF8'), 'sha256'),
    extensions.digest(pg_catalog.convert_to(v_friend_token, 'UTF8'), 'sha256'),
    pg_catalog.now() + interval '90 days', coalesce(p_session ->> 'settlementMode', 'direct'),
    nullif(p_session ->> 'collectorParticipantId', '')) returning id, public_id into v_bill_id, v_public_id;
  insert into private.shared_bill_members (bill_id, user_id, role) values (v_bill_id, v_user_id, 'owner');
  perform private.write_session_contents(v_bill_id, p_session);
  v_snapshot := private.shared_session_snapshot(v_public_id);
  return pg_catalog.jsonb_build_object('publicId', v_public_id, 'billId', v_bill_id,
    'friendToken', v_friend_token, 'ownerToken', v_owner_token, 'snapshot', v_snapshot);
end;
$function$;

create or replace function api.apply_owner_action(p_bill_id uuid, p_expected_revision bigint, p_session jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype;
begin
  select b.* into v_bill from private.shared_bills b join private.shared_bill_members m on m.bill_id = b.id
  where b.id = p_bill_id and b.expires_at > pg_catalog.now() and m.user_id = v_user_id and m.role = 'owner' for update of b;
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  if v_bill.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'REVISION_CONFLICT'; end if;
  perform private.validate_settlement_config(p_session);
  if exists (select 1 from private.shared_bill_members m where m.bill_id = v_bill.id and m.participant_id is not null
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_session -> 'participants') as p(value) where p.value ->> 'id' = m.participant_id)) then
    raise exception using errcode = '23503', message = 'CLAIMED_PARTICIPANT_CANNOT_BE_REMOVED';
  end if;
  perform private.write_session_contents(v_bill.id, p_session);
  update private.shared_bills set title = p_session ->> 'title', currency = p_session ->> 'currency',
    settlement_mode = coalesce(p_session ->> 'settlementMode', 'direct'),
    collector_participant_id = nullif(p_session ->> 'collectorParticipantId', ''),
    revision = revision + 1 where id = v_bill.id;
  perform private.notify_shared_bill(v_bill.id);
  return private.shared_session_snapshot(v_bill.public_id);
end;
$function$;
