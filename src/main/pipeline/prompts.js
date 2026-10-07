'use strict';
// 오케스트레이터 LLM 에게 보내는 지시문과, 결과를 '문장 구조' 틀로 조립하는 함수들.

const TRANSITION_TYPES = ['cut', 'fade', 'dissolve', 'fadeblack', 'flash', 'slideleft', 'slideup', 'wipeleft', 'zoomin', 'circleopen', 'pixelize', 'smoothleft'];

function planPrompt(topic, wf) {
  const parts = wf.musicParts || 2;
  const sec = wf.partSeconds || 30;
  return `# Task: plan a short AI music video

Topic (from the user, Korean): ${topic}

You are the director, storyboard artist, scenario writer and lyricist.
Create a complete plan for a ${parts * sec}-second music video. The song will be made as ${parts} separate ${sec}-second music tracks (parts) by a music AI and joined in order, so each part must work on its own and flow into the next (same genre, same BPM, same key, same singer).

Workflow settings:
- Aspect ratio: ${wf.aspect}
- Visual style: ${wf.visualStyle}
- Music genre/mood: ${wf.musicGenre}
- Vocal: ${wf.vocal}
- Lyrics language: ${wf.lyricsLanguage}
- Extra instructions from the user: ${wf.extraInstructions || '(none)'}

Rules:
- Korean for: title, logline, concept, description_ko, summary_ko.
- English for: visual_style, appearance_en, world_en, visual_en, style_prompt (image/music AIs work best in English).
- Lyrics in ${wf.lyricsLanguage}. Each part has ${Math.max(3, Math.round(sec / 7.5))}-${Math.max(4, Math.round(sec / 5))} short singable lines (one line = one subtitle, max ~18 Korean characters or ~8 English words).
- appearance_en must be a precise, reusable description (age, hair, face, outfit, colors) so every image keeps the same character.
- 1 to 3 characters. 4 to 6 story acts that follow the song from beginning to end.
- music.bpm must be a single integer. style_prompt must include genre, mood, BPM, instruments and vocal type, and say it is ${sec} seconds long.
- Original content only: no real celebrities, brands, or copyrighted characters/lyrics.

Return ONLY this JSON shape:
{
  "title": "...",
  "logline": "...",
  "concept": "...",
  "visual_style": "...",
  "characters": [{"name": "...", "description_ko": "...", "appearance_en": "..."}],
  "world_en": "...",
  "story": [{"act": 1, "summary_ko": "...", "visual_en": "..."}],
  "music": {"genre": "...", "bpm": 110, "key": "...", "mood": "...", "instruments": "...", "vocal": "...", "language": "..."},
  "song_parts": [{"part": 1, "role": "intro+verse", "style_prompt": "...", "lyrics": ["...", "..."]}]
}`;
}

function validPlan(o, wf) {
  return !!(o && typeof o === 'object' && o.title && Array.isArray(o.song_parts) && o.song_parts.length >= 1
    && o.song_parts.every((p) => Array.isArray(p.lyrics)) && Array.isArray(o.story)
    && (!wf || o.song_parts.length >= Math.min(wf.musicParts || 1, 1)));
}

function normalizePlan(o, wf) {
  const parts = wf.musicParts || 2;
  const plan = {
    title: String(o.title || '제목 없음'),
    logline: String(o.logline || ''),
    concept: String(o.concept || ''),
    visual_style: String(o.visual_style || wf.visualStyle || ''),
    characters: (Array.isArray(o.characters) ? o.characters : []).slice(0, 4).map((c, i) => ({
      name: String(c.name || `인물${i + 1}`),
      description_ko: String(c.description_ko || ''),
      appearance_en: String(c.appearance_en || c.appearance || ''),
    })),
    world_en: String(o.world_en || ''),
    story: (o.story || []).map((s, i) => ({ act: i + 1, summary_ko: String(s.summary_ko || s.summary || ''), visual_en: String(s.visual_en || '') })),
    music: { ...(o.music || {}) },
    song_parts: [],
  };
  const bpm = parseInt(plan.music.bpm, 10);
  plan.music.bpm = Number.isFinite(bpm) && bpm > 40 && bpm < 220 ? bpm : 110;
  for (let i = 0; i < parts; i++) {
    const src = o.song_parts[i] || o.song_parts[o.song_parts.length - 1];
    plan.song_parts.push({
      part: i + 1,
      role: String(src.role || ''),
      style_prompt: String(src.style_prompt || `${wf.musicGenre}, ${plan.music.bpm} BPM, ${wf.partSeconds || 30} seconds`),
      lyrics: (src.lyrics || []).map((l) => String(l).trim()).filter(Boolean),
    });
  }
  return plan;
}

/** 음악 AI(예: Gemini)에 붙여넣을 글 */
function musicPasteText(plan, part, wf) {
  const p = plan.song_parts[part - 1];
  return [
    `Make a ${wf.partSeconds || 30}-second song.`,
    `Style: ${p.style_prompt}`,
    `Genre: ${plan.music.genre || wf.musicGenre}. Tempo: ${plan.music.bpm} BPM. Key: ${plan.music.key || 'any'}. Vocal: ${plan.music.vocal || wf.vocal}.`,
    part > 1 ? `This is part ${part} of the same song (continue the same melody, singer and sound as part ${part - 1}).` : '',
    'Lyrics:',
    ...p.lyrics,
  ].filter(Boolean).join('\n');
}

