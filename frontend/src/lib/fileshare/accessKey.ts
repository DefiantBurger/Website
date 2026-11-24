// Six words from 1,295 give ~62 bits, millions of GPU-years against PBKDF2 at 600k iterations.
export const GENERATED_KEY_WORDS = 6;

/** A random access key of hyphen-separated words, e.g. `acorn-lunar-wager-fable-tulip-swoop`. */
export async function generateAccessKey(wordCount = GENERATED_KEY_WORDS): Promise<string> {
  // Loaded on demand so the list stays out of the main bundle.
  const { WORDS } = await import('./wordlist');
  return Array.from({ length: wordCount }, () => WORDS[randomIndex(WORDS.length)]).join('-');
}

/** Uniform in [0, n): values from the incomplete last block of n are redrawn, since `%` would favor low indices. */
function randomIndex(n: number): number {
  const limit = 2 ** 32 - (2 ** 32 % n);
  const value = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(value);
  } while (value[0] >= limit);
  return value[0] % n;
}
