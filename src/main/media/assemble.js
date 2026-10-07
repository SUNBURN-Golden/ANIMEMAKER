'use strict';
// 최종 편집: 클립 정리 → 화면전환으로 이어붙이기 → 하단 가사 자막 → 노래 깔기.
const fs = require('fs');
const path = require('path');
const { runFfmpeg, probe } = require('./ffmpeg');

const FPS = 30;

/** 화면 비율 + 화질 → 출력 해상도 */
function outputSize(aspect, quality = '720p') {
  const short = quality === '1080p' ? 1080 : 720;
  const long = Math.round((short * 16) / 9 / 2) * 2;
  switch (aspect) {
    case '16:9': return { w: long, h: short };
    case '1:1': return { w: short, h: short };
    case '4:5': return { w: short, h: Math.round((short * 5) / 4 / 2) * 2 };
    case '9:16':
    default: return { w: short, h: long };
  }
}

/**
 * 클립 하나를 정해진 크기/길이/프레임으로 맞춘다.
 * 영상이 없으면 키프레임 이미지를 천천히 확대하는 화면으로 대체한다.
 */
async function normalizeClip({ clip, keyframe, need, w, h, out, signal }) {
  const frames = Math.max(1, Math.round(need * FPS));
  if (clip && fs.existsSync(clip)) {
    const vf = [
      `scale=${w}:${h}:force_original_aspect_ratio=increase`,
      `crop=${w}:${h}`,
      'setsar=1',
      `fps=${FPS}`,
      'format=yuv420p',
      `tpad=stop_mode=clone:stop_duration=${(need + 1).toFixed(3)}`,
    ].join(',');
    await runFfmpeg(['-y', '-i', clip, '-vf', vf, '-frames:v', String(frames), '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(FPS), out], { signal });
    return { fallback: false };
  }
  if (keyframe && fs.existsSync(keyframe)) {
    const vf = [
      `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase`,
      `crop=${w * 2}:${h * 2}`,
      `zoompan=z='1+0.12*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${FPS}`,
      'setsar=1',
      'format=yuv420p',
    ].join(',');
    await runFfmpeg(['-y', '-i', keyframe, '-vf', vf, '-frames:v', String(frames), '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(FPS), out], { signal });
    return { fallback: true };
  }
  // 아무것도 없으면 검은 화면
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:r=${FPS}`, '-frames:v', String(frames),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', out], { signal });
  return { fallback: true };
}

/**
 * 여러 개의 음악 파트(예: 30초 곡 2개)를 하나의 노래로 잇는다.
 * 음악 '영상'(mp4)에서도 소리만 뽑아낸다.
 * @returns {{file:string, parts:{index:number,start:number,end:number}[], duration:number}}
 */
async function joinSongParts(files, out, { crossfade = 1.0, loudnorm = true, signal } = {}) {
  const durs = [];
  for (const f of files) durs.push((await probe(f)).duration);
  const args = ['-y'];
  files.forEach((f) => args.push('-i', f));
  const filters = [];
  files.forEach((_, i) => filters.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`));
  let cur = 'a0';
  const parts = [{ index: 1, start: 0, end: durs[0] }];
  let t = durs[0];
  for (let i = 1; i < files.length; i++) {
    const d = Math.min(crossfade, durs[i - 1] / 3, durs[i] / 3);
    const outLabel = `j${i}`;
    if (d >= 0.05) {
      filters.push(`[${cur}][a${i}]acrossfade=d=${d.toFixed(3)}:c1=tri:c2=tri[${outLabel}]`);
      t -= d;
    } else {
      filters.push(`[${cur}][a${i}]concat=n=2:v=0:a=1[${outLabel}]`);
    }
    parts.push({ index: i + 1, start: round3(t), end: round3(t + durs[i]) });
    t += durs[i];
    cur = outLabel;
  }
  filters.push(`[${cur}]${loudnorm ? 'loudnorm=I=-14:TP=-1.5:LRA=11,' : ''}aresample=44100[aout]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', out);
  await runFfmpeg(args, { signal });
  const info = await probe(out);
  parts[parts.length - 1].end = round3(info.duration);
  return { file: out, parts, duration: info.duration };
}

/** libass 용 ASS 자막 (PNG 자막을 만들 수 없을 때 사용) */
function buildAss(lyrics, { w, h, style = {} }) {
  const font = style.font || (process.platform === 'win32' ? 'Malgun Gothic' : 'Noto Sans CJK KR');
  const size = Math.round((style.sizePct || 4.2) / 100 * h);
  const margin = Math.round((style.marginPct || 8) / 100 * h);
  const primary = style.color === 'yellow' ? '&H0000E5FF' : '&H00FFFFFF';
  const box = style.box ? 3 : 1;
  const ts = (t) => {
    const cs = Math.max(0, Math.round(t * 100));
    const hh = Math.floor(cs / 360000);
    const mm = Math.floor((cs % 360000) / 6000);
    const ss = Math.floor((cs % 6000) / 100);
    return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
  };
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\n/g, '\\N');
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${w}`, `PlayResY: ${h}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Lyric,${font},${size},${primary},&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,${box},${Math.max(2, Math.round(size / 14))},1,2,${Math.round(w * 0.06)},${Math.round(w * 0.06)},${margin},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lyrics.map((l) => `Dialogue: 0,${ts(l.start)},${ts(l.end)},Lyric,,0,0,0,,{\\fad(120,120)}${esc(l.text)}`),
    '',
  ].join('\n');
}

/**
 * 최종 합치기.
 * @param {object} p
 * @param {string[]} p.clips 정리된(normalize) 클립 파일들 (순서대로)
 * @param {number[]} p.lengths 각 클립 길이(초)
 * @param {{xfade:string|null,duration:number}[]} p.transitions 클립 사이 전환 (clips.length-1 개)
 * @param {string} p.song 노래 파일
 * @param {number} p.total 최종 길이(초)
 * @param {{start:number,end:number,file:string,y:number}[]} [p.subtitlePngs] PNG 자막 (권장)
 * @param {string} [p.assFile] ASS 자막 (PNG 가 없을 때)
 */
async function assembleFinal(p) {
  const { clips, lengths, transitions, song, total, w, h, out, signal, onProgress } = p;
  const args = ['-y'];
  clips.forEach((c) => args.push('-i', c));
  const subs = p.subtitlePngs || [];
  subs.forEach((s) => args.push('-loop', '1', '-framerate', String(FPS), '-t', total.toFixed(3), '-i', s.file));
  const songIdx = clips.length + subs.length;
  if (song) args.push('-i', song);

  const f = [];
  // 모든 클립의 시간 기준(timebase)을 통일해야 xfade/concat 을 섞어 쓸 수 있다.
  clips.forEach((_, i) => f.push(`[${i}:v]setpts=PTS-STARTPTS,fps=${FPS},settb=1/${FPS}[c${i}]`));
  let cur = 'c0';
  let curLen = lengths[0];
  for (let i = 1; i < clips.length; i++) {
    const tr = transitions[i - 1] || { xfade: null, duration: 0 };
    const label = `v${i}`;
    if (tr.xfade && tr.duration > 0) {
      const off = Math.max(0, curLen - tr.duration);
      f.push(`[${cur}][c${i}]xfade=transition=${tr.xfade}:duration=${tr.duration.toFixed(3)}:offset=${off.toFixed(3)}[${label}]`);
      curLen = curLen + lengths[i] - tr.duration;
    } else {
      f.push(`[${cur}][c${i}]concat=n=2:v=1:a=0,settb=1/${FPS}[${label}]`);
      curLen += lengths[i];
    }
    cur = label;
  }
  // 길이를 정확히 맞추고(부족하면 마지막 장면 유지) 형식 고정
  f.push(`[${cur}]tpad=stop_mode=clone:stop_duration=2,trim=0:${total.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[base]`);
  cur = 'base';

  subs.forEach((s, k) => {
    const idx = clips.length + k;
    const fi = Math.min(0.15, (s.end - s.start) / 4);
    f.push(`[${idx}:v]format=rgba,fade=t=in:st=${s.start.toFixed(3)}:d=${fi.toFixed(3)}:alpha=1,fade=t=out:st=${(s.end - fi).toFixed(3)}:d=${fi.toFixed(3)}:alpha=1[s${k}]`);
    f.push(`[${cur}][s${k}]overlay=x=(W-w)/2:y=${Math.round(s.y)}:enable='between(t,${s.start.toFixed(3)},${s.end.toFixed(3)})':eof_action=pass[o${k}]`);
    cur = `o${k}`;
  });
  if (!subs.length && p.assFile) {
    // 필터 문자열 안의 윈도우 경로(C:)는 이스케이프가 까다로워서,
    // ffmpeg 를 자막 파일 폴더에서 실행하고 파일 이름만 넘긴다.
    const assName = path.basename(p.assFile).replace(/[^\w.-]/g, '_');
    if (assName !== path.basename(p.assFile)) fs.copyFileSync(p.assFile, path.join(path.dirname(p.assFile), assName));
    f.push(`[${cur}]ass=${assName}[subbed]`);
    cur = 'subbed';
  }
  f.push(`[${cur}]null[vout]`);
  if (song) {
    const fadeOut = Math.min(2, total / 10);
    f.push(`[${songIdx}:a]atrim=0:${total.toFixed(3)},apad=whole_dur=${total.toFixed(3)},afade=t=out:st=${(total - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}[aout]`);
  }
  args.push('-filter_complex', f.join(';'), '-map', '[vout]');
  if (song) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-r', String(FPS), '-pix_fmt', 'yuv420p',
    '-t', total.toFixed(3), '-movflags', '+faststart',
    '-metadata', 'comment=Made with AI (AnimeMaker)', '-metadata', 'description=AI-generated content', out);
  await runFfmpeg(args, {
    signal,
    cwd: !subs.length && p.assFile ? path.dirname(p.assFile) : undefined,
    onProgress: onProgress ? (s) => onProgress(Math.min(1, s / total)) : undefined,
  });
  return out;
}

/** 영상의 마지막 장면을 그림으로 저장 (긴 컷을 이어 만들 때 다음 조각의 시작 장면) */
async function lastFrame(video, out, { signal } = {}) {
  await runFfmpeg(['-y', '-sseof', '-3', '-i', video, '-update', '1', '-q:v', '2', out], { signal });
  if (!fs.existsSync(out)) throw new Error('마지막 장면을 뽑지 못했습니다.');
  return out;
}

/**
 * 조각 영상들을 하나로 잇는다. 두 번째 조각부터는 첫 프레임(앞 조각의 마지막 장면과 같음)을 뺀다.
 */
async function joinPieces(files, out, { signal } = {}) {
  if (files.length === 1) { fs.copyFileSync(files[0], out); return out; }
  const first = await probe(files[0]);
  const w = (first.width || 720) - ((first.width || 720) % 2);
  const h = (first.height || 1280) - ((first.height || 1280) % 2);
  const args = ['-y'];
  files.forEach((f) => args.push('-i', f));
  const f = files.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,fps=${FPS},format=yuv420p${i > 0 ? ',trim=start_frame=1,setpts=PTS-STARTPTS' : ''}[p${i}]`);
  f.push(`${files.map((_, i) => `[p${i}]`).join('')}concat=n=${files.length}:v=1:a=0[v]`);
  args.push('-filter_complex', f.join(';'), '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', out);
  await runFfmpeg(args, { signal });
  return out;
}

/** 키프레임/클립 미리보기용 썸네일 */
async function thumbnail(video, out, { signal } = {}) {
  await runFfmpeg(['-y', '-ss', '0.3', '-i', video, '-frames:v', '1', '-vf', 'scale=360:-2', out], { signal });
  return out;
}

function round3(x) { return Math.round(x * 1000) / 1000; }

module.exports = { outputSize, normalizeClip, joinSongParts, buildAss, assembleFinal, thumbnail, lastFrame, joinPieces, FPS };
