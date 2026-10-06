import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Generate the cache from the actual emitted assets, including Vite's hashed chunks.
// A content digest gives every release an independent, complete offline shell.
function offlineShell(): Plugin {
  let outputDirectory = '';
  return {
    name: 'hays-offline-shell',
    apply: 'build',
    configResolved(config) { outputDirectory = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      async function files(directory: string): Promise<string[]> {
        const entries = await readdir(directory, { withFileTypes: true });
        const groups = await Promise.all(entries.map(entry => entry.isDirectory()
          ? files(resolve(directory, entry.name)) : Promise.resolve([resolve(directory, entry.name)])));
        return groups.flat();
      }
      const paths = (await files(outputDirectory)).filter(path => !path.endsWith('sw.js') && !path.endsWith('.map')).sort();
      const hash = createHash('sha256');
      const urls = ['/'];
      for (const path of paths) {
        const url = '/' + relative(outputDirectory, path).replaceAll('\\', '/');
        urls.push(url);
        hash.update(url).update(await readFile(path));
      }
      const source = await readFile(resolve(outputDirectory, 'sw.js'), 'utf8');
      await writeFile(resolve(outputDirectory, 'sw.js'), source
        .replace('__HAYS_BUILD_VERSION__', hash.digest('hex').slice(0, 20))
        .replace(/\/\* HAYS_PRECACHE \*\/[\s\S]*?\/\* END_HAYS_PRECACHE \*\//, JSON.stringify(urls)));
    },
  };
}

export default defineConfig({ plugins: [react(), tailwindcss(), offlineShell()] });

