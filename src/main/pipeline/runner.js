'use strict';
// 전체 자동화 진행자 (오케스트레이션)
//  1 plan      기획: 스토리보드 · 시나리오 · 가사 · 음악 스타일   (구독 LLM)
//  2 music     음악: 노래 만들기/불러오기 → 이어붙이기 → BPM·박자 분석 (도우미/자동클릭 + 내 PC)
//  3 timing    타이밍: 가사 싱크 · 박자에 맞춘 컷 나누기 · 화면전환 · 샷 설계 (내 PC + 구독 LLM)
//  4 keyframes 키프레임 이미지                                    (구독 AI)
//  5 clips     영상 클립 1~15초                                   (구독 AI)
//  6 edit      이어붙이기 + 하단 가사 자막 + 노래 깔기               (내 PC, 무료)
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const { agentText, agentImage, agentVideo, AGENTS } = require('../ai/agents');
const { LimitError } = require('../ai/cli');
const demo = require('../ai/demo');
const { waitForNewDownload, SITES, EXTS } = require('../ai/helper');
const { NeedsUserError } = require('../ai/webbot/engine');
const { analyzeSong } = require('../media/audio');
const { estimateLyricTiming, segmentSong, resolveTransitions, clipNeeds, toSrt, toLrc } = require('../media/timeline');
const { outputSize, normalizeClip, joinSongParts, buildAss, assembleFinal } = require('../media/assemble');
const { probe } = require('../media/ffmpeg');
const P = require('./prompts');

const STEPS = ['plan', 'music', 'timing', 'keyframes', 'clips', 'edit'];
const STEP_LABELS = {
  plan: '기획 (스토리보드·시나리오·가사)',
  music: '음악 준비 + BPM 분석',
  timing: '타이밍 설계 (가사 싱크·컷·전환)',
  keyframes: '키프레임 이미지',
  clips: '영상 클립',
  edit: '최종 편집 (자막·노래)',
};

function pad2(n) { return String(n).padStart(2, '0'); }
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('사용자가 중지했습니다.'); e.name = 'AbortError'; reject(e); }, { once: true });
  });
}
function safeName(s) { return String(s || 'video').replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50) || 'video'; }

class ProjectRunner extends EventEmitter {
  /**
   * @param {{store: import('../store').Store, projectId: string, bot?: import('../ai/webbot/manager').BotManager,
   *          renderSubtitles?: Function, maxRetries?: number}} o
   */
  constructor(o) {
    super();
    this.store = o.store;
    this.bot = o.bot || null;
    this.renderSubtitles = o.renderSubtitles || null;
    this.maxRetries = o.maxRetries ?? 2;
    this.p = this.store.loadProject(o.projectId);
    if (!this.p) throw new Error('프로젝트를 찾을 수 없습니다.');
    this.dir = this.store.projectDir(this.p.id);
    this.running = false;
    this.abort = null;
    this.waiters = new Map();
    this.reviewWaiter = null;
  }

  // ---------- 공통 ----------
  abs(rel) { return rel ? path.join(this.dir, rel) : null; }
  rel(abs) { return path.relative(this.dir, abs).split(path.sep).join('/'); }
  exists(rel) { return !!rel && fs.existsSync(this.abs(rel)); }
  get wf() { return this.p.workflow; }
  get settings() { return this.store.getSettings(); }

  log(msg) {
    const d = new Date();
    const line = `[${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}] ${msg}`;
    try { fs.appendFileSync(path.join(this.dir, 'log.txt'), `${line}\n`); } catch (_) { /* noop */ }
    this.emit('log', { projectId: this.p.id, line });
  }

  save() {
    this.store.saveProject(this.p);
    this.emit('update', this.snapshot());
  }

  snapshot() {
    return { ...this.p, dir: this.dir, running: this.running };
  }

  setStep(step, patch) {
    this.p.steps[step] = { ...(this.p.steps[step] || {}), ...patch };
    this.p.currentStep = step;
    this.save();
  }

  checkAbort() {
    if (this.abort && this.abort.signal.aborted) {
      const e = new Error('사용자가 중지했습니다.');
      e.name = 'AbortError';
      throw e;
    }
  }

