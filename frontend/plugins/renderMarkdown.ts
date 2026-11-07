import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { MarkdownRenderDebug } from '../src/lib/projects/types.ts';

// Just the hast fields this plugin reads; @types/hast is only a transitive dependency.
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

/** Replace ```mermaid code blocks with <div class="mermaid"> so Mermaid can render them after mount. */
function rehypeMermaid(counter: { transformed: number }) {
  return function transformer(tree: HastNode) {
    visit(
      tree,
      'element',
      (node: HastNode, index: number | undefined, parent: HastNode | undefined) => {
        if (!parent?.children || index === undefined) {
          return;
        }

        if (node.tagName !== 'pre') {
          return;
        }

        const code = node.children?.[0];
        if (!code || code.tagName !== 'code') {
          return;
        }

        const classNames = code.properties?.className ?? [];
        const hasMermaidClass = Array.isArray(classNames)
          ? classNames.includes('language-mermaid')
          : classNames === 'language-mermaid';

        if (!hasMermaidClass) {
          return;
        }

        const codeText = (code.children ?? [])
          .map((child) => (child.type === 'text' ? child.value : ''))
          .join('')
          .trim();

        parent.children[index] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['mermaid'] },
          children: [{ type: 'text', value: codeText }],
        };

        counter.transformed += 1;
      },
    );
  };
}

// Default GitHub-style schema, plus the Mermaid div and language classes on code blocks.
const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'div'],
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'mermaid']],
    code: [...(defaultSchema.attributes?.code ?? []), ['className']],
    pre: [...(defaultSchema.attributes?.pre ?? []), ['className']],
  },
};

export async function renderProjectMarkdownWithDebug(
  markdown: string,
): Promise<{ html: string; debug: MarkdownRenderDebug }> {
  const counter = { transformed: 0 };

  const rendered = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeMermaid, counter)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeSlug, { prefix: 'user-content-' }) // after sanitize so anchor hrefs match ids
    .use(rehypeAutolinkHeadings, {
      behavior: 'append',
      properties: {
        className: ['heading-anchor'],
        ariaLabel: 'Link to section',
      },
      content: {
        type: 'text',
        value: '#',
      },
    })
    .use(rehypeStringify)
    .process(markdown);

  const html = String(rendered);
  return {
    html,
    debug: {
      markdownLength: markdown.length,
      inputHasMermaidFence: /```\s*mermaid\b/.test(markdown),
      transformedMermaidBlocks: counter.transformed,
      outputHasMermaidDiv: /class="mermaid"/.test(html),
      outputHasMermaidCodeFence: /language-mermaid/.test(html),
      htmlLength: html.length,
    },
  };
}
