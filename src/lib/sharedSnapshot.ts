import type { SplitSession } from "../types/bill";
import { migrateV4Session } from "./storage";
import { addMissingReceiptAdjustments } from "./receiptAdjustments";

/** Old shared backends omit both routing fields; partial or malformed routing is not compatible. */
export function normalizeRemoteSessionSnapshot(value: unknown): SplitSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const hasMode = "settlementMode" in candidate;
  const hasCollector = "collectorParticipantId" in candidate;
  const normalized = !hasMode && !hasCollector
    ? { ...candidate, settlementMode: "direct", collectorParticipantId: "" }
    : candidate;
  const withAdjustments = addMissingReceiptAdjustments(normalized);
  return migrateV4Session(withAdjustments);
}

/** Remote reads may complete out of order; never replace a newer session revision with an older one. */
export function shouldApplyRemoteRevision(currentRevision: number, incomingRevision: number): boolean {
  return Number.isSafeInteger(incomingRevision) && incomingRevision >= currentRevision;
}
export function shouldApplyRemoteSnapshot(current: Pick<SplitSession, "revision" | "confirmationRevision">, incoming: Pick<SplitSession, "revision" | "confirmationRevision">): boolean {
  return Number.isSafeInteger(incoming.revision) && Number.isSafeInteger(incoming.confirmationRevision) &&
    (incoming.revision > current.revision ||
      (incoming.revision === current.revision && incoming.confirmationRevision >= current.confirmationRevision));
}

/** A friend refresh is private to the participant identity that initiated it. */
export function matchesRequestedParticipant(requestedParticipantId: string, currentParticipantId: string): boolean {
  return requestedParticipantId === currentParticipantId;
}
