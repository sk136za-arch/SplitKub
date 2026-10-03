create or replace view public.debug_shared_bills
with (security_invoker = true)
as
select
  id,
  public_id,
  title,
  currency,
  revision,
  created_at,
  expires_at
from private.shared_bills;

create or replace view public.debug_shared_participants
with (security_invoker = true)
as
select *
from private.shared_participants;

create or replace view public.debug_shared_receipts
with (security_invoker = true)
as
select *
from private.shared_receipts;

create or replace view public.debug_shared_items
with (security_invoker = true)
as
select *
from private.shared_items;

create or replace view public.debug_item_participants
with (security_invoker = true)
as
select *
from private.shared_item_participants;

create or replace view public.debug_bill_members
with (security_invoker = true)
as
select *
from private.shared_bill_members;