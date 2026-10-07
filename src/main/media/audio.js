'use strict';
// 노래 분석: BPM, 박자(비트), 마디 시작(다운비트), 마디별 에너지.
// 외부 AI 없이 내 PC 에서 계산한다 (무료).
const { decodeAudioMono } = require('./ffmpeg');
const { analyzeSamples, estimateTempo, fixOctave, SR } = require('./audio-analysis');

/**
 * 노래 파일 분석.
 * @returns {{duration:number,bpm:number,beats:number[],downbeats:number[],bars:{start:number,end:number,energy:number,level:string}[]}}
 */
async function analyzeSong(file, opts = {}) {
  const { samples } = await decodeAudioMono(file, SR, opts);
  return analyzeSamples(samples, opts.priorBpm);
}

module.exports = { analyzeSong, analyzeSamples, estimateTempo, fixOctave, SR };
