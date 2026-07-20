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
  function cloudSay(text, opts) {
    if (!_ttsProvider || !_ttsProvider.say) return Promise.resolve();
    _speaking = true;
    emit("start", {});
    return _ttsProvider.say(text, opts || {}).then(function(blob) {
      if (!blob) {
        _speaking = false;
        processQueue();
        emit("end", {});
        return;
      }
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      return blob.arrayBuffer().then(function(ab) {
        return ac.decodeAudioData(ab);
      }).then(function(buf) {
        const source = ac.createBufferSource();
        source.buffer = buf;
        source.connect(ac.destination);
        source.onended = function() {
          _speaking = false;
          processQueue();
          emit("end", {});
        };
        source.start();
      });
    }).catch(function(e) {
      _speaking = false;
      processQueue();
      emit("error", { error: e.message });
    });
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
