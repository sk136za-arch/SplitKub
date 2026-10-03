import { createClient } from "@supabase/supabase-js";

export type SharedBillConfiguration =
  | { available: true; url: string; publishableKey: string }
  | { available: false; reason: "disabled" | "not_configured" };

export function sharedBillConfiguration(
  enabled: boolean,
  url: string | undefined,
  publishableKey: string | undefined,
): SharedBillConfiguration {
  if (!enabled) return { available: false, reason: "disabled" };
  if (!url || !publishableKey || !isClientSafeKey(publishableKey)) {
    return { available: false, reason: "not_configured" };
  }
  try {
    const parsed = new URL(url);
    const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (!parsed.host || (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && localHost))) {
      return { available: false, reason: "not_configured" };
    }
  } catch {
    return { available: false, reason: "not_configured" };
  }
  return { available: true, url: url.replace(/\/$/, ""), publishableKey };
}

/** Accept a modern publishable key or a legacy JWT whose role is explicitly `anon`. */
export function isClientSafeKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (key.startsWith("sb_secret_") || key.split(".").length !== 3) return false;
  try {
    const payload = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="));
    const claims = JSON.parse(decoded) as { role?: unknown };
    return claims.role === "anon";
  } catch {
    return false;
  }
}

export function sharedBillAvailable(): boolean {
  return getConfiguration().available;
}

type SharedSupabaseClient = ReturnType<typeof createSharedClient>;

let client: SharedSupabaseClient | null = null;

export function getSharedBillClient(): SharedSupabaseClient {
  const configuration = getConfiguration();
  if (!configuration.available) {
    throw new Error(configuration.reason === "disabled" ? "SHARED_BILLS_DISABLED" : "SUPABASE_NOT_CONFIGURED");
  }
  if (!client) {
    client = createSharedClient(configuration.url, configuration.publishableKey);
  }
  return client;
}

function createSharedClient(url: string, publishableKey: string) {
  return createClient(url, publishableKey, {
    db: { schema: "api" },
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  });
}

function getConfiguration(): SharedBillConfiguration {
  return sharedBillConfiguration(
    process.env.NEXT_PUBLIC_SHARED_BILLS_ENABLED === "true",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
