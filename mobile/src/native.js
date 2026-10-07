// 안드로이드 기능 연결 (AnimeMakerNative 플러그인). 컴퓨터 브라우저에서 열면 비슷한 웹 기능으로 대신한다.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Clipboard } from '@capacitor/clipboard';
import { App } from '@capacitor/app';

const Native = registerPlugin('AnimeMakerNative');
export const isNative = Capacitor.isNativePlatform();

/** 구독 중인 AI 앱들 (요금은 각 앱의 구독 안에서만) */
export const AI_APPS = {
  chatgpt: { name: 'ChatGPT', pkg: 'com.openai.chatgpt', url: 'https://chatgpt.com/', good: ['text', 'image', 'video'] },
  gemini: { name: 'Gemini', pkg: 'com.google.android.apps.bard', url: 'https://gemini.google.com/app', good: ['text', 'image', 'video'] },
  grok: { name: 'Grok', pkg: 'ai.x.grok', url: 'https://grok.com/', good: ['text', 'image', 'video'] },
  claude: { name: 'Claude', pkg: 'com.anthropic.claude', url: 'https://claude.ai/new', good: ['text'] },
};

export async function copyText(text) {
  try {
    if (isNative) await Clipboard.write({ string: text });
    else await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    return false;
  }
}

export async function readClipboard() {
  try {
    if (isNative) return (await Clipboard.read()).value || '';
    return await navigator.clipboard.readText();
  } catch (_) {
    return '';
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Blob → 앱 캐시 폴더의 파일 (조각조각 써서 큰 영상도 메모리를 덜 쓴다). 실제 경로를 돌려준다. */
export async function blobToCacheFile(blob, name) {
  const path = `am/${name}`;
  const CHUNK = 3 * 1024 * 1024;
  for (let off = 0; off < blob.size || off === 0; off += CHUNK) {
    const data = await blobToBase64(blob.slice(off, off + CHUNK));
    if (off === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
    if (blob.size === 0) break;
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

/**
 * AI 앱으로 프롬프트(+참고 그림)를 보낸다. 글은 클립보드에도 복사해 둔다(앱이 글을 안 받는 경우 붙여넣기용).
 * @returns {Promise<{direct:boolean, web?:boolean}>}
 */
export async function sendToApp(appId, { text = '', files = [] } = {}) {
  const app = AI_APPS[appId] || {};
  await copyText(text);
  if (!isNative) {
    window.open(app.url || 'about:blank', '_blank');
    return { direct: false, web: true };
  }
  const paths = [];
  for (const f of files) if (f && f.blob) paths.push(await blobToCacheFile(f.blob, f.name));
  return Native.shareTo({ pkg: app.pkg || '', text, files: paths });
}

export async function openApp(appId) {
  const app = AI_APPS[appId] || {};
  if (!isNative) { window.open(app.url, '_blank'); return; }
  await Native.openApp({ pkg: app.pkg || '', url: app.url || '' });
}

/** 다른 앱에서 '공유 → AnimeMaker' 로 들어온 것 받기 */
export function onShared(cb) {
  if (!isNative) return;
  Native.addListener('shared', (d) => cb(d));
  Native.takePendingShare().then((r) => { if (r && r.share) cb(r.share); }).catch(() => {});
}

/** 공유로 받은 파일(캐시 경로) → Blob */
export async function sharedItemToBlob(item) {
  const res = await fetch(Capacitor.convertFileSrc(item.path));
  const blob = await res.blob();
  return item.mime && blob.type !== item.mime ? new Blob([blob], { type: item.mime }) : blob;
}

export async function keepAwake(on) {
  if (!isNative) return;
  try { await Native.keepAwake({ on }); } catch (_) { /* noop */ }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

/** 완성 영상을 갤러리에 저장. 오래된 안드로이드는 '공유' 창으로 대신. */
export async function saveToGallery(blob, name) {
  if (!isNative) { download(blob, name); return { saved: true, folder: '다운로드' }; }
  const path = await blobToCacheFile(blob, `out/${Date.now()}_${name.replace(/[^\w.\-가-힣 ]/g, '_')}`);
  const r = await Native.saveToGallery({ path, name });
  if (!r.saved) {
    await Native.shareTo({ pkg: '', text: '', files: [path] });
    return { saved: false, shared: true };
  }
  return r;
}

/** 파일을 다른 앱으로 공유 (유튜브·인스타·카톡 등) */
export async function shareFile(blob, name, text = '') {
  if (!isNative) { download(blob, name); return; }
  const path = await blobToCacheFile(blob, `out/${Date.now()}_${name.replace(/[^\w.\-가-힣 ]/g, '_')}`);
  await Native.shareTo({ pkg: '', text, files: [path] });
}

export function onBackButton(cb) {
  if (!isNative) return;
  App.addListener('backButton', cb);
}

export function onResume(cb) {
  if (!isNative) return;
  App.addListener('resume', cb);
}

export function exitApp() {
  if (isNative) App.exitApp();
}
