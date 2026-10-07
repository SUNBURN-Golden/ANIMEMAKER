// 폰 앱 웹 부분 묶기: src → www (Capacitor 가 이 폴더를 앱 안에 넣는다)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  absWorkingDir: here,
  entryPoints: { app: 'src/main.js', 'analyze.worker': 'src/analyze.worker.js' },
  bundle: true,
  format: 'iife',
  target: ['chrome94'],
  outdir: out,
  minify: process.env.AM_DEV !== '1',
  sourcemap: process.env.AM_DEV === '1' ? 'inline' : false,
  legalComments: 'linked',
  logLevel: 'warning',
});
fs.copyFileSync(path.join(here, 'src', 'index.html'), path.join(out, 'index.html'));
fs.copyFileSync(path.join(here, 'src', 'styles.css'), path.join(out, 'styles.css'));
fs.copyFileSync(path.join(here, '..', 'src', 'renderer', 'assets', 'icon.png'), path.join(out, 'icon.png'));
console.log('built', path.relative(process.cwd(), out));
