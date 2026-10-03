import {
  applyOwnerAction, claimParticipant, createSharedBill, fetchSharedBill, joinSharedBill,
  parseSharedBillFragment, setSharedParticipation, sharedBillAvailable, subscribeToSharedBill,
  type SharedBillCreateResponse, type SharedBillJoinResponse,
} from "@/lib/supabase/sharedBill";
import type { SessionAction } from "@/lib/billState";
import type { SplitSession } from "@/types/bill";
export { sharedErrorMessage } from "@/lib/sharedErrorMessage";

export type SharedOpen = SharedBillJoinResponse;
export type SharedCreated = SharedBillCreateResponse;

export function sharingIsAvailable(): boolean { return sharedBillAvailable(); }
export function parseShareFragment(hash: string) { return parseSharedBillFragment(hash); }
export function openSharedBill(publicId: string, token: string, mode?: "friend" | "owner"): Promise<SharedOpen> {
  return joinSharedBill(publicId, token, mode);
}
export function createSharedSession(session: SplitSession): Promise<SharedCreated> { return createSharedBill(session); }
export async function refreshSharedBill(billId: string): Promise<SplitSession> { return (await fetchSharedBill(billId)).snapshot; }
export async function claimSharedParticipant(billId: string, participantId: string): Promise<SplitSession> { return (await claimParticipant(billId, participantId)).snapshot; }
export function toggleSharedParticipation(billId: string, receiptId: string, itemId: string, selected: boolean, expectedRevision: number): Promise<SplitSession> {
  return setSharedParticipation(billId, receiptId, itemId, selected, expectedRevision);
}
export function saveSharedOwnerAction(billId: string, revision: number, action: SessionAction): Promise<SplitSession> {
  return applyOwnerAction(billId, revision, action);
}
export function subscribeSharedBill(billId: string, onChange: () => void, onError?: (error: unknown) => void, onStatus?: (status: string) => void): Promise<() => Promise<void>> {
  return subscribeToSharedBill(billId, onChange, onError, onStatus);
}
