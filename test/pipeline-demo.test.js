'use strict';
// 체험(demo) 모드로 전체 6단계를 끝까지 돌려 최종 영상이 나오는지 확인
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
const { ProjectRunner } = require('../src/main/pipeline/runner');
const { probe } = require('../src/main/media/ffmpeg');
const demo = require('../src/main/ai/demo');

function newStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'animemaker-'));
  const store = new Store({ userDataDir: path.join(root, 'ud'), documentsDir: path.join(root, 'docs'), downloadsDir: path.join(root, 'dl') });
  return { root, store };
}

test('demo pipeline: example song, lyric-sync pause with tap timing, beat-synced cuts', { timeout: 600000 }, async () => {
  const { store } = newStore();
  const wf = { ...store.getWorkflow('builtin-anime-shorts'), minClips: 6, maxClips: 8 };
  const project = store.createProject('고양이가 우주정거장에서 라면을 끓이는 이야기', wf);
  project.demoSongSeconds = 48;
  store.saveProject(project);
  const runner = new ProjectRunner({ store, projectId: project.id });
  const logs = [];
  runner.on('log', (l) => logs.push(l.line));
  const running = runner.run();
  // 가사 맞추기 대기 → 탭으로 맞춘 것처럼 저장하고 계속
  for (let i = 0; i < 600 && !(runner.p.waiting && runner.p.waiting.key === 'review:lyrics'); i++) await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(runner.p.waiting && runner.p.waiting.key, 'review:lyrics', logs.join('\n'));
  assert.deepStrictEqual(runner.p.steps.music.status, 'done');
  assert.deepStrictEqual(runner.p.steps.plan.status, 'done');
  const est = runner.p.timing.lyrics;
  const tapped = est.map((l, i) => ({ text: l.text, part: 1, start: 4 + i * 2.4, end: 4 + i * 2.4 + 2.2 }));
  runner.updateLyrics(tapped);
  assert.ok(runner.continueReview());
  await running;
  const p = runner.snapshot();
  assert.strictEqual(p.status, 'done', `status=${p.status} error=${p.error}\n${logs.join('\n')}`);
  assert.strictEqual(p.timing.lyricsSource, 'tap');
  assert.ok(p.timing.lyrics[0].section, 'section info kept after tapping');
  assert.ok(p.timing.segments.length >= 6 && p.timing.segments.length <= 8, `segments ${p.timing.segments.length}`);
  const beats = p.music.analysis.beats;
  for (const s of p.timing.segments.slice(1)) assert.ok(beats.some((b) => Math.abs(b - s.start) < 0.01), `cut ${s.start} on beat`);
  for (const s of p.timing.segments) assert.ok(s.duration >= 1 && s.duration <= 30, `len ${s.duration}`);
  assert.strictEqual(p.keyframes.filter((k) => k.status === 'done').length, p.timing.segments.length);
  assert.strictEqual(p.clips.filter((c) => c.status === 'done').length, p.timing.segments.length);
  const info = await probe(path.join(p.dir, p.output.video));
  assert.ok(info.hasVideo && info.hasAudio, 'final has video+audio');
  assert.ok(Math.abs(info.duration - p.music.analysis.duration) < 0.3, `duration ${info.duration} vs ${p.music.analysis.duration}`);
  const srt = fs.readFileSync(path.join(p.dir, 'output', 'lyrics.srt'), 'utf8');
  assert.match(srt, /00:00:04,000 -->/);
  assert.ok(!/\[Verse/.test(srt), 'section tags are not subtitles');
  console.log(`final ${info.width}x${info.height} ${info.duration}s, clips=${p.timing.segments.length}, bpm=${p.music.analysis.bpm}`);
});

test('uploaded song with .lrc lyrics uses its timing without pausing', { timeout: 600000 }, async () => {
  const { root, store } = newStore();
  const song = path.join(root, 'my suno song.mp3');
  await demo.demoMusic({ part: 1, seconds: 36, bpm: 100, out: song });
  const lrc = ['[00:03.00]첫 줄 가사', '[00:08.50]둘째 줄', '[00:15.00]셋째 줄 노래', '[00:24.20]넷째 줄', '[00:30.00]마지막 줄'].join('\n');
  const wf = { ...store.getWorkflow('builtin-storybook'), minClips: 4, maxClips: 6 };
  const project = store.createProject('', wf, { songPath: song, lyricsText: lrc, lyricsFilename: 'song.lrc' });
  assert.strictEqual(project.song.name, 'my suno song.mp3');
  assert.strictEqual(project.lyricsInput.source, 'lrc');
  const runner = new ProjectRunner({ store, projectId: project.id });
  const logs = [];
  runner.on('log', (l) => logs.push(l.line));
  await runner.run();
  const p = runner.snapshot();
  assert.strictEqual(p.status, 'done', `${p.error}\n${logs.join('\n')}`);
  assert.strictEqual(p.timing.lyricsSource, 'lrc');
  assert.strictEqual(p.timing.lyrics[2].start, 15);
  assert.ok(Math.abs(p.music.analysis.duration - 36) < 0.5);
  const info = await probe(path.join(p.dir, p.output.video));
  assert.ok(Math.abs(info.duration - p.music.analysis.duration) < 0.3);
});
