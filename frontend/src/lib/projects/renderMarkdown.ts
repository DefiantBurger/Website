import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';

export interface MarkdownRenderDebug {
  inputHasMermaidFence: boolean;
  transformedMermaidBlocks: number;
  outputHasMermaidDiv: boolean;
  outputHasMermaidCodeFence: boolean;
  htmlLength: number;
}

function rehypeMermaid(counter: { transformed: number }) {
  return function transformer(tree: any) {
    visit(tree, 'element', (node: any, index: number | undefined, parent: any) => {
      if (!parent || index === undefined) {
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
        .map((child: any) => (child.type === 'text' ? child.value : ''))
        .join('')
        .trim();

      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['mermaid'] },
        children: [{ type: 'text', value: codeText }]
      };

      counter.transformed += 1;
    });
  };
}

const sanitizeSchema: any = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'div'],
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'mermaid']],
    code: [...(defaultSchema.attributes?.code ?? []), ['className']],
    pre: [...(defaultSchema.attributes?.pre ?? []), ['className']]
  }
};

export async function renderProjectMarkdown(markdown: string): Promise<string> {
  const { html } = await renderProjectMarkdownWithDebug(markdown);
  return html;
}

export async function renderProjectMarkdownWithDebug(
  markdown: string
): Promise<{ html: string; debug: MarkdownRenderDebug }> {
  const counter = { transformed: 0 };

  const rendered = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: 'append',
      properties: {
        className: ['heading-anchor'],
        ariaLabel: 'Link to section'
      },
      content: {
        type: 'text',
        value: ' #'
      }
    })
    .use(rehypeMermaid, counter)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify)
    .process(markdown);

  const html = String(rendered);
  return {
    html,
    debug: {
      inputHasMermaidFence: /```\s*mermaid\b/.test(markdown),
      transformedMermaidBlocks: counter.transformed,
      outputHasMermaidDiv: /class="mermaid"/.test(html),
      outputHasMermaidCodeFence: /language-mermaid/.test(html),
      htmlLength: html.length
    }
  };
}
