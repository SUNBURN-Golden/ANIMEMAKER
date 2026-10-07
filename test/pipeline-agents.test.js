'use strict';
// 가짜 구독 CLI + 도우미 모드로 파이프라인 전체를 돌려 본다.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
const { ProjectRunner } = require('../src/main/pipeline/runner');
const { ffmpegPath, probe } = require('../src/main/media/ffmpeg');
const demo = require('../src/main/ai/demo');

const ROOT = path.join(__dirname, '..');
const skipWin = process.platform === 'win32' ? '가짜 CLI 는 유닉스 실행 파일' : false;

function setup(providers, extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'am-pipe-'));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const agents = {};
  for (const n of ['codex', 'grok', 'agy', 'claude']) {
    const p = path.join(bin, n);
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-cli.js'), p);
    fs.chmodSync(p, 0o755);
    agents[n] = { path: p };
  }
  process.env.FAKE_REPO_ROOT = ROOT;
  process.env.FAKE_FFMPEG = ffmpegPath();
  process.env.CODEX_HOME = path.join(root, 'codex-home');
  const store = new Store({ userDataDir: path.join(root, 'ud'), documentsDir: path.join(root, 'docs'), downloadsDir: path.join(root, 'dl') });
  fs.mkdirSync(path.join(root, 'dl'), { recursive: true });
  store.saveSettings({ agents, providers, ...extra });
  const wf = { ...store.getWorkflow('builtin-anime-shorts'), partSeconds: 16, minClips: 6, maxClips: 8 };
  const p = store.createProject('테스트 주제', wf);
  const runner = new ProjectRunner({ store, projectId: p.id, maxRetries: 0 });
  const logs = [];
  runner.on('log', (l) => logs.push(l.line));
  return { root, store, runner, logs };
}

test('subscription agents drive plan, shots, keyframes and clips', { skip: skipWin, timeout: 600000 }, async () => {
  const { runner, logs } = setup({ text: 'codex', image: 'codex', video: 'grok', music: 'demo' });
  await runner.run();
  const p = runner.snapshot();
  assert.strictEqual(p.status, 'done', `${p.error}\n${logs.join('\n')}`);
  assert.match(p.plan.title, /codex/);
  assert.ok(p.refs && p.refs.sheet, 'character sheet made');
  assert.ok(p.keyframes.every((k) => k.status === 'done'));
  assert.ok(p.clips.every((c) => c.status === 'done'));
  // 요청한 클립 길이는 1~15초
  assert.ok(p.clips.every((c) => c.seconds >= 1 && c.seconds <= 15));
  const info = await probe(path.join(p.dir, p.output.video));
  assert.ok(info.hasAudio && info.hasVideo);
});

test('helper mode picks up a downloaded song automatically and via provideFile', { timeout: 600000 }, async () => {
  const { root, runner, logs } = setup({ text: 'demo', image: 'demo', video: 'demo', music: 'helper' });
  const tmpSong = path.join(root, 'made.mp3');
  await demo.demoMusic({ part: 1, seconds: 16, bpm: 120, out: tmpSong });
  const running = runner.run();
  const waitFor = async (pred) => { for (let i = 0; i < 600; i++) { if (pred()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`timeout\n${logs.join('\n')}`); };
  await waitFor(() => runner.p.waiting && runner.p.waiting.key === 'music:1');
  assert.ok(runner.p.waiting.copyText.includes('Lyrics:'), 'lyrics in paste text');
  assert.strictEqual(runner.p.waiting.site, 'gemini');
  // 사용자가 브라우저에서 다운로드한 것처럼 다운로드 폴더에 파일 생성
  fs.copyFileSync(tmpSong, path.join(root, 'dl', 'gemini_song_part1.mp3'));
  await waitFor(() => runner.p.waiting && runner.p.waiting.key === 'music:2');
  // 두 번째는 [파일 직접 고르기] 로 넣기
  assert.ok(runner.provideFile('music:2', tmpSong));
  await running;
  const p = runner.snapshot();
  assert.strictEqual(p.status, 'done', `${p.error}\n${logs.join('\n')}`);
  assert.strictEqual(p.music.parts.length, 2);
});

test('usage limit with onLimit=stop pauses the project as limited', { skip: skipWin, timeout: 120000 }, async () => {
  const { runner } = setup({ text: 'claude', image: 'demo', video: 'demo', music: 'demo' }, { onLimit: 'stop' });
  process.env.FAKE_LIMIT = 'claude';
  try { await runner.run(); } finally { delete process.env.FAKE_LIMIT; }
  assert.strictEqual(runner.p.status, 'limited');
  // 한도가 풀리면 이어서 하기
  await runner.run();
  assert.strictEqual(runner.p.status, 'done', runner.p.error);
});

test('stop() during a helper wait stops cleanly and can resume', { timeout: 120000 }, async () => {
  const { runner } = setup({ text: 'demo', image: 'demo', video: 'demo', music: 'file' });
  const running = runner.run();
  for (let i = 0; i < 300 && !(runner.p.waiting); i++) await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(runner.p.waiting.key, 'music:1');
  runner.stop();
  await running;
  assert.strictEqual(runner.p.status, 'stopped');
  assert.strictEqual(runner.p.steps.plan.status, 'done');
});
