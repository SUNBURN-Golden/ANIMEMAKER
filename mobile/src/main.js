// AnimeMaker 폰 앱: 시작 화면, 새 작품, 도움말, 설정, 다른 앱에서 공유받기
import * as PL from './pipeline.js';
import * as db from './db.js';
import * as N from './native.js';
import { h, clear, toast, sheet, confirmBox, busy, pickFile, fmtSize } from './ui.js';
import { openProject, closeProject, projectView, receiveShare, checkClipboardOnResume, runDemoAll, currentProject } from './project.js';
import { demoSong } from './demo.js';

const SETTINGS_KEY = 'am.settings';
const DEFAULTS = { textApp: 'chatgpt', imageApp: 'chatgpt', videoApp: 'grok', quality: '720p' };

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch (_) { return { ...DEFAULTS }; }
}

const app = {
  route: 'home',
  settings: loadSettings(),
  draft: null, // 새 작품 입력 중인 내용
  setSetting(k, v) {
    this.settings[k] = v;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (_) { /* noop */ }
  },
  go(route) {
    if (route !== 'project') closeProject();
    this.route = route;
    this.render();
    window.scrollTo(0, 0);
  },
  async open(id) {
    await openProject(this, id);
    this.route = 'project';
    this.render();
    window.scrollTo(0, 0);
  },
  render() {
    const root = document.getElementById('app');
    clear(root);
    const titles = { home: '', new: '새 뮤직비디오', help: '도움말', settings: '설정', project: '' };
    root.appendChild(h('header', { class: 'top' },
      this.route !== 'home' ? h('button', { class: 'icon-btn', onclick: () => this.back(), 'aria-label': '뒤로' }, '←') : h('img', { class: 'logo', src: 'icon.png', alt: '' }),
      h('div', { class: 'top-title' }, this.route === 'home' ? 'AnimeMaker' : titles[this.route] || (currentProject() || {}).title || ''),
      h('button', { class: 'icon-btn', onclick: () => this.go('help'), 'aria-label': '도움말' }, '?'),
      h('button', { class: 'icon-btn', onclick: () => this.go('settings'), 'aria-label': '설정' }, '⚙')));
    const main = h('main', null);
    root.appendChild(main);
    const view = { home: homeView, new: newView, help: helpView, settings: settingsView, project: projectView }[this.route] || homeView;
    const out = view();
    if (out instanceof Promise) out.then((el) => main.appendChild(el)); else main.appendChild(out);
  },
  back() {
    if (document.querySelector('.sheet-back')) { if (sheet.closeTop) sheet.closeTop(); return; }
    if (this.route === 'home') N.exitApp(); else this.go('home');
  },
};

// ---------- 시작 화면 ----------
async function homeView() {
  const list = await db.listProjects();
  return h('div', null,
    h('div', { class: 'hero' },
      h('img', { src: 'icon.png', alt: '' }),
      h('div', null, h('h1', null, '노래로 뮤직비디오 만들기'), h('p', null, 'Suno 등에서 만든 노래와 가사만 있으면, 폰 하나로 박자에 맞춘 뮤직비디오를 만들어요.'))),
    h('button', { class: 'btn primary big', onclick: () => { app.draft = null; app.go('new'); } }, '🎬 새 뮤직비디오 만들기'),
    h('button', { class: 'btn big', onclick: startDemo }, '🧪 체험해 보기 (AI 없이 1분짜리)'),
    h('h2', null, '내 작품'),
    list.length ? h('div', { class: 'plist' }, list.map((p) => {
      const done = PL.STEPS.filter((s) => PL.stepDone(p, s.id)).length;
      return h('div', { class: 'pitem', onclick: () => app.open(p.id).catch((e) => toast(e.message, 'err')) },
        h('div', { class: 'grow' },
          h('div', { class: 'ptitle' }, p.title),
          h('div', { class: 'muted small' }, `${new Date(p.updatedAt).toLocaleDateString('ko-KR')} · ${p.output ? '✔ 완성' : `${done}/${PL.STEPS.length} 단계`}`)),
        h('button', {
          class: 'icon-btn',
          'aria-label': '지우기',
          onclick: async (e) => {
            e.stopPropagation();
            if (await confirmBox('작품을 지울까요?', `"${p.title}" 와 안에 든 노래·그림·영상을 이 앱에서 지워요. (갤러리에 저장한 영상은 남아요)`, '지우기')) {
              await db.deleteProject(p.id);
              app.render();
            }
          },
        }, '🗑'));
    })) : h('p', { class: 'muted' }, '아직 작품이 없어요. 위의 [새 뮤직비디오 만들기] 로 시작해 보세요!'),
    h('p', { class: 'note' }, '💳 AI 는 이미 구독 중인 ChatGPT · Gemini · Grok · Claude 앱 안에서만 써요. 이 앱은 따로 돈을 받거나 API 키를 쓰지 않아요.'));
}

