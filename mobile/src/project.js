// 작품 화면: 단계(노래 → 이야기 → 컷 나누기 → 그림 → 움직이기 → 완성)를 하나씩
import * as PL from './pipeline.js';
import * as db from './db.js';
import * as N from './native.js';
import { h, clear, toast, sheet, confirmBox, busy, pickFile, fmtSize } from './ui.js';
import { analyzeSong, decodeSong } from './audio.js';
import { renderVideo, outputSize } from './render.js';
import { demoPicture } from './demo.js';
import { tapSync } from './tap.js';

let ctx = null; // { app, p, view, urls: [] }

const ENERGY = { high: '신나게', mid: '보통', low: '잔잔하게' };

function url(blob) {
  const u = URL.createObjectURL(blob);
  ctx.urls.push(u);
  return u;
}

async function save() {
  await db.saveProject(ctx.p);
}

function refresh() {
  if (ctx) ctx.app.render();
}

/** 다른 화면에서 쓸 수 있게: 지금 열린 작품 */
export function currentProject() {
  return ctx ? ctx.p : null;
}

export function closeProject() {
  if (ctx) for (const u of ctx.urls) URL.revokeObjectURL(u);
  ctx = null;
}

export async function openProject(app, id) {
  closeProject();
  const p = await db.getProject(id);
  if (!p) throw new Error('작품을 찾지 못했어요');
  ctx = { app, p, view: PL.currentStep(p), urls: [], expecting: null };
  return p;
}

export function getExpecting() {
  return ctx ? ctx.expecting : null;
}

function expect(e) {
  ctx.expecting = e;
}

function app(kind) {
  return ctx.app.settings[`${kind}App`] || (kind === 'video' ? 'grok' : 'chatgpt');
}

function appPicker(kind, onChange) {
  const cur = app(kind);
  return h('div', { class: 'chips' }, Object.entries(N.AI_APPS).filter(([, a]) => a.good.includes(kind)).map(([id, a]) =>
    h('button', {
      class: `chip ${id === cur ? 'on' : ''}`,
      onclick: () => { ctx.app.setSetting(`${kind}App`, id); if (onChange) onChange(); refresh(); },
    }, a.name)));
}

// ---------- 공유로 들어온 것 받기 ----------
export async function receiveShare(d) {
  if (!ctx) return false;
  const p = ctx.p;
  const exp = ctx.expecting || {};
  let used = false;
  for (const item of d.items || []) {
    const blob = await N.sharedItemToBlob(item);
    const mime = item.mime || blob.type || '';
    if (mime.startsWith('image/')) {
      if (exp.kind === 'sheet') {
        await setSheet(blob);
      } else {
        const it = (exp.kind === 'picture' && p.items.find((x) => x.clip === exp.clip)) || p.items.find((x) => !x.picture);
        if (!it) { toast('그림을 넣을 빈 칸이 없어요. 바꾸려는 컷의 [사진 고르기] 를 눌러 주세요.', 'warn'); continue; }
        await setPicture(it, blob);
      }
      used = true;
    } else if (mime.startsWith('video/')) {
      const it = (exp.kind === 'video' && p.items.find((x) => x.clip === exp.clip)) || p.items.find((x) => x.picture && !x.video);
      if (!it) { toast('영상을 넣을 칸이 없어요.', 'warn'); continue; }
      await setVideo(it, blob);
      used = true;
    } else if (mime.startsWith('audio/')) {
      if (await confirmBox('노래를 바꿀까요?', `받은 노래 "${item.name}" 로 이 작품의 노래를 바꿀까요? 분석·컷 나누기를 다시 해야 해요.`, '바꾸기')) {
        await setSong(blob, item.name);
        used = true;
      }
    }
  }
  if (d.text && d.text.trim()) used = (await receiveText(d.text)) || used;
  ctx.expecting = null;
  refresh();
  return used;
}

