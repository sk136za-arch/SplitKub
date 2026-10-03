import type { RealtimeChannel } from "@supabase/supabase-js";
import type { SplitSession } from "../../types/bill";
import { sessionReducer, type SessionAction } from "../billState";
import { isSplitSession } from "../storage";
import { normalizeRemoteSessionSnapshot } from "../sharedSnapshot";
import { getSharedBillClient, sharedBillAvailable as clientIsConfigured } from "./client";

export interface SharedBillSnapshot {
  publicId: string;
  billId: string;
  snapshot: SplitSession;
}

export interface SharedBillCreateResponse extends SharedBillSnapshot {
  friendToken: string;
  ownerToken: string;
}

export interface SharedBillJoinResponse extends SharedBillSnapshot {
  role: "owner" | "friend";
}

export type SharedBillErrorCode =
  | "disabled" | "not_configured" | "auth_required" | "invalid_token" | "unavailable"
  | "revision_conflict" | "participant_claimed" | "participant_not_claimed" | "owner_cannot_claim"
  | "item_not_in_receipt" | "validation" | "migration_required" | "rate_limited" | "network" | "unknown";

export class SharedBillError extends Error {
  constructor(readonly code: SharedBillErrorCode, message: string) {
    super(message);
    this.name = "SharedBillError";
  }
}

export function mapSharedBillError(error: unknown): SharedBillError {
  if (error instanceof SharedBillError) return error;
  const candidate = (error && typeof error === "object" ? error : {}) as {
    code?: unknown; message?: unknown; status?: unknown;
  };
  const code = typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
  const message = typeof candidate.message === "string" ? candidate.message.toUpperCase() : "";
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const matched = (needle: string) => code === needle || message.includes(needle);

  if (matched("SHARED_BILLS_DISABLED")) return new SharedBillError("disabled", "Shared bills are disabled.");
  if (matched("SUPABASE_NOT_CONFIGURED")) return new SharedBillError("not_configured", "Shared bills are not configured.");
  if (matched("MIGRATION_REQUIRED") || code === "PGRST202" || code === "42883" || message.includes("COULD NOT FIND THE FUNCTION")) {
    return new SharedBillError("migration_required", "Apply the latest shared-bill database migration before using collector mode.");
  }
  if (matched("REVISION_CONFLICT") || code === "40001") return new SharedBillError("revision_conflict", "This bill changed elsewhere. Refresh it and try again.");
  if (matched("INVALID_TOKEN")) return new SharedBillError("invalid_token", "This share link is invalid.");
  if (matched("SHARED_BILL_UNAVAILABLE") || matched("PARTICIPANT_NOT_FOUND")) return new SharedBillError("unavailable", "This shared bill is unavailable or has expired.");
  if (matched("PARTICIPANT_ALREADY_CLAIMED")) return new SharedBillError("participant_claimed", "That participant has already been claimed.");
  if (matched("PARTICIPANT_NOT_CLAIMED")) return new SharedBillError("participant_not_claimed", "Claim your participant before changing your split.");
  if (matched("OWNER_CANNOT_CLAIM_PARTICIPANT")) return new SharedBillError("owner_cannot_claim", "The bill owner cannot claim a friend participant.");
  if (matched("ITEM_NOT_IN_RECEIPT")) return new SharedBillError("item_not_in_receipt", "That item does not belong to this receipt.");
  if (matched("VALIDATION_ERROR") || matched("CLAIMED_PARTICIPANT_CANNOT_BE_REMOVED") || ["23502", "23503", "23505", "23514"].includes(code)) return new SharedBillError("validation", "The shared bill data could not be saved.");
  if (matched("AUTH_REQUIRED") || status === 401 || status === 403) return new SharedBillError("auth_required", "A temporary anonymous session is required.");
  if (status === 429 || matched("OVER_REQUEST_RATE_LIMIT")) return new SharedBillError("rate_limited", "Too many requests. Please wait and try again.");
  if (error instanceof TypeError) return new SharedBillError("network", "The shared-bill service could not be reached.");
  return new SharedBillError("unknown", "The shared-bill action could not be completed.");
}

export async function createSharedBill(session: SplitSession): Promise<SharedBillCreateResponse> {
  assertSession(session);
  const client = getClient();
  await ensureAnonymousSession(client);
  if (session.settlementMode === "collector") await ensureSettlementRoutingSupported(client);
  const result = await callRpc(client, "create_shared_bill", { p_session: session });
  const created = assertCreated(result);
  if (session.settlementMode === "collector") assertCollectorPreserved(session, created.snapshot);
  return created;
}

