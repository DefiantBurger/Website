export interface ProjectSummary {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  repo: string;
  demo: string;
}

export interface ProjectDetail extends ProjectSummary {
  markdown: string;
}