async function receiveText(text, quiet = false) {
  const p = ctx.p;
  const exp = ctx.expecting || {};
  try {
    if ((exp.kind === 'plan' || (!p.plan && p.music)) && /"story"/.test(text)) {
      PL.applyPlanReply(p, text);
      await save();
      toast('📝 이야기를 받았어요!');
      ctx.view = 'story';
      return true;
    }
    if ((exp.kind === 'shots' || (p.timing && p.timing.segments && !p.shots)) && /"shots"/.test(text)) {
      PL.applyShotsReply(p, text);
      await save();
      toast('🎬 장면 설계를 받았어요!');
      ctx.view = 'timing';
      return true;
    }
  } catch (e) {
    if (!quiet) toast(e.message, 'err', 5000);
    return false;
  }
  if (!quiet) toast('받은 글에서 AI 답장(JSON)을 찾지 못했어요. 답장 전체를 복사해서 [붙여넣기] 해 주세요.', 'warn', 5000);
  return false;
}

/** 앱으로 돌아왔을 때: 답장을 기다리는 중이면 클립보드를 살펴본다 */
export async function checkClipboardOnResume() {
  if (!ctx || !ctx.expecting || !['plan', 'shots'].includes(ctx.expecting.kind)) return;
  const text = await N.readClipboard();
  if (text && /[{[]/.test(text) && await receiveText(text, true)) { ctx.expecting = null; refresh(); }
}

// ---------- 파일 넣기 ----------
async function setSong(blob, name) {
  const p = ctx.p;
  await db.putFile(`${p.id}/song`, blob);
  p.song = { key: `${p.id}/song`, name: name || 'song', type: blob.type, size: blob.size };
  p.music = null;
  p.timing = p.timing && p.timing.lyricsSource === 'tap' ? null : p.timing;
  await save();
  await runAnalysis();
}

async function setSheet(blob) {
  const p = ctx.p;
  await db.putFile(`${p.id}/sheet`, blob);
  p.sheet = { key: `${p.id}/sheet` };
  p.output = null;
  await save();
  toast('🧑‍🎨 캐릭터 기준 그림을 넣었어요');
}

async function setPicture(it, blob) {
  const p = ctx.p;
  const key = `${p.id}/pic${it.clip}`;
  await db.putFile(key, blob);
  it.picture = { key, at: Date.now() };
  p.output = null;
  await save();
  toast(`🖼 컷 ${it.clip} 그림을 넣었어요`);
}

async function setVideo(it, blob) {
  const p = ctx.p;
  const key = `${p.id}/vid${it.clip}`;
  await db.putFile(key, blob);
  it.video = { key, at: Date.now(), size: blob.size };
  p.output = null;
  await save();
  toast(`🎞 컷 ${it.clip} 영상을 넣었어요`);
}

// ---------- 단계 실행 ----------
function runAnalysis() {
  if (!ctx.analyzing) ctx.analyzing = doAnalysis().finally(() => { if (ctx) ctx.analyzing = null; });
  return ctx.analyzing;
}

async function doAnalysis() {
  const p = ctx.p;
  const b = busy('🎵 노래의 박자를 듣고 있어요…');
  try {
    const blob = await db.getFile(p.song.key);
    const analysis = await analyzeSong(blob, { priorBpm: p.bpmOverride });
    PL.setAnalysis(p, analysis);
    await save();
    toast(`🎵 BPM ${analysis.bpm} · ${PL.fmtTime(analysis.duration)}`);
  } catch (e) {
    toast(e.message, 'err', 6000);
  } finally {
    b.done();
    refresh();
  }
}

async function runRender() {
  const p = ctx.p;
  const b = busy('🎬 영상을 만들고 있어요… 화면을 켜 두고 기다려 주세요');
  await N.keepAwake(true);
  try {
    const songBlob = await db.getFile(p.song.key);
    const song = await decodeSong(songBlob);
    const items = [];
    for (const it of p.items) {
      items.push({
        ...it,
        pictureBlob: it.picture ? await db.getFile(it.picture.key) : null,
        videoBlob: it.video ? await db.getFile(it.video.key) : null,
      });
    }
    const size = outputSize(p.wf.aspect, ctx.app.settings.quality);
    const started = Date.now();
    const r = await renderVideo({
      size, items, transitions: p.timing.transitions, lyrics: p.timing.lyrics, song,
      duration: p.music.analysis.duration, subtitles: p.wf.subtitles,
      onProgress: (f) => {
        const el = (Date.now() - started) / 1000;
        const left = f > 0.02 ? Math.round((el / f) * (1 - f)) : null;
        b.set(`🎬 영상을 만들고 있어요… ${Math.round(f * 100)}%${left != null ? ` (약 ${left}초 남음)` : ''}`, f);
      },
    });
    await db.putFile(`${p.id}/output`, r.blob);
    p.output = { key: `${p.id}/output`, size: r.blob.size, at: Date.now(), codecs: r.codecs, seconds: Math.round((Date.now() - started) / 1000) };
    await save();
    toast('🎉 뮤직비디오가 완성됐어요!');
  } catch (e) {
    console.error(e);
    toast(`영상 만들기 실패: ${e.message}`, 'err', 8000);
  } finally {
    await N.keepAwake(false);
    b.done();
    refresh();
  }
}

/** 체험: 버튼 하나로 끝까지 (AI 없이) */
export async function runDemoAll() {
  ctx.autoAnalyzed = true;
  await runAnalysis();
  const p = ctx.p;
  if (!p.music) return;
  const b = busy('🧪 체험용 이야기를 쓰는 중…');
  try {
    if (!p.plan) PL.applyDemoPlan(p);
    PL.cutSong(p);
    PL.applyDemoShots(p);
    const { w, h: hh } = outputSize(p.wf.aspect, '720p');
    for (const it of p.items) {
      b.set(`🖼 연습 그림 그리는 중… (${it.clip}/${p.items.length})`);
      if (!it.picture) {
        const key = `${p.id}/pic${it.clip}`;
        await db.putFile(key, await demoPicture({ index: it.clip - 1, w: Math.round(w / 2), h: Math.round(hh / 2) }));
        it.picture = { key, at: Date.now() };
      }
    }
    p.movingDone = true;
    await save();
  } finally {
    b.done();
  }
  ctx.view = 'finish';
  refresh();
  await runRender();
}

// ---------- 화면 ----------
export function projectView() {
  const p = ctx.p;
  const a = p.music && p.music.analysis;
  const cur = PL.currentStep(p);
  const reach = (id) => {
    const i = PL.STEPS.findIndex((s) => s.id === id);
    return PL.STEPS.slice(0, i).every((s) => PL.stepDone(p, s.id));
  };
  if (!reach(ctx.view)) ctx.view = cur;
  const stepper = h('div', { class: 'stepper' }, PL.STEPS.map((s, i) => {
    const done = PL.stepDone(p, s.id);
    return h('button', {
      class: `step ${done ? 'done' : ''} ${ctx.view === s.id ? 'on' : ''}`,
      disabled: !reach(s.id),
      onclick: () => { ctx.view = s.id; refresh(); },
    }, h('span', { class: 'num' }, done ? '✔' : String(i + 1)), h('span', null, `${s.icon} ${s.label}`));
  }));
  setTimeout(() => { const on = stepper.querySelector('.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' }); }, 0);
  const panel = { song: songStep, story: storyStep, timing: timingStep, pictures: picturesStep, moving: movingStep, finish: finishStep }[ctx.view]();
  return h('div', null,
    h('div', { class: 'proj-head' },
      h('div', { class: 'proj-title' }, p.title),
      a ? h('div', { class: 'muted small' }, `🎵 ${p.song ? p.song.name : ''} · ${PL.fmtTime(a.duration)} · BPM ${a.bpm}`) : null),
    stepper,
    panel);
}

function nextBtn(label = '다음 단계로 →') {
  const i = PL.STEPS.findIndex((s) => s.id === ctx.view);
  const nxt = PL.STEPS[i + 1];
  if (!nxt) return null;
  return h('button', { class: 'btn primary big', onclick: () => { ctx.view = nxt.id; refresh(); window.scrollTo(0, 0); } }, label);
}

// 1. 노래
function songStep() {
  const p = ctx.p;
  const a = p.music && p.music.analysis;
  const li = p.lyricsInput || { lines: [] };
  const lyr = h('textarea', { class: 'lyrics', rows: 8, placeholder: '[Verse 1]\n첫 줄 가사...\n[Chorus]\n...' });
  lyr.value = p.lyricsRaw || '';
  // 처음 열었을 때 한 번만 자동 분석 (실패하면 [다시 분석] 버튼으로)
  if (!a && p.song && !ctx.autoAnalyzed) { ctx.autoAnalyzed = true; setTimeout(runAnalysis, 50); }
  return h('div', null,
    h('div', { class: 'card' },
      h('h3', null, '🎵 노래'),
      p.song ? h('p', null, `${p.song.name} ${p.song.size ? `(${fmtSize(p.song.size)})` : ''}`) : h('p', { class: 'muted' }, '노래 파일이 없어요.'),
      a ? h('div', { class: 'facts' },
        h('div', null, h('b', null, PL.fmtTime(a.duration)), h('span', null, '길이')),
        h('div', null, h('b', null, String(a.bpm)), h('span', null, 'BPM (빠르기)')),
        h('div', null, h('b', null, String(a.downbeats.length)), h('span', null, '마디'))) : h('p', { class: 'muted' }, '분석 전이에요.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { const f = await pickFile('audio/*,video/mp4,.mp3,.m4a,.wav'); if (f) await setSong(f, f.name); } }, '🔁 노래 바꾸기'),
        p.song ? h('button', { class: 'btn', onclick: runAnalysis }, '🎧 다시 분석') : null,
        a ? h('button', {
          class: 'btn',
          onclick: async () => {
            const inp = h('input', { type: 'number', min: 50, max: 220, value: String(Math.round(a.bpm)) });
            const ok = await sheet('BPM 직접 정하기', h('div', null, h('p', { class: 'small' }, 'Suno 에서 정한 BPM 을 알면 적어 주세요. 박자를 더 정확히 찾아요.'), inp), [{ label: '취소', value: false }, { label: '다시 분석', kind: 'primary', value: true }]);
            if (ok) { p.bpmOverride = Number(inp.value) || null; await save(); await runAnalysis(); }
          },
        }, '🥁 BPM 고치기') : null)),
    h('div', { class: 'card' },
      h('h3', null, '📝 가사'),
      h('p', { class: 'muted small' }, li.timed ? `시간이 들어 있는 가사예요 (${li.source.toUpperCase()}). 자막이 그 시간에 맞춰 나와요.` : `${li.lines.length}줄 · [Verse], [Chorus] 같은 표시가 있으면 이야기와 컷을 더 잘 나눠요.`),
      lyr,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { const t = await N.readClipboard(); if (t) lyr.value = t; else toast('클립보드가 비어 있어요', 'warn'); } }, '📋 붙여넣기'),
        h('button', { class: 'btn', onclick: async () => { const f = await pickFile('.txt,.lrc,.srt,text/plain'); if (f) { lyr.value = await f.text(); p.lyricsName = f.name; } } }, '📂 가사 파일'),
        h('button', { class: 'btn primary', onclick: async () => { PL.setLyrics(p, lyr.value, p.lyricsName || ''); await save(); toast('가사를 저장했어요'); refresh(); } }, '💾 가사 저장'))),
    a ? nextBtn('이야기 만들러 가기 →') : null);
}

/** AI 앱에 부탁하고 답장을 받아 오는 상자 (이야기·장면 설계에 같이 씀) */
function askBox({ kind, title, desc, request, apply, demo, demoLabel }) {
  const reply = h('textarea', { rows: 5, placeholder: 'AI 답장을 여기에 붙여 넣어요' });
  const tryApply = async (text) => {
    try {
      apply(text);
      await save();
      toast('✔ 받았어요!');
      ctx.expecting = null;
      refresh();
    } catch (e) {
      toast(e.message, 'err', 6000);
    }
  };
  const appId = app('text');
  return h('div', { class: 'card' },
    h('h3', null, title),
    h('p', { class: 'small' }, desc),
    h('div', { class: 'label' }, '어느 AI 에게 부탁할까요? (구독 중인 앱)'),
    appPicker('text'),
    h('ol', { class: 'howto' },
      h('li', null, h('button', {
        class: 'btn primary',
        onclick: async () => {
          expect({ kind });
          try {
            const r = await N.sendToApp(appId, { text: request() });
            toast(r.direct ? `${N.AI_APPS[appId].name} 앱을 열었어요. 보내기(↑)를 누르세요` : '부탁할 글을 복사했어요. AI 앱에 붙여 넣고 보내세요', 'ok', 5000);
          } catch (e) { toast(e.message, 'err'); }
        },
      }, `① ${N.AI_APPS[appId].name} 에게 부탁하기`)),
      h('li', null, 'AI 가 답장을 다 쓰면, 답장을 ', h('b', null, '길게 눌러 [복사]'), ' 하고 이 앱으로 돌아와요. (돌아오면 자동으로 넣어 볼게요)'),
      h('li', null, h('button', { class: 'btn', onclick: async () => { const t = await N.readClipboard(); if (!t) { toast('클립보드가 비어 있어요', 'warn'); return; } reply.value = t; await tryApply(t); } }, '③ 📋 붙여넣기'))),
    h('details', null, h('summary', null, '직접 붙여 넣기 / 부탁할 글 보기'),
      reply,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: () => tryApply(reply.value) }, '확인'),
        h('button', { class: 'btn', onclick: async () => { await N.copyText(request()); toast('부탁할 글을 복사했어요'); } }, '부탁할 글 복사'))),
    demo ? h('button', { class: 'btn ghost', onclick: async () => { demo(); await save(); refresh(); } }, demoLabel) : null);
}

// 2. 이야기
function storyStep() {
  const p = ctx.p;
  const plan = p.plan;
  const ask = askBox({
    kind: 'plan',
    title: plan ? '📝 이야기 다시 부탁하기' : '📝 AI 에게 이야기 부탁하기',
    desc: '노래 길이·빠르기·가사를 담은 부탁 글을 AI 앱으로 보내요. AI 가 스토리보드와 시나리오(제목, 등장인물, 장면 흐름)를 써 줘요.',
    request: () => PL.planRequest(p),
    apply: (t) => PL.applyPlanReply(p, t),
    demo: () => PL.applyDemoPlan(p),
    demoLabel: '🧪 AI 없이 연습용 이야기 쓰기',
  });
  if (!plan) return h('div', null, ask);
  return h('div', null,
    h('div', { class: 'card' },
      h('h3', null, `🎬 ${plan.title}`),
      plan.logline ? h('p', null, h('b', null, plan.logline)) : null,
      plan.concept ? h('p', { class: 'small' }, plan.concept) : null,
      plan.characters.length ? h('div', null, h('div', { class: 'label' }, '등장인물'),
        plan.characters.map((c) => h('p', { class: 'small' }, h('b', null, c.name), ` · ${c.description_ko}`))) : null,
      h('div', { class: 'label' }, '장면 흐름'),
      h('ol', { class: 'acts' }, plan.story.map((s) => h('li', null, s.sections.length ? h('span', { class: 'tag' }, s.sections.join(', ')) : null, ` ${s.summary_ko}`)))),
    nextBtn('컷 나누러 가기 →'),
    ask);
}

// 3. 컷 나누기
function timingStep() {
  const p = ctx.p;
  const t = p.timing || {};
  if (!t.segments) {
    PL.cutSong(p);
    save();
  }
  const segs = p.timing.segments;
  const src = { tap: '직접 맞춤 ✔', lrc: '가사 파일 시간 ✔', srt: '자막 파일 시간 ✔', auto: '자동 추정 (탭으로 맞추면 정확해져요)' }[p.timing.lyricsSource] || '';
  return h('div', null,
    h('div', { class: 'card' },
      h('h3', null, '⏱ 가사 자막 시간'),
      h('p', { class: 'small' }, `${(p.timing.lyrics || []).length}줄 · ${src}`),
      (p.timing.lyrics || []).length ? h('button', {
        class: 'btn primary',
        onclick: async () => {
          const out = await tapSync(p.timing.lyrics, await db.getFile(p.song.key), p.music.analysis.duration);
          if (!out) return;
          PL.setTapLyrics(p, out);
          if (p.shots && await confirmBox('컷도 다시 나눌까요?', '새 가사 시간에 맞춰 컷 경계를 다시 나누면 장면 설계를 다시 부탁해야 해요.\n[자막만] 을 고르면 컷은 그대로 두고 자막 시간만 바꿔요.', '컷 다시 나누기', '자막만')) {
            PL.cutSong(p);
          }
          await save();
          toast('가사 시간을 저장했어요');
          refresh();
        },
      }, '⌨ 탭으로 가사 맞추기') : h('p', { class: 'muted small' }, '가사가 없어요 (연주곡).')),
    h('div', { class: 'card' },
      h('h3', null, `✂ 컷 ${segs.length}개`),
      h('p', { class: 'small muted' }, '박자와 가사 줄에 맞춰 자동으로 나눴어요. 신나는 부분(후렴)은 짧게, 잔잔한 부분은 길게 써요.'),
      h('div', { class: 'seglist' }, segs.map((s, i) => h('div', { class: 'seg' },
        h('b', null, `컷 ${s.index}`),
        h('span', null, `${PL.fmtTime(s.start)} ~ ${PL.fmtTime(s.end)} · ${s.duration.toFixed(1)}초 · ${ENERGY[s.energy] || ''}`),
        p.shots && p.timing.transitions[i] && p.timing.transitions[i].type !== 'cut' ? h('span', { class: 'tag' }, `→ ${(PL.TRANSITIONS[p.timing.transitions[i].type] || {}).label || ''}`) : null,
        p.shots ? h('div', { class: 'small muted' }, p.shots[i].action) : null))),
      h('button', { class: 'btn', onclick: async () => { PL.cutSong(p); await save(); refresh(); } }, '🔁 다시 나누기')),
    askBox({
      kind: 'shots',
      title: p.shots ? '🎬 장면 설계 다시 부탁하기' : '🎬 컷마다 장면 설계 부탁하기',
      desc: '컷마다 어떤 장면을 보여 줄지, 다음 컷으로 어떻게 넘어갈지(화면전환)를 AI 에게 부탁해요.',
      request: () => PL.shotsRequest(p),
      apply: (txt) => PL.applyShotsReply(p, txt),
      demo: () => PL.applyDemoShots(p),
      demoLabel: '🧪 AI 없이 연습용 장면 설계',
    }),
    p.items.length ? nextBtn('그림 만들러 가기 →') : null);
}

function thumb(blob, ratio, label) {
  const box = h('div', { class: 'thumb', style: { aspectRatio: ratio } });
  if (blob) box.appendChild(h('img', { src: url(blob) })); else box.appendChild(h('span', { class: 'ph' }, label));
  return box;
}

// 4. 그림
function picturesStep() {
  const p = ctx.p;
  const ratio = p.wf.aspect.replace(':', ' / ');
  const done = p.items.filter((it) => it.picture).length;
  const wrap = h('div', null);
  const imgApp = app('image');
  const needSheet = p.plan && p.plan.characters.length;
  const sendPic = async (it) => {
    expect({ kind: 'picture', clip: it.clip });
    const files = p.sheet ? [{ blob: await db.getFile(p.sheet.key), name: 'character.png' }] : [];
    const r = await N.sendToApp(imgApp, { text: PL.pictureRequest(p, it), files });
    toast(r.direct ? `${N.AI_APPS[imgApp].name} 앱에서 보내기(↑)를 누르고, 그림이 나오면 [공유 → AnimeMaker] 또는 저장 후 [사진 고르기]` : '부탁할 글을 복사했어요', 'ok', 6000);
  };
  wrap.appendChild(h('div', { class: 'card' },
    h('h3', null, `🖼 컷마다 그림 (${done}/${p.items.length})`),
    h('p', { class: 'small' }, '① [부탁하기] 를 누르면 AI 앱이 열려요 → ② 그림이 나오면 그림을 ', h('b', null, '공유 → AnimeMaker'), ' (또는 갤러리에 저장하고 여기서 [사진 고르기]).'),
    h('div', { class: 'label' }, '그림을 그릴 AI 앱'),
    appPicker('image')));
  const cards = [];
  if (needSheet) {
    cards.push(h('div', { class: 'media-card wide' },
      h('div', { class: 'mc-head' }, h('b', null, '🧑‍🎨 캐릭터 기준 그림'), h('span', { class: 'tag' }, '먼저 하면 좋아요')),
      h('p', { class: 'small muted' }, '주인공 모습을 한 장 먼저 만들어 두면, 다른 그림을 부탁할 때 같이 보내서 같은 캐릭터를 유지해요.'),
      p.sheet ? thumbAsync(p.sheet.key, '1 / 1') : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn primary small', onclick: async () => { expect({ kind: 'sheet' }); const r = await N.sendToApp(imgApp, { text: PL.sheetRequest(p) }); if (!r.direct) toast('부탁할 글을 복사했어요'); } }, `🤖 ${N.AI_APPS[imgApp].name} 에 부탁`),
        h('button', { class: 'btn small', onclick: async () => { const f = await pickFile('image/*'); if (f) { await setSheet(f); refresh(); } } }, '🖼 사진 고르기'),
        p.sheet ? h('button', { class: 'btn small ghost', onclick: async () => { await db.deleteFile(p.sheet.key); p.sheet = null; await save(); refresh(); } }, '지우기') : null)));
  }
  for (const it of p.items) {
    cards.push(h('div', { class: `media-card ${ctx.expecting && ctx.expecting.clip === it.clip && ctx.expecting.kind === 'picture' ? 'waiting' : ''}` },
      h('div', { class: 'mc-head' }, h('b', null, `컷 ${it.clip}`), h('span', { class: 'muted small' }, `${PL.fmtTime(it.start)} · ${(it.end - it.start).toFixed(1)}초`)),
      it.picture ? thumbAsync(it.picture.key, ratio) : thumb(null, ratio, `컷 ${it.clip}`),
      h('div', { class: 'row' },
        h('button', { class: `btn small ${it.picture ? '' : 'primary'}`, onclick: () => sendPic(it).catch((e) => toast(e.message, 'err')) }, it.picture ? '🔁 다시 부탁' : '🤖 부탁하기'),
        h('button', { class: 'btn small', onclick: async () => { const f = await pickFile('image/*'); if (f) { await setPicture(it, f); refresh(); } } }, '🖼 사진 고르기')),
      h('details', { class: 'small' }, h('summary', null, '부탁할 글'), h('p', { class: 'pre small' }, PL.pictureRequest(p, it)),
        h('button', { class: 'btn small', onclick: async () => { await N.copyText(PL.pictureRequest(p, it)); toast('복사했어요'); } }, '복사'))));
  }
  wrap.appendChild(h('div', { class: 'media-grid' }, cards));
  if (done < p.items.length) {
    wrap.appendChild(h('button', {
      class: 'btn ghost',
      onclick: async () => {
        const { w, h: hh } = outputSize(p.wf.aspect, '720p');
        for (const it of p.items) {
          if (it.picture) continue;
          const key = `${p.id}/pic${it.clip}`;
          await db.putFile(key, await demoPicture({ index: it.clip - 1, w: Math.round(w / 2), h: Math.round(hh / 2) }));
          it.picture = { key, at: Date.now() };
        }
        await save();
        refresh();
      },
    }, '🧪 빈 칸은 연습 그림으로 채우기'));
  }
  if (done === p.items.length) wrap.appendChild(nextBtn('움직이게 하러 가기 →'));
  return wrap;
}

/** 저장소에서 그림을 꺼내 보여 주는 썸네일 */
function thumbAsync(key, ratio) {
  const box = h('div', { class: 'thumb', style: { aspectRatio: ratio } });
  db.getFile(key).then((b) => { if (b) box.appendChild(h('img', { src: url(b) })); });
  return box;
}

// 5. 움직이기
function movingStep() {
  const p = ctx.p;
  const ratio = p.wf.aspect.replace(':', ' / ');
  const vidApp = app('video');
  const nVid = p.items.filter((it) => it.video).length;
  const sendVid = async (it) => {
    expect({ kind: 'video', clip: it.clip });
    const pic = await db.getFile(it.picture.key);
    const r = await N.sendToApp(vidApp, { text: PL.videoRequest(p, it), files: [{ blob: pic, name: `cut${it.clip}.png` }] });
    toast(r.direct ? '영상이 나오면 [공유 → AnimeMaker] 또는 저장 후 [영상 고르기]' : '부탁할 글을 복사했어요', 'ok', 6000);
  };
  const cards = p.items.map((it) => {
    const media = h('div', { class: 'thumb', style: { aspectRatio: ratio } });
    db.getFile((it.video || it.picture).key).then((b) => {
      if (!b) return;
      media.appendChild(it.video ? h('video', { src: url(b), muted: true, loop: true, playsInline: true, autoplay: true }) : h('img', { src: url(b), class: 'kenburns' }));
    });
    return h('div', { class: 'media-card' },
      h('div', { class: 'mc-head' }, h('b', null, `컷 ${it.clip}`), h('span', { class: 'tag' }, it.video ? '🎞 영상' : '🖼 그림 움직이기')),
      media,
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => sendVid(it).catch((e) => toast(e.message, 'err')) }, `🤖 ${N.AI_APPS[vidApp].name} 영상`),
        h('button', { class: 'btn small', onclick: async () => { const f = await pickFile('video/*'); if (f) { await setVideo(it, f); refresh(); } } }, '📼 영상 고르기'),
        it.video ? h('button', { class: 'btn small ghost', onclick: async () => { await db.deleteFile(it.video.key); it.video = null; p.output = null; await save(); refresh(); } }, '그림만') : null));
  });
  return h('div', null,
    h('div', { class: 'card' },
      h('h3', null, `🎞 움직이기 (영상 ${nVid}/${p.items.length})`),
      h('p', { class: 'small' }, '그대로 두면 그림이 천천히 확대되며 움직여요 (빠르고 무료). 진짜 움직이는 영상을 원하면 컷마다 AI 영상 앱(Grok, Gemini 등)에 부탁하세요. 영상이 컷보다 짧으면 조금 느리게 틀고, 그래도 모자라면 마지막 장면을 멈춰 보여 줘요.'),
      h('div', { class: 'label' }, '영상을 만들 AI 앱'),
      appPicker('video')),
    h('div', { class: 'media-grid' }, cards),
    h('button', { class: 'btn primary big', onclick: async () => { p.movingDone = true; await save(); ctx.view = 'finish'; refresh(); window.scrollTo(0, 0); } }, '이대로 완성하러 가기 →'));
}

