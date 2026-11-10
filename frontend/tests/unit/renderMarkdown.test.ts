// Project write-ups are rendered to HTML and inserted with {@html}, so the
// sanitizer is the XSS boundary. These pin down what must never get through.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { renderProjectMarkdown } from '../../plugins/renderMarkdown.ts';

const render = renderProjectMarkdown;

describe('sanitization', () => {
  test('drops script tags', async () => {
    const html = await render('Hello\n\n<script>alert(1)</script>');
    assert.doesNotMatch(html, /<script/i);
  });

  test('drops inline event handlers', async () => {
    const html = await render('<img src="x" onerror="alert(1)">');
    assert.doesNotMatch(html, /onerror/i);
  });

  test('drops javascript: links', async () => {
    const html = await render('[click](javascript:alert(1))');
    assert.doesNotMatch(html, /javascript:/i);
  });

  test('only allows the mermaid class on divs', async () => {
    const html = await render('<div class="evil">x</div>');
    assert.doesNotMatch(html, /class="evil"/);
  });
});

describe('rendering', () => {
  test('adds a slugged id to headings', async () => {
    const html = await render('## Getting Started');
    // rehype-sanitize prefixes ids with `user-content-` to avoid DOM clobbering.
    assert.match(html, /<h2 id="user-content-getting-started">/);
  });

  test('heading anchor links to the heading and keeps its class', async () => {
    const html = await render('## Getting Started');
    const id = html.match(/<h2 id="([^"]+)"/)?.[1];
    assert.match(html, new RegExp(`<a[^>]*class="heading-anchor"[^>]*href="#${id}"`));
  });

  test('keeps language classes on code blocks', async () => {
    const html = await render('```python\nprint(1)\n```');
    assert.match(html, /class="language-python"/);
  });

  test('turns mermaid fences into mermaid divs', async () => {
    const html = await render('```mermaid\ngraph TD; A-->B\n```');
    assert.match(html, /<div class="mermaid">graph TD; A-->B<\/div>/);
    assert.doesNotMatch(html, /language-mermaid/);
  });

  test('supports GitHub-flavored tables', async () => {
    const html = await render('| a | b |\n| - | - |\n| 1 | 2 |');
    assert.match(html, /<table>/);
  });
});