  // ---------- 실행 제어 ----------
  async run({ from } = {}) {
    if (this.running) return;
    this.running = true;
    this.abort = new AbortController();
    this.p.status = 'running';
    this.p.error = null;
    this.save();
    const startIdx = from ? Math.max(0, STEPS.indexOf(from)) : 0;
    if (from) {
      // 지정한 단계부터 다시: 그 단계 이후 상태 초기화
      for (const s of STEPS.slice(startIdx)) if (this.p.steps[s]) this.p.steps[s].status = 'pending';
    }
    let limitWaitedMs = 0;
    try {
      for (let i = startIdx; i < STEPS.length; i++) {
        const step = STEPS[i];
        if (this.p.steps[step] && this.p.steps[step].status === 'done') continue;
        this.checkAbort();
        try {
          this.setStep(step, { status: 'running', message: '진행 중…', startedAt: Date.now() });
          this.log(`▶ ${STEP_LABELS[step]} 시작`);
          await this[`step_${step}`]();
          this.setStep(step, { status: 'done', message: '완료', finishedAt: Date.now() });
          this.log(`✔ ${STEP_LABELS[step]} 완료`);
        } catch (e) {
          if (e instanceof LimitError || e.kind === 'limit') {
            const s = this.settings;
            const waitMs = (s.limitWaitMinutes || 20) * 60 * 1000;
            if (s.onLimit === 'wait' && limitWaitedMs + waitMs <= (s.limitMaxHours || 6) * 3600 * 1000) {
              limitWaitedMs += waitMs;
              this.p.status = 'limited';
              this.p.limitUntil = Date.now() + waitMs;
              this.setStep(step, { status: 'waiting', message: `구독 사용량 한도에 걸렸습니다. ${s.limitWaitMinutes}분 기다렸다가 자동으로 이어서 합니다.` });
              this.log(`⏸ 사용량 한도: ${e.message.split('\n')[0]} → ${s.limitWaitMinutes}분 대기`);
              await sleep(waitMs, this.abort.signal);
              this.p.status = 'running';
              this.p.limitUntil = null;
              i--; // 같은 단계 다시
              continue;
            }
          }
          throw e;
        }
      }
      this.p.status = 'done';
      this.p.waiting = null;
      this.log('🎉 모든 단계가 끝났습니다!');
    } catch (e) {
      const step = this.p.currentStep;
      if (e.name === 'AbortError') {
        this.p.status = 'stopped';
        if (step) this.p.steps[step] = { ...(this.p.steps[step] || {}), status: 'stopped', message: '중지됨' };
        this.log('■ 중지했습니다.');
      } else {
        this.p.status = e instanceof LimitError ? 'limited' : 'error';
        this.p.error = e.message;
        if (step) this.p.steps[step] = { ...(this.p.steps[step] || {}), status: 'error', message: e.message.split('\n')[0] };
        this.log(`✖ 오류: ${e.message}`);
      }
      this.p.waiting = null;
    } finally {
      this.running = false;
      this.save();
      this.emit('finished', this.snapshot());
    }
  }

  stop() {
    if (this.abort) this.abort.abort();
    for (const w of this.waiters.values()) w.reject(Object.assign(new Error('사용자가 중지했습니다.'), { name: 'AbortError' }));
    this.waiters.clear();
    if (this.reviewWaiter) { this.reviewWaiter.reject(Object.assign(new Error('사용자가 중지했습니다.'), { name: 'AbortError' })); this.reviewWaiter = null; }
  }

  /** 도우미 대기 중인 항목에 파일을 넣는다 */
  provideFile(key, file) {
    const w = this.waiters.get(key);
    if (w) { w.resolve(file); return true; }
    return false;
  }

  skipWaiting(key) {
    const w = this.waiters.get(key);
    if (w) { w.resolve(null); return true; }
    return false;
  }

  continueReview() {
    if (this.reviewWaiter) { this.reviewWaiter.resolve(); this.reviewWaiter = null; return true; }
    return false;
  }

  async review(stage, message) {
    this.p.waiting = { key: `review:${stage}`, kind: 'review', title: '확인 후 계속', message };
    this.setStep(this.p.currentStep, { status: 'waiting', message });
    await new Promise((resolve, reject) => { this.reviewWaiter = { resolve, reject }; });
    this.p.waiting = null;
    this.setStep(this.p.currentStep, { status: 'running', message: '진행 중…' });
  }

  /**
   * 사용자가 웹사이트에서 직접 만들어 다운로드할 때까지 기다린다.
   * 다운로드 폴더 감시 + 자동 클릭 브라우저 다운로드 + '파일 넣기' 버튼 중 먼저 오는 것.
   */
  async waitForUser(w) {
    this.checkAbort();
    const exts = EXTS[w.kind] || [];
    const since = Date.now();
    const site = w.site && SITES[w.site];
    this.p.waiting = {
      key: w.key, kind: w.kind, title: w.title, message: w.message,
      site: w.site || null, siteName: site ? site.name : null, siteUrl: site ? site.url : null,
      copyText: w.copyText || '', image: w.image ? this.rel(w.image) : null, since,
    };
    this.save();
    this.log(`🙋 도우미: ${w.title} - 사용자 작업을 기다리는 중`);
    const local = new AbortController();
    const onAbort = () => local.abort();
    this.abort.signal.addEventListener('abort', onAbort, { once: true });
    const tmpDir = path.join(this.dir, 'work', 'downloads');
    fs.mkdirSync(tmpDir, { recursive: true });
    let unwatchBot = () => {};
    try {
      const result = await new Promise((resolve, reject) => {
        this.waiters.set(w.key, { resolve, reject });
        waitForNewDownload({ dir: this.store.downloadsDir(), exts, sinceMs: since, signal: local.signal })
          .then(resolve).catch(() => {});
        if (this.bot) {
          unwatchBot = this.bot.watchDownloads(async (dl) => {
            try {
              const target = path.join(tmpDir, `${Date.now()}_${dl.suggestedFilename()}`);
              await dl.saveAs(target);
              resolve(target);
            } catch (_) { /* noop */ }
          });
        }
      });
      if (result) this.log(`📥 파일을 받았습니다: ${path.basename(result)}`);
      return result;
    } finally {
      local.abort();
      unwatchBot();
      this.abort.signal.removeEventListener('abort', onAbort);
      this.waiters.delete(w.key);
      this.p.waiting = null;
      this.save();
    }
  }

