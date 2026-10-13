-- Review acknowledgements are separate from content revisions. Closing is permanent.
alter table private.shared_bills
  add column closed_at timestamptz,
  add column confirmation_revision bigint not null default 0 check (confirmation_revision >= 0);

create table private.participant_review_status (
  bill_id uuid not null,
  participant_id text not null,
  viewed_at timestamptz,
  confirmed_at timestamptz,
  confirmed_content_revision bigint,
  actor_user_id uuid references auth.users(id) on delete set null,
  primary key (bill_id, participant_id),
  foreign key (bill_id, participant_id) references private.shared_participants(bill_id, id) on delete cascade,
  check ((confirmed_at is null) = (confirmed_content_revision is null))
);
alter table private.participant_review_status enable row level security;
revoke all on table private.participant_review_status from public, anon, authenticated;

create or replace function private.shared_session_snapshot(p_public_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_bill private.shared_bills%rowtype; v_snapshot jsonb; v_role text; v_selected text;
begin
  select b.* into v_bill from private.shared_bills b
  where b.public_id = p_public_id and b.expires_at > pg_catalog.now();
  if not found then return null; end if;
  select m.role, m.participant_id into v_role, v_selected
    from private.shared_bill_members m where m.bill_id = v_bill.id and m.user_id = auth.uid();
  select pg_catalog.jsonb_build_object(
    'id', v_bill.id, 'title', v_bill.title, 'currency', v_bill.currency,
    'revision', v_bill.revision, 'expiresAt', v_bill.expires_at,
    'closedAt', coalesce(v_bill.closed_at::text, ''),
    'confirmationRevision', v_bill.confirmation_revision,
    'confirmations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'participantId', p.id, 'viewedAt', coalesce(s.viewed_at::text, ''),
      'confirmedAt', coalesce(s.confirmed_at::text, ''),
      'confirmedContentRevision', s.confirmed_content_revision) order by p.position)
      from private.shared_participants p
      left join private.participant_review_status s on s.bill_id = p.bill_id and s.participant_id = p.id
      where p.bill_id = v_bill.id and (v_role = 'owner' or (v_role = 'friend' and p.id = v_selected))), '[]'::jsonb),
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