export async function joinSharedBill(
  publicId: string,
  token: string,
  expectedRole?: "owner" | "friend",
): Promise<SharedBillJoinResponse> {
  const client = getClient();
  await ensureAnonymousSession(client);
  const result = assertJoined(await callRpc(client, "join_shared_bill", { p_public_id: publicId, p_token: token }));
  if (expectedRole && result.role !== expectedRole) throw new SharedBillError("invalid_token", "This share link is invalid.");
  return result;
}

export async function fetchSharedBill(billId: string): Promise<SharedBillSnapshot> {
  const client = getClient();
  await ensureAnonymousSession(client);
  return assertSnapshotEnvelope(await callRpc(client, "fetch_shared_bill", { p_bill_id: billId }));
}

export async function claimParticipant(
  billId: string,
  participantId: string,
): Promise<{ participantId: string; snapshot: SplitSession }> {
  const client = getClient();
  await ensureAnonymousSession(client);
  const result = await callRpc(client, "claim_participant", { p_bill_id: billId, p_participant_id: participantId });
  if (!isRecord(result) || typeof result.participantId !== "string") throw invalidResponse();
  return { participantId: result.participantId, snapshot: assertRemoteSession(result.snapshot) };
}

/** The receipt and item are separately scoped in SQL, so an ID from another receipt is rejected. */
export async function setSharedParticipation(
  billId: string,
  receiptId: string,
  itemId: string,
  selected: boolean,
  expectedRevision: number,
): Promise<SplitSession> {
  const client = getClient();
  await ensureAnonymousSession(client);
  const result = await callRpc(client, "set_shared_participation", {
    p_bill_id: billId,
    p_receipt_id: receiptId,
    p_item_id: itemId,
    p_selected: selected,
    p_expected_revision: expectedRevision,
  });
  return assertRemoteSession(result);
}

/** Applies the same reducer action as the local owner UI, then commits a revision-checked snapshot. */
export async function applyOwnerAction(
  billId: string,
  expectedRevision: number,
  action: SessionAction,
): Promise<SplitSession> {
  const client = getClient();
  await ensureAnonymousSession(client);
  const current = await fetchSharedBill(billId);
  if (current.snapshot.revision !== expectedRevision) {
    throw new SharedBillError("revision_conflict", "This bill changed elsewhere. Refresh it and try again.");
  }
  const updated = sessionReducer(current.snapshot, action);
  const session: SplitSession = { ...updated, id: current.snapshot.id, revision: expectedRevision, expiresAt: current.snapshot.expiresAt };
  assertSession(session);
  if (session.settlementMode === "collector") await ensureSettlementRoutingSupported(client);
  const saved = assertRemoteSession(await callRpc(client, "apply_owner_action", {
    p_bill_id: billId,
    p_expected_revision: expectedRevision,
    p_session: session,
  }));
  if (session.settlementMode === "collector") assertCollectorPreserved(session, saved);
  return saved;
}

export function buildSharedBillUrl(
  publicId: string,
  token: string,
  role: "friend" | "owner",
  origin: string,
): string {
  const url = new URL(`/b/${encodeURIComponent(publicId)}`, origin);
  url.hash = new URLSearchParams([[role === "owner" ? "owner" : "token", token]]).toString();
  return url.toString();
}

export function parseSharedBillFragment(hash: string): { role: "friend" | "owner"; token: string } | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const friendTokens = params.getAll("token");
  const ownerTokens = params.getAll("owner");
  if (friendTokens.length + ownerTokens.length !== 1) return null;
  const role = ownerTokens.length === 1 ? "owner" : "friend";
  const token = role === "owner" ? ownerTokens[0] : friendTokens[0];
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return { role, token };
}

export async function subscribeToSharedBill(
  billId: string,
  onChange: (revision: number) => void,
  onError?: (error: SharedBillError) => void,
  onStatus?: (status: string) => void,
): Promise<() => Promise<void>> {
  const client = getClient();
  await ensureAnonymousSession(client);
  const channel: RealtimeChannel = client
    .channel(`shared-bill:${billId}`, { config: { private: true } })
    .on("broadcast", { event: "shared_bill_changed" }, ({ payload }: { payload: { revision?: unknown } }) => {
      if (typeof payload?.revision === "number" && Number.isSafeInteger(payload.revision)) onChange(payload.revision);
    });
  try {
    await awaitRealtimeSubscribed((onState) => channel.subscribe(onState), (error) => {
      void client.removeChannel(channel);
      onError?.(error);
    }, onStatus);
  } catch (error) {
    await client.removeChannel(channel);
    throw error;
  }
  return async () => { await client.removeChannel(channel); };
}

