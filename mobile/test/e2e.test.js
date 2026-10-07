// 폰 앱 화면을 진짜 브라우저(Chromium)로 열어서 끝까지 눌러 보고, 나온 MP4 를 검사한다.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { Input, BufferSource, ALL_FORMATS } from 'mediabunny';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const www = path.join(root, 'www');
const require = createRequire(import.meta.url);

function findChrome() {
  const cands = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
  try {
    for (const d of fs.readdirSync('/opt/pw-browsers')) if (/^chromium-\d+$/.test(d)) cands.push(path.join('/opt/pw-browsers', d, 'chrome-linux', 'chrome'));
  } catch (_) { /* noop */ }
  return cands.find((c) => c && fs.existsSync(c));
}

function findFfmpeg() {
  try { return require('../../node_modules/ffmpeg-static'); } catch (_) { return null; }
}

const CHROME = findChrome();
const skip = CHROME ? false : 'Chromium/Chrome 이 없음 (CHROME_PATH 로 지정)';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.txt': 'text/plain' };
function serve() {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(www, u === '/' ? 'index.html' : u);
    if (!f.startsWith(www) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/** 박자가 분명한 테스트 노래 (120 BPM 킥) → WAV */
function wavSong(seconds, bpm = 120) {
  const sr = 22050;
  const n = sr * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  const beat = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = t % beat;
    const bar = Math.floor(t / beat) % 4 === 0 ? 1 : 0.6;
    let s = bar * 0.8 * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-30 * k)) * k) * Math.exp(-9 * k);
    s += 0.05 * Math.sin(2 * Math.PI * 261.63 * t) + 0.04 * Math.sin(2 * Math.PI * 329.63 * t);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32000), 44 + i * 2);
  }
  return buf;
}

async function inspect(buffer) {
  const input = new Input({ source: new BufferSource(buffer), formats: ALL_FORMATS });
  const v = await input.getPrimaryVideoTrack();
  const a = await input.getPrimaryAudioTrack();
  return {
    duration: await input.computeDuration(),
    video: v ? { codec: v.codec, w: v.displayWidth, h: v.displayHeight } : null,
    audio: a ? { codec: a.codec, sr: a.sampleRate } : null,
  };
}

