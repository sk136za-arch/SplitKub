-- Shared-session MVP 1.1. Only capability-checked RPCs are exposed through `api`.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;
create schema if not exists api;

revoke all on schema private from public, anon, authenticated;
revoke all on schema api from public, anon;
grant usage on schema api to authenticated;

create table private.shared_bills (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  public_id uuid not null unique default pg_catalog.gen_random_uuid(),
  owner_user_id uuid references auth.users(id) on delete set null,
  title text not null check (pg_catalog.length(pg_catalog.btrim(title)) between 1 and 120),
  currency text not null check (currency in ('THB', 'USD')),
  owner_token_hash bytea not null,
  friend_token_hash bytea not null,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null
);
create index shared_bills_expiry_idx on private.shared_bills (expires_at);

create table private.shared_participants (
  bill_id uuid not null references private.shared_bills(id) on delete cascade,
  id text not null check (pg_catalog.length(id) between 1 and 128),
  name text not null check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 120),
  prompt_pay text not null default '' check (pg_catalog.length(prompt_pay) <= 64),
  position integer not null check (position >= 0),
  primary key (bill_id, id),
  unique (bill_id, position)
);

create table private.shared_receipts (
  bill_id uuid not null references private.shared_bills(id) on delete cascade,
  id text not null check (pg_catalog.length(id) between 1 and 128),
  title text not null check (pg_catalog.length(pg_catalog.btrim(title)) between 1 and 120),
  paid_by_participant_id text not null default '',
  position integer not null check (position >= 0),
  primary key (bill_id, id),
  unique (bill_id, position)
);

create table private.shared_items (
  bill_id uuid not null,
  receipt_id text not null,
  id text not null check (pg_catalog.length(id) between 1 and 128),
  name text not null check (pg_catalog.length(pg_catalog.btrim(name)) between 1 and 120),
  price_minor bigint not null check (price_minor between 1 and 9007199254740991),
  position integer not null check (position >= 0),
  primary key (bill_id, receipt_id, id),
  unique (bill_id, receipt_id, position),
  foreign key (bill_id, receipt_id) references private.shared_receipts(bill_id, id) on delete cascade
);

create table private.shared_item_participants (
  bill_id uuid not null,
  receipt_id text not null,
  item_id text not null,
  participant_id text not null,
  primary key (bill_id, receipt_id, item_id, participant_id),
  foreign key (bill_id, receipt_id, item_id) references private.shared_items(bill_id, receipt_id, id) on delete cascade,
  foreign key (bill_id, participant_id) references private.shared_participants(bill_id, id) on delete cascade
);

create table private.shared_bill_members (
  bill_id uuid not null references private.shared_bills(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'friend')),
  participant_id text,
  joined_at timestamptz not null default pg_catalog.now(),
  primary key (bill_id, user_id),
  foreign key (bill_id, participant_id) references private.shared_participants(bill_id, id),
  check (role = 'friend' or participant_id is null)
);
create unique index shared_bill_member_participant_idx
  on private.shared_bill_members (bill_id, participant_id) where participant_id is not null;
create index shared_bill_members_user_idx on private.shared_bill_members (user_id, bill_id);

alter table private.shared_bills enable row level security;
alter table private.shared_participants enable row level security;
alter table private.shared_receipts enable row level security;
alter table private.shared_items enable row level security;
alter table private.shared_item_participants enable row level security;
alter table private.shared_bill_members enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;

create function private.require_authenticated_user()
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception using errcode = '28000', message = 'AUTH_REQUIRED'; end if;
  return v_user_id;
end;
$function$;

