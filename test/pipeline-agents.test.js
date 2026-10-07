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

const LYRICS = '[Verse 1]\n첫 번째 줄\n두 번째 줄\n[Chorus]\n후렴 첫 줄\n후렴 둘째 줄';

/**
 * @param {object} providers
 * @param {{settings?:object, wf?:object, songSeconds?:number, noSong?:boolean}} o
 */
async function setup(providers, o = {}) {
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
  store.saveSettings({ agents, providers, ...(o.settings || {}) });
  let songPath = null;
  if (!o.noSong) {
    songPath = path.join(root, 'suno.mp3');
    await demo.demoMusic({ part: 1, seconds: o.songSeconds || 24, bpm: 120, out: songPath });
  }
  const wf = { ...store.getWorkflow('builtin-anime-shorts'), minClips: 3, maxClips: 4, lyricSyncPause: false, ...(o.wf || {}) };
  const p = store.createProject('테스트 주제', wf, { songPath, lyricsText: LYRICS });
  const runner = new ProjectRunner({ store, projectId: p.id, maxRetries: 0 });
  const logs = [];
  runner.on('log', (l) => logs.push(l.line));
  return { root, store, runner, logs };
}

const waitFor = async (pred, logs) => {
  for (let i = 0; i < 900; i++) { if (pred()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error(`timeout\n${logs.join('\n')}`);
};

test('subscription agents: plan from lyrics, shots, keyframes, and >15s clips made in pieces', { skip: skipWin, timeout: 600000 }, async () => {
  const { runner, logs } = await setup({ text: 'codex', image: 'codex', video: 'grok' }, { songSeconds: 40, wf: { minClips: 2, maxClips: 2 } });
  await runner.run();
  const p = runner.snapshot();
  assert.strictEqual(p.status, 'done', `${p.error}\n${logs.join('\n')}`);
  assert.match(p.plan.title, /codex/);
  const planPrompt = fs.readFileSync(path.join(p.dir, 'work', 'plan', 'last-message.txt'), 'utf8');
  assert.ok(planPrompt.length > 0);
  assert.ok(p.refs && p.refs.sheet, 'character sheet made');
  assert.ok(p.keyframes.every((k) => k.status === 'done'));
  assert.ok(p.clips.every((c) => c.status === 'done'));
  // 40초 노래를 컷 2개로 → 컷마다 15초가 넘으니 조각으로 나눠 만들었어야 한다
  for (const c of p.clips) {
    assert.ok(c.seconds > 15, `clip seconds ${c.seconds}`);
    assert.ok(c.pieces.length >= 2, 'made in pieces');
    const calls = fs.readdirSync(path.join(p.dir, 'work', 'clips', `clip0${c.clip}`)).filter((f) => /^p\d+_/.test(f));
    assert.strictEqual(calls.length, c.pieces.length);
    const info = await probe(path.join(p.dir, c.file));
    assert.ok(info.duration >= c.need - 0.5, `joined clip ${info.duration} >= need ${c.need}`);
  }
  const info = await probe(path.join(p.dir, p.output.video));
  assert.ok(info.hasAudio && info.hasVideo);
  assert.ok(Math.abs(info.duration - p.music.analysis.duration) < 0.3);
});

test('helper mode picks up a downloaded image automatically and via provideFile', { timeout: 600000 }, async () => {
  const { root, runner, logs } = await setup({ text: 'demo', image: 'helper', video: 'demo' }, { songSeconds: 12, wf: { minClips: 2, maxClips: 2, characterSheet: false } });
  const img = path.join(root, 'made.png');
  await demo.demoImage({ index: 1, out: img });
  const running = runner.run();
  await waitFor(() => runner.p.waiting && runner.p.waiting.key === 'image:1:1', logs);
  assert.ok(runner.p.waiting.copyText.includes('No text'), 'prompt to paste');
  assert.strictEqual(runner.p.waiting.site, 'gemini');
  // 사용자가 브라우저에서 다운로드한 것처럼 다운로드 폴더에 파일 생성
  fs.copyFileSync(img, path.join(root, 'dl', 'Gemini_Generated_Image.png'));
  await waitFor(() => runner.p.waiting && runner.p.waiting.key === 'image:2:1', logs);
  assert.ok(runner.provideFile('image:2:1', img));
  await running;
  const p = runner.snapshot();
  assert.strictEqual(p.status, 'done', `${p.error}\n${logs.join('\n')}`);
  assert.ok(p.keyframes.every((k) => k.status === 'done'));
});

test('usage limit with onLimit=stop pauses the project as limited, then resumes', { skip: skipWin, timeout: 120000 }, async () => {
  const { runner } = await setup({ text: 'claude', image: 'demo', video: 'demo' }, { settings: { onLimit: 'stop' }, songSeconds: 12 });
  process.env.FAKE_LIMIT = 'claude';
  try { await runner.run(); } finally { delete process.env.FAKE_LIMIT; }
  assert.strictEqual(runner.p.status, 'limited');
  assert.strictEqual(runner.p.steps.music.status, 'done', '노래 분석은 AI 없이 끝나 있어야 함');
  await runner.run();
  assert.strictEqual(runner.p.status, 'done', runner.p.error);
});

test('without a song (real AI), it waits for the song file; stop() works', { skip: skipWin, timeout: 120000 }, async () => {
  const { runner } = await setup({ text: 'claude', image: 'demo', video: 'demo' }, { noSong: true });
  const running = runner.run();
  for (let i = 0; i < 300 && !(runner.p.waiting); i++) await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(runner.p.waiting.key, 'music:song');
  runner.stop();
  await running;
  assert.strictEqual(runner.p.status, 'stopped');
});

test('a project left "running" by a crash is shown as stopped and can resume', { timeout: 120000 }, async () => {
  const { store, runner } = await setup({ text: 'demo', image: 'demo', video: 'demo' }, { songSeconds: 10, wf: { minClips: 2, maxClips: 2 } });
  const p = store.loadProject(runner.p.id);
  p.status = 'running';
  p.steps = { music: { status: 'running' } };
  p.waiting = { key: 'review:lyrics', kind: 'review' };
  store.saveProject(p);
  const again = new ProjectRunner({ store, projectId: p.id });
  assert.strictEqual(again.p.status, 'stopped');
  assert.strictEqual(again.p.waiting, null);
  assert.strictEqual(again.p.steps.music.status, 'stopped');
  await again.run();
  assert.strictEqual(again.p.status, 'done', again.p.error);
});
