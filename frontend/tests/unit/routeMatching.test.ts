import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  pathFor,
  routeDefinitions,
  routePatterns,
  staticRoutePaths,
} from '../../src/lib/routeDefinitions.ts';
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
    const patterns = Object.values(routeDefinitions).flatMap(routePatterns);
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

describe('pathFor', () => {
  test('returns static paths as-is', () => {
    assert.equal(pathFor('home'), '/');
    assert.equal(pathFor('messageBoard'), '/utilities/message-board');
  });

  test('fills and encodes params so the router decodes them back', () => {
    const path = pathFor('projectDetail', { slug: 'my site/v2' });
    assert.equal(path, '/projects/my%20site%2Fv2');
    assert.deepEqual(matchPattern(routeDefinitions.projectDetail.path, path), {
      slug: 'my site/v2',
    });
  });

  test('throws on a missing param', () => {
    // @ts-expect-error -- the type also requires the param
    assert.throws(() => pathFor('projectDetail'), /missing param 'slug'/);
  });
});

describe('route lists', () => {
  test('routePatterns puts the main path before aliases', () => {
    assert.deepEqual(routePatterns(routeDefinitions.messageBoard), [
      '/utilities/message-board',
      '/utilities/messageboard',
    ]);
  });

  test('staticRoutePaths skips param routes and aliases', () => {
    const paths = staticRoutePaths();
    assert.ok(paths.includes('/about'));
    assert.ok(!paths.some((path) => path.includes(':')));
    assert.ok(!paths.includes('/utilities/messageboard'));
  });
});