create function private.write_session_contents(p_bill_id uuid, p_session jsonb)
returns void language plpgsql security definer set search_path = ''
as $function$
declare v_total_items integer;
begin
  if p_session is null or pg_catalog.jsonb_typeof(p_session) is distinct from 'object'
     or p_session ->> 'currency' not in ('THB', 'USD')
     or pg_catalog.length(pg_catalog.btrim(p_session ->> 'title')) not between 1 and 120
     or pg_catalog.jsonb_typeof(p_session -> 'participants') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_session -> 'receipts') is distinct from 'array'
     or pg_catalog.jsonb_array_length(p_session -> 'participants') > 100
     or pg_catalog.jsonb_array_length(p_session -> 'receipts') > 50 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;

  select coalesce(sum(pg_catalog.jsonb_array_length(r.value -> 'items')), 0)::integer into v_total_items
  from pg_catalog.jsonb_array_elements(p_session -> 'receipts') as r(value);
  if v_total_items > 500 then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_session -> 'participants') as p(value)
    where pg_catalog.jsonb_typeof(p.value -> 'id') is distinct from 'string'
       or pg_catalog.length(pg_catalog.btrim(p.value ->> 'id')) not between 1 and 128
       or pg_catalog.jsonb_typeof(p.value -> 'name') is distinct from 'string'
       or pg_catalog.length(pg_catalog.btrim(p.value ->> 'name')) not between 1 and 120
       or pg_catalog.jsonb_typeof(coalesce(p.value -> 'promptPay', '""'::jsonb)) is distinct from 'string'
       or pg_catalog.length(coalesce(p.value ->> 'promptPay', '')) > 64
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_session -> 'receipts') as r(value)
    where pg_catalog.jsonb_typeof(r.value -> 'id') is distinct from 'string'
       or pg_catalog.length(pg_catalog.btrim(r.value ->> 'id')) not between 1 and 128
       or pg_catalog.jsonb_typeof(r.value -> 'title') is distinct from 'string'
       or pg_catalog.length(pg_catalog.btrim(r.value ->> 'title')) not between 1 and 120
       or pg_catalog.jsonb_typeof(coalesce(r.value -> 'paidByParticipantId', '""'::jsonb)) is distinct from 'string'
       or pg_catalog.jsonb_typeof(r.value -> 'items') is distinct from 'array'
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(p_session -> 'receipts') as r(value)
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
  from pg_catalog.jsonb_array_elements(p_session -> 'participants') with ordinality as p(value, ordinality)
  on conflict (bill_id, id) do update set name = excluded.name,
    prompt_pay = excluded.prompt_pay, position = excluded.position;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_session -> 'receipts') as r(value)
    where coalesce(r.value ->> 'paidByParticipantId', '') <> '' and not exists (
      select 1 from private.shared_participants p
      where p.bill_id = p_bill_id and p.id = r.value ->> 'paidByParticipantId'
    )
  ) then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;

  delete from private.shared_participants p where p.bill_id = p_bill_id and not exists (
    select 1 from pg_catalog.jsonb_array_elements(p_session -> 'participants') as incoming(value)
    where incoming.value ->> 'id' = p.id
  );

  insert into private.shared_receipts (bill_id, id, title, paid_by_participant_id, position)
  select p_bill_id, r.value ->> 'id', pg_catalog.btrim(r.value ->> 'title'),
    coalesce(r.value ->> 'paidByParticipantId', ''), (r.ordinality - 1)::integer
  from pg_catalog.jsonb_array_elements(p_session -> 'receipts') with ordinality as r(value, ordinality);

  insert into private.shared_items (bill_id, receipt_id, id, name, price_minor, position)
  select p_bill_id, r.value ->> 'id', i.value ->> 'id', pg_catalog.btrim(i.value ->> 'name'),
    (i.value ->> 'price')::bigint, (i.ordinality - 1)::integer
  from pg_catalog.jsonb_array_elements(p_session -> 'receipts') as r(value)
  cross join lateral pg_catalog.jsonb_array_elements(r.value -> 'items') with ordinality as i(value, ordinality);

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_session -> 'receipts') as r(value)
    cross join lateral pg_catalog.jsonb_array_elements(r.value -> 'items') as i(value)
    cross join lateral pg_catalog.jsonb_array_elements_text(i.value -> 'participantIds') as selected(participant_id)
    where not exists (select 1 from private.shared_participants p where p.bill_id = p_bill_id and p.id = selected.participant_id)
  ) then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;

  insert into private.shared_item_participants (bill_id, receipt_id, item_id, participant_id)
  select p_bill_id, r.value ->> 'id', i.value ->> 'id', selected.participant_id
  from pg_catalog.jsonb_array_elements(p_session -> 'receipts') as r(value)
  cross join lateral pg_catalog.jsonb_array_elements(r.value -> 'items') as i(value)
  cross join lateral pg_catalog.jsonb_array_elements_text(i.value -> 'participantIds') as selected(participant_id);
