import type { Participant } from "@/types/bill";

type SelectionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function friendSelectionKey(publicId: string): string {
  return `splitkub:friend:${publicId}`;
}

export function rememberFriendSelection(storage: SelectionStorage | null, publicId: string, participantId: string): void {
  try {
    if (participantId) storage?.setItem(friendSelectionKey(publicId), participantId);
    else storage?.removeItem(friendSelectionKey(publicId));
  } catch { /* Blocked or full storage must not break current-session selection. */ }
}

export function reconcileFriendSelection(
  storage: SelectionStorage | null,
  publicId: string,
  selectedId: string,
  participants: Pick<Participant, "id">[],
): string {
  if (!selectedId) return "";
  if (participants.some((person) => person.id === selectedId)) return selectedId;
  rememberFriendSelection(storage, publicId, "");
  return "";
}

export function readFriendSelection(
  storage: SelectionStorage | null,
  publicId: string,
  participants: Pick<Participant, "id">[],
): string {
  try { return reconcileFriendSelection(storage, publicId, storage?.getItem(friendSelectionKey(publicId)) ?? "", participants); }
  catch { return ""; }
}