  // ---------- 1. 기획 ----------
  async step_plan() {
    const prov = this.p.providers.text;
    let plan;
    if (prov === 'demo') {
      plan = P.normalizePlan(demo.demoPlan(this.p.topic, this.wf), this.wf);
    } else {
      const raw = await this.withRetry('기획', () => agentText(prov, {
        prompt: P.planPrompt(this.p.topic, this.wf),
        dir: path.join(this.dir, 'work', 'plan'),
        settings: this.settings,
        signal: this.abort.signal,
        onLog: (l) => this.log(l),
        accept: (o) => P.validPlan(o, this.wf),
      }));
      plan = P.normalizePlan(raw, this.wf);
    }
    this.p.plan = plan;
    this.p.title = plan.title;
    this.writeStoryboard();
    this.save();
    if (this.wf.reviewAfterPlan) await this.review('plan', '기획안(스토리보드·가사)을 확인하고 필요하면 고친 뒤 [계속] 을 눌러 주세요.');
  }

  writeStoryboard() {
    const plan = this.p.plan;
    if (!plan) return;
    const lines = [
      `# ${plan.title}`, '', `> ${plan.logline}`, '', plan.concept, '',
      '## 등장인물', ...plan.characters.map((c) => `- **${c.name}**: ${c.description_ko} _(${c.appearance_en})_`), '',
      '## 시나리오', ...plan.story.map((s) => `${s.act}. ${s.summary_ko}`), '',
      `## 음악: ${plan.music.genre || ''} · ${plan.music.bpm} BPM · ${plan.music.mood || ''}`, '',
      ...plan.song_parts.flatMap((p) => [`### 파트 ${p.part} (${p.role})`, `_${p.style_prompt}_`, '', ...p.lyrics, '']),
    ];
    if (this.p.shots) {
      lines.push('## 샷 리스트', '');
      this.p.timing.segments.forEach((seg, i) => {
        const s = this.p.shots[i];
        lines.push(`- 컷 ${seg.index} (${seg.start.toFixed(2)}~${seg.end.toFixed(2)}초, ${seg.beats}박): ${s.action} / ${s.camera} → ${(this.p.timing.transitions[i] || {}).type || '끝'}`);
      });
    }
    fs.mkdirSync(path.join(this.dir, 'output'), { recursive: true });
    fs.writeFileSync(path.join(this.dir, 'output', 'storyboard.md'), lines.join('\n'));
  }

  // ---------- 2. 음악 ----------
  async step_music() {
    const plan = this.p.plan;
    const n = this.p.providers.music === 'file' ? 1 : (this.wf.musicParts || 2);
    this.p.music = this.p.music || { parts: [] };
    const parts = this.p.music.parts;
    fs.mkdirSync(path.join(this.dir, 'music'), { recursive: true });
    for (let i = 1; i <= n; i++) {
      this.checkAbort();
      const cur = parts[i - 1];
      if (cur && this.exists(cur.file)) continue;
      this.setStep('music', { status: 'running', message: `음악 파트 ${i}/${n} 준비 중`, progress: { done: i - 1, total: n } });
      const file = await this.genMusic(i, n);
      if (!file) throw new Error(`음악 파트 ${i} 이(가) 없습니다. 파일을 넣어 주세요.`);
      const dst = path.join(this.dir, 'music', `part${i}${path.extname(file).toLowerCase() || '.mp3'}`);
      if (path.resolve(file) !== path.resolve(dst)) fs.copyFileSync(file, dst);
      parts[i - 1] = { index: i, file: this.rel(dst), source: this.p.providers.music };
      this.save();
    }
    this.setStep('music', { message: '노래를 이어붙이고 박자를 분석하는 중…' });
    const files = parts.slice(0, n).map((p) => this.abs(p.file));
    const joined = await joinSongParts(files, path.join(this.dir, 'music', 'song.m4a'), { crossfade: 1.0, signal: this.abort.signal });
    this.p.music.song = 'music/song.m4a';
    this.p.music.partRanges = joined.parts;
    const prior = this.p.music.bpmOverride || plan.music.bpm;
    const analysis = await analyzeSong(this.abs(this.p.music.song), { priorBpm: prior, signal: this.abort.signal });
    this.p.music.analysis = analysis;
    this.log(`🎵 노래 길이 ${analysis.duration.toFixed(1)}초, BPM ${analysis.bpm}, 박자 ${analysis.beats.length}개, 마디 ${analysis.downbeats.length}개`);
    this.save();
  }

