// 체험 모드: AI 없이 폰 안에서 연습용 노래·그림을 만든다 (무료, 인터넷 없이)
const PALETTE = ['#ff5e62', '#ff9966', '#f9d423', '#7bc96f', '#4facfe', '#7c3aed', '#f472b6', '#22d3ee', '#a3e635', '#fb7185', '#60a5fa', '#fbbf24', '#34d399', '#c084fc', '#f87171'];

/** 박자가 분명한 체험용 음악 (킥 드럼 + 하이햇 + 화음) → WAV */
export async function demoSong({ seconds = 60, bpm = 120 } = {}) {
  const sr = 22050;
  const ctx = new OfflineAudioContext(1, Math.round(sr * seconds), sr);
  const beat = 60 / bpm;
  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);
  for (let t = 0, i = 0; t < seconds; t += beat, i++) {
    // 킥
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(i % 4 === 0 ? 0.95 : 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.3);
    // 하이햇 (엇박)
    const n = ctx.createOscillator();
    const ng = ctx.createGain();
    n.type = 'square';
    n.frequency.value = 6800;
    ng.gain.setValueAtTime(0.03, t + beat / 2);
    ng.gain.exponentialRampToValueAtTime(0.0005, t + beat / 2 + 0.04);
    n.connect(ng).connect(master);
    n.start(t + beat / 2);
    n.stop(t + beat / 2 + 0.05);
  }
  // 마디마다 바뀌는 화음
  const chords = [[261.63, 329.63, 392.0], [220.0, 277.18, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]];
  for (let t = 0, b = 0; t < seconds; t += beat * 4, b++) {
    for (const f of chords[b % chords.length]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.05);
      g.gain.linearRampToValueAtTime(0.03, t + beat * 4 - 0.05);
      g.gain.linearRampToValueAtTime(0.0001, t + beat * 4);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(Math.min(seconds, t + beat * 4));
    }
  }
  const buf = await ctx.startRendering();
  return new Blob([wav(buf)], { type: 'audio/wav' });
}

function wav(buf) {
  const data = buf.getChannelData(0);
  const out = new DataView(new ArrayBuffer(44 + data.length * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  out.setUint32(4, 36 + data.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true);
  return out.buffer;
}

/** 연습용 그림: 색 그라데이션 + 동그라미 + '컷 N' */
export async function demoPicture({ index = 0, w = 720, h = 1280, label = '' } = {}) {
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, PALETTE[index % PALETTE.length]);
  g.addColorStop(1, PALETTE[(index + 5) % PALETTE.length]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(w * (0.3 + 0.4 * ((index * 37) % 10) / 10), h * 0.58, Math.min(w, h) * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(w * 0.1, h * 0.1, w * 0.8, h * 0.03);
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(Math.min(w, h) * 0.09)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label || `컷 ${index + 1}`, w / 2, h * 0.3);
  if (c.convertToBlob) return c.convertToBlob({ type: 'image/png' });
  return new Promise((r) => c.toBlob(r, 'image/png'));
}
