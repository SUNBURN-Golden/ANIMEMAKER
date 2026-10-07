// 폰 앱 작업 순서(계산 부분)만 Node 에서 검사한다 (브라우저 없이 빠르게)
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import * as PL from '../src/pipeline.js';

const require = createRequire(import.meta.url);
const { analyzeSamples, SR } = require('../../src/main/media/audio-analysis.js');

/** 120 BPM 킥이 있는 가짜 노래 → PC 앱과 같은 분석 */
function fakeAnalysis(seconds = 40) {
  const n = SR * seconds;
  const s = new Float32Array(n);
  const beat = 0.5;
  for (let i = 0; i < n; i++) {
    const k = (i / SR) % beat;
    s[i] = 0.8 * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-30 * k)) * k) * Math.exp(-9 * k);
  }
  return analyzeSamples(s, 120);
}

const PLAN = {
  title: '별빛 우체부', logline: 'l', concept: 'c', visual_style: 'soft anime',
  characters: [{ name: '하나', description_ko: '소녀', appearance_en: 'girl with a red cap' }],
  world_en: 'starry town',
  story: [{ act: 1, sections: ['Verse 1'], summary_ko: 'a', visual_en: 'a' }, { act: 2, sections: ['Chorus'], summary_ko: 'b', visual_en: 'b' }],
  music: { genre: 'pop', mood: 'bright' },
};

function ready() {
  const p = PL.newProject({ topic: '편지', lyricsRaw: '[Verse 1]\n별빛이 내리는 밤\n편지를 들고 달려\n[Chorus]\n하늘 높이 날아올라\n너에게 닿을 때까지' });
  PL.setAnalysis(p, fakeAnalysis());
  return p;
}

test('부탁 글에는 노래 정보와 "JSON 만" 요청이 들어간다', () => {
  const p = ready();
  const req = PL.planRequest(p);
  assert.match(req, /BPM/);
  assert.match(req, /별빛이 내리는 밤/);
  assert.match(req, /JSON only/);
});

test('AI 답장(설명 + 코드 상자)에서 기획안을 꺼내고, 이상한 답장은 알기 쉬운 오류', () => {
  const p = ready();
  assert.throws(() => PL.applyPlanReply(p, '죄송해요, 다시 말씀해 주세요'), /찾지 못했어요/);
  PL.applyPlanReply(p, `네! 여기요\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\`\n즐거운 작업 되세요`);
  assert.strictEqual(p.title, '별빛 우체부');
  assert.ok(PL.stepDone(p, 'story'));
  assert.strictEqual(PL.currentStep(p), 'timing');
});

test('컷 나누기 → 장면 설계 답장 → 컷마다 그림·영상 칸과 화면전환', () => {
  const p = ready();
  PL.applyPlanReply(p, JSON.stringify(PLAN));
  const segs = PL.cutSong(p);
  assert.ok(segs.length >= 3);
  assert.ok(Math.abs(segs[segs.length - 1].end - p.music.analysis.duration) < 0.01);
  const shots = segs.map((s, i) => ({ clip: s.index, subject: 'girl', action: `act ${i}`, transition_out: { type: i % 2 ? 'fade' : 'cut', beats: 1 } }));
  PL.applyShotsReply(p, JSON.stringify({ shots }));
  assert.strictEqual(p.items.length, segs.length);
  assert.ok(p.timing.transitions.some((t) => t.xfade === 'fade' && t.duration > 0));
  for (const it of p.items) assert.ok(it.need >= it.end - it.start - 1e-6);
  assert.strictEqual(PL.currentStep(p), 'pictures');
  // 캐릭터 기준 그림이 있으면 그림 부탁 글이 그걸 참고하라고 말한다
  assert.doesNotMatch(PL.pictureRequest(p, p.items[0]), /character reference/);
  p.sheet = { key: 'x' };
  assert.match(PL.pictureRequest(p, p.items[0]), /character reference/);
  assert.match(PL.videoRequest(p, p.items[0]), /starts from the attached picture/);
  // 그림을 다 넣으면 다음 단계
  for (const it of p.items) it.picture = { key: `k${it.clip}` };
  assert.strictEqual(PL.currentStep(p), 'moving');
  p.movingDone = true;
  assert.strictEqual(PL.currentStep(p), 'finish');
});

test('장면 설계를 다시 받아도 프롬프트가 같은 컷의 그림은 그대로 남는다', () => {
  const p = ready();
  PL.applyDemoPlan(p);
  PL.cutSong(p);
  PL.applyDemoShots(p);
  p.items[0].picture = { key: 'keep' };
  PL.applyDemoShots(p);
  assert.deepStrictEqual(p.items[0].picture, { key: 'keep' });
});

test('탭으로 맞춘 가사가 자막 시간이 되고, 가사를 고치면 완성 영상은 다시 만들어야 한다', () => {
  const p = ready();
  PL.applyDemoPlan(p);
  PL.cutSong(p);
  PL.setTapLyrics(p, p.timing.lyrics.map((l, i) => ({ ...l, start: 2 + i * 5, end: 6 + i * 5 })));
  assert.strictEqual(p.timing.lyricsSource, 'tap');
  assert.strictEqual(p.timing.lyrics[1].start, 7);
  assert.match(PL.srtText(p), /00:00:07,000 --> 00:00:11,000/);
  p.output = { key: 'o' };
  PL.setLyrics(p, '[Verse 1]\n바뀐 가사');
  assert.strictEqual(p.output, null);
});
