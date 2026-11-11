import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  notFoundHead,
  pageHeads,
  renderHead,
  renderNoscriptLinks,
  renderShell,
  structuredData,
} from '../../plugins/routeHtml.ts';
import type { ProjectSummary } from '../../src/lib/projects/types.ts';
import {
  PROJECT_FALLBACK_DESCRIPTION,
  routeDefinitions,
  SITE_NAME,
} from '../../src/lib/routeDefinitions.ts';
import { OWNER_NAME } from '../../src/lib/site.ts';

const ORIGIN = 'https://example.com';
const project = (slug: string, title: string, summary: string): ProjectSummary => ({
  slug,
  title,
  summary,
  tags: [],
  repo: '',
  demo: '',
});

describe('pageHeads', () => {
  const heads = pageHeads([project('one', 'One', 'First.'), project('two', 'Two', '')]);
  const byPath = (path: string) => heads.find((head) => head.path === path);

  test('uses each route definition’s meta', () => {
    assert.deepEqual(byPath('/about'), {
      path: '/about',
      canonicalPath: '/about',
      ...routeDefinitions.about.meta,
    });
  });

  test('expands project pages from their front matter, with a fallback description', () => {
    assert.deepEqual(byPath('/projects/one'), {
      path: '/projects/one',
      canonicalPath: '/projects/one',
      title: 'One',
      description: 'First.',
    });
    assert.equal(byPath('/projects/two')?.description, PROJECT_FALLBACK_DESCRIPTION);
    assert.equal(byPath('/projects/:slug'), undefined);
  });
});

describe('renderHead', () => {
  test('escapes text and builds absolute URLs', () => {
    const head = renderHead(
      { path: '/x', canonicalPath: '/x', title: 'A "B" & <C>', description: 'd' },
      ORIGIN,
    );
    assert.match(head, /<title>A &quot;B&quot; &amp; &lt;C&gt; · /);
    assert.match(head, /<link rel="canonical" href="https:\/\/example.com\/x" data-static-meta/);
    assert.match(head, /property="og:url" content="https:\/\/example.com\/x"/);
    assert.match(head, /property="og:image" content="https:\/\/example.com\/og-image.png"/);
  });

  test('uses the site name when the page has no title', () => {
    const head = renderHead({ path: '/', canonicalPath: '/', description: 'd' }, ORIGIN);
    assert.ok(head.includes(`<title>${SITE_NAME}</title>`));
    assert.ok(head.includes(`property="og:title" content="${SITE_NAME}"`));
  });

  test('gives the 404 page no canonical URL', () => {
    const head = renderHead(notFoundHead, ORIGIN);
    assert.doesNotMatch(head, /canonical|og:url/);
  });

  test('adds structured data to the home page only', () => {
    const home = renderHead({ path: '/', canonicalPath: '/', description: 'd' }, ORIGIN);
    assert.ok(home.includes(structuredData(ORIGIN)));
    const about = renderHead({ path: '/about', canonicalPath: '/about', description: 'd' }, ORIGIN);
    assert.doesNotMatch(about, /ld\+json/);
    assert.doesNotMatch(renderHead(notFoundHead, ORIGIN), /ld\+json/);
  });
});

describe('structuredData', () => {
  const block = structuredData('https://example.com/</script>');
  const json = block.slice(block.indexOf('>') + 1, block.lastIndexOf('<'));

  test('describes the site and its owner', () => {
    const graph = JSON.parse(json)['@graph'];
    const person = graph.find((node: { '@type': string }) => node['@type'] === 'Person');
    assert.equal(person.name, OWNER_NAME);
    assert.ok(person.sameAs.length > 0);
  });

  test('cannot close its own script tag', () => {
    assert.doesNotMatch(json, /</);
  });
});

describe('renderShell', () => {
  const shell = '<head><!-- route-head --></head><ul><!-- noscript-links --></ul>';

  test('fills in both markers', () => {
    const html = renderShell(shell, notFoundHead, ORIGIN);
    assert.doesNotMatch(html, /<!-- (route-head|noscript-links) -->/);
    assert.ok(html.includes(renderNoscriptLinks()));
  });

  test('fails when a marker is missing', () => {
    assert.throws(
      () => renderShell('<head></head>', notFoundHead, ORIGIN),
      /missing <!-- route-head -->/,
    );
  });

  test('lists parameterless pages other than home in the noscript links', () => {
    const links = renderNoscriptLinks();
    assert.ok(links.includes('<a href="/projects">Projects</a>'));
    assert.doesNotMatch(links, /href="\/"|:slug/);
  });
});