/** Resolve only once the channel is actually subscribed; post-connect failures still reach onError. */
export function awaitRealtimeSubscribed(
  subscribe: (onState: (status: string) => void) => unknown,
  onError?: (error: SharedBillError) => void,
  onStatus?: (status: string) => void,
  timeoutMs = 12_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => fail("Live updates did not connect. Refresh the bill to get the latest changes."), timeoutMs);
    const fail = (reason: string) => {
      const error = new SharedBillError("unavailable", reason);
      try { onError?.(error); } catch { /* Status reporters must not suppress subscription cleanup. */ }
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    try {
      subscribe((status) => {
        try { onStatus?.(status); } catch { /* UI status callbacks are non-critical. */ }
        if (status === "SUBSCRIBED") {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          fail("Live updates are unavailable. Refresh the bill to get the latest changes.");
        }
      });
    } catch {
      fail("Live updates are unavailable. Refresh the bill to get the latest changes.");
    }
  });
}

export function sharedBillAvailable(): boolean {
  return clientIsConfigured();
}

async function ensureAnonymousSession(client: ReturnType<typeof getSharedBillClient>): Promise<void> {
  try {
    const current = await client.auth.getSession();
    if (current.error) throw current.error;
    if (current.data.session) return;
    const created = await client.auth.signInAnonymously();
    if (created.error) throw created.error;
  } catch (error) { throw mapSharedBillError(error); }
}

function getClient(): ReturnType<typeof getSharedBillClient> {
  try { return getSharedBillClient(); } catch (error) { throw mapSharedBillError(error); }
}

async function callRpc(client: ReturnType<typeof getSharedBillClient>, functionName: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await client.rpc(functionName, args);
    if (error) throw error;
    if (data === null) throw new Error("EMPTY_RESPONSE");
    return data;
  } catch (error) { throw mapSharedBillError(error); }
}

async function ensureSettlementRoutingSupported(client: ReturnType<typeof getSharedBillClient>): Promise<void> {
  const capabilities = await callRpc(client, "shared_bill_capabilities", {});
  if (!isRecord(capabilities) || typeof capabilities.settlementRoutingVersion !== "number" ||
      !Number.isSafeInteger(capabilities.settlementRoutingVersion) || capabilities.settlementRoutingVersion < 1) {
    throw new SharedBillError("migration_required", "Apply the latest shared-bill database migration before using collector mode.");
  }
}

function assertCollectorPreserved(requested: SplitSession, saved: SplitSession): void {
  if (saved.settlementMode !== "collector" || saved.collectorParticipantId !== requested.collectorParticipantId) {
    throw new SharedBillError("migration_required", "The shared-bill service did not preserve collector mode. Apply the latest database migration.");
  }
}

function assertCreated(value: unknown): SharedBillCreateResponse {
  if (!isRecord(value) || typeof value.publicId !== "string" || typeof value.billId !== "string" ||
      typeof value.friendToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.friendToken) ||
      typeof value.ownerToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value.ownerToken)) throw invalidResponse();
  return { publicId: value.publicId, billId: value.billId, friendToken: value.friendToken,
    ownerToken: value.ownerToken, snapshot: assertRemoteSession(value.snapshot) };
}

function assertJoined(value: unknown): SharedBillJoinResponse {
  if (!isRecord(value) || typeof value.publicId !== "string" || typeof value.billId !== "string" ||
      (value.role !== "owner" && value.role !== "friend")) throw invalidResponse();
  return { publicId: value.publicId, billId: value.billId, role: value.role, snapshot: assertRemoteSession(value.snapshot) };
}

function assertSnapshotEnvelope(value: unknown): SharedBillSnapshot {
  if (!isRecord(value) || typeof value.publicId !== "string" || typeof value.billId !== "string") throw invalidResponse();
  return { publicId: value.publicId, billId: value.billId, snapshot: assertRemoteSession(value.snapshot) };
}

function assertSession(session: unknown): SplitSession {
  if (!isSplitSession(session)) throw invalidResponse();
  return session;
}

function assertRemoteSession(session: unknown): SplitSession {
  const normalized = normalizeRemoteSessionSnapshot(session);
  if (!normalized) throw invalidResponse();
  return normalized;
}

function invalidResponse(): SharedBillError {
  return new SharedBillError("unknown", "The shared-bill service returned invalid data.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