end;
$function$;

create function private.shared_session_snapshot(p_public_id uuid)
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

create function private.notify_shared_bill(p_bill_id uuid)
returns void language plpgsql security definer set search_path = ''
as $function$
declare v_revision bigint;
begin
  select b.revision into v_revision from private.shared_bills b where b.id = p_bill_id;
  if not found then return; end if;
  begin
  perform realtime.send(pg_catalog.jsonb_build_object('revision', v_revision), 'shared_bill_changed', 'shared-bill:' || p_bill_id::text, true);
  exception when others then null;
  end;
end;
$function$;

create function private.can_receive_shared_bill_topic(p_topic text)
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
declare v_public_id uuid; v_user_id uuid := auth.uid();
begin
  if v_user_id is null or p_topic !~ '^shared-bill:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
  v_public_id := pg_catalog.substring(p_topic, 13)::uuid;
  return exists (select 1 from private.shared_bills b join private.shared_bill_members m on m.bill_id = b.id
    where b.id = v_public_id and b.expires_at > pg_catalog.now() and m.user_id = v_user_id);
end;
$function$;

create function private.purge_expired_shared_bills()
returns bigint language plpgsql security definer set search_path = ''
as $function$
declare v_deleted bigint;
begin
  delete from private.shared_bills where expires_at <= pg_catalog.now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

