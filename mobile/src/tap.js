// ⌨ 탭으로 가사 맞추기: 노래를 들으며 각 줄이 시작될 때 [지금!] 을 누른다
import { h, clear, sheet, toast, confirmBox } from './ui.js';

/**
 * @param {{text:string,start:number,end:number}[]} lyrics 지금 가사 줄
 * @param {Blob} songBlob
 * @param {number} duration
 * @returns {Promise<{text,start,end,section,sectionStart}[]|null>} 저장하면 새 줄들, 취소하면 null
 */
export function tapSync(lyrics, songBlob, duration) {
  const lines = lyrics.map((l) => ({ ...l }));
  const marks = lines.map((l) => l.start);
  let idx = 0;
  const url = URL.createObjectURL(songBlob);
  const audio = h('audio', { controls: true, src: url, preload: 'auto', style: { width: '100%' } });
  const progress = h('span', { class: 'muted small' });
  const now = h('div', { class: 'tap-now' });
  const next = h('div', { class: 'tap-next' });
  const list = h('div', { class: 'tap-lines' });
  const rate = h('select', { onchange: () => { audio.playbackRate = Number(rate.value); } },
    h('option', { value: '1' }, '보통 속도'), h('option', { value: '0.75' }, '0.75배'), h('option', { value: '0.5' }, '0.5배'));

  const render = () => {
    now.textContent = idx < lines.length ? lines[idx].text : '다 맞췄어요! [저장] 을 누르세요 🎉';
    next.textContent = idx + 1 < lines.length ? `다음: ${lines[idx + 1].text}` : '';
    progress.textContent = `${Math.min(idx, lines.length)} / ${lines.length} 줄`;
    clear(list);
    lines.forEach((l, i) => list.appendChild(h('div', { class: `tap-line ${i === idx ? 'cur' : ''} ${i < idx ? 'done' : ''}` },
      h('span', { class: 'tm' }, i === idx ? '▶' : marks[i].toFixed(1)), l.text)));
    const c = list.children[idx];
    if (c) c.scrollIntoView({ block: 'nearest' });
  };
  const tap = () => {
    if (idx >= lines.length) return;
    if (audio.paused) { toast('먼저 ▶ 재생을 눌러 노래를 틀어 주세요', 'warn'); return; }
    marks[idx] = Math.max(0, audio.currentTime - 0.12 * audio.playbackRate);
    idx++;
    if (navigator.vibrate) navigator.vibrate(25);
    render();
  };
  const undo = () => {
    if (idx === 0) return;
    idx--;
    audio.currentTime = Math.max(0, marks[idx] - 2);
    render();
  };
  render();

  let result = null;
  return sheet('⌨ 탭으로 가사 맞추기', h('div', null,
    h('p', { class: 'small' }, '▶ 로 노래를 틀고, 가사 줄이 ', h('b', null, '시작되는 순간'), '마다 아래 큰 [지금!] 버튼을 누르세요. 틀리면 [한 줄 되돌리기].'),
    audio,
    h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { idx = 0; audio.currentTime = 0; audio.play(); render(); } }, '⏮ 처음부터'), rate, progress),
    now, next,
    h('div', { class: 'row tap-btns' },
      h('button', { class: 'btn', onclick: undo }, '↩ 한 줄 되돌리기'),
      h('button', { class: 'btn primary tap-big', onclick: tap }, '지금!')),
    list,
  ), [
    { label: '취소', value: null },
    {
      label: '💾 저장',
      kind: 'primary',
      onClick: async () => {
        for (let i = 1; i < marks.length; i++) {
          if (marks[i] <= marks[i - 1]) { toast(`${i + 1}번째 줄 시간이 앞 줄보다 빨라요. 다시 맞춰 주세요.`, 'err'); return true; }
        }
        if (idx < lines.length && !await confirmBox('아직 다 안 맞췄어요', `${lines.length}줄 중 ${idx}줄만 맞췄어요. 나머지 줄은 원래 시간으로 저장할까요?`, '그대로 저장')) return true;
        result = lines.map((l, i) => ({
          text: l.text, section: l.section, sectionStart: l.sectionStart, start: marks[i],
          end: Math.min(i + 1 < marks.length ? marks[i + 1] - 0.05 : duration - 0.1, marks[i] + 7),
        }));
        return false;
      },
    },
  ], { sticky: true, onClose: () => { audio.pause(); URL.revokeObjectURL(url); } }).then(() => result);
}