async function startDemo() {
  const b = busy('🧪 체험용 노래를 만드는 중…');
  let p;
  try {
    p = PL.newProject({ topic: '반짝이는 꿈', lyricsRaw: PL.DEMO_LYRICS, demo: true });
    const song = await demoSong({ seconds: 60 });
    await db.putFile(`${p.id}/song`, song);
    p.song = { key: `${p.id}/song`, name: '체험용 노래.wav', type: song.type, size: song.size };
    await db.saveProject(p);
  } catch (e) {
    toast(e.message, 'err');
    return;
  } finally {
    b.done();
  }
  await app.open(p.id);
  await runDemoAll();
}

// ---------- 새 작품 ----------
function newView() {
  const d = app.draft || (app.draft = { song: null, lyrics: '', lyricsName: '', topic: '', wfId: PL.WORKFLOWS[0].id });
  const songInfo = h('div', { class: 'muted small' }, d.song ? `✔ ${d.song.name} (${fmtSize(d.song.size)})` : '아직 안 골랐어요');
  const lyr = h('textarea', { class: 'lyrics', rows: 8, placeholder: '[Verse 1]\n첫 줄 가사...\n[Chorus]\n후렴 가사...', oninput: () => { d.lyrics = lyr.value; } });
  lyr.value = d.lyrics;
  const topic = h('input', { type: 'text', placeholder: '예) 여름밤 바닷가에서 다시 만난 두 친구', oninput: () => { d.topic = topic.value; } });
  topic.value = d.topic;
  const wfs = h('div', { class: 'wfs' }, PL.WORKFLOWS.map((w) => h('button', {
    class: `wf ${d.wfId === w.id ? 'on' : ''}`,
    onclick: () => { d.wfId = w.id; app.render(); },
  }, h('div', { class: 'wf-emoji' }, w.emoji), h('div', null, h('b', null, w.name), h('div', { class: 'small muted' }, w.description)))));
  return h('div', null,
    h('div', { class: 'card' },
      h('h3', null, '① 🎵 노래 파일'),
      h('p', { class: 'small' }, 'Suno 에서 내려받은 노래(mp3, m4a, wav)를 골라요. Suno 앱에서 [공유 → AnimeMaker] 로 보내도 돼요.'),
      h('button', { class: 'btn primary', onclick: async () => { const f = await pickFile('audio/*,video/mp4,.mp3,.m4a,.wav'); if (f) { d.song = f; app.render(); } } }, '🎵 노래 고르기'),
      songInfo),
    h('div', { class: 'card' },
      h('h3', null, '② 📝 가사'),
      h('p', { class: 'small' }, 'Suno 가사를 그대로 붙여 넣어요. [Verse], [Chorus] 같은 표시도 같이 넣으면 더 좋아요. 시간이 든 가사 파일(.lrc, .srt)도 돼요.'),
      lyr,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => { const t = await N.readClipboard(); if (t) { lyr.value = t; d.lyrics = t; } else toast('클립보드가 비어 있어요', 'warn'); } }, '📋 붙여넣기'),
        h('button', { class: 'btn', onclick: async () => { const f = await pickFile('.txt,.lrc,.srt,text/plain'); if (f) { d.lyrics = await f.text(); d.lyricsName = f.name; lyr.value = d.lyrics; } } }, '📂 가사 파일'))),
    h('div', { class: 'card' },
      h('h3', null, '③ 💡 주제 (안 써도 돼요)'),
      h('p', { class: 'small' }, '어떤 이야기였으면 좋겠는지 한 줄로. 비워 두면 AI 가 가사를 보고 정해요.'),
      topic),
    h('div', { class: 'card' }, h('h3', null, '④ 🎨 화면 모양과 그림체'), wfs),
    h('button', {
      class: 'btn primary big',
      onclick: async () => {
        if (!d.song) { toast('먼저 ① 노래 파일을 골라 주세요', 'warn'); return; }
        const b = busy('작품을 만드는 중…');
        try {
          const p = PL.newProject({ topic: d.topic.trim(), wfId: d.wfId, lyricsRaw: d.lyrics, lyricsName: d.lyricsName });
          await db.putFile(`${p.id}/song`, d.song);
          p.song = { key: `${p.id}/song`, name: d.song.name || 'song', type: d.song.type, size: d.song.size };
          await db.saveProject(p);
          app.draft = null;
          b.done();
          await app.open(p.id);
        } catch (e) {
          b.done();
          toast(e.message, 'err');
        }
      },
    }, '시작하기 →'));
}

// ---------- 설정 ----------
function settingsView() {
  const row = (kind, label) => h('div', { class: 'card' },
    h('h3', null, label),
    h('div', { class: 'chips' }, Object.entries(N.AI_APPS).filter(([, a]) => a.good.includes(kind)).map(([id, a]) =>
      h('button', { class: `chip ${app.settings[`${kind}App`] === id ? 'on' : ''}`, onclick: () => { app.setSetting(`${kind}App`, id); app.render(); } }, a.name))));
  const usage = h('p', { class: 'small muted' });
  db.usage().then((u) => { if (u) usage.textContent = `이 앱이 쓰는 저장 공간: ${fmtSize(u.used)}`; });
  return h('div', null,
    row('text', '📝 이야기·장면 설계를 부탁할 AI 앱'),
    row('image', '🖼 그림을 부탁할 AI 앱'),
    row('video', '🎞 영상을 부탁할 AI 앱'),
    h('div', { class: 'card' },
      h('h3', null, '💳 요금 안내'),
      h('p', { class: 'small' }, '이 앱은 AI 회사의 유료 API 를 쓰지 않아요. 내 폰에 설치된 AI 앱으로 부탁 글을 보내고, 결과를 받아 오기만 해요. 그래서 이미 내고 있는 구독 요금 안에서만 써요. (각 앱의 하루 사용 한도는 그 앱의 규칙을 따라요)'),
      usage));
}

