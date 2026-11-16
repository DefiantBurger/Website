export interface ProjectSummary {
  slug: string;
  title: string;
  summary: string;
  tags: string[];
  repo: string;
  demo: string;
}

export interface ProjectDetail extends ProjectSummary {
  html: string;
  /** Plain text for the shell's grep, one block per line. */
  lines: string[];
  hasMath: boolean;
}
