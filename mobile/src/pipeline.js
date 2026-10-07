// 폰 앱의 작업 순서와 계산.
// 노래 분석·가사 타이밍·컷 나누기·프롬프트는 PC 앱 코드(src/main)를 그대로 쓴다.
import P from '../../src/main/pipeline/prompts.js';
import T from '../../src/main/media/timeline.js';
import L from '../../src/main/media/lyrics.js';
import J from '../../src/main/ai/json.js';
import D from '../../src/main/defaults.js';
import DD from '../../src/main/ai/demo-data.js';

export const WORKFLOWS = D.BUILTIN_WORKFLOWS;
export const TRANSITIONS = T.TRANSITIONS;
export const DEMO_LYRICS = DD.DEMO_LYRICS;
export const fmtTime = P.fmtTime;

export const STEPS = [
  { id: 'song', label: '노래', icon: '🎵' },
  { id: 'story', label: '이야기', icon: '📝' },
  { id: 'timing', label: '컷 나누기', icon: '✂️' },
  { id: 'pictures', label: '그림', icon: '🖼️' },
  { id: 'moving', label: '움직이기', icon: '🎞️' },
  { id: 'finish', label: '완성', icon: '🎬' },
];

/** 휴대폰 AI 앱에 보낼 때 붙이는 말: 설명 없이 JSON 만 받기 */
const JSON_ONLY = '\n\n(Reply with the JSON only, inside one ```json code block. No other text.)';

const ORIENT = { '9:16': 'vertical 9:16', '16:9': 'horizontal 16:9', '1:1': 'square 1:1', '4:5': 'vertical 4:5' };

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** 새 작품 */
export function newProject({ topic = '', wfId, lyricsRaw = '', lyricsName = '', demo = false } = {}) {
  const base = WORKFLOWS.find((w) => w.id === wfId) || WORKFLOWS[0];
  const now = Date.now();
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    title: topic || (demo ? '체험 뮤직비디오' : '새 뮤직비디오'),
    topic,
    demo,
    wf: { ...base, subtitles: { ...base.subtitles } },
    song: null, // { key, name, type }
    lyricsRaw,
    lyricsName,
    lyricsInput: L.parseLyrics(lyricsRaw, lyricsName),
    music: null,
    plan: null,
    timing: null,
    shots: null,
    items: [],
    sheet: null, // 캐릭터 기준 그림 { key }
    movingDone: false,
    output: null,
  };
}

export function setLyrics(p, raw, name = '') {
  p.lyricsRaw = raw;
  p.lyricsName = name;
  p.lyricsInput = L.parseLyrics(raw, name);
  if (p.timing) {
    // 바뀐 가사로 자막 줄을 다시 계산 (컷은 그대로 둔다)
    const c = computeLyrics(p);
    p.timing.lyrics = c.lyrics;
    p.timing.lyricsSource = c.source;
  }
  p.output = null;
}

/** 단계별 완료 여부 */
export function stepDone(p, id) {
  switch (id) {
    case 'song': return !!(p.music && p.music.analysis);
    case 'story': return !!p.plan;
    case 'timing': return !!(p.items && p.items.length);
    case 'pictures': return !!(p.items && p.items.length && p.items.every((it) => it.picture));
    case 'moving': return !!p.movingDone && stepDone(p, 'pictures');
    case 'finish': return !!p.output;
    default: return false;
  }
}

/** 지금 해야 할 단계 */
export function currentStep(p) {
  for (const s of STEPS) if (!stepDone(p, s.id)) return s.id;
  return 'finish';
}

// ---------- 1. 노래 ----------
export function setAnalysis(p, analysis) {
  p.music = { analysis, partRanges: [{ index: 1, start: 0, end: analysis.duration }] };
  p.timing = null;
  p.shots = null;
  p.items = [];
  p.output = null;
}

// ---------- 2. 이야기 (기획) ----------
export function planRequest(p) {
  return P.planPrompt(p.topic, L.sectionSummary(p.lyricsInput), p.music.analysis, p.wf) + JSON_ONLY;
}

export function applyPlanReply(p, text) {
  const o = J.extractJson(text, P.validPlan);
  if (!o) throw new Error('답장에서 이야기(기획안)를 찾지 못했어요. AI 답장 전체를 복사해서 다시 붙여 넣어 주세요.');
  setPlan(p, P.normalizePlan(o, p.wf));
}

export function applyDemoPlan(p) {
  setPlan(p, P.normalizePlan(DD.demoPlan(p.topic, p.wf), p.wf));
}

function setPlan(p, plan) {
  p.plan = plan;
  p.title = plan.title;
  p.shots = null;
  p.items = [];
  p.sheet = null;
  p.output = null;
  if (p.timing) delete p.timing.segments;
}

// ---------- 3. 컷 나누기 (타이밍) ----------
/** 올린 가사 → 자막 줄 + 시간 (시간이 든 가사 파일이면 그대로, 아니면 자동 추정) */
export function computeLyrics(p) {
  const li = p.lyricsInput || { lines: [] };
  const analysis = p.music.analysis;
  const withSection = (arr) => arr.map((t, i) => ({
    ...t, part: 1,
    section: (li.lines[i] && li.lines[i].section) || t.section || '',
    sectionStart: li.lines[i] ? !!li.lines[i].sectionStart : !!t.sectionStart,
  }));
  if (li.timed && li.timed.length) return { lyrics: withSection(li.timed), source: li.source };
  const est = T.estimateLyricTiming(li.lines.map((l) => ({ ...l, part: 1 })), p.music.partRanges, analysis, { trailingGaps: li.trailingGaps });
  return { lyrics: withSection(est), source: 'auto' };
}

