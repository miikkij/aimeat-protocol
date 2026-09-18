/**
 * @file voice/config.js
 * @description Serializable voice pipeline configuration, validated before any device or paid call.
 * @structure defaults, presets, configure
 * @usage configure({ preset: 'responsive', turn: { silenceMs: 600 } })
 * @version-history v1.0.0 - 2026-09-19 - Configurable STT/LLM/TTS sessions.
 */
export const defaults = {
  preset: 'balanced', appId: '', language: 'fi-FI', systemPrompt: '',
  input: { mode: 'manual', echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  turn: { silenceMs: 700, minSpeechMs: 250, maxSpeechMs: 30000, threshold: 0.025, preRollMs: 200, bargeIn: true, interruptMs: 200 },
  stt: { provider: 'node', model: '', language: '', temperature: 0 },
  llm: { provider: 'node', model: '', temperature: 0.7, topP: 1, maxTokens: null, reasoning: null },
  tts: { provider: 'node', model: '', voice: 'alloy', format: 'pcm', sampleRate: 24000, channels: 1, speed: 1, instructions: '' },
  chunking: { minChars: 24, maxChars: 180, maxWaitMs: 350 },
  playback: { bufferMs: 80, maxBufferedMs: 3000, maxPendingSegments: 3, volume: 1 },
  history: { maxTurns: 12 }, timeoutMs: 120000,
};
export const presets = {
  balanced: {},
  responsive: { turn: { silenceMs: 450 }, chunking: { minChars: 12, maxChars: 120, maxWaitMs: 180 }, playback: { bufferMs: 40 } },
  patient: { turn: { silenceMs: 1200 }, chunking: { minChars: 50, maxChars: 240, maxWaitMs: 700 }, playback: { bufferMs: 150 } },
};

/** @param {any} target @param {any} patch @param {string} [path] */
function merge(target, patch, path = '') {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError(path + ' must be an object');
  for (const key of Object.keys(patch)) {
    if (!Object.hasOwn(target, key)) throw new TypeError('Unknown voice option: ' + path + key);
    if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) merge(target[key], patch[key], path + key + '.');
    else target[key] = patch[key];
  }
  return target;
}
/** @param {any} [options] @returns {typeof defaults} */
export function configure(options = {}) {
  const preset = options.preset ?? 'balanced';
  if (!Object.hasOwn(presets, preset)) throw new TypeError('Unknown voice preset: ' + preset);
  const result = merge(merge(structuredClone(defaults), presets[preset]), options);
  const range = (value, min, max, name, integer = false) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      throw new TypeError(name + ' must be ' + min + '..' + max + (integer ? ' (integer)' : ''));
    }
  };
  for (const key of ['appId', 'language', 'systemPrompt']) if (typeof result[key] !== 'string') throw new TypeError(key + ' must be a string');
  if (!['manual', 'vad', 'text'].includes(result.input.mode)) throw new TypeError('input.mode must be manual, vad or text');
  for (const key of ['echoCancellation', 'noiseSuppression', 'autoGainControl']) if (typeof result.input[key] !== 'boolean') throw new TypeError('input.' + key + ' must be boolean');
  if (typeof result.turn.bargeIn !== 'boolean') throw new TypeError('turn.bargeIn must be boolean');
  for (const key of ['silenceMs', 'minSpeechMs', 'maxSpeechMs', 'preRollMs', 'interruptMs']) range(result.turn[key], 0, 120000, 'turn.' + key);
  range(result.turn.threshold, 0.001, 1, 'turn.threshold');
  if (result.turn.maxSpeechMs <= result.turn.minSpeechMs) throw new TypeError('turn.maxSpeechMs must exceed minSpeechMs');
  for (const phase of ['stt', 'llm', 'tts']) {
    if (!['node', 'custom'].includes(result[phase].provider)) throw new TypeError(phase + '.provider must be node or custom');
    if (typeof result[phase].model !== 'string') throw new TypeError(phase + '.model must be a string');
  }
  for (const key of ['language']) if (typeof result.stt[key] !== 'string') throw new TypeError('stt.' + key + ' must be a string');
  for (const key of ['voice', 'instructions']) if (typeof result.tts[key] !== 'string') throw new TypeError('tts.' + key + ' must be a string');
  if (!['pcm', 'mp3'].includes(result.tts.format)) throw new TypeError('tts.format must be pcm or mp3');
  range(result.tts.sampleRate, 8000, 96000, 'tts.sampleRate', true);
  range(result.tts.channels, 1, 2, 'tts.channels', true);
  range(result.tts.speed, 0.25, 4, 'tts.speed');
  range(result.stt.temperature, 0, 1, 'stt.temperature');
  range(result.llm.temperature, 0, 2, 'llm.temperature');
  range(result.llm.topP, 0, 1, 'llm.topP');
  if (result.llm.maxTokens !== null) range(result.llm.maxTokens, 1, 32768, 'llm.maxTokens', true);
  if (result.llm.reasoning !== null && (typeof result.llm.reasoning !== 'object' || Array.isArray(result.llm.reasoning))) throw new TypeError('llm.reasoning must be an object or null');
  range(result.chunking.minChars, 1, 2000, 'chunking.minChars', true);
  range(result.chunking.maxChars, result.chunking.minChars, 4000, 'chunking.maxChars', true);
  range(result.chunking.maxWaitMs, 1, 10000, 'chunking.maxWaitMs');
  range(result.playback.bufferMs, 0, 2000, 'playback.bufferMs');
  range(result.playback.maxBufferedMs, Math.max(100, result.playback.bufferMs), 30000, 'playback.maxBufferedMs');
  range(result.playback.maxPendingSegments, 1, 20, 'playback.maxPendingSegments', true);
  range(result.playback.volume, 0, 1, 'playback.volume');
  range(result.history.maxTurns, 0, 100, 'history.maxTurns', true);
  range(result.timeoutMs, 1000, 600000, 'timeoutMs');
  return result;
}
