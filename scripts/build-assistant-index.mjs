import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const roots = new Set(['app', 'components', 'lib', 'hooks', 'scripts']);
const extensions = /\.(?:[cm]?[jt]sx?|css|sql|json)$/;
export function isIndexedSource(relativePath) {
  const parts = relativePath.replaceAll('\\', '/').split('/');
  if (parts.some(part => part.startsWith('.') || ['node_modules', 'dist', 'coverage', 'generated'].includes(part))) return false;
  if (/\.d\.[cm]?ts$/.test(relativePath)) return false;
  return extensions.test(relativePath) && (parts.length === 1 || roots.has(parts[0]));
}
export async function buildSourceIndex(root = projectRoot) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = path.posix.join(directory, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && (directory === '' ? roots.has(entry.name) : !['node_modules', 'dist', 'generated'].includes(entry.name))) await visit(relative);
      else if (entry.isFile() && isIndexedSource(relative)) files.push(relative);
    }
  }
  await visit('');
  files.sort();
  const hash = createHash('sha256');
  const chunks = [];
  for (const file of files) {
    const source = await readFile(path.join(root, file), 'utf8');
    hash.update(file).update('\0').update(source);
    // Character bounds cover even minified/one-line JSX; overlap keeps adjacent rules together.
    for (let offset = 0; offset < source.length; offset += 2800) {
      chunks.push({ file, start: offset, kind: /\.(test|spec)\./.test(file) ? 'test' : 'implementation', text: source.slice(offset, offset + 3600) });
      if (offset + 3600 >= source.length) break;
    }
  }
  const index = { version: 1, revision: hash.digest('hex'), files, chunks };
  const target = path.join(root, '.generated', 'assistant-source-index.json');
  const output = JSON.stringify(index);
  await mkdir(path.dirname(target), { recursive: true });
  let previous;
  try { previous = await readFile(target, 'utf8'); } catch { /* First build. */ }
  if (previous !== output) await writeFile(target, output);
  return index;
}

// Keep the server's snapshot aligned with edits, additions and removals during development.
export function assistantSourceIndexPlugin() {
  return {
    name: 'assistant-source-index',
    async buildStart() { await buildSourceIndex(); },
    configureServer(server) {
      let timer;
      let running = Promise.resolve();
      const update = (file) => {
        if (!isIndexedSource(path.relative(projectRoot, file))) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          running = running.then(() => buildSourceIndex()).catch(error => server.config.logger.error(`Assistant index: ${error.message}`));
        }, 150);
      };
      server.watcher.on('add', update).on('change', update).on('unlink', update);
      server.httpServer?.once('close', () => { clearTimeout(timer); server.watcher.off('add', update).off('change', update).off('unlink', update); });
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const index = await buildSourceIndex();
  console.log(`Assistant source index: ${index.files.length} files, ${index.chunks.length} chunks.`);
}
