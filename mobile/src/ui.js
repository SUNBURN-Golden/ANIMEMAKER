// 화면 만들기 도우미 (작은 DOM 함수들)

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) add(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let toastBox = null;
export function toast(msg, kind = 'ok', ms = 3200) {
  if (!toastBox) { toastBox = h('div', { class: 'toasts' }); document.body.appendChild(toastBox); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  while (toastBox.children.length >= 3) toastBox.firstChild.remove();
  toastBox.appendChild(t);
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/** 아래에서 올라오는 창. buttons: [{label, kind, onClick}] (onClick 이 true 를 돌려주면 창을 닫지 않음) */
export function sheet(title, body, buttons = [{ label: '닫기' }], opts = {}) {
  return new Promise((resolve) => {
    const back = h('div', { class: 'sheet-back' });
    const close = (v) => { back.remove(); if (opts.onClose) opts.onClose(); resolve(v); };
    const btns = h('div', { class: 'sheet-btns' }, buttons.map((b, i) => h('button', {
      class: `btn ${b.kind || ''}`,
      onclick: async () => {
        if (b.onClick) { const keep = await b.onClick(); if (keep === true) return; }
        close(b.value !== undefined ? b.value : i);
      },
    }, b.label)));
    const box = h('div', { class: 'sheet' }, h('div', { class: 'sheet-title' }, title), h('div', { class: 'sheet-body' }, body), btns);
    back.appendChild(box);
    back.addEventListener('click', (e) => { if (e.target === back && !opts.sticky) close(null); });
    document.body.appendChild(back);
    sheet.closeTop = () => close(null);
  });
}

export function confirmBox(title, text, ok = '확인', cancel = '취소') {
  return sheet(title, h('p', { class: 'pre' }, text), [{ label: cancel, value: false }, { label: ok, kind: 'primary', value: true }]);
}

/** 오래 걸리는 일 동안 덮개 */
export function busy(msg) {
  const label = h('div', { class: 'busy-msg' }, msg);
  const bar = h('div', { class: 'bar' }, h('i', { style: { width: '0%' } }));
  const el = h('div', { class: 'busy' }, h('div', { class: 'busy-box' }, h('div', { class: 'spinner' }), label, bar));
  document.body.appendChild(el);
  return {
    set(m, frac) {
      if (m) label.textContent = m;
      if (frac != null) { bar.style.display = 'block'; bar.firstChild.style.width = `${Math.round(frac * 100)}%`; }
    },
    done() { el.remove(); },
  };
}

/** 파일 고르기 (accept 예: 'audio/*') */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    // 취소하면 아무 일도 일어나지 않는다 (기다리는 화면이 없으니 괜찮다)
    inp.addEventListener('change', () => { resolve(inp.files && inp.files[0] ? inp.files[0] : null); inp.remove(); });
    document.querySelectorAll('input.am-pick').forEach((x) => x.remove());
    inp.classList.add('am-pick');
    document.body.appendChild(inp);
    inp.click();
  });
}

export function fmtSize(n) {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

export function objectUrl(blob) {
  return blob ? URL.createObjectURL(blob) : '';
}
