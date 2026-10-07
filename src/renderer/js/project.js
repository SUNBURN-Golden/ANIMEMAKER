'use strict';
/* 진행 화면: 단계 진행, 도우미 안내, 결과물 확인·수정 */
(function (AM) {
  const { h, clear, toast } = AM;
  AM.views = AM.views || {};

  let cur = null; // { id, snap, els, tab, userTab, sigs }

  const TABS = [
    { id: 'timing', label: '🎵 노래·가사·타이밍' },
    { id: 'plan', label: '📝 기획' },
    { id: 'keyframes', label: '🖼️ 키프레임' },
    { id: 'clips', label: '🎞️ 영상 클립' },
    { id: 'final', label: '✨ 완성 영상' },
    { id: 'log', label: '📜 진행 기록' },
  ];

  function tabForStep(step, status) {
    if (status === 'done') return 'final';
    return { music: 'timing', plan: 'plan', timing: 'timing', keyframes: 'keyframes', clips: 'clips', edit: 'final' }[step] || 'timing';
  }

  function abs(snap, rel) { return AM.joinPath(snap.dir, rel); }
  function url(snap, rel, v) { return AM.fileUrl(abs(snap, rel), v); }
  function aspectCss(a) { return ({ '9:16': '9 / 16', '16:9': '16 / 9', '1:1': '1 / 1', '4:5': '4 / 5' })[a] || '9 / 16'; }

  AM.views.project = async function project(id) {
    const snap = await window.api.getProject(id);
    AM.state.projects.set(id, snap);
    cur = { id, snap, els: {}, tab: tabForStep(snap.currentStep, snap.status), userTab: false, sigs: {} };
    const root = h('div', null);
    cur.els.head = h('div');
    cur.els.stepper = h('div', { class: 'stepper' });
    cur.els.alert = h('div');
    cur.els.tabs = h('div', { class: 'tabs' });
    cur.els.body = h('div');
    root.append(cur.els.head, cur.els.stepper, cur.els.alert, cur.els.tabs, cur.els.body);
    renderAll(snap, true);
    return root;
  };

  AM.views.projectLeave = function () { cur = null; };

  AM.views.projectUpdate = function (snap) {
    if (!cur || cur.id !== snap.id) return;
    const prevStep = cur.snap.currentStep;
    cur.snap = snap;
    if (!cur.userTab && (snap.currentStep !== prevStep || snap.status === 'done')) cur.tab = tabForStep(snap.currentStep, snap.status);
    renderAll(snap, false);
  };

  AM.views.projectLog = function (line) {
    if (!cur || cur.tab !== 'log' || !cur.els.logbox) return;
    const box = cur.els.logbox;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    box.appendChild(document.createTextNode(`${line}\n`));
    if (atBottom) box.scrollTop = box.scrollHeight;
  };

  function renderAll(snap, force) {
    renderHead(snap);
    renderStepper(snap);
    renderAlert(snap);
    renderTabs(snap);
    renderBody(snap, force);
  }

  // ---------- 머리 ----------
  function renderHead(snap) {
    const el = clear(cur.els.head);
    const title = (snap.plan && snap.plan.title) || snap.title;
    const st = snap.running ? (snap.waiting ? 'waiting' : 'running') : snap.status;
    const btns = [];
    if (snap.running) btns.push(h('button', { class: 'btn danger', onclick: () => AM.safe(() => window.api.stopProject(snap.id), '중지했어요') }, '■ 중지'));
    else if (snap.status !== 'done') btns.push(h('button', { class: 'btn primary', onclick: () => AM.safe(() => window.api.runProject(snap.id)) }, '▶ 이어서 하기'));
    btns.push(h('button', { class: 'btn', onclick: () => window.api.openPath(snap.dir) }, '📂 작업 폴더'));
    btns.push(h('button', { class: 'btn', disabled: snap.running, onclick: () => redoDialog(snap) }, '↻ 단계 다시 하기'));
    btns.push(h('button', { class: 'btn', disabled: snap.running, onclick: () => providersDialog(snap) }, '🔧 담당 AI'));
    el.appendChild(h('div', { class: 'proj-head' },
      h('div', { class: 'grow' },
        h('div', { class: 'row', style: { gap: '10px' } },
          h('h2', { class: 'title' }, title),
          h('span', { class: `status-pill st-${st}` }, AM.STATUS_LABEL[st] || st)),
        h('div', { class: 'muted small' }, `주제: ${snap.topic}  ·  워크플로우: ${snap.workflow.name || ''}  ·  ${snap.workflow.aspect}`)),
      h('div', { class: 'row', style: { gap: '6px' } }, btns)));
  }

  function renderStepper(snap) {
    const el = clear(cur.els.stepper);
    AM.STEP_META.forEach((m, i) => {
      const s = (snap.steps && snap.steps[m.id]) || {};
      const status = s.status || 'pending';
      const prog = status === 'done' ? 100 : (s.progress && s.progress.total ? Math.round((s.progress.done / s.progress.total) * 100) : 0);
      const who = m.who(snap.providers);
      el.appendChild(h('div', { class: `stp ${status}`, title: s.message || '' },
        h('div', { class: 'top' }, h('span', { class: 'dot' }), `${i + 1}. ${m.icon} ${m.label}`),
        h('div', { class: 'msg' }, status === 'pending' ? `대기 · ${who.short}` : (s.message || '')),
        h('div', { class: 'bar', style: { width: `${status === 'running' || status === 'waiting' ? Math.max(prog, 4) : prog}%` } })));
    });
  }

  // ---------- 도우미/오류 안내 ----------
  function renderAlert(snap) {
    const el = clear(cur.els.alert);
    const w = snap.waiting;
    if (w && snap.running) {
      if (w.kind === 'review' && w.key === 'review:lyrics') {
        el.appendChild(h('div', { class: 'wait-card' }, h('h3', null, '⌨ 가사 자막 시간 맞추기'), h('div', null, w.message),
          h('div', { class: 'actions' },
            h('button', { class: 'btn primary', onclick: () => tapSyncDialog(snap, true) }, '⌨ 탭으로 가사 맞추기'),
            h('button', { class: 'btn', onclick: () => window.api.continueReview(snap.id) }, '자동 추정으로 계속 ▶'))));
        return;
      }
      if (w.kind === 'review') {
        el.appendChild(h('div', { class: 'wait-card' }, h('h3', null, '👀 확인해 주세요'), h('div', null, w.message),
          h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: () => window.api.continueReview(snap.id) }, '계속 ▶'))));
        return;
      }
      if (w.kind === 'bot') {
        el.appendChild(h('div', { class: 'wait-card' }, h('h3', null, `🤖 ${w.title}`), h('div', null, w.message),
          h('div', { class: 'small muted', style: { marginTop: '6px' } }, '자동 클릭 브라우저 창(작업 표시줄의 Edge/Chrome)을 확인해 주세요. 해결되면 자동으로 계속합니다.')));
        return;
      }
      el.appendChild(helperCard(snap, w));
      return;
    }
    if (snap.status === 'limited' && snap.running && snap.limitUntil) {
      const t = new Date(snap.limitUntil);
      el.appendChild(h('div', { class: 'notice warn' }, `⏸ 구독 사용량 한도에 걸려서 기다리는 중이에요. ${t.getHours()}시 ${String(t.getMinutes()).padStart(2, '0')}분쯤 자동으로 이어서 합니다. (그냥 두셔도 돼요)`));
      return;
    }
    if (!snap.running && (snap.status === 'error' || snap.status === 'limited')) {
      const msg = snap.error || '';
      const hints = [];
      if (/로그인/.test(msg)) hints.push(h('button', { class: 'btn small', onclick: () => AM.go('settings') }, '🔌 AI 연결 설정에서 로그인하기'));
      if (/찾지 못했습니다|설치/.test(msg)) hints.push(h('button', { class: 'btn small', onclick: () => AM.go('settings') }, '🔌 AI 연결 설정에서 설치하기'));
      el.appendChild(h('div', { class: 'notice err' },
        h('b', null, snap.status === 'limited' ? '⏸ 구독 사용량 한도에 도달했어요. ' : '✖ 문제가 생겼어요. '),
        h('div', { style: { whiteSpace: 'pre-wrap', margin: '6px 0' } }, msg),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary small', onclick: () => AM.safe(() => window.api.runProject(snap.id)) }, '▶ 이어서 하기'),
          ...hints,
          h('span', { class: 'small muted' }, '이미 만든 것은 저장되어 있어서 이어서 하면 남은 부분만 만들어요.'))));
    }
    if (!snap.running && snap.status === 'stopped') {
      el.appendChild(h('div', { class: 'notice info' }, '중지된 상태예요. [▶ 이어서 하기] 를 누르면 멈춘 곳부터 계속합니다.'));
    }
  }

  function helperCard(snap, w) {
    const kindName = { music: '노래', image: '이미지', video: '영상' }[w.kind] || '파일';
    const acts = [];
    if (w.copyText) acts.push(h('button', { class: 'btn primary', onclick: () => AM.safe(() => window.api.copyText(w.copyText), '복사했어요. 사이트 입력창에 Ctrl+V 로 붙여넣으세요.') }, w.kind === 'music' ? '📋 글(스타일+가사) 복사' : '📋 프롬프트 복사'));
    if (w.image) {
      acts.push(h('button', { class: 'btn', onclick: () => AM.safe(() => window.api.copyImage(abs(snap, w.image)), '이미지를 복사했어요. 사이트에 Ctrl+V 로 붙여넣으세요.') }, '🖼️ 이미지 복사'));
      acts.push(h('button', { class: 'btn', onclick: () => window.api.showItem(abs(snap, w.image)) }, '📂 이미지 위치'));
    }
    if (w.siteUrl) acts.push(h('button', { class: 'btn', onclick: () => window.api.openExternal(w.siteUrl) }, `🌐 ${w.siteName} 열기`));
    acts.push(h('button', {
      class: 'btn',
      onclick: async () => {
        const f = await window.api.pickFile({ filters: [{ name: kindName, extensions: w.kind === 'image' ? ['png', 'jpg', 'jpeg', 'webp'] : w.kind === 'video' ? ['mp4', 'mov', 'webm', 'm4v'] : ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'mp4', 'webm', 'mov'] }] });
        if (f) window.api.provideFile(snap.id, w.key, f);
      },
    }, '📁 파일 직접 고르기'));
    acts.push(h('button', { class: 'btn ghost', onclick: async () => { if (await AM.confirmBox('건너뛸까요?', `이 ${kindName} 없이 진행합니다. 나중에 다시 만들 수 있어요.`)) window.api.skipWaiting(snap.id, w.key); } }, '건너뛰기'));
    const drop = h('div', { class: 'dropzone' }, `또는 받은 ${kindName} 파일을 여기에 끌어다 놓으세요`);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (f) window.api.provideFile(snap.id, w.key, window.api.pathForFile(f));
    });
    return h('div', { class: 'wait-card' },
      h('h3', null, `🙋 도와주세요: ${w.title}`),
      h('div', null, w.message),
      w.copyText ? h('div', { class: 'copybox' }, w.copyText) : null,
      h('div', { class: 'actions' }, acts),
      drop,
      h('div', { style: { marginTop: '8px' } }, h('span', { class: 'watching' }, `다운로드 폴더를 지켜보는 중 (${AM.state.info.paths.downloads}) - 새 파일이 생기면 자동으로 가져와요`)));
  }

  // ---------- 탭 ----------
  function renderTabs(snap) {
    const el = clear(cur.els.tabs);
    TABS.forEach((t) => el.appendChild(h('button', {
      class: `tab ${cur.tab === t.id ? 'active' : ''}`,
      onclick: () => { cur.tab = t.id; cur.userTab = true; cur.sigs = {}; renderTabs(snap); renderBody(snap, true); },
    }, t.label, t.id === 'final' && snap.editStale ? ' •' : '')));
  }

  function renderBody(snap, force) {
    const fns = { plan: planTab, timing: timingTab, keyframes: keyframesTab, clips: clipsTab, final: finalTab, log: logTab };
    const sigFns = {
      plan: () => JSON.stringify([snap.plan, snap.running]),
      timing: () => JSON.stringify([snap.music && snap.music.analysis && snap.music.analysis.bpm, snap.song, snap.lyricsInput && snap.lyricsInput.raw, snap.timing, snap.running, snap.waiting && snap.waiting.key, snap.steps.music && snap.steps.music.status]),
      keyframes: () => JSON.stringify([snap.keyframes, snap.refs, snap.running]),
      clips: () => JSON.stringify([snap.clips, snap.running, snap.timing && snap.timing.transitions]),
      final: () => JSON.stringify([snap.output, snap.editStale, snap.running, snap.steps.edit]),
      log: () => 'log',
    };
    const sig = sigFns[cur.tab]();
    if (!force && cur.sigs[cur.tab] === sig) return;
    // 입력 중이면 다시 그리지 않는다
    const active = document.activeElement;
    if (!force && active && cur.els.body.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;
    cur.sigs = { [cur.tab]: sig };
    const body = clear(cur.els.body);
    Promise.resolve(fns[cur.tab](snap)).then((node) => { if (node && cur && cur.els.body === body) { clear(body); body.appendChild(node); } });
  }

  // ---------- 기획 탭 ----------
  function planTab(snap) {
    const plan = snap.plan;
    if (!plan) return h('div', { class: 'section muted' }, snap.running ? '🧠 가사와 노래 구조를 보고 스토리보드를 쓰는 중이에요… (보통 1~3분)' : '아직 기획안이 없어요. 노래 분석이 끝나면 만들어요.');
    return h('div', null,
      h('div', { class: 'section' },
        h('h3', null, plan.title),
        h('p', { class: 'desc' }, plan.logline),
        h('p', null, plan.concept),
        plan.music && (plan.music.genre || plan.music.mood) ? h('div', { class: 'small muted' }, `🎵 ${plan.music.genre || ''} ${plan.music.mood ? `· ${plan.music.mood}` : ''}`) : null,
        h('div', { class: 'grid2', style: { marginTop: '10px' } },
          h('div', null, h('b', null, '🎭 등장인물'), plan.characters.length
            ? h('ul', null, plan.characters.map((c) => h('li', null, h('b', null, c.name), ` - ${c.description_ko}`, h('div', { class: 'small muted' }, c.appearance_en))))
            : h('p', { class: 'muted small' }, '(인물 없이 풍경 위주)')),
          h('div', null, h('b', null, '📖 시나리오 (노래 순서대로)'), h('ol', null, plan.story.map((st) => h('li', null,
            st.sections && st.sections.length ? h('span', { class: 'chip', style: { marginRight: '6px' } }, st.sections.join(', ')) : null,
            st.summary_ko)))))),
      h('div', { class: 'small muted' }, '기획을 바꾸고 싶으면 [↻ 단계 다시 하기] → "기획부터" 를 고르세요. 워크플로우의 "추가 지시" 에 원하는 방향을 적으면 반영돼요.'));
  }

  // ---------- 노래·가사·타이밍 탭 ----------
  function timingTab(snap) {
    const m = snap.music;
    const a = m && m.analysis;
    const t = snap.timing;
    const inLyricReview = !!(snap.waiting && snap.waiting.key === 'review:lyrics');
    const kids = [];

    // 노래
    const songAbs = snap.song ? abs(snap, snap.song.file) : null;
    const audio = h('audio', { controls: true, src: songAbs ? AM.fileUrl(songAbs) : '', preload: 'auto', style: { width: '100%' } });
    const bpmIn = h('input', { type: 'number', value: a ? Math.round(a.bpm) : 120, min: 40, max: 220, style: { width: '90px' }, disabled: snap.running || !a });
    kids.push(h('div', { class: 'section' },
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('h3', null, snap.song ? `🎵 ${snap.song.name}` : '🎵 노래 파일이 아직 없어요'),
          h('p', { class: 'desc' }, a
            ? `길이 ${AM.fmtSec(a.duration)} · BPM ${a.bpm} · 마디 ${a.downbeats.length}개 (내 PC 에서 자동 분석). 박자가 두 배/절반으로 잘못 잡혔다면 BPM 을 고쳐 다시 분석하세요.`
            : (snap.song ? '분석을 기다리는 중이에요.' : 'Suno 등에서 만든 노래 파일을 넣어 주세요.'))),
        a ? h('div', { class: 'row', style: { gap: '6px' } }, 'BPM', bpmIn, h('button', {
          class: 'btn small', disabled: snap.running,
          onclick: async () => {
            const r = await AM.safe(() => window.api.setBpm(snap.id, Number(bpmIn.value)), '다시 분석했어요');
            if (r && snap.timing && await AM.confirmBox('컷을 다시 나눌까요?', '박자가 바뀌었으니 타이밍(컷 나누기)부터 다시 하는 게 좋아요. 이미 만든 키프레임/클립은 장면이 같으면 그대로 써요.', '타이밍부터 다시')) {
              window.api.runProject(snap.id, 'timing');
            }
          },
        }, 'BPM 바꿔서 다시 분석')) : null,
        h('button', {
          class: 'btn small', disabled: snap.running,
          onclick: async () => {
            const f = await window.api.pickFile({ filters: [{ name: '노래', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'webm', 'mov', 'm4v'] }] });
            if (!f) return;
            if (snap.song && !await AM.confirmBox('노래를 바꿀까요?', '노래가 바뀌면 박자 분석과 컷 나누기를 다시 해요. 기획(스토리보드)은 그대로 둬요.', '바꾸기')) return;
            if (await AM.safe(() => window.api.replaceSong(snap.id, f), '노래를 바꿨어요. [▶ 이어서 하기] 를 누르세요.')) AM.go('project', snap.id);
          },
        }, snap.song ? '🎵 노래 바꾸기' : '🎵 노래 넣기')),
      songAbs ? audio : null));

    // 가사
    const li = snap.lyricsInput || { raw: '', lines: [] };
    const editable = !snap.running || inLyricReview;
    const ta = h('textarea', { rows: 8, disabled: !editable, placeholder: '가사가 없으면 연주곡으로 만들어요.' });
    ta.value = li.raw || '';
    let fname = '';
    kids.push(h('div', { class: 'section' },
      h('div', { class: 'row' },
        h('div', { class: 'grow' }, h('h3', null, `📝 가사 ${li.lines.length}줄 ${li.timed ? '(시간 포함 ✔)' : ''}`),
          h('p', { class: 'desc' }, 'Suno 가사를 그대로 붙여넣어도 돼요. [Verse] [Chorus] 같은 구간 표시는 자막에 나오지 않고, 장면을 나눌 때 써요.')),
        h('button', {
          class: 'btn small', disabled: !editable,
          onclick: async () => {
            const f = await window.api.pickFile({ filters: [{ name: '가사', extensions: ['txt', 'lrc', 'srt'] }] });
            if (!f) return;
            const text = await AM.safe(() => window.api.readTextFile(f));
            if (text != null) { ta.value = text; fname = f.split(/[\\/]/).pop(); }
          },
        }, '📄 가사 파일 불러오기'),
        h('button', {
          class: 'btn small primary', disabled: !editable,
          onclick: async () => {
            const ok = await AM.safe(() => window.api.updateLyricsText(snap.id, ta.value, fname), '가사를 저장했어요');
            if (ok && !inLyricReview && snap.steps.timing && snap.steps.timing.status === 'done') toast('가사가 바뀌었어요. [▶ 이어서 하기] 를 누르면 타이밍부터 다시 해요.');
            if (ok && inLyricReview) toast('바뀐 가사로 자막 줄을 다시 만들었어요. [⌨ 탭으로 가사 맞추기] 또는 [자동 추정으로 계속] 을 누르세요.');
          },
        }, '💾 가사 저장')),
      ta));

    if (t && (t.segments || (t.lyrics && t.lyrics.length))) {
      const canTap = (!snap.running || inLyricReview) && t.lyrics && t.lyrics.length;
      const srcLabel = { tap: '(직접 맞춤 ✔)', lrc: '(가사 파일 시간 ✔)', srt: '(자막 파일 시간 ✔)', auto: '(자동 추정 - 탭으로 맞추면 정확해져요)' }[t.lyricsSource] || '';
      kids.push(h('div', { class: 'section' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('h3', null, `${t.segments ? `✂ 컷 ${t.segments.length}개 · ` : ''}가사 자막 ${t.lyrics.length}줄 ${srcLabel}`),
            h('p', { class: 'desc' }, '보라색 세로줄 = 마디 시작, 회색 = 박자. 컷 경계는 모두 박자 위에 있어요. 컷을 누르면 그 위치부터 재생돼요.')),
          h('button', { class: 'btn primary', disabled: !canTap, onclick: () => tapSyncDialog(snap, inLyricReview) }, '⌨ 탭으로 가사 맞추기')),
        a ? timeline(snap, audio) : null,
        t.segments ? segTable(snap) : null));
    }
    return h('div', null, kids);
  }

  function timeline(snap, audio) {
    const a = snap.music.analysis;
    const t = snap.timing;
    const D = a.duration;
    const pct = (x) => `${(x / D) * 100}%`;
    const colors = ['#7c3aed', '#ff5e62', '#0ea5e9', '#16a34a', '#f59e0b', '#db2777', '#4f46e5', '#0d9488'];
    const beats = h('div', { class: 'tl-row small' }, a.beats.map((b) => h('div', { class: `tl-beat ${a.downbeats.some((d) => Math.abs(d - b) < 0.02) ? 'down' : ''}`, style: { left: pct(b) } })));
    const segs = h('div', { class: 'tl-row' }, (t.segments || []).map((s, i) => h('div', {
      class: 'tl-seg', title: `컷 ${s.index}: ${s.start.toFixed(2)}~${s.end.toFixed(2)}초 (${s.beats}박)`,
      style: { left: pct(s.start), width: pct(s.duration), background: colors[i % colors.length] },
      onclick: () => { audio.currentTime = s.start; audio.play(); },
    }, String(s.index))));
    const trs = h('div', { class: 'tl-row small' }, (t.segments ? t.transitions || [] : []).map((tr, i) => (tr.type === 'cut' ? null : h('div', { class: 'tl-tr', style: { left: pct(t.segments[i].end) }, title: tr.type }, trIcon(tr.type)))));
    const lyr = h('div', { class: 'tl-row' }, t.lyrics.map((l) => h('div', { class: 'tl-lyr', style: { left: pct(l.start), width: pct(Math.max(0.3, l.end - l.start)) }, title: `${l.start.toFixed(2)}s ${l.text}` }, l.text)));
    const head = h('div', { class: 'tl-head', style: { left: '0%' } });
    const wrap = h('div', { class: 'timeline' }, h('div', { class: 'tl-label' }, '박자'), beats, h('div', { class: 'tl-label' }, '컷 / 화면전환'), trs, segs, h('div', { class: 'tl-label' }, '가사 자막'), lyr, head);
    audio.addEventListener('timeupdate', () => { head.style.left = `calc(10px + (100% - 20px) * ${audio.currentTime / D})`; });
    return wrap;
  }

  function trIcon(type) {
    return ({ fade: '◐ 페이드', dissolve: '◌ 디졸브', fadeblack: '■ 암전', flash: '✦ 플래시', slideleft: '⇐ 슬라이드', slideup: '⇑ 슬라이드', wipeleft: '▤ 와이프', zoomin: '⊕ 줌', circleopen: '◯ 원형', pixelize: '▦ 픽셀', smoothleft: '⇐ 스무스' })[type] || type;
  }

  function segTable(snap) {
    const t = snap.timing;
    return h('table', { class: 'prov-table small', style: { marginTop: '12px' } },
      h('tbody', null, t.segments.map((s, i) => {
        const shot = snap.shots && snap.shots[i];
        const tr = t.transitions && t.transitions[i];
        return h('tr', null,
          h('td', { style: { width: '120px' } }, `컷 ${s.index}`, h('div', { class: 'muted' }, `${s.start.toFixed(2)}~${s.end.toFixed(2)}초`)),
          h('td', { style: { width: '90px' } }, `${s.duration.toFixed(2)}초`, h('div', { class: 'muted' }, `${s.beats}박 · ${({ high: '강', mid: '중', low: '약' })[s.energy]}`)),
          h('td', null, shot ? `${shot.action}` : '', h('div', { class: 'muted' }, s.lyrics.map((k) => t.lyrics[k] && t.lyrics[k].text).filter(Boolean).join(' / ') || '(간주)')),
          h('td', { style: { width: '110px' } }, tr ? (tr.type === 'cut' ? '컷' : `${trIcon(tr.type)} ${tr.duration.toFixed(2)}초`) : '끝'));
      })));
  }

  function tapSyncDialog(snap, inReview) {
    const t = snap.timing;
    const lines = (t.lyrics && t.lyrics.length ? t.lyrics : []).map((l) => ({ ...l }));
    if (!lines.length) { toast('가사가 없어요.', 'err'); return; }
    const D = snap.music.analysis.duration;
    const marks = lines.map((l) => l.start);
    let idx = 0;
    const audio = h('audio', { controls: true, src: url(snap, snap.music.song), style: { width: '100%' } });
    const progress = h('span', { class: 'small muted' });
    const rate = h('select', { style: { width: '120px' }, onchange: () => { audio.playbackRate = Number(rate.value); } },
      h('option', { value: '1' }, '보통 속도'), h('option', { value: '0.75' }, '0.75배 느리게'), h('option', { value: '0.5' }, '0.5배 느리게'));
    const list = h('div', { class: 'tap-lines' });
    const render = () => {
      clear(list);
      lines.forEach((l, i) => list.appendChild(h('div', { class: `tap-line ${i === idx ? 'cur' : ''}` },
        h('span', { class: 'tm' }, i < idx ? marks[i].toFixed(2) : (i === idx ? '▶' : marks[i].toFixed(2))), l.text)));
      const c = list.children[idx];
      if (c) c.scrollIntoView({ block: 'nearest' });
      progress.textContent = `${Math.min(idx, lines.length)} / ${lines.length} 줄`;
    };
    const onKey = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (idx < lines.length) { marks[idx] = Math.max(0, audio.currentTime - 0.12 * audio.playbackRate); idx++; render(); }
      } else if (e.code === 'Backspace') {
        e.preventDefault();
        if (idx > 0) { idx--; render(); }
      }
    };
    document.addEventListener('keydown', onKey);
    render();
    AM.modal('⌨ 탭으로 가사 맞추기', h('div', null,
      h('p', null, '노래를 재생하고, 각 가사 줄이 ', h('b', null, '시작되는 순간'), '에 ', h('span', { class: 'kbd' }, 'Space'), ' 를 누르세요. 틀리면 ', h('span', { class: 'kbd' }, 'Backspace'), ' 로 한 줄 되돌려요.'),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { idx = 0; audio.currentTime = 0; audio.play(); render(); } }, '⏮ 처음부터 맞추기'), rate, progress),
      h('div', { style: { margin: '10px 0' } }, audio),
      list), [
      { label: '취소' },
      {
        label: '💾 저장', kind: 'primary',
        onClick: async () => {
          for (let i = 1; i < marks.length; i++) if (marks[i] <= marks[i - 1]) { toast(`${i + 1}번째 줄 시간이 앞 줄보다 빨라요. 다시 맞춰 주세요.`, 'err'); return true; }
          if (idx < lines.length && !await AM.confirmBox('아직 다 안 맞췄어요', `${lines.length}줄 중 ${idx}줄만 맞췄어요. 나머지 줄은 원래 시간으로 저장할까요?`, '그대로 저장')) return true;
          const out = lines.map((l, i) => ({ text: l.text, part: l.part, section: l.section, sectionStart: l.sectionStart, start: marks[i], end: Math.min(i + 1 < marks.length ? marks[i + 1] - 0.05 : D - 0.1, marks[i] + 7) }));
          const ok = await AM.safe(() => window.api.updateLyrics(snap.id, out), '가사 타이밍을 저장했어요');
          if (ok === undefined) return true;
          if (inReview) { window.api.continueReview(snap.id); return false; }
          const redo = await AM.confirmBox('어떻게 반영할까요?', '• 자막만 다시 입히기: 지금 컷은 그대로 두고 최종 영상의 자막만 새 타이밍으로 (빠름)\n• 컷도 다시 나누기: 새 가사 타이밍에 맞춰 컷 경계를 다시 설계 (장면이 바뀐 컷은 다시 만들어야 할 수 있어요)', '자막만 다시 입히기');
          if (redo) window.api.runProject(snap.id, 'edit');
          else if (await AM.confirmBox('컷도 다시 나눌까요?', '타이밍 단계부터 다시 진행합니다.', '컷 다시 나누기')) window.api.runProject(snap.id, 'timing');
          return false;
        },
      },
    ], { width: 'min(760px, 94vw)', sticky: true, onClose: () => { document.removeEventListener('keydown', onKey); audio.pause(); } });
  }

  // ---------- 키프레임 탭 ----------
  function keyframesTab(snap) {
    const ks = snap.keyframes || [];
    if (!ks.length) return h('div', { class: 'section muted' }, '타이밍 설계가 끝나면 컷마다 키프레임(첫 장면 그림)을 만들어요.');
    const ar = aspectCss(snap.workflow.aspect);
    const cards = [];
    if (snap.refs && snap.refs.sheet) {
      cards.push(h('div', { class: 'media-card' },
        h('div', { class: 'thumb', style: { aspectRatio: ar } }, h('img', { src: url(snap, snap.refs.sheet, snap.updatedAt), onclick: () => bigImage(snap, snap.refs.sheet) }), h('span', { class: 'badge' }, '캐릭터 기준')),
        h('div', { class: 'body' }, h('div', { class: 'p' }, '모든 키프레임이 이 그림을 참고해서 같은 캐릭터를 유지해요.'))));
    }
    ks.forEach((k) => cards.push(itemCard(snap, 'keyframe', k, ar)));
    return h('div', null,
      h('p', { class: 'muted small' }, `${ks.filter((k) => k.status === 'done').length}/${ks.length} 완료 · 마음에 안 드는 그림은 [다시] 를 누르거나 직접 만든 파일로 [교체] 할 수 있어요. 바꾼 뒤에는 영상 클립도 다시 만들어야 반영돼요.`),
      h('div', { class: 'media-grid' }, cards));
  }

  function clipsTab(snap) {
    const cs = snap.clips || [];
    if (!cs.length) return h('div', { class: 'section muted' }, '키프레임이 끝나면 컷 길이에 맞춰 1~15초 영상 클립을 만들어요.');
    const ar = aspectCss(snap.workflow.aspect);
    return h('div', null,
      h('p', { class: 'muted small' }, `${cs.filter((c) => c.status === 'done').length}/${cs.length} 완료 · 마우스를 올리면 재생돼요. 실패한 컷은 최종 편집에서 키프레임을 천천히 확대하는 화면으로 대신해요.`),
      h('div', { class: 'media-grid' }, cs.map((c) => itemCard(snap, 'clip', c, ar))));
  }

  function itemCard(snap, kind, it, ar) {
    const isClip = kind === 'clip';
    const v = it.updatedAt || 0;
    let media;
    if (it.file && it.status !== 'running') {
      media = isClip
        ? h('video', { src: url(snap, it.file, v), muted: true, loop: true, preload: 'metadata', onmouseenter: (e) => e.target.play().catch(() => {}), onmouseleave: (e) => e.target.pause(), onclick: () => bigVideo(snap, it.file, v) })
        : h('img', { src: url(snap, it.file, v), onclick: () => bigImage(snap, it.file, v) });
    } else if (it.status === 'running') {
      media = h('div', { class: 'col', style: { alignItems: 'center' } }, h('div', { class: 'spinner' }), h('div', { class: 'ph' }, '만드는 중…'));
    } else {
      media = h('div', { class: 'ph' }, it.status === 'error' ? '⚠ 실패' : it.status === 'skipped' ? '건너뜀' : '대기 중');
    }
    const tr = isClip && snap.timing && snap.timing.transitions && snap.timing.transitions[it.clip - 1];
    const label = isClip ? `컷 ${it.clip}` : `컷 ${it.clip}${it.slot > 1 ? ` · 끝장면` : ''}`;
    return h('div', { class: 'media-card' },
      h('div', { class: 'thumb', style: { aspectRatio: ar } }, media,
        h('span', { class: 'badge' }, label),
        isClip ? h('span', { class: 'badge r' }, `${it.seconds}초`) : null),
      h('div', { class: 'body' },
        it.error ? h('div', { class: 'small', style: { color: 'var(--err)' } }, it.error) : null,
        h('div', { class: 'p', title: it.prompt }, shotSummary(snap, it) || it.prompt),
        isClip && tr ? h('div', { class: 'small muted' }, `다음으로: ${tr.type === 'cut' ? '컷' : trIcon(tr.type)}`) : null,
        h('div', { class: 'acts' },
          h('button', { class: 'btn small', disabled: snap.running, onclick: () => editPromptDialog(snap, kind, it) }, '✏️ 다시'),
          h('button', {
            class: 'btn small', disabled: snap.running,
            onclick: async () => {
              const f = await window.api.pickFile({ filters: [isClip ? { name: '영상', extensions: ['mp4', 'mov', 'webm', 'm4v'] } : { name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
              if (f) AM.safe(() => window.api.replaceItem(snap.id, kind, it.clip, f, it.slot || 1), '교체했어요. [완성 영상] 탭에서 다시 만들기를 눌러 반영하세요.');
            },
          }, '📁 교체'),
          h('button', { class: 'btn small', onclick: () => AM.safe(() => window.api.copyText(it.prompt), '프롬프트를 복사했어요') }, '📋'))));
  }

  /** 카드에는 긴 프롬프트 대신 장면 요약을 보여 준다 (전체 프롬프트는 마우스를 올리면 보임) */
  function shotSummary(snap, it) {
    const shot = snap.shots && snap.shots[it.clip - 1];
    if (!shot) return '';
    if (it.slot === 2 && shot.end_state) return `끝: ${shot.end_state}`;
    return [shot.action, shot.camera].filter(Boolean).join(' · ');
  }

  function editPromptDialog(snap, kind, it) {
    const ta = h('textarea', { rows: 7 });
    ta.value = it.prompt;
    AM.modal(`${kind === 'clip' ? '영상 클립' : '키프레임'} ${it.clip} 다시 만들기`, h('div', null,
      h('p', { class: 'muted small' }, '프롬프트(영어 권장)를 고친 뒤 [다시 만들기] 를 누르세요. 고치지 않고 그냥 눌러도 새로 만들어요.'),
      ta), [
      { label: '취소' },
      {
        label: '🔄 다시 만들기', kind: 'primary',
        onClick: () => {
          AM.safe(() => window.api.regenerate(snap.id, kind, it.clip, { prompt: ta.value.trim(), slot: it.slot || 1 }), '다시 만들었어요. [완성 영상] 탭에서 다시 만들기를 누르면 반영돼요.');
        },
      },
    ]);
  }

  function bigImage(snap, rel, v) {
    AM.modal('크게 보기', h('img', { src: url(snap, rel, v), style: { maxWidth: '100%', maxHeight: '72vh', display: 'block', margin: '0 auto', borderRadius: '10px' } }),
      [{ label: '📂 위치 열기', onClick: () => { window.api.showItem(abs(snap, rel)); return true; } }, { label: '닫기' }], { width: 'min(900px, 94vw)' });
  }

  function bigVideo(snap, rel, v) {
    AM.modal('크게 보기', h('video', { src: url(snap, rel, v), controls: true, autoplay: true, style: { maxWidth: '100%', maxHeight: '72vh', display: 'block', margin: '0 auto', borderRadius: '10px', background: '#000' } }),
      [{ label: '📂 위치 열기', onClick: () => { window.api.showItem(abs(snap, rel)); return true; } }, { label: '닫기' }], { width: 'min(900px, 94vw)' });
  }

  // ---------- 완성 탭 ----------
  function finalTab(snap) {
    const o = snap.output;
    const rebuild = h('button', { class: 'btn primary', disabled: snap.running || !snap.timing, onclick: () => window.api.runProject(snap.id, 'edit') }, '↻ 최종 영상 다시 만들기');
    if (!o || !o.video) {
      const s = snap.steps.edit;
      return h('div', { class: 'section' }, h('h3', null, '✨ 아직 완성 전이에요'),
        h('p', { class: 'desc' }, s && s.status === 'running' ? s.message : '모든 클립이 준비되면 박자에 맞춰 이어붙이고, 가사 자막과 노래를 입혀서 완성해요.'),
        snap.timing ? rebuild : null);
    }
    const file = abs(snap, o.video);
    return h('div', null,
      snap.editStale ? h('div', { class: 'notice warn' }, '✏️ 바뀐 키프레임/클립/자막이 있어요. [최종 영상 다시 만들기] 를 누르면 반영돼요. (내 PC 에서 처리, 무료)') : null,
      h('div', { class: 'section' },
        h('div', { class: 'final-wrap' },
          h('video', {
            src: AM.fileUrl(file, o.madeAt), controls: true, preload: 'metadata',
            style: snap.workflow.aspect === '16:9'
              ? { width: '100%', maxWidth: '760px', flex: '1 1 480px', height: 'auto' }
              : { height: 'min(68vh, 640px)', width: 'auto', flex: 'none' },
          }),
          h('div', { class: 'col', style: { minWidth: '260px' } },
            h('h3', null, '🎉 완성!'),
            h('div', { class: 'small muted' }, o.video.split('/').pop()),
            h('button', { class: 'btn', onclick: () => window.api.showItem(file) }, '📂 파일 위치 열기'),
            rebuild,
            h('div', { class: 'small muted' }, '같은 폴더에 가사 자막 파일(lyrics.srt / lyrics.lrc)과 스토리보드(storyboard.md)도 있어요. 유튜브 자막으로 올릴 수 있어요.'),
            h('div', { class: 'notice info small' }, '📌 업로드할 때는 플랫폼의 "AI 생성 콘텐츠" 표시 규정을 확인하세요. (파일 정보에도 AI 생성 표시를 넣어 두었어요)')))));
  }

  async function logTab(snap) {
    const box = h('div', { class: 'logbox' });
    let text = '';
    try { text = await window.api.readLog(snap.id); } catch (_) { text = (AM.state.logs.get(snap.id) || []).join('\n'); }
    box.textContent = text;
    cur.els.logbox = box;
    setTimeout(() => { box.scrollTop = box.scrollHeight; }, 0);
    return h('div', null, h('div', { class: 'row', style: { marginBottom: '8px' } },
      h('span', { class: 'muted small grow' }, '문제가 생기면 이 기록을 캡처해서 물어보세요. AI 프로그램 원본 출력은 작업 폴더의 work 폴더에 있어요.'),
      h('button', { class: 'btn small', onclick: () => window.api.openPath(AM.joinPath(snap.dir, 'work')) }, '📂 work 폴더')), box);
  }

  // ---------- 대화상자 ----------
  function redoDialog(snap) {
    const sel = h('select', null, AM.STEP_META.map((m, i) => h('option', { value: m.id }, `${i + 1}. ${m.label} 부터`)));
    sel.value = 'edit';
    AM.modal('단계 다시 하기', h('div', null,
      h('p', null, '선택한 단계부터 다시 진행해요. 이미 만든 키프레임·클립은 장면(프롬프트)이 같으면 그대로 써서 사용량을 아껴요.'),
      sel,
      h('ul', { class: 'small muted' },
        h('li', null, '노래·가사부터: 박자를 다시 분석해요 (노래를 바꾸려면 [노래·가사·타이밍] 탭의 [노래 바꾸기])'),
        h('li', null, '기획부터: 스토리보드·시나리오를 새로 써요'),
        h('li', null, '타이밍부터: 컷 나누기·화면전환을 다시 설계해요'),
        h('li', null, '최종 편집부터: 자막·전환만 다시 입혀요 (무료, 빠름)'))), [
      { label: '취소' },
      {
        label: '다시 하기', kind: 'primary',
        onClick: () => { window.api.runProject(snap.id, sel.value); },
      },
    ]);
  }

  function providersDialog(snap) {
    const sels = {};
    const rows = ['text', 'image', 'video'].map((k) => {
      sels[k] = h('select', null, AM.PROVIDERS[k].map((p) => h('option', { value: p.id }, p.label)));
      sels[k].value = snap.providers[k];
      return h('label', { class: 'field' }, ({ text: '기획·타이밍 (글쓰기)', image: '키프레임 (이미지)', video: '영상 클립' })[k], sels[k]);
    });
    AM.modal('이 작업의 담당 AI', h('div', { class: 'col' }, h('p', { class: 'muted small' }, '이 작업에만 적용돼요. 기본값은 [AI 연결 설정] 에서 바꿔요.'), rows), [
      { label: '취소' },
      { label: '저장', kind: 'primary', onClick: () => AM.safe(() => window.api.setProviders(snap.id, Object.fromEntries(Object.entries(sels).map(([k, s]) => [k, s.value]))), '바꿨어요. [이어서 하기] 를 누르세요.') },
    ]);
  }
}(window.AM));
