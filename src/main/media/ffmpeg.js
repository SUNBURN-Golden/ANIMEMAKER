'use strict';
// ffmpeg 실행 도우미. 앱에 같이 들어있는 ffmpeg-static 을 우선 사용하고,
// 없으면 시스템 ffmpeg 를 사용한다.
const { spawn } = require('child_process');
const fs = require('fs');

let cachedPath = null;

function ffmpegPath() {
  if (cachedPath) return cachedPath;
  if (process.env.ANIMEMAKER_FFMPEG && fs.existsSync(process.env.ANIMEMAKER_FFMPEG)) {
    cachedPath = process.env.ANIMEMAKER_FFMPEG;
    return cachedPath;
  }
  try {
    let p = require('ffmpeg-static');
    // 패키징된 앱에서는 asar 밖(app.asar.unpacked)에 실제 파일이 있다.
    if (p && p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
      p = p.replace('app.asar', 'app.asar.unpacked');
    }
    if (p && fs.existsSync(p)) {
      cachedPath = p;
      return cachedPath;
    }
  } catch (_) { /* ffmpeg-static 미설치 */ }
  cachedPath = 'ffmpeg';
  return cachedPath;
}

/**
 * ffmpeg 실행. 실패하면 stderr 마지막 부분을 담은 Error 를 던진다.
 * @param {string[]} args
 * @param {{signal?: AbortSignal, onProgress?: (sec:number)=>void, capture?: 'stdout'}} opts
 */
function runFfmpeg(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => { if (opts.capture === 'stdout') out.push(d); });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      err += s;
      if (err.length > 200000) err = err.slice(-100000);
      if (opts.onProgress) {
        const m = /time=(\d+):(\d+):([\d.]+)/.exec(s);
        if (m) opts.onProgress(+m[1] * 3600 + +m[2] * 60 + +m[3]);
      }
    });
    const onAbort = () => { try { child.kill('SIGKILL'); } catch (_) { /* noop */ } };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    child.on('error', (e) => reject(new Error(`ffmpeg 를 실행할 수 없습니다: ${e.message}`)));
    child.on('close', (code) => {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
      if (opts.signal && opts.signal.aborted) return reject(abortError());
      if (code === 0) return resolve({ stdout: Buffer.concat(out), stderr: err });
      const noise = /Task finished|Terminating thread|Could not open encoder before EOF|Nothing was written|^frame=|Conversion failed/;
      const tail = err.split('\n').filter((l) => l.trim() && !noise.test(l)).slice(-15).join('\n');
      reject(new Error(`ffmpeg 오류 (코드 ${code}):\n${tail}`));
    });
  });
}

function abortError() {
  const e = new Error('사용자가 중지했습니다.');
  e.name = 'AbortError';
  return e;
}

/** 미디어 정보(길이, 해상도, 오디오/비디오 유무)를 ffmpeg -i 출력으로 파악 */
async function probe(file) {
  // 출력 파일 없이 -i 만 주면 ffmpeg 는 실패 코드로 끝나지만 stderr 에 정보가 나온다.
  const stderr = await new Promise((resolve) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true });
    let s = '';
    child.stderr.on('data', (d) => { s += d.toString(); });
    child.on('close', () => resolve(s));
    child.on('error', () => resolve(''));
  });
  const info = { duration: 0, width: 0, height: 0, hasVideo: false, hasAudio: false };
  const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
  if (d) info.duration = +d[1] * 3600 + +d[2] * 60 + +d[3];
  const lines = stderr.split('\n');
  for (const line of lines) {
    if (/Stream #.*Video:/.test(line) && !/attached pic/.test(line)) {
      info.hasVideo = true;
      const r = /,\s*(\d{2,5})x(\d{2,5})/.exec(line);
      if (r && !info.width) { info.width = +r[1]; info.height = +r[2]; }
    }
    if (/Stream #.*Audio:/.test(line)) info.hasAudio = true;
  }
  return info;
}

/** 오디오를 mono float32 PCM 으로 디코딩 */
async function decodeAudioMono(file, sampleRate = 22050, opts = {}) {
  const { stdout } = await runFfmpeg(
    ['-i', file, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'],
    { ...opts, capture: 'stdout' },
  );
  const buf = stdout;
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  return { samples: Float32Array.from(samples), sampleRate };
}

/** concat demuxer 용 경로 이스케이프 */
function concatEscape(p) {
  return p.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

module.exports = { ffmpegPath, runFfmpeg, probe, decodeAudioMono, concatEscape, abortError };
