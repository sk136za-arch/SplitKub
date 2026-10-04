-- A participant is a shared editing choice, not an exclusive claim.
-- Keep every friend membership when the owner removes a selected participant.
drop index if exists private.shared_bill_member_participant_idx;

alter table private.shared_bill_members
  drop constraint if exists shared_bill_members_bill_id_participant_id_fkey;
alter table private.shared_bill_members
  add constraint shared_bill_members_bill_id_participant_id_fkey
  foreign key (bill_id, participant_id)
  references private.shared_participants (bill_id, id)
  on delete set null (participant_id);

create or replace function api.claim_participant(p_bill_id uuid, p_participant_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype; v_member private.shared_bill_members%rowtype;
begin
  if p_participant_id is null or pg_catalog.length(pg_catalog.btrim(p_participant_id)) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  -- Serialize against owner replacement and concurrent choices of the same name.
  select b.* into v_bill from private.shared_bills b
  where b.id = p_bill_id and b.expires_at > pg_catalog.now() for update;
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  select m.* into v_member from private.shared_bill_members m
    where m.bill_id = v_bill.id and m.user_id = v_user_id;
  if not found then raise exception using errcode = '42501', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  if v_member.role <> 'friend' then raise exception using errcode = '42501', message = 'OWNER_CANNOT_CLAIM_PARTICIPANT'; end if;
  if not exists (select 1 from private.shared_participants p where p.bill_id = v_bill.id and p.id = p_participant_id) then
    raise exception using errcode = 'P0002', message = 'PARTICIPANT_NOT_FOUND';
  end if;
  update private.shared_bill_members set participant_id = p_participant_id
    where bill_id = v_bill.id and user_id = v_user_id;
  return pg_catalog.jsonb_build_object('participantId', p_participant_id,
    'snapshot', private.shared_session_snapshot(v_bill.public_id));
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
  if v_bill.revision is distinct from p_expected_revision then raise exception using errcode = '40001', message = 'REVISION_CONFLICT'; end if;
  perform private.validate_settlement_config(p_session);
  perform private.write_session_contents(v_bill.id, p_session);
  update private.shared_bills set title = p_session ->> 'title', currency = p_session ->> 'currency',
    settlement_mode = coalesce(p_session ->> 'settlementMode', 'direct'),
    collector_participant_id = nullif(p_session ->> 'collectorParticipantId', ''),
    revision = revision + 1 where id = v_bill.id;
  perform private.notify_shared_bill(v_bill.id);
  return private.shared_session_snapshot(v_bill.public_id);
end;
$function$;

create or replace function api.set_shared_participation(p_bill_id uuid, p_receipt_id text, p_item_id text, p_selected boolean, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype;
        v_participant_id text; v_currently_selected boolean;
begin
  select b.* into v_bill from private.shared_bills b where b.id = p_bill_id and b.expires_at > pg_catalog.now() for update;
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  select m.participant_id into v_participant_id from private.shared_bill_members m
    where m.bill_id = v_bill.id and m.user_id = v_user_id and m.role = 'friend';
  if not found or v_participant_id is null then raise exception using errcode = '42501', message = 'PARTICIPANT_NOT_CLAIMED'; end if;
  if p_receipt_id is null or p_item_id is null or p_selected is null or p_expected_revision is null then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  if not exists (select 1 from private.shared_items i where i.bill_id = v_bill.id and i.receipt_id = p_receipt_id and i.id = p_item_id) then
    raise exception using errcode = 'P0002', message = 'ITEM_NOT_IN_RECEIPT';
  end if;
  select exists (select 1 from private.shared_item_participants ip
    where ip.bill_id = v_bill.id and ip.receipt_id = p_receipt_id
      and ip.item_id = p_item_id and ip.participant_id = v_participant_id)
    into v_currently_selected;
  -- A stale retry is safe only when the requested final state is already true.
  if v_bill.revision is distinct from p_expected_revision then
    if v_currently_selected = p_selected then return private.shared_session_snapshot(v_bill.public_id); end if;
    raise exception using errcode = '40001', message = 'REVISION_CONFLICT';
  end if;
  if v_currently_selected <> p_selected then
    if p_selected then
      insert into private.shared_item_participants (bill_id, receipt_id, item_id, participant_id)
        values (v_bill.id, p_receipt_id, p_item_id, v_participant_id);
    else
      delete from private.shared_item_participants
        where bill_id = v_bill.id and receipt_id = p_receipt_id
          and item_id = p_item_id and participant_id = v_participant_id;
    end if;
    update private.shared_bills set revision = revision + 1 where id = v_bill.id;
    perform private.notify_shared_bill(v_bill.id);
  end if;
  return private.shared_session_snapshot(v_bill.public_id);
end;
$function$;

revoke all on function api.claim_participant(uuid, text) from public, anon, authenticated;
revoke all on function api.apply_owner_action(uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function api.set_shared_participation(uuid, text, text, boolean, bigint) from public, anon, authenticated;
grant execute on function api.claim_participant(uuid, text) to authenticated;
grant execute on function api.apply_owner_action(uuid, bigint, jsonb) to authenticated;
grant execute on function api.set_shared_participation(uuid, text, text, boolean, bigint) to authenticated;
