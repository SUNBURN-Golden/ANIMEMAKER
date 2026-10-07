'use strict';
// 가사 자막을 예쁜 PNG 이미지로 그린다 (윈도우 기본 한글 글꼴 '맑은 고딕' 사용).
// Electron 의 보이지 않는 창에서 canvas 로 그리므로 글꼴 문제가 없다.
const fs = require('fs');
const path = require('path');

const HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<canvas id="c"></canvas>
<script>
window.renderLine = async function (text, o) {
  const c = document.getElementById('c');
  const ctx = c.getContext('2d');
  const font = 'bold ' + o.size + 'px "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif';
  ctx.font = font;
  try { await document.fonts.load(font, text); } catch (e) {}
  ctx.font = font;
  const maxW = o.w * 0.88;
  const words = String(text).split(/(\\s+)/);
  const lines = [];
  let cur = '';
  for (const wd of words) {
    const t = cur + wd;
    if (ctx.measureText(t.trim()).width > maxW && cur.trim()) { lines.push(cur.trim()); cur = wd.trimStart(); }
    else cur = t;
  }
  if (cur.trim()) lines.push(cur.trim());
  // 공백 없이 긴 줄은 글자 단위로 자르기
  const final = [];
  for (const ln of lines) {
    if (ctx.measureText(ln).width <= maxW) { final.push(ln); continue; }
    let part = '';
    for (const ch of ln) { if (ctx.measureText(part + ch).width > maxW) { final.push(part); part = ch; } else part += ch; }
    if (part) final.push(part);
  }
  const lh = Math.round(o.size * 1.3);
  const padX = Math.round(o.size * 0.6), padY = Math.round(o.size * 0.35);
  let textW = 0;
  for (const ln of final) textW = Math.max(textW, ctx.measureText(ln).width);
  c.width = Math.ceil(textW + padX * 2 + o.size * 0.4);
  c.height = Math.ceil(final.length * lh + padY * 2);
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (o.box) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    const r = Math.round(o.size * 0.35);
    ctx.beginPath();
    ctx.roundRect(0, 0, c.width, c.height, r);
    ctx.fill();
  }
  final.forEach((ln, i) => {
    const y = padY + lh * i + lh / 2;
    if (!o.box) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, o.size * 0.16);
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(ln, c.width / 2, y);
    }
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = o.size * 0.15;
    ctx.fillStyle = o.color === 'yellow' ? '#ffe14d' : '#ffffff';
    ctx.fillText(ln, c.width / 2, y);
    ctx.shadowBlur = 0;
  });
  return { url: c.toDataURL('image/png'), height: c.height, width: c.width };
};
</script></body></html>`;

/**
 * @param {{text:string,start:number,end:number}[]} lyrics
 * @returns {Promise<{file:string,start:number,end:number,y:number}[]>}
 */
async function renderSubtitlePngs(lyrics, { w, h, style = {}, outDir }) {
  const { BrowserWindow } = require('electron');
  fs.mkdirSync(outDir, { recursive: true });
  const win = new BrowserWindow({ show: false, width: 800, height: 400, webPreferences: { sandbox: true, contextIsolation: true } });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
    const size = Math.round(((style.sizePct || 4.6) / 100) * h);
    const margin = Math.round(((style.marginPct || 10) / 100) * h);
    const out = [];
    for (let i = 0; i < lyrics.length; i++) {
      const l = lyrics[i];
      const r = await win.webContents.executeJavaScript(
        `window.renderLine(${JSON.stringify(l.text)}, ${JSON.stringify({ w, size, color: style.color, box: !!style.box })})`,
      );
      const file = path.join(outDir, `line${String(i + 1).padStart(3, '0')}.png`);
      fs.writeFileSync(file, Buffer.from(r.url.split(',')[1], 'base64'));
      out.push({ file, start: l.start, end: l.end, y: Math.max(0, h - margin - r.height) });
    }
    return out;
  } finally {
    win.destroy();
  }
}

module.exports = { renderSubtitlePngs };
