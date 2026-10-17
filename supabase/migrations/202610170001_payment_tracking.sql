-- Payment records are immutable route snapshots created only after a bill closes.
create table private.shared_payment_transfers (
  bill_id uuid not null references private.shared_bills(id) on delete cascade,
  transfer_key text not null check (pg_catalog.length(transfer_key) between 1 and 160),
  from_participant_id text not null,
  to_participant_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  status text not null default 'pending' check (status in ('pending', 'submitted', 'confirmed')),
  proof_kind text not null default '' check (proof_kind in ('', 'bank_transfer', 'cash')),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  primary key (bill_id, transfer_key),
  foreign key (bill_id, from_participant_id) references private.shared_participants(bill_id, id) on delete restrict,
  foreign key (bill_id, to_participant_id) references private.shared_participants(bill_id, id) on delete restrict,
  check (from_participant_id <> to_participant_id),
  check ((status = 'pending' and proof_kind = '' and submitted_at is null and confirmed_at is null)
    or (status = 'submitted' and proof_kind <> '' and submitted_at is not null and confirmed_at is null)
    or (status = 'confirmed' and proof_kind <> '' and submitted_at is not null and confirmed_at is not null))
);
create table private.shared_payment_actors (
  bill_id uuid not null references private.shared_bills(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_id text not null,
  primary key (bill_id, user_id),
  foreign key (bill_id, participant_id) references private.shared_participants(bill_id, id) on delete cascade
);
alter table private.shared_payment_transfers enable row level security;
alter table private.shared_payment_actors enable row level security;
revoke all on private.shared_payment_transfers, private.shared_payment_actors from public, anon, authenticated;

create or replace function private.shared_session_snapshot(p_public_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_bill private.shared_bills%rowtype; v_snapshot jsonb; v_role text;
begin
  select b.* into v_bill from private.shared_bills b where b.public_id = p_public_id and b.expires_at > pg_catalog.now();
  if not found then return null; end if;
  select m.role into v_role from private.shared_bill_members m where m.bill_id = v_bill.id and m.user_id = auth.uid();
  select pg_catalog.jsonb_build_object(
    'id', v_bill.id, 'title', v_bill.title, 'currency', v_bill.currency, 'revision', v_bill.revision, 'expiresAt', v_bill.expires_at,
    'closedAt', coalesce(v_bill.closed_at::text, ''), 'confirmationRevision', v_bill.confirmation_revision,
    'confirmations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('participantId', p.id, 'viewedAt', coalesce(s.viewed_at::text, ''), 'confirmedAt', coalesce(s.confirmed_at::text, ''), 'confirmedContentRevision', s.confirmed_content_revision) order by p.position) from private.shared_participants p left join private.participant_review_status s on s.bill_id = p.bill_id and s.participant_id = p.id where p.bill_id = v_bill.id and v_role = 'owner'), '[]'::jsonb),
    'payments', case when v_role = 'owner' then coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', t.transfer_key, 'fromParticipantId', t.from_participant_id, 'toParticipantId', t.to_participant_id, 'amount', t.amount_minor, 'status', t.status, 'proofKind', t.proof_kind, 'submittedAt', coalesce(t.submitted_at::text, ''), 'confirmedAt', coalesce(t.confirmed_at::text, '')) order by t.transfer_key) from private.shared_payment_transfers t where t.bill_id = v_bill.id), '[]'::jsonb) else '[]'::jsonb end,
    'settlementMode', v_bill.settlement_mode, 'collectorParticipantId', coalesce(v_bill.collector_participant_id, ''),
    'participants', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.id, 'name', p.name, 'promptPay', p.prompt_pay) order by p.position) from private.shared_participants p where p.bill_id = v_bill.id), '[]'::jsonb),
    'receipts', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', r.id, 'title', r.title, 'paidByParticipantId', r.paid_by_participant_id, 'adjustments', r.adjustments, 'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', i.id, 'name', i.name, 'price', i.price_minor, 'participantIds', coalesce((select pg_catalog.jsonb_agg(ip.participant_id order by p.position) from private.shared_item_participants ip join private.shared_participants p on p.bill_id = ip.bill_id and p.id = ip.participant_id where ip.bill_id = i.bill_id and ip.receipt_id = i.receipt_id and ip.item_id = i.id), '[]'::jsonb)) order by i.position) from private.shared_items i where i.bill_id = r.bill_id and i.receipt_id = r.id), '[]'::jsonb)) order by r.position) from private.shared_receipts r where r.bill_id = v_bill.id), '[]'::jsonb)
  ) into v_snapshot;
  return v_snapshot;
