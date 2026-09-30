interface NamedParticipant {
  id: string;
  name: string;
}

/** Prefixes all participants if any duplicate name exists, preventing collisions with labels such as "Alex (1)". */
export function participantLabels(participants: readonly NamedParticipant[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const participant of participants) {
    counts.set(participant.name, (counts.get(participant.name) ?? 0) + 1);
  }
  const hasDuplicates = [...counts.values()].some((count) => count > 1);
  return new Map(participants.map(({ id, name }, index) => [
    id,
    hasDuplicates ? `${index + 1}. ${name}` : name,
  ]));
}
