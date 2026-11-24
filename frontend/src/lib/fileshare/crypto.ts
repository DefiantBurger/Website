// File Share's browser-side encryption (format v1): the server only ever sees a lookup
// token, ciphertext, and each file's salt and encrypted name. See UTILITIES.md#file-share.

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

// Whoever downloads has only the key, so the lookup can't use a random salt.
const KDF_SALT = encoder.encode('josephcicalese.com/fileshare/v1');
// OWASP's recommendation for PBKDF2-HMAC-SHA256, the only slow KDF WebCrypto offers.
export const KDF_ITERATIONS = 600_000;
export const CHUNK_BYTES = 1024 * 1024;
const TAG_BYTES = 16;
const SALT_BYTES = 16;
export const MAX_FILENAME_BYTES = 255;
// A length byte plus the longest name, so every encrypted name is the same size.
const PADDED_NAME_BYTES = 1 + MAX_FILENAME_BYTES;

/** A derived access key: `token` finds the files on the server; `master` never leaves the browser. */
export interface FileShareKey {
  token: string;
  master: CryptoKey;
}

export interface EncryptedFile {
  body: Blob;
  salt: string;
  encryptedName: string;
}

/** Decryption failed: the file or its name was corrupted or tampered with. */
export class IntegrityError extends Error {
  constructor() {
    super('The file failed its integrity check; it may be corrupted or tampered with.');
  }
}

function subtle(): SubtleCrypto {
  // Missing outside a secure context, e.g. the dev server opened by LAN IP over HTTP.
  if (!globalThis.crypto?.subtle) {
    throw new Error('File Share needs a secure (HTTPS) connection to encrypt files.');
  }
  return globalThis.crypto.subtle;
}

/** Trimmed and NFC-normalized, so a key typed on different devices derives the same token. */
export function normalizeAccessKey(accessKey: string): string {
  return accessKey.trim().normalize('NFC');
}

export async function deriveKey(
  accessKey: string,
  iterations = KDF_ITERATIONS,
): Promise<FileShareKey> {
  const password = await subtle().importKey(
    'raw',
    encoder.encode(normalizeAccessKey(accessKey)),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: KDF_SALT, iterations },
    password,
    256,
  );
  const master = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const token = await subtle().deriveBits(hkdf(new Uint8Array(), 'lookup'), master, 256);
  return { token: toBase64Url(new Uint8Array(token)), master };
}

function hkdf(salt: Uint8Array<ArrayBuffer>, info: string): HkdfParams {
  return { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(info) };
}

/** Separate content and name keys, unique to the file through its random salt. */
async function fileKeys(master: CryptoKey, salt: Uint8Array<ArrayBuffer>) {
  const derive = (info: string) =>
    subtle().deriveKey(hkdf(salt, info), master, { name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
  return { content: await derive('content'), name: await derive('name') };
}

// A counter suffices since each file has its own key. The last-chunk flag makes truncated
// or extended payloads fail to decrypt.
function chunkNonce(index: number, last: boolean): Uint8Array<ArrayBuffer> {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setBigUint64(3, BigInt(index));
  nonce[11] = last ? 1 : 0;
  return nonce;
}

/** [start, end) of each chunk; an empty blob still has one (empty, last) chunk. */
function chunkRanges(size: number, chunkBytes: number): [number, number][] {
  const count = Math.max(1, Math.ceil(size / chunkBytes));
  return Array.from({ length: count }, (_, i) => [
    i * chunkBytes,
    Math.min(size, (i + 1) * chunkBytes),
  ]);
}

/** The encrypted size of `plaintextBytes`; the backend checks uploads against the same formula. */
export function encryptedSize(plaintextBytes: number, chunkBytes = CHUNK_BYTES): number {
  return plaintextBytes + chunkRanges(plaintextBytes, chunkBytes).length * TAG_BYTES;
}

/** Encrypt `data` and `filename` for upload. Reads the whole file, so the body is in memory. */
export async function encryptFile(
  key: FileShareKey,
  data: Blob,
  filename: string,
  chunkBytes = CHUNK_BYTES,
): Promise<EncryptedFile> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const keys = await fileKeys(key.master, salt);
  const ranges = chunkRanges(data.size, chunkBytes);
  const parts: ArrayBuffer[] = [];
  for (const [index, [start, end]] of ranges.entries()) {
    const chunk = await data.slice(start, end).arrayBuffer();
    const iv = chunkNonce(index, index === ranges.length - 1);
    parts.push(await subtle().encrypt({ name: 'AES-GCM', iv }, keys.content, chunk));
  }

  const nameBytes = encoder.encode(cleanFilename(filename));
  const padded = new Uint8Array(PADDED_NAME_BYTES);
  padded[0] = nameBytes.length;
  padded.set(nameBytes, 1);
  // The name key encrypts only this, so a fixed nonce is safe.
  const name = await subtle().encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(12) },
    keys.name,
    padded,
  );

  return {
    body: new Blob(parts),
    salt: toBase64Url(salt),
    encryptedName: toBase64Url(new Uint8Array(name)),
  };
}

