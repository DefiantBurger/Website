export interface ProjectSummary {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  repo: string;
  demo: string;
}

// Build-time diagnostics for checking that Mermaid fences survived the pipeline.
export interface MarkdownRenderDebug {
  markdownLength: number;
  inputHasMermaidFence: boolean;
  transformedMermaidBlocks: number;
  outputHasMermaidDiv: boolean;
  outputHasMermaidCodeFence: boolean;
  htmlLength: number;
}

export interface ProjectDetail extends ProjectSummary {
  html: string;
  debug: MarkdownRenderDebug;
}
