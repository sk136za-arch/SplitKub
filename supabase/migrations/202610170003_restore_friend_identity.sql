-- Return the participant identity already bound to this friend membership so a
-- confirmed bill and payment tracking use the same person after a reload.
create or replace function api.join_shared_bill(p_public_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user_id uuid := private.require_authenticated_user();
  v_bill private.shared_bills%rowtype;
  v_role text;
  v_participant_id text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = '28000', message = 'INVALID_TOKEN';
  end if;

  select b.* into v_bill from private.shared_bills b
    where b.public_id = p_public_id and b.expires_at > pg_catalog.now()
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE';
  end if;

  if extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256') = v_bill.owner_token_hash then
    update private.shared_bill_members set role = 'friend', participant_id = null
      where bill_id = v_bill.id and role = 'owner' and user_id <> v_user_id;
    delete from private.shared_bill_members
      where bill_id = v_bill.id and user_id = v_user_id and role = 'friend';
    update private.shared_bills set owner_user_id = v_user_id where id = v_bill.id;
    insert into private.shared_bill_members (bill_id, user_id, role)
      values (v_bill.id, v_user_id, 'owner')
      on conflict (bill_id, user_id) do update set role = 'owner', participant_id = null;
    v_role := 'owner';
  elsif extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256') = v_bill.friend_token_hash then
    insert into private.shared_bill_members (bill_id, user_id, role)
      values (v_bill.id, v_user_id, 'friend')
      on conflict (bill_id, user_id) do nothing;
    select m.role, m.participant_id into v_role, v_participant_id
      from private.shared_bill_members m
      where m.bill_id = v_bill.id and m.user_id = v_user_id;
  else
    raise exception using errcode = '28000', message = 'INVALID_TOKEN';
  end if;

  return pg_catalog.jsonb_build_object(
    'publicId', v_bill.public_id,
    'billId', v_bill.id,
    'role', v_role,
    'participantId', coalesce(v_participant_id, ''),
    'snapshot', private.shared_session_snapshot(v_bill.public_id)
  );
end;
$function$;

revoke all on function api.join_shared_bill(uuid, text) from public, anon, authenticated;
grant execute on function api.join_shared_bill(uuid, text) to authenticated;
