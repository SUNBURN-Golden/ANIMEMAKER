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

test('demo pipeline produces a beat-synced music video with lyrics', { timeout: 600000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'animemaker-'));
  const store = new Store({ userDataDir: path.join(root, 'ud'), documentsDir: path.join(root, 'docs'), downloadsDir: path.join(root, 'dl') });
  const wf = { ...store.getWorkflow('builtin-anime-shorts'), partSeconds: 20 };
  const project = store.createProject('고양이가 우주정거장에서 라면을 끓이는 이야기', wf);
  const runner = new ProjectRunner({ store, projectId: project.id });
  const logs = [];
  runner.on('log', (l) => logs.push(l.line));
  await runner.run();
  const p = runner.snapshot();
  assert.strictEqual(p.status, 'done', `status=${p.status} error=${p.error}\n${logs.join('\n')}`);
  assert.ok(p.timing.segments.length >= 8, 'segments');
  // 컷 경계는 박자 위에 있어야 한다
  const beats = p.music.analysis.beats;
  for (const s of p.timing.segments.slice(1)) {
    assert.ok(beats.some((b) => Math.abs(b - s.start) < 0.01), `cut ${s.start} on beat`);
  }
  for (const s of p.timing.segments) assert.ok(s.duration >= 1 && s.duration <= 15, `len ${s.duration}`);
  assert.strictEqual(p.keyframes.filter((k) => k.status === 'done').length, p.timing.segments.length);
  assert.strictEqual(p.clips.filter((c) => c.status === 'done').length, p.timing.segments.length);
  const out = path.join(p.dir, p.output.video);
  const info = await probe(out);
  assert.ok(info.hasVideo && info.hasAudio, 'final has video+audio');
  assert.ok(Math.abs(info.duration - p.music.analysis.duration) < 0.3, `duration ${info.duration} vs ${p.music.analysis.duration}`);
  assert.ok(fs.readFileSync(path.join(p.dir, 'output', 'lyrics.srt'), 'utf8').includes('-->'));
  console.log(`final ${info.width}x${info.height} ${info.duration}s, clips=${p.timing.segments.length}, bpm=${p.music.analysis.bpm}`);
  console.log(`dir: ${p.dir}`);
});
