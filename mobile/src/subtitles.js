// 가사 자막 그리기 (PC 앱 src/main/subtitles.js 와 같은 모양: 굵은 흰 글씨 + 검은 테두리, 또는 반투명 상자)

const FONT_FAMILY = '"Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** 한 줄 가사를 그림으로 (화면 너비의 88% 안에서 줄바꿈) */
export function renderLine(text, { w, size, color, box }) {
  const font = `bold ${size}px ${FONT_FAMILY}`;
  const m = makeCanvas(8, 8).getContext('2d');
  m.font = font;
  const maxW = w * 0.88;
  const lines = [];
  let cur = '';
  for (const wd of String(text).split(/(\s+)/)) {
    const t = cur + wd;
    if (m.measureText(t.trim()).width > maxW && cur.trim()) { lines.push(cur.trim()); cur = wd.trimStart(); } else cur = t;
  }
  if (cur.trim()) lines.push(cur.trim());
  // 공백 없이 긴 줄은 글자 단위로 자르기
  const final = [];
  for (const ln of lines) {
    if (m.measureText(ln).width <= maxW) { final.push(ln); continue; }
    let part = '';
    for (const ch of ln) { if (m.measureText(part + ch).width > maxW) { final.push(part); part = ch; } else part += ch; }
    if (part) final.push(part);
  }
  const lh = Math.round(size * 1.3);
  const padX = Math.round(size * 0.6);
  const padY = Math.round(size * 0.35);
  let textW = 0;
  for (const ln of final) textW = Math.max(textW, m.measureText(ln).width);
  const c = makeCanvas(Math.ceil(textW + padX * 2 + size * 0.4), Math.ceil(final.length * lh + padY * 2));
  const ctx = c.getContext('2d');
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (box) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const r = Math.round(size * 0.35);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, 0, c.width, c.height, r); else ctx.rect(0, 0, c.width, c.height);
    ctx.fill();
  }
  final.forEach((ln, i) => {
    const y = padY + lh * i + lh / 2;
    if (!box) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, size * 0.16);
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(ln, c.width / 2, y);
    }
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = size * 0.15;
    ctx.fillStyle = color === 'yellow' ? '#ffe14d' : '#ffffff';
    ctx.fillText(ln, c.width / 2, y);
    ctx.shadowBlur = 0;
  });
  return c;
}

/** 자막 그리개: 시간 t 에 맞는 가사 줄을 아래쪽에 그린다 (0.12초 페이드) */
export function subtitleDrawer(lyrics, { w, h, style = {} }) {
  if (!style.enabled && style.enabled !== undefined) return () => {};
  const size = Math.round(((style.sizePct || 4.6) / 100) * h);
  const margin = Math.round(((style.marginPct || 10) / 100) * h);
  const lines = (lyrics || []).filter((l) => l && l.text && l.end > l.start).map((l) => ({ ...l, img: null }));
  const FADE = 0.12;
  return (ctx, t) => {
    for (const l of lines) {
      if (t < l.start || t >= l.end) continue;
      if (!l.img) l.img = renderLine(l.text, { w, size, color: style.color, box: !!style.box });
      const a = Math.min(1, (t - l.start) / FADE, (l.end - t) / FADE);
      ctx.save();
      ctx.globalAlpha = Math.max(0, a);
      ctx.drawImage(l.img, Math.round((w - l.img.width) / 2), Math.max(0, h - margin - l.img.height));
      ctx.restore();
    }
  };
}