// ---------- 도움말 ----------
function helpView() {
  const step = (n, t, d) => h('div', { class: 'help-step' }, h('div', { class: 'hn' }, n), h('div', null, h('b', null, t), h('p', { class: 'small' }, d)));
  return h('div', null,
    h('div', { class: 'card' },
      h('h3', null, '이렇게 만들어요'),
      step('1', '🎵 노래와 가사 넣기', 'Suno 에서 만든 노래 파일을 고르고 가사를 붙여 넣어요. 앱이 박자(BPM)와 마디를 알아서 찾아요.'),
      step('2', '📝 이야기 부탁하기', '[부탁하기] 를 누르면 ChatGPT 같은 AI 앱이 열려요. 보내기를 누르고, 답장이 오면 길게 눌러 복사한 뒤 돌아와요.'),
      step('3', '✂ 컷 나누기', '노래를 박자에 맞춰 10~15개 컷으로 나눠요. 탭으로 가사 시간을 맞추면 자막이 더 정확해요. 컷마다 장면 설계도 AI 에게 부탁해요.'),
      step('4', '🖼 그림 받기', '컷마다 [부탁하기] → AI 앱에서 그림이 나오면 [공유 → AnimeMaker]. 또는 갤러리에 저장하고 [사진 고르기].'),
      step('5', '🎞 움직이기 (선택)', '그대로 두면 그림이 천천히 움직여요. 진짜 영상을 원하면 Grok·Gemini 영상으로 부탁할 수 있어요.'),
      step('6', '🎬 완성', '[영상 만들기] 를 누르면 컷 + 화면전환 + 가사 자막 + 노래가 합쳐진 MP4 가 나와요. 갤러리에 저장하거나 공유해요.')),
    h('div', { class: 'card' },
      h('h3', null, '잘 안 될 때'),
      h('ul', { class: 'small' },
        h('li', null, 'AI 앱이 안 열리면: 부탁 글이 이미 복사돼 있어요. AI 앱을 직접 열고 붙여 넣으세요.'),
        h('li', null, '답장을 못 읽었다고 나오면: 답장 전체를 복사했는지 확인하세요. 코드 상자({ } 로 된 글)가 꼭 들어 있어야 해요.'),
        h('li', null, '영상 만들기가 실패하면: 1080p 대신 720p 로, 또는 Android System WebView·Chrome 을 업데이트해 보세요.'),
        h('li', null, '체험해 보기로 먼저 한 번 끝까지 해 보면 흐름을 금방 익힐 수 있어요.'))),
    h('div', { class: 'card' },
      h('h3', null, '알아 두기'),
      h('p', { class: 'small' }, 'AI 로 만든 그림·영상을 올릴 때는 각 AI 서비스와 업로드할 사이트(유튜브 등)의 이용 규칙을 따라 주세요. 실제 인물·유명 캐릭터를 흉내 내지 않는 게 안전해요.')));
}

// ---------- 공유받기 ----------
async function handleShare(d) {
  const items = d.items || [];
  if (app.route === 'project' && currentProject()) {
    await receiveShare(d);
    return;
  }
  const audio = items.find((it) => (it.mime || '').startsWith('audio/'));
  if (audio) {
    const blob = await N.sharedItemToBlob(audio);
    app.draft = { ...(app.draft || { lyrics: '', lyricsName: '', topic: '', wfId: PL.WORKFLOWS[0].id }), song: new File([blob], audio.name, { type: blob.type }) };
    app.go('new');
    toast(`🎵 "${audio.name}" 을 받았어요. 가사를 넣고 시작하세요!`);
    return;
  }
  if (d.text && app.route === 'new' && app.draft) {
    app.draft.lyrics = d.text;
    app.render();
    toast('📝 받은 글을 가사 칸에 넣었어요');
    return;
  }
  toast('받은 파일을 넣으려면 먼저 작품을 열어 주세요', 'warn', 5000);
}

window.addEventListener('error', (e) => toast(`문제가 생겼어요: ${e.message}`, 'err', 6000));
window.addEventListener('unhandledrejection', (e) => toast(`문제가 생겼어요: ${(e.reason && e.reason.message) || e.reason}`, 'err', 6000));

N.onShared((d) => handleShare(d).catch((e) => toast(e.message, 'err')));
N.onBackButton(() => app.back());
N.onResume(() => { checkClipboardOnResume().catch(() => {}); });

app.render();
window.AnimeMaker = { app, db, PL }; // 테스트·문제 확인용
