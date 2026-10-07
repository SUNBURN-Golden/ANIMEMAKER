'use strict';
// 자동 클릭 모드용 브라우저.
// 사용자의 PC 에 설치된 Edge/Chrome 을 'AnimeMaker 전용 프로필' 로 띄우고 CDP 로 연결한다.
// (로그인은 사용자가 그 창에서 직접 한 번만 하면 쿠키가 프로필에 남는다)
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const http = require('http');

let chromium = null;
function pw() {
  if (!chromium) chromium = require('playwright-core').chromium;
  return chromium;
}

function candidatesFor(pref) {
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const edge = [
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/microsoft-edge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  const chrome = [
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return pref === 'chrome' ? [...chrome, ...edge] : [...edge, ...chrome];
}

function findBrowser(pref, customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  if (process.env.ANIMEMAKER_BOT_BROWSER && fs.existsSync(process.env.ANIMEMAKER_BOT_BROWSER)) return process.env.ANIMEMAKER_BOT_BROWSER;
  return candidatesFor(pref).find((p) => { try { return fs.statSync(p).isFile(); } catch (_) { return false; } }) || null;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('timeout')));
  });
}

class BotBrowser {
  constructor() {
    this.proc = null;
    this.browser = null;
    this.context = null;
    this.port = 0;
  }

  isAlive() {
    return !!(this.browser && this.browser.isConnected() && this.proc && this.proc.exitCode === null);
  }

  /**
   * @param {{browserPath?:string, prefer?:string, profileDir:string, headless?:boolean, startUrl?:string}} o
   */
  async ensure(o) {
    if (this.isAlive()) return this;
    await this.close();
    const exe = findBrowser(o.prefer, o.browserPath);
    if (!exe) throw new Error('Edge 또는 Chrome 브라우저를 찾지 못했습니다. 설정에서 브라우저 위치를 지정해 주세요.');
    fs.mkdirSync(o.profileDir, { recursive: true });
    this.port = await freePort();
    const args = [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${o.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--window-size=1280,900',
    ];
    if (o.headless) args.push('--headless=new');
    if (o.extraArgs) args.push(...o.extraArgs);
    args.push(o.startUrl || 'about:blank');
    this.proc = spawn(exe, args, { stdio: 'ignore', windowsHide: false, detached: false });
    const until = Date.now() + 30000;
    let ok = false;
    while (Date.now() < until) {
      try { await getJson(`http://127.0.0.1:${this.port}/json/version`); ok = true; break; } catch (_) { await sleep(400); }
      if (this.proc.exitCode !== null) break;
    }
    if (!ok) {
      throw new Error('자동 클릭용 브라우저를 열지 못했습니다. 같은 프로필의 브라우저 창이 이미 열려 있다면 닫고 다시 시도하세요.');
    }
    this.browser = await pw().connectOverCDP(`http://127.0.0.1:${this.port}`);
    this.context = this.browser.contexts()[0] || await this.browser.newContext();
    return this;
  }

  async page() {
    const pages = this.context.pages().filter((p) => !p.isClosed());
    const p = pages[pages.length - 1] || await this.context.newPage();
    await p.bringToFront().catch(() => {});
    return p;
  }

  async close() {
    try { if (this.browser) await this.browser.close(); } catch (_) { /* noop */ }
    try { if (this.proc && this.proc.exitCode === null) this.proc.kill(); } catch (_) { /* noop */ }
    this.browser = null;
    this.context = null;
    this.proc = null;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

module.exports = { BotBrowser, findBrowser, freePort };
