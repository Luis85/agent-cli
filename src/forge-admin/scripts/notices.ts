import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { Plugin } from 'vite';

interface PackageMetadata { name: string; version: string; license?: string; homepage?: string }

/** Include dependency attribution with the static application, without installation paths. */
export function notices(): Plugin {
  let root = process.cwd();
  return {
    name: 'forge-admin-notices',
    configResolved(config) { root = config.root; },
    async generateBundle(_options, bundle) {
      const directories = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [moduleId, module] of Object.entries(output.modules)) {
          const id = moduleId.replaceAll('\\', '/');
          if (!module.renderedLength || !id.includes('/node_modules/') || id.startsWith('\0')) continue;
          let directory = dirname(id.split('?')[0]!);
          let identified = false;
          while (directory.replaceAll('\\', '/').split('/').includes('node_modules')) {
            try {
              const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as Partial<PackageMetadata>;
              // Some packages put a type-only package.json inside dist/. It
              // defines a module boundary, not the dependency's attribution.
              if (typeof metadata.name === 'string' && typeof metadata.version === 'string') {
                directories.add(directory);
                identified = true;
                break;
              }
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
            directory = dirname(directory);
          }
          if (!identified) throw new Error(`Cannot identify bundled dependency: ${id}`);
        }
      }
      // Tailwind transforms CSS during the build, so its attribution is not a JS chunk module.
      for (const dependency of ['tailwindcss', '@iconify-json/lucide']) directories.add(join(root, 'node_modules', dependency));
      const packages = await Promise.all([...directories].map(async directory => ({
        directory, metadata: JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as PackageMetadata,
      })));
      packages.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name, 'en') || a.metadata.version.localeCompare(b.metadata.version, 'en'));
      const sections = ['# Third-party notices', '', 'Dependencies included in the developer admin webview. License text is reproduced when provided by the published package.', ''];
      for (const { directory, metadata } of packages) {
        sections.push(`## ${metadata.name} ${metadata.version}`, '', `License: ${metadata.license ?? 'See upstream package'}.`, '');
        if (metadata.homepage) sections.push(`Upstream: ${metadata.homepage}`, '');
        const files = (await readdir(directory, { withFileTypes: true })).filter(file => file.isFile() && /^(licen[sc]e|copying|notice)(?:[._-]|$)/i.test(file.name));
        if (!files.length && metadata.name !== '@iconify-json/lucide') throw new Error(`Missing license notice for bundled dependency ${metadata.name}`);
        for (const file of files.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
          const source = join(directory, file.name);
          const target = `licenses/${relative(root, source).replaceAll('\\', '/').replaceAll('/', '__')}`;
          this.emitFile({ type: 'asset', fileName: target, source: await readFile(source) });
          sections.push(`- [${file.name}](${target})`);
        }
        if (metadata.name === '@iconify-json/lucide') {
          // The Iconify package omits its license text. Keep the upstream notice
          // locally so offline, reproducible builds retain Lucide/Feather attribution.
          const target = 'licenses/lucide-LICENSE';
          this.emitFile({ type: 'asset', fileName: target, source: await readFile(join(root, 'scripts/licenses/lucide-LICENSE')) });
          sections.push(`- [LICENSE](${target})`, '', 'License source: https://github.com/lucide-icons/lucide/blob/70562c1ee1c4fdcf736fe97bc893fb8511927934/LICENSE');
        }
        sections.push('');
      }
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.md', source: sections.join('\n') });
    },
  };
}
