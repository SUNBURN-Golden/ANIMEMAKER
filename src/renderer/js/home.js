'use strict';
/* 새 영상 만들기 화면 + 처음 실행 안내 */
(function (AM) {
  const { h, toast } = AM;
  AM.views = AM.views || {};
  let selectedWf = null;
  let draftTopic = '';

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

  AM.views.home = async function home() {
    const s = await AM.refreshSettings();
    AM.state.workflows = await window.api.listWorkflows();
    const wfs = AM.state.workflows;
    if (!selectedWf || !wfs.find((w) => w.id === selectedWf)) selectedWf = wfs[0].id;
    const pv = s.providers;
    const allDemo = ['text', 'image', 'video', 'music'].every((k) => pv[k] === 'demo');
    const someDemo = ['text', 'image', 'video', 'music'].some((k) => pv[k] === 'demo');

    const topic = h('textarea', {
      placeholder: '예) 비 오는 날 우산을 잃어버린 고양이가 친구를 찾아 떠나는 이야기',
      oninput: (e) => { draftTopic = e.target.value; },
    });
    topic.value = draftTopic;
    const sugBox = h('div', { class: 'row', style: { marginTop: '10px', gap: '6px' } });
    const sugBtn = h('button', {
      class: 'btn small',
      onclick: async () => {
        sugBtn.disabled = true;
        sugBtn.textContent = '🎲 생각하는 중…';
        const list = await AM.safe(() => window.api.suggestTopics(topic.value.trim()));
        sugBtn.disabled = false;
        sugBtn.textContent = '🎲 주제 추천받기';
        if (!list) return;
        AM.clear(sugBox);
        list.forEach((t) => sugBox.appendChild(h('span', { class: 'chip click', onclick: () => { topic.value = t; draftTopic = t; } }, t)));
      },
    }, '🎲 주제 추천받기');

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
        h('span', { class: 'chip' }, `노래 ${w.musicParts}×${w.partSeconds}초`),
        h('span', { class: 'chip' }, `컷 ${w.minClips}~${w.maxClips}개`),
        w.builtin ? null : h('span', { class: 'chip pri' }, '내 워크플로우')))));
    };
    renderCards();

    const start = async () => {
      const t = topic.value.trim();
      if (!t) { toast('주제를 한 줄 적어 주세요.', 'err'); topic.focus(); return; }
      if (allDemo) {
        const ok = await AM.confirmBox('체험 모드로 만들까요?', '지금은 모든 단계가 체험 모드입니다.\nAI 없이 가짜 그림·음악으로 전체 흐름만 보여 드려요. (무료, 약 1분)\n\n실제 영상을 만들려면 [AI 연결 설정] 에서 구독을 연결하세요.', '체험으로 시작');
        if (!ok) return;
      }
      const p = await AM.safe(() => window.api.createProject({ topic: t, workflowId: selectedWf }));
      if (p) {
        draftTopic = '';
        AM.state.projects.set(p.id, p);
        AM.go('project', p.id);
      }
    };

    return h('div', null,
      h('div', { class: 'hero' },
        h('h1', null, '어떤 뮤직비디오를 만들까요? 🎶'),
        h('p', null, '주제만 적으면 기획 → 노래 → 박자에 맞춘 컷 설계 → 키프레임 → 영상 클립 → 가사 자막을 입힌 완성본까지 자동으로 만들어요.')),
      allDemo ? h('div', { class: 'notice warn' }, '💡 지금은 ', h('b', null, '체험 모드'), '예요. 진짜 영상을 만들려면 ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); AM.go('settings'); } }, 'AI 연결 설정'), '에서 구독 중인 서비스를 연결해 주세요.') : null,
      !allDemo && someDemo ? h('div', { class: 'notice info' }, 'ℹ 일부 단계가 체험 모드로 설정되어 있어요. (AI 연결 설정에서 바꿀 수 있어요)') : null,
      h('div', { class: 'section topic-box' },
        h('h3', null, '① 주제'),
        h('p', { class: 'desc' }, '어떤 이야기의 뮤직비디오인지 한두 문장으로 적어 주세요. 자세할수록 원하는 결과에 가까워져요.'),
        topic,
        h('div', { class: 'row', style: { marginTop: '10px' } }, sugBtn, h('span', { class: 'small muted' }, '아이디어가 없으면 눌러 보세요.')),
        sugBox),
      h('div', { class: 'section' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('h3', null, '② 워크플로우 (영상 스타일 틀)'), h('p', { class: 'desc' }, '화면 비율, 그림체, 노래 길이, 컷 수 같은 규칙 묶음이에요. 직접 만들려면 [워크플로우] 메뉴로 가세요.')),
          h('button', { class: 'btn small', onclick: () => AM.go('workflows') }, '🧩 워크플로우 만들기/수정')),
        cards),
      h('div', { class: 'section' },
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, h('h3', null, '③ 이렇게 만들어져요'), h('p', { class: 'desc' }, '각 단계를 누가 하는지 보여 줘요. (자동 = 알아서, 도우미 = 웹에서 직접 만들고 다운로드만 하면 자동으로 가져옴)')),
          h('button', { class: 'btn small', onclick: () => AM.go('settings') }, '🔌 담당 AI 바꾸기')),
        flowStrip(pv)),
      h('div', { style: { textAlign: 'center', margin: '26px 0' } },
        h('button', { class: 'btn primary big', onclick: start }, '▶ 뮤직비디오 만들기 시작'),
        h('div', { class: 'small muted', style: { marginTop: '8px' } }, '만드는 중에 다른 화면으로 가도 계속 진행돼요. 도움이 필요하면 알려 드릴게요.')));
  };

  AM.views.welcome = function welcome() {
    const done = async () => { await window.api.saveSettings({ firstRunDone: true }); await AM.refreshSettings(); };
    AM.modal('AnimeMaker 에 오신 걸 환영해요! 👋', h('div', null,
      h('p', null, '이 프로그램은 ', h('b', null, '주제 한 줄'), '로 1분짜리 AI 뮤직비디오를 만들어 줘요.'),
      h('ol', null,
        h('li', null, h('b', null, '구독 중인 AI 를 연결'), '해요. (ChatGPT, SuperGrok, Google AI(Gemini), Claude 중 가진 것)'),
        h('li', null, h('b', null, '워크플로우'), '(영상 스타일)를 고르고 ', h('b', null, '주제'), '를 적어요.'),
        h('li', null, '[시작] 을 누르면 끝까지 자동으로 진행돼요. 웹에서만 되는 단계(예: Gemini 음악)는 ', h('b', null, '도우미'), '가 안내해 줘요.')),
      h('div', { class: 'notice ok' }, '🔒 API 키(종량제 과금)는 쓰지 않아요. 이미 내고 있는 구독 요금 한도 안에서만 동작합니다.'),
      h('p', { class: 'muted small' }, '처음이라면 먼저 [체험 모드] 로 전체 흐름을 1분 만에 구경해 보세요. 돈도 사용량도 들지 않아요.')),
    [
      { label: '체험 모드로 먼저 구경하기', onClick: async () => { await done(); AM.go('home'); } },
      { label: '내 구독 연결하러 가기', kind: 'primary', onClick: async () => { await done(); AM.go('settings'); } },
    ], { sticky: true });
  };
}(window.AM));
