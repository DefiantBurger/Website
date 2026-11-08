import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { describe, test } from 'node:test';

import {
  MAX_PLAN_BYTES,
  decodePlan,
  encodePlan,
  planFromHash,
  planHash,
} from '../../src/lib/scheduler/shareLink.ts';

const toBase64Url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');

describe('encodePlan / decodePlan', () => {
  const file = {
    semesters: {
      precollege: ['MATH 221', 'E C E 210'],
      fall24: ['MATH 222', 'PHYSICS 499[3]'],
      spring25: [],
    },
  };

  test('round-trips a plan through a URL-safe, versioned string', async () => {
    const encoded = await encodePlan(file);
    assert.match(encoded, /^v1\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(await decodePlan(encoded), file);
  });

  test('round-trips through a location hash', async () => {
    const encoded = await encodePlan(file);
    assert.equal(planFromHash(planHash(encoded)), encoded);
    assert.equal(planFromHash(''), null);
    assert.equal(planFromHash('#other=1'), null);
    assert.equal(planFromHash('#plan='), null);
  });

  test('rejects unknown versions and damaged data', async () => {
    const encoded = await encodePlan(file);
    await assert.rejects(decodePlan(encoded.replace('v1.', 'v2.')), /unknown format/);
    await assert.rejects(decodePlan('v1.not*base64'), /damaged/);
    await assert.rejects(decodePlan(encoded.slice(0, -6)), /damaged/);
    await assert.rejects(decodePlan(`v1.${toBase64Url(deflateRawSync('{nope'))}`), /damaged/);
  });

  test('rejects valid JSON with the wrong shape', async () => {
    const encoded = `v1.${toBase64Url(deflateRawSync(JSON.stringify({ semesters: { fall24: 'x' } })))}`;
    await assert.rejects(decodePlan(encoded), /list of course codes/);
  });

  test('refuses to inflate past the size cap', async () => {
    const bomb = deflateRawSync(Buffer.alloc(MAX_PLAN_BYTES * 4, 0x20));
    await assert.rejects(decodePlan(`v1.${toBase64Url(bomb)}`), /damaged/);
  });
});
