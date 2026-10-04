-- Bind each toggle to the participant selected in that browser tab. A shared
-- anonymous auth user may have several open tabs with different local choices.
create function api.set_shared_participation_for_participant(
  p_bill_id uuid,
  p_receipt_id text,
  p_item_id text,
  p_participant_id text,
  p_selected boolean,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_bill private.shared_bills%rowtype;
  v_member private.shared_bill_members%rowtype;
  v_currently_selected boolean;
begin
  if p_receipt_id is null or p_item_id is null or p_participant_id is null
      or p_selected is null or p_expected_revision is null
      or pg_catalog.length(pg_catalog.btrim(p_participant_id)) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  -- Serialize membership choice and item assignment with other bill actions.
  select b.* into v_bill
    from private.shared_bills b
    where b.id = p_bill_id and b.expires_at > pg_catalog.now()
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE';
  end if;

  select m.* into v_member
    from private.shared_bill_members m
    where m.bill_id = v_bill.id and m.user_id = v_user_id
    for update;
  if not found then
    raise exception using errcode = '42501', message = 'PARTICIPANT_NOT_CLAIMED';
  end if;
  if v_member.role <> 'friend' then
    raise exception using errcode = '42501', message = 'PARTICIPANT_NOT_CLAIMED';
  end if;

  if not exists (
    select 1 from private.shared_participants p
    where p.bill_id = v_bill.id and p.id = p_participant_id
  ) then
    raise exception using errcode = 'P0002', message = 'PARTICIPANT_NOT_FOUND';
  end if;
  if not exists (
    select 1 from private.shared_items i
    where i.bill_id = v_bill.id and i.receipt_id = p_receipt_id and i.id = p_item_id
  ) then
    raise exception using errcode = 'P0002', message = 'ITEM_NOT_IN_RECEIPT';
  end if;

  update private.shared_bill_members
    set participant_id = p_participant_id
    where bill_id = v_bill.id and user_id = v_user_id;

  select exists (
    select 1 from private.shared_item_participants ip
    where ip.bill_id = v_bill.id and ip.receipt_id = p_receipt_id
      and ip.item_id = p_item_id and ip.participant_id = p_participant_id
  ) into v_currently_selected;

  -- Idempotent same-state retries remain safe across a concurrent revision.
  if v_bill.revision is distinct from p_expected_revision then
    if v_currently_selected = p_selected then
      return private.shared_session_snapshot(v_bill.public_id);
    end if;
    raise exception using errcode = '40001', message = 'REVISION_CONFLICT';
  end if;

  if v_currently_selected <> p_selected then
    if p_selected then
      insert into private.shared_item_participants (bill_id, receipt_id, item_id, participant_id)
        values (v_bill.id, p_receipt_id, p_item_id, p_participant_id);
    else
      delete from private.shared_item_participants
        where bill_id = v_bill.id and receipt_id = p_receipt_id
          and item_id = p_item_id and participant_id = p_participant_id;
    end if;
    update private.shared_bills set revision = revision + 1 where id = v_bill.id;
    perform private.notify_shared_bill(v_bill.id);
  end if;

  return private.shared_session_snapshot(v_bill.public_id);
end;
$function$;

revoke all on function api.set_shared_participation_for_participant(uuid, text, text, text, boolean, bigint)
  from public, anon, authenticated;
grant execute on function api.set_shared_participation_for_participant(uuid, text, text, text, boolean, bigint)
  to authenticated;
