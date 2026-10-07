'use strict';
// 체험 모드용 글(가사·기획안·샷). AI 없이 전체 흐름을 무료로 확인할 때 쓴다. PC 앱과 폰 앱이 같이 쓴다.

const PALETTE = ['ff5e62', 'ff9966', 'f9d423', '7bc96f', '4facfe', '7c3aed', 'f472b6', '22d3ee', 'a3e635', 'fb7185', '60a5fa', 'fbbf24', '34d399', 'c084fc', 'f87171'];

/** 체험용 가사 (Suno 가사 형식) */
const DEMO_LYRICS = `[Intro]

[Verse 1]
작은 불빛 하나 따라
낯선 길을 걸어가
두근대는 이 마음이
나를 앞으로 데려가

[Chorus]
날아올라 저 하늘로
멈추지 마 지금 이대로
반짝이는 우리 꿈이
세상을 물들여

[Verse 2]
다시 한 번 손을 잡고
끝이 아닌 시작으로
함께라면 두렵지 않아
우리의 노래가 돼

[Chorus]
날아올라 저 하늘로
멈추지 마 지금 이대로
반짝이는 우리 꿈이
세상을 물들여

[Outro]`;

function demoPlan(topic, wf) {
  return {
    title: `${topic || '체험 뮤직비디오'} (체험)`,
    logline: `${topic || '반짝이는 꿈'} 을(를) 주제로 한 뮤직비디오`,
    concept: '체험 모드에서 자동으로 만든 기획안입니다. 실제 AI 를 연결하면 가사에 맞춘 훨씬 풍부한 이야기가 나옵니다.',
    visual_style: wf.visualStyle || 'colorful anime style',
    characters: [{ name: '주인공', description_ko: '밝은 표정의 주인공', appearance_en: 'a cheerful young hero with short brown hair, yellow hoodie, big expressive eyes' }],
    world_en: 'a dreamy city at dusk with glowing lights',
    story: [
      { act: 1, sections: ['Intro', 'Verse 1'], summary_ko: '주인공이 낯선 장소에서 신비한 빛을 발견한다', visual_en: 'hero discovers a glowing light in a quiet alley' },
      { act: 2, sections: ['Chorus'], summary_ko: '빛을 따라 하늘로 날아오른다', visual_en: 'hero flies above neon streets following the light' },
      { act: 3, sections: ['Verse 2'], summary_ko: '친구와 손을 잡고 다시 걷는다', visual_en: 'hero and a friend walk hand in hand under the stars' },
      { act: 4, sections: ['Chorus', 'Outro'], summary_ko: '새벽, 미소 지으며 마무리', visual_en: 'hero smiles at sunrise on a rooftop' },
    ],
    music: { genre: 'K-pop', mood: 'uplifting' },
  };
}

function demoShots(segments, plan) {
  const types = ['cut', 'fade', 'flash', 'slideleft', 'cut', 'zoomin', 'dissolve', 'cut', 'circleopen', 'fadeblack', 'cut', 'pixelize', 'cut', 'wipeleft', 'cut'];
  return {
    shots: segments.map((s, i) => {
      const act = plan.story[Math.min(plan.story.length - 1, Math.floor((i / segments.length) * plan.story.length))];
      return {
        clip: s.index,
        characters: ['주인공'],
        subject: 'the hero',
        action: act.visual_en,
        setting: plan.world_en,
        camera: i % 2 ? 'medium shot, slow push-in' : 'wide shot, gentle pan',
        lighting: s.energy === 'high' ? 'vivid neon rim light' : 'soft warm light',
        end_state: 'the hero looks toward the horizon',
        motion: s.energy === 'high' ? 'fast dynamic camera move on the beat' : 'slow smooth camera drift',
        transition_out: { type: types[i % types.length], beats: types[i % types.length] === 'cut' ? 0 : 0.5 },
      };
    }),
  };
}

module.exports = { PALETTE, DEMO_LYRICS, demoPlan, demoShots };
