'use strict';
// 타이밍 설계: 가사 줄 타이밍 추정, 박자/마디에 맞춘 컷 나누기, 화면전환 길이 계산.

const TRANSITIONS = {
  cut: { label: '컷 (바로 전환)', xfade: null },
  fade: { label: '부드럽게 겹치기', xfade: 'fade' },
  dissolve: { label: '디졸브', xfade: 'dissolve' },
  fadeblack: { label: '검은 화면 거쳐서', xfade: 'fadeblack' },
  flash: { label: '하얀 플래시', xfade: 'fadewhite' },
  slideleft: { label: '왼쪽으로 밀기', xfade: 'slideleft' },
  slideup: { label: '위로 밀기', xfade: 'slideup' },
  wipeleft: { label: '닦아내기', xfade: 'wipeleft' },
  zoomin: { label: '확대하며 전환', xfade: 'zoomin' },
  circleopen: { label: '원형으로 열기', xfade: 'circleopen' },
  pixelize: { label: '픽셀 전환', xfade: 'pixelize' },
  smoothleft: { label: '스무스 슬라이드', xfade: 'smoothleft' },
};

/** 글자 수 기반 '부르는 길이' 가중치 (한글은 글자=음절, 영어는 모음 묶음) */
function syllables(text) {
  const hangul = (text.match(/[가-힣]/g) || []).length;
  const kana = (text.match(/[぀-ヿ一-鿿]/g) || []).length;
  const latinWords = text.replace(/[가-힣぀-ヿ一-鿿]/g, ' ').toLowerCase().match(/[a-z']+/g) || [];
  let latin = 0;
  for (const w of latinWords) latin += Math.max(1, (w.match(/[aeiouy]+/g) || []).length);
  return hangul + kana + latin;
}

function nearest(arr, t) {
  let best = arr[0];
  for (const x of arr) if (Math.abs(x - t) < Math.abs(best - t)) best = x;
  return best;
}

/**
 * 가사 줄 타이밍 자동 추정.
 * 각 파트(30초 곡 하나) 안에서 전주 1마디를 비우고, 글자 수 비율로 줄을 배치한 뒤 박자에 붙인다.
 * 정확한 싱크는 앱의 '탭으로 가사 맞추기' 로 다듬는다.
 * @param {{text:string, part:number}[]} lines
 * @param {{index:number,start:number,end:number}[]} parts
 * @param {{beats:number[],downbeats:number[],beatPeriod:number,duration:number}} analysis
 */
function estimateLyricTiming(lines, parts, analysis) {
  const out = [];
  const bar = analysis.beatPeriod * 4;
  for (const part of parts) {
    const pl = lines.map((l, i) => ({ ...l, i })).filter((l) => (l.part || 1) === part.index);
    if (!pl.length) continue;
    const firstDown = analysis.downbeats.find((d) => d >= part.start + 0.05) ?? part.start;
    const introBars = part.index === parts[0].index ? 1 : 0;
    let vs = introBars ? Math.min(part.start + bar * 1.0, part.end - 2) : part.start;
    vs = Math.max(vs, introBars ? firstDown : part.start);
    const ve = Math.max(vs + 1, part.end - Math.min(bar * 0.5, 2));
    const weights = pl.map((l) => syllables(l.text) + 3);
    const total = weights.reduce((a, b) => a + b, 0);
    let acc = vs;
    pl.forEach((l, k) => {
      const len = ((ve - vs) * weights[k]) / total;
      let start = analysis.beats.length ? nearest(analysis.beats, acc) : acc;
      if (start < part.start) start = acc;
      out[l.i] = { text: l.text, part: part.index, start: round2(start), end: 0 };
      acc += len;
    });
  }
  // end = 다음 줄 시작 직전 (최대 6초)
  const ordered = out.filter(Boolean).sort((a, b) => a.start - b.start);
  for (let k = 0; k < ordered.length; k++) {
    const next = ordered[k + 1];
    const partEnd = (parts.find((p) => p.index === ordered[k].part) || { end: analysis.duration }).end;
    const limit = next ? next.start - 0.05 : partEnd - 0.1;
    ordered[k].end = round2(Math.max(ordered[k].start + 0.8, Math.min(limit, ordered[k].start + 6)));
  }
  return out.filter(Boolean);
}

/**
 * 박자에 맞춘 컷 나누기 (동적계획법).
 * - 컷 경계는 반드시 박자 위에 놓이고, 마디 첫 박·가사 줄 시작·파트 경계를 우대한다.
 * - 각 컷 길이는 minLen~maxLen 초.
 * @returns {{index:number,start:number,end:number,duration:number,beats:number,lyrics:number[],part:number,energy:string}[]}
 */
function segmentSong(analysis, lyrics, parts, opts = {}) {
  const duration = analysis.duration;
  const minClips = opts.minClips ?? 10;
  const maxClips = opts.maxClips ?? 15;
  const minLen = Math.max(1, opts.minLen ?? 1);
  const maxLen = Math.min(15, opts.maxLen ?? 14);
  const pace = opts.pace || 'normal';
  const idealLen = opts.idealLen ?? ({ fast: 3.5, normal: 5, slow: 7 }[pace] || 5);

  const beatSet = analysis.beats.filter((t) => t > 0.2 && t < duration - 0.2);
  const cands = [0, ...beatSet, duration];
  const isDown = (t) => analysis.downbeats.some((d) => Math.abs(d - t) < 0.03);
  const lyricStarts = lyrics.map((l) => l.start);
  const partStarts = parts.slice(1).map((p) => p.start);
  const cutCost = cands.map((t, i) => {
    if (i === 0 || i === cands.length - 1) return 0;
    let c = 1.2;
    if (isDown(t)) c -= 0.9;
    if (lyricStarts.some((s) => Math.abs(s - t) < 0.12)) c -= 0.8;
    if (partStarts.some((s) => Math.abs(s - t) < analysis.beatPeriod * 0.6)) c -= 1.5;
    // 가사 줄 한가운데를 자르는 건 감점
    if (lyrics.some((l) => t > l.start + 0.3 && t < l.end - 0.3)) c += 0.4;
    return c;
  });

  let target = Math.round(duration / idealLen);
  target = Math.max(minClips, Math.min(maxClips, target));
  const feasibleMin = Math.ceil(duration / maxLen);
  const feasibleMax = Math.floor(duration / minLen);
  const kList = [];
  for (let k = minClips; k <= maxClips; k++) if (k >= feasibleMin && k <= feasibleMax) kList.push(k);
  if (!kList.length) kList.push(Math.max(1, Math.min(feasibleMax, Math.max(feasibleMin, target))));

  const segCost = (a, b) => {
    const len = cands[b] - cands[a];
    if (len < minLen - 1e-6 || len > maxLen + 1e-6) return Infinity;
    return ((len - idealLen) / idealLen) ** 2 * 2;
  };

  const n = cands.length;
  const maxK = Math.max(...kList);
  // dp[k][j] = 0 에서 j 까지 k 개 컷으로 나눈 최소 비용
  const dp = Array.from({ length: maxK + 1 }, () => new Float64Array(n).fill(Infinity));
  const from = Array.from({ length: maxK + 1 }, () => new Int32Array(n).fill(-1));
  dp[0][0] = 0;
  for (let k = 1; k <= maxK; k++) {
    for (let j = 1; j < n; j++) {
      for (let i = j - 1; i >= 0; i--) {
        if (cands[j] - cands[i] > maxLen + 1e-6) break;
        if (dp[k - 1][i] === Infinity) continue;
        const c = dp[k - 1][i] + segCost(i, j) + cutCost[j];
        if (c < dp[k][j]) { dp[k][j] = c; from[k][j] = i; }
      }
    }
  }
  let bestK = -1;
  let best = Infinity;
  for (const k of kList) {
    const c = dp[k][n - 1] + 0.15 * Math.abs(k - target);
    if (c < best) { best = c; bestK = k; }
  }
  if (bestK < 0) {
    // 박자로 나눌 수 없는 경우: 균등 분할
    const k = kList[0];
    const out = [];
    for (let i = 0; i < k; i++) out.push([(duration * i) / k, (duration * (i + 1)) / k]);
    return decorate(out, analysis, lyrics, parts);
  }
  const bounds = [];
  for (let k = bestK, j = n - 1; k > 0; k--) {
    const i = from[k][j];
    bounds.unshift([cands[i], cands[j]]);
    j = i;
  }
  return decorate(bounds, analysis, lyrics, parts);
}

function decorate(bounds, analysis, lyrics, parts) {
  return bounds.map(([s, e], idx) => {
    const lyr = [];
    lyrics.forEach((l, i) => {
      const overlap = Math.min(e, l.end) - Math.max(s, l.start);
      if (overlap > 0.25) lyr.push(i);
    });
    const part = (parts.find((p) => s + 0.01 >= p.start && s < p.end) || parts[0] || { index: 1 }).index;
    const bars = analysis.bars.filter((b) => b.start < e && b.end > s);
    const energy = bars.length ? bars.reduce((a, b) => a + b.energy, 0) / bars.length : 0.5;
    return {
      index: idx + 1,
      start: round3(s),
      end: round3(e),
      duration: round3(e - s),
      beats: Math.round((e - s) / analysis.beatPeriod),
      lyrics: lyr,
      part,
      energy: energy > 0.75 ? 'high' : energy > 0.45 ? 'mid' : 'low',
    };
  });
}

/**
 * 화면전환 정보를 검증하고 초 단위 길이를 붙인다.
 * 전환은 컷 경계(박자) 를 중심으로 겹친다: 앞 클립은 d/2 더 길게, 뒤 클립은 d/2 일찍 시작.
 */
function resolveTransitions(segments, shots, beatPeriod) {
  const res = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const raw = (shots[i] && shots[i].transition_out) || {};
    let type = String(raw.type || 'cut').toLowerCase();
    if (!TRANSITIONS[type]) type = 'cut';
    let beats = Number(raw.beats);
    if (!Number.isFinite(beats)) beats = type === 'cut' ? 0 : 0.5;
    beats = Math.max(0, Math.min(2, beats));
    let dur = TRANSITIONS[type].xfade ? Math.max(0.12, beats * beatPeriod) : 0;
    // 전환이 클립보다 길면 안 된다
    const maxDur = Math.min(segments[i].duration, segments[i + 1].duration) * 0.6;
    dur = Math.min(dur, maxDur);
    if (dur < 0.08) { type = 'cut'; dur = 0; }
    res.push({ type, xfade: TRANSITIONS[type].xfade, duration: round3(dur) });
  }
  return res;
}

/** 각 클립이 실제로 필요로 하는 길이 (전환 겹침 포함) 와 영상 생성 요청 길이 */
function clipNeeds(segments, transitions) {
  return segments.map((seg, i) => {
    const before = i > 0 ? transitions[i - 1].duration / 2 : 0;
    const after = i < transitions.length ? transitions[i].duration / 2 : 0;
    const need = seg.duration + before + after;
    const request = Math.max(1, Math.min(15, Math.ceil(need + 0.4)));
    return { need: round3(need), lead: round3(before), request };
  });
}

function toSrtTime(t) {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(r).padStart(3, '0')}`;
}

function toSrt(lyrics) {
  return lyrics
    .map((l, i) => `${i + 1}\n${toSrtTime(l.start)} --> ${toSrtTime(l.end)}\n${l.text}\n`)
    .join('\n');
}

function toLrc(lyrics, title) {
  const tag = (t) => {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2).padStart(5, '0');
    return `[${String(m).padStart(2, '0')}:${s}]`;
  };
  return [`[ti:${title || ''}]`, ...lyrics.map((l) => `${tag(l.start)}${l.text}`)].join('\n') + '\n';
}

function round2(x) { return Math.round(x * 100) / 100; }
function round3(x) { return Math.round(x * 1000) / 1000; }

module.exports = {
  TRANSITIONS, syllables, estimateLyricTiming, segmentSong, resolveTransitions, clipNeeds, toSrt, toLrc,
};
