let fallbackCounter = 0;

type CryptoSource = Pick<Crypto, "getRandomValues"> & {
  randomUUID?: () => `${string}-${string}-${string}-${string}-${string}`;
};

/** Creates client-only record IDs, including on mobile browsers served over local HTTP. */
export function createClientId(source: CryptoSource | null | undefined = globalThis.crypto): string {
  if (typeof source?.randomUUID === "function") return source.randomUUID();

  if (typeof source?.getRandomValues === "function") {
    const values = new Uint32Array(4);
    source.getRandomValues(values);
    return Array.from(values, (value) => value.toString(36).padStart(7, "0")).join("-");
  }

  fallbackCounter += 1;
  return `${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
