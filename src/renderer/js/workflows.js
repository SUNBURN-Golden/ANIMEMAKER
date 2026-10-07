'use strict';
/* 워크플로우(영상 스타일 틀) 만들기 · 고치기 */
(function (AM) {
  const { h, toast } = AM;
  AM.views = AM.views || {};
  let selected = null;

  const STYLE_PRESETS = [
    ['애니메이션', 'vibrant Japanese anime style, cel shading, detailed backgrounds, cinematic lighting'],
    ['실사 시네마틱', 'cinematic photorealistic film still, 35mm, shallow depth of field, soft film grain, moody color grading'],
    ['3D 애니메이션', '3D animated movie style, soft global illumination, expressive characters, Pixar-like rendering'],
    ['수채화 동화', 'cute watercolor storybook illustration, soft pastel colors, hand-drawn texture'],
    ['픽셀 아트', 'detailed 16-bit pixel art, retro game style, vivid palette'],
    ['웹툰', 'Korean webtoon style, clean line art, soft cel shading, bright colors'],
  ];
  const MUSIC_PRESETS = ['upbeat K-pop', 'emotional ballad', 'lo-fi chill hop', 'J-rock anime opening', 'EDM festival', 'acoustic folk', 'city pop 80s', 'cheerful children\'s song', 'cinematic orchestral'];

  function field(label, input, hint) {
    return h('label', { class: 'field' }, label, input, hint ? h('span', { class: 'hint' }, hint) : null);
  }
  function sel(value, opts) {
    const s = h('select', null, opts.map(([v, l]) => h('option', { value: v }, l)));
    s.value = String(value);
    return s;
  }
  function num(value, min, max, step = 1) { return h('input', { type: 'number', value, min, max, step }); }
  function txt(value) { return h('input', { type: 'text', value: value || '' }); }
  function area(value, rows = 3) { const t = h('textarea', { rows }); t.value = value || ''; return t; }
  function chk(value, label) {
    const c = h('input', { type: 'checkbox', checked: !!value });
    return { el: h('label', { class: 'check' }, c, label), get: () => c.checked };
  }

  AM.views.workflows = async function workflows() {
    const list = await window.api.listWorkflows();
    AM.state.workflows = list;
    if (!selected || !list.find((w) => w.id === selected)) selected = list[0].id;
    const wf = list.find((w) => w.id === selected);
    const listEl = h('div', { class: 'wf-list' },
      h('button', {
        class: 'btn primary',
        onclick: async () => {
          const base = list.find((w) => w.id === selected) || list[0];
          const copy = { ...base, id: null, builtin: false, name: `${base.name} (내 버전)`, emoji: '⭐' };
          const saved = await AM.safe(() => window.api.saveWorkflow(copy), '새 워크플로우를 만들었어요');
          if (saved) { selected = saved.id; AM.go('workflows'); }
        },
      }, '＋ 지금 것을 복사해서 새로 만들기'),
      list.map((w) => h('button', { class: `wf-item ${w.id === selected ? 'sel' : ''}`, onclick: () => { selected = w.id; AM.go('workflows'); } },
        h('div', { style: { fontWeight: 700 } }, `${w.emoji || '🎞️'} ${w.name}`),
        h('div', { class: 'small muted' }, w.builtin ? '기본 제공 (복사해서 수정)' : '내 워크플로우'))));
    return h('div', null,
      h('h1', { class: 'page-title' }, '🧩 워크플로우'),
      h('p', { class: 'page-sub' }, '워크플로우는 "어떤 스타일로 만들지" 정해 두는 틀이에요. 한 번 만들어 두면 주제만 바꿔서 계속 쓸 수 있어요.'),
      h('div', { class: 'wf-layout' }, listEl, editor(wf)));
  };

  function editor(wf) {
    const ro = !!wf.builtin;
    const f = {
      emoji: txt(wf.emoji), name: txt(wf.name), description: area(wf.description, 2),
      aspect: sel(wf.aspect, [['9:16', '세로 9:16 (쇼츠·릴스·틱톡)'], ['16:9', '가로 16:9 (유튜브)'], ['1:1', '정사각 1:1'], ['4:5', '세로 4:5 (인스타 피드)']]),
      quality: sel(wf.quality, [['720p', '720p (빠름, 기본)'], ['1080p', '1080p (업스케일)']]),
      visualStyle: area(wf.visualStyle, 3),
      musicGenre: txt(wf.musicGenre), vocal: sel(wf.vocal, [['female solo vocal', '여성 보컬'], ['male solo vocal', '남성 보컬'], ['male and female duet', '남녀 듀엣'], ['bright child-like vocal', '아이 목소리'], ['soft male vocal', '부드러운 남성 보컬'], ['choir', '합창'], ['instrumental, no vocals', '보컬 없음 (연주곡)']]),
      lyricsLanguage: sel(wf.lyricsLanguage, [['한국어', '한국어'], ['English', '영어'], ['日本語', '일본어'], ['한국어+English', '한국어+영어 섞기']]),
      musicParts: num(wf.musicParts, 1, 4), partSeconds: num(wf.partSeconds, 10, 180),
      minClips: num(wf.minClips, 1, 30), maxClips: num(wf.maxClips, 1, 40),
      minClipSec: num(wf.minClipSec, 1, 15, 0.5), maxClipSec: num(wf.maxClipSec, 1, 15, 0.5),
      pace: sel(wf.pace, [['fast', '빠르게 (짧은 컷 위주)'], ['normal', '보통'], ['slow', '느리게 (긴 컷 위주)']]),
      transitionStyle: sel(wf.transitionStyle, [['mixed', '다양하게 (컷 + 특수 전환)'], ['cuts', '컷 위주 (박자에 딱딱)'], ['smooth', '부드럽게 (페이드·디졸브)']]),
      keyframesPerClip: sel(wf.keyframesPerClip, [['1', '1장 (첫 장면)'], ['2', '2장 (첫 장면 + 끝 장면)']]),
      characterSheet: chk(wf.characterSheet, '캐릭터 기준 이미지를 먼저 만들어서 모든 장면의 인물을 똑같이 유지하기'),
      subOn: chk(wf.subtitles.enabled, '하단에 가사 자막 넣기'),
      subSize: num(wf.subtitles.sizePct, 2, 10, 0.1), subColor: sel(wf.subtitles.color, [['white', '흰색 + 검은 테두리'], ['yellow', '노란색 + 검은 테두리']]),
      subBox: chk(wf.subtitles.box, '글자 뒤에 반투명 검은 상자'), subMargin: num(wf.subtitles.marginPct, 2, 40, 0.5),
      sentenceTemplate: area(wf.sentenceTemplate, 2), videoTemplate: area(wf.videoTemplate, 2), extraInstructions: area(wf.extraInstructions, 3),
      reviewAfterPlan: chk(wf.reviewAfterPlan, '기획안(스토리보드·가사)이 나오면 멈추고 확인하기'),
      reviewAfterTiming: chk(wf.reviewAfterTiming, '타이밍 설계가 끝나면 멈추고 확인하기 (가사 싱크를 직접 맞추고 싶을 때)'),
    };
    const stylePresets = h('div', { class: 'presets' }, STYLE_PRESETS.map(([l, v]) => h('span', { class: 'chip click', onclick: () => { f.visualStyle.value = v; } }, l)));
    const musicPresets = h('div', { class: 'presets' }, MUSIC_PRESETS.map((v) => h('span', { class: 'chip click', onclick: () => { f.musicGenre.value = v; } }, v)));
    const total = h('span', { class: 'chip pri' });
    const updTotal = () => { total.textContent = `노래 총 ${Number(f.musicParts.value) * Number(f.partSeconds.value)}초`; };
    f.musicParts.addEventListener('input', updTotal);
    f.partSeconds.addEventListener('input', updTotal);
    updTotal();

    const collect = () => ({
      ...wf,
      emoji: f.emoji.value.trim() || '🎞️', name: f.name.value.trim() || '이름 없는 워크플로우', description: f.description.value.trim(),
      aspect: f.aspect.value, quality: f.quality.value, visualStyle: f.visualStyle.value.trim(),
      musicGenre: f.musicGenre.value.trim(), vocal: f.vocal.value, lyricsLanguage: f.lyricsLanguage.value,
      musicParts: clamp(f.musicParts.value, 1, 4), partSeconds: clamp(f.partSeconds.value, 10, 180),
      minClips: clamp(f.minClips.value, 1, 30), maxClips: Math.max(clamp(f.minClips.value, 1, 30), clamp(f.maxClips.value, 1, 40)),
      minClipSec: clamp(f.minClipSec.value, 1, 15), maxClipSec: Math.max(clamp(f.minClipSec.value, 1, 15), clamp(f.maxClipSec.value, 1, 15)),
      pace: f.pace.value, transitionStyle: f.transitionStyle.value, keyframesPerClip: Number(f.keyframesPerClip.value),
      characterSheet: f.characterSheet.get(),
      subtitles: { enabled: f.subOn.get(), sizePct: Number(f.subSize.value), color: f.subColor.value, box: f.subBox.get(), marginPct: Number(f.subMargin.value) },
      sentenceTemplate: f.sentenceTemplate.value.trim(), videoTemplate: f.videoTemplate.value.trim(), extraInstructions: f.extraInstructions.value.trim(),
      reviewAfterPlan: f.reviewAfterPlan.get(), reviewAfterTiming: f.reviewAfterTiming.get(),
    });

    const save = async () => {
      const data = collect();
      if (data.maxClipSec > 14.5) toast('컷 최대 길이가 15초에 가까우면 화면전환 여유가 없어서 끝 장면이 잠깐 멈출 수 있어요.');
      const saved = await AM.safe(() => window.api.saveWorkflow(data), '저장했어요');
      if (saved) { selected = saved.id; AM.go('workflows'); }
    };
    const del = async () => {
      if (!await AM.confirmBox('삭제', `"${wf.name}" 워크플로우를 지울까요?`, '삭제', 'danger')) return;
      await AM.safe(() => window.api.deleteWorkflow(wf.id), '삭제했어요');
      selected = null;
      AM.go('workflows');
    };

    const box = h('div', null,
      ro ? h('div', { class: 'notice info' }, '기본 제공 워크플로우는 직접 고칠 수 없어요. 왼쪽 위 [＋ 지금 것을 복사해서 새로 만들기] 를 눌러 내 버전을 만든 뒤 고치세요.') : null,
      h('div', { class: 'section' }, h('h3', null, '기본 정보'),
        h('div', { class: 'grid3' }, field('아이콘(이모지)', f.emoji), field('이름', f.name), field('화면 비율', f.aspect)),
        h('div', { style: { marginTop: '12px' } }, field('설명', f.description))),
      h('div', { class: 'section' }, h('h3', null, '🎨 그림체'),
        field('그림 스타일 (영어 권장)', f.visualStyle, '아래 버튼을 누르면 예시가 들어가요.'), stylePresets,
        h('div', { class: 'grid2', style: { marginTop: '12px' } }, field('화질', f.quality), field('컷당 키프레임', f.keyframesPerClip, '2장은 끝 장면도 만들어서 참고용으로 써요 (사용량 2배).')),
        h('div', { style: { marginTop: '10px' } }, f.characterSheet.el)),
      h('div', { class: 'section' }, h('h3', null, '🎵 노래'),
        h('p', { class: 'desc' }, 'Gemini 음악은 한 번에 30초 곡을 만들어요. 그래서 기본은 30초 × 2파트 = 1분이에요. ', total),
        field('장르·분위기', f.musicGenre), musicPresets,
        h('div', { class: 'grid3', style: { marginTop: '12px' } }, field('보컬', f.vocal), field('가사 언어', f.lyricsLanguage), h('div', { class: 'grid2' }, field('파트 수', f.musicParts), field('파트 길이(초)', f.partSeconds)))),
      h('div', { class: 'section' }, h('h3', null, '✂ 컷 · 화면전환'),
        h('p', { class: 'desc' }, '컷 경계는 자동으로 박자 위에 놓이고, 가사 줄이 시작하는 곳과 마디 첫 박을 우선해요. 영상 AI 한계 때문에 컷 하나는 최대 15초예요.'),
        h('div', { class: 'grid3' }, field('컷 개수 최소', f.minClips), field('컷 개수 최대', f.maxClips), field('컷 템포', f.pace)),
        h('div', { class: 'grid3', style: { marginTop: '12px' } }, field('컷 최소 길이(초)', f.minClipSec), field('컷 최대 길이(초)', f.maxClipSec), field('화면전환 스타일', f.transitionStyle))),
      h('div', { class: 'section' }, h('h3', null, '💬 가사 자막'),
        f.subOn.el,
        h('div', { class: 'grid3', style: { marginTop: '10px' } }, field('글자 크기 (화면 높이의 %)', f.subSize), field('색', f.subColor), field('아래 여백 (%)', f.subMargin)),
        h('div', { style: { marginTop: '10px' } }, f.subBox.el)),
      h('div', { class: 'section' }, h('h3', null, '🛠 확인 단계 · 고급'),
        f.reviewAfterPlan.el, f.reviewAfterTiming.el,
        h('details', { class: 'adv', style: { marginTop: '12px' } }, h('summary', null, '고급: 문장 구조 틀 · 추가 지시'),
          h('div', { class: 'col', style: { marginTop: '10px' } },
            field('이미지 문장 구조 틀', f.sentenceTemplate, '{style} {characters} {subject} {action} {setting} {camera} {lighting} 를 조합해 키프레임 프롬프트를 만들어요.'),
            field('영상 프롬프트 틀', f.videoTemplate, '{motion} {action} {camera} {end} {tempo} {style}'),
            field('오케스트레이터 LLM 에게 추가로 전할 말', f.extraInstructions, '예) 마지막 장면은 꼭 해피엔딩 / 대사는 넣지 말 것 / 주인공은 고양이')))),
      h('div', { class: 'row', style: { justifyContent: 'flex-end' } },
        ro ? null : h('button', { class: 'btn danger', onclick: del }, '삭제'),
        ro ? null : h('button', { class: 'btn primary big', onclick: save }, '💾 저장')));
    if (ro) box.querySelectorAll('input, textarea, select').forEach((el) => { el.disabled = true; });
    if (ro) box.querySelectorAll('.presets .chip').forEach((el) => { el.style.pointerEvents = 'none'; el.style.opacity = '0.5'; });
    return box;
  }

  function clamp(v, a, b) { const n = Number(v); return Math.max(a, Math.min(b, Number.isFinite(n) ? n : a)); }
}(window.AM));
