/**
 * @file voice/session.js
 * @description A configurable STT/LLM/TTS turn coordinator. No content persists unless the app stores it.
 * @structure createSession with injected stage adapters and browser capture/playback factories
 * @usage const s = createSession(options, adapters); await s.start(); await s.sendText('Hello');
 * @version-history v1.0.0 - 2026-09-19 - Bounded queues, interruption, heard history and stage timing.
 */
import { configure } from './config.js';
import { segments, abortable } from './segments.js';
import { prefetchAudio } from './prefetch.js';

/** @param {any} options @param {any} adapters @param {any} factories */
export function createSession(options, adapters, factories) {
  let config = configure(options);
  let state = 'idle', started = false, starting = null, closed = false, epoch = 0;
  let controller, capture, player;
  const listeners = new Map(); const history = [];
  const emit = (type, detail = {}) => {
    const event = { ...detail, type };
    for (const fn of listeners.get(type) || []) { try { fn(event); } catch (error) { console.error('[voice] event handler failed', error); } }
  };
  const setState = value => { state = value; emit('state', { state }); };
  const validateAdapters = () => {
    for (const [stage, method] of [['stt', 'transcribe'], ['llm', 'complete'], ['tts', 'speak']]) {
      if (config[stage].provider === 'custom' && typeof adapters[method] !== 'function') throw new TypeError(stage + ' requires adapters.' + method);
    }
    if (config.tts.provider === 'node' && !config.tts.model) throw new TypeError('tts.model is required for node speech synthesis');
  };
  validateAdapters();
  const api = {
    get state() { return state; },
    get config() { return structuredClone(config); },
    get history() { return history.filter(message => message.content).map(message => ({ ...message })); },
    on(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); return () => listeners.get(type).delete(handler); },
    configure(patch) {
      if (started || starting || closed) throw new Error('Stop the session before configuring it');
      // A preset switch resets its timing knobs; explicit options in the patch still win.
      const base = patch.preset && patch.preset !== config.preset
        ? { ...config, ...Object.fromEntries(['turn', 'chunking', 'playback'].map(key => [key, configure({ preset: patch.preset })[key]])) }
        : config;
      const merged = { ...base, ...patch };
      for (const key of ['input', 'turn', 'stt', 'llm', 'tts', 'chunking', 'playback', 'history']) merged[key] = { ...base[key], ...patch[key] };
      const previous = config; config = configure(merged);
      try { validateAdapters(); } catch (error) { config = previous; throw error; }
      return api.config;
    },
    async start() {
      if (closed) throw new Error('Voice session is closed');
      if (started) return;
      if (starting) return starting;
      const generation = ++epoch;
      starting = (async () => {
        player = factories.player(config, () => { if (controller && !controller.signal.aborted) emit('audio'); });
        try {
          await player.open();
          if (generation !== epoch) return;
          if (config.input.mode !== 'text') {
            capture = factories.capture(config, { busy: () => !!controller,
              interrupt: () => api.interrupt(), level: value => emit('level', { value }),
              utterance: blob => { void api.sendAudio(blob).catch(error => { if (error.name !== 'AbortError') emit('error', { error }); }); } });
            await capture.start();
          }
          if (generation === epoch) { started = true; setState(config.input.mode === 'text' ? 'ready' : 'listening'); }
        } catch (error) {
          if (capture) await capture.close(); if (player) await player.close();
          setState('error'); throw error;
        } finally { starting = null; }
      })();
      return starting;
    },
    begin() { if (!started || config.input.mode !== 'manual') throw new Error('Manual recording requires a started manual session'); api.interrupt(); capture.begin(); setState('listening'); },
    commit() { capture?.commit(); },
    interrupt() {
      epoch++; if (controller) controller.abort(new DOMException('Voice turn interrupted', 'AbortError'));
      controller = null; player?.stop();
      if (started) setState(config.input.mode === 'text' ? 'ready' : 'listening');
      emit('interrupted');
    },
    async sendAudio(blob) { return run(blob, true); },
    async sendText(text) { if (typeof text !== 'string' || !text.trim()) throw new TypeError('text is required'); return run(text, false); },
    clearHistory() { if (controller) throw new Error('Interrupt the turn before clearing history'); history.length = 0; },
    async stop() {
      api.interrupt(); started = false;
      if (capture) await capture.close(); if (player) await player.close();
      if (starting) await starting;
      capture = null; player = null; setState(closed ? 'closed' : 'idle');
    },
    async close() { if (closed) return; closed = true; await api.stop(); listeners.clear(); history.length = 0; },
  };

  async function run(input, audio) {
    if (!started || closed) throw new Error('Start the voice session from a user gesture first');
    api.interrupt();
    const turn = ++epoch; const ctl = new AbortController(); controller = ctl;
    const signal = ctl.signal; const began = performance.now();
    const timeout = setTimeout(() => ctl.abort(new DOMException('Voice turn timed out', 'TimeoutError')), config.timeoutMs);
    const stages = factories.adapters(config, event => { if (turn === epoch) emit('usage', event); });
    const stage = (name, method) => config[name].provider === 'custom' ? adapters[method] : stages[method];
    const ctx = { signal, config: structuredClone(config), turn };
    let spoken = '', text, firstAudio = false, answer = '', workerError;
    const historyAnswer = { role: 'assistant', content: '' };
    const heard = () => { if (!firstAudio) { firstAudio = true; emit('timing', { phase: 'firstAudio', ms: performance.now() - began, turn }); } };
    const unhear = api.on('audio', heard);
    let chain = Promise.resolve(); const jobs = new Set();
    try {
      if (audio) { setState('transcribing'); text = await abortable(Promise.resolve(stage('stt', 'transcribe')(input, ctx)), signal); }
      else text = input;
      signal.throwIfAborted();
      if (!text.trim()) throw new Error('No speech was recognized');
      emit('transcript', { role: 'user', text, final: true, turn });
      const messages = [...(config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : []), ...api.history, { role: 'user', content: text }];
      if (config.history.maxTurns) {
        history.push({ role: 'user', content: text }, historyAnswer);
        while (history.length > config.history.maxTurns * 2) history.splice(0, 2);
      }
      setState('thinking');
      async function* tokens() {
        for await (const delta of stage('llm', 'complete')(messages, ctx)) {
          signal.throwIfAborted();
          if (typeof delta !== 'string') throw new TypeError('complete adapter must yield strings');
          answer += delta; emit('transcript', { role: 'assistant', text: answer, delta, final: false, turn }); yield delta;
        }
      }
      for await (const part of segments(tokens(), config.chunking, signal)) {
        while (jobs.size >= config.playback.maxPendingSegments) await abortable(Promise.race(jobs), signal);
        if (workerError) throw workerError;
        const audio = prefetchAudio(stage('tts', 'speak')(part, ctx), signal);
        const scheduled = chain.then(async () => {
          signal.throwIfAborted(); setState('speaking'); emit('segment', { text: part, turn });
          if (player.enqueue) return player.enqueue(audio, signal);
          await player.play(audio, signal);
          return { played: Promise.resolve() };
        });
        chain = scheduled.then(() => {});
        void chain.catch(() => {}); // The job reports errors and aborts the turn immediately.
        const job = scheduled.then(async ({ played }) => {
          await played;
          signal.throwIfAborted(); spoken += (spoken ? ' ' : '') + part;
          historyAnswer.content = spoken;
        });
        jobs.add(job);
        void job.then(() => jobs.delete(job), error => { jobs.delete(job); workerError = error; ctl.abort(error); });
      }
      await abortable(chain, signal);
      await abortable(Promise.all(jobs), signal); signal.throwIfAborted();
      if (!answer.trim()) throw new Error('The conversation model returned no text');
      emit('transcript', { role: 'assistant', text: answer, final: true, turn });
      emit('timing', { phase: 'complete', ms: performance.now() - began, turn });
      return { text: answer, spoken, turn };
    } catch (error) {
      ctl.abort(error);
      if (turn === epoch) { player.stop(); if (error.name !== 'AbortError') { emit('error', { error, turn }); setState('error'); } }
      throw error;
    } finally {
      clearTimeout(timeout); unhear();
      // Only completed spoken segments enter history. Unheard generated text is never asserted as heard.
      if (turn === epoch) { controller = null; if (state !== 'error') setState(config.input.mode === 'text' ? 'ready' : 'listening'); }
    }
  }
  return api;
}
