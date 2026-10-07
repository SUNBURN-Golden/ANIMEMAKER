'use strict';
// 체험 모드: AI 없이 내 PC 에서 가짜 결과물을 만들어 전체 흐름을 무료로 확인한다.
const { runFfmpeg } = require('../media/ffmpeg');

const PALETTE = ['ff5e62', 'ff9966', 'f9d423', '7bc96f', '4facfe', '7c3aed', 'f472b6', '22d3ee', 'a3e635', 'fb7185', '60a5fa', 'fbbf24', '34d399', 'c084fc', 'f87171'];

function demoPlan(topic, wf) {
  const parts = wf.musicParts || 2;
  const linesPerPart = 4;
  const lyricsKo = [
    ['작은 불빛 하나 따라', '낯선 길을 걸어가', '두근대는 이 마음이', '나를 앞으로 데려가'],
    ['날아올라 저 하늘로', '멈추지 마 지금 이대로', '반짝이는 우리 꿈이', '세상을 물들여'],
    ['다시 한 번 손을 잡고', '끝이 아닌 시작으로', '함께라면 두렵지 않아', '우리의 노래가 돼'],
    ['마지막 별이 질 때', '너의 이름 부를게', '오늘 밤이 지나도', '기억 속에 빛날게'],
  ];
  return {
    title: `${topic} (체험)`,
    logline: `${topic} 을(를) 주제로 한 짧은 뮤직비디오`,
    concept: '체험 모드에서 자동으로 만든 기획안입니다. 실제 AI 를 연결하면 훨씬 풍부해집니다.',
    visual_style: wf.visualStyle || 'colorful anime style',
    characters: [{ name: '주인공', description_ko: '밝은 표정의 주인공', appearance_en: 'a cheerful young hero with short brown hair, yellow hoodie, big expressive eyes' }],
    world_en: 'a dreamy city at dusk with glowing lights',
    story: [
      { act: 1, summary_ko: '주인공이 낯선 장소에서 신비한 빛을 발견한다', visual_en: 'hero discovers a glowing light in a quiet alley' },
      { act: 2, summary_ko: '빛을 따라 모험을 떠난다', visual_en: 'hero runs through neon streets following the light' },
      { act: 3, summary_ko: '하늘로 날아오르며 클라이맥스', visual_en: 'hero flies above the city among stars' },
      { act: 4, summary_ko: '새벽, 미소 지으며 마무리', visual_en: 'hero smiles at sunrise on a rooftop' },
    ],
    music: { genre: wf.musicGenre || 'J-pop', bpm: 120, mood: 'uplifting', instruments: 'synth, drums, bass', vocal: wf.vocal || 'female', language: wf.lyricsLanguage || 'Korean' },
    song_parts: Array.from({ length: parts }, (_, i) => ({
      part: i + 1,
      role: i === 0 ? 'verse' : 'chorus',
      style_prompt: `${wf.musicGenre || 'J-pop'}, 120 BPM, uplifting, ${i === 0 ? 'verse building up' : 'big catchy chorus'}`,
      lyrics: lyricsKo[i % lyricsKo.length].slice(0, linesPerPart),
    })),
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

async function demoImage({ index = 0, slot = 1, w = 720, h = 1280, out, signal }) {
  const c0 = PALETTE[index % PALETTE.length];
  const c1 = PALETTE[(index + 5 + slot) % PALETTE.length];
  const bx = Math.round(w * (0.15 + 0.25 * (slot - 1)));
  const vf = [
    `drawbox=x=${bx}:y=${Math.round(h * 0.55)}:w=${Math.round(w * 0.3)}:h=${Math.round(w * 0.3)}:color=white@0.85:t=fill`,
    `drawbox=x=${Math.round(w * 0.1)}:y=${Math.round(h * 0.1)}:w=${Math.round(w * 0.8)}:h=${Math.round(h * 0.03)}:color=black@0.35:t=fill`,
  ].join(',');
  try {
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=0x${c0}:c1=0x${c1}:x0=0:y0=0:x1=${w}:y1=${h}:d=1`, '-vf', vf, '-frames:v', '1', out], { signal });
  } catch (_) {
    await runFfmpeg(['-y', '-f', 'lavfi', '-i', `color=c=0x${c0}:s=${w}x${h}:d=1`, '-vf', vf, '-frames:v', '1', out], { signal });
  }
  return out;
}

async function demoVideo({ image, seconds, w = 720, h = 1280, out, signal }) {
  const frames = Math.round(seconds * 24);
  await runFfmpeg(['-y', '-i', image, '-vf',
    `scale=${w * 2}:${h * 2},zoompan=z='1+0.25*on/${frames}':x='iw/2-(iw/zoom/2)+20*sin(on/12)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=24,format=yuv420p`,
    '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', out], { signal });
  return out;
}

/** 박자가 분명한 체험용 음악 (킥 드럼 + 화음) */
async function demoMusic({ part = 1, seconds = 30, bpm = 120, out, signal }) {
  const p = (60 / bpm).toFixed(5);
  const bar = (240 / bpm).toFixed(5);
  const chords = part % 2 ? [261.63, 329.63, 392.0] : [220.0, 277.18, 329.63];
  const pad = chords.map((f, i) => `${(0.07 - i * 0.01).toFixed(3)}*sin(2*PI*${f}*t)`).join('+');
  const kick = `(1+0.6*lt(mod(t,${bar}),${p}))*0.55*sin(2*PI*(50+90*exp(-30*mod(t,${p})))*mod(t,${p}))*exp(-9*mod(t,${p}))`;
  const hat = `0.05*sin(2*PI*7000*t+30*sin(2*PI*3100*t))*exp(-60*mod(t+${(60 / bpm / 2).toFixed(5)},${p}))`;
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', `aevalsrc='${kick}+${hat}+${pad}':s=44100:d=${seconds}`,
    '-af', 'afade=t=in:d=0.3,volume=0.9', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k', out], { signal });
  return out;
}

module.exports = { demoPlan, demoShots, demoImage, demoVideo, demoMusic };
