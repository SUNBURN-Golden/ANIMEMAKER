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
    music: 'demo',
  },
  helperSites: { image: 'gemini', video: 'grok', music: 'gemini' },
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
  musicGenre: 'upbeat K-pop / J-pop',
  vocal: 'female solo vocal',
  lyricsLanguage: '한국어',
  musicParts: 2,
  partSeconds: 30,
  minClips: 10,
  maxClips: 15,
  minClipSec: 1,
  maxClipSec: 14,
  pace: 'normal',
  keyframesPerClip: 1,
  characterSheet: true,
  transitionStyle: 'mixed',
  subtitles: { enabled: true, sizePct: 4.6, color: 'white', box: false, marginPct: 10 },
  sentenceTemplate: '{style}. {characters}. {subject}, {action}, {setting}. {camera}. {lighting}.',
  videoTemplate: '{motion}. {action}. {camera}. {end}. Keep the same character design and art style as the first frame. {tempo}',
  extraInstructions: '',
  reviewAfterPlan: false,
  reviewAfterTiming: false,
};

const BUILTIN_WORKFLOWS = [
  {
    ...BASE_WORKFLOW,
    id: 'builtin-anime-shorts',
    builtin: true,
    emoji: '🌸',
    name: '애니 뮤직비디오 (쇼츠 세로)',
    description: '세로 9:16, 밝은 애니메이션 그림체, 경쾌한 K-pop 풍 1분짜리 노래. 처음이라면 이걸로 시작하세요.',
  },
  {
    ...BASE_WORKFLOW,
    id: 'builtin-cinematic',
    builtin: true,
    emoji: '🎬',
    name: '시네마틱 감성 (유튜브 가로)',
    description: '가로 16:9, 영화 같은 실사풍 화면, 잔잔한 발라드/로파이. 컷을 길게 쓰고 부드럽게 전환합니다.',
    aspect: '16:9',
    visualStyle: 'cinematic photorealistic film still, 35mm, shallow depth of field, soft film grain, moody color grading',
    musicGenre: 'emotional lo-fi ballad',
    vocal: 'soft male vocal',
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
    description: '1:1, 수채화 동화책 그림, 귀엽고 신나는 동요. 빠른 컷 전환.',
    aspect: '1:1',
    visualStyle: 'cute watercolor storybook illustration, soft pastel colors, hand-drawn texture',
    musicGenre: 'cheerful children\'s song',
    vocal: 'bright child-like vocal',
    pace: 'fast',
    minClips: 12,
    maxClips: 15,
  },
];

module.exports = { DEFAULT_SETTINGS, BASE_WORKFLOW, BUILTIN_WORKFLOWS };
