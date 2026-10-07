'use strict';
// 기본 설정과 기본 워크플로우(템플릿)

const DEFAULT_SETTINGS = {
  version: 1,
  firstRunDone: false,
  projectsDir: '', // 비어 있으면 문서\AnimeMaker
  downloadsDir: '', // 비어 있으면 시스템 다운로드 폴더
  providers: {
    text: 'demo',
    image: 'demo',
    video: 'demo',
  },
  helperSites: { image: 'gemini', video: 'grok' },
  videoMaxSeconds: 15, // 영상 AI 가 한 번에 만드는 최대 길이 (Grok Imagine: 15초). 더 긴 컷은 이어 만든다
  agents: {
    codex: { path: '', model: '', extraArgs: '' },
    grok: { path: '', model: '', extraArgs: '' },
    agy: { path: '', model: '', extraArgs: '' },
    claude: { path: '', model: '', extraArgs: '' },
  },
  bot: {
    enabled: false,
    acceptedRisk: false,
    browser: 'edge', // edge | chrome | custom
    browserPath: '',
    pace: 1.0, // 1 = 사람 속도, 클수록 느리게
    gapSeconds: 8, // 생성 요청 사이 쉬는 시간
  },
  onLimit: 'wait', // wait: 기다렸다 자동 재시도 | stop: 멈추고 알려주기
  limitWaitMinutes: 20,
  limitMaxHours: 6,
  concurrency: { image: 1, video: 1 },
};

const BASE_WORKFLOW = {
  aspect: '9:16',
  quality: '720p',
  visualStyle: 'vibrant Japanese anime style, cel shading, detailed backgrounds, cinematic lighting',
  minClips: 10,
  maxClips: 15,
  minClipSec: 1,
  maxClipSec: 30,
  pace: 'normal',
  keyframesPerClip: 1,
  characterSheet: true,
  transitionStyle: 'mixed',
  subtitles: { enabled: true, sizePct: 4.6, color: 'white', box: false, marginPct: 10 },
  sentenceTemplate: '{style}. {characters}. {subject}, {action}, {setting}. {camera}. {lighting}.',
  videoTemplate: '{motion}. {action}. {camera}. {end}. Keep the same character design and art style as the first frame. {tempo}',
  extraInstructions: '',
  lyricSyncPause: true, // 가사에 시간이 없으면 컷을 나누기 전에 '탭으로 가사 맞추기' 기회를 준다
  reviewAfterPlan: false,
  reviewAfterTiming: false,
};

const BUILTIN_WORKFLOWS = [
  {
    ...BASE_WORKFLOW,
    id: 'builtin-anime-shorts',
    builtin: true,
    emoji: '🌸',
    name: '애니 뮤직비디오 (세로)',
    description: '세로 9:16, 밝은 애니메이션 그림체. 3~4분 노래를 컷 10~15개(1~30초)로. 처음이라면 이걸로 시작하세요.',
  },
  {
    ...BASE_WORKFLOW,
    id: 'builtin-cinematic',
    builtin: true,
    emoji: '🎬',
    name: '시네마틱 감성 (유튜브 가로)',
    description: '가로 16:9, 영화 같은 실사풍 화면. 발라드처럼 느린 곡에 어울리게 컷을 길게 쓰고 부드럽게 전환합니다.',
    aspect: '16:9',
    visualStyle: 'cinematic photorealistic film still, 35mm, shallow depth of field, soft film grain, moody color grading',
    pace: 'slow',
    minClips: 10,
    maxClips: 12,
    transitionStyle: 'smooth',
  },
  {
    ...BASE_WORKFLOW,
    id: 'builtin-storybook',
    builtin: true,
    emoji: '🧸',
    name: '동화책 동요 (정사각)',
    description: '1:1, 수채화 동화책 그림. 신나는 곡에 어울리게 짧은 컷을 많이 씁니다.',
    aspect: '1:1',
    visualStyle: 'cute watercolor storybook illustration, soft pastel colors, hand-drawn texture',
    pace: 'fast',
    minClips: 12,
    maxClips: 15,
  },
];

module.exports = { DEFAULT_SETTINGS, BASE_WORKFLOW, BUILTIN_WORKFLOWS };
