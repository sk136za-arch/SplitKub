-- Explicit protocol negotiation prevents a new collector client from writing to
-- an older backend that would ignore settlement configuration.
create function api.shared_bill_capabilities()
returns jsonb language sql stable set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object('settlementRoutingVersion', 1);
$function$;

revoke all on function api.shared_bill_capabilities() from public, anon, authenticated;
grant execute on function api.shared_bill_capabilities() to authenticated;
