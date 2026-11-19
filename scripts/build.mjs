// Bundles the extension into dist/. Usage: node scripts/build.mjs [--watch] [--dev]
import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, watch as watchFiles, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

const entryPoints = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  popup: 'src/ui/popup/index.ts',
  options: 'src/ui/options/index.ts',
  offscreen: 'src/offscreen/index.ts',
};

const options = {
  absWorkingDir: root,
  entryPoints,
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome114',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  define: { __DEV__: JSON.stringify(dev) },
  legalComments: 'none',
  logLevel: 'info',
};

/** Copies static files and stamps the manifest with the package version. */
async function copyStatic() {
  await cp(join(root, 'public'), dist, { recursive: true });
  await mkdir(join(dist, 'fonts'), { recursive: true });
  await cp(
    join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
    join(dist, 'fonts/inter-latin.woff2'),
  );
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const manifestPath = join(dist, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = pkg.version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyStatic();

if (!watch) {
  await build(options);
  console.log(`Built ${dev ? 'development' : 'production'} bundle in dist/`);
} else {
  const ctx = await context(options);
  await ctx.watch();
  console.log('Watching src/ and public/ … (Ctrl+C to stop)');
  for await (const change of watchFiles(join(root, 'public'), { recursive: true })) {
    if (change.filename) await copyStatic();
  }
}
