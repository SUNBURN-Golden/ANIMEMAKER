'use strict';
/* 새 영상 만들기 화면 + 처음 실행 안내 */
(function (AM) {
  const { h, toast } = AM;
  AM.views = AM.views || {};
  let selectedWf = null;
  // 다른 화면에 다녀와도 입력한 내용이 남도록
  const draft = { topic: '', songPath: '', songInfo: null, lyricsText: '', lyricsFilename: '' };
  const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'webm', 'mov', 'm4v'];
  const LYRIC_EXT = ['txt', 'lrc', 'srt'];

  function flowStrip(pv) {
    return h('div', { class: 'flow' }, AM.STEP_META.map((s, i) => {
      const who = s.who(pv);
      return h('div', { class: 'flow-step' },
        h('div', { class: 'n' }, s.icon),
        h('div', { class: 'l' }, `${i + 1}. ${s.label}`),
        h('div', { class: 'w' }, who.short),
        h('div', { style: { marginTop: '5px' } }, h('span', { class: `chip ${AM.MODE_CHIP[who.mode] || ''}` }, AM.MODE_LABEL[who.mode] || '자동')));
    }));
  }

  function dropTarget(el, exts, onFile) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('over');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      const ext = f.name.split('.').pop().toLowerCase();
      if (!exts.includes(ext)) { toast(`이 파일 형식(.${ext})은 쓸 수 없어요.`, 'err'); return; }
      onFile(window.api.pathForFile(f), f.name);
    });
  }

  AM.views.home = async function home() {
    const s = await AM.refreshSettings();
    AM.state.workflows = await window.api.listWorkflows();
    const wfs = AM.state.workflows;
    if (!selectedWf || !wfs.find((w) => w.id === selectedWf)) selectedWf = wfs[0].id;
    const pv = s.providers;
    const allDemo = ['text', 'image', 'video'].every((k) => pv[k] === 'demo');
    const someDemo = ['text', 'image', 'video'].some((k) => pv[k] === 'demo');

    // ① 노래
    const songBox = h('div');
    const renderSong = () => {
      AM.clear(songBox);
      if (draft.songPath) {
        const name = draft.songPath.split(/[\\/]/).pop();
        songBox.appendChild(h('div', { class: 'notice ok row' },
          h('span', { class: 'grow' }, '🎵 ', h('b', null, name), draft.songInfo ? `  ·  ${AM.fmtSec(draft.songInfo.duration)} (${Math.floor(draft.songInfo.duration / 60)}분 ${Math.round(draft.songInfo.duration % 60)}초)` : ''),
          h('audio', { controls: true, src: AM.fileUrl(draft.songPath), preload: 'metadata', style: { height: '34px' } }),
          h('button', { class: 'btn small', onclick: pickSong }, '다시 고르기')));
        if (draft.songInfo && (draft.songInfo.duration < 120 || draft.songInfo.duration > 300)) {
          songBox.appendChild(h('div', { class: 'small muted' }, `ℹ 목표는 3~4분이에요. 이 노래 길이(${AM.fmtSec(draft.songInfo.duration)})에 맞춰 컷 ${'10~15'}개로 나눠요. (컷 하나는 최대 30초)`));
        }
      } else {
        const drop = h('div', { class: 'dropzone', style: { padding: '22px' } },
          h('div', { style: { fontSize: '15px', fontWeight: 700, marginBottom: '8px' } }, '여기에 노래 파일을 끌어다 놓거나'),
          h('button', { class: 'btn primary', onclick: pickSong }, '🎵 노래 파일 고르기'),
          h('div', { class: 'small', style: { marginTop: '8px' } }, 'Suno 에서 받은 mp3 / wav / m4a / mp4 모두 돼요.'));
        dropTarget(drop, AUDIO_EXT, (p) => setSong(p));
        songBox.appendChild(drop);
      }
    };
    async function setSong(p) {
      const info = await AM.safe(() => window.api.probeMedia(p));
      if (!info) return;
      draft.songPath = p;
      draft.songInfo = info;
      renderSong();
    }
    async function pickSong() {
      const f = await window.api.pickFile({ filters: [{ name: '노래', extensions: AUDIO_EXT }] });
      if (f) setSong(f);
    }
    renderSong();

    // ② 가사
    const lyrics = h('textarea', {
      rows: 10,
      placeholder: 'Suno 의 가사를 그대로 붙여넣으세요. [Verse 1], [Chorus] 같은 구간 표시도 그대로 두면 장면을 나눌 때 써요.\n\n예)\n[Verse 1]\n비가 내리던 그날 밤\n우산도 없이 걸었지\n\n[Chorus]\n너를 찾아 달려가',
      oninput: (e) => { draft.lyricsText = e.target.value; draft.lyricsFilename = ''; lyricInfo(); },
    });
    lyrics.value = draft.lyricsText;
    const lyricNote = h('div', { class: 'small muted' });
    const lyricInfo = () => {
      const t = draft.lyricsText.trim();
      const timed = /\[\d{1,3}:\d{2}/.test(t) || /-->/.test(t);
      const n = t ? t.split(/\r?\n/).filter((l) => l.trim() && !/^\s*\[[^\]]*\]\s*$/.test(l)).length : 0;
      lyricNote.textContent = !t ? '연주곡(가사 없음)이면 비워 두세요.'
        : timed ? `⏱ 시간이 들어 있는 가사예요 → 자막 싱크가 자동으로 맞아요. (${n}줄)`
          : `가사 ${n}줄 · 자막 시간은 나중에 [⌨ 탭으로 가사 맞추기] 로 정확히 맞출 수 있어요.`;
    };
    lyricInfo();
    const lyricBtn = h('button', {
      class: 'btn small',
      onclick: async () => {
        const f = await window.api.pickFile({ filters: [{ name: '가사', extensions: LYRIC_EXT }] });
        if (!f) return;
        const text = await AM.safe(() => window.api.readTextFile(f));
        if (text == null) return;
        lyrics.value = text;
        draft.lyricsText = text;
        draft.lyricsFilename = f.split(/[\\/]/).pop();
        lyricInfo();
      },
    }, '📄 가사 파일 불러오기 (.txt .lrc .srt)');
    dropTarget(lyrics, LYRIC_EXT, async (p, name) => {
      const text = await AM.safe(() => window.api.readTextFile(p));
      if (text == null) return;
      lyrics.value = text;
      draft.lyricsText = text;
      draft.lyricsFilename = name;
      lyricInfo();
    });

    // ③ 컨셉
    const topic = h('textarea', {
      rows: 3,
      placeholder: '(선택) 어떤 영상으로 만들지 적어 주세요. 비워 두면 가사를 보고 AI 가 정해요.\n예) 비 오는 도시에서 우산을 잃어버린 고양이가 친구를 찾아 떠나는 이야기',
      oninput: (e) => { draft.topic = e.target.value; },
    });
    topic.value = draft.topic;
    const sugBox = h('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } });
    const sugBtn = h('button', {
      class: 'btn small',
      onclick: async () => {
        sugBtn.disabled = true;
        sugBtn.textContent = '🎲 생각하는 중…';
        const seed = [topic.value.trim(), draft.lyricsText.slice(0, 800)].filter(Boolean).join('\n');
        const list = await AM.safe(() => window.api.suggestTopics(seed));
        sugBtn.disabled = false;
        sugBtn.textContent = '🎲 컨셉 추천받기';
        if (!list) return;
        AM.clear(sugBox);
        list.forEach((t) => sugBox.appendChild(h('span', { class: 'chip click', onclick: () => { topic.value = t; draft.topic = t; } }, t)));
      },
    }, '🎲 컨셉 추천받기');

    // ④ 워크플로우
    const cards = h('div', { class: 'wf-cards' });
    const renderCards = () => {
      AM.clear(cards);
      wfs.forEach((w) => cards.appendChild(h('button', {
        class: `wf-card ${w.id === selectedWf ? 'sel' : ''}`,
        onclick: () => { selectedWf = w.id; renderCards(); },
      },
      h('div', { class: 't' }, `${w.emoji || '🎞️'} ${w.name}`),
      h('div', { class: 'd' }, w.description || ''),
      h('div', { class: 'tags' },
        h('span', { class: 'chip' }, w.aspect),
        h('span', { class: 'chip' }, `컷 ${w.minClips}~${w.maxClips}개`),
        h('span', { class: 'chip' }, `컷당 ${w.minClipSec}~${w.maxClipSec}초`),
        w.builtin ? null : h('span', { class: 'chip pri' }, '내 워크플로우')))));
    };
    renderCards();

    const start = async () => {
      if (!draft.songPath && !allDemo) { toast('먼저 노래 파일을 올려 주세요.', 'err'); return; }
      if (!draft.songPath && allDemo) {
        const ok = await AM.confirmBox('체험 모드로 만들까요?', '노래 파일이 없고 모든 단계가 체험 모드예요.\n예시 노래와 가짜 그림으로 전체 흐름만 보여 드려요. (무료, 2~3분)\n\n실제 영상을 만들려면 노래를 올리고 [AI 연결 설정] 에서 구독을 연결하세요.', '체험으로 시작');
        if (!ok) return;
      } else if (allDemo) {
        const ok = await AM.confirmBox('체험 모드로 만들까요?', '모든 AI 단계가 체험 모드예요. 올린 노래에 맞춰 컷·자막은 실제처럼 만들지만, 그림과 영상은 가짜예요. (무료)', '체험으로 시작');
        if (!ok) return;
      }
      const p = await AM.safe(() => window.api.createProject({
        topic: draft.topic.trim(), workflowId: selectedWf,
        songPath: draft.songPath || null, lyricsText: draft.lyricsText, lyricsFilename: draft.lyricsFilename,
      }));
      if (p) {
        Object.assign(draft, { topic: '', songPath: '', songInfo: null, lyricsText: '', lyricsFilename: '' });
        AM.state.projects.set(p.id, p);
        AM.go('project', p.id);
      }
    };

    return h('div', null,
      h('div', { class: 'hero' },
        h('h1', null, '노래로 뮤직비디오를 만들어 볼까요? 🎶'),
        h('p', null, 'Suno 등에서 만든 노래와 가사를 올리면, 구독 중인 AI 가 스토리보드를 쓰고 → 박자에 맞춰 컷 10~15개를 나누고 → 키프레임과 영상 클립을 만들어 → 가사 자막과 노래를 입힌 3~4분짜리 완성본까지 만들어요.')),
      allDemo ? h('div', { class: 'notice warn' }, '💡 지금은 ', h('b', null, '체험 모드'), '예요. 진짜 영상을 만들려면 ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); AM.go('settings'); } }, 'AI 연결 설정'), '에서 구독 중인 서비스를 연결해 주세요.') : null,
      !allDemo && someDemo ? h('div', { class: 'notice info' }, 'ℹ 일부 단계가 체험 모드로 설정되어 있어요. (AI 연결 설정에서 바꿀 수 있어요)') : null,
      h('div', { class: 'section' },
        h('h3', null, '① 노래 올리기'),
        h('p', { class: 'desc' }, '영상 길이 = 노래 길이예요. 3~4분 노래면 3~4분 뮤직비디오가 나와요.'),
        songBox),
      h('div', { class: 'section' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('h3', null, '② 가사'), h('p', { class: 'desc' }, '화면 아래에 자막으로 나오고, AI 가 이야기를 짤 때도 참고해요.')),
          lyricBtn),
        lyrics, lyricNote),
      h('div', { class: 'section topic-box' },
        h('h3', null, '③ 영상 컨셉 (선택)'),
        topic,
        h('div', { class: 'row', style: { marginTop: '10px' } }, sugBtn, h('span', { class: 'small muted' }, '가사를 넣었다면 가사에 어울리는 컨셉을 추천해 줘요.')),
        sugBox),
      h('div', { class: 'section' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('h3', null, '④ 워크플로우 (영상 스타일 틀)'), h('p', { class: 'desc' }, '화면 비율, 그림체, 컷 수·길이, 화면전환, 자막 모양 같은 규칙 묶음이에요.')),
          h('button', { class: 'btn small', onclick: () => AM.go('workflows') }, '🧩 워크플로우 만들기/수정')),
        cards),
      h('div', { class: 'section' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('h3', null, '⑤ 이렇게 만들어져요'), h('p', { class: 'desc' }, '각 단계를 누가 하는지 보여 줘요. (자동 = 알아서, 도우미 = 웹에서 직접 만들고 다운로드만 하면 자동으로 가져옴)')),
          h('button', { class: 'btn small', onclick: () => AM.go('settings') }, '🔌 담당 AI 바꾸기')),
        flowStrip(pv)),
      h('div', { style: { textAlign: 'center', margin: '26px 0' } },
        h('button', { class: 'btn primary big', onclick: start }, '▶ 뮤직비디오 만들기 시작'),
        h('div', { class: 'small muted', style: { marginTop: '8px' } }, '만드는 중에 다른 화면으로 가도 계속 진행돼요. 도움이 필요하면 알려 드릴게요.')));
  };

  AM.views.welcome = function welcome() {
    const done = async () => { await window.api.saveSettings({ firstRunDone: true }); await AM.refreshSettings(); };
    AM.modal('AnimeMaker 에 오신 걸 환영해요! 👋', h('div', null,
      h('p', null, '이 프로그램은 ', h('b', null, 'Suno 등에서 만든 노래와 가사'), '로 3~4분짜리 AI 뮤직비디오를 만들어 줘요.'),
      h('ol', null,
        h('li', null, h('b', null, '구독 중인 AI 를 연결'), '해요. (ChatGPT, SuperGrok, Google AI(Gemini), Claude 중 가진 것)'),
        h('li', null, h('b', null, '노래 파일과 가사'), '를 올리고, 원하면 영상 컨셉을 적어요.'),
        h('li', null, '[시작] 을 누르면 스토리보드 → 박자에 맞춘 컷 → 키프레임 → 영상 클립 → 자막·노래 입힌 완성본까지 진행돼요.')),
      h('div', { class: 'notice ok' }, '🔒 API 키(종량제 과금)는 쓰지 않아요. 이미 내고 있는 구독 요금 한도 안에서만 동작합니다.'),
      h('p', { class: 'muted small' }, '처음이라면 먼저 [체험 모드] 로 전체 흐름을 구경해 보세요. 돈도 사용량도 들지 않아요.')),
    [
      { label: '체험 모드로 먼저 구경하기', onClick: async () => { await done(); AM.go('home'); } },
      { label: '내 구독 연결하러 가기', kind: 'primary', onClick: async () => { await done(); AM.go('settings'); } },
    ], { sticky: true });
  };
}(window.AM));
