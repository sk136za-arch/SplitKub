-- Owners may act as one selected participant in payment tracking while retaining their full snapshot.
create or replace function api.select_payment_actor(p_bill_id uuid, p_participant_id text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_public_id uuid; v_role text;
begin
  select b.public_id, m.role into v_public_id, v_role
  from private.shared_bills b
  join private.shared_bill_members m on m.bill_id = b.id
  where b.id = p_bill_id and b.expires_at > pg_catalog.now() and m.user_id = v_user_id;
  if not found or not exists(select 1 from private.shared_participants p where p.bill_id = p_bill_id and p.id = p_participant_id) then
    raise exception using errcode = '42501', message = 'PARTICIPANT_NOT_CLAIMED';
  end if;
  insert into private.shared_payment_actors(bill_id, user_id, participant_id)
  values(p_bill_id, v_user_id, p_participant_id)
  on conflict(bill_id, user_id) do update set participant_id = excluded.participant_id;
  if v_role = 'owner' then return private.shared_session_snapshot(v_public_id); end if;
  return private.friend_session_snapshot_for_participant(v_public_id, p_participant_id);
end;
$function$;

revoke all on function api.select_payment_actor(uuid,text) from public, anon, authenticated;
grant execute on function api.select_payment_actor(uuid,text) to authenticated;