  async genMusic(part, total) {
    const prov = this.p.providers.music;
    const text = P.musicPasteText(this.p.plan, Math.min(part, this.p.plan.song_parts.length), this.wf);
    const work = path.join(this.dir, 'work', 'music');
    fs.mkdirSync(work, { recursive: true });
    if (prov === 'demo') {
      return demo.demoMusic({ part, seconds: this.wf.partSeconds || 30, bpm: this.p.plan.music.bpm, out: path.join(work, `demo${part}.mp3`), signal: this.abort.signal });
    }
    const title = prov === 'file' ? '내 노래 파일 넣기' : `음악 파트 ${part}/${total} 만들기`;
    if (prov.startsWith('bot:')) {
      const site = prov.slice(4);
      const got = await this.tryBot(`${site}.music`, { prompt: text, seconds: this.wf.partSeconds || 30 }, work, title);
      if (got) return got;
      return this.waitForUser({ key: `music:${part}`, kind: 'music', title, site, copyText: text,
        message: '자동 클릭이 막혀서 직접 마무리가 필요합니다. 열린 브라우저 창에서 노래를 만든 뒤 다운로드하면 자동으로 가져옵니다.' });
    }
    if (prov === 'file') {
      return this.waitForUser({ key: `music:${part}`, kind: 'music', title, site: null, copyText: '',
        message: '가지고 있는 노래 파일(mp3, wav, m4a, mp4 등)을 넣어 주세요. 가사가 기획안과 다르면 [타이밍] 단계에서 가사를 고칠 수 있습니다.' });
    }
    const site = this.p.helperSites.music || 'gemini';
    return this.waitForUser({ key: `music:${part}`, kind: 'music', title, site, copyText: text,
      message: `① [글 복사] → ② [${(SITES[site] || {}).name || '사이트'} 열기] → ③ 붙여넣고 노래 만들기 → ④ 다운로드. 다운로드하면 자동으로 가져옵니다.` });
  }

  // ---------- 3. 타이밍 ----------
  async step_timing() {
    const plan = this.p.plan;
    const analysis = this.p.music.analysis;
    const parts = this.p.music.partRanges;
    const prevTiming = this.p.timing || {};
    // 가사 줄 (파트 정보 포함)
    const lines = plan.song_parts.flatMap((p) => p.lyrics.map((text) => ({ text, part: Math.min(p.part, parts.length) })));
    let lyrics;
    if (prevTiming.lyricsSource === 'tap' && Array.isArray(prevTiming.lyrics) && prevTiming.lyrics.length) {
      lyrics = prevTiming.lyrics;
      this.log('⌨ 직접 맞춘(탭) 가사 타이밍을 사용합니다.');
    } else {
      lyrics = estimateLyricTiming(lines, parts, analysis);
    }
    const segments = segmentSong(analysis, lyrics, parts, {
      minClips: this.wf.minClips, maxClips: this.wf.maxClips, minLen: this.wf.minClipSec, maxLen: this.wf.maxClipSec, pace: this.wf.pace,
    });
    this.log(`✂ 컷 ${segments.length}개로 나눴습니다: ${segments.map((s) => s.duration.toFixed(1)).join('s, ')}s`);
    this.p.timing = { ...prevTiming, lyrics, lyricsSource: prevTiming.lyricsSource === 'tap' ? 'tap' : 'auto', segments };
    this.save();

    this.setStep('timing', { message: '컷마다 장면과 화면전환을 설계하는 중…' });
    let shots;
    const prov = this.p.providers.text;
    if (prov === 'demo') {
      shots = P.normalizeShots(demo.demoShots(segments, plan), segments);
    } else {
      const raw = await this.withRetry('샷 설계', () => agentText(prov, {
        prompt: P.shotsPrompt(plan, segments, lyrics, analysis, this.wf),
        dir: path.join(this.dir, 'work', 'shots'),
        settings: this.settings,
        signal: this.abort.signal,
        onLog: (l) => this.log(l),
        accept: P.validShots,
      }));
      shots = P.normalizeShots(raw, segments);
    }
    const transitions = resolveTransitions(segments, shots, analysis.beatPeriod);
    const needs = clipNeeds(segments, transitions);
    this.p.timing.transitions = transitions;
    this.p.timing.needs = needs;
    this.p.shots = shots;
    this.buildItems();
    this.writeStoryboard();
    this.save();
    if (this.wf.reviewAfterTiming) await this.review('timing', '타이밍(가사 싱크·컷·전환)을 확인하고 [계속] 을 눌러 주세요. 가사 싱크는 [탭으로 맞추기] 로 다듬을 수 있습니다.');
  }

  /** 샷 → 키프레임/클립 작업 목록. 프롬프트가 같으면 기존 결과물을 유지한다. */
  buildItems() {
    const plan = this.p.plan;
    const analysis = this.p.music.analysis;
    const kpc = Math.max(1, Math.min(2, this.wf.keyframesPerClip || 1));
    const oldK = new Map((this.p.keyframes || []).map((k) => [`${k.clip}:${k.slot}`, k]));
    const oldC = new Map((this.p.clips || []).map((c) => [c.clip, c]));
    this.p.keyframes = [];
    this.p.clips = [];
    this.p.timing.segments.forEach((seg, i) => {
      const shot = this.p.shots[i];
      for (let slot = 1; slot <= kpc; slot++) {
        const prompt = P.composeKeyframePrompt(shot, plan, this.wf, slot);
        const old = oldK.get(`${seg.index}:${slot}`);
        this.p.keyframes.push(old && old.prompt === prompt && this.exists(old.file)
          ? old : { clip: seg.index, slot, prompt, status: 'pending', file: null });
      }
      const vprompt = P.composeVideoPrompt(shot, plan, this.wf, analysis, seg);
      const need = this.p.timing.needs[i];
      const old = oldC.get(seg.index);
      this.p.clips.push(old && old.prompt === vprompt && old.seconds === need.request && this.exists(old.file)
        ? old : { clip: seg.index, prompt: vprompt, seconds: need.request, need: need.need, status: 'pending', file: null });
    });
  }

