import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { routeDefinitions } from '../../src/lib/routeDefinitions.ts';
import { matchPattern, normalizePath } from '../../src/lib/routeMatching.ts';

describe('normalizePath', () => {
  test('strips query, hash, and trailing slashes', () => {
    assert.equal(normalizePath('/projects/?tag=x#top'), '/projects');
    assert.equal(normalizePath('/about///'), '/about');
  });

  test('collapses leading slashes so the path stays same-origin', () => {
    assert.equal(normalizePath('//evil.com/'), '/evil.com');
    assert.equal(normalizePath('///about'), '/about');
  });

  test('keeps the root path', () => {
    assert.equal(normalizePath('/'), '/');
    assert.equal(normalizePath('//'), '/');
    assert.equal(normalizePath('/?q=1'), '/');
  });
});

describe('matchPattern', () => {
  test('matches static paths exactly', () => {
    assert.deepEqual(matchPattern('/projects', '/projects'), {});
    assert.equal(matchPattern('/projects', '/projectsx'), null);
    assert.equal(matchPattern('/projects', '/projects/extra'), null);
  });

  test('captures and decodes params', () => {
    assert.deepEqual(matchPattern('/projects/:slug', '/projects/my%20site'), { slug: 'my site' });
  });

  test('rejects malformed escapes instead of throwing', () => {
    assert.equal(matchPattern('/projects/:slug', '/projects/%ZZ'), null);
  });
});

describe('routeDefinitions', () => {
  test('no two routes share a path or alias', () => {
    const patterns = Object.values(routeDefinitions).flatMap((definition) => [
      definition.path,
      ...(('aliases' in definition ? definition.aliases : undefined) ?? []),
    ]);
    assert.deepEqual(patterns.length, new Set(patterns).size);
  });

  test('every pattern is already in canonical form', () => {
    // The router normalizes the URL before matching, so a pattern with a
    // trailing slash or query could never match.
    for (const definition of Object.values(routeDefinitions)) {
      assert.equal(normalizePath(definition.path), definition.path);
    }
  });
});