end;
$function$;

create or replace function private.friend_session_snapshot_for_participant(p_public_id uuid, p_participant_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_snapshot jsonb; v_bill_id uuid;
begin
  v_snapshot := private.shared_session_snapshot(p_public_id);
  if v_snapshot is null then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  v_bill_id := (v_snapshot ->> 'id')::uuid;
  return pg_catalog.jsonb_set(v_snapshot, '{payments}', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('key', t.transfer_key, 'fromParticipantId', t.from_participant_id, 'toParticipantId', t.to_participant_id, 'amount', t.amount_minor, 'status', t.status, 'proofKind', t.proof_kind, 'submittedAt', coalesce(t.submitted_at::text, ''), 'confirmedAt', coalesce(t.confirmed_at::text, '')) order by t.transfer_key) from private.shared_payment_transfers t where t.bill_id = v_bill_id and (t.from_participant_id = p_participant_id or t.to_participant_id = p_participant_id)), '[]'::jsonb), true);
end;
$function$;

create function api.initialize_payment_tracking(p_bill_id uuid, p_transfers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype;
begin
  if pg_catalog.jsonb_typeof(p_transfers) is distinct from 'array' or pg_catalog.jsonb_array_length(p_transfers) = 0 then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  select b.* into v_bill from private.shared_bills b join private.shared_bill_members m on m.bill_id = b.id where b.id = p_bill_id and b.expires_at > pg_catalog.now() and m.user_id = v_user_id and m.role = 'owner' for update of b;
  if not found then raise exception using errcode = '42501', message = 'OWNER_REQUIRED'; end if;
  if v_bill.closed_at is null then raise exception using errcode = '55000', message = 'BILL_NOT_CLOSED'; end if;
  if exists(select 1 from private.shared_payment_transfers where bill_id = p_bill_id) then return private.shared_session_snapshot(v_bill.public_id); end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(p_transfers) x where pg_catalog.jsonb_typeof(x->'key') is distinct from 'string' or pg_catalog.length(x->>'key') not between 1 and 160 or pg_catalog.jsonb_typeof(x->'fromParticipantId') is distinct from 'string' or pg_catalog.jsonb_typeof(x->'toParticipantId') is distinct from 'string' or pg_catalog.jsonb_typeof(x->'amount') is distinct from 'number' or (x->>'amount') !~ '^[0-9]+$') then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  insert into private.shared_payment_transfers(bill_id, transfer_key, from_participant_id, to_participant_id, amount_minor)
  select p_bill_id, x->>'key', x->>'fromParticipantId', x->>'toParticipantId', (x->>'amount')::bigint from pg_catalog.jsonb_array_elements(p_transfers) x;
  update private.shared_bills set confirmation_revision = confirmation_revision + 1 where id = p_bill_id; perform private.notify_shared_bill(p_bill_id); return private.shared_session_snapshot(v_bill.public_id);
end;
$function$;

