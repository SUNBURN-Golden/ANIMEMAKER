'use strict';
// 박자 분석 · 컷 나누기 · 가사 타이밍 · JSON 추출 단위 테스트
const test = require('node:test');
const assert = require('node:assert');
const { analyzeSamples, SR } = require('../src/main/media/audio');
const T = require('../src/main/media/timeline');
const { extractJson } = require('../src/main/ai/json');
const P = require('../src/main/pipeline/prompts');
const { BUILTIN_WORKFLOWS } = require('../src/main/defaults');

function synth(bpm, dur, offset = 0.37) {
  const n = Math.floor(dur * SR);
  const s = new Float32Array(n);
  const p = 60 / bpm;
  let k = 0;
  for (let i = 0; i < n; i++) s[i] = 0.05 * Math.sin((2 * Math.PI * 220 * i) / SR);
  for (let t = offset; t < dur; t += p, k++) {
    const st = Math.floor(t * SR);
    const acc = k % 4 === 0 ? 1 : 0.6;
    for (let i = 0; i < SR * 0.25 && st + i < n; i++) {
      const tt = i / SR;
      s[st + i] += acc * 0.8 * Math.exp(-tt * 18) * Math.sin(2 * Math.PI * (60 + 80 * Math.exp(-tt * 30)) * tt);
    }
  }
  return s;
}

test('tempo and beat phase are detected', () => {
  for (const bpm of [92, 120, 128]) {
    const a = analyzeSamples(synth(bpm, 40), bpm);
    assert.ok(Math.abs(a.bpm - bpm) < 2, `bpm ${a.bpm} vs ${bpm}`);
    const p = 60 / bpm;
    for (const b of a.beats.slice(3, 12)) {
      const r = (((b - 0.37) % p) + p) % p;
      assert.ok(Math.min(r, p - r) < 0.04, `beat phase ${b}`);
    }
    assert.ok(Math.abs(a.downbeats[0] - 0.37) < 0.05 || Math.abs(((a.downbeats[0] - 0.37) % (4 * p))) < 0.05, `downbeat ${a.downbeats[0]}`);
  }
});

test('segmentation respects beats, clip count and lengths', () => {
  const a = analyzeSamples(synth(110, 60), 110);
  const parts = [{ index: 1, start: 0, end: 30 }, { index: 2, start: 29, end: a.duration }];
  const lyrics = T.estimateLyricTiming(
    ['하나', '둘셋넷', '다섯 여섯', '일곱', '여덟 아홉', '열', '열하나', '열둘'].map((text, i) => ({ text, part: i < 4 ? 1 : 2 })), parts, a);
  assert.strictEqual(lyrics.length, 8);
  for (let i = 1; i < lyrics.length; i++) assert.ok(lyrics[i].start > lyrics[i - 1].start);
  const segs = T.segmentSong(a, lyrics, parts, { minClips: 10, maxClips: 15, maxLen: 14 });
  assert.ok(segs.length >= 10 && segs.length <= 15, `count ${segs.length}`);
  assert.ok(Math.abs(segs[0].start) < 1e-6 && Math.abs(segs[segs.length - 1].end - a.duration) < 1e-3);
  for (const s of segs) assert.ok(s.duration >= 1 && s.duration <= 14.001);
  for (const s of segs.slice(1)) assert.ok(a.beats.some((b) => Math.abs(b - s.start) < 1e-3));
  const shots = segs.map(() => ({ transition_out: { type: 'flash', beats: 1 } }));
  const tr = T.resolveTransitions(segs, shots, a.beatPeriod);
  const needs = T.clipNeeds(segs, tr);
  const total = needs.reduce((x, n) => x + n.need, 0) - tr.reduce((x, t) => x + t.duration, 0);
  assert.ok(Math.abs(total - a.duration) < 0.01, 'xfade overlaps keep total length');
  assert.ok(needs.every((n) => n.request >= 1 && n.request <= 15));
});

test('srt/lrc formatting', () => {
  const srt = T.toSrt([{ text: '안녕', start: 1.234, end: 3.5 }]);
  assert.match(srt, /00:00:01,234 --> 00:00:03,500/);
  assert.match(T.toLrc([{ text: 'hi', start: 61.5, end: 63 }], 't'), /\[01:01\.50\]hi/);
});

test('JSON extraction from messy LLM output', () => {
  const o = extractJson('blah ```json\n{"a": 1, "b": [1,2,],}\n``` end', (x) => x.a === 1);
  assert.deepStrictEqual(o, { a: 1, b: [1, 2] });
  const env = extractJson(JSON.stringify({ result: 'ok here {"shots": [{"clip": 1, "action": "run"}]} done' }), P.validShots);
  assert.strictEqual(env.shots[0].action, 'run');
  assert.strictEqual(extractJson('no json here'), undefined);
});

test('prompt composition uses the sentence template and characters', () => {
  const wf = BUILTIN_WORKFLOWS[0];
  const plan = P.normalizePlan({ title: 't', story: [], characters: [{ name: '미나', appearance_en: 'girl with red scarf' }], song_parts: [{ lyrics: ['a'] }], music: { bpm: '128' } }, wf);
  assert.strictEqual(plan.music.bpm, 128);
  assert.strictEqual(plan.song_parts.length, wf.musicParts);
  const kp = P.composeKeyframePrompt({ characters: ['미나'], subject: 'Mina', action: 'jumps', setting: 'rooftop', camera: 'wide shot', lighting: 'sunset' }, plan, wf);
  assert.match(kp, /girl with red scarf/);
  assert.match(kp, /jumps/);
  assert.match(kp, /No text/);
  assert.ok(!/\{\w+\}/.test(kp), 'no leftover placeholders');
});