  // ---------- 4. 키프레임 ----------
  async step_keyframes() {
    const prov = this.p.providers.image;
    fs.mkdirSync(path.join(this.dir, 'keyframes'), { recursive: true });
    // 캐릭터 일관성용 레퍼런스 시트
    if (this.wf.characterSheet && this.p.plan.characters.length && prov !== 'demo' && !(this.p.refs && this.exists(this.p.refs.sheet))) {
      this.setStep('keyframes', { message: '캐릭터 기준 이미지(레퍼런스 시트) 만드는 중…' });
      try {
        const file = await this.genImage({ key: 'image:sheet', prompt: P.characterSheetPrompt(this.p.plan, this.wf), refs: [], title: '캐릭터 기준 이미지' }, 'sheet');
        if (file) {
          fs.mkdirSync(path.join(this.dir, 'refs'), { recursive: true });
          const dst = path.join(this.dir, 'refs', `character_sheet${path.extname(file) || '.png'}`);
          fs.copyFileSync(file, dst);
          this.p.refs = { sheet: this.rel(dst) };
          this.save();
        }
      } catch (e) {
        if (e.name === 'AbortError' || e instanceof LimitError) throw e;
        this.log(`⚠ 캐릭터 기준 이미지 실패 (계속 진행): ${e.message.split('\n')[0]}`);
      }
    }
    const refs = this.p.refs && this.exists(this.p.refs.sheet) ? [this.abs(this.p.refs.sheet)] : [];
    await this.processItems('keyframes', this.p.keyframes, this.settings.concurrency.image || 1, async (k) => {
      const file = await this.genImage({ key: `image:${k.clip}:${k.slot}`, prompt: k.prompt, refs, title: `키프레임 ${k.clip}${k.slot > 1 ? `-${k.slot}` : ''}` }, `${pad2(k.clip)}_${k.slot}`);
      if (!file) return null;
      const dst = path.join(this.dir, 'keyframes', `clip${pad2(k.clip)}_${k.slot}${path.extname(file).toLowerCase() || '.png'}`);
      fs.copyFileSync(file, dst);
      return this.rel(dst);
    });
  }

  async genImage({ key, prompt, refs, title }, tag) {
    const prov = this.p.providers.image;
    const work = path.join(this.dir, 'work', 'images', `${tag}_${Date.now()}`);
    fs.mkdirSync(work, { recursive: true });
    const { w, h } = outputSize(this.wf.aspect, this.wf.quality);
    if (prov === 'demo') {
      const [clip, slot] = String(tag).split('_').map((x) => parseInt(x, 10) || 0);
      return demo.demoImage({ index: clip, slot: slot || 1, w, h, out: path.join(work, 'demo.png'), signal: this.abort.signal });
    }
    if (AGENTS[prov]) {
      return agentImage(prov, { prompt, aspect: this.wf.aspect, refs, dir: work, settings: this.settings, signal: this.abort.signal, onLog: (l) => this.log(l) });
    }
    const copy = `${prompt}\n(${this.wf.aspect})`;
    if (prov.startsWith('bot:')) {
      const site = prov.slice(4);
      const got = await this.tryBot(`${site}.image`, { prompt, aspect: this.wf.aspect, reference: refs[0] || '' }, work, title);
      if (got) return got;
      return this.waitForUser({ key, kind: 'image', title, site, copyText: copy, image: refs[0],
        message: '자동 클릭이 막혀서 직접 마무리가 필요합니다. 열린 브라우저 창에서 이미지를 만든 뒤 다운로드하면 자동으로 가져옵니다.' });
    }
    const site = this.p.helperSites.image || 'gemini';
    return this.waitForUser({ key, kind: 'image', title, site, copyText: copy, image: refs[0],
      message: `① [프롬프트 복사] → ② [${(SITES[site] || {}).name || '사이트'} 열기] → ③ (있으면 기준 이미지 첨부) 붙여넣고 생성 → ④ 다운로드. 자동으로 가져옵니다.` });
  }

  // ---------- 5. 영상 클립 ----------
  async step_clips() {
    fs.mkdirSync(path.join(this.dir, 'clips'), { recursive: true });
    await this.processItems('clips', this.p.clips, this.settings.concurrency.video || 1, async (c) => {
      const kf = this.p.keyframes.find((k) => k.clip === c.clip && k.slot === 1);
      if (!kf || !this.exists(kf.file)) throw new Error(`컷 ${c.clip} 의 키프레임이 없습니다.`);
      const file = await this.genVideo(c, this.abs(kf.file));
      if (!file) return null;
      const dst = path.join(this.dir, 'clips', `clip${pad2(c.clip)}${path.extname(file).toLowerCase() || '.mp4'}`);
      fs.copyFileSync(file, dst);
      const info = await probe(dst);
      if (!info.hasVideo) throw new Error('받은 파일에 영상이 없습니다.');
      c.actualSeconds = Math.round(info.duration * 100) / 100;
      return this.rel(dst);
    });
  }

