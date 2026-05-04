import * as esbuild from 'esbuild';
import { mkdirSync } from 'fs';

const isWatch = process.argv.includes('--watch');
const isProd = process.argv.includes('--prod');

const shared = {
  bundle: true,
  sourcemap: true,
  minify: isProd,
  logLevel: 'info',
};

const configs = [
  { ...shared, entryPoints: ['src/background/index.ts'], outfile: 'dist/background.js', format: 'esm' },
  { ...shared, entryPoints: ['src/sidepanel/index.ts'], outfile: 'dist/sidepanel.js', format: 'esm' },
  { ...shared, entryPoints: ['src/content/index.ts'], outfile: 'dist/content.js', format: 'iife' },
  { ...shared, entryPoints: ['src/options/options.ts'], outfile: 'dist/options.js', format: 'iife' },
  { ...shared, entryPoints: ['src/popup/popup.ts'], outfile: 'dist/popup.js', format: 'iife' },
];

mkdirSync('dist', { recursive: true });

if (isWatch) {
  const contexts = await Promise.all(configs.map(c => esbuild.context(c)));
  await Promise.all(contexts.map(ctx => ctx.watch()));
  console.log('Watching for changes...');
} else {
  await Promise.all(configs.map(c => esbuild.build(c)));
}
