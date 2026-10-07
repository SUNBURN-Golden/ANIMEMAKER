// 폰 안 저장소 (IndexedDB): 작품 정보 + 노래·그림·영상 파일
const DB_NAME = 'animemaker';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('저장 실패 (저장 공간이 부족할 수 있어요)'));
  });
}

export async function listProjects() {
  const all = (await tx('projects', 'readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id) {
  return tx('projects', 'readonly', (s) => s.get(id));
}

export function saveProject(p) {
  p.updatedAt = Date.now();
  return tx('projects', 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(p))));
}

export async function deleteProject(id) {
  const keys = (await tx('files', 'readonly', (s) => s.getAllKeys())) || [];
  await tx('files', 'readwrite', (s) => { for (const k of keys) if (String(k).startsWith(`${id}/`)) s.delete(k); });
  await tx('projects', 'readwrite', (s) => s.delete(id));
}

export function putFile(key, blob) {
  return tx('files', 'readwrite', (s) => s.put(blob, key));
}

export function getFile(key) {
  if (!key) return Promise.resolve(null);
  return tx('files', 'readonly', (s) => s.get(key));
}

export function deleteFile(key) {
  if (!key) return Promise.resolve();
  return tx('files', 'readwrite', (s) => s.delete(key));
}

/** 저장 공간 사용량 (가능하면) */
export async function usage() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    return e ? { used: e.usage || 0, quota: e.quota || 0 } : null;
  } catch (_) {
    return null;
  }
}
