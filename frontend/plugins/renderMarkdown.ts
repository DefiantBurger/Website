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

export interface RenderedMarkdown {
  html: string;
  /** Plain text for the shell's grep: one line per block (heading, paragraph, list item, code line). */
  lines: string[];
  hasMath: boolean;
}

function hasClass(node: HastNode, name: string): boolean {
  const classNames = node.properties?.className;
  return Array.isArray(classNames) ? classNames.includes(name) : classNames === name;
}

/** The text of a ```<language> fence if `node` is one, else undefined. */
function fenceText(node: HastNode, language: string): string | undefined {
  const code = node.children?.[0];
  if (
    node.tagName !== 'pre' ||
    code?.tagName !== 'code' ||
    !hasClass(code, `language-${language}`)
  ) {
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

// Blocks that become grep lines; one nested in another (a list in a list item) is its own line.
const TEXT_BLOCKS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'pre', 'td', 'th']);
const isTextBlock = (node: HastNode) =>
  node.type === 'element' && TEXT_BLOCKS.has(node.tagName ?? '');

/** `node`'s text minus nested text blocks, which are queued on `nested` instead. */
function ownText(node: HastNode, nested: HastNode[]): string {
  if (node.type === 'text') {
    return node.value ?? '';
  }
  if (node.tagName === 'br') {
    return ' ';
  }
  return (node.children ?? [])
    .map((child) => (isTextBlock(child) ? (nested.push(child), ' ') : ownText(child, nested)))
    .join('');
}

/**
 * Collect the grep lines and note whether there's math. Runs before KaTeX and the
 * heading anchors, so an equation appears once, as LaTeX, and headings have no `#`.
 */
function rehypeCollectText(out: Omit<RenderedMarkdown, 'html'>) {
  return function transformer(tree: HastNode) {
    const emit = (block: HastNode) => {
      const nested: HastNode[] = [];
      const text = ownText(block, nested);
      // Code keeps its line breaks; prose becomes one line per block.
      const lines = block.tagName === 'pre' ? text.split('\n') : [text.replace(/\s+/g, ' ')];
      out.lines.push(...lines.map((line) => line.trim()).filter(Boolean));
      nested.forEach(emit);
    };
    const walk = (node: HastNode): void =>
      isTextBlock(node) ? emit(node) : node.children?.forEach(walk);
    walk(tree);
    visit(tree, 'element', (node: HastNode) => {
      out.hasMath ||= hasClass(node, 'language-math');
    });
  };
}

/** Fail the build on output that would render wrong, rather than ship it. */
function rehypeCheckOutput(mermaid: { transformed: number }) {
  return function transformer(tree: HastNode) {
    let mermaidDivs = 0;
    visit(tree, 'element', (node: HastNode) => {
      // A fence that wasn't transformed, or a div that lost its class, shows up as raw source.
      if (hasClass(node, 'language-mermaid')) {
        throw new Error('renderMarkdown: a mermaid fence did not survive the pipeline');
      }
      if (node.tagName === 'div' && hasClass(node, 'mermaid')) {
        mermaidDivs += 1;
      }
      // rehype-katex renders bad LaTeX as red source text instead of throwing.
      if (hasClass(node, 'katex-error')) {
        throw new Error('renderMarkdown: invalid LaTeX in a math block');
      }
    });
    if (mermaidDivs < mermaid.transformed) {
      throw new Error('renderMarkdown: a mermaid fence did not survive the pipeline');
    }
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
        if (hasClass(node, 'katex-display')) {
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

export async function renderProjectMarkdown(markdown: string): Promise<RenderedMarkdown> {
  const counter = { transformed: 0 };
  const text = { lines: [] as string[], hasMath: false };

  const rendered = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkRehype)
    .use(rehypeMermaid, counter)
    .use(rehypeDemos)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeCollectText, text)
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
    .use(rehypeCheckOutput, counter)
    .use(rehypeStringify)
    .process(markdown);

  return { html: String(rendered), ...text };
}
