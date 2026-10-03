import type { SplitSession } from "../types/bill";
import { isSplitSession } from "./storage";

/** Old shared backends omit both routing fields; partial or malformed routing is not compatible. */
export function normalizeRemoteSessionSnapshot(value: unknown): SplitSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const hasMode = "settlementMode" in candidate;
  const hasCollector = "collectorParticipantId" in candidate;
  const normalized = !hasMode && !hasCollector
    ? { ...candidate, settlementMode: "direct", collectorParticipantId: "" }
    : candidate;
  return isSplitSession(normalized) ? normalized : null;
}

/** Remote reads may complete out of order; never replace a newer session revision with an older one. */
export function shouldApplyRemoteRevision(currentRevision: number, incomingRevision: number): boolean {
  return Number.isSafeInteger(incomingRevision) && incomingRevision >= currentRevision;
}