async function outputBuffer(page) {
  const b64 = await page.evaluate(async () => {
    const { app, db } = window.AnimeMaker;
    const p = (await db.listProjects())[0];
    const blob = await db.getFile(p.output.key);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    void app;
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

async function setup() {
  execFileSync(process.execPath, [path.join(root, 'build.mjs')], { stdio: 'ignore', env: { ...process.env, AM_DEV: '1' } });
  const srv = await serve();
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  return { srv, browser, page, errors, close: async () => { await browser.close(); srv.close(); } };
}

const SHOT_DIR = process.env.AM_SHOTS || '';
async function shot(page, name) {
  if (SHOT_DIR) { fs.mkdirSync(SHOT_DIR, { recursive: true }); await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true }); }
}

test('체험해 보기: 버튼 하나로 노래 분석 → 연습 그림 → MP4 완성', { skip, timeout: 600000 }, async () => {
  const s = await setup();
  try {
    await shot(s.page, '01_home');
    await s.page.click('text=체험해 보기');
    await s.page.waitForSelector('video.final', { timeout: 540000 });
    await shot(s.page, '02_demo_done');
    const info = await inspect(await outputBuffer(s.page));
    assert.ok(info.video && info.audio, JSON.stringify(info));
    assert.strictEqual(info.video.w, 720);
    assert.strictEqual(info.video.h, 1280);
    assert.ok(Math.abs(info.duration - 60) < 0.3, `duration ${info.duration}`);
    assert.deepStrictEqual(s.errors.filter((e) => !/favicon/.test(e)), []);
  } finally {
    await s.close();
  }
});

const PLAN = {
  title: '별빛 우체부', logline: '밤하늘 편지를 나르는 소녀의 이야기', concept: '테스트용 기획안',
  visual_style: 'soft anime', characters: [{ name: '하나', description_ko: '우체부 소녀', appearance_en: 'girl with a red cap' }],
  world_en: 'starry town', story: [{ act: 1, sections: ['Verse 1'], summary_ko: '편지를 받는다', visual_en: 'receives a letter' }, { act: 2, sections: ['Chorus'], summary_ko: '하늘을 난다', visual_en: 'flies' }],
  music: { genre: 'pop', mood: 'bright' },
};
const TR = ['fade', 'slideleft', 'circleopen', 'pixelize', 'fadeblack', 'wipeleft', 'zoomin', 'flash', 'dissolve', 'smoothleft', 'slideup', 'cut'];

test('직접 하기: 노래 올리기 → AI 답장 붙여넣기 → 사진·영상 고르기 → 자막 들어간 MP4', { skip, timeout: 600000 }, async () => {
  const s = await setup();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'am-mobile-'));
  const { page } = s;
  try {
    // ① 새 작품: 노래 + 가사
    await page.click('text=새 뮤직비디오 만들기');
    const songFile = path.join(tmp, 'mysong.wav');
    fs.writeFileSync(songFile, wavSong(36));
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=노래 고르기')]);
    await fc.setFiles(songFile);
    await page.waitForSelector('text=✔ mysong.wav');
    await page.fill('textarea.lyrics', '[Verse 1]\n별빛이 내리는 밤\n편지를 들고 달려\n[Chorus]\n하늘 높이 날아올라\n너에게 닿을 때까지');
    await page.click('text=시작하기 →');
    await page.waitForSelector('text=이야기 만들러 가기 →', { timeout: 120000 });
    await shot(page, '03_song');
    await page.click('text=이야기 만들러 가기 →');

    // ② 이야기: AI 답장(설명 + 코드 상자) 붙여넣기
    await page.click('text=직접 붙여 넣기 / 부탁할 글 보기');
    await page.fill('details textarea', `좋아요! 기획안입니다.\n\`\`\`json\n${JSON.stringify(PLAN, null, 2)}\n\`\`\`\n마음에 드시길!`);
    await page.click('details >> text=확인');
    await page.waitForSelector('text=🎬 별빛 우체부');
    await shot(page, '04_story');
    await page.click('text=컷 나누러 가기 →');

    // ③ 컷 나누기 + 장면 설계 답장
    await page.waitForSelector('text=/✂ 컷 \\d+개/');
    const n = await page.evaluate(() => window.AnimeMaker.db.listProjects().then((l) => l[0].timing.segments.length));
    assert.ok(n >= 3, `segments ${n}`);
    const shots = Array.from({ length: n }, (_, i) => ({
      clip: i + 1, characters: ['하나'], subject: 'the girl', action: `action ${i + 1}`, setting: 'town', camera: 'wide', lighting: 'night',
      end_state: 'smiles', motion: 'slow pan', transition_out: { type: TR[i % TR.length], beats: 1 },
    }));
    await page.click('text=직접 붙여 넣기 / 부탁할 글 보기');
    await page.fill('details textarea', JSON.stringify({ shots }));
    await page.click('details >> text=확인');
    await page.waitForSelector('text=그림 만들러 가기 →');
    await shot(page, '05_timing');
    await page.click('text=그림 만들러 가기 →');

    // ④ 그림: 컷마다 사진 고르기
    const imgs = fs.readdirSync(path.join(root, '..', 'docs', 'manual', 'build', 'img')).filter((f) => f.endsWith('.png')).map((f) => path.join(root, '..', 'docs', 'manual', 'build', 'img', f));
    for (let i = 0; i < n; i++) {
      const [c] = await Promise.all([page.waitForEvent('filechooser'), page.click(`.media-card:not(.wide) >> nth=${i} >> text=사진 고르기`)]);
      await c.setFiles(imgs[i % imgs.length]);
      await page.waitForFunction((k) => window.AnimeMaker.db.listProjects().then((l) => l[0].items.filter((it) => it.picture).length >= k), i + 1);
    }
    await page.waitForSelector('text=움직이게 하러 가기 →');
    await shot(page, '06_pictures');
    await page.click('text=움직이게 하러 가기 →');

    // ⑤ 움직이기: 컷 1 에 영상 하나 (브라우저가 읽을 수 있는 코덱으로)
    const ff = findFfmpeg();
    if (ff) {
      const h264 = await page.evaluate(() => VideoDecoder.isConfigSupported({ codec: 'avc1.42001f' }).then((r) => r.supported).catch(() => false));
      const clip = path.join(tmp, 'clip.mp4');
      execFileSync(ff, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=24:d=2', ...(h264 ? ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'] : ['-c:v', 'libvpx-vp9', '-b:v', '1M']), clip], { stdio: 'ignore' });
      const [c] = await Promise.all([page.waitForEvent('filechooser'), page.click('.media-card >> nth=0 >> text=영상 고르기')]);
      await c.setFiles(clip);
      await page.waitForSelector('.media-card >> nth=0 >> text=🎞 영상');
    }
    await shot(page, '07_moving');
    await page.click('text=이대로 완성하러 가기 →');

    // ⑥ 완성
    await page.click('text=노란 글씨');
    await page.click('button.big:has-text("영상 만들기")');
    await page.waitForSelector('video.final', { timeout: 540000 });
    await shot(page, '08_done');
    const buf = await outputBuffer(page);
    const info = await inspect(buf);
    if (process.env.AM_KEEP) fs.writeFileSync(process.env.AM_KEEP, buf);
    assert.ok(info.video && info.audio, JSON.stringify(info));
    assert.ok(Math.abs(info.duration - 36) < 0.3, `duration ${info.duration}`);
    assert.deepStrictEqual(s.errors.filter((e) => !/favicon/.test(e)), []);
  } finally {
    await s.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