/** 가사 타이밍 준비 (탭으로 맞춘 게 있으면 그대로) */
export function ensureLyrics(p) {
  if (p.timing && p.timing.lyrics && (p.timing.lyricsSource === 'tap' || p.timing.lyrics.length)) return p.timing.lyrics;
  const c = computeLyrics(p);
  p.timing = { ...(p.timing || {}), lyrics: c.lyrics, lyricsSource: c.source };
  return p.timing.lyrics;
}

/** 탭으로 맞춘 가사 저장 */
export function setTapLyrics(p, lines) {
  const prev = (p.timing && p.timing.lyrics) || [];
  p.timing = p.timing || {};
  p.timing.lyrics = lines.map((l, i) => ({
    text: String(l.text), part: 1, start: Number(l.start), end: Number(l.end),
    section: (prev[i] && prev[i].text === l.text ? prev[i].section : l.section) || '',
    sectionStart: !!(prev[i] && prev[i].text === l.text ? prev[i].sectionStart : l.sectionStart),
  })).filter((l) => l.text && l.end > l.start).sort((a, b) => a.start - b.start);
  p.timing.lyricsSource = 'tap';
  p.output = null;
}

/** 박자·가사에 맞춰 컷 경계를 정한다 */
export function cutSong(p) {
  const lyrics = ensureLyrics(p);
  const wf = p.wf;
  p.timing.segments = T.segmentSong(p.music.analysis, lyrics, p.music.partRanges, {
    minClips: wf.minClips, maxClips: wf.maxClips, minLen: wf.minClipSec, maxLen: wf.maxClipSec, pace: wf.pace,
  });
  p.shots = null;
  p.output = null;
  return p.timing.segments;
}

export function shotsRequest(p) {
  return P.shotsPrompt(p.plan, p.timing.segments, p.timing.lyrics, p.music.analysis, p.wf) + JSON_ONLY;
}

export function applyShotsReply(p, text) {
  const o = J.extractJson(text, P.validShots);
  if (!o) throw new Error('답장에서 장면 목록(샷 리스트)을 찾지 못했어요. AI 답장 전체를 복사해서 다시 붙여 넣어 주세요.');
  finishShots(p, P.normalizeShots(o, p.timing.segments));
}

export function applyDemoShots(p) {
  finishShots(p, P.normalizeShots(DD.demoShots(p.timing.segments, p.plan), p.timing.segments));
}

function finishShots(p, shots) {
  const segments = p.timing.segments;
  const transitions = T.resolveTransitions(segments, shots, p.music.analysis.beatPeriod);
  p.timing.transitions = transitions;
  p.timing.needs = T.clipNeeds(segments, transitions);
  p.shots = shots;
  buildItems(p);
}

/** 컷마다 그림·영상 작업 칸. 프롬프트가 같으면 이미 넣은 그림/영상을 그대로 둔다. */
export function buildItems(p) {
  const old = new Map((p.items || []).map((it) => [it.clip, it]));
  const a = p.music.analysis;
  p.items = p.timing.segments.map((seg, i) => {
    const shot = p.shots[i];
    const kfPrompt = P.composeKeyframePrompt(shot, p.plan, p.wf, 1);
    const vPrompt = P.composeVideoPrompt(shot, p.plan, p.wf, a, seg);
    const o = old.get(seg.index);
    const need = p.timing.needs[i];
    return {
      clip: seg.index,
      start: seg.start,
      end: seg.end,
      energy: seg.energy,
      kfPrompt,
      vPrompt,
      need: need.need,
      lead: need.lead,
      seconds: need.request,
      picture: o && o.kfPrompt === kfPrompt ? o.picture : null,
      video: o && o.vPrompt === vPrompt ? o.video : null,
    };
  });
  p.output = null;
}

// ---------- 4~5. AI 앱에 보낼 글 ----------
export function sheetRequest(p) {
  return `Please generate ONE image (${ORIENT[p.wf.aspect] || p.wf.aspect}).\n\n${P.characterSheetPrompt(p.plan, p.wf)}`;
}

export function pictureRequest(p, item) {
  const ref = p.sheet ? ' The attached picture is the character reference: keep exactly the same character design (face, hair, outfit, colors) and art style, but do not copy its pose or layout.' : '';
  return `Please generate ONE image (${ORIENT[p.wf.aspect] || p.wf.aspect}).${ref}\n\n${item.kfPrompt}`;
}

export function videoRequest(p, item) {
  const sec = Math.max(2, Math.min(15, Math.ceil(item.need)));
  return `Please make a ${sec}-second video (${ORIENT[p.wf.aspect] || p.wf.aspect}) that starts from the attached picture. Same characters and art style as the picture.\n\n${item.vPrompt}`;
}

// ---------- 6. 완성 ----------
export function outputName(p) {
  const t = String(p.title || 'AnimeMaker').replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'AnimeMaker';
  return `${t}.mp4`;
}

export function srtText(p) {
  return T.toSrt((p.timing && p.timing.lyrics) || []);
}
