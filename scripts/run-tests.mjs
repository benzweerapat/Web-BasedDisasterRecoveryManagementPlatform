import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function find(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const path = join(dir, item.name);
    return item.isDirectory() ? find(path) : /\.test\.(?:js|mjs)$/.test(item.name) ? [path] : [];
  });
}
const files = ['backend/src', 'frontend/src', 'frontend/tests', 'scripts'].flatMap(dir => find(resolve(root, dir))).sort();
const result = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
