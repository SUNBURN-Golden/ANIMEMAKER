'use strict';
// 업로드한 가사 읽기
//  - Suno 가사: [Verse 1], [Chorus] 같은 구간 태그 + 가사 줄
//  - .lrc: [01:23.45]가사   (시간이 있어서 싱크가 바로 맞음)
//  - .srt: 자막 파일        (시간이 있어서 싱크가 바로 맞음)

// Suno 는 [Verse 1] 처럼 대괄호로 구간을 적는다. (괄호 줄은 코러스·추임새 가사로 본다)
const SECTION_RE = /^\s*[[【]\s*([^\]】]{1,40})\s*[\]】]\s*$/;
const LRC_RE = /^\s*((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/;
const LRC_TAG_RE = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const SRT_TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

/** 구간 이름 중 가사가 없는 구간(간주 등) */
const INSTRUMENTAL_RE = /(intro|outro|instrumental|inst|interlude|break|solo|drop|간주|전주|후주|인트로|아웃트로)/i;

function cleanLine(s) {
  return String(s)
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function frac(ms) {
  if (!ms) return 0;
  return Number(`0.${ms.padEnd(3, '0').slice(0, 3)}`);
}

function parseLrc(text) {
  const timed = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = LRC_RE.exec(raw);
    if (!m) continue;
    const line = cleanLine(m[2]);
    LRC_TAG_RE.lastIndex = 0;
    let t;
    while ((t = LRC_TAG_RE.exec(m[1]))) {
      const start = Number(t[1]) * 60 + Number(t[2]) + frac(t[3]);
      timed.push({ text: line, start });
    }
  }
  timed.sort((a, b) => a.start - b.start);
  // 빈 줄 태그는 앞 줄의 끝 시간으로 쓴다
  const out = [];
  for (let i = 0; i < timed.length; i++) {
    if (!timed[i].text) continue;
    const next = timed[i + 1];
    const end = next ? next.start - 0.05 : timed[i].start + 4;
    out.push({ text: timed[i].text, start: round2(timed[i].start), end: round2(Math.min(end, timed[i].start + 8)) });
  }
  return out;
}

function parseSrt(text) {
  const out = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    const ti = lines.findIndex((l) => SRT_TIME_RE.test(l));
    if (ti < 0) continue;
    const m = SRT_TIME_RE.exec(lines[ti]);
    const start = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac(m[4]);
    const end = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + frac(m[8]);
    const body = cleanLine(lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, ''));
    if (body && end > start) out.push({ text: body, start: round2(start), end: round2(end) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * @param {string} text 가사 원문
 * @param {string} [filename] 파일에서 불러왔다면 파일 이름 (확장자로 형식 판단)
 * @returns {{raw:string, source:'text'|'lrc'|'srt'|'none', lines:{text:string, section:string, sectionStart:boolean}[], timed:{text:string,start:number,end:number}[]|null, sections:string[]}}
 */
function parseLyrics(text, filename) {
  const raw = String(text || '').replace(/^﻿/, '');
  const ext = (filename || '').toLowerCase().split('.').pop();
  if (!raw.trim()) return { raw: '', source: 'none', lines: [], timed: null, sections: [] };

  const looksSrt = ext === 'srt' || (SRT_TIME_RE.test(raw) && /-->/.test(raw));
  const lrcHits = raw.split(/\r?\n/).filter((l) => LRC_RE.test(l)).length;
  const looksLrc = ext === 'lrc' || lrcHits >= 3;
  if (looksSrt || looksLrc) {
    const timed = looksSrt ? parseSrt(raw) : parseLrc(raw);
    if (timed.length) {
      return {
        raw, source: looksSrt ? 'srt' : 'lrc', timed, sections: [],
        lines: timed.map((t, i) => ({ text: t.text, section: '', sectionStart: i === 0 })),
      };
    }
  }

  const lines = [];
  const sections = [];
  let section = '';
  let fresh = true;
  let gaps = 0; // 바로 앞에 있던 '가사 없는 구간'(전주·간주) 수
  for (const r of raw.split(/\r?\n/)) {
    const s = r.trim();
    if (!s) continue;
    const sec = SECTION_RE.exec(s);
    if (sec) {
      // 앞 구간이 가사 없이 끝났으면 그 구간은 연주 구간
      if (fresh && section) gaps++;
      section = sec[1].trim();
      sections.push(section);
      fresh = true;
      continue;
    }
    const text = cleanLine(s);
    if (!text) continue;
    lines.push({ text, section, sectionStart: fresh, gapBefore: gaps });
    gaps = 0;
    fresh = false;
  }
  const trailingGaps = gaps + (fresh && section ? 1 : 0);
  return { raw, source: 'text', lines, timed: null, sections, trailingGaps };
}

/** 노래 구조 요약 (오케스트레이터에게 알려 줄 용도) */
function sectionSummary(parsed) {
  if (!parsed || !parsed.lines.length) return '(가사 없음 - 연주곡)';
  const groups = [];
  for (const l of parsed.lines) {
    if (l.sectionStart || !groups.length) groups.push({ section: l.section || '', lines: [] });
    groups[groups.length - 1].lines.push(l.text);
  }
  return groups.map((g) => `${g.section ? `[${g.section}]` : ''}\n${g.lines.join('\n')}`).join('\n\n').trim();
}

function round2(x) { return Math.round(x * 100) / 100; }

module.exports = { parseLyrics, sectionSummary, INSTRUMENTAL_RE };
