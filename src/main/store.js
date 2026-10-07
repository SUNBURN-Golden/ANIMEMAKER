'use strict';
// 설정 · 워크플로우 · 프로젝트 저장소 (모두 내 PC 의 JSON 파일)
const fs = require('fs');
const path = require('path');
const { DEFAULT_SETTINGS, BASE_WORKFLOW, BUILTIN_WORKFLOWS } = require('./defaults');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const text = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (_) {
    // 윈도우에서 백신 등이 파일을 잡고 있으면 이름 바꾸기가 실패할 수 있다 → 직접 쓰기
    fs.writeFileSync(file, text, 'utf8');
    try { fs.unlinkSync(tmp); } catch (__) { /* noop */ }
  }
}

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
  }
  return out;
}

class Store {
  /**
   * @param {{userDataDir:string, documentsDir:string, downloadsDir:string}} paths
   */
  constructor(paths) {
    this.paths = paths;
    this.settingsFile = path.join(paths.userDataDir, 'settings.json');
    this.workflowsDir = path.join(paths.userDataDir, 'workflows');
    this.recipesFile = path.join(paths.userDataDir, 'recipes.json');
    this.botProfileDir = path.join(paths.userDataDir, 'bot-browser-profile');
  }

  getSettings() {
    return deepMerge(DEFAULT_SETTINGS, readJson(this.settingsFile, {}));
  }

  saveSettings(patch) {
    const next = deepMerge(this.getSettings(), patch || {});
    writeJson(this.settingsFile, next);
    return next;
  }

  projectsDir() {
    const s = this.getSettings();
    const dir = s.projectsDir || path.join(this.paths.documentsDir, 'AnimeMaker');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  downloadsDir() {
    const s = this.getSettings();
    return s.downloadsDir || this.paths.downloadsDir;
  }

  // ---- 워크플로우 ----
  listWorkflows() {
    let user = [];
    try {
      user = fs.readdirSync(this.workflowsDir).filter((f) => f.endsWith('.json'))
        .map((f) => readJson(path.join(this.workflowsDir, f), null)).filter(Boolean)
        .map((w) => ({ ...deepMerge(BASE_WORKFLOW, w), builtin: false }));
    } catch (_) { /* 폴더 없음 */ }
    return [...BUILTIN_WORKFLOWS, ...user.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))];
  }

  getWorkflow(id) {
    return this.listWorkflows().find((w) => w.id === id) || BUILTIN_WORKFLOWS[0];
  }

  saveWorkflow(wf) {
    const id = wf.id && !wf.builtin && !String(wf.id).startsWith('builtin-') ? wf.id : `wf-${Date.now().toString(36)}`;
    const data = { ...deepMerge(BASE_WORKFLOW, wf), id, builtin: false, updatedAt: Date.now() };
    writeJson(path.join(this.workflowsDir, `${id}.json`), data);
    return data;
  }

  deleteWorkflow(id) {
    if (String(id).startsWith('builtin-')) return false;
    try { fs.unlinkSync(path.join(this.workflowsDir, `${id}.json`)); return true; } catch (_) { return false; }
  }

  // ---- 프로젝트 ----
  createProject(topic, workflow) {
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const slug = topic.replace(/[\\/:*?"<>|\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24).trim() || 'project';
    const id = `${stamp} ${slug}`;
    const dir = path.join(this.projectsDir(), id);
    fs.mkdirSync(dir, { recursive: true });
    const s = this.getSettings();
    const project = {
      id,
      title: topic.slice(0, 40),
      topic,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workflow: { ...workflow },
      providers: { ...s.providers },
      helperSites: { ...s.helperSites },
      status: 'idle',
      steps: {},
    };
    writeJson(path.join(dir, 'project.json'), project);
    return project;
  }

  projectDir(id) {
    return path.join(this.projectsDir(), id);
  }

  loadProject(id) {
    return readJson(path.join(this.projectDir(id), 'project.json'), null);
  }

  saveProject(p) {
    p.updatedAt = Date.now();
    writeJson(path.join(this.projectDir(p.id), 'project.json'), p);
  }

  listProjects() {
    const dir = this.projectsDir();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
    return ents.filter((e) => e.isDirectory())
      .map((e) => readJson(path.join(dir, e.name, 'project.json'), null))
      .filter(Boolean)
      .map((p) => ({
        id: p.id, title: (p.plan && p.plan.title) || p.title, topic: p.topic, status: p.status,
        updatedAt: p.updatedAt, createdAt: p.createdAt, workflowName: p.workflow && p.workflow.name,
        thumb: p.keyframes && p.keyframes.find((k) => k.file) ? path.join(dir, p.id, p.keyframes.find((k) => k.file).file) : null,
        final: p.output && p.output.video ? path.join(dir, p.id, p.output.video) : null,
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  deleteProject(id) {
    const dir = this.projectDir(id);
    if (!dir.startsWith(this.projectsDir())) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
}

module.exports = { Store, readJson, writeJson, deepMerge };