create function api.create_shared_bill(p_session jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare
  v_user_id uuid := private.require_authenticated_user(); v_bill_id uuid; v_public_id uuid;
  v_owner_token text; v_friend_token text; v_snapshot jsonb;
begin
  if p_session is null or p_session ->> 'currency' not in ('THB', 'USD') then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  v_owner_token := pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_friend_token := pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into private.shared_bills (owner_user_id, title, currency, owner_token_hash, friend_token_hash, expires_at)
  values (v_user_id, p_session ->> 'title', p_session ->> 'currency',
    extensions.digest(pg_catalog.convert_to(v_owner_token, 'UTF8'), 'sha256'),
    extensions.digest(pg_catalog.convert_to(v_friend_token, 'UTF8'), 'sha256'),
    pg_catalog.now() + interval '90 days') returning id, public_id into v_bill_id, v_public_id;
  insert into private.shared_bill_members (bill_id, user_id, role) values (v_bill_id, v_user_id, 'owner');
  perform private.write_session_contents(v_bill_id, p_session);
  v_snapshot := private.shared_session_snapshot(v_public_id);
  return pg_catalog.jsonb_build_object('publicId', v_public_id, 'billId', v_bill_id,
    'friendToken', v_friend_token, 'ownerToken', v_owner_token, 'snapshot', v_snapshot);
end;
$function$;

create function api.join_shared_bill(p_public_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype; v_role text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then raise exception using errcode = '28000', message = 'INVALID_TOKEN'; end if;
  select b.* into v_bill from private.shared_bills b where b.public_id = p_public_id and b.expires_at > pg_catalog.now() for update;
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  if extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256') = v_bill.owner_token_hash then
    update private.shared_bill_members set role = 'friend', participant_id = null
      where bill_id = v_bill.id and role = 'owner' and user_id <> v_user_id;
    delete from private.shared_bill_members where bill_id = v_bill.id and user_id = v_user_id and role = 'friend';
    update private.shared_bills set owner_user_id = v_user_id where id = v_bill.id;
    insert into private.shared_bill_members (bill_id, user_id, role) values (v_bill.id, v_user_id, 'owner')
      on conflict (bill_id, user_id) do update set role = 'owner', participant_id = null;
    v_role := 'owner';
  elsif extensions.digest(pg_catalog.convert_to(p_token, 'UTF8'), 'sha256') = v_bill.friend_token_hash then
    insert into private.shared_bill_members (bill_id, user_id, role) values (v_bill.id, v_user_id, 'friend') on conflict (bill_id, user_id) do nothing;
    select m.role into v_role from private.shared_bill_members m where m.bill_id = v_bill.id and m.user_id = v_user_id;
  else raise exception using errcode = '28000', message = 'INVALID_TOKEN';
  end if;
  return pg_catalog.jsonb_build_object('publicId', v_bill.public_id, 'billId', v_bill.id, 'role', v_role,
    'snapshot', private.shared_session_snapshot(v_bill.public_id));
end;
$function$;

create function api.fetch_shared_bill(p_bill_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user();
begin
  if not exists (select 1 from private.shared_bills b join private.shared_bill_members m on m.bill_id = b.id
    where b.id = p_bill_id and b.expires_at > pg_catalog.now() and m.user_id = v_user_id) then
    raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE';
  end if;
  return pg_catalog.jsonb_build_object('publicId', (select b.public_id from private.shared_bills b where b.id = p_bill_id),
    'billId', p_bill_id,
    'snapshot', private.shared_session_snapshot((select b.public_id from private.shared_bills b where b.id = p_bill_id)));
end;
$function$;

create function api.apply_owner_action(p_bill_id uuid, p_expected_revision bigint, p_session jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype;
begin
  select b.* into v_bill from private.shared_bills b join private.shared_bill_members m on m.bill_id = b.id
  where b.id = p_bill_id and b.expires_at > pg_catalog.now() and m.user_id = v_user_id and m.role = 'owner' for update of b;
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  if v_bill.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'REVISION_CONFLICT'; end if;
  if exists (select 1 from private.shared_bill_members m where m.bill_id = v_bill.id and m.participant_id is not null
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_session -> 'participants') as p(value) where p.value ->> 'id' = m.participant_id)) then
    raise exception using errcode = '23503', message = 'CLAIMED_PARTICIPANT_CANNOT_BE_REMOVED';
  end if;
  perform private.write_session_contents(v_bill.id, p_session);
  update private.shared_bills set title = p_session ->> 'title', currency = p_session ->> 'currency', revision = revision + 1 where id = v_bill.id;
  perform private.notify_shared_bill(v_bill.id);
  return private.shared_session_snapshot(v_bill.public_id);
end;
$function$;

create function api.claim_participant(p_bill_id uuid, p_participant_id text)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype; v_member private.shared_bill_members%rowtype;
begin
  if p_participant_id is null or pg_catalog.length(p_participant_id) not between 1 and 128 then
    raise exception using errcode = '22023', message = 'VALIDATION_ERROR';
  end if;
  select b.* into v_bill from private.shared_bills b join private.shared_bill_members m on m.bill_id = b.id
  where b.id = p_bill_id and b.expires_at > pg_catalog.now() and m.user_id = v_user_id and m.role = 'friend' for update of b;
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  select m.* into v_member from private.shared_bill_members m where m.bill_id = v_bill.id and m.user_id = v_user_id;
  if not found then
    insert into private.shared_bill_members (bill_id, user_id, role) values (v_bill.id, v_user_id, 'friend');
    select m.* into v_member from private.shared_bill_members m where m.bill_id = v_bill.id and m.user_id = v_user_id;
  end if;
  if v_member.role <> 'friend' then raise exception using errcode = '42501', message = 'OWNER_CANNOT_CLAIM_PARTICIPANT'; end if;
  if not exists (select 1 from private.shared_participants p where p.bill_id = v_bill.id and p.id = p_participant_id) then
    raise exception using errcode = 'P0002', message = 'PARTICIPANT_NOT_FOUND';
  end if;
  if exists (select 1 from private.shared_bill_members m where m.bill_id = v_bill.id and m.participant_id = p_participant_id and m.user_id <> v_user_id) then
    raise exception using errcode = '23505', message = 'PARTICIPANT_ALREADY_CLAIMED';
  end if;
  update private.shared_bill_members set participant_id = p_participant_id where bill_id = v_bill.id and user_id = v_user_id;
  return pg_catalog.jsonb_build_object('participantId', p_participant_id, 'snapshot', private.shared_session_snapshot(v_bill.public_id));
end;
$function$;

create function api.set_shared_participation(p_bill_id uuid, p_receipt_id text, p_item_id text, p_selected boolean, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = ''
as $function$
declare v_user_id uuid := private.require_authenticated_user(); v_bill private.shared_bills%rowtype; v_participant_id text;
begin
  select b.* into v_bill from private.shared_bills b where b.id = p_bill_id and b.expires_at > pg_catalog.now() for update;
  if not found then raise exception using errcode = 'P0002', message = 'SHARED_BILL_UNAVAILABLE'; end if;
  if v_bill.revision <> p_expected_revision then raise exception using errcode = '40001', message = 'REVISION_CONFLICT'; end if;
  select m.participant_id into v_participant_id from private.shared_bill_members m
    where m.bill_id = v_bill.id and m.user_id = v_user_id and m.role = 'friend';
  if not found or v_participant_id is null then raise exception using errcode = '42501', message = 'PARTICIPANT_NOT_CLAIMED'; end if;
  if p_receipt_id is null or p_item_id is null or p_selected is null then raise exception using errcode = '22023', message = 'VALIDATION_ERROR'; end if;
  if not exists (select 1 from private.shared_items i where i.bill_id = v_bill.id and i.receipt_id = p_receipt_id and i.id = p_item_id) then
    raise exception using errcode = 'P0002', message = 'ITEM_NOT_IN_RECEIPT';
  end if;
  if p_selected and not exists (select 1 from private.shared_item_participants ip where ip.bill_id = v_bill.id and ip.receipt_id = p_receipt_id and ip.item_id = p_item_id and ip.participant_id = v_participant_id) then
    insert into private.shared_item_participants (bill_id, receipt_id, item_id, participant_id) values (v_bill.id, p_receipt_id, p_item_id, v_participant_id);
    update private.shared_bills set revision = revision + 1 where id = v_bill.id;
    perform private.notify_shared_bill(v_bill.id);
  elsif not p_selected and exists (select 1 from private.shared_item_participants ip where ip.bill_id = v_bill.id and ip.receipt_id = p_receipt_id and ip.item_id = p_item_id and ip.participant_id = v_participant_id) then
    delete from private.shared_item_participants where bill_id = v_bill.id and receipt_id = p_receipt_id and item_id = p_item_id and participant_id = v_participant_id;
    update private.shared_bills set revision = revision + 1 where id = v_bill.id;
    perform private.notify_shared_bill(v_bill.id);
  end if;
  return private.shared_session_snapshot(v_bill.public_id);
end;
$function$;

revoke all on all functions in schema api from public, anon, authenticated;
grant execute on function api.create_shared_bill(jsonb) to authenticated;
grant execute on function api.join_shared_bill(uuid, text) to authenticated;
grant execute on function api.fetch_shared_bill(uuid) to authenticated;
grant execute on function api.apply_owner_action(uuid, bigint, jsonb) to authenticated;
grant execute on function api.claim_participant(uuid, text) to authenticated;
grant execute on function api.set_shared_participation(uuid, text, text, boolean, bigint) to authenticated;

revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.can_receive_shared_bill_topic(text) to authenticated;

create policy "SplitKub members receive private bill broadcasts"
on realtime.messages for select to authenticated
using (realtime.messages.extension = 'broadcast' and private.can_receive_shared_bill_topic((select realtime.topic())));

select cron.schedule('splitkub-expired-shared-bills', '17 3 * * *', 'select private.purge_expired_shared_bills();');
