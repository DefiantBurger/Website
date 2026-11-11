import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { fillTemplate } from '../../plugins/generatedFiles.ts';

const template = (text: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'site-files-')), 'file.txt');
  writeFileSync(file, text);
  return file;
};

describe('fillTemplate', () => {
  test('replaces every placeholder', () => {
    const file = template('a %SITE_ORIGIN%/x\nb %SITE_ORIGIN% %EMAIL%\n');
    assert.equal(
      fillTemplate(file, { SITE_ORIGIN: 'https://example.com', EMAIL: 'me@example.com' }),
      'a https://example.com/x\nb https://example.com me@example.com\n',
    );
  });

  test('fails on an unknown placeholder', () => {
    assert.throws(() => fillTemplate(template('%NOPE%'), {}), /unknown placeholder %NOPE%/);
  });

  test('leaves lone percent signs alone', () => {
    assert.equal(fillTemplate(template('100% sure'), {}), '100% sure');
  });
});
