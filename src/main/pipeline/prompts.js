'use strict';
// 오케스트레이터 LLM 에게 보내는 지시문과, 결과를 '문장 구조' 틀로 조립하는 함수들.

const TRANSITION_TYPES = ['cut', 'fade', 'dissolve', 'fadeblack', 'flash', 'slideleft', 'slideup', 'wipeleft', 'zoomin', 'circleopen', 'pixelize', 'smoothleft'];

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 기획(스토리보드·시나리오) 지시문. 노래와 가사는 사용자가 올린 것(Suno 등)을 그대로 쓴다.
 * @param {string} topic 사용자가 적은 영상 컨셉 (비어 있을 수 있음)
 * @param {string} lyricsText 구간 태그가 포함된 가사 (없으면 연주곡)
 * @param {{duration:number,bpm:number,downbeats:number[],bars:{level:string}[]}} analysis
 */
function planPrompt(topic, lyricsText, analysis, wf) {
  const energy = summarizeEnergy(analysis);
  return `# Task: storyboard and scenario for a music video of an existing song

The user already has the finished song (made with Suno) and its lyrics. You do NOT write lyrics or music.
You are the director, storyboard artist and scenario writer.

Song facts (measured from the audio file):
- Length: ${fmtTime(analysis.duration)} (${analysis.duration.toFixed(1)} seconds)
- Tempo: about ${Math.round(analysis.bpm)} BPM, ${analysis.downbeats.length} bars
- Energy over time (low/mid/high, in order): ${energy}

Lyrics (with Suno section tags):
${lyricsText || '(instrumental - no lyrics)'}

User's concept / topic (Korean, may be empty): ${topic || '(none - derive the story from the lyrics and mood)'}

Workflow settings:
- Aspect ratio: ${wf.aspect}
- Visual style: ${wf.visualStyle}
- The video will be cut into ${wf.minClips}-${wf.maxClips} shots of 1-30 seconds each, synced to the beat.
- Extra instructions from the user: ${wf.extraInstructions || '(none)'}

Rules:
- Korean for: title, logline, concept, description_ko, summary_ko.
- English for: visual_style, appearance_en, world_en, visual_en (image/video AIs work best in English).
- The story must follow the song from beginning to end: 5 to 9 acts, in order, each covering one or more lyric sections (use the section names from the lyrics, e.g. "Verse 1", "Chorus"). Choruses should feel like visual highlights.
- appearance_en must be a precise, reusable description (age, hair, face, outfit, colors) so every image keeps the same character.
- 1 to 3 characters (or none for a pure scenery video).
- Original content only: no real celebrities, brands, or copyrighted characters.

Return ONLY this JSON shape:
{
  "title": "...",
  "logline": "...",
  "concept": "...",
  "visual_style": "...",
  "characters": [{"name": "...", "description_ko": "...", "appearance_en": "..."}],
  "world_en": "...",
  "story": [{"act": 1, "sections": ["Intro", "Verse 1"], "summary_ko": "...", "visual_en": "..."}],
  "music": {"genre": "...", "mood": "..."}
}`;
}

function summarizeEnergy(analysis) {
  const bars = analysis.bars || [];
  if (!bars.length) return 'unknown';
  const chunks = 12;
  const out = [];
  for (let i = 0; i < chunks; i++) {
    const seg = bars.slice(Math.floor((i * bars.length) / chunks), Math.floor(((i + 1) * bars.length) / chunks));
    if (!seg.length) continue;
    const e = seg.reduce((a, b) => a + b.energy, 0) / seg.length;
    out.push(e > 0.75 ? 'high' : e > 0.45 ? 'mid' : 'low');
  }
  return out.join(' → ');
}

function validPlan(o) {
  return !!(o && typeof o === 'object' && o.title && Array.isArray(o.story) && o.story.length > 0);
}

function normalizePlan(o, wf) {
  return {
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
    story: (o.story || []).map((s, i) => ({
      act: i + 1,
      sections: Array.isArray(s.sections) ? s.sections.map(String) : [],
      summary_ko: String(s.summary_ko || s.summary || ''),
      visual_en: String(s.visual_en || ''),
    })),
    music: { genre: String((o.music && o.music.genre) || ''), mood: String((o.music && o.music.mood) || '') },
  };
}

function shotsPrompt(plan, segments, lyrics, analysis, wf) {
  const segText = segments.map((s) => {
    const lyr = s.lyrics.map((i) => lyrics[i] && lyrics[i].text).filter(Boolean);
    const sec = s.lyrics.map((i) => lyrics[i] && lyrics[i].section).filter(Boolean);
    return `- clip ${s.index}: ${s.start.toFixed(2)}s → ${s.end.toFixed(2)}s (${s.duration.toFixed(2)}s, ${s.beats} beats, energy ${s.energy})${sec.length ? ` [${[...new Set(sec)].join(', ')}]` : ''}${lyr.length ? ` lyrics: "${lyr.join(' / ')}"` : ' (instrumental)'}`;
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
Clips longer than 15 seconds are generated in two pieces (the second continues from the last frame of the first), so for those describe a shot that keeps evolving: a slow continuous camera move or an action that develops, not a single frozen pose.
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

/** 15초가 넘는 컷의 두 번째(이후) 조각: 앞 조각의 마지막 장면에서 이어서 */
function continuationPrompt(basePrompt, piece, pieces) {
  return `Continue the same shot seamlessly from this exact frame (part ${piece} of ${pieces}): same characters, same place, same lighting and art style, same direction of camera movement. ${basePrompt}`;
}

function characterSheetPrompt(plan, wf) {
  const chars = plan.characters.map((c) => `${c.name}: ${c.appearance_en}`).join('; ');
  return `${plan.visual_style || wf.visualStyle}. Character reference sheet on a plain light background: ${chars}. Full body, front view, each character clearly separated, consistent design, clean lines. No text, no letters, no watermark.`;
}

module.exports = {
  TRANSITION_TYPES, planPrompt, validPlan, normalizePlan, fmtTime,
  shotsPrompt, validShots, normalizeShots, composeKeyframePrompt, composeVideoPrompt, continuationPrompt, characterSheetPrompt,
};
