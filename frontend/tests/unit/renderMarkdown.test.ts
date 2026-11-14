// Project write-ups are rendered to HTML and inserted with {@html}, so the
// sanitizer is the XSS boundary. These pin down what must never get through.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
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
    // Wrapped in a focusable scroll box so keyboard users can scroll a wide table.
    assert.match(
      html,
      /<div class="table-scroll" tabindex="0" role="region" aria-label="Table 1"><table>/,
    );
  });
});

describe('math', () => {
  test('renders inline and display LaTeX with KaTeX', async () => {
    const html = await render('Inline $E = mc^2$.\n\n$$\n\\psi = e^{ikx}\n$$');
    assert.match(html, /<span class="katex">/);
    // Focusable so keyboard users can scroll a wide equation.
    assert.match(
      html,
      /<span class="katex-display" tabindex="0" role="region" aria-label="Equation 1">/,
    );
    assert.doesNotMatch(html, /language-math/);
  });

  // The page loads our katex's CSS, but rehype-katex renders with its own katex.
  // Class names change between versions (0.19 renamed `.base`), so a mismatch breaks layout silently.
  test('the katex CSS matches the version that renders the HTML', () => {
    const require = createRequire(import.meta.url);
    const ours = require('katex/package.json') as { version: string };
    const fromRehype = createRequire(require.resolve('rehype-katex'));
    const theirs = fromRehype('katex/package.json') as { version: string };
    assert.equal(ours.version, theirs.version);
  });

  test('fails on invalid LaTeX instead of shipping an error box', async () => {
    await assert.rejects(render('$\\frac{1}{$'), /invalid LaTeX/);
  });

  // KaTeX runs after the sanitizer, so its own `trust: false` default is what blocks links.
  test('does not emit links from \\href', async () => {
    const html = await render('$\\href{javascript:alert(1)}{x}$');
    // The source survives as plain text in the MathML annotation; only a real link would matter.
    assert.doesNotMatch(html, /<a\b|href=/i);
  });
});

describe('demos', () => {
  test('turns a demo fence into a placeholder div', async () => {
    const html = await render('```demo\nwavepacket-2d\n```');
    assert.match(html, /<div class="project-demo" data-demo="wavepacket-2d">/);
    assert.doesNotMatch(html, /language-demo/);
  });

  test('fails the build on an unknown demo id', async () => {
    await assert.rejects(render('```demo\nnot-a-demo\n```'), /unknown demo/);
  });

  test('raw HTML cannot fake a demo placeholder', async () => {
    const html = await render('<div class="project-demo" data-demo="wavepacket-2d">x</div>');
    assert.doesNotMatch(html, /project-demo/);
  });
});
