// Zips dist/ for store upload. Usage: npm run build && npm run package
import { spawnSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const archive = join(root, `volume-guard-${pkg.version}.zip`);
await rm(archive, { force: true });

// bsdtar (Windows 10+, macOS) writes zips with -a; fall back to `zip` on Linux.
let result = spawnSync('tar', ['-a', '-c', '-f', archive, '-C', join(root, 'dist'), '.'], {
  stdio: 'inherit',
});
if (result.status !== 0) {
  result = spawnSync('zip', ['-r', '-q', archive, '.'], {
    cwd: join(root, 'dist'),
    stdio: 'inherit',
  });
}
if (result.status !== 0) {
  console.error('Could not create the zip (need bsdtar or zip on PATH).');
  process.exit(1);
}
console.log(`Created ${archive}`);
