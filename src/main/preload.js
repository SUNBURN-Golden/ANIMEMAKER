'use strict';
// 화면(렌더러)에서 쓸 수 있는 기능만 골라서 연결한다.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  appInfo: () => call('app:info'),
  openPath: (p) => call('sys:openPath', p),
  showItem: (p) => call('sys:showItem', p),
  openExternal: (u) => call('sys:openExternal', u),
  copyText: (t) => call('sys:copyText', t),
  copyImage: (p) => call('sys:copyImage', p),
  pickFile: (o) => call('sys:pickFile', o),
  pickFolder: () => call('sys:pickFolder'),
  readTextFile: (p) => call('sys:readTextFile', p),
  probeMedia: (p) => call('media:probe', p),
  pathForFile: (file) => (webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(file) : file.path),

  getSettings: () => call('settings:get'),
  saveSettings: (p) => call('settings:save', p),

  listWorkflows: () => call('wf:list'),
  saveWorkflow: (w) => call('wf:save', w),
  deleteWorkflow: (id) => call('wf:delete', id),

  listProjects: () => call('proj:list'),
  createProject: (o) => call('proj:create', o),
  getProject: (id) => call('proj:get', id),
  runProject: (id, from) => call('proj:run', id, from),
  stopProject: (id) => call('proj:stop', id),
  deleteProject: (id) => call('proj:delete', id),
  provideFile: (id, key, file) => call('proj:provideFile', id, key, file),
  skipWaiting: (id, key) => call('proj:skipWaiting', id, key),
  continueReview: (id) => call('proj:continue', id),
  regenerate: (id, kind, clip, opts) => call('proj:regenerate', id, kind, clip, opts),
  replaceItem: (id, kind, clip, file, slot) => call('proj:replace', id, kind, clip, file, slot),
  updatePlan: (id, plan) => call('proj:updatePlan', id, plan),
  updateLyrics: (id, lyrics) => call('proj:updateLyrics', id, lyrics),
  setBpm: (id, bpm) => call('proj:setBpm', id, bpm),
  replaceSong: (id, file) => call('proj:replaceSong', id, file),
  updateLyricsText: (id, raw, filename) => call('proj:updateLyricsText', id, raw, filename),
  readLog: (id) => call('proj:readLog', id),
  setProviders: (id, providers, sites) => call('proj:setProviders', id, providers, sites),

  suggestTopics: (seed) => call('ai:suggestTopics', seed),
  agentStatus: (id) => call('agent:status', id),
  agentTest: (id) => call('agent:test', id),
  agentLogin: (id) => call('agent:login', id),
  agentInstall: (id) => call('agent:install', id),

  botOpenSite: (site) => call('bot:openSite', site),
  botClose: () => call('bot:close'),
  botIsOpen: () => call('bot:isOpen'),
  botRecipes: () => call('bot:recipes'),
  botSaveRecipes: (j) => call('bot:saveRecipes', j),
  botResetRecipes: () => call('bot:resetRecipes'),

  onProjectUpdate: (cb) => { const f = (_e, d) => cb(d); ipcRenderer.on('project:update', f); return () => ipcRenderer.off('project:update', f); },
  onProjectLog: (cb) => { const f = (_e, d) => cb(d); ipcRenderer.on('project:log', f); return () => ipcRenderer.off('project:log', f); },
});
