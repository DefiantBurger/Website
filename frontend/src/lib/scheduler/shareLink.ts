// Plans stored in the URL fragment (`#plan=v1.<base64url(deflate-raw(JSON))>`), so a link
// can be shared or bookmarked. The fragment never reaches the server.
import { parseScheduleFile } from './catalog';
import type { ScheduleFile } from './types';

const PLAN_PARAM = 'plan';
const VERSION_PREFIX = 'v1.';
// Real plans are about 1 KB of JSON; the cap stops a short link from inflating into gigabytes.
export const MAX_PLAN_BYTES = 256 * 1024;

export async function encodePlan(file: ScheduleFile): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(file));
  const compressed = await readAll(
    streamOf(json).pipeThrough(new CompressionStream('deflate-raw')),
    Infinity,
  );
  return VERSION_PREFIX + toBase64Url(compressed);
}

/** Inverse of `encodePlan`; throws a user-facing message for anything unreadable. */
export async function decodePlan(encoded: string): Promise<ScheduleFile> {
  if (!encoded.startsWith(VERSION_PREFIX)) {
    throw new Error('This plan link uses an unknown format.');
  }

  let value: unknown;
  try {
    const compressed = fromBase64Url(encoded.slice(VERSION_PREFIX.length));
    const json = await readAll(
      streamOf(compressed).pipeThrough(new DecompressionStream('deflate-raw')),
      MAX_PLAN_BYTES,
    );
    value = JSON.parse(new TextDecoder().decode(json));
  } catch {
    throw new Error('This plan link is damaged or incomplete.');
  }
  return parseScheduleFile(value);
}

/** The encoded plan in a location hash, or null when there isn't one. */
export function planFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get(PLAN_PARAM) || null;
}

export function planHash(encoded: string): string {
  return `#${PLAN_PARAM}=${encoded}`;
}

function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<ArrayBufferView<ArrayBuffer>> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Plan is too large.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// btoa/atob instead of Uint8Array.toBase64, which older Safari and Firefox lack.
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) {
    throw new Error('Not base64url.');
  }
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