  async genVideo(c, startImage) {
    const prov = this.p.providers.video;
    const work = path.join(this.dir, 'work', 'clips', `clip${pad2(c.clip)}_${Date.now()}`);
    fs.mkdirSync(work, { recursive: true });
    const { w, h } = outputSize(this.wf.aspect, this.wf.quality);
    const title = `영상 클립 ${c.clip} (${c.seconds}초)`;
    if (prov === 'demo') {
      return demo.demoVideo({ image: startImage, seconds: c.seconds, w, h, out: path.join(work, 'demo.mp4'), signal: this.abort.signal });
    }
    if (AGENTS[prov]) {
      return agentVideo(prov, { prompt: c.prompt, startImage, seconds: c.seconds, aspect: this.wf.aspect, dir: work, settings: this.settings, signal: this.abort.signal, onLog: (l) => this.log(l) });
    }
    const copy = `${c.prompt}\n(${c.seconds} seconds, ${this.wf.aspect})`;
    if (prov.startsWith('bot:')) {
      const site = prov.slice(4);
      const got = await this.tryBot(`${site}.video`, { prompt: c.prompt, image: startImage, seconds: c.seconds, aspect: this.wf.aspect }, work, title);
      if (got) return got;
      return this.waitForUser({ key: `video:${c.clip}`, kind: 'video', title, site, copyText: copy, image: startImage,
        message: '자동 클릭이 막혀서 직접 마무리가 필요합니다. 열린 브라우저 창에서 영상을 만든 뒤 다운로드하면 자동으로 가져옵니다.' });
    }
    const site = this.p.helperSites.video || 'grok';
    return this.waitForUser({ key: `video:${c.clip}`, kind: 'video', title, site, copyText: copy, image: startImage,
      message: `① [이미지 복사] 후 ${(SITES[site] || {}).name || '사이트'} 에 붙여넣기 → ② [프롬프트 복사] 후 붙여넣기 → ③ 영상 생성(${c.seconds}초) → ④ 다운로드. 자동으로 가져옵니다.` });
  }

  /** 자동 클릭 시도. 막히면 null (→ 도우미 모드) */
  async tryBot(taskId, params, outDir, title) {
    const s = this.settings.bot;
    if (!this.bot || !s.enabled || !s.acceptedRisk) {
      this.log('ℹ 자동 클릭이 꺼져 있어 도우미 모드로 진행합니다. (설정에서 켤 수 있습니다)');
      return null;
    }
    try {
      this.log(`🤖 자동 클릭: ${title}`);
      return await this.bot.run(taskId, params, {
        outDir, signal: this.abort.signal,
        onStatus: (st) => {
          if (st.state === 'login' || st.state === 'captcha') {
            this.p.waiting = { key: `bot:${taskId}`, kind: 'bot', title, message: st.message };
            this.save();
          } else if (this.p.waiting && this.p.waiting.kind === 'bot') {
            this.p.waiting = null;
            this.save();
          }
          this.log(`  🤖 ${st.message}`);
        },
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      this.log(`⚠ 자동 클릭 실패 → 도우미 모드로 전환: ${e.message.split('\n')[0]}`);
      if (this.p.waiting && this.p.waiting.kind === 'bot') this.p.waiting = null;
      if (!(e instanceof NeedsUserError)) this.log(String(e.stack || e).split('\n').slice(0, 3).join(' | '));
      return null;
    }
  }

  /** 항목들을 (동시에 n개까지) 처리. 실패한 것은 재시도 후 표시만 하고 계속. */
  async processItems(step, items, concurrency, fn) {
    const todo = items.filter((it) => !(it.status === 'done' && this.exists(it.file)));
    const total = items.length;
    let done = total - todo.length;
    const failures = [];
    const helperLike = (this.p.providers[step === 'keyframes' ? 'image' : 'video'] || '');
    const conc = helperLike === 'helper' || helperLike.startsWith('bot:') ? 1 : Math.max(1, concurrency);
    this.setStep(step, { message: `${done}/${total} 완료`, progress: { done, total } });
    let idx = 0;
    const worker = async () => {
      while (idx < todo.length) {
        const it = todo[idx++];
        this.checkAbort();
        it.status = 'running';
        it.error = null;
        this.save();
        try {
          const rel = await this.withRetry(`${STEP_LABELS[step]} ${it.clip}`, () => fn(it));
          if (rel) { it.file = rel; it.status = 'done'; it.updatedAt = Date.now(); } else { it.status = 'skipped'; }
        } catch (e) {
          if (e.name === 'AbortError' || e instanceof LimitError || e.kind === 'limit' || e.kind === 'auth' || e.kind === 'notInstalled') {
            it.status = 'pending';
            this.save();
            throw e;
          }
          it.status = 'error';
          it.error = e.message.split('\n')[0];
          failures.push(it);
          this.log(`✖ ${STEP_LABELS[step]} ${it.clip}: ${e.message}`);
        }
        done = items.filter((x) => x.status === 'done').length;
        this.setStep(step, { message: `${done}/${total} 완료`, progress: { done, total } });
      }
    };
    await Promise.all(Array.from({ length: Math.min(conc, Math.max(1, todo.length)) }, worker));
    if (failures.length && step === 'keyframes') {
      throw new Error(`키프레임 ${failures.length}개를 만들지 못했습니다. 해당 칸에서 [다시 만들기] 또는 [파일 넣기] 후 [이어서 하기] 를 눌러 주세요.`);
    }
    if (failures.length) {
      this.log(`⚠ 영상 클립 ${failures.length}개는 키프레임을 천천히 확대하는 화면으로 대신합니다. 나중에 다시 만들고 [최종 영상 다시 만들기] 를 누르면 교체됩니다.`);
    }
  }

  async withRetry(label, fn) {
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      this.checkAbort();
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (e.name === 'AbortError' || e instanceof LimitError || ['limit', 'auth', 'notInstalled'].includes(e.kind)) throw e;
        if (attempt < this.maxRetries) {
          this.log(`↻ ${label} 재시도 (${attempt + 1}/${this.maxRetries}): ${e.message.split('\n')[0]}`);
          await sleep(3000 * (attempt + 1), this.abort.signal);
        }
      }
    }
    throw lastErr;
  }

