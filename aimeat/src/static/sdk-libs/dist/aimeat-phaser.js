// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/phaser/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-phaser.js (with a per-node config prelude).
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

  // src/static/sdk-libs/atelier/dom.js
  var SPECIAL = { text: 1, on: 1, vars: 1, children: 1 };
  var seq = 0;
  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "text") {
          node.textContent = String(v);
          continue;
        }
        if (k === "on") {
          for (const type in v) node.addEventListener(type, v[type]);
          continue;
        }
        if (k === "vars") {
          for (const name in v) node.style.setProperty(name, String(v[name]));
          continue;
        }
        if (SPECIAL[k]) continue;
        node.setAttribute(k, v === true ? "" : String(v));
      }
      if (attrs.children != null) append(node, attrs.children);
    }
    if (kids != null) append(node, kids);
    return node;
  }
  function append(parent, kids) {
    const list = Array.isArray(kids) ? kids : [kids];
    for (const c of list) {
      if (c == null || c === false) continue;
      parent.appendChild(typeof c === "object" ? (
        /** @type {Node} */
        c
      ) : document.createTextNode(String(c)));
    }
  }
  function $(sel, root) {
    return (
      /** @type {HTMLElement|null} */
      (root || document).querySelector(sel)
    );
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }
  function uid(prefix) {
    seq += 1;
    return (prefix || "ak") + "-" + seq;
  }
  var MOTION_KEY = "ak.motion";
  var MOTION_ATTR = "data-ak-motion";
  function reducedMotion() {
    if (typeof document !== "undefined" && document.documentElement && document.documentElement.getAttribute(MOTION_ATTR) === "less") return true;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function setMotion(mode) {
    const next = mode === "less" ? "less" : "auto";
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.setAttribute(MOTION_ATTR, next);
    }
    try {
      localStorage.setItem(MOTION_KEY, next);
    } catch {
    }
    try {
      window.dispatchEvent(new CustomEvent("ak-motion", { detail: { motion: next } }));
    } catch {
    }
    return next;
  }
  var motionRestored = false;
  function restoreMotion() {
    if (motionRestored || typeof document === "undefined" || !document.documentElement) return;
    motionRestored = true;
    try {
      const saved = localStorage.getItem(MOTION_KEY);
      if (saved === "less" || saved === "auto") document.documentElement.setAttribute(MOTION_ATTR, saved);
    } catch {
    }
  }
  restoreMotion();
  function resolve(target, fallback) {
    if (!target) return fallback || document.body;
    if (typeof target === "string") return $(target) || fallback || document.body;
    return target;
  }

  // src/static/sdk-libs/phaser/mobile.js
  var PROMPT_TITLE = "Turn your phone";
  var PROMPT_LANDSCAPE = "This game is played with the phone on its side.";
  var PROMPT_PORTRAIT = "This game is played with the phone upright.";
  var installEvent = null;
  if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", function(ev) {
      ev.preventDefault();
      installEvent = ev;
    });
    window.addEventListener("appinstalled", function() {
      installEvent = null;
    });
  }
  var ICON_ROTATE = "M7 3h6a2 2 0 0 1 2 2v6h-2V5H7v14h3v2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm12.5 9.5 2.5 3-2.5 3v-2h-4a2 2 0 0 1-2-2v-2h2v2h4v-2z";
  function icon(path) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "40");
    svg.setAttribute("height", "40");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const shape = document.createElementNS(ns, "path");
    shape.setAttribute("d", path);
    shape.setAttribute("fill", "currentColor");
    svg.appendChild(shape);
    return svg;
  }
  function mobile(handle, opts) {
    const o = opts || /** @type {MobileOptions} */
    {};
    const frame = handle && handle.frame ? handle.frame : typeof document !== "undefined" ? document.body : null;
    const doc = frame ? frame.ownerDocument || document : null;
    let dead = false;
    let wanted = "any";
    let prompt = null;
    let query = null;
    let onTurn = null;
    function buildPrompt() {
      if (prompt || !doc || !frame) return;
      prompt = doc.createElement("div");
      prompt.className = "ak-orient";
      prompt.setAttribute("role", "status");
      prompt.setAttribute("aria-live", "polite");
      const card = doc.createElement("div");
      card.className = "ak-orient__card";
      card.appendChild(icon(ICON_ROTATE));
      const title = doc.createElement("p");
      title.className = "ak-orient__title";
      title.textContent = o.title || PROMPT_TITLE;
      card.appendChild(title);
      const hint = doc.createElement("p");
      hint.className = "ak-orient__hint";
      card.appendChild(hint);
      prompt.appendChild(card);
      frame.appendChild(prompt);
    }
    function correct() {
      if (wanted === "any") return true;
      const portrait = query ? query.matches : false;
      return wanted === "portrait" ? portrait : !portrait;
    }
    function paint() {
      if (dead || !prompt) return;
      const ok = correct();
      prompt.classList.toggle("is-shown", !ok);
      const hint = prompt.querySelector(".ak-orient__hint");
      if (hint) {
        hint.textContent = o.hint || (wanted === "portrait" ? PROMPT_PORTRAIT : PROMPT_LANDSCAPE);
      }
    }
    function tryLock() {
      const screenAny = typeof screen !== "undefined" ? (
        /** @type {any} */
        screen
      ) : null;
      const api = screenAny && screenAny.orientation;
      if (!api || typeof api.lock !== "function" || wanted === "any") return;
      if (!doc || !doc.fullscreenElement) return;
      try {
        const asked = api.lock(wanted);
        if (asked && typeof asked.catch === "function") {
          asked.catch(function(err) {
            console.warn("[aimeat-phaser] the browser would not lock the orientation, so the prompt is doing the asking:", err);
          });
        }
      } catch (err) {
        console.warn("[aimeat-phaser] screen.orientation.lock was refused outright:", err);
      }
    }
    function orientation(want) {
      if (dead) return;
      wanted = want === "landscape" || want === "portrait" ? want : "any";
      buildPrompt();
      if (!query && typeof matchMedia === "function") {
        query = matchMedia("(orientation: portrait)");
        onTurn = function() {
          paint();
          tryLock();
        };
        if (typeof query.addEventListener === "function") query.addEventListener("change", onTurn);
        else if (typeof /** @type {any} */
        query.addListener === "function") {
          query.addListener(onTurn);
        }
      }
      if (wanted === "any") {
        const screenAny = typeof screen !== "undefined" ? (
          /** @type {any} */
          screen
        ) : null;
        if (screenAny && screenAny.orientation && typeof screenAny.orientation.unlock === "function") {
          try {
            screenAny.orientation.unlock();
          } catch (err) {
            console.warn("[aimeat-phaser] the orientation lock could not be released:", err);
          }
        }
      }
      paint();
      tryLock();
    }
    let gauge = null;
    function safeArea() {
      const zero = { top: 0, right: 0, bottom: 0, left: 0 };
      if (dead || !doc) return zero;
      if (!gauge) {
        gauge = doc.createElement("div");
        gauge.setAttribute("aria-hidden", "true");
        gauge.className = "ak-safe-probe";
        (doc.body || doc.documentElement).appendChild(gauge);
      }
      const style = getComputedStyle(gauge);
      const read = function(name) {
        const n = parseFloat(style.getPropertyValue(name));
        return isFinite(n) ? n : 0;
      };
      return {
        top: read("padding-top"),
        right: read("padding-right"),
        bottom: read("padding-bottom"),
        left: read("padding-left")
      };
    }
    let sentinel = null;
    let awake = false;
    let onVisible = null;
    function acquire() {
      const nav = typeof navigator !== "undefined" ? (
        /** @type {any} */
        navigator
      ) : null;
      if (!nav || !nav.wakeLock || typeof nav.wakeLock.request !== "function") {
        return Promise.resolve(false);
      }
      return nav.wakeLock.request("screen").then(
        function(got) {
          sentinel = got;
          if (got && typeof got.addEventListener === "function") {
            got.addEventListener("release", function() {
              sentinel = null;
            });
          }
          return true;
        },
        function(err) {
          console.warn("[aimeat-phaser] the screen wake lock was refused:", err);
          return false;
        }
      );
    }
    function keepAwake(on) {
      if (dead) return Promise.resolve(false);
      awake = !!on;
      if (!awake) {
        if (sentinel && typeof sentinel.release === "function") {
          try {
            sentinel.release();
          } catch (err) {
            console.warn("[aimeat-phaser] the wake lock would not release:", err);
          }
        }
        sentinel = null;
        return Promise.resolve(false);
      }
      if (!onVisible && doc) {
        onVisible = function() {
          if (dead || !awake || doc.hidden || sentinel) return;
          acquire();
        };
        doc.addEventListener("visibilitychange", onVisible);
      }
      return acquire();
    }
    function install() {
      return {
        canInstall: !!installEvent,
        prompt() {
          const ev = installEvent;
          if (!ev || typeof ev.prompt !== "function") {
            return Promise.resolve(
              /** @type {'unavailable'} */
              "unavailable"
            );
          }
          installEvent = null;
          try {
            ev.prompt();
          } catch (err) {
            console.warn("[aimeat-phaser] the install prompt was refused:", err);
            return Promise.resolve(
              /** @type {'unavailable'} */
              "unavailable"
            );
          }
          return Promise.resolve(ev.userChoice).then(
            function(choice) {
              return choice && choice.outcome === "accepted" ? "accepted" : "dismissed";
            },
            function(err) {
              console.warn("[aimeat-phaser] the install prompt gave no answer:", err);
              return "dismissed";
            }
          );
        }
      };
    }
    function vibrate(ms2) {
      const n = typeof ms2 === "number" && isFinite(ms2) ? Math.max(1, Math.min(1e3, ms2)) : 20;
      if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
      try {
        return !!navigator.vibrate(n);
      } catch (err) {
        console.warn("[aimeat-phaser] vibrate was refused:", err);
        return false;
      }
    }
    function destroy() {
      if (dead) return;
      dead = true;
      if (query && onTurn) {
        if (typeof query.removeEventListener === "function") query.removeEventListener("change", onTurn);
        else if (typeof /** @type {any} */
        query.removeListener === "function") {
          query.removeListener(onTurn);
        }
      }
      query = null;
      onTurn = null;
      if (onVisible && doc) doc.removeEventListener("visibilitychange", onVisible);
      onVisible = null;
      awake = false;
      if (sentinel && typeof sentinel.release === "function") {
        try {
          sentinel.release();
        } catch (err) {
          console.warn("[aimeat-phaser] the wake lock would not release on the way out:", err);
        }
      }
      sentinel = null;
      if (prompt && prompt.parentNode) prompt.parentNode.removeChild(prompt);
      prompt = null;
      if (gauge && gauge.parentNode) gauge.parentNode.removeChild(gauge);
      gauge = null;
    }
    if (o.orientation) orientation(o.orientation);
    if (o.keepAwake) keepAwake(true);
    return {
      orientation,
      safeArea,
      keepAwake,
      install,
      vibrate,
      destroy
    };
  }

  // src/static/sdk-libs/phaser/boot.js
  var PHASER_URL = "/lib/phaser@4.min.js";
  var phaserPromise = null;
  function phaserGlobal() {
    return (
      /** @type {any} */
      window.Phaser
    );
  }
  function ensurePhaser() {
    const already = phaserGlobal();
    if (already && already.Game) return Promise.resolve(already);
    if (phaserPromise) return phaserPromise;
    phaserPromise = new Promise(function(ok, fail) {
      const src = NODE_URL + PHASER_URL;
      const tag = document.createElement("script");
      tag.src = src;
      tag.async = true;
      tag.onload = function() {
        const P = phaserGlobal();
        if (P && P.Game) {
          ok(P);
          return;
        }
        phaserPromise = null;
        fail(new Error("The game engine loaded from " + src + " but left no Phaser on the page."));
      };
      tag.onerror = function() {
        phaserPromise = null;
        fail(new Error("The game engine could not be loaded from " + src + ". This node serves it; check that the address is reachable from where the page is running."));
      };
      document.head.appendChild(tag);
    });
    return phaserPromise;
  }
  var COLOUR_TOKENS = {
    bg: "--ak-bg",
    surface: "--ak-surface",
    ink: "--ak-ink",
    inkDim: "--ak-ink-dim",
    accent: "--ak-accent",
    ok: "--ak-ok",
    warn: "--ak-warn",
    err: "--ak-err",
    line: "--ak-line",
    ch1: "--ak-crt-ch1",
    ch2: "--ak-crt-ch2",
    ch3: "--ak-crt-ch3",
    ch4: "--ak-crt-ch4"
  };
  var NO_KIT = {
    bg: 15988216,
    surface: 16777215,
    ink: 1382945,
    inkDim: 6316904,
    accent: 15226442,
    ok: 1014341,
    warn: 9065216,
    err: 11740702,
    line: 14146788,
    ch1: 2418175,
    ch2: 16723610,
    ch3: 16769357,
    ch4: 3732128
  };
  var TEXT_TOKENS = {
    font: ["--ak-font", "ui-sans-serif, system-ui, sans-serif"],
    fontDisplay: ["--ak-font-display", "ui-sans-serif, system-ui, sans-serif"],
    fontMono: ["--ak-font-mono", "ui-monospace, SFMono-Regular, Menlo, monospace"],
    ease: ["--ak-ease", "cubic-bezier(0.2, 0.7, 0.3, 1)"]
  };
  var MOTION_FALLBACK = 200;
  var pad = null;
  function padContext() {
    if (pad) return pad;
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    pad = canvas.getContext("2d", { willReadFrequently: true });
    return pad;
  }
  function toColour(value, fallback) {
    const ctx = padContext();
    if (!ctx || !value) return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "transparent";
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const px = ctx.getImageData(0, 0, 1, 1).data;
    if (px[3] === 0) return fallback;
    return px[0] << 16 | px[1] << 8 | px[2];
  }
  function tokenHost(host) {
    const node = host && host.nodeType === 1 ? host : document.body;
    if (node.tagName === "CANVAS" && node.parentElement) return node.parentElement;
    return node;
  }
  function readColours(node) {
    const style = getComputedStyle(node);
    const names = Object.keys(COLOUR_TOKENS);
    const pen2 = document.createElement("div");
    pen2.setAttribute("aria-hidden", "true");
    pen2.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
    const probes = [];
    const declared = [];
    for (const name of names) {
      const token = COLOUR_TOKENS[name];
      const has = (style.getPropertyValue(token) || "").trim() !== "";
      const probe = document.createElement("span");
      if (has) probe.style.color = "var(" + token + ")";
      pen2.appendChild(probe);
      probes.push(probe);
      declared.push(has);
    }
    node.appendChild(pen2);
    const out = {};
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      out[name] = declared[i] ? toColour(getComputedStyle(probes[i]).color, NO_KIT[name]) : NO_KIT[name];
    }
    pen2.remove();
    return out;
  }
  function theme(host) {
    const node = tokenHost(host);
    const style = getComputedStyle(node);
    const out = (
      /** @type {any} */
      readColours(node)
    );
    for (const name in TEXT_TOKENS) {
      const pair = TEXT_TOKENS[name];
      out[name] = (style.getPropertyValue(pair[0]) || "").trim() || pair[1];
    }
    out.motion = parseFloat(style.getPropertyValue("--ak-motion")) || MOTION_FALLBACK;
    return (
      /** @type {PhaserTheme} */
      out
    );
  }
  function hex(value) {
    const n = Math.max(0, Math.min(16777215, Math.round(value || 0)));
    return "#" + ("000000" + n.toString(16)).slice(-6);
  }
  theme.css = function(host) {
    const look2 = theme(host);
    const out = {
      font: look2.font,
      fontDisplay: look2.fontDisplay,
      fontMono: look2.fontMono,
      ease: look2.ease,
      motion: look2.motion + "ms"
    };
    for (const name in COLOUR_TOKENS) out[name] = hex(look2[name]);
    return out;
  };
  var ICON_ENTER = "M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z";
  var ICON_LEAVE = "M9 4h2v5H6V7h3V4zm4 0h2v3h3v2h-5V4zM6 15h5v5H9v-3H6v-2zm7 0h5v2h-3v3h-2v-5z";
  function icon2(path) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const shape = document.createElementNS(ns, "path");
    shape.setAttribute("d", path);
    shape.setAttribute("fill", "currentColor");
    svg.appendChild(shape);
    return svg;
  }
  function resolveParent(target) {
    if (!target) return document.body;
    if (typeof target === "string") return document.querySelector(target) || document.body;
    return target;
  }
  function groundColour(look2, want) {
    if (typeof want === "number") return want;
    if (want === "surface") return look2.surface;
    if (want === "ink") return look2.ink;
    return look2.bg;
  }
  function game(spec) {
    const s = spec || /** @type {GameSpec} */
    {};
    return ensurePhaser().then(function(Phaser) {
      const parent = resolveParent(s.parent);
      const width = s.width || 960;
      const height = s.height || 540;
      const mode = s.scale === "resize" ? "resize" : s.scale === "fixed" ? "fixed" : "fit";
      const frame = el("div", { class: "ak-phaser ak-phaser--" + mode });
      if (mode === "fit") frame.style.setProperty("--ak-phaser-ratio", width + " / " + height);
      parent.appendChild(frame);
      const look2 = theme(frame);
      const scaleMode = mode === "resize" ? Phaser.Scale.RESIZE : mode === "fixed" ? Phaser.Scale.NONE : Phaser.Scale.FIT;
      const config = {
        type: Phaser.AUTO,
        parent: frame,
        width,
        height,
        backgroundColor: groundColour(look2, s.background),
        transparent: !!s.transparent,
        pixelArt: !!s.pixelArt,
        // The gamepad plugin is off in Phaser unless asked; controls() reads it, so it is on here.
        input: { gamepad: s.gamepad !== false },
        scale: {
          mode: scaleMode,
          autoCenter: mode === "fit" ? Phaser.Scale.CENTER_BOTH : Phaser.Scale.NO_CENTER,
          width,
          height,
          // The FRAME goes full screen, not the canvas: a DOM overlay an app draws inside the frame
          // travels with it. Phaser only moves the canvas when it had to invent a target itself,
          // and the canvas is already in here, so nothing is reparented.
          fullscreenTarget: frame
        },
        scene: s.scenes || []
      };
      if (s.physics !== null) {
        const gravity = s.gravity || { y: 0 };
        config.physics = s.physics === "matter" ? { default: "matter", matter: { gravity } } : { default: "arcade", arcade: { gravity } };
      }
      if (s.fps) config.fps = { target: s.fps };
      const g = new Phaser.Game(config);
      return whenReady(g).then(function() {
        const handle = wire(g, frame, parent, look2, mode, s);
        if (s.onReady) s.onReady(g);
        return handle;
      });
    });
  }
  function whenReady(g) {
    if (g.isRunning) return Promise.resolve(g);
    return new Promise(function(ok) {
      g.events.once("ready", function() {
        ok(g);
      });
    });
  }
  function wire(g, frame, parent, look2, mode, s) {
    let destroyed = false;
    const enterLabel = s.fullscreenLabel || "Full screen";
    const leaveLabel = s.exitFullscreenLabel || "Leave full screen";
    let button = null;
    const onFullscreenChange = function() {
      if (!button) return;
      const inside = !!g.scale.isFullscreen;
      const label = inside ? leaveLabel : enterLabel;
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      clear(button);
      button.appendChild(icon2(inside ? ICON_LEAVE : ICON_ENTER));
    };
    if (s.fullscreen === "button") {
      button = el("button", {
        type: "button",
        class: "ak-phaser__full",
        "aria-label": enterLabel,
        title: enterLabel,
        on: {
          click: function() {
            if (g.scale.isFullscreen) g.scale.stopFullscreen();
            else g.scale.startFullscreen();
          }
        }
      }, icon2(ICON_ENTER));
      frame.appendChild(button);
      g.scale.on("enterfullscreen", onFullscreenChange);
      g.scale.on("leavefullscreen", onFullscreenChange);
    }
    let observer = null;
    const onBox = function() {
      if (destroyed || mode !== "resize") return;
      const box = frame.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      g.scale.getParentBounds();
      g.scale.refresh();
    };
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(onBox);
      observer.observe(parent);
      observer.observe(frame);
    }
    const pauseOnHide = s.pauseOnHide !== false;
    const onVisibility = function() {
      if (destroyed) return;
      if (document.hidden) g.loop.sleep();
      else g.loop.wake();
    };
    if (pauseOnHide) document.addEventListener("visibilitychange", onVisibility);
    let phone = null;
    if (s.mobile) {
      phone = mobile({ frame, game: g }, {
        orientation: s.mobile.orientation,
        keepAwake: s.mobile.keepAwake
      });
    }
    const handle = {
      game: g,
      frame,
      theme: look2,
      /**
       * Ask for full screen on the frame. Resolves when the browser grants it, rejects with words
       * when it refuses — which it does when the call did not come from a real gesture.
       * @returns {Promise<boolean>}
       */
      fullscreen() {
        if (g.scale.isFullscreen) return Promise.resolve(true);
        return new Promise(function(ok, fail) {
          const stop = function() {
            g.scale.off("enterfullscreen", granted);
            g.scale.off("fullscreenunsupported", refused);
            g.scale.off("fullscreenfailed", refused);
          };
          const granted = function() {
            stop();
            ok(true);
          };
          const refused = function() {
            stop();
            fail(new Error("The browser refused full screen for the game frame. It grants it only from a click, a key or a tap the person made."));
          };
          g.scale.once("enterfullscreen", granted);
          g.scale.once("fullscreenunsupported", refused);
          g.scale.once("fullscreenfailed", refused);
          g.scale.startFullscreen();
        });
      },
      exitFullscreen() {
        if (g.scale.isFullscreen) g.scale.stopFullscreen();
      },
      isFullscreen() {
        return !!(g.scale && g.scale.isFullscreen);
      },
      /**
       * Change the design size. In 'resize' mode the box decides and this is ignored; in 'fit' mode
       * the frame's aspect ratio follows the new size.
       * @param {number} w
       * @param {number} h
       */
      resize(w, h) {
        if (destroyed || mode === "resize" || !w || !h) return;
        g.scale.resize(w, h);
        if (mode === "fit") frame.style.setProperty("--ak-phaser-ratio", w + " / " + h);
      },
      size() {
        const box = g.scale.gameSize;
        return { width: box.width, height: box.height };
      },
      sleep() {
        g.loop.sleep();
      },
      wake() {
        g.loop.wake();
      },
      reducedMotion,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        if (observer) observer.disconnect();
        if (pauseOnHide) document.removeEventListener("visibilitychange", onVisibility);
        if (button) {
          g.scale.off("enterfullscreen", onFullscreenChange);
          g.scale.off("leavefullscreen", onFullscreenChange);
        }
        if (phone) {
          phone.destroy();
          phone = null;
        }
        g.destroy(true);
        if (frame.parentNode) frame.parentNode.removeChild(frame);
      }
    };
    if (phone) handle.mobile = phone;
    return handle;
  }

  // src/static/sdk-libs/phaser/assets.js
  function address(url, base, id, key) {
    if (typeof url !== "string" || !url.trim()) return null;
    if (url.slice(0, 5).toLowerCase() === "data:") {
      console.warn('[aimeat-phaser] pack "' + id + '" entry "' + key + '" is a data: URI and was dropped. Serve the file (/v1/pub/<owner>/… or storage) and give the pack its address: a base64 blob is carried in the page on every single load.');
      return null;
    }
    return new URL(url, base).href;
  }
  function urlMap(src, base, id) {
    if (!src) return void 0;
    const out = {};
    for (const key in src) {
      const url = address(src[key], base, id, key);
      if (url) out[key] = url;
    }
    return Object.freeze(out);
  }
  function entryMap(src, base, id, fields) {
    if (!src) return void 0;
    const out = {};
    for (const key in src) {
      const from = src[key];
      if (!from) continue;
      const entry = {};
      let ok = true;
      for (const name in from) entry[name] = from[name];
      for (const field of fields) {
        const url = address(from[field], base, id, key);
        if (!url) {
          ok = false;
          break;
        }
        entry[field] = url;
      }
      if (ok) out[key] = Object.freeze(entry);
    }
    return Object.freeze(out);
  }
  function audioMap(src, base, id) {
    if (!src) return void 0;
    const out = {};
    for (const key in src) {
      const from = src[key];
      const list = Array.isArray(from) ? from : [from];
      const urls = [];
      for (const one of list) {
        const url = address(one, base, id, key);
        if (url) urls.push(url);
      }
      if (urls.length) out[key] = /** @type {string[]} */
      Object.freeze(urls);
    }
    return Object.freeze(out);
  }
  function pack(spec) {
    const s = spec || /** @type {PackSpec} */
    {};
    const id = s.id || "pack";
    const base = new URL(s.base || ".", location.href).href;
    return Object.freeze({
      id,
      base,
      images: urlMap(s.images, base, id),
      spritesheets: entryMap(s.spritesheets, base, id, ["url"]),
      atlases: entryMap(s.atlases, base, id, ["texture", "data"]),
      audio: audioMap(s.audio, base, id),
      tilemaps: urlMap(s.tilemaps, base, id),
      json: urlMap(s.json, base, id),
      bitmapFonts: entryMap(s.bitmapFonts, base, id, ["texture", "data"])
    });
  }
  function fromLibrary(lib) {
    if (!lib || typeof lib.toPack !== "function") {
      throw new Error("fromLibrary() takes an aimeat-assets library: the object with toPack(), url() and t() that AIMEAT.assets.library({ app }) hands back. Await it first, or pass the promise straight to preloadPack(), which waits for it.");
    }
    return pack(lib.toPack());
  }
  function isLibrary(value) {
    return !!value && typeof value.toPack === "function";
  }
  function isThenable(value) {
    return !!value && typeof value.then === "function";
  }
  function loadingStatus() {
    const P = (
      /** @type {any} */
      window.Phaser
    );
    return P && P.Scenes && typeof P.Scenes.LOADING === "number" ? P.Scenes.LOADING : 3;
  }
  function register(loader, manifest, keys) {
    let count = 0;
    const put = function(key) {
      keys.add(key);
      count++;
    };
    const images = manifest.images || {};
    for (const key in images) {
      loader.image(key, images[key]);
      put(key);
    }
    const sheets = manifest.spritesheets || {};
    for (const key in sheets) {
      const sheet = sheets[key];
      loader.spritesheet(key, sheet.url, { frameWidth: sheet.frameWidth, frameHeight: sheet.frameHeight });
      put(key);
    }
    const atlases = manifest.atlases || {};
    for (const key in atlases) {
      loader.atlas(key, atlases[key].texture, atlases[key].data);
      put(key);
    }
    const sounds = manifest.audio || {};
    for (const key in sounds) {
      loader.audio(key, sounds[key]);
      put(key);
    }
    const maps = manifest.tilemaps || {};
    for (const key in maps) {
      loader.tilemapTiledJSON(key, maps[key]);
      put(key);
    }
    const blobs = manifest.json || {};
    for (const key in blobs) {
      loader.json(key, blobs[key]);
      put(key);
    }
    const fonts = manifest.bitmapFonts || {};
    for (const key in fonts) {
      loader.bitmapFont(key, fonts[key].texture, fonts[key].data);
      put(key);
    }
    return count;
  }
  function progressBar(scene, look2, place) {
    const gameWidth = scene.scale.width;
    const gameHeight = scene.scale.height;
    const width = place.width || Math.min(360, Math.round(gameWidth * 0.6));
    const height = 14;
    const radius = 7;
    const left = place.x != null ? place.x : Math.round((gameWidth - width) / 2);
    const top = place.y != null ? place.y : Math.round((gameHeight - height) / 2);
    const shape = scene.add.graphics();
    shape.setDepth(9999).setScrollFactor(0);
    const label = scene.add.text(left, top + height + 8, "", {
      fontFamily: look2.fontMono,
      fontSize: "12px",
      color: hex(look2.inkDim)
    });
    label.setDepth(9999).setScrollFactor(0);
    return {
      set(p, name) {
        const done = Math.max(0, Math.min(1, p || 0));
        shape.clear();
        shape.fillStyle(look2.surface, 1).fillRoundedRect(left, top, width, height, radius);
        shape.lineStyle(1, look2.line, 1).strokeRoundedRect(left, top, width, height, radius);
        const filled = Math.round(width * done);
        if (filled > 2) {
          shape.fillStyle(look2.accent, 1).fillRoundedRect(left, top, filled, height, Math.min(radius, filled / 2));
        }
        label.setText(Math.round(done * 100) + "%" + (name ? "  " + name : ""));
      },
      destroy() {
        shape.destroy();
        label.destroy();
      }
    };
  }
  function preloadPack(scene, packOrPacks, opts) {
    const o = opts || /** @type {PreloadOptions} */
    {};
    const given = Array.isArray(packOrPacks) ? packOrPacks : [packOrPacks];
    if (given.some(isThenable)) {
      return Promise.all(given).then(function(settled) {
        return preloadPack(scene, settled, o);
      });
    }
    const manifests = given.map(function(entry) {
      return isLibrary(entry) ? fromLibrary(entry) : entry;
    });
    const loader = scene.load;
    const mine = /* @__PURE__ */ new Set();
    let queued = 0;
    for (const manifest of manifests) {
      if (manifest) queued += register(loader, manifest, mine);
    }
    const failed = [];
    const loaded = [];
    if (!queued) return Promise.resolve({ loaded, failed });
    const look2 = o.theme || theme(scene.game.canvas);
    const bar = o.bar === false ? null : progressBar(scene, look2, o.bar || {});
    if (bar) bar.set(0, "");
    return new Promise(function(ok) {
      let last = "";
      const onFileProgress = function(file, value) {
        last = file && file.key || "";
        if (o.onProgress) o.onProgress(loader.progress, last);
        if (bar) bar.set(loader.progress, last);
        void value;
      };
      const onProgress = function(value) {
        if (o.onProgress) o.onProgress(value, last);
        if (bar) bar.set(value, last);
      };
      const onFileDone = function(key) {
        if (mine.has(key)) loaded.push(key);
      };
      const onError = function(file) {
        const entry = {
          key: file && file.key || "",
          url: file && file.url || "",
          type: file && file.type || ""
        };
        if (!mine.has(entry.key)) return;
        failed.push(entry);
        if (o.onFail) o.onFail(entry);
        console.warn('[aimeat-phaser] "' + entry.key + '" did not load from ' + entry.url + ". The rest of the pack keeps loading.");
      };
      const onComplete = function() {
        loader.off("fileprogress", onFileProgress);
        loader.off("progress", onProgress);
        loader.off("filecomplete", onFileDone);
        loader.off("loaderror", onError);
        loader.off("complete", onComplete);
        if (bar) bar.destroy();
        ok({ loaded, failed });
      };
      loader.on("fileprogress", onFileProgress);
      loader.on("progress", onProgress);
      loader.on("filecomplete", onFileDone);
      loader.on("loaderror", onError);
      loader.on("complete", onComplete);
      const status = scene.sys && scene.sys.settings ? scene.sys.settings.status : null;
      const managerWillStart = typeof status === "number" && status < loadingStatus();
      if (!managerWillStart && !loader.isLoading()) loader.start();
    });
  }
  function shade(colour, amount) {
    const end = amount >= 0 ? 255 : 0;
    const k = Math.min(1, Math.abs(amount));
    const mix = function(c) {
      return Math.round(c + (end - c) * k);
    };
    const r = mix(colour >> 16 & 255);
    const g = mix(colour >> 8 & 255);
    const b = mix(colour & 255);
    return r << 16 | g << 8 | b;
  }
  function pen(scene) {
    return scene.make.graphics({ add: false });
  }
  function shapes(scene, list) {
    const look2 = theme(scene.game.canvas);
    const made = [];
    for (const item of list || []) {
      if (!item || !item.key || typeof item.draw !== "function") continue;
      made.push(item.key);
      if (scene.textures.exists(item.key)) continue;
      const g = pen(scene);
      item.draw(g, look2);
      g.generateTexture(item.key, item.width || 32, item.height || 32);
      g.destroy();
    }
    return made;
  }
  var TILE_COLOUR = {
    ground: "line",
    brick: "warn",
    spike: "err",
    coin: "ch3",
    goal: "ok",
    water: "ch1",
    crate: "warn"
  };
  function drawTile(g, kind, colour, size, look2) {
    const lit = shade(colour, 0.32);
    const dark = shade(colour, -0.3);
    const edge = Math.max(2, Math.round(size / 8));
    if (kind === "spike") {
      g.fillStyle(dark, 1).fillRect(0, size - edge, size, edge);
      const teeth = 3;
      const step = size / teeth;
      for (let i = 0; i < teeth; i++) {
        const x = i * step;
        g.fillStyle(colour, 1).fillTriangle(x, size - edge, x + step / 2, edge / 2, x + step, size - edge);
        g.fillStyle(lit, 1).fillTriangle(x, size - edge, x + step / 2, edge / 2, x + step / 2, size - edge);
      }
      return;
    }
    if (kind === "coin") {
      const r = size / 2 - edge / 2;
      g.fillStyle(dark, 1).fillCircle(size / 2, size / 2, r);
      g.fillStyle(colour, 1).fillCircle(size / 2, size / 2, r - edge / 2);
      g.fillStyle(lit, 1).fillCircle(size / 2 - r / 4, size / 2 - r / 4, r / 3);
      return;
    }
    if (kind === "goal") {
      const poleWidth = Math.max(2, Math.round(size / 10));
      g.fillStyle(look2.inkDim, 1).fillRect(edge, 0, poleWidth, size);
      g.fillStyle(colour, 1).fillTriangle(edge + poleWidth, edge, size - edge, size / 3, edge + poleWidth, size * 0.6);
      return;
    }
    if (kind === "brick") {
      g.fillStyle(colour, 1).fillRect(0, 0, size, size);
      g.fillStyle(dark, 1);
      g.fillRect(0, size / 2 - 1, size, 2);
      g.fillRect(size / 2 - 1, 0, 2, size / 2);
      g.fillRect(size / 4 - 1, size / 2, 2, size / 2);
      g.fillRect(size * 3 / 4 - 1, size / 2, 2, size / 2);
      g.fillStyle(lit, 1).fillRect(0, 0, size, 2);
      return;
    }
    g.fillStyle(colour, 1).fillRect(0, 0, size, size);
    g.fillStyle(lit, 1).fillRect(0, 0, size, edge);
    g.fillStyle(dark, 1).fillRect(0, size - Math.round(edge / 2), size, Math.round(edge / 2));
  }
  function tiles(scene, spec) {
    const s = spec || {};
    const look2 = theme(scene.game.canvas);
    const size = s.size || 32;
    const prefix = s.prefix != null ? s.prefix : "tile-";
    const kinds = s.kinds || { ground: true, brick: true, spike: true, coin: true, goal: true, enemy: true };
    const made = [];
    for (const kind in kinds) {
      const key = prefix + kind;
      made.push(key);
      if (scene.textures.exists(key)) continue;
      const asked = kinds[kind];
      const token = TILE_COLOUR[kind] || "accent";
      const colour = typeof asked === "number" ? asked : look2[token];
      const g = pen(scene);
      drawTile(g, kind, colour, size, look2);
      g.generateTexture(key, size, size);
      g.destroy();
    }
    return made;
  }
  var HERO_FRAMES = 6;
  function drawHero(g, index, left, w, h, pal) {
    const running = index >= 1 && index <= 4;
    const jumping = index === 5;
    const step = running ? index - 1 : 0;
    const swing = running ? [1, 0, -1, 0][step] : 0;
    const bob = running ? [0, -1, 0, -1][step] : 0;
    const bodyW = Math.round(w * 0.6);
    const bodyH = Math.round(h * 0.5);
    const bodyX = left + Math.round((w - bodyW) / 2);
    const bodyY = Math.round(h * 0.16) + bob;
    const radius = Math.round(bodyW * 0.26);
    const legW = Math.max(3, Math.round(bodyW * 0.24));
    const legH = Math.round(h * 0.26);
    const legTop = bodyY + bodyH - 2;
    const legLeft = bodyX + Math.round(bodyW * 0.13);
    const legRight = bodyX + bodyW - Math.round(bodyW * 0.13) - legW;
    const reach = Math.max(2, Math.round(legH * 0.3));
    g.fillStyle(pal.trim, 1);
    if (jumping) {
      g.fillRect(legLeft, legTop, legW, legH - reach);
      g.fillRect(legRight, legTop, legW, legH - Math.round(reach / 2));
    } else {
      g.fillRect(legLeft, legTop, legW, legH + swing * reach);
      g.fillRect(legRight, legTop, legW, legH - swing * reach);
    }
    g.fillStyle(pal.body, 1).fillRoundedRect(bodyX, bodyY, bodyW, bodyH, radius);
    const visorH = Math.max(3, Math.round(bodyH * 0.26));
    g.fillStyle(pal.visor, 1).fillRoundedRect(
      bodyX + Math.round(bodyW * 0.16),
      bodyY + Math.round(bodyH * 0.18),
      Math.round(bodyW * 0.68),
      visorH,
      Math.round(visorH / 2)
    );
    const armW = Math.max(3, Math.round(bodyW * 0.22));
    const armH = Math.max(3, Math.round(bodyH * 0.26));
    const armY = bodyY + Math.round(bodyH * 0.5) - (jumping ? Math.round(bodyH * 0.3) : swing * Math.round(bodyH * 0.16));
    g.fillStyle(pal.trim, 1).fillRect(bodyX - Math.round(armW / 2), armY, armW, armH);
  }
  function character(scene, spec) {
    const s = spec || {};
    const look2 = theme(scene.game.canvas);
    const key = s.key || "hero";
    const w = s.width || 32;
    const h = s.height || 40;
    const asked = s.palette || {};
    const body = typeof asked.body === "number" ? asked.body : look2.accent;
    const pal = {
      body,
      visor: typeof asked.visor === "number" ? asked.visor : look2.ink,
      trim: typeof asked.trim === "number" ? asked.trim : shade(body, -0.34)
    };
    const names = {
      idle: key + "-idle",
      run: key + "-run",
      jump: key + "-jump"
    };
    if (!scene.textures.exists(key)) {
      const g = pen(scene);
      for (let i = 0; i < HERO_FRAMES; i++) drawHero(g, i, i * w, w, h, pal);
      g.generateTexture(key, w * HERO_FRAMES, h);
      g.destroy();
      const texture = scene.textures.get(key);
      for (let i = 0; i < HERO_FRAMES; i++) texture.add(i, 0, i * w, 0, w, h);
    }
    if (!scene.anims.exists(names.idle)) {
      scene.anims.create({ key: names.idle, frames: [{ key, frame: 0 }], frameRate: 1 });
    }
    if (!scene.anims.exists(names.run)) {
      scene.anims.create({
        key: names.run,
        frames: [1, 2, 3, 4].map(function(f) {
          return { key, frame: f };
        }),
        frameRate: 10,
        repeat: -1
      });
    }
    if (!scene.anims.exists(names.jump)) {
      scene.anims.create({ key: names.jump, frames: [{ key, frame: 5 }], frameRate: 1 });
    }
    return { key, frames: HERO_FRAMES, anims: names };
  }
  var textures = { shapes, tiles, character };

  // src/static/sdk-libs/phaser/audio.js
  function clamp01(v) {
    const n = typeof v === "number" && isFinite(v) ? v : 0;
    return Math.max(0, Math.min(1, n));
  }
  var VOICES = {
    beep: { type: "square", gain: 0.18, steps: [[660, 0.09]] },
    jump: { type: "square", gain: 0.2, steps: [[320, 0.06], [640, 0.1]] },
    coin: { type: "square", gain: 0.16, steps: [[880, 0.05], [1320, 0.12]] },
    hit: { type: "sawtooth", gain: 0.22, steps: [[180, 0.14]] },
    select: { type: "triangle", gain: 0.15, steps: [[520, 0.05], [780, 0.06]] },
    win: { type: "triangle", gain: 0.18, steps: [[523, 0.1], [659, 0.1], [784, 0.2]] }
  };
  var SILENCE = 1e-4;
  function audio(game2, opts) {
    const o = opts || {};
    const state = {
      master: o.master != null ? clamp01(o.master) : 1,
      music: o.music != null ? clamp01(o.music) : 0.6,
      sfx: o.sfx != null ? clamp01(o.sfx) : 1,
      muted: !!o.muted
    };
    const ramps = /* @__PURE__ */ new Set();
    let current = null;
    const tracks = /* @__PURE__ */ new Set();
    let gone = false;
    game2.sound.volume = state.master;
    game2.sound.mute = state.muted;
    function ramp(sound, to, ms2, done) {
      const from = typeof sound.volume === "number" ? sound.volume : 0;
      if (!ms2 || ms2 <= 0 || typeof requestAnimationFrame !== "function") {
        sound.setVolume(to);
        if (done) done();
        return;
      }
      const started = performance.now();
      const stop = { cancelled: false };
      ramps.add(stop);
      const tick = function(now) {
        if (stop.cancelled || gone) {
          ramps.delete(stop);
          return;
        }
        const p = Math.min(1, (now - started) / ms2);
        sound.setVolume(from + (to - from) * p);
        if (p < 1) {
          requestAnimationFrame(tick);
          return;
        }
        ramps.delete(stop);
        if (done) done();
      };
      requestAnimationFrame(tick);
    }
    function retire(sound, fade) {
      ramp(sound, 0, fade, function() {
        sound.stop();
        sound.destroy();
        tracks.delete(sound);
      });
    }
    function known(key) {
      return !!(game2.cache && game2.cache.audio && game2.cache.audio.exists(key));
    }
    const bus = {
      /**
       * The master level, which is Phaser's own game volume. Called with no argument it reports.
       * @param {number} [v] 0..1
       * @returns {number}
       */
      master(v) {
        if (v != null) {
          state.master = clamp01(v);
          game2.sound.volume = state.master;
        }
        return state.master;
      },
      /**
       * The music channel. Setting it moves the track that is playing; a track fading out is left
       * to finish its fade, because catching it mid-fade would make the change audible as a jump.
       * @param {number} [v] 0..1
       * @returns {number}
       */
      music(v) {
        if (v != null) {
          state.music = clamp01(v);
          if (current && current.isPlaying) current.setVolume(state.music);
        }
        return state.music;
      },
      /**
       * The effects channel. It applies to every play() from here on; a sound already ringing keeps
       * the level it started at.
       * @param {number} [v] 0..1
       * @returns {number}
       */
      sfx(v) {
        if (v != null) state.sfx = clamp01(v);
        return state.sfx;
      },
      /**
       * @param {boolean} [on]
       * @returns {boolean} whether the game is muted now
       */
      mute(on) {
        if (on != null) {
          state.muted = !!on;
          game2.sound.mute = state.muted;
        }
        return state.muted;
      },
      /**
       * Play one effect, on the effects channel. Returns false rather than queueing when the
       * browser has not been unlocked yet, or when nothing loaded under that key.
       * @param {string} key
       * @param {any} [options]  a Phaser sound config; `volume` here is a multiplier on the channel
       * @returns {boolean}
       */
      play(key, options) {
        if (gone || game2.sound.locked) return false;
        if (!known(key)) {
          console.warn('[aimeat-phaser] no sound is loaded under "' + key + '", so nothing played.');
          return false;
        }
        const p = options || {};
        const config = {};
        for (const name in p) config[name] = p[name];
        config.volume = clamp01(state.sfx * (p.volume != null ? p.volume : 1));
        return game2.sound.play(key, config) !== false;
      },
      /**
       * Play a music track, crossfading out of whatever was playing. The new track comes up from
       * silence and the old one goes down to it over the same span, so the two never add up to a
       * moment twice as loud.
       * @param {string} key
       * @param {{ loop?: boolean, fade?: number, volume?: number }} [options]
       * @returns {any|null} the Phaser sound, or null when it could not start
       */
      playMusic(key, options) {
        if (gone) return null;
        const p = options || {};
        const fade = p.fade != null ? p.fade : 400;
        if (game2.sound.locked) {
          console.warn("[aimeat-phaser] music waits for a gesture: call unlock() from a click, a tap or a key press, then start the track.");
          return null;
        }
        if (!known(key)) {
          console.warn('[aimeat-phaser] no music is loaded under "' + key + '", so nothing played.');
          return null;
        }
        const target = clamp01(state.music * (p.volume != null ? p.volume : 1));
        const next = game2.sound.add(key, { loop: p.loop !== false, volume: 0 });
        tracks.add(next);
        next.play();
        ramp(next, target, fade);
        const previous = current;
        current = next;
        if (previous) retire(previous, fade);
        return next;
      },
      /**
       * Fade the music out and let it go.
       * @param {number} [fade]  milliseconds, default 300
       * @returns {void}
       */
      stopMusic(fade) {
        const previous = current;
        current = null;
        if (previous) retire(previous, fade != null ? fade : 300);
      },
      /**
       * A sound with no file behind it: one short oscillator envelope per step, scheduled and
       * stopped by the clock, on the effects channel and through the game's own master and mute.
       * Silent, and false, where Web Audio is not what the game is running on.
       * @param {'beep'|'jump'|'coin'|'hit'|'select'|'win'|string} name
       * @param {{ volume?: number, type?: string, rate?: number }} [options]
       * @returns {boolean} whether a voice was scheduled
       */
      synth(name, options) {
        if (gone || state.muted || game2.sound.locked) return false;
        const ctx = game2.sound.context;
        if (!ctx || typeof ctx.createOscillator !== "function") return false;
        const p = options || {};
        const voice = VOICES[name] || VOICES.beep;
        const level = clamp01(state.sfx * (p.volume != null ? p.volume : 1)) * voice.gain;
        if (level <= 0) return false;
        const rate = p.rate && p.rate > 0 ? p.rate : 1;
        const out = game2.sound.destination || ctx.destination;
        let at = ctx.currentTime;
        for (const step of voice.steps) {
          const span = step[1];
          const osc = ctx.createOscillator();
          const shape = ctx.createGain();
          osc.type = p.type || voice.type;
          osc.frequency.setValueAtTime(step[0] * rate, at);
          shape.gain.setValueAtTime(SILENCE, at);
          shape.gain.linearRampToValueAtTime(level, at + Math.min(0.012, span / 3));
          shape.gain.exponentialRampToValueAtTime(SILENCE, at + span);
          osc.connect(shape);
          shape.connect(out);
          osc.onended = function() {
            osc.disconnect();
            shape.disconnect();
          };
          osc.start(at);
          osc.stop(at + span);
          at += span;
        }
        return true;
      },
      /** @returns {boolean} may this page make a sound yet? */
      get unlocked() {
        return !game2.sound.locked;
      },
      /**
       * Hear about the unlock. Called straight away when sound is already allowed.
       * @param {() => void} fn
       * @returns {() => void} stop listening
       */
      onUnlock(fn) {
        if (typeof fn !== "function") return function() {
        };
        if (!game2.sound.locked) {
          fn();
          return function() {
          };
        }
        game2.sound.once("unlocked", fn);
        return function() {
          game2.sound.off("unlocked", fn);
        };
      },
      /**
       * Ask the browser for sound. Call it from a real gesture: a click, a tap, a key. Phaser is
       * listening for the same gesture and will clear its own lock once the audio clock is running.
       * @returns {Promise<boolean>} whether sound is allowed now
       */
      unlock() {
        if (!game2.sound.locked) return Promise.resolve(true);
        const ctx = game2.sound.context;
        if (!ctx || typeof ctx.resume !== "function") return Promise.resolve(false);
        return ctx.resume().then(
          function() {
            return !game2.sound.locked;
          },
          function() {
            return false;
          }
        );
      },
      /**
       * The four numbers worth keeping for a player.
       * @returns {AudioSettings}
       */
      settings() {
        return { master: state.master, music: state.music, sfx: state.sfx, muted: state.muted };
      },
      /**
       * Put a remembered set of levels back in force.
       * @param {Partial<AudioSettings>} settings
       * @returns {AudioSettings}
       */
      apply(settings) {
        const s = settings || {};
        if (s.master != null) bus.master(s.master);
        if (s.music != null) bus.music(s.music);
        if (s.sfx != null) bus.sfx(s.sfx);
        if (s.muted != null) bus.mute(s.muted);
        return bus.settings();
      },
      /** Stop every ramp, drop every track, and leave nothing running. */
      destroy() {
        if (gone) return;
        gone = true;
        for (const stop of ramps) stop.cancelled = true;
        ramps.clear();
        for (const track of tracks) {
          track.stop();
          track.destroy();
        }
        tracks.clear();
        current = null;
      }
    };
    return bus;
  }

  // src/static/sdk-libs/phaser/tokens.js
  var OVERLAY_DEPTH = 1e6;
  var FALLBACK_EASE = "Cubic.easeOut";
  function look(scene) {
    const canvas = scene && scene.game ? scene.game.canvas : null;
    return theme(canvas ? canvas.parentElement : null);
  }
  function channels(value) {
    const n = typeof value === "number" && isFinite(value) ? value : 0;
    return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
  }
  function ms(value, fallback) {
    if (typeof value === "number" && isFinite(value)) return value;
    if (typeof value === "string") {
      const n = parseFloat(value);
      if (isFinite(n)) return /\ds\s*$/.test(value) && !/ms\s*$/.test(value) ? n * 1e3 : n;
    }
    return fallback;
  }
  function curve(th) {
    const e = th && th.ease;
    return typeof e === "string" && e.indexOf("(") < 0 && e.indexOf(",") < 0 ? e : FALLBACK_EASE;
  }

  // src/static/sdk-libs/phaser/juice.js
  var JUICE_DEPTH = 960;
  var SHAKE_STRENGTH = 6e-3;
  var SHAKE_MAX = 0.05;
  var SHAKE_MS = 180;
  var FRAME_MS = 16;
  var SCALE_FLOOR = 0.02;
  var COMBO_MS = 900;
  function tone(th, want, fallback) {
    if (typeof want === "number" && isFinite(want)) return want;
    if (want === "ok") return th.ok;
    if (want === "warn") return th.warn;
    if (want === "err") return th.err;
    if (want === "accent") return th.accent;
    if (want === "ink") return th.ink;
    return fallback;
  }
  function keyOf(prefix, colour) {
    return "ak-juice-" + prefix + "-" + (colour >>> 0 & 16777215).toString(16);
  }
  function particleTexture(scene, shape, colour) {
    const key = keyOf(shape, colour);
    if (scene.textures && scene.textures.exists(key)) return key;
    const g = scene.make.graphics({ add: false });
    g.fillStyle(colour, 1);
    let w = 8;
    let h = 8;
    if (shape === "dot") {
      g.fillCircle(4, 4, 4);
    } else if (shape === "chip") {
      w = 7;
      h = 10;
      g.fillRect(0, 0, w, h);
    } else {
      w = 12;
      h = 3;
      g.fillRect(0, 0, w, h);
    }
    g.generateTexture(key, w, h);
    g.destroy();
    return key;
  }
  var BURSTS = {
    coin: function(th) {
      return {
        shape: "dot",
        colour: th.ch3,
        count: 10,
        life: 560,
        config: {
          speed: { min: 60, max: 170 },
          angle: { min: -150, max: -30 },
          gravityY: 340,
          lifespan: { min: 380, max: 560 },
          scale: { start: 1, end: 0 },
          emitting: false
        }
      };
    },
    hit: function(th) {
      return {
        shape: "spark",
        colour: th.err,
        count: 12,
        life: 340,
        config: {
          speed: { min: 90, max: 260 },
          angle: { min: 0, max: 360 },
          lifespan: { min: 200, max: 340 },
          rotate: { min: -180, max: 180 },
          scale: { start: 1, end: 0.2 },
          alpha: { start: 1, end: 0.2 },
          emitting: false
        }
      };
    },
    dust: function(th) {
      return {
        shape: "dot",
        colour: th.inkDim,
        count: 8,
        life: 460,
        config: {
          speed: { min: 20, max: 80 },
          angle: { min: 190, max: 350 },
          gravityY: 40,
          lifespan: { min: 300, max: 460 },
          scale: { start: 0.9, end: 0.1 },
          alpha: { start: 0.55, end: 0 },
          emitting: false
        }
      };
    },
    spark: function(th) {
      return {
        shape: "spark",
        colour: th.accent,
        count: 14,
        life: 300,
        config: {
          speed: { min: 120, max: 340 },
          angle: { min: 0, max: 360 },
          lifespan: { min: 180, max: 300 },
          rotate: { min: -180, max: 180 },
          scale: { start: 1, end: 0 },
          blendMode: "ADD",
          emitting: false
        }
      };
    },
    confetti: function(th) {
      return {
        shape: "chip",
        colour: th.ch1,
        count: 22,
        life: 1e3,
        config: {
          speed: { min: 140, max: 320 },
          angle: { min: -160, max: -20 },
          gravityY: 430,
          lifespan: { min: 640, max: 1e3 },
          rotate: { min: -180, max: 180 },
          scale: { start: 1, end: 0.7 },
          alpha: { start: 1, end: 0.2 },
          tint: [th.ch1, th.ch2, th.ch3, th.ch4],
          emitting: false
        }
      };
    }
  };
  function juice(scene, opts) {
    const o = opts || /** @type {JuiceOptions} */
    {};
    const th = o.theme || look(scene);
    const depth = typeof o.depth === "number" ? o.depth : JUICE_DEPTH;
    const ease = curve(th);
    const pace = ms(th.motion, 200);
    let dead = false;
    const world = scene.physics && scene.physics.world ? scene.physics.world : null;
    const anims = scene.anims && typeof scene.anims.globalTimeScale === "number" ? scene.anims : null;
    const base = {
      time: scene.time ? scene.time.timeScale : 1,
      tweens: scene.tweens ? scene.tweens.timeScale : 1,
      world: world ? world.timeScale : 1,
      anims: anims ? anims.globalTimeScale : 1
    };
    const timeouts = /* @__PURE__ */ new Set();
    const timers = [];
    const objects = [];
    let ramp = 0;
    function later(wait, run) {
      const id = setTimeout(function() {
        timeouts.delete(id);
        if (!dead) run();
      }, Math.max(0, wait));
      timeouts.add(id);
    }
    function own(obj) {
      objects.push(obj);
      return obj;
    }
    function disown(obj) {
      const at = objects.indexOf(obj);
      if (at >= 0) objects.splice(at, 1);
    }
    function setSpeed(scale) {
      const k = Math.max(SCALE_FLOOR, scale);
      if (scene.time) scene.time.timeScale = base.time * k;
      if (scene.tweens) scene.tweens.timeScale = base.tweens * k;
      if (world) world.timeScale = base.world / k;
      if (anims) anims.globalTimeScale = base.anims * k;
    }
    function restoreSpeed() {
      if (scene.time) scene.time.timeScale = base.time;
      if (scene.tweens) scene.tweens.timeScale = base.tweens;
      if (world) world.timeScale = base.world;
      if (anims) anims.globalTimeScale = base.anims;
    }
    function shake(strength, msWanted) {
      if (dead || reducedMotion() || !scene.cameras || !scene.cameras.main) return false;
      const power = Math.min(SHAKE_MAX, Math.max(0, typeof strength === "number" && isFinite(strength) ? strength : SHAKE_STRENGTH));
      const span = Math.max(FRAME_MS, typeof msWanted === "number" && isFinite(msWanted) ? msWanted : SHAKE_MS);
      scene.cameras.main.shake(span, power);
      return true;
    }
    function flash(colour, msWanted) {
      if (dead || !scene.cameras || !scene.cameras.main) return false;
      const c = channels(tone(th, colour, th.accent));
      const span = Math.max(FRAME_MS, typeof msWanted === "number" && isFinite(msWanted) ? msWanted : 120);
      scene.cameras.main.flash(span, c.r, c.g, c.b);
      return true;
    }
    function hitStop(msWanted, scale) {
      if (dead || reducedMotion()) return false;
      const span = Math.max(FRAME_MS, typeof msWanted === "number" && isFinite(msWanted) ? msWanted : 90);
      const k = Math.max(SCALE_FLOOR, typeof scale === "number" && isFinite(scale) ? scale : 0.05);
      if (ramp) {
        cancelAnimationFrame(ramp);
        ramp = 0;
      }
      setSpeed(k);
      later(span, restoreSpeed);
      return true;
    }
    function slowmo(msWanted, scale) {
      if (dead || reducedMotion()) return false;
      const span = Math.max(FRAME_MS, typeof msWanted === "number" && isFinite(msWanted) ? msWanted : 600);
      const k = Math.max(SCALE_FLOOR, Math.min(1, typeof scale === "number" && isFinite(scale) ? scale : 0.35));
      if (ramp) {
        cancelAnimationFrame(ramp);
        ramp = 0;
      }
      setSpeed(k);
      later(span, function() {
        const back = Math.max(FRAME_MS, span * 0.5);
        const from = performance.now();
        const step = function(now) {
          if (dead) return;
          const p = Math.min(1, (now - from) / back);
          setSpeed(k + (1 - k) * (1 - (1 - p) * (1 - p)));
          if (p < 1) {
            ramp = requestAnimationFrame(step);
            return;
          }
          ramp = 0;
          restoreSpeed();
        };
        ramp = requestAnimationFrame(step);
      });
      return true;
    }
    function burst(x, y, kind, burstOpts) {
      if (dead || reducedMotion() || !scene.add) return null;
      const make = BURSTS[kind] || BURSTS.hit;
      const preset = make(th);
      const b = burstOpts || {};
      const colour = tone(th, b.colour, preset.colour);
      const key = particleTexture(scene, preset.shape, colour);
      const config = {};
      for (const name in preset.config) config[name] = preset.config[name];
      if (b.config) for (const name in b.config) config[name] = b.config[name];
      const emitter = scene.add.particles(x, y, key, config);
      emitter.setDepth(typeof b.depth === "number" ? b.depth : depth - 20);
      if (typeof b.scrollFactor === "number") emitter.setScrollFactor(b.scrollFactor);
      own(emitter);
      emitter.explode(Math.max(1, typeof b.count === "number" ? b.count : preset.count));
      later(preset.life + 80, function() {
        disown(emitter);
        emitter.destroy();
      });
      return emitter;
    }
    function number(x, y, text, numOpts) {
      if (dead || !scene.add) return null;
      const n = numOpts || {};
      const size = Math.max(8, typeof n.size === "number" ? n.size : 22);
      const label = scene.add.text(x, y, text == null ? "" : String(text), {
        fontFamily: th.fontDisplay,
        fontSize: size + "px",
        color: hex(tone(th, n.tone, th.ink))
      }).setOrigin(0.5, 1).setDepth(depth);
      own(label);
      const still = reducedMotion();
      const span = Math.max(200, typeof n.ms === "number" ? n.ms : Math.max(600, pace * 3));
      const rise = still ? 0 : typeof n.rise === "number" ? n.rise : 38;
      scene.tweens.add({
        targets: label,
        y: y - rise,
        alpha: 0,
        duration: span,
        ease: still ? "Linear" : ease,
        onComplete: function() {
          disown(label);
          label.destroy();
        }
      });
      return label;
    }
    function pointOf(target) {
      if (!target) return { x: scene.scale.width / 2, y: scene.scale.height / 2 };
      if (typeof target.x === "number" && typeof target.y === "number") {
        return { x: target.x, y: target.y };
      }
      const canvas = scene.game && scene.game.canvas;
      if (target.nodeType !== 1 || !canvas) return { x: scene.scale.width / 2, y: scene.scale.height / 2 };
      const box = target.getBoundingClientRect();
      const frame = canvas.getBoundingClientRect();
      const kx = frame.width > 0 ? scene.scale.width / frame.width : 1;
      const ky = frame.height > 0 ? scene.scale.height / frame.height : 1;
      return {
        x: (box.left + box.width / 2 - frame.left) * kx,
        y: (box.top + box.height / 2 - frame.top) * ky
      };
    }
    let comboBox = null;
    let comboTimer = 0;
    function dropCombo() {
      if (!comboBox) return;
      const box = comboBox;
      comboBox = null;
      disown(box);
      if (!box.scene) return;
      scene.tweens.add({
        targets: box,
        alpha: 0,
        duration: Math.max(120, pace),
        onComplete: function() {
          box.destroy();
        }
      });
    }
    function combo(target, comboOpts) {
      if (dead || !scene.add) return null;
      const c = comboOpts || /** @type {any} */
      {};
      const count = Math.max(0, Math.round(typeof c.count === "number" ? c.count : 0));
      const at = pointOf(target);
      const size = (typeof c.size === "number" ? c.size : 26) + Math.min(count, 20) * 1.6;
      if (!comboBox) {
        const digits2 = scene.add.text(0, 0, "", {
          fontFamily: th.fontDisplay,
          fontSize: size + "px",
          color: hex(th.accent)
        }).setOrigin(0.5, 1);
        const word2 = scene.add.text(0, 4, "", {
          fontFamily: th.fontMono,
          fontSize: "12px",
          color: hex(th.inkDim)
        }).setOrigin(0.5, 0);
        comboBox = own(scene.add.container(at.x, at.y, [digits2, word2]).setDepth(depth));
        comboBox.setData("digits", digits2);
        comboBox.setData("word", word2);
      }
      const digits = comboBox.getData("digits");
      const word = comboBox.getData("word");
      digits.setFontSize(size);
      digits.setText(String(count));
      word.setText(c.label ? String(c.label) : "");
      word.setVisible(!!c.label);
      comboBox.setPosition(at.x, at.y);
      comboBox.setAlpha(1);
      comboBox.setScale(1);
      if (!reducedMotion()) {
        scene.tweens.add({
          targets: comboBox,
          scale: 1.35,
          duration: Math.max(60, pace * 0.4),
          yoyo: true,
          ease: "Back.easeOut"
        });
      }
      if (comboTimer) {
        clearTimeout(comboTimer);
        timeouts.delete(comboTimer);
        comboTimer = 0;
      }
      const hold = Math.max(200, typeof c.ms === "number" ? c.ms : COMBO_MS);
      const id = setTimeout(function() {
        timeouts.delete(id);
        comboTimer = 0;
        if (!dead) dropCombo();
      }, hold);
      timeouts.add(id);
      comboTimer = id;
      return comboBox;
    }
    function pop(gameObject, scale) {
      if (dead || reducedMotion() || !gameObject || !gameObject.scene || !scene.tweens) return false;
      const k = Math.max(1.01, typeof scale === "number" && isFinite(scale) ? scale : 1.18);
      const fromX = typeof gameObject.scaleX === "number" ? gameObject.scaleX : 1;
      const fromY = typeof gameObject.scaleY === "number" ? gameObject.scaleY : 1;
      scene.tweens.add({
        targets: gameObject,
        scaleX: fromX * k,
        scaleY: fromY / k,
        duration: Math.max(FRAME_MS, pace * 0.5),
        yoyo: true,
        ease: "Quad.easeOut",
        onComplete: function() {
          if (!gameObject.scene) return;
          gameObject.setScale(fromX, fromY);
        }
      });
      return true;
    }
    function trail(gameObject, trailOpts) {
      if (dead || reducedMotion() || !gameObject || !gameObject.scene || !scene.add) return false;
      const t = trailOpts || {};
      const count = Math.max(1, Math.min(12, Math.round(typeof t.count === "number" ? t.count : 5)));
      const step = Math.max(FRAME_MS, typeof t.step === "number" ? t.step : 40);
      const span = Math.max(FRAME_MS, typeof t.ms === "number" ? t.ms : 280);
      const top = Math.max(0, Math.min(1, typeof t.alpha === "number" ? t.alpha : 0.5));
      for (let i = 0; i < count; i++) {
        const timer = scene.time.delayedCall(i * step, function() {
          if (dead || !gameObject.scene) return;
          const frame = gameObject.frame ? gameObject.frame.name : void 0;
          const ghost = scene.add.image(gameObject.x, gameObject.y, gameObject.texture.key, frame);
          ghost.setOrigin(gameObject.originX, gameObject.originY).setScale(gameObject.scaleX, gameObject.scaleY).setRotation(gameObject.rotation).setFlipX(!!gameObject.flipX).setFlipY(!!gameObject.flipY).setAlpha(top).setDepth((gameObject.depth || 0) - 1);
          if (typeof t.tint === "number") ghost.setTint(t.tint);
          own(ghost);
          scene.tweens.add({
            targets: ghost,
            alpha: 0,
            duration: span,
            ease: "Quad.easeOut",
            onComplete: function() {
              disown(ghost);
              ghost.destroy();
            }
          });
        });
        timers.push(timer);
      }
      return true;
    }
    function destroy() {
      if (dead) return;
      dead = true;
      if (scene.events && typeof scene.events.off === "function") {
        scene.events.off("shutdown", destroy);
        scene.events.off("destroy", destroy);
      }
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
      comboTimer = 0;
      comboBox = null;
      for (const timer of timers) {
        if (timer && typeof timer.remove === "function") timer.remove(false);
      }
      timers.length = 0;
      if (ramp) {
        cancelAnimationFrame(ramp);
        ramp = 0;
      }
      for (const obj of objects.slice()) {
        if (!obj) continue;
        if (scene.tweens) scene.tweens.killTweensOf(obj);
        if (typeof obj.destroy === "function" && obj.scene !== void 0) obj.destroy();
      }
      objects.length = 0;
      restoreSpeed();
    }
    if (scene.events && typeof scene.events.once === "function") {
      scene.events.once("shutdown", destroy);
      scene.events.once("destroy", destroy);
    }
    return {
      shake,
      hitStop,
      flash,
      burst,
      number,
      combo,
      slowmo,
      pop,
      trail,
      destroy
    };
  }

  // src/static/sdk-libs/phaser/net.js
  var INPUT = "i";
  var STATE = "s";
  var MESSAGE = "m";
  var INPUT_RATE = 30;
  var STATE_RATE = 100;
  var JOIN_MS = 12e3;
  function realtimeClass() {
    const root = typeof window !== "undefined" ? (
      /** @type {any} */
      window
    ) : null;
    return root && typeof root.AimeatRealtime === "function" ? root.AimeatRealtime : null;
  }
  function sessionToken() {
    const root = typeof window !== "undefined" ? (
      /** @type {any} */
      window.AIMEAT
    ) : null;
    const auth = root && root.auth;
    if (!auth || typeof auth.getSession !== "function") return null;
    try {
      const s = auth.getSession();
      return s && s.jwt || null;
    } catch (err) {
      console.warn("[aimeat-phaser] auth.getSession failed, so there is no room to join:", err);
      return null;
    }
  }
  function lowest(ids) {
    let best = null;
    for (const id of ids) {
      const s = String(id);
      if (best === null || s < best) best = s;
    }
    return best;
  }
  function net(spec) {
    const s = spec || /** @type {NetSpec} */
    {};
    const rate = Math.max(10, typeof s.rate === "number" && isFinite(s.rate) ? s.rate : INPUT_RATE);
    const nick = s.name || "player";
    let rt = null;
    let me = null;
    let roomId = null;
    let host = null;
    let dead = false;
    const roster = /* @__PURE__ */ new Map();
    let echo = null;
    const inputWindow = { last: "", at: 0, timer: 0, held: (
      /** @type {any} */
      null
    ), hasHeld: false };
    const stateWindow = { at: 0, timer: 0, held: (
      /** @type {any} */
      null
    ), hasHeld: false, every: STATE_RATE };
    const wired = [];
    function tell(which, args) {
      const fn = (
        /** @type {any} */
        s[which]
      );
      if (typeof fn !== "function") return;
      try {
        fn.apply(null, args);
      } catch (err) {
        console.warn("[aimeat-phaser] the net " + which + " handler threw:", err);
      }
    }
    function elect() {
      host = lowest(Array.from(roster.keys()));
    }
    function put(kind, data) {
      if (dead || !rt || !me) return false;
      const packet = { k: kind, f: me, t: Date.now(), d: data };
      if (echo) packet.e = echo;
      rt.broadcast(packet);
      return true;
    }
    function onBroadcast(msg) {
      const p = msg && msg.payload;
      if (!p || typeof p !== "object" || typeof p.f !== "string") return;
      if (p.f === me) return;
      if (typeof p.t === "number") echo = [p.f, p.t];
      if (Array.isArray(p.e) && p.e[0] === me && typeof p.e[1] === "number") {
        const known = roster.get(p.f);
        if (known) known.latency = Math.max(0, Date.now() - p.e[1]);
      }
      if (p.k === INPUT) {
        tell("onInput", [p.f, p.d]);
        return;
      }
      if (p.k === STATE) {
        tell("onState", [p.f, p.d]);
        return;
      }
      if (p.k === MESSAGE) tell("onMessage", [p.f, p.d]);
    }
    function wire2(ready, refuse) {
      const add = function(event, fn) {
        rt.on(event, fn);
        wired.push([event, fn]);
      };
      add("joined", function(msg) {
        me = msg && msg.peerId ? String(msg.peerId) : null;
        roomId = msg && msg.roomId || roomId;
        roster.clear();
        if (me) roster.set(me, { id: me, name: nick });
        const existing = msg && msg.peers || [];
        for (const p of existing) {
          if (!p || !p.peerId) continue;
          roster.set(String(p.peerId), { id: String(p.peerId), name: p.nick || "player" });
        }
        elect();
        if (!me) {
          refuse(new Error("The room answered without saying which peer we are, so there is nobody to send input as. Try joining again."));
          return;
        }
        ready({ id: me, room: String(roomId), isHost: host === me });
      });
      add("peer-joined", function(msg) {
        if (!msg || !msg.peerId) return;
        const peer = { id: String(msg.peerId), name: msg.nick || "player" };
        roster.set(peer.id, peer);
        elect();
        tell("onPeer", [peer, true]);
      });
      add("peer-left", function(msg) {
        if (!msg || !msg.peerId) return;
        const id2 = String(msg.peerId);
        const peer = roster.get(id2) || { id: id2, name: "player" };
        roster.delete(id2);
        elect();
        tell("onPeer", [peer, false]);
      });
      add("peer-presence", function(msg) {
        if (!msg || !msg.peerId) return;
        const known = roster.get(String(msg.peerId));
        if (known && msg.state && typeof msg.state.name === "string") known.name = msg.state.name;
      });
      add("broadcast", onBroadcast);
      add("close", function(msg) {
        roster.clear();
        host = null;
        tell("onClose", [msg || {}]);
      });
      add("error", function(msg) {
        console.warn("[aimeat-phaser] the room reported an error:", msg);
      });
    }
    function findRoom() {
      return rt.listRooms({ app_type: s.app }).then(function(rooms) {
        const matching = (rooms || []).filter(function(r) {
          return r && r.name === s.room;
        });
        if (matching.length) {
          return String(lowest(matching.map(function(r) {
            return r.id;
          })));
        }
        return rt.createRoom({ app_type: s.app, name: s.room, is_public: true }).then(function(made) {
          return String(made.id);
        });
      });
    }
    function connect() {
      if (dead) return Promise.reject(new Error("This net link was destroyed. Make a new one."));
      if (rt && me) return Promise.resolve({ id: me, room: String(roomId), isHost: host === me });
      const Realtime = realtimeClass();
      if (!Realtime) {
        return Promise.reject(new Error('Multiplayer needs the realtime library, which this page has not loaded. Add this line before the game runs:\n  <script src="' + NODE_URL + '/lib/realtime.js"><\/script>'));
      }
      const token = sessionToken();
      if (!token) {
        return Promise.reject(new Error("A room belongs to an account, so multiplayer needs somebody signed in. Include aimeat-auth.js and call AIMEAT.auth.login() before connecting."));
      }
      if (!s.room || !s.app) {
        return Promise.reject(new Error("net() needs both a room name and an app type: two games must not meet in a room that happens to share a name."));
      }
      rt = new Realtime(NODE_URL, token);
      return findRoom().then(function(found) {
        roomId = found;
        return new Promise(function(ok, fail) {
          let settled = false;
          const timer = setTimeout(function() {
            if (settled) return;
            settled = true;
            fail(new Error("The room at " + NODE_URL + " did not answer within " + Math.round(JOIN_MS / 1e3) + " seconds. The node may be unreachable from here, or the sign-in may have expired."));
          }, JOIN_MS);
          wire2(
            function(info) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              ok(info);
            },
            function(err) {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              fail(err);
            }
          );
          rt.connect(roomId, nick);
        });
      });
    }
    function sendInput(input) {
      if (dead || !rt || !me) return false;
      const text = JSON.stringify(input === void 0 ? null : input);
      if (text === inputWindow.last) return false;
      const now = Date.now();
      const since = now - inputWindow.at;
      if (since >= rate) {
        inputWindow.last = text;
        inputWindow.at = now;
        inputWindow.hasHeld = false;
        inputWindow.held = null;
        return put(INPUT, input);
      }
      inputWindow.held = input;
      inputWindow.hasHeld = true;
      if (inputWindow.timer) return false;
      inputWindow.timer = setTimeout(function() {
        inputWindow.timer = 0;
        if (dead || !inputWindow.hasHeld) return;
        const held = inputWindow.held;
        inputWindow.hasHeld = false;
        inputWindow.held = null;
        inputWindow.last = JSON.stringify(held === void 0 ? null : held);
        inputWindow.at = Date.now();
        put(INPUT, held);
      }, rate - since);
      return false;
    }
    function sendState(state, opts) {
      if (dead || !rt || !me) return false;
      if (opts && typeof opts.every === "number" && isFinite(opts.every)) {
        stateWindow.every = Math.max(20, opts.every);
      }
      const now = Date.now();
      const since = now - stateWindow.at;
      if (since >= stateWindow.every) {
        stateWindow.at = now;
        stateWindow.hasHeld = false;
        stateWindow.held = null;
        return put(STATE, state);
      }
      stateWindow.held = state;
      stateWindow.hasHeld = true;
      if (stateWindow.timer) return false;
      stateWindow.timer = setTimeout(function() {
        stateWindow.timer = 0;
        if (dead || !stateWindow.hasHeld) return;
        const held = stateWindow.held;
        stateWindow.hasHeld = false;
        stateWindow.held = null;
        stateWindow.at = Date.now();
        put(STATE, held);
      }, stateWindow.every - since);
      return false;
    }
    function send(msg) {
      return put(MESSAGE, msg);
    }
    function peers() {
      const out = [];
      for (const peer of roster.values()) {
        if (peer.id === me) continue;
        out.push(peer.latency === void 0 ? { id: peer.id, name: peer.name } : { id: peer.id, name: peer.name, latency: peer.latency });
      }
      return out;
    }
    function isHost() {
      return !!me && host === me;
    }
    function id() {
      return me;
    }
    function stopWindows() {
      if (inputWindow.timer) clearTimeout(inputWindow.timer);
      if (stateWindow.timer) clearTimeout(stateWindow.timer);
      inputWindow.timer = 0;
      stateWindow.timer = 0;
      inputWindow.held = null;
      stateWindow.held = null;
      inputWindow.hasHeld = false;
      stateWindow.hasHeld = false;
    }
    function leave() {
      stopWindows();
      roster.clear();
      host = null;
      me = null;
      if (rt && typeof rt.leave === "function") rt.leave();
    }
    function destroy() {
      if (dead) return;
      dead = true;
      stopWindows();
      if (rt) {
        for (const pair of wired) rt.off(pair[0], pair[1]);
        if (typeof rt.disconnect === "function") rt.disconnect();
      }
      wired.length = 0;
      roster.clear();
      host = null;
      me = null;
      rt = null;
    }
    return {
      connect,
      leave,
      peers,
      sendInput,
      sendState,
      send,
      isHost,
      id,
      destroy
    };
  }

  // src/static/sdk-libs/phaser/editor.js
  var EMPTY = ".";
  var DEFAULT_LEGEND = {
    "#": { kind: "ground", label: "Ground" },
    "=": { kind: "brick", label: "Brick" },
    "^": { kind: "spike", label: "Spike" },
    o: { kind: "coin", label: "Coin" },
    E: { kind: "enemy", label: "Enemy" },
    P: { kind: "spawn", label: "Player start" },
    G: { kind: "goal", label: "Goal" },
    ".": { kind: "empty", label: "Eraser" }
  };
  var DEFAULT_COLS = 26;
  var DEFAULT_ROWS = 12;
  var DEFAULT_TILE = 24;
  var MIN_SIZE = 2;
  var MAX_SIZE = 400;
  var HISTORY_MAX = 60;
  var ROLE = {
    ground: "line",
    brick: "inkDim",
    spike: "err",
    coin: "warn",
    enemy: "accent",
    spawn: "ch1",
    goal: "ok",
    empty: "surface"
  };
  var UNIQUE = { spawn: true, goal: true };
  var AS_LETTER = { spawn: true, goal: true };
  var RULE_ALPHA = 0.35;
  function clamp(value, low, high, fallback) {
    const n = Math.floor(Number(value));
    return isFinite(n) ? Math.max(low, Math.min(high, n)) : fallback;
  }
  function normalizeLegend(custom) {
    const source = Object.assign({}, DEFAULT_LEGEND, custom || {});
    const out = (
      /** @type {Record<string, Mark>} */
      {}
    );
    for (const char in source) {
      const raw = source[char];
      const entry = typeof raw === "string" ? { kind: raw, label: "", colour: "" } : raw || { kind: "empty" };
      out[char] = {
        char,
        kind: entry.kind || "empty",
        label: entry.label || entry.kind || char,
        colour: entry.colour
      };
    }
    return out;
  }
  function blankMap(cols, rows, legend) {
    let floor = EMPTY;
    for (const char in legend) if (legend[char].kind === "ground") {
      floor = char;
      break;
    }
    const out = [];
    for (let y = 0; y < rows; y += 1) out.push((y === rows - 1 ? floor : EMPTY).repeat(cols));
    return out;
  }
  function toGrid(rows, wanted) {
    const lines = Array.isArray(rows) && rows.length ? rows : [""];
    let cols = wanted || 0;
    if (!cols) for (const line of lines) cols = Math.max(cols, String(line == null ? "" : line).length);
    cols = Math.max(1, cols);
    const grid = (
      /** @type {string[][]} */
      []
    );
    for (const line of lines) {
      const text = String(line == null ? "" : line);
      const row = (
        /** @type {string[]} */
        []
      );
      for (let x = 0; x < cols; x += 1) {
        const char = text.charAt(x);
        row.push(char === "" || char === " " ? EMPTY : char);
      }
      grid.push(row);
    }
    return grid;
  }
  function colourOf(mark, paint) {
    const named = mark && mark.colour;
    if (named && ROLE[named] && paint[ROLE[named]]) return paint[ROLE[named]];
    if (named && paint[named]) return paint[named];
    return paint[ROLE[mark ? mark.kind : "empty"]] || paint.ink;
  }
  function letterOn(ctx, text, font, px, py, size) {
    ctx.font = Math.round(size * 0.72) + "px " + font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, px + size / 2, py + size * 0.54);
  }
  function drawCell(ctx, mark, paint, px, py, size) {
    ctx.fillStyle = paint.surface;
    ctx.fillRect(px, py, size, size);
    const kind = mark ? mark.kind : "empty";
    if (!mark || kind === "empty") return;
    const mid = size / 2;
    ctx.fillStyle = colourOf(mark, paint);
    if (kind === "coin") {
      ctx.beginPath();
      ctx.arc(px + mid, py + mid, Math.max(2, size * 0.3), 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "spike") {
      ctx.beginPath();
      ctx.moveTo(px, py + size);
      ctx.lineTo(px + mid, py + size * 0.2);
      ctx.lineTo(px + size, py + size);
      ctx.fill();
    } else if (AS_LETTER[kind]) {
      letterOn(ctx, mark.char, paint.fontMono, px, py, size);
    } else {
      ctx.fillRect(px, py, size, size);
      ctx.fillStyle = paint.surface;
      if (kind === "brick") {
        ctx.fillRect(px, py + mid - size * 0.04, size, size * 0.08);
        ctx.fillRect(px + mid - size * 0.04, py, size * 0.08, mid);
        ctx.fillRect(px + size * 0.21, py + mid, size * 0.08, mid);
      } else if (kind === "enemy") {
        const r = Math.max(1, size * 0.09);
        ctx.beginPath();
        ctx.arc(px + size * 0.34, py + size * 0.4, r, 0, Math.PI * 2);
        ctx.arc(px + size * 0.66, py + size * 0.4, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (!ROLE[kind]) {
        letterOn(ctx, mark.char, paint.fontMono, px, py, size);
      }
    }
  }
  function levelEditor(spec) {
    const s = spec || /** @type {any} */
    {};
    const legend = normalizeLegend(s.legend);
    const tile = clamp(s.tile || DEFAULT_TILE, 8, 96, DEFAULT_TILE);
    const readOnly = !!s.readOnly;
    const store = s.store || null;
    const useSaves = !!(store && typeof store.set === "function" && typeof store.save === "function" && typeof store.get === "function");
    let grid = toGrid(s.map && s.map.length ? s.map : blankMap(DEFAULT_COLS, DEFAULT_ROWS, legend));
    let cols = grid[0].length;
    let rowCount = grid.length;
    const past = (
      /** @type {string[][][]} */
      []
    );
    const future = (
      /** @type {string[][][]} */
      []
    );
    let paint = (
      /** @type {Record<string, string>|null} */
      null
    );
    const cursor = { x: 0, y: 0 };
    let toolChar = offered()[0] || EMPTY;
    let painting = false;
    let strokeDirty = false;
    let strokeBefore = (
      /** @type {string[]|null} */
      null
    );
    let textBefore = (
      /** @type {string[]|null} */
      null
    );
    let syncing = false;
    let levels = (
      /** @type {SavedLevel[]} */
      []
    );
    let currentId = "";
    let gone = false;
    const root = el("div", { class: "ak-leveled" + (readOnly ? " ak-leveled--readonly" : "") });
    resolve(s.target, document.body).appendChild(root);
    const canvas = (
      /** @type {HTMLCanvasElement} */
      el("canvas", {
        class: "ak-leveled__grid",
        tabindex: "0",
        "aria-label": "The level map. Arrow keys move the cursor, space paints, the number keys pick a tool."
      })
    );
    const palette = el("div", { class: "ak-leveled__palette", role: "group", "aria-label": "Tools" });
    const status = el("p", { class: "ak-leveled__status", role: "status" });
    const ascii = (
      /** @type {HTMLTextAreaElement} */
      el("textarea", {
        class: "ak-leveled__ascii",
        spellcheck: "false",
        rows: "8",
        readonly: readOnly,
        "aria-label": "The map as text"
      })
    );
    const nameInput = (
      /** @type {HTMLInputElement} */
      el("input", {
        type: "text",
        class: "ak-input ak-leveled__name",
        placeholder: "Level name",
        "aria-label": "Level name",
        disabled: readOnly
      })
    );
    const picker = (
      /** @type {HTMLSelectElement} */
      el("select", {
        class: "ak-input ak-leveled__picker",
        "aria-label": "Saved levels"
      })
    );
    const colsInput = sizeField("Columns", true);
    const rowsInput = sizeField("Rows", false);
    const swatches = (
      /** @type {Array<{ canvas: HTMLCanvasElement, mark: Mark }>} */
      []
    );
    const toolButtons = (
      /** @type {HTMLButtonElement[]} */
      []
    );
    const toolMarks = (
      /** @type {Mark[]} */
      []
    );
    function sizeField(label, isCols) {
      const input = (
        /** @type {HTMLInputElement} */
        el("input", {
          type: "number",
          class: "ak-input ak-leveled__size",
          disabled: readOnly,
          min: String(MIN_SIZE),
          max: String(MAX_SIZE),
          "aria-label": label,
          on: { change: function() {
            const n = clamp(input.value, MIN_SIZE, MAX_SIZE, isCols ? cols : rowCount);
            api.resize(isCols ? n : cols, isCols ? rowCount : n);
          } }
        })
      );
      return input;
    }
    function button(label, run, needsWrite) {
      return el("button", {
        type: "button",
        class: "ak-btn ak-btn--ghost",
        "data-ak-noguard": true,
        disabled: !!(needsWrite && readOnly),
        on: { click: run }
      }, label);
    }
    function offered() {
      const asked = Array.isArray(s.tools) && s.tools.length ? s.tools : Object.keys(legend);
      return asked.filter(function(char) {
        return !!legend[char] && legend[char].kind !== "empty";
      });
    }
    function build() {
      for (const char of offered()) toolMarks.push(legend[char]);
      toolMarks.push(legend[EMPTY] || { char: EMPTY, kind: "empty", label: "Eraser" });
      for (let i = 0; i < toolMarks.length; i += 1) palette.appendChild(toolButton(toolMarks[i], i));
      root.appendChild(el("div", { class: "ak-leveled__bar" }, [
        el("div", { class: "ak-leveled__group" }, [
          el("span", { class: "ak-leveled__legendword", text: "Size" }),
          colsInput,
          el("span", { class: "ak-leveled__times", text: "x" }),
          rowsInput
        ]),
        el("div", { class: "ak-leveled__group" }, [
          button("Undo", function() {
            api.undo();
          }, true),
          button("Redo", function() {
            api.redo();
          }, true),
          button("Clear", function() {
            api.clear();
          }, true),
          button("Copy as JS", copyAsJs)
        ]),
        store ? el("div", { class: "ak-leveled__group ak-leveled__group--store" }, [
          nameInput,
          picker,
          button("Save", function() {
            void saveLevel();
          }, true),
          button("Load", loadLevel),
          button("New", newLevel, true),
          button("Delete", function() {
            void deleteLevel();
          }, true)
        ]) : null
      ]));
      root.appendChild(el("div", { class: "ak-leveled__main" }, [
        palette,
        el("div", { class: "ak-leveled__stage" }, canvas)
      ]));
      root.appendChild(status);
      root.appendChild(ascii);
    }
    function toolButton(mark, index) {
      const swatch = (
        /** @type {HTMLCanvasElement} */
        el("canvas", {
          class: "ak-leveled__swatch",
          width: "24",
          height: "24",
          "aria-hidden": "true"
        })
      );
      swatches.push({ canvas: swatch, mark });
      const node = (
        /** @type {HTMLButtonElement} */
        el("button", {
          type: "button",
          class: "ak-btn ak-btn--ghost ak-leveled__tool",
          "data-ak-noguard": true,
          "aria-pressed": String(mark.char === toolChar),
          disabled: readOnly,
          title: mark.label + " (" + mark.char + ")",
          on: { click: function() {
            api.tool(mark.char);
          } }
        }, [
          swatch,
          el("span", { class: "ak-leveled__toolname", text: mark.label }),
          index < 9 ? el("kbd", { class: "ak-leveled__hint", text: String(index + 1) }) : null
        ])
      );
      toolButtons.push(node);
      return node;
    }
    function colours() {
      if (!paint) paint = theme.css(root);
      return paint;
    }
    function context() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }
    function sizeCanvas() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cols * tile * dpr);
      canvas.height = Math.round(rowCount * tile * dpr);
      canvas.style.setProperty("--akl-w", cols * tile + "px");
      canvas.style.setProperty("--akl-h", rowCount * tile + "px");
    }
    function overlay(ctx, p, box) {
      ctx.globalAlpha = RULE_ALPHA;
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 1;
      if (box) {
        ctx.strokeRect(box[0] * tile + 0.5, box[1] * tile + 0.5, tile, tile);
      } else {
        ctx.beginPath();
        for (let x = 0; x <= cols; x += 1) {
          ctx.moveTo(x * tile + 0.5, 0);
          ctx.lineTo(x * tile + 0.5, rowCount * tile);
        }
        for (let y = 0; y <= rowCount; y += 1) {
          ctx.moveTo(0, y * tile + 0.5);
          ctx.lineTo(cols * tile, y * tile + 0.5);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (document.activeElement !== canvas) return;
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(cursor.x * tile + 1, cursor.y * tile + 1, tile - 2, tile - 2);
    }
    function paintAll() {
      const ctx = context();
      if (!ctx) return;
      const p = colours();
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, cols * tile, rowCount * tile);
      for (let y = 0; y < rowCount; y += 1) {
        for (let x = 0; x < cols; x += 1) drawCell(ctx, legend[grid[y][x]] || null, p, x * tile, y * tile, tile);
      }
      overlay(ctx, p, null);
      for (const item of swatches) {
        const swatchCtx = item.canvas.getContext("2d");
        if (swatchCtx) drawCell(swatchCtx, item.mark, p, 0, 0, item.canvas.width);
      }
    }
    function paintOne(x, y) {
      const ctx = context();
      if (!ctx) return;
      const p = colours();
      drawCell(ctx, legend[grid[y][x]] || null, p, x * tile, y * tile, tile);
      overlay(ctx, p, [x, y]);
    }
    function cellAt(ev) {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return null;
      const x = Math.floor((ev.clientX - box.left) / (box.width / cols));
      const y = Math.floor((ev.clientY - box.top) / (box.height / rowCount));
      return x < 0 || y < 0 || x >= cols || y >= rowCount ? null : { x, y };
    }
    function put(x, y, char) {
      if (grid[y][x] === char) return false;
      const mark = legend[char];
      if (mark && UNIQUE[mark.kind]) {
        for (let yy = 0; yy < rowCount; yy += 1) {
          for (let xx = 0; xx < cols; xx += 1) {
            const other = legend[grid[yy][xx]];
            if (other && other.kind === mark.kind) {
              grid[yy][xx] = EMPTY;
              paintOne(xx, yy);
            }
          }
        }
      }
      grid[y][x] = char;
      paintOne(x, y);
      return true;
    }
    function onDown(ev) {
      if (readOnly) return;
      const cell = cellAt(ev);
      if (!cell) return;
      ev.preventDefault();
      canvas.focus();
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (err) {
        console.warn("[aimeat-phaser] the pointer could not be captured, painting still works:", err);
      }
      painting = true;
      strokeDirty = false;
      strokeBefore = rowsNow();
      cursor.x = cell.x;
      cursor.y = cell.y;
      if (put(cell.x, cell.y, toolChar)) strokeDirty = true;
    }
    function onMove(ev) {
      if (!painting) return;
      const cell = cellAt(ev);
      if (cell && put(cell.x, cell.y, toolChar)) strokeDirty = true;
    }
    function onUp(ev) {
      if (!painting) return;
      painting = false;
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch (err) {
        console.warn("[aimeat-phaser] the pointer capture could not be released:", err);
      }
      if (!strokeDirty || !strokeBefore) return;
      commit(strokeBefore);
      strokeBefore = null;
      changed();
    }
    function onKey(ev) {
      const key = ev.key;
      if (ev.ctrlKey || ev.metaKey) {
        if (key === "z" || key === "Z") {
          ev.preventDefault();
          if (ev.shiftKey) api.redo();
          else api.undo();
        } else if (key === "y" || key === "Y") {
          ev.preventDefault();
          api.redo();
        }
        return;
      }
      if (/^[1-9]$/.test(key)) {
        const mark = toolMarks[Number(key) - 1];
        if (mark) {
          ev.preventDefault();
          api.tool(mark.char);
        }
        return;
      }
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
      if (step) {
        ev.preventDefault();
        cursor.x = Math.max(0, Math.min(cols - 1, cursor.x + step[0]));
        cursor.y = Math.max(0, Math.min(rowCount - 1, cursor.y + step[1]));
        paintAll();
        return;
      }
      if ((key === " " || key === "Enter") && !readOnly) {
        ev.preventDefault();
        const before = rowsNow();
        if (!put(cursor.x, cursor.y, toolChar)) return;
        commit(before);
        changed();
      }
    }
    function rowsNow() {
      return grid.map(function(row) {
        return row.join("");
      });
    }
    function relayout() {
      rowCount = grid.length;
      cols = grid[0] ? grid[0].length : 1;
      sizeCanvas();
      cursor.x = Math.min(cursor.x, cols - 1);
      cursor.y = Math.min(cursor.y, rowCount - 1);
      paintAll();
      colsInput.value = String(cols);
      rowsInput.value = String(rowCount);
    }
    function adopt(next, tell) {
      grid = next;
      relayout();
      syncing = true;
      ascii.value = rowsNow().join("\n");
      syncing = false;
      if (tell) changed();
    }
    function commit(before) {
      past.push(toGrid(before, before[0] ? before[0].length : cols));
      if (past.length > HISTORY_MAX) past.shift();
      future.length = 0;
    }
    function changed() {
      if (typeof s.onChange !== "function") return;
      try {
        s.onChange(rowsNow());
      } catch (err) {
        console.warn("[aimeat-phaser] a levelEditor onChange listener threw:", err);
      }
    }
    function onText() {
      if (syncing || readOnly) return;
      grid = toGrid(ascii.value.split("\n"));
      relayout();
      changed();
    }
    function asJs() {
      const quoted = rowsNow().map(function(row) {
        return "  '" + row.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
      });
      return "[\n" + quoted.join(",\n") + "\n]";
    }
    function say(words) {
      status.textContent = words;
    }
    function copyAsJs() {
      const clip = navigator.clipboard;
      if (!clip || typeof clip.writeText !== "function") {
        say("This browser keeps the clipboard closed. The rows are in the text box below.");
        return;
      }
      clip.writeText(asJs()).then(function() {
        say("Copied. Paste it straight into a source file.");
      }, function(err) {
        console.warn("[aimeat-phaser] the clipboard refused the level:", err);
        say("The clipboard refused. The rows are in the text box below.");
      });
    }
    async function refreshLevels() {
      try {
        if (useSaves) {
          if (typeof store.load === "function") await store.load();
          const state = store.get();
          levels = Array.isArray(state && state.levelSet) ? state.levelSet : [];
        } else {
          const list = typeof store.load === "function" ? await store.load() : [];
          levels = Array.isArray(list) ? list : [];
        }
      } catch (err) {
        console.warn("[aimeat-phaser] the saved levels could not be read:", err);
        say("The saved levels could not be read.");
        return;
      }
      if (!gone) fillPicker();
    }
    async function writeLevels(done) {
      try {
        if (useSaves) {
          store.set({ levelSet: levels });
          await store.save();
        } else if (typeof store.save === "function") await store.save(levels);
      } catch (err) {
        console.warn("[aimeat-phaser] the levels could not be written:", err);
        say("The levels could not be written to the store.");
        return;
      }
      fillPicker();
      say(done);
    }
    function fillPicker() {
      clear(picker);
      picker.appendChild(el("option", { value: "", text: levels.length ? "Pick a level" : "Nothing saved yet" }));
      for (const level of levels) {
        picker.appendChild(el("option", { value: level.id, text: level.name || level.id }));
      }
      picker.value = currentId;
    }
    function picked() {
      const wanted = picker.value;
      return levels.filter(function(level) {
        return level.id === wanted;
      })[0] || null;
    }
    async function saveLevel() {
      const name = nameInput.value.trim() || "Untitled level";
      const found = levels.filter(function(level) {
        return level.id === currentId;
      })[0];
      const record = found || { id: uid("level"), name, rows: [], updated: "" };
      record.name = name;
      record.rows = rowsNow();
      record.updated = (/* @__PURE__ */ new Date()).toISOString();
      if (!found) levels.push(record);
      currentId = record.id;
      await writeLevels('Saved as "' + name + '".');
    }
    function loadLevel() {
      const found = picked();
      if (!found) {
        say("Pick a level first.");
        return;
      }
      currentId = found.id;
      nameInput.value = found.name || "";
      commit(rowsNow());
      adopt(toGrid(found.rows || []), true);
      say('Opened "' + (found.name || found.id) + '".');
    }
    function newLevel() {
      currentId = "";
      nameInput.value = "";
      picker.value = "";
      api.clear();
      say("A fresh map. Save it to give it a name.");
    }
    async function deleteLevel() {
      const found = picked();
      if (!found) {
        say("Pick a level first.");
        return;
      }
      levels = levels.filter(function(level) {
        return level.id !== found.id;
      });
      if (currentId === found.id) currentId = "";
      await writeLevels('Deleted "' + (found.name || found.id) + '".');
    }
    const redraw = function() {
      paintAll();
    };
    const invalidate = function() {
      paint = null;
      paintAll();
    };
    const onTextFocus = function() {
      textBefore = rowsNow();
    };
    const onTextChange = function() {
      if (textBefore) {
        commit(textBefore);
        textBefore = null;
      }
    };
    const scheme = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
    const bound = (
      /** @type {Array<[HTMLElement, string, any]>} */
      [
        [canvas, "pointerdown", onDown],
        [canvas, "pointermove", onMove],
        [canvas, "pointerup", onUp],
        [canvas, "pointercancel", onUp],
        [canvas, "keydown", onKey],
        [canvas, "focus", redraw],
        [canvas, "blur", redraw],
        [ascii, "input", onText],
        [ascii, "focus", onTextFocus],
        [ascii, "change", onTextChange]
      ]
    );
    for (const [node, type, fn] of bound) node.addEventListener(type, fn);
    if (scheme) scheme.addEventListener("change", invalidate);
    const api = {
      el: root,
      /** The map as it stands, one string per row. @returns {string[]} */
      rows() {
        return rowsNow();
      },
      /** Put a map in the editor. It goes on the undo stack, so a person can come back from it, and
       *  it is NOT reported through onChange: the app asked for it and already knows.
       *  @param {string[]} next @returns {void} */
      set(next) {
        commit(rowsNow());
        adopt(toGrid(Array.isArray(next) && next.length ? next : blankMap(cols, rowCount, legend)), false);
      },
      /** Pick the mark the grid paints; one this editor does not offer leaves the tool where it was.
       *  @param {string} char @returns {string} the mark now in hand */
      tool(char) {
        const wanted = String(char);
        if (toolMarks.filter(function(m) {
          return m.char === wanted;
        }).length) toolChar = wanted;
        for (let i = 0; i < toolButtons.length; i += 1) {
          toolButtons[i].setAttribute("aria-pressed", String(toolMarks[i].char === toolChar));
        }
        return toolChar;
      },
      /** Back one state. @returns {void} */
      undo() {
        const previous = past.pop();
        if (!previous) {
          say("Nothing to undo.");
          return;
        }
        future.push(toGrid(rowsNow(), cols));
        adopt(previous, true);
      },
      /** Forward one state. @returns {void} */
      redo() {
        const next = future.pop();
        if (!next) {
          say("Nothing to redo.");
          return;
        }
        past.push(toGrid(rowsNow(), cols));
        adopt(next, true);
      },
      /** An empty map of the same size, with its floor back. @returns {void} */
      clear() {
        commit(rowsNow());
        adopt(toGrid(blankMap(cols, rowCount, legend)), true);
      },
      /** Change the map's size: cells outside it are dropped, new ones start empty.
       *  @param {number} nextCols @param {number} nextRows @returns {void} */
      resize(nextCols, nextRows) {
        const wide = clamp(nextCols, MIN_SIZE, MAX_SIZE, cols);
        const tall = clamp(nextRows, MIN_SIZE, MAX_SIZE, rowCount);
        if (wide === cols && tall === rowCount) return;
        commit(rowsNow());
        const lines = rowsNow().slice(0, tall);
        while (lines.length < tall) lines.push("");
        adopt(toGrid(lines, wide), true);
      },
      destroy() {
        if (gone) return;
        gone = true;
        for (const [node, type, fn] of bound) node.removeEventListener(type, fn);
        if (scheme) scheme.removeEventListener("change", invalidate);
        past.length = 0;
        future.length = 0;
        swatches.length = 0;
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
    build();
    api.tool(toolChar);
    adopt(grid, false);
    if (store) void refreshLevels();
    return api;
  }

  // src/static/sdk-libs/phaser/save.js
  var GUEST_PREFIX = "ak.phaser.";
  var DEBOUNCE_MS = 300;
  var SCORES_KEPT = 20;
  function dataLib() {
    const root = typeof window !== "undefined" ? (
      /** @type {any} */
      window.AIMEAT
    ) : null;
    return root && root.data ? root.data : null;
  }
  function currentSession() {
    const root = typeof window !== "undefined" ? (
      /** @type {any} */
      window.AIMEAT
    ) : null;
    const auth = root && root.auth;
    if (!auth || typeof auth.getSession !== "function") return null;
    try {
      return auth.getSession() || null;
    } catch (err) {
      console.warn("[aimeat-phaser] auth.getSession failed, continuing as a guest:", err);
      return null;
    }
  }
  function num(v) {
    return typeof v === "number" && isFinite(v) ? v : 0;
  }
  function baseState(spec) {
    return (
      /** @type {SaveState} */
      Object.assign({
        version: spec.version,
        profile: { name: "" },
        settings: {},
        levels: {},
        scores: [],
        inventory: {}
      }, spec.defaults || {})
    );
  }
  function normalize(state, spec) {
    const s = (
      /** @type {SaveState} */
      state && typeof state === "object" ? state : {}
    );
    if (typeof s.version !== "number") s.version = spec.version;
    if (!s.profile || typeof s.profile !== "object") s.profile = { name: "" };
    if (typeof s.profile.name !== "string") s.profile.name = "";
    if (!s.settings || typeof s.settings !== "object") s.settings = {};
    if (!s.levels || typeof s.levels !== "object") s.levels = {};
    if (!Array.isArray(s.scores)) s.scores = [];
    if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
    return s;
  }
  function applyVersion(stored, spec) {
    if (!stored || typeof stored !== "object") return null;
    const from = typeof stored.version === "number" ? stored.version : 0;
    if (from === spec.version) return stored;
    if (from > spec.version) {
      console.warn("[aimeat-phaser] the save is version " + from + " and this build expects " + spec.version + ". Keeping it untouched.");
      return stored;
    }
    if (typeof spec.migrate === "function") {
      let next;
      try {
        next = spec.migrate(stored, from);
      } catch (err) {
        console.warn("[aimeat-phaser] migrate() failed, keeping the stored save as it is:", err);
        next = null;
      }
      if (next && typeof next === "object") {
        const out = Object.assign({}, next);
        out.version = spec.version;
        return (
          /** @type {SaveState} */
          out
        );
      }
    }
    const kept = Object.assign({}, stored);
    kept.version = spec.version;
    return (
      /** @type {SaveState} */
      kept
    );
  }
  function mergeLevels(remote, guest) {
    const out = (
      /** @type {Record<string, LevelRecord>} */
      Object.assign({}, remote || {})
    );
    const from = guest || {};
    for (const id in from) {
      const g = from[id] || {};
      const r = out[id] || { unlocked: false, stars: 0, best: 0 };
      out[id] = {
        unlocked: !!(r.unlocked || g.unlocked),
        stars: Math.max(num(r.stars), num(g.stars)),
        best: Math.max(num(r.best), num(g.best))
      };
    }
    return out;
  }
  function mergeGuest(remote, guest) {
    const out = (
      /** @type {SaveState} */
      Object.assign({}, guest, remote)
    );
    out.profile = { name: remote.profile.name || guest.profile.name || "" };
    out.settings = Object.assign({}, guest.settings, remote.settings);
    out.inventory = Object.assign({}, guest.inventory, remote.inventory);
    out.levels = mergeLevels(remote.levels, guest.levels);
    out.best = Math.max(num(remote.best), num(guest.best));
    const scores = remote.scores.concat(guest.scores).filter(function(n) {
      return typeof n === "number";
    });
    scores.sort(function(a, b) {
      return b - a;
    });
    out.scores = scores.slice(0, SCORES_KEPT);
    return out;
  }
  function defaultPublic(state) {
    return {
      name: state.profile.name || "",
      best: num(state.best),
      // The level a board row shows: the app's own `state.level` when it keeps one, else how many
      // levels this player has unlocked, which the library does maintain.
      level: state.level != null ? state.level : Object.keys(state.levels || {}).filter(function(k) {
        return state.levels[k] && state.levels[k].unlocked;
      }).length,
      updated: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function saves(spec) {
    if (!spec || typeof spec.app !== "string" || !spec.app) {
      throw new Error('saves({ app }) needs the app key prefix, for example "ridge"');
    }
    if (typeof spec.version !== "number") {
      throw new Error("saves({ version }) needs a number, so an older save can be migrated");
    }
    const key = spec.key || spec.app + ".save";
    const publicKey = spec.app + ".score";
    const guestKey = GUEST_PREFIX + key;
    const toPublic = typeof spec.public === "function" ? spec.public : defaultPublic;
    let state = baseState(spec);
    let listeners = [];
    let timer = null;
    let pending = null;
    let lastPublic = "";
    let sessionScore = 0;
    let destroyed = false;
    function readGuest() {
      try {
        const raw = localStorage.getItem(guestKey);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.warn("[aimeat-phaser] the guest save could not be read:", err);
        return null;
      }
    }
    function writeGuest() {
      try {
        localStorage.setItem(guestKey, JSON.stringify(state));
      } catch (err) {
        console.warn("[aimeat-phaser] the guest save could not be written:", err);
      }
    }
    function clearGuest() {
      try {
        localStorage.removeItem(guestKey);
      } catch (err) {
        console.warn("[aimeat-phaser] the guest save could not be cleared:", err);
      }
    }
    function emit() {
      for (const fn of listeners.slice()) {
        try {
          fn(state);
        } catch (err) {
          console.warn("[aimeat-phaser] a saves onChange listener threw:", err);
        }
      }
    }
    function touch() {
      emit();
      save();
    }
    async function writeNow() {
      writeGuest();
      const d = dataLib();
      if (!d || !currentSession()) return;
      try {
        await d.set(key, state, { visibility: "private" });
      } catch (err) {
        console.warn("[aimeat-phaser] the save could not be written to the node:", err);
        return;
      }
      let subset;
      try {
        subset = toPublic(state);
      } catch (err) {
        console.warn("[aimeat-phaser] the public subset could not be built:", err);
        return;
      }
      if (!subset || typeof subset !== "object") return;
      const compared = Object.assign({}, subset);
      delete compared.updated;
      const fingerprint = JSON.stringify(compared);
      if (fingerprint === lastPublic) return;
      try {
        await d.set(publicKey, subset, { visibility: "public" });
        lastPublic = fingerprint;
      } catch (err) {
        console.warn("[aimeat-phaser] the public score could not be written:", err);
      }
    }
    async function flush() {
      timer = null;
      const waiting = pending;
      pending = null;
      await writeNow();
      if (waiting) waiting.resolve();
    }
    function save() {
      if (destroyed) return Promise.resolve();
      if (!pending) {
        let settle = function() {
        };
        const promise = new Promise(function(resolve2) {
          settle = /** @type {any} */
          resolve2;
        });
        pending = { promise, resolve: function() {
          settle();
        } };
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
      return pending.promise;
    }
    async function load() {
      const guestRaw = readGuest();
      if (!currentSession()) {
        state = normalize(applyVersion(guestRaw, spec) || baseState(spec), spec);
        emit();
        return state;
      }
      let remote = null;
      const d = dataLib();
      if (d) {
        try {
          remote = await d.get(key);
        } catch (err) {
          console.warn("[aimeat-phaser] the save could not be read from the node:", err);
        }
      }
      let next = applyVersion(remote, spec);
      let merged = false;
      if (guestRaw) {
        const guest = normalize(applyVersion(guestRaw, spec) || baseState(spec), spec);
        next = next ? mergeGuest(normalize(next, spec), guest) : guest;
        clearGuest();
        merged = true;
      }
      state = normalize(next || baseState(spec), spec);
      emit();
      if (merged) save();
      return state;
    }
    function ensureLevel(id) {
      const k = String(id);
      let rec = state.levels[k];
      if (!rec || typeof rec !== "object") {
        rec = { unlocked: false, stars: 0, best: 0 };
        state.levels[k] = rec;
      }
      if (typeof rec.unlocked !== "boolean") rec.unlocked = !!rec.unlocked;
      rec.stars = num(rec.stars);
      rec.best = num(rec.best);
      return rec;
    }
    const levels = {
      /** Open a level. Returns true when it was closed until now. */
      unlock(id) {
        const rec = ensureLevel(id);
        if (rec.unlocked) return false;
        rec.unlocked = true;
        touch();
        return true;
      },
      /** May the player enter this level? */
      isUnlocked(id) {
        const rec = state.levels[String(id)];
        return !!(rec && rec.unlocked);
      },
      /**
       * Read the star rating with one argument, or record a better one with two. Recording returns
       * true when the rating improved.
       * @param {any} id
       * @param {number} [n]
       * @returns {number|boolean}
       */
      stars(id, n) {
        if (n === void 0) {
          const rec2 = state.levels[String(id)];
          return rec2 ? num(rec2.stars) : 0;
        }
        const rec = ensureLevel(id);
        const want = Math.max(0, Math.floor(num(n)));
        if (want <= rec.stars) return false;
        rec.stars = want;
        touch();
        return true;
      },
      /** Record a score on this level. Returns true when it beat what was there. */
      best(id, score2) {
        const rec = ensureLevel(id);
        const want = num(score2);
        if (want <= rec.best) return false;
        rec.best = want;
        touch();
        return true;
      },
      /** This level's record, or null when the player has never reached it. */
      get(id) {
        const rec = state.levels[String(id)];
        return rec ? { unlocked: !!rec.unlocked, stars: num(rec.stars), best: num(rec.best) } : null;
      }
    };
    function score(add) {
      if (typeof add === "number" && isFinite(add) && add !== 0) {
        sessionScore += add;
        if (sessionScore > num(state.best)) {
          state.best = sessionScore;
          touch();
        }
      }
      return sessionScore;
    }
    score.reset = function() {
      const finished = sessionScore;
      sessionScore = 0;
      if (finished > 0) {
        state.scores = state.scores.concat([finished]).sort(function(a, b) {
          return b - a;
        }).slice(0, SCORES_KEPT);
        touch();
      }
      return finished;
    };
    function get() {
      return state;
    }
    function set(patch) {
      if (patch && typeof patch === "object") {
        state = normalize(Object.assign(state, patch), spec);
        touch();
      }
      return state;
    }
    function settings(patch) {
      if (patch && typeof patch === "object") {
        state.settings = Object.assign({}, state.settings, patch);
        touch();
      }
      return Object.assign({}, state.settings);
    }
    function isGuest() {
      return !currentSession();
    }
    function onChange(fn) {
      if (typeof fn !== "function") return function() {
      };
      listeners.push(fn);
      return function() {
        listeners = listeners.filter(function(f) {
          return f !== fn;
        });
      };
    }
    async function leaderboard(opts) {
      const d = dataLib();
      if (!d || typeof d.search !== "function") return [];
      const limit = Math.max(1, Math.floor(num(opts && opts.limit) || 10));
      let res;
      try {
        res = await d.search(publicKey, { visibility: "public" });
      } catch (err) {
        console.warn("[aimeat-phaser] the leaderboard could not be read:", err);
        return [];
      }
      const rows = Array.isArray(res) ? res : res && Array.isArray(res.results) ? res.results : [];
      const out = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        if (row.key && row.key !== publicKey) continue;
        const v = row.value && typeof row.value === "object" ? row.value : {};
        out.push({
          owner: row.owner_gaii || row.ownerGaii || v.owner || "",
          name: typeof v.name === "string" ? v.name : "",
          best: num(v.best),
          level: v.level != null ? v.level : null,
          updated: v.updated || row.updated_at || ""
        });
      }
      out.sort(function(a, b) {
        return b.best - a.best;
      });
      return out.slice(0, limit);
    }
    function destroy() {
      if (destroyed) return;
      if (timer) {
        clearTimeout(timer);
        timer = null;
        flush().catch(function(err) {
          console.warn("[aimeat-phaser] the final save failed:", err);
        });
      }
      destroyed = true;
      listeners = [];
    }
    return {
      load,
      get,
      set,
      save,
      levels,
      score,
      settings,
      isGuest,
      onChange,
      leaderboard,
      destroy
    };
  }

  // src/static/sdk-libs/phaser/controls.js
  var DEFAULT_SCHEME = {
    left: ["LEFT", "A"],
    right: ["RIGHT", "D"],
    up: ["UP", "W"],
    down: ["DOWN", "S"],
    jump: ["SPACE", "UP", "W"],
    action: ["X", "K", "ENTER"],
    pause: ["ESC", "P"]
  };
  var ACTIONS = ["left", "right", "up", "down", "jump", "action", "pause"];
  var DEFAULT_DEAD_ZONE = 0.2;
  var KNOB_TRAVEL = 0.62;
  function readPad(scene) {
    const gp = scene && scene.input && scene.input.gamepad;
    if (!gp || !gp.total) return null;
    if (gp.pad1) return gp.pad1;
    if (typeof gp.getPad === "function") {
      const p = gp.getPad(0);
      if (p) return p;
    }
    return gp.gamepads && gp.gamepads[0] || null;
  }
  function applyDeadZone(v, dead) {
    const n = typeof v === "number" && isFinite(v) ? v : 0;
    const mag = Math.abs(n);
    if (mag <= dead) return 0;
    const scaled = (mag - dead) / (1 - dead);
    return n < 0 ? -scaled : scaled;
  }
  function clamp1(v) {
    return v < -1 ? -1 : v > 1 ? 1 : v;
  }
  function buildOverlay(host) {
    const doc = host.ownerDocument || document;
    const root = doc.createElement("div");
    root.className = "ak-touchpad";
    const stick = doc.createElement("div");
    stick.className = "ak-touchpad__stick";
    stick.setAttribute("role", "application");
    stick.setAttribute("aria-label", "Movement stick");
    const knob = doc.createElement("div");
    knob.className = "ak-touchpad__knob";
    stick.appendChild(knob);
    const bank = doc.createElement("div");
    bank.className = "ak-touchpad__bank";
    const jumpBtn = doc.createElement("button");
    jumpBtn.type = "button";
    jumpBtn.className = "ak-touchpad__btn ak-touchpad__btn--jump";
    jumpBtn.textContent = "Jump";
    const actionBtn = doc.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "ak-touchpad__btn ak-touchpad__btn--action";
    actionBtn.textContent = "Act";
    bank.appendChild(jumpBtn);
    bank.appendChild(actionBtn);
    root.appendChild(stick);
    root.appendChild(bank);
    host.classList.add("ak-touchpad-host");
    host.appendChild(root);
    const touch = {
      x: 0,
      y: 0,
      active: false,
      jump: false,
      action: false,
      jumpTap: false,
      actionTap: false
    };
    const undo = [];
    let pointerId = -1;
    function place(dx, dy) {
      knob.style.setProperty("--ak-touchpad-knob-x", (dx * KNOB_TRAVEL * 100).toFixed(1) + "%");
      knob.style.setProperty("--ak-touchpad-knob-y", (dy * KNOB_TRAVEL * 100).toFixed(1) + "%");
    }
    function readStick(ev) {
      const box = stick.getBoundingClientRect();
      const radius = Math.max(1, Math.min(box.width, box.height) / 2);
      const dx = clamp1((ev.clientX - (box.left + box.width / 2)) / radius);
      const dy = clamp1((ev.clientY - (box.top + box.height / 2)) / radius);
      touch.x = dx;
      touch.y = dy;
      place(dx, dy);
    }
    function springBack() {
      pointerId = -1;
      touch.active = false;
      touch.x = 0;
      touch.y = 0;
      stick.classList.remove("is-held");
      place(0, 0);
    }
    function onStickDown(ev) {
      pointerId = ev.pointerId;
      touch.active = true;
      stick.classList.add("is-held");
      if (typeof stick.setPointerCapture === "function") {
        try {
          stick.setPointerCapture(ev.pointerId);
        } catch (err) {
          console.warn("[aimeat-phaser] the stick could not capture the pointer:", err);
        }
      }
      readStick(ev);
      ev.preventDefault();
    }
    function onStickMove(ev) {
      if (!touch.active || ev.pointerId !== pointerId) return;
      readStick(ev);
      ev.preventDefault();
    }
    function onStickUp(ev) {
      if (ev.pointerId !== pointerId) return;
      springBack();
      ev.preventDefault();
    }
    function bind(node, type, fn) {
      node.addEventListener(type, fn);
      undo.push(function() {
        node.removeEventListener(type, fn);
      });
    }
    bind(stick, "pointerdown", onStickDown);
    bind(stick, "pointermove", onStickMove);
    bind(stick, "pointerup", onStickUp);
    bind(stick, "pointercancel", onStickUp);
    function wireButton(node, name) {
      bind(node, "pointerdown", function(ev) {
        touch[name] = true;
        touch[name + "Tap"] = true;
        node.classList.add("is-held");
        ev.preventDefault();
      });
      const release = function(ev) {
        touch[name] = false;
        node.classList.remove("is-held");
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      };
      bind(node, "pointerup", release);
      bind(node, "pointercancel", release);
      bind(node, "pointerleave", release);
      bind(node, "click", function(ev) {
        ev.preventDefault();
      });
    }
    wireButton(jumpBtn, "jump");
    wireButton(actionBtn, "action");
    return {
      root,
      touch,
      /**
       * Say WHEN the pad shows, and let the stylesheet decide whether that is now: 'auto' shows it
       * on a coarse pointer only, 'on' always, 'off' never. Keeping the media query in CSS means a
       * phone that is also holding a keyboard does not need this module to re-run anything.
       * @param {'auto'|'on'|'off'} mode
       */
      show(mode) {
        root.setAttribute("data-ak-touch", mode);
        if (mode === "off") springBack();
      },
      destroy() {
        for (const off of undo) off();
        springBack();
        host.classList.remove("ak-touchpad-host");
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }
  function controls(scene, opts) {
    const o = opts || {};
    const useKeyboard = o.keyboard !== false;
    const useWasd = o.wasd !== false;
    const useGamepad = o.gamepad !== false;
    const dead = typeof o.deadZone === "number" ? Math.min(0.9, Math.max(0, o.deadZone)) : DEFAULT_DEAD_ZONE;
    const scheme = {};
    for (const name of ACTIONS) {
      const given = o.scheme && /** @type {any} */
      o.scheme[name];
      scheme[name] = Array.isArray(given) ? given.slice() : DEFAULT_SCHEME[name].slice();
    }
    if (!useWasd) {
      const letters = ["W", "A", "S", "D"];
      for (const name of ACTIONS) {
        scheme[name] = scheme[name].filter(function(k) {
          return letters.indexOf(k) < 0;
        });
      }
    }
    const keys = {};
    const keyboard = useKeyboard && scene && scene.input ? scene.input.keyboard : null;
    function ensureKey(codeName) {
      if (!keyboard || keys[codeName]) return;
      try {
        keys[codeName] = keyboard.addKey(codeName);
      } catch (err) {
        console.warn('[aimeat-phaser] key "' + codeName + '" could not be bound:', err);
      }
    }
    for (const name of ACTIONS) {
      for (const codeName of scheme[name]) ensureKey(codeName);
    }
    const state = (
      /** @type {any} */
      {
        left: false,
        right: false,
        up: false,
        down: false,
        jump: false,
        action: false,
        pause: false,
        axis: { x: 0, y: 0 }
      }
    );
    const previous = {};
    const edges = {};
    for (const name of ACTIONS) {
      previous[name] = false;
      edges[name] = false;
    }
    const handlers = {};
    function fire(name) {
      const list = handlers[name];
      if (!list) return;
      for (const fn of list.slice()) {
        try {
          fn();
        } catch (err) {
          console.warn('[aimeat-phaser] a controls handler for "' + name + '" threw:', err);
        }
      }
    }
    const touchMode = o.touch === void 0 || o.touch === "auto" ? "auto" : o.touch ? "on" : "off";
    const host = o.touchTarget || scene && scene.game && scene.game.canvas && scene.game.canvas.parentElement || (typeof document !== "undefined" ? document.body : null);
    let overlay = null;
    if (host) {
      overlay = buildOverlay(host);
      overlay.show(touchMode);
    }
    function keyHeld(name) {
      const list = scheme[name];
      for (const codeName of list) {
        const k = keys[codeName];
        if (k && k.isDown) return true;
      }
      return false;
    }
    function update() {
      const pad2 = useGamepad ? readPad(scene) : null;
      const touch = overlay ? overlay.touch : null;
      let ax = 0;
      let ay = 0;
      if (touch && touch.active) {
        ax = applyDeadZone(touch.x, dead);
        ay = applyDeadZone(touch.y, dead);
      }
      if (pad2 && ax === 0 && ay === 0) {
        const stick = pad2.leftStick;
        if (stick) {
          ax = applyDeadZone(stick.x, dead);
          ay = applyDeadZone(stick.y, dead);
        } else if (pad2.axes && pad2.axes.length >= 2) {
          ax = applyDeadZone(pad2.axes[0].getValue(), dead);
          ay = applyDeadZone(pad2.axes[1].getValue(), dead);
        }
      }
      const padLeft = !!(pad2 && pad2.left);
      const padRight = !!(pad2 && pad2.right);
      const padUp = !!(pad2 && pad2.up);
      const padDown = !!(pad2 && pad2.down);
      let left = keyHeld("left") || padLeft || ax < -dead;
      let right = keyHeld("right") || padRight || ax > dead;
      let up = keyHeld("up") || padUp || ay < -dead;
      let down = keyHeld("down") || padDown || ay > dead;
      if (ax === 0) ax = (right ? 1 : 0) - (left ? 1 : 0);
      if (ay === 0) ay = (down ? 1 : 0) - (up ? 1 : 0);
      state.left = left;
      state.right = right;
      state.up = up;
      state.down = down;
      state.jump = keyHeld("jump") || !!(touch && (touch.jump || touch.jumpTap)) || !!(pad2 && pad2.A);
      state.action = keyHeld("action") || !!(touch && (touch.action || touch.actionTap)) || !!(pad2 && (pad2.B || pad2.X));
      state.pause = keyHeld("pause") || !!(pad2 && pad2.buttons && pad2.buttons[9] && pad2.buttons[9].pressed);
      state.axis.x = clamp1(ax);
      state.axis.y = clamp1(ay);
      for (const name of ACTIONS) {
        const now = !!state[name];
        edges[name] = now && !previous[name];
        previous[name] = now;
        if (edges[name]) fire(name);
      }
      if (touch) {
        touch.jumpTap = false;
        touch.actionTap = false;
      }
    }
    function justPressed(name) {
      return !!edges[name];
    }
    function on(name, fn) {
      if (typeof fn !== "function" || ACTIONS.indexOf(name) < 0) {
        return function() {
        };
      }
      if (!handlers[name]) handlers[name] = [];
      handlers[name].push(fn);
      return function() {
        handlers[name] = handlers[name].filter(function(f) {
          return f !== fn;
        });
      };
    }
    function rebind(name, nextKeys) {
      if (ACTIONS.indexOf(name) < 0 || !Array.isArray(nextKeys)) return;
      scheme[name] = nextKeys.slice();
      for (const codeName of scheme[name]) ensureKey(codeName);
    }
    function bindings() {
      const out = {};
      for (const name of ACTIONS) out[name] = scheme[name].slice();
      return out;
    }
    function showTouch(on2) {
      if (overlay) overlay.show(on2 ? "on" : "off");
    }
    function vibrate(ms2) {
      const n = typeof ms2 === "number" && isFinite(ms2) ? Math.max(1, Math.min(1e3, ms2)) : 20;
      if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
      try {
        return !!navigator.vibrate(n);
      } catch (err) {
        console.warn("[aimeat-phaser] vibrate was refused:", err);
        return false;
      }
    }
    function destroy() {
      if (keyboard && typeof keyboard.removeKey === "function") {
        for (const codeName in keys) {
          try {
            keyboard.removeKey(keys[codeName]);
          } catch (err) {
            console.warn('[aimeat-phaser] key "' + codeName + '" could not be released:', err);
          }
          delete keys[codeName];
        }
      }
      if (overlay) {
        overlay.destroy();
        overlay = null;
      }
      for (const name of ACTIONS) handlers[name] = [];
    }
    state.update = update;
    state.justPressed = justPressed;
    state.on = on;
    state.rebind = rebind;
    state.bindings = bindings;
    state.showTouch = showTouch;
    state.vibrate = vibrate;
    state.destroy = destroy;
    return state;
  }

  // src/static/sdk-libs/phaser/hud.js
  var HUD_DEPTH = 900;
  var TOAST_DEPTH = 950;
  var POP_SCALE = 1.16;
  var POP_MS = 120;
  var TOAST_MS = 1600;
  var TOAST_RISE = 30;
  function themeHost(scene, opts) {
    if (opts && opts.themeFrom) return opts.themeFrom;
    const canvas = scene && scene.game && scene.game.canvas;
    if (!canvas) return typeof document !== "undefined" ? document.body : null;
    return canvas.parentElement || canvas;
  }
  function clock(seconds) {
    const total = Math.max(0, Math.floor(typeof seconds === "number" && isFinite(seconds) ? seconds : 0));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + (s < 10 ? "0" + s : String(s));
  }
  function heartTexture(scene, colour) {
    const key = "ak-phaser-heart-" + (colour >>> 0 & 16777215).toString(16);
    if (scene.textures && scene.textures.exists(key)) return key;
    const size = 18;
    const g = scene.add.graphics();
    g.fillStyle(colour, 1);
    const r = size * 0.26;
    g.fillCircle(size * 0.3, size * 0.32, r);
    g.fillCircle(size * 0.7, size * 0.32, r);
    g.fillTriangle(size * 0.04, size * 0.38, size * 0.96, size * 0.38, size * 0.5, size * 0.95);
    g.generateTexture(key, size, size);
    g.destroy();
    return key;
  }
  function hud(scene, opts) {
    const o = opts || {};
    const t = theme(themeHost(scene, o));
    const depth = typeof o.depth === "number" ? o.depth : HUD_DEPTH;
    const pad2 = typeof o.pad === "number" ? o.pad : 14;
    const inkCss = hex(t.ink);
    const dimCss = hex(t.inkDim);
    const width = function() {
      return scene.scale.width;
    };
    const scoreText = scene.add.text(pad2, pad2, "0", {
      fontFamily: t.fontDisplay,
      fontSize: "30px",
      color: inkCss
    }).setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
    const levelText = scene.add.text(width() - pad2, pad2, "", {
      fontFamily: t.fontMono,
      fontSize: "15px",
      color: dimCss
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(depth);
    const timeText = scene.add.text(width() - pad2, pad2 + 22, "", {
      fontFamily: t.fontMono,
      fontSize: "15px",
      color: inkCss
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(depth);
    const messageText = scene.add.text(width() / 2, pad2 + 54, "", {
      fontFamily: t.font,
      fontSize: "18px",
      color: inkCss,
      align: "center"
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(depth);
    messageText.setVisible(false);
    const heartKey = heartTexture(scene, t.err);
    let hearts = [];
    let liveCount = 0;
    let scoreValue = 0;
    let timeValue = -1;
    let messageTimer = null;
    let dead = false;
    function pop(target) {
      if (!scene.tweens) return;
      scene.tweens.add({
        targets: target,
        scale: POP_SCALE,
        duration: POP_MS,
        yoyo: true,
        ease: "Quad.easeOut"
      });
    }
    function layout() {
      if (dead) return;
      levelText.setX(width() - pad2);
      timeText.setX(width() - pad2);
      messageText.setX(width() / 2);
      placeHearts();
    }
    function placeHearts() {
      const top = pad2 + scoreText.height + 6;
      for (let i = 0; i < hearts.length; i++) {
        hearts[i].setPosition(pad2 + 9 + i * 22, top + 9);
      }
    }
    function lives(n) {
      if (dead) return;
      const want = Math.max(0, Math.floor(typeof n === "number" && isFinite(n) ? n : 0));
      while (hearts.length > want) {
        const gone = hearts.pop();
        if (gone) gone.destroy();
      }
      while (hearts.length < want) {
        const img = scene.add.image(0, 0, heartKey).setScrollFactor(0).setDepth(depth);
        hearts.push(img);
      }
      placeHearts();
      if (want !== liveCount && hearts.length > 0) pop(hearts[hearts.length - 1]);
      liveCount = want;
    }
    function score(v) {
      if (dead) return;
      const next = typeof v === "number" && isFinite(v) ? Math.round(v) : 0;
      const changed = next !== scoreValue;
      scoreValue = next;
      scoreText.setText(String(next));
      if (changed) pop(scoreText);
    }
    function level(text) {
      if (dead) return;
      levelText.setText(text == null ? "" : String(text));
    }
    function time(seconds) {
      if (dead) return;
      const next = Math.max(0, Math.floor(typeof seconds === "number" && isFinite(seconds) ? seconds : 0));
      const changed = next !== timeValue;
      timeValue = next;
      timeText.setText(clock(next));
      if (changed) pop(timeText);
    }
    function message(text, ms2) {
      if (dead) return;
      if (messageTimer) {
        messageTimer.remove(false);
        messageTimer = null;
      }
      const str = text == null ? "" : String(text);
      messageText.setText(str);
      messageText.setVisible(!!str);
      messageText.setAlpha(1);
      if (!str) return;
      const hold = typeof ms2 === "number" && isFinite(ms2) ? Math.max(200, ms2) : 1400;
      messageTimer = scene.time.delayedCall(hold, function() {
        messageTimer = null;
        if (dead) return;
        messageText.setVisible(false);
      });
    }
    function set(values) {
      if (!values || typeof values !== "object") return;
      if (typeof values.score === "number") score(values.score);
      if (typeof values.lives === "number") lives(values.lives);
      if (values.level !== void 0) level(values.level);
    }
    const onResize = function() {
      layout();
    };
    if (scene.scale && typeof scene.scale.on === "function") scene.scale.on("resize", onResize);
    function destroy() {
      if (dead) return;
      dead = true;
      if (scene.scale && typeof scene.scale.off === "function") scene.scale.off("resize", onResize);
      if (messageTimer) {
        messageTimer.remove(false);
        messageTimer = null;
      }
      if (scene.tweens) {
        scene.tweens.killTweensOf(scoreText);
        scene.tweens.killTweensOf(timeText);
        for (const h of hearts) scene.tweens.killTweensOf(h);
      }
      for (const h of hearts) h.destroy();
      hearts = [];
      scoreText.destroy();
      levelText.destroy();
      timeText.destroy();
      messageText.destroy();
    }
    if (typeof o.score === "number") score(o.score);
    if (typeof o.lives === "number") lives(o.lives);
    if (o.level !== void 0) level(o.level);
    if (typeof o.time === "number") time(o.time);
    return {
      score,
      lives,
      level,
      time,
      message,
      set,
      destroy
    };
  }
  function toast(scene, text, opts) {
    const o = opts || {};
    const t = theme(themeHost(scene, o));
    const depth = typeof o.depth === "number" ? o.depth : TOAST_DEPTH;
    const hold = typeof o.ms === "number" && isFinite(o.ms) ? Math.max(300, o.ms) : TOAST_MS;
    const rise = typeof o.rise === "number" ? o.rise : TOAST_RISE;
    const edge = o.tone === "ok" ? t.ok : o.tone === "warn" ? t.warn : o.tone === "err" ? t.err : t.line;
    const label = scene.add.text(0, 0, text == null ? "" : String(text), {
      fontFamily: t.font,
      fontSize: "16px",
      color: hex(t.ink),
      align: "center"
    }).setOrigin(0.5, 0.5);
    const w = Math.ceil(label.width) + 34;
    const h = Math.ceil(label.height) + 18;
    const r = h / 2;
    const pill = scene.add.graphics();
    pill.fillStyle(t.surface, 0.96);
    pill.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    pill.lineStyle(1, edge, 1);
    pill.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
    const x = scene.scale.width / 2;
    const y = typeof o.y === "number" ? o.y : scene.scale.height * 0.72;
    const box = scene.add.container(x, y, [pill, label]).setScrollFactor(0).setDepth(depth).setAlpha(0);
    scene.tweens.add({
      targets: box,
      alpha: 1,
      y: y - 8,
      duration: 160,
      ease: "Quad.easeOut"
    });
    scene.time.delayedCall(hold, function() {
      if (!box.scene) return;
      scene.tweens.add({
        targets: box,
        alpha: 0,
        y: y - rise,
        duration: 260,
        ease: "Quad.easeIn",
        onComplete: function() {
          box.destroy();
        }
      });
    });
    return box;
  }

  // src/static/sdk-libs/phaser/transitions.js
  function transition(scene, toKey, opts) {
    const o = opts || {};
    const th = look(scene);
    const kind = reducedMotion() ? "cut" : o.kind || "fade";
    const span = o.duration != null ? o.duration : Math.max(180, ms(th.motion, 200) * 2);
    const tint = o.colour === "ink" ? th.ink : o.colour === "accent" ? th.accent : th.bg;
    const ease = curve(th);
    if (kind === "cut") {
      scene.scene.start(toKey, o.data);
      return Promise.resolve();
    }
    if (kind === "fade") return fadeOver(scene, toKey, o.data, span, tint);
    if (kind === "wipe") return coverOver(scene, toKey, o.data, span, tint, ease, wipeIn, wipeOut);
    return coverOver(scene, toKey, o.data, span, tint, ease, irisIn, irisOut);
  }
  function fadeOver(scene, toKey, data, span, tint) {
    const c = channels(tint);
    return new Promise(function(done) {
      scene.cameras.main.fadeOut(span, c.r, c.g, c.b, function(camera, progress) {
        if (progress < 1) return;
        onceCreated(scene, toKey, function(target) {
          target.cameras.main.fadeIn(span, c.r, c.g, c.b);
        });
        scene.scene.start(toKey, data);
        done();
      });
    });
  }
  function coverOver(scene, toKey, data, span, tint, ease, cover, uncover) {
    return cover(scene, span, tint, ease).then(function() {
      onceCreated(scene, toKey, function(target) {
        uncover(target, span, tint, ease);
      });
      scene.scene.start(toKey, data);
    });
  }
  function onceCreated(scene, toKey, run) {
    const target = scene.scene.get(toKey);
    if (!target) return;
    const events = target.events || (target.sys ? target.sys.events : null);
    if (!events) return;
    events.once("create", function() {
      run(target);
    });
  }
  function wipeIn(scene, span, tint, ease) {
    const width = scene.scale.width;
    const height = scene.scale.height;
    const bar = scene.add.rectangle(0, height / 2, width, height, tint).setOrigin(0, 0.5);
    bar.setScrollFactor(0).setDepth(OVERLAY_DEPTH).setScale(0, 1);
    return new Promise(function(done) {
      scene.tweens.add({ targets: bar, scaleX: 1, duration: span, ease, onComplete: function() {
        done();
      } });
    });
  }
  function wipeOut(scene, span, tint, ease) {
    const width = scene.scale.width;
    const height = scene.scale.height;
    const bar = scene.add.rectangle(width, height / 2, width, height, tint).setOrigin(1, 0.5);
    bar.setScrollFactor(0).setDepth(OVERLAY_DEPTH);
    scene.tweens.add({
      targets: bar,
      scaleX: 0,
      duration: span,
      ease,
      onComplete: function() {
        bar.destroy();
      }
    });
  }
  function irisIn(scene, span, tint, ease) {
    const ring = makeRing(scene, tint);
    return new Promise(function(done) {
      scene.tweens.add({
        targets: ring.state,
        r: 0,
        duration: span,
        ease,
        onUpdate: ring.draw,
        onComplete: function() {
          ring.draw();
          done();
        }
      });
    });
  }
  function irisOut(scene, span, tint, ease) {
    const ring = makeRing(scene, tint);
    ring.state.r = 0;
    ring.draw();
    scene.tweens.add({
      targets: ring.state,
      r: ring.outer,
      duration: span,
      ease,
      onUpdate: ring.draw,
      onComplete: function() {
        ring.graphics.destroy();
      }
    });
  }
  function makeRing(scene, tint) {
    const width = scene.scale.width;
    const height = scene.scale.height;
    const cx = width / 2;
    const cy = height / 2;
    const outer = Math.sqrt(width * width + height * height) / 2 + 4;
    const g = scene.add.graphics();
    g.setScrollFactor(0).setDepth(OVERLAY_DEPTH);
    const state = { r: outer };
    const draw = function() {
      const inner = Math.max(0, state.r);
      g.clear();
      if (inner >= outer) return;
      g.lineStyle(outer - inner, tint, 1);
      g.strokeCircle(cx, cy, (outer + inner) / 2);
    };
    draw();
    return { graphics: g, state, outer, draw };
  }

  // src/static/sdk-libs/phaser/menus.js
  var PAUSE_KEY = "ak-pause";
  var SHAKE_PX = 9;
  function menuItems(scene, spec) {
    const s = spec || /** @type {any} */
    {};
    const th = look(scene);
    const still = reducedMotion();
    const items = (s.items || []).slice();
    const gap = s.gap != null ? s.gap : 46;
    const size = s.size != null ? s.size : 26;
    const family = s.font || th.font;
    const centred = s.align === "center";
    const cursorKind = s.cursor || "bar";
    const arrival = s.motion || "stagger";
    const pace = ms(th.motion, 200);
    const ease = curve(th);
    const labelStyle = { fontFamily: family, fontSize: size + "px", color: hex(th.ink) };
    const hintStyle = { fontFamily: family, fontSize: Math.round(size * 0.56) + "px", color: hex(th.inkDim) };
    const root = scene.add.container(s.x || 0, s.y || 0);
    root.setDepth(OVERLAY_DEPTH - 10);
    const rows = [];
    const timers = [];
    let index = 0;
    let live = true;
    let gone = false;
    const cursor = buildCursor();
    if (cursor) root.add(cursor);
    items.forEach(buildRow);
    function buildCursor() {
      if (cursorKind === "glow") return null;
      if (cursorKind === "arrow") {
        const mark2 = scene.add.text(0, 0, "→", { fontFamily: family, fontSize: size + "px", color: hex(th.accent) });
        return mark2.setOrigin(1, 0.5);
      }
      const bar = scene.add.rectangle(0, 0, Math.max(3, Math.round(size / 7)), size, th.accent);
      return bar.setOrigin(1, 0.5);
    }
    function buildRow(item, i) {
      const box = scene.add.container(0, i * gap);
      const label = scene.add.text(0, 0, item.label, labelStyle);
      label.setOrigin(centred ? 0.5 : 0, 0.5);
      if (item.locked) label.setAlpha(0.55);
      box.add(label);
      let hint = null;
      if (item.hint) {
        hint = scene.add.text(0, Math.round(size * 0.78), item.hint, hintStyle);
        hint.setOrigin(centred ? 0.5 : 0, 0.5);
        box.add(hint);
      }
      root.add(box);
      label.setInteractive({ useHandCursor: true });
      label.on("pointerover", function() {
        if (live) api.select(i);
      });
      label.on("pointerdown", function() {
        if (live) pick(i);
      });
      rows.push({ item, box, label, hint, text: item.label, homeX: 0 });
    }
    function mark() {
      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i];
        const on = i === index;
        const locked = !!r.item.locked;
        r.label.setColor(hex(on ? th.accent : th.ink));
        r.label.setAlpha(locked ? 0.55 : 1);
        if (cursorKind === "glow") r.label.setScale(on ? 1.08 : 1);
      }
      if (!cursor || !rows.length) return;
      const row = rows[index];
      const left = centred ? row.label.x - row.label.width / 2 : row.label.x;
      const toX = left - Math.round(size * 0.55);
      const toY = row.box.y;
      if (still) {
        cursor.setPosition(toX, toY);
        return;
      }
      scene.tweens.add({ targets: cursor, x: toX, y: toY, duration: Math.round(pace * 0.9), ease });
    }
    function pick(i) {
      if (!live || !rows[i]) return;
      api.select(i);
      const row = rows[i];
      if (row.item.locked) {
        refuse(row);
        return;
      }
      if (typeof row.item.onPick === "function") row.item.onPick();
    }
    function refuse(row) {
      if (still) return;
      scene.tweens.killTweensOf(row.box);
      row.box.x = row.homeX;
      scene.tweens.add({
        targets: row.box,
        x: row.homeX + SHAKE_PX,
        duration: Math.round(pace * 0.28),
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: 2,
        onComplete: function() {
          row.box.x = row.homeX;
        }
      });
    }
    function arrive() {
      if (still) {
        if (arrival === "typewriter") for (const r of rows) r.label.setText(r.text);
        mark();
        return;
      }
      const step = Math.round(pace * 0.35);
      const span = Math.round(pace * 1.6);
      if (arrival === "typewriter") {
        for (const r of rows) r.label.setText("");
        rows.forEach(function(r, i) {
          type(r, i * (step + r.text.length * 8));
        });
        mark();
        return;
      }
      rows.forEach(function(r, i) {
        const from = {};
        if (arrival === "slide") {
          r.box.x = r.homeX - 48;
          from.x = r.homeX;
        } else if (arrival === "zoom") {
          r.box.setScale(0.86);
          from.scaleX = 1;
          from.scaleY = 1;
        } else {
          r.box.y = i * gap + 14;
          from.y = i * gap;
        }
        r.box.setAlpha(0);
        scene.tweens.add(Object.assign({
          targets: r.box,
          alpha: 1,
          delay: i * step,
          duration: span,
          ease
        }, from));
      });
      mark();
    }
    function type(row, delay) {
      const chars = row.text.length;
      if (!chars) return;
      const ev = scene.time.addEvent({
        delay: Math.max(16, Math.round(pace / 8)),
        repeat: chars - 1,
        startAt: 0,
        paused: false,
        callback: function() {
          row.label.setText(row.text.slice(0, chars - ev.repeatCount));
        }
      });
      timers.push(ev);
      if (delay > 0) {
        ev.paused = true;
        timers.push(scene.time.delayedCall(delay, function() {
          ev.paused = false;
        }));
      }
    }
    const keyboard = scene.input && scene.input.keyboard ? scene.input.keyboard : null;
    const onPrev = function() {
      if (live) api.select(index - 1);
    };
    const onNext = function() {
      if (live) api.select(index + 1);
    };
    const onEnter = function() {
      if (live) pick(index);
    };
    if (keyboard) {
      keyboard.on("keydown-UP", onPrev);
      keyboard.on("keydown-W", onPrev);
      keyboard.on("keydown-DOWN", onNext);
      keyboard.on("keydown-S", onNext);
      keyboard.on("keydown-ENTER", onEnter);
      keyboard.on("keydown-SPACE", onEnter);
    }
    const held = { prev: false, next: false, act: false };
    const tick = function() {
      const c = s.controls;
      if (!live || !c) return;
      const prev = c.up != null ? !!c.up : !!c.left;
      const next = c.down != null ? !!c.down : !!c.right;
      const act = !!(c.action || c.jump);
      if (prev && !held.prev) api.select(index - 1);
      if (next && !held.next) api.select(index + 1);
      if (act && !held.act) pick(index);
      held.prev = prev;
      held.next = next;
      held.act = act;
    };
    if (s.controls) scene.events.on("update", tick);
    const api = {
      el: root,
      /**
       * Move the selection. Out-of-range wraps, so a pad never dead-ends at the last item.
       * @param {number} i
       */
      select(i) {
        if (!rows.length) return;
        const n = rows.length;
        index = (i % n + n) % n;
        mark();
      },
      /** @returns {number} the selected item's position */
      current() {
        return index;
      },
      /** @param {boolean} on  whether picks and moves are answered at all */
      enable(on) {
        live = !!on;
        root.setAlpha(live ? 1 : 0.5);
        for (const r of rows) {
          if (live) r.label.setInteractive({ useHandCursor: true });
          else r.label.disableInteractive();
        }
      },
      destroy() {
        if (gone) return;
        gone = true;
        if (keyboard) {
          keyboard.off("keydown-UP", onPrev);
          keyboard.off("keydown-W", onPrev);
          keyboard.off("keydown-DOWN", onNext);
          keyboard.off("keydown-S", onNext);
          keyboard.off("keydown-ENTER", onEnter);
          keyboard.off("keydown-SPACE", onEnter);
        }
        scene.events.off("update", tick);
        scene.events.off("shutdown", api.destroy);
        for (const ev of timers) if (ev && typeof ev.remove === "function") ev.remove(false);
        timers.length = 0;
        for (const r of rows) scene.tweens.killTweensOf(r.box);
        if (cursor) scene.tweens.killTweensOf(cursor);
        root.destroy(true);
      }
    };
    scene.events.once("shutdown", api.destroy);
    api.select(s.index || 0);
    arrive();
    return api;
  }
  function titleScene(spec) {
    const s = spec || /** @type {any} */
    {};
    return {
      key: s.key || "title",
      create: function() {
        buildTitle(
          /** @type {any} */
          this,
          s
        );
      }
    };
  }
  function buildTitle(scene, s) {
    const th = look(scene);
    const still = reducedMotion();
    const width = scene.scale.width;
    const height = scene.scale.height;
    const pace = ms(th.motion, 200);
    scene.cameras.main.setBackgroundColor(th.bg);
    drawBackdrop(scene, s.backdrop || "grid", th, still);
    const titleSize = Math.max(30, Math.round(Math.min(width, height) * 0.11));
    const style = {
      fontFamily: th.fontDisplay || th.font,
      fontSize: titleSize + "px",
      color: hex(th.ink)
    };
    const titleY = Math.round(height * 0.24);
    const kinetic = (s.titleMotion || "drop") === "kinetic";
    const heading = kinetic ? null : scene.add.text(width / 2, titleY, s.title || "", style).setOrigin(0.5, 0.5);
    if (heading) enterTitle(scene, heading, s.titleMotion || "drop", pace, still, th);
    else throwLetters(scene, s.title || "", width / 2, titleY, style, pace, still, th);
    if (s.sub) {
      const sub = scene.add.text(width / 2, titleY + Math.round(titleSize * 0.86), s.sub, {
        fontFamily: th.font,
        fontSize: Math.round(titleSize * 0.3) + "px",
        color: hex(th.inkDim)
      }).setOrigin(0.5, 0.5);
      if (!still) {
        sub.setAlpha(0);
        scene.tweens.add({ targets: sub, alpha: 1, delay: pace * 2, duration: pace * 2, ease: curve(th) });
      }
    }
    menuItems(scene, {
      x: width / 2,
      y: Math.round(height * 0.55),
      align: "center",
      motion: s.motion || "stagger",
      cursor: "bar",
      controls: s.controls,
      items: (s.items || []).map(function(item) {
        return {
          label: item.label,
          locked: item.locked,
          hint: item.hint,
          onPick: function() {
            if (typeof item.onPick === "function") item.onPick();
            if (item.scene) scene.scene.start(item.scene);
          }
        };
      })
    });
    if (s.version) {
      scene.add.text(width - 12, height - 10, s.version, {
        fontFamily: th.fontMono || th.font,
        fontSize: "12px",
        color: hex(th.inkDim)
      }).setOrigin(1, 1).setAlpha(0.8);
    }
  }
  function drawBackdrop(scene, kind, th, still) {
    if (kind === "none") return;
    const width = scene.scale.width;
    const height = scene.scale.height;
    if (kind === "stars") {
      const count = Math.min(90, Math.round(width * height / 9e3));
      for (let i = 0; i < count; i += 1) {
        const size = 1 + Math.round(Math.random() * 2);
        const star = scene.add.rectangle(Math.random() * width, Math.random() * height, size, size, th.ink);
        star.setAlpha(still ? 0.35 : 0);
        if (still) continue;
        scene.tweens.add({
          targets: star,
          alpha: 0.35,
          duration: 260 + Math.random() * 420,
          delay: Math.random() * 700,
          yoyo: true,
          hold: 120,
          repeat: 0,
          onComplete: function() {
            star.setAlpha(0.35);
          }
        });
      }
      return;
    }
    const g = scene.add.graphics();
    g.lineStyle(1, th.line, 0.5);
    const step = 48;
    for (let x = 0; x <= width; x += step) g.lineBetween(x, 0, x, height);
    for (let y = 0; y <= height; y += step) g.lineBetween(0, y, width, y);
    g.setDepth(-10);
  }
  function enterTitle(scene, heading, kind, pace, still, th) {
    if (still) return;
    if (kind === "typewriter") {
      const full = heading.text;
      heading.setText("");
      const ev = scene.time.addEvent({
        delay: Math.max(28, Math.round(pace / 5)),
        repeat: Math.max(0, full.length - 1),
        callback: function() {
          heading.setText(full.slice(0, full.length - ev.repeatCount));
        }
      });
      return;
    }
    const home = heading.y;
    heading.y = home - Math.max(60, pace);
    heading.setAlpha(0);
    scene.tweens.add({ targets: heading, y: home, alpha: 1, duration: pace * 3, ease: "Back.easeOut" });
    void th;
  }
  function throwLetters(scene, text, cx, cy, style, pace, still, th) {
    const chars = Array.from(text);
    const made = [];
    let total = 0;
    for (const ch of chars) {
      const letter = scene.add.text(0, cy, ch, style).setOrigin(0, 0.5);
      made.push(letter);
      total += letter.width;
    }
    let x = cx - total / 2;
    made.forEach(function(letter, i) {
      letter.x = x;
      x += letter.width;
      if (still) return;
      const home = cy;
      letter.y = home - 40;
      letter.setAlpha(0);
      scene.tweens.add({
        targets: letter,
        y: home,
        alpha: 1,
        delay: i * Math.round(pace * 0.22),
        duration: pace * 2,
        ease: "Back.easeOut"
      });
    });
    void th;
  }
  function pauseMenu(scene, spec) {
    const s = spec || /** @type {any} */
    {};
    const mgr = scene.scene;
    if (!mgr.get(PAUSE_KEY)) mgr.add(PAUSE_KEY, pauseSceneConfig(), false);
    const session = {
      parentKey: mgr.key,
      spec: s,
      closed: false,
      /** Filled in by the pause scene once it has drawn itself. @type {(() => void)|null} */
      shut: null
    };
    const shouldPause = s.pauseScene !== false;
    if (shouldPause) mgr.pause(mgr.key);
    mgr.launch(PAUSE_KEY, session);
    mgr.bringToTop(PAUSE_KEY);
    const api = {
      close() {
        if (session.closed) return;
        session.closed = true;
        if (session.shut) session.shut();
        else mgr.stop(PAUSE_KEY);
        if (shouldPause) mgr.resume(session.parentKey);
        if (typeof s.onResume === "function") s.onResume();
      },
      destroy() {
        api.close();
      }
    };
    session.shut = null;
    session.close = api.close;
    return api;
  }
  function pauseSceneConfig() {
    return {
      key: PAUSE_KEY,
      create: function(data) {
        const scene = (
          /** @type {any} */
          this
        );
        const session = data || {};
        const s = session.spec || {};
        const th = look(scene);
        const width = scene.scale.width;
        const height = scene.scale.height;
        const labels = s.labels || {};
        const scrim = scene.add.rectangle(0, 0, width, height, th.bg, 0.78).setOrigin(0, 0);
        scrim.setDepth(OVERLAY_DEPTH - 20);
        scrim.setInteractive();
        scene.add.text(width / 2, Math.round(height * 0.26), s.title || "Paused", {
          fontFamily: th.fontDisplay || th.font,
          fontSize: Math.max(26, Math.round(Math.min(width, height) * 0.08)) + "px",
          color: hex(th.ink)
        }).setOrigin(0.5, 0.5).setDepth(OVERLAY_DEPTH - 5);
        const close = function() {
          if (typeof session.close === "function") session.close();
          else scene.scene.stop(PAUSE_KEY);
        };
        const menu = menuItems(scene, {
          x: width / 2,
          y: Math.round(height * 0.44),
          align: "center",
          gap: 44,
          motion: "stagger",
          cursor: "bar",
          controls: s.controls,
          items: [
            { label: labels.resume || "Resume", onPick: close },
            {
              label: labels.restart || "Restart",
              onPick: function() {
                close();
                const parent = scene.scene.get(session.parentKey);
                if (parent) parent.scene.restart();
              }
            },
            { label: labels.settings || "Settings", onPick: function() {
              if (typeof s.onSettings === "function") s.onSettings();
            } },
            { label: labels.quit || "Quit", onPick: function() {
              close();
              if (typeof s.onQuit === "function") s.onQuit();
            } }
          ]
        });
        const keyboard = scene.input && scene.input.keyboard ? scene.input.keyboard : null;
        const onEscape = function() {
          close();
        };
        if (keyboard) keyboard.on("keydown-ESC", onEscape);
        let heldPause = true;
        const watchPause = function() {
          const c = s.controls;
          if (!c) return;
          if (c.pause && !heldPause) {
            close();
            return;
          }
          heldPause = !!c.pause;
        };
        if (s.controls) scene.events.on("update", watchPause);
        scene.events.once("shutdown", function() {
          if (keyboard) keyboard.off("keydown-ESC", onEscape);
          scene.events.off("update", watchPause);
          menu.destroy();
        });
        session.shut = function() {
          scene.scene.stop(PAUSE_KEY);
        };
      }
    };
  }

  // src/static/sdk-libs/phaser/level.js
  var DEFAULT_LEGEND2 = {
    "#": "ground",
    "=": "brick",
    "^": "spike",
    o: "coin",
    E: "enemy",
    P: "spawn",
    G: "goal"
  };
  var BLANK = { ".": true, " ": true, "": true };
  var NOT_SOLID = { coin: true, enemy: true, spawn: true, goal: true, spike: true };
  var TINT_ROLE = {
    ground: "line",
    brick: "inkDim",
    spike: "err",
    coin: "warn",
    goal: "ok",
    enemy: "accent",
    player: "accent"
  };
  var DEFAULT_TEXTURES = {
    ground: "tile-ground",
    brick: "tile-brick",
    spike: "tile-spike",
    coin: "tile-coin",
    goal: "tile-goal",
    enemy: "tile-enemy",
    player: "hero"
  };
  var ENEMY_SHARE = 0.42;
  function parseMap(rows, legend) {
    const lines = Array.isArray(rows) ? rows : [];
    const marks = Object.assign({}, DEFAULT_LEGEND2, legend || {});
    const tiles2 = [];
    const coins = [];
    const enemies = [];
    const spikes = [];
    let spawn = null;
    let goal = null;
    let width = 0;
    for (let y = 0; y < lines.length; y += 1) {
      const line = String(lines[y] == null ? "" : lines[y]);
      if (line.length > width) width = line.length;
      for (let x = 0; x < line.length; x += 1) {
        const mark = line.charAt(x);
        if (BLANK[mark]) continue;
        const kind = marks[mark];
        if (!kind) continue;
        tiles2.push({ x, y, kind });
        if (kind === "coin") coins.push({ x, y });
        else if (kind === "enemy") enemies.push({ x, y });
        else if (kind === "spike") spikes.push({ x, y });
        else if (kind === "spawn") spawn = { x, y };
        else if (kind === "goal") goal = { x, y };
      }
    }
    return {
      width,
      height: lines.length,
      tiles: tiles2,
      spawn,
      coins,
      enemies,
      goal,
      spikes
    };
  }
  function ensureTexture(scene, key, kind, size, th) {
    if (scene.textures.exists(key)) return key;
    const colour = th[TINT_ROLE[kind] || "ink"];
    const g = scene.add.graphics();
    g.fillStyle(colour, 1);
    if (kind === "coin") g.fillCircle(size / 2, size / 2, Math.max(3, size * 0.3));
    else if (kind === "spike") g.fillTriangle(0, size, size / 2, size * 0.2, size, size);
    else g.fillRect(0, 0, size, size);
    g.generateTexture(key, size, size);
    g.destroy();
    return key;
  }
  function platformer(scene, spec) {
    const s = spec || /** @type {any} */
    {};
    const th = look(scene);
    const still = reducedMotion();
    const tile = s.tile || 32;
    const map = parseMap(s.map || [], s.legend);
    const tex = Object.assign({}, DEFAULT_TEXTURES, s.textures || {});
    const move = Object.assign({ speed: 220, jump: 420, doubleJump: false }, s.player || {});
    const pxW = Math.max(tile, map.width * tile);
    const pxH = Math.max(tile, map.height * tile);
    const fadeMs = 180;
    const solidCells = /* @__PURE__ */ new Set();
    for (const t of map.tiles) if (!NOT_SOLID[t.kind]) solidCells.add(t.x + "," + t.y);
    const handlers = { coin: [], die: [], goal: [], land: [] };
    let coinCount = 0;
    let dead = false;
    let finished = false;
    let wasDown = false;
    let jumpHeld = false;
    let airJumps = 0;
    let gone = false;
    scene.physics.world.gravity.y = s.gravity != null ? s.gravity : 900;
    if (s.bounds !== false) scene.physics.world.setBounds(0, 0, pxW, pxH);
    if (s.parallaxBackdrop) drawParallax(scene, th, pxW, pxH);
    const ground = scene.physics.add.staticGroup();
    for (const t of map.tiles) {
      if (NOT_SOLID[t.kind]) continue;
      const key = ensureTexture(scene, tex[t.kind] || "tile-" + t.kind, t.kind, tile, th);
      const block2 = ground.create(t.x * tile + tile / 2, t.y * tile + tile / 2, key);
      block2.setDisplaySize(tile, tile);
      block2.refreshBody();
    }
    const coins = scene.physics.add.staticGroup();
    const spikes = scene.physics.add.staticGroup();
    const goal = scene.physics.add.staticGroup();
    const enemies = scene.physics.add.group();
    const playerKey = ensureTexture(scene, tex.player, "player", tile, th);
    const start = map.spawn || { x: 1, y: Math.max(0, map.height - 2) };
    const player = scene.physics.add.sprite(start.x * tile + tile / 2, start.y * tile + tile / 2, playerKey);
    player.setBounce(0.04);
    player.setCollideWorldBounds(s.bounds !== false);
    scene.physics.add.collider(player, ground);
    scene.physics.add.collider(enemies, ground);
    scene.physics.add.overlap(player, coins, takeCoin, void 0, null);
    scene.physics.add.overlap(player, spikes, kill, void 0, null);
    scene.physics.add.overlap(player, enemies, kill, void 0, null);
    scene.physics.add.overlap(player, goal, reachGoal, void 0, null);
    if (s.camera !== "fixed") {
      scene.cameras.main.startFollow(player, true, 0.12, 0.12);
      if (s.bounds !== false) scene.cameras.main.setBounds(0, 0, pxW, pxH);
    }
    populate();
    function populate() {
      coins.clear(true, true);
      spikes.clear(true, true);
      goal.clear(true, true);
      enemies.clear(true, true);
      for (const c of map.coins) {
        const key = ensureTexture(scene, tex.coin, "coin", tile, th);
        const coin = coins.create(c.x * tile + tile / 2, c.y * tile + tile / 2, key);
        coin.setDisplaySize(tile * 0.6, tile * 0.6);
        coin.refreshBody();
      }
      for (const sp of map.spikes) {
        const key = ensureTexture(scene, tex.spike, "spike", tile, th);
        const spike = spikes.create(sp.x * tile + tile / 2, sp.y * tile + tile * 0.72, key);
        spike.setDisplaySize(tile, tile * 0.55);
        spike.refreshBody();
      }
      if (map.goal) {
        const key = ensureTexture(scene, tex.goal, "goal", tile, th);
        const flag = goal.create(map.goal.x * tile + tile / 2, map.goal.y * tile + tile / 2, key);
        flag.setDisplaySize(tile * 0.8, tile);
        flag.refreshBody();
      }
      for (const e of map.enemies) {
        const key = ensureTexture(scene, tex.enemy, "enemy", tile, th);
        const foe = enemies.create(e.x * tile + tile / 2, e.y * tile + tile / 2, key);
        foe.setDisplaySize(tile * 0.9, tile * 0.9);
        foe.setBounce(0, 0);
        foe.setCollideWorldBounds(s.bounds !== false);
        foe.setData("dir", 1);
        foe.setVelocityX(move.speed * ENEMY_SHARE);
      }
    }
    function emit(event, value) {
      const list = handlers[event];
      if (!list) return false;
      let handled = false;
      for (const fn of list.slice()) if (fn(value) === true) handled = true;
      return handled;
    }
    function takeCoin(_who, coin) {
      if (!coin.active) return;
      coin.disableBody(true, false);
      coinCount += 1;
      emit("coin", coinCount);
      if (still) {
        coin.destroy();
        return;
      }
      scene.tweens.add({
        targets: coin,
        y: coin.y - tile * 0.6,
        alpha: 0,
        scaleX: 1.4,
        scaleY: 1.4,
        duration: 220,
        ease: "Sine.easeOut",
        onComplete: function() {
          coin.destroy();
        }
      });
    }
    function kill() {
      if (dead || finished) return;
      dead = true;
      if (emit("die")) {
        dead = false;
        return;
      }
      player.setVelocity(0, 0);
      const c = channels(th.bg);
      const cam = scene.cameras.main;
      cam.fadeOut(fadeMs, c.r, c.g, c.b, function(_camera, progress) {
        if (progress < 1) return;
        placePlayer();
        cam.fadeIn(fadeMs, c.r, c.g, c.b);
        dead = false;
      });
    }
    function reachGoal() {
      if (finished || dead) return;
      finished = true;
      emit("goal");
    }
    function placePlayer() {
      player.setVelocity(0, 0);
      player.setPosition(start.x * tile + tile / 2, start.y * tile + tile / 2);
      airJumps = 0;
    }
    function atLedge(foe, dir) {
      const gx = Math.floor((foe.x + dir * tile * 0.55) / tile);
      const gy = Math.floor((foe.y + tile * 0.6) / tile);
      return !solidCells.has(gx + "," + gy);
    }
    function animate(vx, onGround) {
      const anims = scene.anims;
      if (!anims || typeof anims.exists !== "function") return;
      const want = !onGround ? tex.player + "-jump" : vx !== 0 ? tex.player + "-run" : tex.player + "-idle";
      if (anims.exists(want)) player.play(want, true);
    }
    const api = {
      player,
      groups: { ground, coins, enemies, spikes, goal },
      map,
      /**
       * Listen for 'coin' (the running count), 'die', 'goal' or 'land'. A 'die' listener that
       * returns true has handled the death and the built-in respawn stands down.
       * @param {string} event
       * @param {(value?: any) => any} fn
       * @returns {() => void} stop listening
       */
      on(event, fn) {
        const list = handlers[event] || (handlers[event] = []);
        list.push(fn);
        return function off() {
          const at = list.indexOf(fn);
          if (at >= 0) list.splice(at, 1);
        };
      },
      /** Call from the scene's own update(). @returns {void} */
      update() {
        if (gone) return;
        const body = player.body;
        const onGround = !!(body && body.blocked.down);
        if (onGround && !wasDown) emit("land");
        if (onGround) airJumps = 0;
        wasDown = onGround;
        patrol();
        if (dead || finished) {
          animate(0, onGround);
          return;
        }
        const c = s.controls;
        const left = !!(c && c.left);
        const right = !!(c && c.right);
        const wantJump = !!(c && c.jump);
        const vx = left === right ? 0 : left ? -move.speed : move.speed;
        player.setVelocityX(vx);
        if (vx !== 0) player.setFlipX(vx < 0);
        if (wantJump && !jumpHeld) {
          if (onGround) player.setVelocityY(-move.jump);
          else if (move.doubleJump && airJumps < 1) {
            player.setVelocityY(-move.jump * 0.86);
            airJumps += 1;
          }
        }
        jumpHeld = wantJump;
        animate(vx, onGround);
      },
      /** Back to the start: the map repopulated, the count at zero, the player on the spawn. */
      reset() {
        coinCount = 0;
        dead = false;
        finished = false;
        airJumps = 0;
        populate();
        placePlayer();
      },
      destroy() {
        if (gone) return;
        gone = true;
        scene.events.off("shutdown", api.destroy);
        for (const key in handlers) handlers[key].length = 0;
        scene.tweens.killTweensOf(player);
        [coins, spikes, goal, enemies, ground].forEach(function(group) {
          if (group && group.children) group.clear(true, true);
        });
        player.destroy();
      }
    };
    function patrol() {
      const list = enemies.getChildren ? enemies.getChildren() : [];
      for (const foe of list) {
        if (!foe.active || !foe.body) continue;
        let dir = foe.getData("dir") || 1;
        const hitWall = dir < 0 ? foe.body.blocked.left : foe.body.blocked.right;
        if (hitWall || foe.body.blocked.down && atLedge(foe, dir)) {
          dir = -dir;
          foe.setData("dir", dir);
        }
        foe.setVelocityX(move.speed * ENEMY_SHARE * dir);
        foe.setFlipX(dir < 0);
      }
    }
    scene.events.once("shutdown", api.destroy);
    return api;
  }
  function drawParallax(scene, th, pxW, pxH) {
    const far = scene.add.graphics();
    far.setScrollFactor(0.25).setDepth(-30).fillStyle(th.line, 0.55);
    const step = Math.max(90, Math.round(pxW / 14));
    for (let x = 0; x < pxW; x += step) {
      const h = pxH * (0.22 + x / step % 3 * 0.06);
      far.fillRect(x, pxH - h, step * 0.92, h);
    }
    const near = scene.add.graphics();
    near.setScrollFactor(0.5).setDepth(-20).fillStyle(th.inkDim, 0.28);
    const step2 = Math.max(60, Math.round(pxW / 22));
    for (let x = -step2; x < pxW; x += step2) {
      const h = pxH * (0.12 + x / step2 % 4 * 0.035);
      near.fillRect(x, pxH - h, step2 * 0.86, h);
    }
  }

  // src/static/sdk-libs/phaser/settings.js
  var ALL_SECTIONS = ["audio", "display", "controls", "motion"];
  var ACTION_WORDS = {
    left: "Move left",
    right: "Move right",
    up: "Move up",
    down: "Move down",
    jump: "Jump",
    action: "Action",
    pause: "Pause"
  };
  var DEFAULTS = {
    // The same three the audio bus starts from (audio.js), so Reset lands where a fresh bus does.
    master: 1,
    music: 0.6,
    sfx: 1,
    muted: false,
    touch: false,
    keys: {
      left: ["LEFT", "A"],
      right: ["RIGHT", "D"],
      up: ["UP", "W"],
      down: ["DOWN", "S"],
      jump: ["SPACE", "UP", "W"],
      action: ["X", "K", "ENTER"],
      pause: ["ESC", "P"]
    }
  };
  var KEY_NAMES = {
    ArrowLeft: "LEFT",
    ArrowRight: "RIGHT",
    ArrowUp: "UP",
    ArrowDown: "DOWN",
    " ": "SPACE",
    Spacebar: "SPACE",
    Enter: "ENTER",
    Tab: "TAB",
    Backspace: "BACKSPACE",
    Shift: "SHIFT",
    Control: "CTRL",
    Alt: "ALT"
  };
  var DIGIT_NAMES = ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"];
  var MOTION_ATTR2 = "data-ak-motion";
  function phaserKey(ev) {
    const named = KEY_NAMES[ev.key];
    if (named) return named;
    if (/^[0-9]$/.test(ev.key)) return DIGIT_NAMES[Number(ev.key)];
    return String(ev.key).toUpperCase();
  }
  function keyLabel(keys) {
    return keys && keys.length ? keys.join(" / ") : "Unbound";
  }
  function kit() {
    const ns = (
      /** @type {any} */
      window.AIMEAT
    );
    return ns && ns.atelier ? ns.atelier : null;
  }
  function block(host, title) {
    const K = kit();
    if (K && typeof K.section === "function") {
      const made = K.section({ target: host, title });
      return made.body;
    }
    const body = el("div", { class: "ak-section__body" });
    host.appendChild(el("section", { class: "ak-root ak-section" }, [
      el("h2", { class: "ak-section__title", text: title }),
      body
    ]));
    return body;
  }
  function settingsPanel(spec) {
    const s = spec || /** @type {any} */
    {};
    const sections = s.sections && s.sections.length ? s.sections : ALL_SECTIONS;
    const root = el("div", { class: "ak-root akp-settings" });
    resolve(s.target, document.body).appendChild(root);
    const readers = [];
    let capturing = null;
    let touchOn = false;
    let gone = false;
    function stored() {
      const store = s.saves;
      if (!store || typeof store.settings !== "function") return {};
      const kept = store.settings();
      return kept && typeof kept === "object" ? kept : {};
    }
    function persist(key, value) {
      const store = s.saves;
      if (!store || typeof store.settings !== "function") return;
      const patch = {};
      patch[key] = value;
      store.settings(patch);
    }
    function readLevel(name) {
      const bus = s.audio;
      if (bus && typeof bus[name] === "function") {
        const v = bus[name]();
        if (typeof v === "number" && isFinite(v)) return v;
      }
      const kept = stored();
      return typeof kept[name] === "number" ? kept[name] : DEFAULTS[name];
    }
    function writeLevel(name, value) {
      const bus = s.audio;
      if (bus && typeof bus[name] === "function") bus[name](value);
      persist(name, value);
    }
    function readMute() {
      const bus = s.audio;
      if (bus && typeof bus.mute === "function") return !!bus.mute();
      const kept = stored();
      return kept.muted != null ? !!kept.muted : DEFAULTS.muted;
    }
    function writeMute(on) {
      const bus = s.audio;
      if (bus && typeof bus.mute === "function") bus.mute(on);
      persist("muted", on);
    }
    function readFullscreen() {
      return !!document.fullscreenElement;
    }
    function writeFullscreen(on) {
      const handle = s.game;
      if (!handle) return;
      if (on && typeof handle.fullscreen === "function") handle.fullscreen();
      else if (!on && typeof handle.exitFullscreen === "function") handle.exitFullscreen();
    }
    function readTouch() {
      return touchOn;
    }
    function writeTouch(on) {
      touchOn = !!on;
      const c = s.controls;
      if (c && typeof c.showTouch === "function") c.showTouch(touchOn);
      persist("touch", touchOn);
    }
    function readLessMotion() {
      return document.documentElement.getAttribute(MOTION_ATTR2) === "less";
    }
    function writeLessMotion(on) {
      const K = kit();
      const set = K && typeof K.setMotion === "function" ? K.setMotion : setMotion;
      set(on ? "less" : "auto");
      persist("motion", on ? "less" : "auto");
    }
    function readKeys() {
      const c = s.controls;
      if (c && typeof c.bindings === "function") return c.bindings();
      const kept = stored().keys;
      return kept && typeof kept === "object" ? kept : DEFAULTS.keys;
    }
    function writeKeys(action, keys) {
      const c = s.controls;
      if (c && typeof c.rebind === "function") c.rebind(action, keys);
      const next = Object.assign({}, readKeys());
      next[action] = keys;
      persist("keys", next);
    }
    function slider(host, label, name) {
      const id = uid("akp-set");
      const out = el("output", { class: "akp-settings__value", for: id });
      const input = (
        /** @type {HTMLInputElement} */
        el("input", {
          id,
          type: "range",
          min: "0",
          max: "100",
          step: "1",
          class: "ak-input akp-settings__range",
          on: {
            input: function() {
              const pct = Number(input.value);
              out.textContent = pct + "%";
              writeLevel(name, pct / 100);
            }
          }
        })
      );
      host.appendChild(el("div", { class: "ak-form__field akp-settings__row" }, [
        el("label", { class: "ak-form__label", for: id, text: label }),
        el("div", { class: "akp-settings__control" }, [input, out])
      ]));
      const read = function() {
        const pct = Math.round(Math.max(0, Math.min(1, readLevel(name))) * 100);
        input.value = String(pct);
        out.textContent = pct + "%";
      };
      readers.push(read);
      read();
    }
    function toggle(host, label, read, write, hint) {
      const id = uid("akp-set");
      const input = (
        /** @type {HTMLInputElement} */
        el("input", {
          id,
          type: "checkbox",
          class: "ak-toggle",
          on: { change: function() {
            write(input.checked);
          } }
        })
      );
      host.appendChild(el("div", { class: "ak-form__field ak-form__field--inline akp-settings__row" }, [
        input,
        el("label", { class: "ak-form__label", for: id, text: label }),
        hint ? el("p", { class: "ak-form__hint", text: hint }) : null
      ]));
      const sync = function() {
        input.checked = read();
      };
      readers.push(sync);
      sync();
    }
    function bindingTable(host) {
      const scheme = readKeys();
      const actions = Object.keys(scheme);
      const body = el("tbody");
      host.appendChild(el("table", { class: "akp-settings__keys" }, [
        el("thead", {}, el("tr", {}, [
          el("th", { scope: "col", text: "Action" }),
          el("th", { scope: "col", text: "Key" }),
          el("th", { scope: "col", class: "ak-sr-only", text: "Change" })
        ])),
        body
      ]));
      const cells = {};
      for (const action of actions) {
        const words = ACTION_WORDS[action] || action;
        const cell = el("td", { class: "akp-settings__key" });
        cells[action] = cell;
        const button = el("button", {
          type: "button",
          class: "ak-btn ak-btn--ghost",
          "data-ak-noguard": true,
          "aria-label": "Change the key for " + words,
          on: { click: function() {
            capture(action, button);
          } }
        }, "Rebind");
        body.appendChild(el("tr", {}, [
          el("th", { scope: "row", text: words }),
          cell,
          el("td", {}, button)
        ]));
      }
      const read = function() {
        const now = readKeys();
        for (const action of actions) cells[action].textContent = keyLabel(now[action]);
      };
      readers.push(read);
      read();
    }
    function capture(action, button) {
      if (capturing) window.removeEventListener("keydown", capturing, true);
      button.classList.add("akp-settings__listening");
      button.textContent = "Press a key";
      const listener = function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        window.removeEventListener("keydown", listener, true);
        capturing = null;
        button.classList.remove("akp-settings__listening");
        button.textContent = "Rebind";
        if (ev.key === "Escape") return;
        writeKeys(action, [phaserKey(ev)]);
        api.refresh();
      };
      capturing = listener;
      window.addEventListener("keydown", listener, true);
    }
    function build() {
      clear(root);
      readers.length = 0;
      touchOn = !!stored().touch;
      if (s.controls && typeof s.controls.showTouch === "function" && stored().touch != null) s.controls.showTouch(touchOn);
      if (stored().motion === "less" && !readLessMotion()) writeLessMotion(true);
      for (const name of sections) {
        if (name === "audio") {
          const body = block(root, "Sound");
          slider(body, "Overall volume", "master");
          slider(body, "Music", "music");
          slider(body, "Effects", "sfx");
          toggle(body, "Mute everything", readMute, writeMute);
        } else if (name === "display") {
          const body = block(root, "Display");
          toggle(
            body,
            "Fullscreen",
            readFullscreen,
            writeFullscreen,
            "The game fills the screen until you leave it."
          );
        } else if (name === "controls") {
          const body = block(root, "Controls");
          toggle(
            body,
            "On-screen buttons",
            readTouch,
            writeTouch,
            "Show the touch controls over the game."
          );
          bindingTable(body);
        } else if (name === "motion") {
          const body = block(root, "Motion");
          toggle(
            body,
            "Less motion",
            readLessMotion,
            writeLessMotion,
            "Menus and scene changes stop moving; the game itself is unchanged."
          );
        }
      }
      root.appendChild(el("div", { class: "akp-settings__bar" }, el("button", {
        type: "button",
        class: "ak-btn ak-btn--ghost",
        "data-ak-noguard": true,
        on: { click: resetAll }
      }, "Reset to defaults")));
    }
    function resetAll() {
      writeLevel("master", DEFAULTS.master);
      writeLevel("music", DEFAULTS.music);
      writeLevel("sfx", DEFAULTS.sfx);
      writeMute(DEFAULTS.muted);
      writeTouch(DEFAULTS.touch);
      writeLessMotion(false);
      for (const action in DEFAULTS.keys) writeKeys(action, DEFAULTS.keys[action].slice());
      api.refresh();
    }
    const onFullscreenChange = function() {
      api.refresh();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    const api = {
      el: root,
      /** Re-read every control from the game. Nothing is rebuilt, so a focused control keeps focus. */
      refresh() {
        for (const read of readers) read();
      },
      destroy() {
        if (gone) return;
        gone = true;
        document.removeEventListener("fullscreenchange", onFullscreenChange);
        if (capturing) {
          window.removeEventListener("keydown", capturing, true);
          capturing = null;
        }
        readers.length = 0;
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
    build();
    return api;
  }

  // src/static/sdk-libs/phaser/index.js
  var phaser = {
    /**
     * The library version. It MUST match the newest entry in /lib/aimeat-phaser.css's version
     * history; e2e-libs.ts fails when the two drift.
     */
    version: "1.1.0",
    // ── Boot and the look ──
    ensurePhaser,
    theme,
    game,
    // ── Assets (a pack by hand, or an aimeat-assets library through fromLibrary) ──
    pack,
    preloadPack,
    fromLibrary,
    textures,
    // ── Sound ──
    audio,
    // ── Feel, players together, phones ──
    juice,
    net,
    mobile,
    // ── The level editor (DOM), writing rows the platformer plays ──
    levelEditor,
    // ── Saves, controls, HUD ──
    saves,
    controls,
    hud,
    toast,
    // ── Menus and scene moves ──
    menuItems,
    titleScene,
    pauseMenu,
    transition,
    // ── Levels ──
    platformer,
    parseMap,
    // ── The settings page (DOM, on the Atelier kit when present) ──
    settingsPanel
  };
  attach("phaser", phaser);
})();