export async function decryptName(
  key: FileShareKey,
  salt: string,
  encryptedName: string,
): Promise<string> {
  try {
    const keys = await fileKeys(key.master, fromBase64Url(salt));
    const padded = new Uint8Array(
      await subtle().decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(12) },
        keys.name,
        fromBase64Url(encryptedName),
      ),
    );
    // Cleaned again: the uploader's browser might not have run this code.
    return cleanFilename(decoder.decode(padded.subarray(1, 1 + padded[0])));
  } catch {
    throw new IntegrityError();
  }
}

export async function decryptFile(
  key: FileShareKey,
  salt: string,
  body: Blob,
  chunkBytes = CHUNK_BYTES,
): Promise<Blob> {
  try {
    const keys = await fileKeys(key.master, fromBase64Url(salt));
    const ranges = chunkRanges(body.size, chunkBytes + TAG_BYTES);
    const parts: ArrayBuffer[] = [];
    for (const [index, [start, end]] of ranges.entries()) {
      const chunk = await body.slice(start, end).arrayBuffer();
      const iv = chunkNonce(index, index === ranges.length - 1);
      parts.push(await subtle().decrypt({ name: 'AES-GCM', iv }, keys.content, chunk));
    }
    return new Blob(parts);
  } catch {
    throw new IntegrityError();
  }
}

/** Python's os.path.splitext: the last dot starts the extension, unless only dots precede it. */
function splitExtension(name: string): [stem: string, ext: string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || /^\.+$/.test(name.slice(0, dot))) {
    return [name, ''];
  }
  return [name.slice(0, dot), name.slice(dot)];
}

function truncateUtf8(text: string, maxBytes: number): string {
  let out = '';
  let used = 0;
  for (const char of text) {
    used += encoder.encode(char).length;
    if (used > maxBytes) {
      break;
    }
    out += char;
  }
  return out;
}

/** A filename safe to show and save: Unicode stays, while directories and control and
 * format characters go, and it's capped at MAX_FILENAME_BYTES of UTF-8. */
export function cleanFilename(filename: string): string {
  const base = filename.replaceAll('\\', '/').split('/').at(-1) ?? '';
  // Category C includes bidi overrides, which can disguise a file's real extension.
  const name = base.replace(/\p{C}/gu, '').trim();
  let [stem, ext] = splitExtension(name);
  // Trim the stem, not the extension, so the file still opens with the right app.
  let room = MAX_FILENAME_BYTES - encoder.encode(ext).length;
  if (room <= 0) {
    [stem, ext, room] = [name, '', MAX_FILENAME_BYTES];
  }
  return (truncateUtf8(stem, room) + ext).trim() || 'download';
}

function toBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
