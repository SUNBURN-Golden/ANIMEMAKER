'use strict';
// 체험 모드: AI 없이 내 PC 에서 가짜 결과물을 만들어 전체 흐름을 무료로 확인한다.
const { runFfmpeg } = require('../media/ffmpeg');
const { PALETTE, DEMO_LYRICS, demoPlan, demoShots } = require('./demo-data');

async function demoImage({ index = 0, slot = 1, w = 720, h = 1280, out, signal }) {
  const c0 = PALETTE[index % PALETTE.length];
  const c1 = PALETTE[(index + 5 + slot) % PALETTE.length];
  const bx = Math.round(w * (0.15 + 0.25 * (slot - 1)));
  const vf = [
    `drawbox=x=${bx}:y=${Math.round(h * 0.55)}:w=${Math.round(w * 0.3)}:h=${Math.round(w * 0.3)}:color=white@0.85:t=fill`,
    `drawbox=x=${Math.round(w * 0.1)}:y=${Math.round(h * 0.1)}:w=${Math.round(w * 0.8)}:h=${Math.round(h * 0.03)}:color=black@0.35:t=fill`,
  ].join(',');
  try {
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=0x${c0}:c1=0x${c1}:x0=0:y0=0:x1=${w}:y1=${h}:d=1`, '-vf', vf, '-frames:v', '1', out], { signal });
  } catch (_) {
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', `color=c=0x${c0}:s=${w}x${h}:d=1`, '-vf', vf, '-frames:v', '1', out], { signal });
  }
  return out;
}

async function demoVideo({ image, seconds, w = 720, h = 1280, out, signal }) {
  const frames = Math.round(seconds * 24);
  await runFfmpeg(['-y', '-i', image, '-vf',
    `scale=${w * 2}:${h * 2},zoompan=z='1+0.25*on/${frames}':x='iw/2-(iw/zoom/2)+20*sin(on/12)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=24,format=yuv420p`,
    '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', out], { signal });
  return out;
}

/** 박자가 분명한 체험용 음악 (킥 드럼 + 화음) */
async function demoMusic({ part = 1, seconds = 30, bpm = 120, out, signal }) {
  const p = (60 / bpm).toFixed(5);
  const bar = (240 / bpm).toFixed(5);
  const chords = part % 2 ? [261.63, 329.63, 392.0] : [220.0, 277.18, 329.63];
  const pad = chords.map((f, i) => `${(0.07 - i * 0.01).toFixed(3)}*sin(2*PI*${f}*t)`).join('+');
  const kick = `(1+0.6*lt(mod(t,${bar}),${p}))*0.55*sin(2*PI*(50+90*exp(-30*mod(t,${p})))*mod(t,${p}))*exp(-9*mod(t,${p}))`;
  const hat = `0.05*sin(2*PI*7000*t+30*sin(2*PI*3100*t))*exp(-60*mod(t+${(60 / bpm / 2).toFixed(5)},${p}))`;
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', `aevalsrc='${kick}+${hat}+${pad}':s=44100:d=${seconds}`,
    '-af', 'afade=t=in:d=0.3,volume=0.9', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', out], { signal });
  return out;
}

module.exports = { DEMO_LYRICS, demoPlan, demoShots, demoImage, demoVideo, demoMusic };
