// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/speech/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-speech.js (with a per-node config prelude).
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
        next = Math.max(next, context.currentTime + config.playback.bufferMs / 1e3);
        source.start(next);
        next += audio.duration;
        onAudio();
      },
      async play(stream, signal) {
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
        await api.drain(signal);
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
    chunking: { minChars: 24, maxChars: 180, maxWaitMs: 350 },
    playback: { bufferMs: 80, maxBufferedMs: 3e3, maxPendingSegments: 3, volume: 1 },
    history: { maxTurns: 12 },
    timeoutMs: 12e4
  };
  var presets = {
    balanced: {},
    responsive: { turn: { silenceMs: 450 }, chunking: { minChars: 12, maxChars: 120, maxWaitMs: 180 }, playback: { bufferMs: 40 } },
    patient: { turn: { silenceMs: 1200 }, chunking: { minChars: 50, maxChars: 240, maxWaitMs: 700 }, playback: { bufferMs: 150 } }
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

  // src/static/sdk-libs/speech/index.js
  var _listeners = {};
  function emit(event, data) {
    (_listeners[event] || []).forEach(function(fn) {
      fn(data);
    });
  }
  var _supported = {
    get tts() {
      return typeof window !== "undefined" && "speechSynthesis" in window;
    },
    get stt() {
      return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
    }
  };
  var _ttsProvider = null;
  var _sttProvider = null;
  var _speaking = false;
  var _cloudController = null;
  var _ttsQueue = [];
  var _listening = false;
  var _recognition = null;
  var _mediaRecorder = null;
  var _voicesLoaded = false;
  var _voicesList = [];
  function loadVoices() {
    if (!_supported.tts) return [];
    _voicesList = speechSynthesis.getVoices().map(function(v) {
      return { name: v.name, lang: v.lang };
    });
    _voicesLoaded = _voicesList.length > 0;
    return _voicesList;
  }
  if (typeof window !== "undefined" && _supported.tts) {
    speechSynthesis.addEventListener("voiceschanged", loadVoices);
    loadVoices();
  }
  function nativeSay(text, opts) {
    return new Promise(function(resolve) {
      const utt = new SpeechSynthesisUtterance(text);
      if (opts && opts.lang) utt.lang = opts.lang;
      if (opts && opts.rate !== void 0) utt.rate = opts.rate;
      if (opts && opts.pitch !== void 0) utt.pitch = opts.pitch;
      if (opts && opts.volume !== void 0) utt.volume = opts.volume;
      if (opts && opts.voice) {
        const voices = speechSynthesis.getVoices();
        const match = voices.find(function(v) {
          return v.name === opts.voice || v.name.indexOf(opts.voice) >= 0;
        });
        if (match) utt.voice = match;
      }
      utt.onstart = function() {
        emit("start", {});
      };
      utt.onend = function() {
        _speaking = false;
        processQueue();
        emit("end", {});
        resolve(void 0);
      };
      utt.onboundary = function(e) {
        if (e.name === "word") emit("word", { word: text.substr(e.charIndex, e.charLength || 10).split(/\s/)[0], index: e.charIndex });
      };
      utt.onerror = function(e) {
        _speaking = false;
        processQueue();
        emit("error", { error: e.error });
        resolve(void 0);
      };
      _speaking = true;
      speechSynthesis.speak(utt);
    });
  }
  async function cloudSay(text, opts) {
    if (!_ttsProvider || !_ttsProvider.say) return Promise.resolve();
    const controller = new AbortController();
    _cloudController = controller;
    const player = createPlayer(configure({ tts: { format: "mp3" } }), () => {
    });
    controller.signal.addEventListener("abort", () => player.stop(), { once: true });
    _speaking = true;
    emit("start", {});
    try {
      await player.open();
      const blob = await abortable(Promise.resolve(_ttsProvider.say(text, { ...opts, signal: controller.signal })), controller.signal);
      if (blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await player.play((async function* () {
          yield bytes;
        })(), controller.signal);
      }
    } catch (e) {
      if (!controller.signal.aborted) emit("error", { error: e.message });
    } finally {
      await player.close();
      if (_cloudController === controller) {
        _cloudController = null;
        _speaking = false;
        processQueue();
        emit("end", {});
      }
    }
  }
  function processQueue() {
    if (_ttsQueue.length > 0 && !_speaking) {
      const next = _ttsQueue.shift();
      if (next) doSay(next.text, next.opts);
    }
  }
  function doSay(text, opts) {
    if (_ttsProvider) return cloudSay(text, opts);
    if (!_supported.tts) {
      console.warn("[aimeat-speech] TTS not supported in this browser");
      return Promise.resolve();
    }
    return nativeSay(text, opts);
  }
  function nativeListen(opts) {
    return new Promise(function(resolve, reject) {
      const SpeechRecog = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecog) {
        reject(new Error("SpeechRecognition not supported"));
        return;
      }
      _recognition = new SpeechRecog();
      _recognition.lang = opts && opts.lang || "en-US";
      _recognition.continuous = opts && opts.continuous || false;
      _recognition.interimResults = opts && opts.interimResults || false;
      const commands = opts && opts.commands || null;
      _recognition.onstart = function() {
        _listening = true;
        emit("listening", {});
      };
      _recognition.onresult = function(e) {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          const text = result[0].transcript.trim();
          const final = result.isFinal;
          const confidence = result[0].confidence;
          emit("result", { text, final, confidence });
          if (final && commands) matchCommand(text, commands);
          if (final && !_recognition.continuous) {
            resolve({ text, confidence, lang: _recognition.lang });
          }
        }
      };
      _recognition.onerror = function(e) {
        _listening = false;
        emit("error", { error: e.error });
        if (!_recognition.continuous) reject(new Error(e.error));
      };
      _recognition.onend = function() {
        _listening = false;
        emit("stopped", {});
        if (opts && opts.continuous && _recognition) {
          try {
            _recognition.start();
          } catch {
          }
        }
      };
      _recognition.start();
    });
  }
  function cloudListen(opts) {
    if (!_sttProvider || !_sttProvider.listen) return Promise.reject(new Error("No STT provider configured"));
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
      return new Promise(function(resolve, reject) {
        const chunks = [];
        _mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        _listening = true;
        emit("listening", {});
        _mediaRecorder.ondataavailable = function(e) {
          if (e.data.size > 0) chunks.push(e.data);
        };
        _mediaRecorder.onstop = function() {
          _listening = false;
          stream.getTracks().forEach(function(t) {
            t.stop();
          });
          emit("stopped", {});
          const blob = new Blob(chunks, { type: "audio/webm" });
          _sttProvider.listen(blob, opts || {}).then(function(result) {
            const text = typeof result === "string" ? result : result.text || result.transcript || "";
            const confidence = typeof result === "object" ? result.confidence || 1 : 1;
            emit("result", { text, final: true, confidence });
            resolve({ text, confidence, lang: opts && opts.lang || "en-US" });
          }).catch(function(e) {
            emit("error", { error: e.message });
            reject(e);
          });
        };
        _mediaRecorder.start();
        if (!(opts && opts.continuous)) {
          setTimeout(function() {
            if (_mediaRecorder && _mediaRecorder.state === "recording") _mediaRecorder.stop();
          }, opts && opts.timeout || 5e3);
        }
      });
    });
  }
  function matchCommand(text, commands) {
    const lower = text.toLowerCase();
    Object.keys(commands).forEach(function(pattern) {
      const parts = pattern.toLowerCase().split(/\s+/);
      const regex = "^" + parts.map(function(p) {
        if (p.startsWith("*")) return "(.+)";
        return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join("\\s+") + "$";
      const match = lower.match(new RegExp(regex));
      if (match) {
        const captures = match.slice(1);
        commands[pattern].apply(null, captures);
      }
    });
  }
  var speech = {
    say: function(text, opts) {
      if (_speaking) {
        _ttsQueue.push({ text, opts });
        return;
      }
      return doSay(text, opts);
    },
    stop: function() {
      if (_supported.tts) speechSynthesis.cancel();
      if (_cloudController) _cloudController.abort();
      _cloudController = null;
      _speaking = false;
      _ttsQueue = [];
    },
    get speaking() {
      return _speaking;
    },
    voices: function(opts) {
      if (!_voicesLoaded) loadVoices();
      if (opts && opts.lang) {
        const lang = opts.lang.toLowerCase();
        return _voicesList.filter(function(v) {
          return v.lang.toLowerCase().startsWith(lang);
        });
      }
      return _voicesList;
    },
    listen: function(opts) {
      if (_sttProvider) return cloudListen(opts);
      return nativeListen(opts);
    },
    stopListening: function() {
      if (_recognition) {
        _recognition.continuous = false;
        try {
          _recognition.stop();
        } catch {
        }
        _recognition = null;
      }
      if (_mediaRecorder && _mediaRecorder.state === "recording") {
        _mediaRecorder.stop();
        _mediaRecorder = null;
      }
      _listening = false;
    },
    get listening() {
      return _listening;
    },
    get supported() {
      return _supported;
    },
    use: function(type, provider) {
      if (type === "tts") _ttsProvider = provider;
      else if (type === "stt") _sttProvider = provider;
      else console.warn("[aimeat-speech] Unknown provider type:", type);
    },
    on: function(event, fn) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(fn);
    },
    off: function(event, fn) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(function(f) {
        return f !== fn;
      });
    }
  };
  attach("speech", speech);
})();