// 6. 완성
function finishStep() {
  const p = ctx.p;
  const st = p.wf.subtitles;
  const setSub = async (k, v) => { st[k] = v; p.output = null; await save(); refresh(); };
  const out = h('div', null);
  if (p.output) {
    db.getFile(p.output.key).then((b) => {
      if (!b) return;
      const name = PL.outputName(p);
      out.appendChild(h('div', { class: 'card' },
        h('h3', null, '🎉 완성!'),
        h('video', { class: 'final', src: url(b), controls: true, playsInline: true, style: { aspectRatio: p.wf.aspect.replace(':', ' / ') } }),
        h('p', { class: 'small muted' }, `${fmtSize(b.size)} · ${(p.output.codecs && p.output.codecs.video) || ''} · 만드는 데 ${p.output.seconds || '?'}초`),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: async () => { try { const r = await N.saveToGallery(b, name); toast(r.saved ? `갤러리 (${r.folder}) 에 저장했어요` : '저장할 곳을 골라 주세요'); } catch (e) { toast(e.message, 'err'); } } }, '💾 갤러리에 저장'),
          h('button', { class: 'btn', onclick: () => N.shareFile(b, name).catch((e) => toast(e.message, 'err')) }, '📤 공유하기'),
          h('button', { class: 'btn', onclick: () => N.shareFile(new Blob([PL.srtText(p)], { type: 'application/x-subrip' }), name.replace(/\.mp4$/, '.srt')).catch((e) => toast(e.message, 'err')) }, '📝 자막 파일(.srt)'))));
    });
  }
  return h('div', null,
    out,
    h('div', { class: 'card' },
      h('h3', null, p.output ? '🔁 다시 만들기' : '🎬 영상 만들기'),
      h('div', { class: 'opts' },
        h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: st.enabled !== false, onchange: (e) => setSub('enabled', e.target.checked) }), ' 가사 자막 넣기'),
        h('label', { class: 'opt' }, h('input', { type: 'checkbox', checked: !!st.box, onchange: (e) => setSub('box', e.target.checked) }), ' 자막 뒤에 어두운 상자'),
        h('div', { class: 'chips' },
          h('button', { class: `chip ${st.color !== 'yellow' ? 'on' : ''}`, onclick: () => setSub('color', 'white') }, '흰 글씨'),
          h('button', { class: `chip ${st.color === 'yellow' ? 'on' : ''}`, onclick: () => setSub('color', 'yellow') }, '노란 글씨')),
        h('div', { class: 'chips' },
          ['720p', '1080p'].map((q) => h('button', { class: `chip ${ctx.app.settings.quality === q ? 'on' : ''}`, onclick: () => { ctx.app.setSetting('quality', q); refresh(); } }, q === '720p' ? '720p (빠름)' : '1080p (선명, 느림)')))),
      h('p', { class: 'small muted' }, '만드는 동안 화면을 켜 두고 다른 앱으로 가지 마세요. 3~4분 노래는 폰에 따라 몇 분 걸려요.'),
      h('button', { class: 'btn primary big', onclick: runRender }, p.output ? '🎬 다시 만들기' : '🎬 영상 만들기')));
}
