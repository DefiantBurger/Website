// Project write-ups are rendered to HTML and inserted with {@html}, so the
// sanitizer is the XSS boundary. These pin down what must never get through.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { renderProjectMarkdownWithDebug } from '../../src/lib/projects/renderMarkdown.ts';

async function render(markdown: string): Promise<string> {
  return (await renderProjectMarkdownWithDebug(markdown)).html;
}

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

  // Fails today: see KNOWN-ISSUES.md (heading links). Drop `todo` once fixed.
  test('heading anchor links to the heading and keeps its class', { todo: 'KNOWN-ISSUES heading links' }, async () => {
    const html = await render('## Getting Started');
    const id = html.match(/<h2 id="([^"]+)"/)?.[1];
    assert.match(html, new RegExp(`<a[^>]*class="heading-anchor"[^>]*href="#${id}"`));
  });

  test('keeps language classes on code blocks', async () => {
    const html = await render('```python\nprint(1)\n```');
    assert.match(html, /class="language-python"/);
  });

  test('turns mermaid fences into mermaid divs', async () => {
    const { html, debug } = await renderProjectMarkdownWithDebug('```mermaid\ngraph TD; A-->B\n```');
    assert.match(html, /<div class="mermaid">graph TD; A-->B<\/div>/);
    assert.equal(debug.transformedMermaidBlocks, 1);
    assert.equal(debug.outputHasMermaidCodeFence, false);
  });

  test('supports GitHub-flavored tables', async () => {
    const html = await render('| a | b |\n| - | - |\n| 1 | 2 |');
    assert.match(html, /<table>/);
  });
});
