// 폰 안에서 최종 영상 만들기 (설치형 프로그램 없이, 폰의 영상 인코더를 쓰는 WebCodecs 로)
// 컷 이어붙이기 + 박자에 맞춘 화면전환 + 아래쪽 가사 자막 + 노래 → MP4
import {
  Output, Mp4OutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  Input, BlobSource, ALL_FORMATS, CanvasSink, getFirstEncodableVideoCodec, getFirstEncodableAudioCodec,
} from 'mediabunny';
import { drawTransition } from './transitions.js';
import { subtitleDrawer } from './subtitles.js';

export const FPS = 30;

/** 화면 비율 + 화질 → 출력 크기 (PC 앱 outputSize 와 같음) */
export function outputSize(aspect, quality = '720p') {
  const short = quality === '1080p' ? 1080 : 720;
  const long = Math.round((short * 16) / 9 / 2) * 2;
  switch (aspect) {
    case '16:9': return { w: long, h: short };
    case '1:1': return { w: short, h: short };
    case '4:5': return { w: short, h: Math.round((short * 5) / 4 / 2) * 2 };
    default: return { w: short, h: long };
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** 그림을 화면에 꽉 차게(cover) 그린 캔버스 */
function coverCanvas(img, w, h, scale = 1.25) {
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const c = makeCanvas(cw, ch);
  const ctx = c.getContext('2d');
  const s = Math.max(cw / img.width, ch / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  return c;
}

/**
 * 컷 하나의 화면 공급기. frame(local) 은 컷 안의 시간(초)에 맞는 그림을 돌려준다.
 * - 영상이 있으면 영상 프레임 (짧으면 최대 0.5배까지 느리게, 그래도 모자라면 마지막 장면 유지)
 * - 그림만 있으면 천천히 확대 (PC 앱의 zoompan 과 같은 12%)
 */
async function makeShotSource(item, w, h, frameTimes) {
  const tmp = makeCanvas(w, h);
  const tctx = tmp.getContext('2d');
  if (item.videoBlob) {
    try {
      const input = new Input({ source: new BlobSource(item.videoBlob), formats: ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (track && await track.canDecode()) {
        const vd = Math.max(0.1, await track.computeDuration());
        const rate = Math.max(0.5, Math.min(1, vd / Math.max(0.1, item.need)));
        const first = await track.getFirstTimestamp();
        const times = frameTimes.map((t) => first + Math.min(t * rate, vd - 0.04));
        const sink = new CanvasSink(track, { width: w, height: h, fit: 'cover', poolSize: 3 });
        const it = sink.canvasesAtTimestamps(times);
        let last = null;
        return {
          async next() {
            const r = await it.next();
            if (!r.done && r.value) last = r.value.canvas;
            if (!last) { tctx.fillStyle = '#000'; tctx.fillRect(0, 0, w, h); return tmp; }
            return last;
          },
          close() { it.return && it.return(); input.dispose && input.dispose(); },
          video: true,
        };
      }
      if (input.dispose) input.dispose();
    } catch (e) {
      console.warn('영상을 읽지 못해 그림으로 대신합니다', e);
    }
  }
  const bmp = item.pictureBlob ? await createImageBitmap(item.pictureBlob) : null;
  const big = bmp ? coverCanvas(bmp, w, h) : null;
  if (bmp && bmp.close) bmp.close();
  let k = 0;
  const n = Math.max(1, frameTimes.length);
  return {
    async next() {
      const prog = Math.min(1, k++ / n);
      if (!big) { tctx.fillStyle = '#111'; tctx.fillRect(0, 0, w, h); return tmp; }
      // big 은 화면의 1.25배. 1.0배 → 1.12배로 천천히 확대
      const z = 1 + 0.12 * prog;
      const sw = big.width / 1.25 / z;
      const sh = big.height / 1.25 / z;
      tctx.drawImage(big, (big.width - sw) / 2, (big.height - sh) / 2, sw, sh, 0, 0, w, h);
      return tmp;
    },
    close() {},
    video: false,
  };
}

/** 사용할 수 있는 코덱 고르기 (H.264+AAC 우선, 안 되면 VP9/AV1 + Opus) */
export async function pickCodecs(w, h, sampleRate, channels) {
  const video = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: w, height: h });
  const audio = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: channels, sampleRate });
  return { video, audio };
}

/**
 * @param {object} o
 * @param {{start:number,end:number,need:number,lead:number,pictureBlob?:Blob,videoBlob?:Blob}[]} o.items 컷들 (순서대로)
 * @param {{xfade:string|null,duration:number}[]} o.transitions 컷 사이 전환
 * @param {{text:string,start:number,end:number}[]} o.lyrics 자막
 * @param {AudioBuffer} o.song 노래
 * @param {number} o.duration 전체 길이(초)
 * @returns {Promise<{blob:Blob, codecs:{video:string,audio:string}, frames:number}>}
 */
export async function renderVideo(o) {
  const { w, h } = o.size;
  const fps = o.fps || FPS;
  const total = Math.max(1, Math.round(o.duration * fps));
  const codecs = await pickCodecs(w, h, o.song ? o.song.sampleRate : 48000, o.song ? Math.min(2, o.song.numberOfChannels) : 2);
  if (!codecs.video) throw new Error('이 폰에서는 영상 만들기(인코딩)를 지원하지 않아요. 안드로이드 시스템 WebView / Chrome 을 최신으로 업데이트해 주세요.');

  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d', { alpha: false });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vsrc = new CanvasSource(canvas, { codec: codecs.video, bitrate: o.bitrate || (h * w >= 1920 * 1080 * 0.9 ? 10e6 : 6e6), keyFrameInterval: 2 });
  output.addVideoTrack(vsrc, { frameRate: fps });
  let asrc = null;
  if (o.song && codecs.audio) {
    asrc = new AudioBufferSource({ codec: codecs.audio, bitrate: 192e3 });
    output.addAudioTrack(asrc);
  }
  await output.start();
  // 노래는 1초씩 잘라 영상과 번갈아 넣는다 (메모리를 덜 쓰고, 영상·소리 순서를 맞추기 위해)
  let audioAt = 0;
  const feedAudio = async (until) => {
    if (!asrc) return;
    const sr = o.song.sampleRate;
    const chans = Math.min(2, o.song.numberOfChannels);
    while (audioAt < o.song.length && audioAt / sr < until) {
      const len = Math.min(sr, o.song.length - audioAt);
      const part = new AudioBuffer({ length: len, numberOfChannels: chans, sampleRate: sr });
      for (let c = 0; c < chans; c++) part.copyToChannel(o.song.getChannelData(c).subarray(audioAt, audioAt + len), c);
      audioAt += len;
      await asrc.add(part);
    }
  };

  // 컷마다 시작/끝 (전환 길이의 반만큼 앞뒤로 겹침) — PC 앱 clipNeeds 와 같은 규칙
  const shots = o.items.map((it, i) => {
    const before = i > 0 ? (o.transitions[i - 1] || {}).duration / 2 || 0 : 0;
    const after = i < o.transitions.length ? (o.transitions[i] || {}).duration / 2 || 0 : 0;
    return { it, from: it.start - before, to: it.end + after, src: null };
  });
  const drawSub = subtitleDrawer(o.lyrics, { w, h, style: o.subtitles || {} });

  const open = async (s) => {
    if (s.src) return s.src;
    const first = Math.max(0, Math.ceil(s.from * fps));
    const last = Math.min(total - 1, Math.ceil(s.to * fps) - 1);
    const times = [];
    for (let f = first; f <= last; f++) times.push(Math.max(0, f / fps - s.from));
    s.src = await makeShotSource({ ...s.it, need: s.to - s.from }, w, h, times);
    s.frames = times.length;
    return s.src;
  };
  const shotFrame = async (s) => (await open(s)).next();

  try {
    let cur = 0;
    for (let f = 0; f < total; f++) {
      if (o.signal && o.signal.aborted) throw Object.assign(new Error('멈췄어요'), { name: 'AbortError' });
      const t = f / fps;
      while (cur < shots.length - 1 && t >= shots[cur + 1].it.start + ((o.transitions[cur] || {}).duration || 0) / 2) {
        if (shots[cur].src) shots[cur].src.close();
        shots[cur].src = null;
        cur++;
      }
      const s = shots[cur];
      const nxt = shots[cur + 1];
      const tr = o.transitions[cur];
      if (nxt && tr && tr.xfade && tr.duration > 0 && t >= nxt.from) {
        const a = await shotFrame(s);
        const b = await shotFrame(nxt);
        drawTransition(ctx, tr.xfade, a, b, (t - nxt.from) / tr.duration, w, h);
      } else {
        ctx.drawImage(await shotFrame(s), 0, 0, w, h);
      }
      drawSub(ctx, t);
      await feedAudio(t + 1);
      await vsrc.add(t, 1 / fps);
      if (o.onProgress && (f % 10 === 0 || f === total - 1)) o.onProgress((f + 1) / total);
    }
    await feedAudio(Infinity);
    await output.finalize();
  } catch (e) {
    try { await output.cancel(); } catch (_) { /* noop */ }
    throw e;
  } finally {
    for (const s of shots) if (s.src) s.src.close();
  }
  return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), codecs, frames: total };
}
