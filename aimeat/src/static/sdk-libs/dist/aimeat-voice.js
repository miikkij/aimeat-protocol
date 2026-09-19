// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/voice/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-voice.js (with a per-node config prelude).
"use strict";
(() => {
  // src/static/sdk-libs/_core/namespace.js
  function namespace() {
    if (!window.AIMEAT) window.AIMEAT = {};
    return window.AIMEAT;
  }
  function attach(key, value) {
    const ns = namespace();
    ns[key] = value;
    return ns;
  }

  // src/static/sdk-libs/voice/config.js
  var defaults = {
    preset: "balanced",
    appId: "",
    language: "fi-FI",
    systemPrompt: "",
    input: { mode: "manual", echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    turn: { silenceMs: 700, minSpeechMs: 250, maxSpeechMs: 3e4, threshold: 0.025, preRollMs: 200, bargeIn: true, interruptMs: 200 },
    stt: { provider: "node", model: "", language: "", temperature: 0 },
    llm: { provider: "node", model: "", temperature: 0.7, topP: 1, maxTokens: null, reasoning: null },
    tts: { provider: "node", model: "", voice: "alloy", format: "pcm", sampleRate: 24e3, channels: 1, speed: 1, instructions: "" },
    chunking: { mode: "sentence", minChars: 24, maxChars: 1200, maxWaitMs: 350 },
    playback: { bufferMs: 80, maxBufferedMs: 3e3, maxPendingSegments: 3, volume: 1 },
    history: { maxTurns: 12 },
    timeoutMs: 12e4
  };
  var presets = {
    balanced: {},
    responsive: { turn: { silenceMs: 450 }, chunking: { minChars: 12, maxChars: 1200, maxWaitMs: 180 }, playback: { bufferMs: 40 } },
    patient: { turn: { silenceMs: 1200 }, chunking: { minChars: 50, maxChars: 2e3, maxWaitMs: 700 }, playback: { bufferMs: 150 } }
  };
  function merge(target, patch, path = "") {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError(path + " must be an object");
    for (const key of Object.keys(patch)) {
      if (!Object.hasOwn(target, key)) throw new TypeError("Unknown voice option: " + path + key);
      if (target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) merge(target[key], patch[key], path + key + ".");
      else target[key] = patch[key];
    }
    return target;
  }
  function configure(options = {}) {
    const preset = options.preset ?? "balanced";
    if (!Object.hasOwn(presets, preset)) throw new TypeError("Unknown voice preset: " + preset);
    const result = merge(merge(structuredClone(defaults), presets[preset]), options);
    const range = (value, min, max, name, integer = false) => {
      if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || integer && !Number.isInteger(value)) {
        throw new TypeError(name + " must be " + min + ".." + max + (integer ? " (integer)" : ""));
      }
    };
    for (const key of ["appId", "language", "systemPrompt"]) if (typeof result[key] !== "string") throw new TypeError(key + " must be a string");
    if (!["manual", "vad", "text"].includes(result.input.mode)) throw new TypeError("input.mode must be manual, vad or text");
    for (const key of ["echoCancellation", "noiseSuppression", "autoGainControl"]) if (typeof result.input[key] !== "boolean") throw new TypeError("input." + key + " must be boolean");
    if (typeof result.turn.bargeIn !== "boolean") throw new TypeError("turn.bargeIn must be boolean");
    for (const key of ["silenceMs", "minSpeechMs", "maxSpeechMs", "preRollMs", "interruptMs"]) range(result.turn[key], 0, 12e4, "turn." + key);
    range(result.turn.threshold, 1e-3, 1, "turn.threshold");
    if (result.turn.maxSpeechMs <= result.turn.minSpeechMs) throw new TypeError("turn.maxSpeechMs must exceed minSpeechMs");
    for (const phase of ["stt", "llm", "tts"]) {
      if (!["node", "custom"].includes(result[phase].provider)) throw new TypeError(phase + ".provider must be node or custom");
      if (typeof result[phase].model !== "string") throw new TypeError(phase + ".model must be a string");
    }
    for (const key of ["language"]) if (typeof result.stt[key] !== "string") throw new TypeError("stt." + key + " must be a string");
    for (const key of ["voice", "instructions"]) if (typeof result.tts[key] !== "string") throw new TypeError("tts." + key + " must be a string");
    if (!["pcm", "mp3"].includes(result.tts.format)) throw new TypeError("tts.format must be pcm or mp3");
    range(result.tts.sampleRate, 8e3, 96e3, "tts.sampleRate", true);
    range(result.tts.channels, 1, 2, "tts.channels", true);
    range(result.tts.speed, 0.25, 4, "tts.speed");
    range(result.stt.temperature, 0, 1, "stt.temperature");
    range(result.llm.temperature, 0, 2, "llm.temperature");
    range(result.llm.topP, 0, 1, "llm.topP");
    if (result.llm.maxTokens !== null) range(result.llm.maxTokens, 1, 32768, "llm.maxTokens", true);
    if (result.llm.reasoning !== null && (typeof result.llm.reasoning !== "object" || Array.isArray(result.llm.reasoning))) throw new TypeError("llm.reasoning must be an object or null");
    range(result.chunking.minChars, 1, 2e3, "chunking.minChars", true);
    if (!["sentence", "latency"].includes(result.chunking.mode)) throw new TypeError("chunking.mode must be sentence or latency");
    range(result.chunking.maxChars, result.chunking.minChars, 4e3, "chunking.maxChars", true);
    range(result.chunking.maxWaitMs, 1, 1e4, "chunking.maxWaitMs");
    range(result.playback.bufferMs, 0, 2e3, "playback.bufferMs");
    range(result.playback.maxBufferedMs, Math.max(100, result.playback.bufferMs), 3e4, "playback.maxBufferedMs");
    range(result.playback.maxPendingSegments, 1, 20, "playback.maxPendingSegments", true);
    range(result.playback.volume, 0, 1, "playback.volume");
    range(result.history.maxTurns, 0, 100, "history.maxTurns", true);
    range(result.timeoutMs, 1e3, 6e5, "timeoutMs");
    return result;
  }

  // src/static/sdk-libs/voice/segments.js
  function abortable(promise, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason || new DOMException("Interrupted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }
  function delay(ms, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", stop);
        resolve(void 0);
      }, ms);
      signal.addEventListener("abort", stop, { once: true });
    });
  }
  async function* segments(source, opts, signal) {
    const iterator = source[Symbol.asyncIterator]();
    let pending = iterator.next();
    let buffer = "";
    let since = Date.now();
    try {
      while (true) {
        signal.throwIfAborted();
        const sentence = [...buffer.matchAll(/[.!?…。！？](?:["')\]]*)(?:\s|$)|\n/g)].find((match) => match.index + match[0].length >= opts.minChars);
        let cut = sentence && sentence.index + sentence[0].length <= opts.maxChars ? sentence.index + sentence[0].length : 0;
        if (!cut && buffer.length >= opts.maxChars) {
          cut = buffer.lastIndexOf(" ", opts.maxChars);
          if (cut < opts.minChars) cut = opts.maxChars;
        }
        if (!cut && opts.mode !== "sentence" && buffer.trim() && Date.now() - since >= opts.maxWaitMs) cut = buffer.length;
        if (cut) {
          const part = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut);
          since = Date.now();
          if (part) yield part;
          continue;
        }
        let timer;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), Math.max(1, opts.maxWaitMs - (Date.now() - since)));
        });
        let result;
        try {
          result = await abortable(opts.mode !== "sentence" && buffer.trim() ? Promise.race([pending, timeout]) : pending, signal);
        } finally {
          clearTimeout(timer);
        }
        if (!result) continue;
        if (result.done) {
          if (buffer.trim()) yield buffer.trim();
          return;
        }
        if (!buffer.trim()) since = Date.now();
        buffer += result.value;
        pending = iterator.next();
        pending.catch(() => {
        });
      }
    } finally {
      if (iterator.return) void iterator.return().catch((err) => {
        if (!signal.aborted) console.warn("[voice] stream cleanup failed", err);
      });
    }
  }

  // src/static/sdk-libs/voice/prefetch.js
  function prefetchAudio(source, signal) {
    const queue = [];
    const iterator = source[Symbol.asyncIterator]();
    let bytes = 0, done = false, error, wake, space;
    const notify = () => {
      if (wake) {
        wake();
        wake = null;
      }
    };
    const producer = (async () => {
      try {
        while (true) {
          while (bytes >= 1e6) await abortable(new Promise((resolve) => {
            space = resolve;
          }), signal);
          const result = await abortable(iterator.next(), signal);
          if (result.done) break;
          if (!(result.value instanceof Uint8Array) || result.value.byteLength > 8e6) throw new Error("Invalid or oversized speech chunk");
          queue.push(result.value);
          bytes += result.value.byteLength;
          notify();
        }
      } catch (err) {
        error = err;
      } finally {
        done = true;
        notify();
        if (iterator.return) void iterator.return().catch((err) => {
          if (!signal.aborted) console.warn("[voice] speech cleanup failed", err);
        });
      }
    })();
    return {
      async *[Symbol.asyncIterator]() {
        while (true) {
          signal.throwIfAborted();
          if (error) throw error;
          if (queue.length) {
            const chunk = queue.shift();
            bytes -= chunk.byteLength;
            if (space) {
              space();
              space = null;
            }
            yield chunk;
          } else if (done) {
            await producer;
            return;
          } else await abortable(new Promise((resolve) => {
            wake = resolve;
          }), signal);
        }
      }
    };
  }

  // src/static/sdk-libs/voice/session.js
  function createSession(options, adapters, factories) {
    let config = configure(options);
    let state2 = "idle", started = false, starting = null, closed = false, epoch = 0;
    let controller, capture, player;
    const listeners = /* @__PURE__ */ new Map();
    const history = [];
    const emit = (type, detail = {}) => {
      const event = { ...detail, type };
      for (const fn of listeners.get(type) || []) {
        try {
          fn(event);
        } catch (error) {
          console.error("[voice] event handler failed", error);
        }
      }
    };
    const setState = (value) => {
      state2 = value;
      emit("state", { state: state2 });
    };
    const validateAdapters = () => {
      for (const [stage, method] of [["stt", "transcribe"], ["llm", "complete"], ["tts", "speak"]]) {
        if (config[stage].provider === "custom" && typeof adapters[method] !== "function") throw new TypeError(stage + " requires adapters." + method);
      }
      if (config.tts.provider === "node" && !config.tts.model) throw new TypeError("tts.model is required for node speech synthesis");
    };
    validateAdapters();
    const api = {
      get state() {
        return state2;
      },
      get config() {
        return structuredClone(config);
      },
      get history() {
        return history.filter((message) => message.content).map((message) => ({ ...message }));
      },
      on(type, handler) {
        if (!listeners.has(type)) listeners.set(type, /* @__PURE__ */ new Set());
        listeners.get(type).add(handler);
        return () => listeners.get(type).delete(handler);
      },
      configure(patch) {
        if (started || starting || closed) throw new Error("Stop the session before configuring it");
        const base = patch.preset && patch.preset !== config.preset ? { ...config, ...Object.fromEntries(["turn", "chunking", "playback"].map((key) => [key, configure({ preset: patch.preset })[key]])) } : config;
        const merged = { ...base, ...patch };
        for (const key of ["input", "turn", "stt", "llm", "tts", "chunking", "playback", "history"]) merged[key] = { ...base[key], ...patch[key] };
        const previous = config;
        config = configure(merged);
        try {
          validateAdapters();
        } catch (error) {
          config = previous;
          throw error;
        }
        return api.config;
      },
      async start() {
        if (closed) throw new Error("Voice session is closed");
        if (started) return;
        if (starting) return starting;
        const generation = ++epoch;
        starting = (async () => {
          player = factories.player(config, () => {
            if (controller && !controller.signal.aborted) emit("audio");
          });
          try {
            await player.open();
            if (generation !== epoch) return;
            if (config.input.mode !== "text") {
              capture = factories.capture(config, {
                busy: () => !!controller,
                interrupt: () => api.interrupt(),
                level: (value) => emit("level", { value }),
                utterance: (blob) => {
                  void api.sendAudio(blob).catch((error) => {
                    if (error.name !== "AbortError") emit("error", { error });
                  });
                }
              });
              await capture.start();
            }
            if (generation === epoch) {
              started = true;
              setState(config.input.mode === "text" ? "ready" : "listening");
            }
          } catch (error) {
            if (capture) await capture.close();
            if (player) await player.close();
            setState("error");
            throw error;
          } finally {
            starting = null;
          }
        })();
        return starting;
      },
      begin() {
        if (!started || config.input.mode !== "manual") throw new Error("Manual recording requires a started manual session");
        api.interrupt();
        capture.begin();
        setState("listening");
      },
      commit() {
        capture?.commit();
      },
      interrupt() {
        epoch++;
        if (controller) controller.abort(new DOMException("Voice turn interrupted", "AbortError"));
        controller = null;
        player?.stop();
        if (started) setState(config.input.mode === "text" ? "ready" : "listening");
        emit("interrupted");
      },
      async sendAudio(blob) {
        return run(blob, true);
      },
      async sendText(text) {
        if (typeof text !== "string" || !text.trim()) throw new TypeError("text is required");
        return run(text, false);
      },
      clearHistory() {
        if (controller) throw new Error("Interrupt the turn before clearing history");
        history.length = 0;
      },
      async stop() {
        api.interrupt();
        started = false;
        if (capture) await capture.close();
        if (player) await player.close();
        if (starting) await starting;
        capture = null;
        player = null;
        setState(closed ? "closed" : "idle");
      },
      async close() {
        if (closed) return;
        closed = true;
        await api.stop();
        listeners.clear();
        history.length = 0;
      }
    };
    async function run(input, audio) {
      if (!started || closed) throw new Error("Start the voice session from a user gesture first");
      api.interrupt();
      const turn = ++epoch;
      const ctl = new AbortController();
      controller = ctl;
      const signal = ctl.signal;
      const began = performance.now();
      const timeout = setTimeout(() => ctl.abort(new DOMException("Voice turn timed out", "TimeoutError")), config.timeoutMs);
      const stages = factories.adapters(config, (event) => {
        if (turn === epoch) emit("usage", event);
      });
      const stage = (name, method) => config[name].provider === "custom" ? adapters[method] : stages[method];
      const ctx = { signal, config: structuredClone(config), turn };
      let spoken = "", text, firstAudio = false, answer = "", workerError;
      const historyAnswer = { role: "assistant", content: "" };
      const heard = () => {
        if (!firstAudio) {
          firstAudio = true;
          emit("timing", { phase: "firstAudio", ms: performance.now() - began, turn });
        }
      };
      const unhear = api.on("audio", heard);
      let chain = Promise.resolve();
      const jobs = /* @__PURE__ */ new Set();
      try {
        if (audio) {
          setState("transcribing");
          text = await abortable(Promise.resolve(stage("stt", "transcribe")(input, ctx)), signal);
        } else text = input;
        signal.throwIfAborted();
        if (!text.trim()) throw new Error("No speech was recognized");
        emit("transcript", { role: "user", text, final: true, turn });
        const messages = [...config.systemPrompt ? [{ role: "system", content: config.systemPrompt }] : [], ...api.history, { role: "user", content: text }];
        if (config.history.maxTurns) {
          history.push({ role: "user", content: text }, historyAnswer);
          while (history.length > config.history.maxTurns * 2) history.splice(0, 2);
        }
        setState("thinking");
        async function* tokens() {
          for await (const delta of stage("llm", "complete")(messages, ctx)) {
            signal.throwIfAborted();
            if (typeof delta !== "string") throw new TypeError("complete adapter must yield strings");
            answer += delta;
            emit("transcript", { role: "assistant", text: answer, delta, final: false, turn });
            yield delta;
          }
        }
        for await (const part of segments(tokens(), config.chunking, signal)) {
          while (jobs.size >= config.playback.maxPendingSegments) await abortable(Promise.race(jobs), signal);
          if (workerError) throw workerError;
          const audio2 = prefetchAudio(stage("tts", "speak")(part, ctx), signal);
          const scheduled = chain.then(async () => {
            signal.throwIfAborted();
            setState("speaking");
            emit("segment", { text: part, turn });
            if (player.enqueue) return player.enqueue(audio2, signal);
            await player.play(audio2, signal);
            return { played: Promise.resolve() };
          });
          chain = scheduled.then(() => {
          });
          void chain.catch(() => {
          });
          const job = scheduled.then(async ({ played }) => {
            await played;
            signal.throwIfAborted();
            spoken += (spoken ? " " : "") + part;
            historyAnswer.content = spoken;
          });
          jobs.add(job);
          void job.then(() => jobs.delete(job), (error) => {
            jobs.delete(job);
            workerError = error;
            ctl.abort(error);
          });
        }
        await abortable(chain, signal);
        await abortable(Promise.all(jobs), signal);
        signal.throwIfAborted();
        if (!answer.trim()) throw new Error("The conversation model returned no text");
        emit("transcript", { role: "assistant", text: answer, final: true, turn });
        emit("timing", { phase: "complete", ms: performance.now() - began, turn });
        return { text: answer, spoken, turn };
      } catch (error) {
        ctl.abort(error);
        if (turn === epoch) {
          player.stop();
          if (error.name !== "AbortError") {
            emit("error", { error, turn });
            setState("error");
          }
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        unhear();
        if (turn === epoch) {
          controller = null;
          if (state2 !== "error") setState(config.input.mode === "text" ? "ready" : "listening");
        }
      }
    }
    return api;
  }

  // src/static/sdk-libs/voice/capture-worklet.js
  var captureWorkletSource = `
class AimeatVoiceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(1024);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.samples[this.offset++] = input[i];
      if (this.offset === this.samples.length) {
        this.port.postMessage(this.samples, [this.samples.buffer]);
        this.samples = new Float32Array(1024);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor('aimeat-voice-capture', AimeatVoiceCapture);
`;

  // src/static/sdk-libs/voice/capture.js
  function wav(chunks, rate) {
    const frames = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const data = new ArrayBuffer(44 + frames * 2);
    const view = new DataView(data);
    const word = (offset2, text) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset2 + i, text.charCodeAt(i));
    };
    word(0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
    word(8, "WAVE");
    word(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    word(36, "data");
    view.setUint32(40, frames * 2, true);
    let offset = 44;
    for (const chunk of chunks) for (const value of chunk) {
      view.setInt16(offset, Math.max(-1, Math.min(1, value)) * (value < 0 ? 32768 : 32767), true);
      offset += 2;
    }
    return new Blob([data], { type: "audio/wav" });
  }
  function createCapture(config, hooks) {
    let context, stream, source, processor, silent;
    let closed = false, held = false, active = false, voiced = 0, quiet = 0, duration = 0;
    let chunks = [], preRoll = [], preRollMs = 0;
    const reset = () => {
      active = false;
      chunks = [];
      voiced = 0;
      quiet = 0;
      duration = 0;
    };
    const finish = () => {
      const saved = chunks;
      const valid = duration >= config.turn.minSpeechMs;
      reset();
      held = false;
      if (saved.length && valid) hooks.utterance(wav(saved, context.sampleRate));
    };
    return {
      async start() {
        if (closed) throw new Error("Microphone capture is closed");
        context = new AudioContext();
        await context.resume();
        if (!context.audioWorklet) throw new Error("AudioWorklet requires a secure, supported browser");
        const moduleUrl = URL.createObjectURL(new Blob([captureWorkletSource], { type: "text/javascript" }));
        try {
          await context.audioWorklet.addModule(moduleUrl);
        } finally {
          URL.revokeObjectURL(moduleUrl);
        }
        if (closed) return;
        stream = await navigator.mediaDevices.getUserMedia({ audio: {
          echoCancellation: config.input.echoCancellation,
          noiseSuppression: config.input.noiseSuppression,
          autoGainControl: config.input.autoGainControl,
          channelCount: 1
        } });
        if (closed) {
          stream.getTracks().forEach((track) => track.stop());
          if (context.state !== "closed") await context.close();
          return;
        }
        source = context.createMediaStreamSource(stream);
        processor = new AudioWorkletNode(context, "aimeat-voice-capture", { channelCount: 1, channelCountMode: "explicit" });
        silent = context.createGain();
        silent.gain.value = 0;
        source.connect(processor);
        processor.connect(silent);
        silent.connect(context.destination);
        processor.port.onmessage = (event) => {
          if (closed) return;
          const samples = event.data;
          const ms = samples.length / context.sampleRate * 1e3;
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          hooks.level(rms);
          if (config.input.mode === "manual") {
            if (held) {
              chunks.push(samples);
              duration += ms;
              if (duration >= config.turn.maxSpeechMs) finish();
            }
            return;
          }
          if (hooks.busy() && !config.turn.bargeIn) {
            reset();
            preRoll = [];
            preRollMs = 0;
            return;
          }
          if (!active) {
            preRoll.push(samples);
            preRollMs += ms;
            while (preRollMs > Math.max(config.turn.preRollMs, config.turn.minSpeechMs, config.turn.interruptMs) + ms) {
              preRollMs -= preRoll.shift().length / context.sampleRate * 1e3;
            }
            voiced = rms >= config.turn.threshold ? voiced + ms : 0;
            const minimum = hooks.busy() ? config.turn.interruptMs : config.turn.minSpeechMs;
            if (voiced < minimum || rms < config.turn.threshold) return;
            active = true;
            chunks = preRoll;
            duration = preRollMs;
            preRoll = [];
            preRollMs = 0;
            if (hooks.busy()) hooks.interrupt();
          } else {
            chunks.push(samples);
            duration += ms;
          }
          quiet = rms < config.turn.threshold ? quiet + ms : 0;
          if (quiet >= config.turn.silenceMs || duration >= config.turn.maxSpeechMs) finish();
        };
      },
      begin() {
        if (!context || closed) throw new Error("Start the session before recording");
        reset();
        held = true;
      },
      commit() {
        if (held || active) finish();
      },
      async close() {
        closed = true;
        reset();
        preRoll = [];
        if (processor) {
          processor.port.onmessage = null;
          processor.port.close();
          processor.disconnect();
        }
        if (source) source.disconnect();
        if (silent) silent.disconnect();
        if (stream) stream.getTracks().forEach((track) => track.stop());
        if (context && context.state !== "closed") await context.close();
      }
    };
  }

  // src/static/sdk-libs/voice/player.js
  function createPlayer(config, onAudio) {
    let context = null;
    let gain = null;
    const sources = /* @__PURE__ */ new Set();
    let next = 0;
    let tail = new Uint8Array();
    const api = {
      async open() {
        if (!context) {
          context = new AudioContext();
          gain = context.createGain();
          gain.gain.value = config.playback.volume;
          gain.connect(context.destination);
        }
        await context.resume();
      },
      async write(bytes, signal) {
        signal.throwIfAborted();
        const joined = new Uint8Array(tail.length + bytes.length);
        joined.set(tail);
        joined.set(bytes, tail.length);
        const frame = 2 * config.tts.channels;
        const count = Math.floor(joined.length / frame);
        tail = joined.slice(count * frame);
        const view = new DataView(joined.buffer);
        const block = Math.max(1, Math.floor(config.tts.sampleRate / 10));
        for (let offset = 0; offset < count; offset += block) {
          while (next - context.currentTime > config.playback.maxBufferedMs / 1e3) await delay(20, signal);
          signal.throwIfAborted();
          const frames = Math.min(block, count - offset);
          const audio = context.createBuffer(config.tts.channels, frames, config.tts.sampleRate);
          for (let channel = 0; channel < config.tts.channels; channel++) {
            const output = audio.getChannelData(channel);
            for (let i = 0; i < frames; i++) output[i] = view.getInt16(((offset + i) * config.tts.channels + channel) * 2, true) / 32768;
          }
          api.schedule(audio);
        }
      },
      schedule(audio) {
        const source = context.createBufferSource();
        source.buffer = audio;
        source.connect(gain);
        sources.add(source);
        source.onended = () => {
          sources.delete(source);
          source.disconnect();
        };
        if (next <= context.currentTime) next = context.currentTime + config.playback.bufferMs / 1e3;
        source.start(next);
        next += audio.duration;
        onAudio();
      },
      async enqueue(stream, signal) {
        tail = new Uint8Array();
        if (config.tts.format === "pcm") {
          for await (const bytes of stream) await api.write(bytes, signal);
          if (tail.length) throw new Error("Incomplete PCM frame from speech provider");
        } else {
          const parts = [];
          let size = 0;
          for await (const bytes of stream) {
            signal.throwIfAborted();
            size += bytes.length;
            if (size > 8e6) throw new Error("Speech segment exceeds 8 MB");
            parts.push(bytes);
          }
          const data = new Uint8Array(size);
          let offset = 0;
          for (const part of parts) {
            data.set(part, offset);
            offset += part.length;
          }
          const audio = await context.decodeAudioData(data.buffer);
          signal.throwIfAborted();
          api.schedule(audio);
        }
        const end = next;
        const played = (async () => {
          while (context && context.currentTime < end) await delay(10, signal);
          signal.throwIfAborted();
        })();
        void played.catch(() => {
        });
        return { played };
      },
      async play(stream, signal) {
        const queued = await api.enqueue(stream, signal);
        await queued.played;
      },
      async drain(signal) {
        while (sources.size) await delay(20, signal);
      },
      stop() {
        for (const source of sources) {
          source.stop();
          source.disconnect();
        }
        sources.clear();
        next = 0;
        tail = new Uint8Array();
      },
      async close() {
        api.stop();
        if (context) await context.close();
        context = null;
        gain = null;
      }
    };
    return api;
  }

  // src/static/sdk-libs/_core/session.js
  function getSession(libLabel) {
    const auth = window.AIMEAT && window.AIMEAT.auth;
    if (!auth) {
      throw new Error("AIMEAT.auth is required. Include aimeat-auth.js before " + (libLabel || "this library"));
    }
    const s = auth.getSession();
    if (!s) throw new Error("Not logged in. Call AIMEAT.auth.login() first.");
    return s;
  }

  // src/static/sdk-libs/_core/config.js
  function cfg() {
    return window.__AIMEAT_SDK_CFG__ || { nodeId: "", baseUrl: "" };
  }
  function resolveNodeUrl() {
    const meta = document.querySelector('meta[name="aimeat-node"]');
    if (meta) return (meta.getAttribute("content") || "").replace(/\/$/, "");
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    if (typeof self !== "undefined" && typeof self.origin === "string" && self.origin.indexOf("http") === 0) {
      return self.origin;
    }
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

  // src/static/sdk-libs/_core/spend.js
  function state() {
    const ns = namespace();
    if (!ns.__spend) {
      ns.__spend = { inflight: /* @__PURE__ */ new Map(), settled: /* @__PURE__ */ new Map(), remembered: {}, budget: null };
    }
    return ns.__spend;
  }
  function noteBudget(b) {
    if (b) state().budget = b;
  }

  // src/static/sdk-libs/voice/adapters.js
  async function request(body, path, signal) {
    const session = (
      /** @type {any} */
      getSession("aimeat-voice.js")
    );
    const send = () => fetch(NODE_URL + path, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.jwt },
      body: JSON.stringify(body)
    });
    let response = await send();
    if (response.status === 401 && session.refresh) {
      await session.refresh();
      signal.throwIfAborted();
      response = await send();
    }
    if (!response.ok) {
      const envelope = await response.json();
      throw Object.assign(new Error(envelope.error?.message || "Voice request failed"), { code: envelope.error?.code || "PROVIDER_ERROR" });
    }
    return response;
  }
  async function* events(response, emit) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let done = false;
    try {
      while (true) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, { stream: !chunk.done });
        if (pending.length > 2e6) throw new Error("Voice stream frame is too large");
        let end;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "error") throw Object.assign(new Error(event.message), { code: event.code });
          if (event.type === "done") {
            done = true;
            if (event.budget) noteBudget(event.budget);
            emit(event);
          }
          yield event;
        }
        if (chunk.done) break;
      }
      if (!done || pending.trim()) throw new Error("Voice stream ended before completion");
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  function nodeAdapters(config, emit) {
    return {
      async transcribe(blob, { signal }) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const response = await request({
          audio_base64: btoa(binary),
          mime: blob.type,
          filename: "voice.wav",
          model: config.stt.model || void 0,
          language: config.stt.language || config.language.split("-")[0],
          temperature: config.stt.temperature,
          app_id: config.appId
        }, "/v1/ai/transcribe", signal);
        const envelope = await response.json();
        if (envelope.data?.budget) noteBudget(envelope.data.budget);
        emit({ type: "usage", stage: "stt", ...envelope.data });
        return envelope.data.text;
      },
      async *complete(messages, { signal }) {
        const response = await request({
          messages,
          app_id: config.appId,
          model: config.llm.model || void 0,
          temperature: config.llm.temperature,
          top_p: config.llm.topP,
          max_tokens: config.llm.maxTokens ?? void 0,
          reasoning: config.llm.reasoning
        }, "/v1/ai/stream", signal);
        for await (const event of events(response, (e) => emit({ ...e, stage: "llm" }))) if (event.type === "text") yield event.text;
      },
      async *speak(text, { signal }) {
        const response = await request({
          input: text,
          app_id: config.appId,
          model: config.tts.model,
          voice: config.tts.voice,
          response_format: config.tts.format,
          speed: config.tts.speed,
          instructions: config.tts.instructions
        }, "/v1/ai/speak", signal);
        for await (const event of events(response, (e) => emit({ ...e, stage: "tts" }))) {
          if (event.type === "audio") yield Uint8Array.from(atob(event.data), (c) => c.charCodeAt(0));
        }
      }
    };
  }

  // src/static/sdk-libs/voice/index.js
  attach("voice", {
    version: "1.1.0",
    get defaults() {
      return structuredClone(defaults);
    },
    get presets() {
      return structuredClone(presets);
    },
    configure,
    createSession(options = {}, adapters = {}) {
      return createSession(options, adapters, { capture: createCapture, player: createPlayer, adapters: nodeAdapters });
    }
  });
})();
