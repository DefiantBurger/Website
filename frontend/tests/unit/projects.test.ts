import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { parseProject, readPublishedProjects } from '../../plugins/projects.ts';

describe('parseProject', () => {
  test('reads frontmatter and strips it from the body', () => {
    const project = parseProject(
      'file.md',
      '---\ntitle: My Awesome Project\nslug: awesome-project\ntags: [python, flask]\npriority: 10\n---\n\n# Heading\n\nBody.'
    );
    assert.equal(project.title, 'My Awesome Project');
    assert.equal(project.slug, 'awesome-project');
    assert.deepEqual(project.tags, ['python', 'flask']);
    assert.equal(project.priority, 10);
    assert.equal(project.published, true);
    assert.equal(project.markdown, '# Heading\n\nBody.');
  });

  test('fills defaults when there is no frontmatter', () => {
    const text = '# Plain Markdown\n\nNo frontmatter here.';
    const project = parseProject('my-cool-thing.md', text);
    assert.equal(project.slug, 'my-cool-thing');
    assert.equal(project.title, 'My Cool Thing');
    assert.deepEqual(project.tags, []);
    assert.equal(project.priority, 0);
    assert.equal(project.published, true);
    assert.equal(project.markdown, text);
  });

  test('tolerates malformed fields', () => {
    const project = parseProject(
      'x.md',
      '---\nslug: test-slug\ntags: not-a-list\npriority: invalid-number\npublished: false\n---\nContent'
    );
    assert.equal(project.slug, 'test-slug');
    assert.deepEqual(project.tags, []);
    assert.equal(project.priority, 0);
    assert.equal(project.published, false);
  });

  test('a horizontal rule in the body is not a frontmatter delimiter', () => {
    const project = parseProject('x.md', '---\ntitle: T\n---\nabove\n\n---\n\nbelow');
    assert.equal(project.markdown, 'above\n\n---\n\nbelow');
  });
});

describe('readPublishedProjects', () => {
  function withFiles(files: Record<string, string>, run: (dir: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    try {
      for (const [name, text] of Object.entries(files)) {
        writeFileSync(join(dir, name), text);
      }
      run(dir);
    } finally {
      rmSync(dir, { recursive: true });
    }
  }

  test('skips unpublished projects and sorts by priority, highest first', () => {
    withFiles(
      {
        'low.md': '---\npriority: 1\n---\n',
        'high.md': '---\npriority: 5\n---\n',
        'hidden.md': '---\npriority: 9\npublished: false\n---\n',
        'notes.txt': 'ignored'
      },
      (dir) => assert.deepEqual(readPublishedProjects(dir).map((p) => p.slug), ['high', 'low'])
    );
  });

  test('fails on duplicate slugs', () => {
    withFiles({ 'a.md': '---\nslug: same\n---\n', 'b.md': '---\nslug: same\n---\n' }, (dir) =>
      assert.throws(() => readPublishedProjects(dir), /more than one/)
    );
  });

  test('fails on slugs that are unsafe as paths', () => {
    withFiles({ 'a.md': '---\nslug: ../escape\n---\n' }, (dir) =>
      assert.throws(() => readPublishedProjects(dir), /must be lowercase/)
    );
  });
});
