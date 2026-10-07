#!/usr/bin/env node
'use strict';
// 테스트용 가짜 CLI (codex / grok / agy / claude 흉내). 실제 AI 를 부르지 않는다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const name = path.basename(process.argv[1]).replace(/\.(js|cmd)$/, '');
const args = process.argv.slice(2);
const ffmpeg = process.env.FAKE_FFMPEG || 'ffmpeg';

const LEAKS = ['OPENAI_API_KEY', 'XAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'ANTHROPIC_API_KEY'].filter((k) => process.env[k]);
if (LEAKS.length) { console.error(`API KEY LEAK: ${LEAKS.join(',')}`); process.exit(42); }
if (args[0] === '--version') { console.log(`${name} 9.9.9-fake`); process.exit(0); }
if (process.env.FAKE_LIMIT === name) { console.error("Error: You've hit your usage limit. Try again in 2 hours."); process.exit(1); }
if (name === 'codex' && args[0] === 'login' && args[1] === 'status') { console.log('Logged in using ChatGPT'); process.exit(0); }

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; } }
const usesFile = name === 'grok' || name === 'agy';
const prompt = usesFile ? fs.readFileSync(path.join(process.cwd(), 'PROMPT.md'), 'utf8') : readStdin();
fs.appendFileSync(path.join(process.cwd(), `fake-${name}-calls.log`), `${JSON.stringify(args)}\n`);

function img(out, color) {
  execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=576x1024:d=1`, '-frames:v', '1', out]);
}
function vid(out, sec) {
  execFileSync(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=720x1280:r=24:d=${sec}`, '-pix_fmt', 'yuv420p', out]);
}

if (/image_to_video/.test(prompt)) {
  const sec = Number((/duration: (\d+)/.exec(prompt) || [])[1] || 5);
  if (!fs.existsSync(path.join(process.cwd(), 'start.png')) && !fs.readdirSync(process.cwd()).some((f) => f.startsWith('start'))) { console.error('no start image'); process.exit(2); }
  vid(path.join(process.cwd(), 'output.mp4'), sec);
  console.log(JSON.stringify({ result: 'Saved output.mp4' }));
  process.exit(0);
}
if (/\$imagegen|image_gen|image generation/.test(prompt) && !/Return ONLY/.test(prompt)) {
  if (name === 'codex') {
    // 진짜 codex 처럼 CODEX_HOME/generated_images 에 저장 (작업 폴더로는 복사하지 않음 → 앱의 대체 탐지 확인)
    const dir = path.join(process.env.CODEX_HOME, 'generated_images', `sess-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    img(path.join(dir, 'ig_0001.png'), 'orange');
    console.log('DONE');
  } else {
    img(path.join(process.cwd(), 'output.png'), 'purple');
    console.log(JSON.stringify({ result: 'saved output.png' }));
  }
  process.exit(0);
}

// 글쓰기
const demo = require(path.join(process.env.FAKE_REPO_ROOT, 'src', 'main', 'ai', 'demo.js'));
let answer;
if (/"song_parts"/.test(prompt)) {
  const plan = demo.demoPlan('가짜 주제', { musicParts: 2, musicGenre: 'k-pop', vocal: 'female', lyricsLanguage: '한국어' });
  plan.title = `${name} 가 쓴 기획`;
  answer = plan;
} else if (/"shots"/.test(prompt)) {
  const n = Number((/exactly (\d+) shots/.exec(prompt) || [])[1] || 10);
  const segs = Array.from({ length: n }, (_, i) => ({ index: i + 1, energy: 'mid' }));
  answer = demo.demoShots(segs, demo.demoPlan('x', {}));
} else if (/"topics"/.test(prompt)) {
  answer = { topics: ['가짜 주제 1', '가짜 주제 2'] };
} else {
  answer = { ok: true, hello: '안녕하세요' };
}
const text = `Here you go:\n\`\`\`json\n${JSON.stringify(answer, null, 1)}\n\`\`\``;
if (name === 'codex') {
  const i = args.indexOf('-o');
  fs.writeFileSync(args[i + 1], text);
  console.log('[codex] working...');
} else if (usesFile) {
  fs.writeFileSync(path.join(process.cwd(), 'result.json'), JSON.stringify(answer));
  console.log(JSON.stringify({ status: 'SUCCESS', response: text }));
} else {
  console.log(JSON.stringify({ type: 'result', is_error: false, result: text }));
}