create or replace function private.notify_shared_bill(p_bill_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare v_revision bigint; v_confirmation_revision bigint;
begin
  select b.revision, b.confirmation_revision into v_revision, v_confirmation_revision
    from private.shared_bills b where b.id = p_bill_id;
  if not found then return; end if;
  begin
    perform realtime.send(pg_catalog.jsonb_build_object('revision', v_revision,
      'confirmationRevision', v_confirmation_revision), 'shared_bill_changed',
      'shared-bill:' || p_bill_id::text, true);
  exception when others then null;
  end;
end;
$function$;

-- Keep the latest selection/participation/owner implementations intact behind
-- guards; the guard is checked before even an idempotent stale retry can return.
alter function api.apply_owner_action(uuid, bigint, jsonb) rename to apply_owner_action_before_close;
create function api.apply_owner_action(p_bill_id uuid, p_expected_revision bigint, p_session jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_closed_at timestamptz;
begin
  select b.closed_at into v_closed_at from private.shared_bills b where b.id = p_bill_id for update;
  if v_closed_at is not null then raise exception using errcode = '55000', message = 'BILL_CLOSED'; end if;
  return api.apply_owner_action_before_close(p_bill_id, p_expected_revision, p_session);
end;
$function$;

alter function api.claim_participant(uuid, text) rename to claim_participant_before_close;
create function api.claim_participant(p_bill_id uuid, p_participant_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_result jsonb; v_bill private.shared_bills%rowtype;
begin
  select b.* into v_bill from private.shared_bills b where b.id = p_bill_id for update;
  if v_bill.closed_at is not null then raise exception using errcode = '55000', message = 'BILL_CLOSED'; end if;
  v_result := api.claim_participant_before_close(p_bill_id, p_participant_id);
  insert into private.participant_review_status (bill_id, participant_id, viewed_at)
    values (p_bill_id, p_participant_id, pg_catalog.now())
    on conflict (bill_id, participant_id) do update set viewed_at = greatest(
      private.participant_review_status.viewed_at, excluded.viewed_at);
  perform private.notify_shared_bill(p_bill_id);
  return pg_catalog.jsonb_build_object('participantId', p_participant_id,
    'snapshot', private.shared_session_snapshot(v_bill.public_id));
end;
$function$;

alter function api.set_shared_participation(uuid, text, text, boolean, bigint) rename to set_shared_participation_before_close;
create function api.set_shared_participation(p_bill_id uuid, p_receipt_id text, p_item_id text, p_selected boolean, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_closed_at timestamptz;
begin
  select b.closed_at into v_closed_at from private.shared_bills b where b.id = p_bill_id for update;
  if v_closed_at is not null then raise exception using errcode = '55000', message = 'BILL_CLOSED'; end if;
  return api.set_shared_participation_before_close(p_bill_id, p_receipt_id, p_item_id, p_selected, p_expected_revision);
end;
$function$;

alter function api.set_shared_participation_for_participant(uuid, text, text, text, boolean, bigint) rename to set_shared_participation_for_participant_before_close;
create function api.set_shared_participation_for_participant(p_bill_id uuid, p_receipt_id text, p_item_id text, p_participant_id text, p_selected boolean, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_closed_at timestamptz;
begin
  select b.closed_at into v_closed_at from private.shared_bills b where b.id = p_bill_id for update;
  if v_closed_at is not null then raise exception using errcode = '55000', message = 'BILL_CLOSED'; end if;
  return api.set_shared_participation_for_participant_before_close(p_bill_id, p_receipt_id, p_item_id, p_participant_id, p_selected, p_expected_revision);
end;
$function$;

create function api.set_participant_confirmation(p_bill_id uuid, p_participant_id text, p_confirmed boolean, p_expected_content_revision bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype;
  v_member private.shared_bill_members%rowtype; v_current bigint; v_changed boolean;
begin
  if p_participant_id is null or pg_catalog.length(pg_catalog.btrim(p_participant_id)) not between 1 and 128
    or p_confirmed is null or p_expected_content_revision is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  select b.* into v_bill from private.shared_bills b where b.id = p_bill_id and b.expires_at > pg_catalog.now() for update;
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  if v_bill.closed_at is not null then raise exception using errcode = '55000', message = 'BILL_CLOSED'; end if;
  select m.* into v_member from private.shared_bill_members m where m.bill_id = p_bill_id and m.user_id = v_user_id;
  if not found or (v_member.role = 'friend' and v_member.participant_id is distinct from p_participant_id)
    then raise exception using errcode = '42501', message = 'PARTICIPANT_NOT_CLAIMED'; end if;
  if v_bill.revision is distinct from p_expected_content_revision
    then raise exception using errcode = '40001', message = 'REVISION_CONFLICT'; end if;
  if not exists (select 1 from private.shared_participants p where p.bill_id = p_bill_id and p.id = p_participant_id)
    then raise exception using errcode = 'P0002', message = 'PARTICIPANT_NOT_FOUND'; end if;
  select s.confirmed_content_revision into v_current from private.participant_review_status s
    where s.bill_id = p_bill_id and s.participant_id = p_participant_id;
  v_changed := (p_confirmed and v_current is distinct from v_bill.revision)
    or (not p_confirmed and v_current is not null);
  if v_changed then
    insert into private.participant_review_status (bill_id, participant_id, confirmed_at, confirmed_content_revision, actor_user_id)
      values (p_bill_id, p_participant_id, case when p_confirmed then pg_catalog.now() else null end,
        case when p_confirmed then v_bill.revision else null end, v_user_id)
      on conflict (bill_id, participant_id) do update set
        confirmed_at = excluded.confirmed_at,
        confirmed_content_revision = excluded.confirmed_content_revision,
        actor_user_id = excluded.actor_user_id;
    update private.shared_bills set confirmation_revision = confirmation_revision + 1 where id = p_bill_id;
    perform private.notify_shared_bill(p_bill_id);
  end if;
  return private.shared_session_snapshot(v_bill.public_id);
end;
$function$;

create function api.close_shared_bill(p_bill_id uuid, p_expected_content_revision bigint, p_ack_incomplete boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype;
begin
  if p_expected_content_revision is null or p_ack_incomplete is null
    then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  select b.* into v_bill from private.shared_bills b
    join private.shared_bill_members m on m.bill_id = b.id
    where b.id = p_bill_id and b.expires_at > pg_catalog.now() and m.user_id = v_user_id and m.role = 'owner'
    for update of b;
  if not found then raise exception using errcode = '42501', message = 'OWNER_REQUIRED'; end if;
  if v_bill.closed_at is not null then raise exception using errcode = '55000', message = 'BILL_CLOSED'; end if;
  if v_bill.revision is distinct from p_expected_content_revision
    then raise exception using errcode = '40001', message = 'REVISION_CONFLICT'; end if;
  if not p_ack_incomplete and exists (
    select 1 from private.shared_participants p
    left join private.participant_review_status s on s.bill_id = p.bill_id and s.participant_id = p.id
    where p.bill_id = p_bill_id and s.confirmed_content_revision is distinct from v_bill.revision
  ) then raise exception using errcode = '55000', message = 'CONFIRMATIONS_INCOMPLETE'; end if;
  update private.shared_bills set closed_at = pg_catalog.now(), confirmation_revision = confirmation_revision + 1
    where id = p_bill_id;
  perform private.notify_shared_bill(p_bill_id);
  return private.shared_session_snapshot(v_bill.public_id);
end;
$function$;

create or replace function api.shared_bill_capabilities()
returns jsonb language sql stable set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object('settlementRoutingVersion', 1,
    'receiptAdjustmentsVersion', 1, 'closeBillVersion', 1);
$function$;

revoke all on table private.participant_review_status from public, anon, authenticated;
revoke all on function private.shared_session_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.notify_shared_bill(uuid) from public, anon, authenticated;
revoke all on function api.apply_owner_action_before_close(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function api.claim_participant_before_close(uuid, text) from public, anon, authenticated;
revoke all on function api.set_shared_participation_before_close(uuid, text, text, boolean, bigint) from public, anon, authenticated;
revoke all on function api.set_shared_participation_for_participant_before_close(uuid, text, text, text, boolean, bigint) from public, anon, authenticated;
revoke all on function api.apply_owner_action(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function api.claim_participant(uuid, text) from public, anon, authenticated;
revoke all on function api.set_shared_participation(uuid, text, text, boolean, bigint) from public, anon, authenticated;
revoke all on function api.set_shared_participation_for_participant(uuid, text, text, text, boolean, bigint) from public, anon, authenticated;
revoke all on function api.set_participant_confirmation(uuid, text, boolean, bigint) from public, anon, authenticated;
revoke all on function api.close_shared_bill(uuid, bigint, boolean) from public, anon, authenticated;
grant execute on function api.apply_owner_action(uuid, bigint, jsonb) to authenticated;
grant execute on function api.claim_participant(uuid, text) to authenticated;
grant execute on function api.set_shared_participation(uuid, text, text, boolean, bigint) to authenticated;
grant execute on function api.set_shared_participation_for_participant(uuid, text, text, text, boolean, bigint) to authenticated;
grant execute on function api.set_participant_confirmation(uuid, text, boolean, bigint) to authenticated;
grant execute on function api.close_shared_bill(uuid, bigint, boolean) to authenticated;

-- Friend identity and review status are selected per browser tab, not inferred
-- from the shared anonymous-auth membership row.
create or replace function private.shared_session_snapshot(p_public_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_bill private.shared_bills%rowtype; v_snapshot jsonb; v_role text;
begin
  select b.* into v_bill from private.shared_bills b
    where b.public_id = p_public_id and b.expires_at > pg_catalog.now();
  if not found then return null; end if;
  select m.role into v_role from private.shared_bill_members m
    where m.bill_id = v_bill.id and m.user_id = auth.uid();
  select pg_catalog.jsonb_build_object(
    'id', v_bill.id, 'title', v_bill.title, 'currency', v_bill.currency,
    'revision', v_bill.revision, 'expiresAt', v_bill.expires_at,
    'closedAt', coalesce(v_bill.closed_at::text, ''),
    'confirmationRevision', v_bill.confirmation_revision,
    'confirmations', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'participantId', p.id, 'viewedAt', coalesce(s.viewed_at::text, ''),
      'confirmedAt', coalesce(s.confirmed_at::text, ''),
      'confirmedContentRevision', s.confirmed_content_revision) order by p.position)
      from private.shared_participants p
      left join private.participant_review_status s on s.bill_id = p.bill_id and s.participant_id = p.id
      where p.bill_id = v_bill.id and v_role = 'owner'), '[]'::jsonb),
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

create function private.friend_session_snapshot_for_participant(p_public_id uuid, p_participant_id text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $function$
declare v_bill private.shared_bills%rowtype; v_snapshot jsonb;
begin
  select b.* into v_bill from private.shared_bills b
    where b.public_id = p_public_id and b.expires_at > pg_catalog.now();
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  if not exists (select 1 from private.shared_bill_members m
      where m.bill_id = v_bill.id and m.user_id = auth.uid() and m.role = 'friend') then
    raise exception using errcode = '42501', message = 'PARTICIPANT_NOT_CLAIMED';
  end if;
  if p_participant_id is null or not exists (select 1 from private.shared_participants p
      where p.bill_id = v_bill.id and p.id = p_participant_id) then
    raise exception using errcode = 'P0002', message = 'PARTICIPANT_NOT_FOUND';
  end if;
  v_snapshot := private.shared_session_snapshot(p_public_id);
  return pg_catalog.jsonb_set(v_snapshot, '{confirmations}', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'participantId', p.id, 'viewedAt', coalesce(s.viewed_at::text, ''),
      'confirmedAt', coalesce(s.confirmed_at::text, ''),
      'confirmedContentRevision', s.confirmed_content_revision))
    from private.shared_participants p
    left join private.participant_review_status s on s.bill_id = p.bill_id and s.participant_id = p.id
    where p.bill_id = v_bill.id and p.id = p_participant_id
  ), '[]'::jsonb), true);
end;
$function$;

create or replace function api.claim_participant(p_bill_id uuid, p_participant_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_bill private.shared_bills%rowtype;
begin
  select b.* into v_bill from private.shared_bills b where b.id = p_bill_id and b.expires_at > pg_catalog.now() for update;
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  if v_bill.closed_at is not null then raise exception using errcode = '55000', message = 'BILL_CLOSED'; end if;
  perform api.claim_participant_before_close(p_bill_id, p_participant_id);
  insert into private.participant_review_status (bill_id, participant_id, viewed_at)
    values (p_bill_id, p_participant_id, pg_catalog.now())
    on conflict (bill_id, participant_id) do update set viewed_at = greatest(
      private.participant_review_status.viewed_at, excluded.viewed_at);
  perform private.notify_shared_bill(p_bill_id);
  return pg_catalog.jsonb_build_object('participantId', p_participant_id,
    'snapshot', private.friend_session_snapshot_for_participant(v_bill.public_id, p_participant_id));
end;
$function$;

create function api.fetch_shared_bill_for_participant(p_bill_id uuid, p_participant_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype;
begin
  select b.* into v_bill from private.shared_bills b
    join private.shared_bill_members m on m.bill_id = b.id
    where b.id = p_bill_id and b.expires_at > pg_catalog.now()
      and m.user_id = v_user_id and m.role = 'friend';
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  return pg_catalog.jsonb_build_object('publicId', v_bill.public_id, 'billId', v_bill.id,
    'snapshot', private.friend_session_snapshot_for_participant(v_bill.public_id, p_participant_id));
end;
$function$;

create or replace function api.set_shared_participation_for_participant(
  p_bill_id uuid, p_receipt_id text, p_item_id text, p_participant_id text,
  p_selected boolean, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_bill private.shared_bills%rowtype;
begin
  select b.* into v_bill from private.shared_bills b where b.id = p_bill_id for update;
  if v_bill.closed_at is not null then raise exception using errcode = '55000', message = 'BILL_CLOSED'; end if;
  perform api.set_shared_participation_for_participant_before_close(
    p_bill_id, p_receipt_id, p_item_id, p_participant_id, p_selected, p_expected_revision);
  return private.friend_session_snapshot_for_participant(v_bill.public_id, p_participant_id);
end;
$function$;

create or replace function api.set_participant_confirmation(
  p_bill_id uuid, p_participant_id text, p_confirmed boolean, p_expected_content_revision bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype;
  v_member private.shared_bill_members%rowtype; v_current bigint; v_changed boolean;
begin
  if p_participant_id is null or pg_catalog.length(pg_catalog.btrim(p_participant_id)) not between 1 and 128
    or p_confirmed is null or p_expected_content_revision is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  select b.* into v_bill from private.shared_bills b
    where b.id = p_bill_id and b.expires_at > pg_catalog.now() for update;
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  if v_bill.closed_at is not null then raise exception using errcode = '55000', message = 'BILL_CLOSED'; end if;
  if v_bill.revision is distinct from p_expected_content_revision then
    raise exception using errcode = '40001', message = 'REVISION_CONFLICT';
  end if;
  select m.* into v_member from private.shared_bill_members m
    where m.bill_id = p_bill_id and m.user_id = v_user_id for update;
  if not found then raise exception using errcode = '42501', message = 'PARTICIPANT_NOT_CLAIMED'; end if;
  if not exists (select 1 from private.shared_participants p where p.bill_id = p_bill_id and p.id = p_participant_id) then
    raise exception using errcode = 'P0002', message = 'PARTICIPANT_NOT_FOUND';
  end if;
  if v_member.role = 'friend' then
    update private.shared_bill_members set participant_id = p_participant_id
      where bill_id = p_bill_id and user_id = v_user_id;
  elsif v_member.role <> 'owner' then
    raise exception using errcode = '42501', message = 'PARTICIPANT_NOT_CLAIMED';
  end if;
  select s.confirmed_content_revision into v_current from private.participant_review_status s
    where s.bill_id = p_bill_id and s.participant_id = p_participant_id;
  v_changed := (p_confirmed and v_current is distinct from v_bill.revision)
    or (not p_confirmed and v_current is not null);
  if v_changed then
    insert into private.participant_review_status (bill_id, participant_id, confirmed_at,
      confirmed_content_revision, actor_user_id)
      values (p_bill_id, p_participant_id, case when p_confirmed then pg_catalog.now() else null end,
        case when p_confirmed then v_bill.revision else null end, v_user_id)
      on conflict (bill_id, participant_id) do update set confirmed_at = excluded.confirmed_at,
        confirmed_content_revision = excluded.confirmed_content_revision, actor_user_id = excluded.actor_user_id;
    update private.shared_bills set confirmation_revision = confirmation_revision + 1 where id = p_bill_id;
    perform private.notify_shared_bill(p_bill_id);
  end if;
  if v_member.role = 'friend' then
    return private.friend_session_snapshot_for_participant(v_bill.public_id, p_participant_id);
  end if;
  return private.shared_session_snapshot(v_bill.public_id);
end;
$function$;

revoke all on function private.shared_session_snapshot(uuid) from public, anon, authenticated;
revoke all on function private.friend_session_snapshot_for_participant(uuid, text) from public, anon, authenticated;
revoke all on function api.claim_participant(uuid, text) from public, anon, authenticated;
revoke all on function api.fetch_shared_bill_for_participant(uuid, text) from public, anon, authenticated;
revoke all on function api.set_shared_participation_for_participant(uuid, text, text, text, boolean, bigint) from public, anon, authenticated;
revoke all on function api.set_participant_confirmation(uuid, text, boolean, bigint) from public, anon, authenticated;
grant execute on function api.claim_participant(uuid, text) to authenticated;
grant execute on function api.fetch_shared_bill_for_participant(uuid, text) to authenticated;
grant execute on function api.set_shared_participation_for_participant(uuid, text, text, text, boolean, bigint) to authenticated;
grant execute on function api.set_participant_confirmation(uuid, text, boolean, bigint) to authenticated;