function shotsPrompt(plan, segments, lyrics, analysis, wf) {
  const segText = segments.map((s) => {
    const lyr = s.lyrics.map((i) => lyrics[i] && lyrics[i].text).filter(Boolean);
    return `- clip ${s.index}: ${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s (${s.duration.toFixed(2)}s, ${s.beats} beats, part ${s.part}, energy ${s.energy})${lyr.length ? ` lyrics: "${lyr.join(' / ')}"` : ' (instrumental)'}`;
  }).join('\n');
  const trStyle = {
    cuts: 'Mostly hard cuts on the beat; use at most 2 special transitions.',
    smooth: 'Mostly soft transitions (fade, dissolve) of 0.5-1 beat; a few cuts.',
    mixed: 'Mix hard cuts (on strong beats) with special transitions at section changes and chorus entries.',
  }[wf.transitionStyle || 'mixed'];
  return `# Task: shot list for a beat-synced music video

The song has already been analysed. BPM ${analysis.bpm}. Total ${analysis.duration.toFixed(2)}s.
The cut points below are FIXED (they sit exactly on the beat). Do not change the clip count or timing.

Plan (title / characters / story):
${JSON.stringify({ title: plan.title, visual_style: plan.visual_style, characters: plan.characters, world_en: plan.world_en, story: plan.story }, null, 1)}

Clips:
${segText}

For every clip describe ONE continuous shot that matches the lyrics and the energy of that moment, following the story acts in order.
Transitions: "transition_out" is the transition from this clip into the next one. Allowed types: ${TRANSITION_TYPES.join(', ')}. "beats" is the transition length in beats (0 for cut, otherwise 0.25, 0.5, 1 or 2). ${trStyle} The last clip's transition_out is ignored.
Fields must be short English phrases (they are combined into an image prompt sentence):
- characters: names (from the plan) that appear in the shot, [] if none
- subject, action, setting, camera (shot size + angle), lighting
- end_state: how the shot looks at its end (used for an optional end keyframe)
- motion: camera and subject movement during the clip, matching the tempo (energy high = dynamic, low = slow)

Return ONLY this JSON shape with exactly ${segments.length} shots:
{"shots": [{"clip": 1, "characters": ["..."], "subject": "...", "action": "...", "setting": "...", "camera": "...", "lighting": "...", "end_state": "...", "motion": "...", "transition_out": {"type": "cut", "beats": 0}}]}`;
}

function validShots(o) {
  return !!(o && Array.isArray(o.shots) && o.shots.length > 0 && o.shots.every((s) => s && (s.action || s.subject)));
}

function normalizeShots(o, segments) {
  const shots = Array.isArray(o.shots) ? o.shots : [];
  return segments.map((seg, i) => {
    const s = shots.find((x) => Number(x.clip) === seg.index) || shots[i] || shots[shots.length - 1] || {};
    return {
      clip: seg.index,
      characters: Array.isArray(s.characters) ? s.characters.map(String) : [],
      subject: String(s.subject || ''),
      action: String(s.action || ''),
      setting: String(s.setting || ''),
      camera: String(s.camera || ''),
      lighting: String(s.lighting || ''),
      end_state: String(s.end_state || ''),
      motion: String(s.motion || ''),
      transition_out: s.transition_out && typeof s.transition_out === 'object' ? s.transition_out : { type: 'cut', beats: 0 },
    };
  });
}

function charactersText(plan, names) {
  if (!names || !names.length) return '';
  const use = plan.characters.filter((c) => names.some((n) => n && (c.name.includes(n) || n.includes(c.name))));
  return use.map((c) => `${c.name}: ${c.appearance_en}`).join('; ');
}

function fillSentence(tpl, map) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => map[k] || '')
    .replace(/\s+([,.])/g, '$1')
    .replace(/([,.])\s*[,.]+/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.]+/, '')
    .trim();
}

/** 문장 구조 틀로 키프레임 이미지 프롬프트를 조립 */
function composeKeyframePrompt(shot, plan, wf, slot = 1) {
  const map = {
    style: plan.visual_style || wf.visualStyle,
    characters: charactersText(plan, shot.characters),
    subject: shot.subject,
    action: slot === 2 && shot.end_state ? shot.end_state : shot.action,
    setting: shot.setting || plan.world_en,
    camera: shot.camera,
    lighting: shot.lighting,
    aspect: wf.aspect,
  };
  const body = fillSentence(wf.sentenceTemplate || '{style}. {characters}. {subject}, {action}, {setting}. {camera}. {lighting}.', map);
  return `${body} Composition for ${wf.aspect} frame. No text, no letters, no watermark, no subtitles.`;
}

function composeVideoPrompt(shot, plan, wf, analysis, seg) {
  const tempo = seg.energy === 'high'
    ? `Energetic, rhythmic motion synced to ${analysis.bpm} BPM.`
    : seg.energy === 'low' ? 'Calm, slow and smooth motion.' : `Steady motion that feels the ${analysis.bpm} BPM pulse.`;
  const map = {
    motion: shot.motion,
    action: shot.action,
    camera: shot.camera,
    end: shot.end_state ? `It ends with ${shot.end_state}` : '',
    tempo,
    style: plan.visual_style || wf.visualStyle,
  };
  const body = fillSentence(wf.videoTemplate || '{motion}. {action}. {camera}. {end}. Keep the same character design and art style as the first frame. {tempo}', map);
  return `${body} No text, no subtitles, no logo.`;
}

function characterSheetPrompt(plan, wf) {
  const chars = plan.characters.map((c) => `${c.name}: ${c.appearance_en}`).join('; ');
  return `${plan.visual_style || wf.visualStyle}. Character reference sheet on a plain light background: ${chars}. Full body, front view, each character clearly separated, consistent design, clean lines. No text, no letters, no watermark.`;
}

module.exports = {
  TRANSITION_TYPES, planPrompt, validPlan, normalizePlan, musicPasteText,
  shotsPrompt, validShots, normalizeShots, composeKeyframePrompt, composeVideoPrompt, characterSheetPrompt,
};
