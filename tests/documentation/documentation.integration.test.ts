import { expect, it } from 'vitest';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { MarkdownUiDefinitions } from '../../src/the-forge/infrastructure/ui/definitions.ts';
import { validateUiLibrary } from '../../src/the-forge/domain/ui/library.ts';
import { renderUiComponents } from '../../src/the-forge/infrastructure/ui/renderers.ts';
import { renderUiStories } from '../../src/the-forge/infrastructure/ui/stories.ts';
import { uiFrameworks } from '../../src/the-forge/domain/ui/definition.ts';
import { MarkdownDataSourceDefinitions } from '../../src/the-forge/infrastructure/data-sources/definitions.ts';
import { TypeScriptDataSourceRenderer } from '../../src/the-forge/infrastructure/data-sources/generator.ts';

async function markdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // Keep repository-relative POSIX paths: definition codecs reject Windows separators.
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.isFile() && extname(path) === '.md') files.push(path);
  }
  return files.sort();
}

it('keeps Diátaxis, distributed skills, and worked-example navigation connected after packaging moves', async () => {
  const files = ['README.md', 'AGENTS.md', 'src/the-forge/README.md', 'bin/data/README.md', ...await markdownFiles('bin/data/docs'), ...await markdownFiles('docs'), ...await markdownFiles('bin/skills')];
  const failures: string[] = [];
  for (const path of files) {
    const tree = unified().use(remarkParse).parse(await readFile(path, 'utf8'));
    const targets: string[] = [];
    const walk = (node: { url?: string; children?: unknown[] }) => {
      if (node.url) targets.push(node.url);
      for (const child of node.children ?? []) walk(child as typeof node);
    };
    walk(tree);
    for (const url of targets) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('/')) continue;
      const target = decodeURIComponent(url.split('#')[0]!.split('?')[0]!);
      if (!target) continue;
      try { await access(resolve(dirname(path), target)); }
      catch { failures.push(`${path} -> ${url}`); }
    }
  }
  expect(failures).toEqual([]);
  for (const section of ['tutorials', 'how-to', 'reference', 'explanation']) {
    expect((await markdownFiles(`docs/${section}`)).length).toBeGreaterThan(0);
    expect(await readFile('docs/index.md', 'utf8')).toContain(`${section}/`);
  }
});

it('keeps the worked UI and data-source documents valid and deterministically generatable', async () => {
  const codec = new MarkdownUiDefinitions();
  const definitions = await Promise.all((await markdownFiles('docs/examples/idea-to-production/components')).map(async path => codec.parse(await readFile(path), path)));
  validateUiLibrary(definitions);
  for (const framework of uiFrameworks) {
    const components = renderUiComponents(definitions, framework, `generated/${framework}`);
    expect(components.length).toBeGreaterThanOrEqual(definitions.length);
    expect(renderUiComponents([...definitions].reverse(), framework, `generated/${framework}`)).toEqual(components);
    expect(renderUiStories(definitions, framework, `generated/${framework}`, `stories/${framework}`)).toHaveLength(definitions.length);
  }
  const dataCodec = new MarkdownDataSourceDefinitions();
  const sources = await Promise.all((await markdownFiles('docs/examples/idea-to-production/sources')).map(async path => dataCodec.parse(await readFile(path), path)));
  const renderer = new TypeScriptDataSourceRenderer();
  const options = { outputDirectory: 'generated/data', testDataDirectory: 'test-data' };
  const writes = renderer.generate(sources, options);
  expect(writes).toHaveLength(sources.length * 2);
  expect(renderer.generate([...sources].reverse(), options)).toEqual(writes);
});