  // ---------- 6. 최종 편집 ----------
  async step_edit() {
    const { w, h } = outputSize(this.wf.aspect, this.wf.quality);
    const t = this.p.timing;
    const total = this.p.music.analysis.duration;
    const normDir = path.join(this.dir, 'work', 'norm');
    fs.mkdirSync(normDir, { recursive: true });
    const normFiles = [];
    for (let i = 0; i < t.segments.length; i++) {
      this.checkAbort();
      const seg = t.segments[i];
      const c = this.p.clips[i];
      const kf = this.p.keyframes.find((k) => k.clip === seg.index && k.slot === 1);
      const out = path.join(normDir, `clip${pad2(seg.index)}.mp4`);
      this.setStep('edit', { message: `클립 정리 ${i + 1}/${t.segments.length}`, progress: { done: i, total: t.segments.length + 1 } });
      const r = await normalizeClip({
        clip: c && this.exists(c.file) ? this.abs(c.file) : null,
        keyframe: kf && this.exists(kf.file) ? this.abs(kf.file) : null,
        need: t.needs[i].need, w, h, out, signal: this.abort.signal,
      });
      if (r.fallback) this.log(`ℹ 컷 ${seg.index}: 영상이 없어 키프레임 확대 화면으로 대체`);
      normFiles.push(out);
    }
    const outDir = path.join(this.dir, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    const subs = this.wf.subtitles || {};
    let subtitlePngs = null;
    let assFile = null;
    if (subs.enabled !== false && t.lyrics.length) {
      if (this.renderSubtitles) {
        try {
          subtitlePngs = await this.renderSubtitles(t.lyrics, { w, h, style: subs, outDir: path.join(this.dir, 'work', 'subs') });
        } catch (e) {
          this.log(`⚠ 자막 이미지 생성 실패, 기본 자막으로 대체: ${e.message}`);
        }
      }
      if (!subtitlePngs) {
        assFile = path.join(this.dir, 'work', 'lyrics.ass');
        fs.writeFileSync(assFile, buildAss(t.lyrics, { w, h, style: subs }));
      }
    }
    this.setStep('edit', { message: '이어붙이고 자막·노래를 입히는 중…' });
    const name = `${safeName(this.p.plan.title)}.mp4`;
    const finalPath = path.join(outDir, name);
    await assembleFinal({
      clips: normFiles,
      lengths: t.needs.map((n) => n.need),
      transitions: t.transitions,
      song: this.abs(this.p.music.song),
      total, w, h, out: finalPath,
      subtitlePngs, assFile,
      signal: this.abort.signal,
      onProgress: (f) => this.setStep('edit', { message: `최종 영상 만드는 중 ${Math.round(f * 100)}%`, progress: { done: Math.round(f * 100), total: 100 } }),
    });
    fs.writeFileSync(path.join(outDir, 'lyrics.srt'), toSrt(t.lyrics));
    fs.writeFileSync(path.join(outDir, 'lyrics.lrc'), toLrc(t.lyrics, this.p.plan.title));
    this.writeStoryboard();
    this.p.output = { video: this.rel(finalPath), srt: 'output/lyrics.srt', lrc: 'output/lyrics.lrc', storyboard: 'output/storyboard.md', madeAt: Date.now() };
    this.p.editStale = false;
    this.save();
  }

  // ---------- 개별 수정 ----------
  /** 한 항목만 다시 만들기 (진행 중이 아닐 때) */
  async regenerate(kind, clip, { prompt, slot = 1 } = {}) {
    if (this.running) throw new Error('진행 중에는 다시 만들 수 없습니다. 먼저 중지하세요.');
    this.running = true;
    this.abort = new AbortController();
    this.save();
    try {
      if (kind === 'keyframe') {
        const k = this.p.keyframes.find((x) => x.clip === clip && x.slot === slot);
        if (!k) throw new Error('항목을 찾을 수 없습니다.');
        if (prompt) k.prompt = prompt;
        k.status = 'running'; this.save();
        const refs = this.p.refs && this.exists(this.p.refs.sheet) ? [this.abs(this.p.refs.sheet)] : [];
        const file = await this.genImage({ key: `image:${clip}:${slot}`, prompt: k.prompt, refs, title: `키프레임 ${clip} 다시 만들기` }, `${pad2(clip)}_${slot}`);
        if (file) {
          const dst = path.join(this.dir, 'keyframes', `clip${pad2(clip)}_${slot}${path.extname(file).toLowerCase() || '.png'}`);
          this.removeOld(k.file, dst);
          fs.copyFileSync(file, dst);
          k.file = this.rel(dst); k.status = 'done'; k.error = null; k.updatedAt = Date.now();
        } else { k.status = k.file ? 'done' : 'pending'; }
      } else if (kind === 'clip') {
        const c = this.p.clips.find((x) => x.clip === clip);
        if (!c) throw new Error('항목을 찾을 수 없습니다.');
        if (prompt) c.prompt = prompt;
        const kf = this.p.keyframes.find((k) => k.clip === clip && k.slot === 1);
        if (!kf || !this.exists(kf.file)) throw new Error('키프레임을 먼저 만들어 주세요.');
        c.status = 'running'; this.save();
        const file = await this.genVideo(c, this.abs(kf.file));
        if (file) {
          const dst = path.join(this.dir, 'clips', `clip${pad2(clip)}${path.extname(file).toLowerCase() || '.mp4'}`);
          this.removeOld(c.file, dst);
          fs.copyFileSync(file, dst);
          c.file = this.rel(dst); c.status = 'done'; c.error = null; c.updatedAt = Date.now();
        } else { c.status = c.file ? 'done' : 'pending'; }
      }
      this.p.editStale = true;
      this.log(`✔ ${kind === 'clip' ? '영상 클립' : '키프레임'} ${clip} 다시 만들기 완료`);
    } catch (e) {
      const list = kind === 'clip' ? this.p.clips : this.p.keyframes;
      const it = list.find((x) => x.clip === clip && (kind === 'clip' || x.slot === slot));
      if (it) { it.status = 'error'; it.error = e.message.split('\n')[0]; }
      this.log(`✖ 다시 만들기 실패: ${e.message}`);
      throw e;
    } finally {
      this.running = false;
      this.p.waiting = null;
      this.save();
    }
  }

  /** 사용자가 고른 파일로 항목 교체 */
  replaceItem(kind, clip, file, slot = 1) {
    if (kind === 'keyframe') {
      const k = this.p.keyframes.find((x) => x.clip === clip && x.slot === slot);
      const dst = path.join(this.dir, 'keyframes', `clip${pad2(clip)}_${slot}${path.extname(file).toLowerCase()}`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      this.removeOld(k.file, dst);
      fs.copyFileSync(file, dst);
      Object.assign(k, { file: this.rel(dst), status: 'done', error: null, updatedAt: Date.now() });
    } else if (kind === 'clip') {
      const c = this.p.clips.find((x) => x.clip === clip);
      const dst = path.join(this.dir, 'clips', `clip${pad2(clip)}${path.extname(file).toLowerCase()}`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      this.removeOld(c.file, dst);
      fs.copyFileSync(file, dst);
      Object.assign(c, { file: this.rel(dst), status: 'done', error: null, updatedAt: Date.now() });
    } else if (kind === 'music') {
      this.p.music = this.p.music || { parts: [] };
      const dst = path.join(this.dir, 'music', `part${clip}${path.extname(file).toLowerCase()}`);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(file, dst);
      this.p.music.parts[clip - 1] = { index: clip, file: this.rel(dst), source: 'file' };
      // 음악이 바뀌면 그 뒤 단계는 다시
      for (const s of ['music', 'timing']) if (this.p.steps[s]) this.p.steps[s].status = 'pending';
    }
    this.p.editStale = true;
    this.save();
  }

  removeOld(rel, dst) {
    if (rel && this.abs(rel) !== dst) { try { fs.unlinkSync(this.abs(rel)); } catch (_) { /* noop */ } }
  }

  /** 기획안 수정 (가사 등) */
  updatePlan(plan) {
    this.p.plan = P.normalizePlan(plan, this.wf);
    this.writeStoryboard();
    this.save();
  }

  /** 탭으로 맞춘 가사 타이밍 저장 */
  updateLyrics(lyrics) {
    if (!this.p.timing) throw new Error('타이밍 단계가 아직 없습니다.');
    this.p.timing.lyrics = lyrics.map((l) => ({ text: String(l.text), part: l.part || 1, start: Number(l.start), end: Number(l.end) }))
      .filter((l) => l.text && l.end > l.start).sort((a, b) => a.start - b.start);
    this.p.timing.lyricsSource = 'tap';
    this.p.editStale = true;
    this.save();
  }

  /** 노래를 새로 만들도록 음악 파트를 비운다 */
  resetMusic() {
    if (this.running) throw new Error('진행 중에는 바꿀 수 없습니다.');
    this.p.music = { parts: [] };
    for (const s of ['music', 'timing', 'edit']) if (this.p.steps[s]) this.p.steps[s].status = 'pending';
    this.save();
  }

  /** BPM 직접 지정 후 다시 분석 */
  async setBpm(bpm) {
    if (!this.p.music || !this.p.music.song) throw new Error('노래가 아직 없습니다.');
    this.p.music.bpmOverride = bpm;
    this.p.music.analysis = await analyzeSong(this.abs(this.p.music.song), { priorBpm: bpm });
    if (this.p.steps.timing) this.p.steps.timing.status = 'pending';
    this.save();
    return this.p.music.analysis;
  }
}

module.exports = { ProjectRunner, STEPS, STEP_LABELS };
