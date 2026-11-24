import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { GENERATED_KEY_WORDS, generateAccessKey } from '../../src/lib/fileshare/accessKey.ts';
import {
  IntegrityError,
  MAX_FILENAME_BYTES,
  cleanFilename,
  decryptFile,
  decryptName,
  deriveKey,
  encryptFile,
  encryptedSize,
  type FileShareKey,
} from '../../src/lib/fileshare/crypto.ts';
import { WORDS } from '../../src/lib/fileshare/wordlist.ts';

// Few iterations and 4-byte chunks keep the tests fast; the format is otherwise the real one.
const ITERATIONS = 1_000;
const CHUNK = 4;
const TAG = 16;

const keyFor = (accessKey: string) => deriveKey(accessKey, ITERATIONS);
const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
const random = (size: number) => crypto.getRandomValues(new Uint8Array(size));

async function encrypt(key: FileShareKey, data: Uint8Array<ArrayBuffer>, name = 'file.bin') {
  return encryptFile(key, new Blob([data]), name, CHUNK);
}

/** The encrypted body split into its chunks, for tampering with. */
async function chunks(body: Blob): Promise<Uint8Array[]> {
  const all = await bytes(body);
  const step = CHUNK + TAG;
  return Array.from({ length: Math.ceil(all.length / step) }, (_, i) =>
    all.subarray(i * step, (i + 1) * step),
  );
}

describe('deriveKey', () => {
  test('matches an independently computed token (PBKDF2 600k, then HKDF "lookup")', async () => {
    // From Python's hashlib.pbkdf2_hmac and a hand-written HKDF; freezes format v1.
    const { token } = await deriveKey('correct horse battery staple');
    assert.equal(token, 'GVcLF0aIeLPw7eqJzCPKIqI4xpOLZLfakLA9ePt6tck');
  });

  test('gives the 43-character token the backend expects', async () => {
    assert.match((await keyFor('a')).token, /^[A-Za-z0-9_-]{43}$/);
  });

  test('ignores surrounding whitespace and Unicode normalization, but not case', async () => {
    const token = (await keyFor('café')).token;
    assert.equal((await keyFor('  cafe\u0301 ')).token, token);
    assert.notEqual((await keyFor('Café')).token, token);
  });
});

describe('encryptFile / decryptFile', () => {
  for (const size of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK, 3 * CHUNK + 2]) {
    test(`round-trips ${size} bytes`, async () => {
      const key = await keyFor('key');
      const data = random(size);
      const encrypted = await encrypt(key, data);
      assert.equal(encrypted.body.size, encryptedSize(size, CHUNK));
      assert.deepEqual(
        await bytes(await decryptFile(key, encrypted.salt, encrypted.body, CHUNK)),
        data,
      );
    });
  }

  test('matches the backend: an empty file is one tag, an exact multiple adds no chunk', () => {
    assert.equal(encryptedSize(0, CHUNK), TAG);
    assert.equal(encryptedSize(CHUNK, CHUNK), CHUNK + TAG);
    assert.equal(encryptedSize(CHUNK + 1, CHUNK), CHUNK + 1 + 2 * TAG);
  });

  test('gives each file its own salt and key, so equal files encrypt differently', async () => {
    const key = await keyFor('key');
    const data = random(10);
    const [a, b] = [await encrypt(key, data), await encrypt(key, data)];
    assert.notEqual(a.salt, b.salt);
    assert.notDeepEqual(await bytes(a.body), await bytes(b.body));
    // A file decrypted under another file's salt fails.
    await assert.rejects(decryptFile(key, b.salt, a.body, CHUNK), IntegrityError);
  });

  test('fails with the wrong key', async () => {
    const encrypted = await encrypt(await keyFor('right'), random(10));
    await assert.rejects(
      decryptFile(await keyFor('wrong'), encrypted.salt, encrypted.body, CHUNK),
      IntegrityError,
    );
  });

  const tamperings: [string, (c: Uint8Array[]) => Uint8Array[]][] = [
    ['dropped last chunk', (c) => c.slice(0, -1)],
    ['appended chunk', (c) => [...c, c.at(-1)!]],
    ['swapped chunks', (c) => [c[1], c[0], c[2]]],
    ['truncated mid-chunk', (c) => [...c.slice(0, -1), c.at(-1)!.subarray(0, -1)]],
    ['flipped bit', (c) => [c[0].map((byte, i) => (i === 0 ? byte ^ 1 : byte)), ...c.slice(1)]],
    ['emptied', () => []],
  ];
  for (const [label, tamper] of tamperings) {
    test(`fails when the payload is ${label}`, async () => {
      const key = await keyFor('key');
      const encrypted = await encrypt(key, random(10));
      const parts = await chunks(encrypted.body);
      assert.equal(parts.length, 3);
      const body = new Blob(tamper(parts).map((part) => new Uint8Array(part)));
      await assert.rejects(decryptFile(key, encrypted.salt, body, CHUNK), IntegrityError);
    });
  }
});

describe('encrypted names', () => {
  test('round-trip, cleaned, with the fixed length the backend expects', async () => {
    const key = await keyFor('key');
    for (const name of [
      'a.txt',
      'résumé 日本.pdf',
      '日'.repeat(200) + '.pdf',
      '../x\u202eexe.txt',
    ]) {
      const { salt, encryptedName } = await encrypt(key, random(1), name);
      assert.equal(salt.length, 22);
      assert.match(encryptedName, /^[A-Za-z0-9_-]{363}$/);
      assert.equal(await decryptName(key, salt, encryptedName), cleanFilename(name));
    }
  });

  test('fail with the wrong key or when tampered with', async () => {
    const key = await keyFor('key');
    const { salt, encryptedName } = await encrypt(key, random(1));
    await assert.rejects(decryptName(await keyFor('other'), salt, encryptedName), IntegrityError);
    const flipped = (encryptedName[0] === 'A' ? 'B' : 'A') + encryptedName.slice(1);
    await assert.rejects(decryptName(key, salt, flipped), IntegrityError);
  });
});

describe('cleanFilename', () => {
  // The cases the backend used to run when it cleaned names.
  const cases: [string, string][] = [
    ['test.pdf', 'test.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\report.pdf', 'report.pdf'],
    ['   ', 'download'],
    ['///', 'download'],
    ['café résumé.pdf', 'café résumé.pdf'],
    ['日本語.pdf', '日本語.pdf'],
    // Control characters and a right-to-left override that would show "exe.txt".
    ['a\x00b\r\n\u202etxt.exe', 'abtxt.exe'],
    ['.bashrc', '.bashrc'],
  ];
  for (const [raw, expected] of cases) {
    test(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(cleanFilename(raw), expected);
    });
  }

  test('caps bytes but keeps the extension, cutting only whole characters', () => {
    const cleaned = cleanFilename('日'.repeat(200) + '.pdf');
    assert.equal(cleaned, '日'.repeat(83) + '.pdf');
    assert.equal(
      new TextEncoder().encode(cleanFilename('x.' + 'y'.repeat(400))).length,
      MAX_FILENAME_BYTES,
    );
  });
});

describe('generateAccessKey', () => {
  test('joins random words from a 1,295-word list of plain lowercase words', async () => {
    assert.equal(new Set(WORDS).size, 1295);
    assert.equal(WORDS.length, 1295);
    assert.ok(WORDS.every((word) => /^[a-z]+$/.test(word)));

    const key = await generateAccessKey();
    const words = key.split('-');
    assert.equal(words.length, GENERATED_KEY_WORDS);
    assert.ok(words.every((word) => WORDS.includes(word)));
    assert.notEqual(await generateAccessKey(), key);
  });
});
