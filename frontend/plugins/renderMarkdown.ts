import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import { isDemoId } from '../src/lib/demos/ids.ts';

// Just the hast fields this plugin reads; @types/hast is only a transitive dependency.
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown; dataDemo?: string };
  children?: HastNode[];
}

/** The text of a ```<language> fence if `node` is one, else undefined. */
function fenceText(node: HastNode, language: string): string | undefined {
  const code = node.children?.[0];
  if (node.tagName !== 'pre' || code?.tagName !== 'code') {
    return undefined;
  }
  const classNames = code.properties?.className ?? [];
  const languageClass = `language-${language}`;
  const matches = Array.isArray(classNames)
    ? classNames.includes(languageClass)
    : classNames === languageClass;
  if (!matches) {
    return undefined;
  }
  return (code.children ?? [])
    .map((child) => (child.type === 'text' ? child.value : ''))
    .join('')
    .trim();
}

/** Replace ```mermaid code blocks with <div class="mermaid"> so Mermaid can render them after mount. */
function rehypeMermaid(counter: { transformed: number }) {
  return function transformer(tree: HastNode) {
    visit(
      tree,
      'element',
      (node: HastNode, index: number | undefined, parent: HastNode | undefined) => {
        const codeText = fenceText(node, 'mermaid');
        if (codeText === undefined || !parent?.children || index === undefined) {
          return;
        }

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

/**
 * Replace ```demo blocks (body: a demo id) with a placeholder div that
 * ProjectDetail.svelte mounts the interactive demo into.
 */
function rehypeDemos() {
  return function transformer(tree: HastNode) {
    visit(
      tree,
      'element',
      (node: HastNode, index: number | undefined, parent: HastNode | undefined) => {
        const id = fenceText(node, 'demo');
        if (id === undefined || !parent?.children || index === undefined) {
          return;
        }
        if (!isDemoId(id)) {
          throw new Error(`renderMarkdown: unknown demo "${id}"`);
        }

        parent.children[index] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['project-demo'], dataDemo: id },
          children: [{ type: 'text', value: 'Loading interactive demo...' }],
        };
      },
    );
  };
}

const scrollRegion = (label: string) => ({ tabIndex: 0, role: 'region', ariaLabel: label });

/**
 * Wide tables and display equations scroll horizontally on phones, so make each
 * scroll box keyboard-focusable. Tables get a wrapper: a role on the table itself
 * would hide its table semantics.
 */
function rehypeScrollRegions() {
  return function transformer(tree: HastNode) {
    let tables = 0;
    let equations = 0;
    visit(
      tree,
      'element',
      (node: HastNode, index: number | undefined, parent: HastNode | undefined) => {
        const classNames = node.properties?.className;
        if (Array.isArray(classNames) && classNames.includes('katex-display')) {
          equations += 1;
          Object.assign(node.properties ?? {}, scrollRegion(`Equation ${equations}`));
        } else if (node.tagName === 'table' && parent?.children && index !== undefined) {
          tables += 1;
          parent.children[index] = {
            type: 'element',
            tagName: 'div',
            properties: { className: ['table-scroll'], ...scrollRegion(`Table ${tables}`) },
            children: [node],
          };
          return 'skip';
        }
      },
    );
  };
}

// Default GitHub-style schema, plus the Mermaid and demo divs and language classes on code blocks.
const sanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'div'],
  attributes: {
    ...defaultSchema.attributes,
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      ['className', 'mermaid', 'project-demo'],
      'dataDemo',
    ],
    code: [...(defaultSchema.attributes?.code ?? []), ['className']],
    pre: [...(defaultSchema.attributes?.pre ?? []), ['className']],
  },
};

export async function renderProjectMarkdown(markdown: string): Promise<string> {
  const counter = { transformed: 0 };

  const rendered = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeMermaid, counter)
    .use(rehypeDemos)
    .use(rehypeSanitize, sanitizeSchema)
    // After sanitize: KaTeX's output is trusted, and sanitize would strip its inline styles.
    .use(rehypeKatex, { strict: 'error' })
    .use(rehypeScrollRegions)
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
  // Fail the build rather than ship a diagram that shows up as raw source.
  const mermaidDivs = html.match(/<div class="mermaid">/g)?.length ?? 0;
  if (html.includes('class="language-mermaid"') || mermaidDivs < counter.transformed) {
    throw new Error('renderMarkdown: a mermaid fence did not survive the pipeline');
  }
  // rehype-katex renders bad LaTeX as red source text instead of throwing.
  if (html.includes('katex-error')) {
    throw new Error('renderMarkdown: invalid LaTeX in a math block');
  }
  return html;
}