create function api.select_payment_actor(p_bill_id uuid, p_participant_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_public_id uuid;
begin
  select b.public_id into v_public_id from private.shared_bills b join private.shared_bill_members m on m.bill_id = b.id where b.id = p_bill_id and b.expires_at > pg_catalog.now() and m.user_id = v_user_id and m.role = 'friend';
  if not found or not exists(select 1 from private.shared_participants p where p.bill_id = p_bill_id and p.id = p_participant_id) then raise exception using errcode = '42501', message = 'PARTICIPANT_NOT_CLAIMED'; end if;
  insert into private.shared_payment_actors(bill_id, user_id, participant_id) values(p_bill_id, v_user_id, p_participant_id) on conflict(bill_id, user_id) do update set participant_id = excluded.participant_id;
  return private.friend_session_snapshot_for_participant(v_public_id, p_participant_id);
end;
$function$;

create function api.submit_payment(p_bill_id uuid, p_transfer_key text, p_proof_kind text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_transfer private.shared_payment_transfers%rowtype; v_public_id uuid;
begin
  if p_proof_kind not in ('bank_transfer','cash') then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  select t.* into v_transfer from private.shared_payment_transfers t join private.shared_payment_actors a on a.bill_id=t.bill_id and a.user_id=v_user_id and a.participant_id=t.from_participant_id where t.bill_id=p_bill_id and t.transfer_key=p_transfer_key for update of t;
  if not found then raise exception using errcode='42501', message='PAYMENT_ACTOR_REQUIRED'; end if;
  select public_id into v_public_id from private.shared_bills where id=p_bill_id;
  if v_transfer.status = 'confirmed' then return private.friend_session_snapshot_for_participant(v_public_id, v_transfer.from_participant_id); end if;
  update private.shared_payment_transfers set status='submitted', proof_kind=p_proof_kind, submitted_at=pg_catalog.now(), confirmed_at=null where bill_id=p_bill_id and transfer_key=p_transfer_key;
  update private.shared_bills set confirmation_revision=confirmation_revision+1 where id=p_bill_id; perform private.notify_shared_bill(p_bill_id); return private.friend_session_snapshot_for_participant(v_public_id, v_transfer.from_participant_id);
end;
$function$;

create function api.confirm_payment(p_bill_id uuid, p_transfer_key text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_transfer private.shared_payment_transfers%rowtype; v_public_id uuid;
begin
  select t.* into v_transfer from private.shared_payment_transfers t join private.shared_payment_actors a on a.bill_id=t.bill_id and a.user_id=v_user_id and a.participant_id=t.to_participant_id where t.bill_id=p_bill_id and t.transfer_key=p_transfer_key for update of t;
  if not found then raise exception using errcode='42501', message='PAYMENT_ACTOR_REQUIRED'; end if;
  select public_id into v_public_id from private.shared_bills where id=p_bill_id;
  if v_transfer.status <> 'submitted' then raise exception using errcode='55000', message='PAYMENT_NOT_SUBMITTED'; end if;
  update private.shared_payment_transfers set status='confirmed', confirmed_at=pg_catalog.now() where bill_id=p_bill_id and transfer_key=p_transfer_key;
  update private.shared_bills set confirmation_revision=confirmation_revision+1 where id=p_bill_id; perform private.notify_shared_bill(p_bill_id); return private.friend_session_snapshot_for_participant(v_public_id, v_transfer.to_participant_id);
end;
$function$;

create or replace function api.shared_bill_capabilities() returns jsonb language sql stable set search_path = '' as $function$
  select pg_catalog.jsonb_build_object('settlementRoutingVersion',1,'receiptAdjustmentsVersion',1,'closeBillVersion',1,'paymentTrackingVersion',1);
$function$;
revoke all on function api.initialize_payment_tracking(uuid,jsonb), api.select_payment_actor(uuid,text), api.submit_payment(uuid,text,text), api.confirm_payment(uuid,text) from public, anon, authenticated;
grant execute on function api.initialize_payment_tracking(uuid,jsonb), api.select_payment_actor(uuid,text), api.submit_payment(uuid,text,text), api.confirm_payment(uuid,text) to authenticated;
