import { createClientId } from "./id";

export const GROUPS_KEY = "splitkub:groups:v1";
export interface FriendGroup { id: string; name: string; members: string[]; createdAt: string; updatedAt: string }
interface Envelope { version: 1; groups: FriendGroup[] }

function valid(value: unknown): value is FriendGroup {
  if (!value || typeof value !== "object") return false; const group = value as FriendGroup;
  return typeof group.id === "string" && Boolean(group.id) && typeof group.name === "string" && Boolean(group.name.trim()) &&
    Array.isArray(group.members) && group.members.every((member) => typeof member === "string" && Boolean(member.trim())) &&
    typeof group.createdAt === "string" && typeof group.updatedAt === "string";
}
function ordered(groups: FriendGroup[]) { return [...groups].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function loadGroups(storage: Pick<Storage, "getItem">): FriendGroup[] { try { const parsed = JSON.parse(storage.getItem(GROUPS_KEY) ?? "") as Partial<Envelope>; return parsed.version === 1 && Array.isArray(parsed.groups) && parsed.groups.every(valid) ? ordered(parsed.groups) : []; } catch { return []; } }
export function saveGroups(storage: Pick<Storage, "setItem">, groups: FriendGroup[]) { storage.setItem(GROUPS_KEY, JSON.stringify({ version: 1, groups: ordered(groups) } satisfies Envelope)); }
export function createGroup(storage: Pick<Storage, "getItem" | "setItem">, name: string, members: string[]): FriendGroup {
  const now = new Date().toISOString(); const group = { id: createClientId(), name: name.trim(), members: unique(members), createdAt: now, updatedAt: now }; saveGroups(storage, [group, ...loadGroups(storage)]); return group;
}
export function updateGroup(storage: Pick<Storage, "getItem" | "setItem">, id: string, name: string, members: string[]): FriendGroup | null { const groups = loadGroups(storage); const old = groups.find((group) => group.id === id); if (!old) return null; const next = { ...old, name: name.trim(), members: unique(members), updatedAt: new Date().toISOString() }; saveGroups(storage, groups.map((group) => group.id === id ? next : group)); return next; }
export function deleteGroup(storage: Pick<Storage, "getItem" | "setItem">, id: string) { const groups = loadGroups(storage); saveGroups(storage, groups.filter((group) => group.id !== id)); }
function unique(values: string[]) { return [...new Set(values.map((value) => value.trim()).filter(Boolean))]; }
