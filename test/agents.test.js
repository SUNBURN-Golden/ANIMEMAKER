'use strict';
// 구독 CLI 연결부 테스트 (가짜 CLI 사용 - 실제 AI 를 부르지 않음)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { agentText, agentImage, agentVideo, agentStatus } = require('../src/main/ai/agents');
const { LimitError } = require('../src/main/ai/cli');
const { ffmpegPath } = require('../src/main/media/ffmpeg');

const ROOT = path.join(__dirname, '..');

function setupFakes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-fake-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const settings = { agents: {} };
  for (const n of ['codex', 'grok', 'agy', 'claude']) {
    const p = path.join(bin, n);
    fs.copyFileSync(path.join(__dirname, 'fixtures', 'fake-cli.js'), p);
    fs.chmodSync(p, 0o755);
    settings.agents[n] = { path: p, model: '', extraArgs: '' };
  }
  process.env.FAKE_REPO_ROOT = ROOT;
  process.env.FAKE_FFMPEG = ffmpegPath();
  process.env.CODEX_HOME = path.join(dir, 'codex-home');
  // 종량제 API 키가 환경에 있어도 CLI 에는 절대 전달되면 안 된다
  process.env.OPENAI_API_KEY = 'sk-should-not-leak';
  process.env.XAI_API_KEY = 'xai-should-not-leak';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-leak';
  return { dir, settings };
}

const skipWin = process.platform === 'win32' ? '가짜 CLI 는 유닉스 실행 파일' : false;

test('text: every agent returns parsed JSON and never sees API keys', { skip: skipWin, timeout: 60000 }, async () => {
  const { dir, settings } = setupFakes();
  for (const id of ['codex', 'grok', 'agy', 'claude']) {
    const o = await agentText(id, {
      prompt: 'Return ONLY this JSON shape: {"title": "...", "song_parts": []}',
      dir: path.join(dir, `t-${id}`), settings, accept: (x) => !!x.title,
    });
    assert.match(o.title, new RegExp(id), `${id} title`);
  }
});

test('image: codex fallback finds image in CODEX_HOME, grok saves in cwd', { skip: skipWin, timeout: 60000 }, async () => {
  const { dir, settings } = setupFakes();
  const ref = path.join(dir, 'ref.png');
  fs.copyFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'icon.png'), ref);
  const a = await agentImage('codex', { prompt: 'a cat', aspect: '9:16', refs: [ref], dir: path.join(dir, 'i-codex'), settings });
  assert.ok(a.includes('generated_images'), a);
  const calls = fs.readFileSync(path.join(dir, 'i-codex', 'fake-codex-calls.log'), 'utf8');
  assert.match(calls, /--image/, 'reference image passed with --image');
  assert.match(calls, /workspace-write/);
  const b = await agentImage('grok', { prompt: 'a dog', aspect: '9:16', refs: [], dir: path.join(dir, 'i-grok'), settings });
  assert.strictEqual(path.basename(b), 'output.png');
});

test('video: grok image_to_video with requested duration', { skip: skipWin, timeout: 60000 }, async () => {
  const { dir, settings } = setupFakes();
  const start = path.join(dir, 's.png');
  fs.copyFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'icon.png'), start);
  const v = await agentVideo('grok', { prompt: 'zoom', startImage: start, seconds: 3, aspect: '9:16', dir: path.join(dir, 'v'), settings });
  assert.strictEqual(path.basename(v), 'output.mp4');
  await assert.rejects(() => agentVideo('codex', { prompt: 'x', startImage: start, seconds: 3, dir: path.join(dir, 'v2'), settings }), /영상을 만들 수 없습니다/);
});

test('usage limit is detected as LimitError', { skip: skipWin, timeout: 60000 }, async () => {
  const { dir, settings } = setupFakes();
  process.env.FAKE_LIMIT = 'claude';
  try {
    await assert.rejects(() => agentText('claude', { prompt: 'x', dir: path.join(dir, 'lim'), settings, accept: () => true }), (e) => e instanceof LimitError);
  } finally { delete process.env.FAKE_LIMIT; }
});

test('status: codex subscription login detected', { skip: skipWin, timeout: 60000 }, async () => {
  const { settings } = setupFakes();
  const st = await agentStatus('codex', settings);
  assert.strictEqual(st.installed, true);
  assert.strictEqual(st.mode, 'subscription');
  const missing = await agentStatus('grok', { agents: { grok: { path: '/nonexistent/grok' } } });
  assert.ok(typeof missing.installed === 'boolean');
});
