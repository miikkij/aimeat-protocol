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
    function paint2() {
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
          paint2();
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
      paint2();
      tryLock();
    }
    let gauge2 = null;
    function safeArea() {
      const zero = { top: 0, right: 0, bottom: 0, left: 0 };
      if (dead || !doc) return zero;
      if (!gauge2) {
        gauge2 = doc.createElement("div");
        gauge2.setAttribute("aria-hidden", "true");
        gauge2.className = "ak-safe-probe";
        (doc.body || doc.documentElement).appendChild(gauge2);
      }
      const style = getComputedStyle(gauge2);
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
      if (gauge2 && gauge2.parentNode) gauge2.parentNode.removeChild(gauge2);
      gauge2 = null;
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
    let button2 = null;
    const onFullscreenChange = function() {
      if (!button2) return;
      const inside = !!g.scale.isFullscreen;
      const label = inside ? leaveLabel : enterLabel;
      button2.setAttribute("aria-label", label);
      button2.setAttribute("title", label);
      clear(button2);
      button2.appendChild(icon2(inside ? ICON_LEAVE : ICON_ENTER));
    };
    if (s.fullscreen === "button") {
      button2 = el("button", {
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
      frame.appendChild(button2);
      g.scale.on("enterfullscreen", onFullscreenChange);
      g.scale.on("leavefullscreen", onFullscreenChange);
    }
    let observer = null;
    const onBox = function() {
      if (destroyed || mode !== "resize") return;
      const box2 = frame.getBoundingClientRect();
      if (box2.width < 1 || box2.height < 1) return;
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
        const box2 = g.scale.gameSize;
        return { width: box2.width, height: box2.height };
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
        if (button2) {
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
    const top2 = place.y != null ? place.y : Math.round((gameHeight - height) / 2);
    const shape = scene.add.graphics();
    shape.setDepth(9999).setScrollFactor(0);
    const label = scene.add.text(left, top2 + height + 8, "", {
      fontFamily: look2.fontMono,
      fontSize: "12px",
      color: hex(look2.inkDim)
    });
    label.setDepth(9999).setScrollFactor(0);
    return {
      set(p, name) {
        const done = Math.max(0, Math.min(1, p || 0));
        shape.clear();
        shape.fillStyle(look2.surface, 1).fillRoundedRect(left, top2, width, height, radius);
        shape.lineStyle(1, look2.line, 1).strokeRoundedRect(left, top2, width, height, radius);
        const filled = Math.round(width * done);
        if (filled > 2) {
          shape.fillStyle(look2.accent, 1).fillRoundedRect(left, top2, filled, height, Math.min(radius, filled / 2));
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
      const status2 = scene.sys && scene.sys.settings ? scene.sys.settings.status : null;
      const managerWillStart = typeof status2 === "number" && status2 < loadingStatus();
      if (!managerWillStart && !loader.isLoading()) loader.start();
    });
  }
  function shade(colour, amount) {
    const end = amount >= 0 ? 255 : 0;
    const k = Math.min(1, Math.abs(amount));
    const mix3 = function(c) {
      return Math.round(c + (end - c) * k);
    };
    const r = mix3(colour >> 16 & 255);
    const g = mix3(colour >> 8 & 255);
    const b = mix3(colour & 255);
    return r << 16 | g << 8 | b;
  }
  function pen(scene) {
    return scene.make.graphics({ add: false });
  }
  function shapes(scene, list) {
    const look2 = theme(scene.game.canvas);
    const made2 = [];
    for (const item of list || []) {
      if (!item || !item.key || typeof item.draw !== "function") continue;
      made2.push(item.key);
      if (scene.textures.exists(item.key)) continue;
      const g = pen(scene);
      item.draw(g, look2);
      g.generateTexture(item.key, item.width || 32, item.height || 32);
      g.destroy();
    }
    return made2;
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
    const made2 = [];
    for (const kind in kinds) {
      const key = prefix + kind;
      made2.push(key);
      if (scene.textures.exists(key)) continue;
      const asked = kinds[kind];
      const token = TILE_COLOUR[kind] || "accent";
      const colour = typeof asked === "number" ? asked : look2[token];
      const g = pen(scene);
      drawTile(g, kind, colour, size, look2);
      g.generateTexture(key, size, size);
      g.destroy();
    }
    return made2;
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
          const span2 = step[1];
          const osc = ctx.createOscillator();
          const shape = ctx.createGain();
          osc.type = p.type || voice.type;
          osc.frequency.setValueAtTime(step[0] * rate, at);
          shape.gain.setValueAtTime(SILENCE, at);
          shape.gain.linearRampToValueAtTime(level, at + Math.min(0.012, span2 / 3));
          shape.gain.exponentialRampToValueAtTime(SILENCE, at + span2);
          osc.connect(shape);
          shape.connect(out);
          osc.onended = function() {
            osc.disconnect();
            shape.disconnect();
          };
          osc.start(at);
          osc.stop(at + span2);
          at += span2;
        }
        return true;
      },
      /** @returns {boolean} may this page make a sound yet? */
      get unlocked() {
        return !game2.sound.locked;
      },
      /** The Web Audio context the game plays through, or null on a backend without one. */
      get context() {
        return game2.sound.context || null;
      },
      /** Where a generated voice connects: the game's master mute node, so master and mute reach it. */
      get destination() {
        return game2.sound.destination || (game2.sound.context ? game2.sound.context.destination : null);
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

  // src/static/sdk-libs/phaser/chiptune-patterns.js
  var SCALES = {
    major: { steps: [0, 2, 4, 5, 7, 9, 11] },
    minor: { steps: [0, 2, 3, 5, 7, 8, 10] },
    dorian: { steps: [0, 2, 3, 5, 7, 9, 10] },
    pentatonic: { steps: [0, 2, 4, 7, 9], parent: "major" }
  };
  var CHORD_TEMPLATES = [
    [0, 4, 5, 3],
    // I  V  vi IV
    [5, 3, 0, 4],
    // vi IV I  V
    [0, 5, 3, 4],
    // I  vi IV V
    [0, 3, 4, 0],
    // I  IV V  I
    [0, 3, 0, 4],
    // I  IV I  V
    [0, 2, 3, 4],
    // I  iii IV V
    [0, 6, 5, 4],
    // i  VII VI v   (minor)
    [0, 5, 2, 6]
    // i  VI III VII (minor)
  ];
  var FEELS = {
    pop: {
      meter: 4,
      tempo: 120,
      swing: 0,
      lead: "square",
      bass: "triangle",
      templates: [0, 1, 2, 3],
      drums: {
        full: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." },
        light: { kick: "x.......x.......", hat: "..x...x...x...x." }
      },
      bassLine: "r-r-f-r-r-r-o-f-",
      density: 0.55,
      rest: 0.15,
      arp: [8, 16]
    },
    march: {
      meter: 4,
      tempo: 116,
      swing: 0,
      lead: "square",
      bass: "triangle",
      templates: [3, 4, 0],
      drums: {
        full: { kick: "x...x...x...x...", snare: "..x...x...x.x.x.", hat: "x...x...x...x..." },
        light: { kick: "x.......x.......", hat: "x...x...x...x..." }
      },
      bassLine: "r---f---r---f---",
      density: 0.6,
      rest: 0.1,
      arp: [4, 8]
    },
    waltz: {
      meter: 3,
      tempo: 150,
      swing: 0,
      lead: "triangle",
      bass: "triangle",
      templates: [3, 4, 5],
      drums: {
        full: { kick: "x...........", snare: "....x...x...", hat: "..x...x...x." },
        light: { kick: "x...........", hat: "....x...x..." }
      },
      bassLine: "r---f---f---",
      density: 0.45,
      rest: 0.2,
      arp: [3, 6]
    },
    chill: {
      meter: 4,
      tempo: 92,
      swing: 0.4,
      lead: "triangle",
      bass: "triangle",
      templates: [1, 2, 5],
      drums: {
        full: { kick: "x.....x...x.....", snare: "....x.......x...", hat: "..x...x...x...x." },
        light: { kick: "x.......x.......", hat: "....x.......x..." }
      },
      bassLine: "r-------f---r---",
      density: 0.35,
      rest: 0.3,
      arp: [4, 8]
    },
    boss: {
      meter: 4,
      tempo: 160,
      swing: 0,
      lead: "square",
      bass: "square",
      templates: [6, 7, 3],
      drums: {
        full: { kick: "x.x.x.x.x.x.x.x.", snare: "....x.......x..x", hat: "xxxxxxxxxxxxxxxx" },
        light: { kick: "x...x...x...x...", hat: "x.x.x.x.x.x.x.x." }
      },
      bassLine: "r-rorr-or-rorr-o",
      density: 0.7,
      rest: 0.08,
      arp: [8, 16]
    },
    retro: {
      meter: 4,
      tempo: 140,
      swing: 0,
      lead: "square",
      bass: "square",
      templates: [0, 3, 4, 6],
      drums: {
        full: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." },
        light: { kick: "x...x...x...x...", hat: "..x...x...x...x." }
      },
      bassLine: "rorororororororo",
      density: 0.6,
      rest: 0.12,
      arp: [8, 16]
    }
  };
  var STYLES = {
    title: { feel: "pop", tempo: 112, scale: "major", root: "C4", intensity: 0.5 },
    level: { feel: "retro", tempo: 140, scale: "major", root: "G4", intensity: 0.6 },
    boss: { feel: "boss", tempo: 164, scale: "minor", root: "E4", intensity: 1 },
    shop: { feel: "chill", tempo: 92, scale: "dorian", root: "D4", swing: 0.45, intensity: 0.3 },
    win: { feel: "march", tempo: 132, scale: "major", root: "C4", intensity: 0.8, once: true, bars: 2, sting: "up" },
    lose: { feel: "chill", tempo: 84, scale: "minor", root: "A3", intensity: 0.4, once: true, bars: 2, sting: "down" }
  };
  function rng(seed) {
    let a = Number(seed) >>> 0 || 1;
    return function() {
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var LETTERS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  var ROOT_MIN = 36;
  var ROOT_MAX = 84;
  function parseNote(value, fallback) {
    if (typeof value === "number" && isFinite(value)) return Math.max(ROOT_MIN, Math.min(ROOT_MAX, Math.round(value)));
    if (typeof value === "string") {
      const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(value.trim());
      if (m) {
        const semitone = LETTERS[m[1].toUpperCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
        const midi = (Number(m[3]) + 1) * 12 + semitone;
        return Math.max(ROOT_MIN, Math.min(ROOT_MAX, midi));
      }
    }
    return fallback;
  }
  function midiToHz(n) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  // src/static/sdk-libs/phaser/chiptune-compose.js
  var SECTION_BARS = 8;
  var FORM = ["A", "B", "A"];
  var STEPS_PER_BEAT = 4;
  function degreeMidi(steps, base, degree) {
    const n = steps.length;
    const oct = Math.floor(degree / n);
    return base + oct * 12 + steps[degree - oct * n];
  }
  function nearestDegree(steps, pc) {
    let best = 0;
    let dist = 99;
    for (let i = 0; i < steps.length; i++) {
      const d = Math.min(Math.abs(steps[i] - pc), Math.abs(steps[i] - 12 - pc), Math.abs(steps[i] + 12 - pc));
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  }
  function chordOn(chordSteps, root, degree) {
    let tones = [degreeMidi(chordSteps, root, degree), degreeMidi(chordSteps, root, degree + 2), degreeMidi(chordSteps, root, degree + 4)];
    if (tones[0] - root > 6) tones = tones.map(function(n) {
      return n - 12;
    });
    return tones;
  }
  function motif(random, feel, steps) {
    const out = [];
    let rel = 0;
    for (let b = 0; b < 2; b++) {
      const bar = new Array(steps).fill(null);
      let s = 0;
      while (s < steps) {
        const onBeat = s % STEPS_PER_BEAT === 0;
        const starts = b === 0 && s === 0 || random() < (onBeat ? feel.density + 0.25 : feel.density);
        if (!starts) {
          s += 1;
          continue;
        }
        let len = onBeat ? random() < 0.5 ? 2 : random() < 0.5 ? 4 : 1 : random() < 0.6 ? 1 : 2;
        if (s + len > steps) len = steps - s;
        if (onBeat) {
          const tones = [-5, -3, 0, 2, 4];
          let pick = tones[Math.floor(random() * tones.length)];
          if (random() < 0.6) {
            pick = tones[0];
            for (const t of tones) if (Math.abs(t - rel) < Math.abs(pick - rel)) pick = t;
          }
          rel = pick;
        } else {
          rel = Math.max(-4, Math.min(5, rel + (random() < 0.5 ? -1 : 1)));
        }
        bar[s] = { rel, len: random() < feel.rest ? Math.max(1, len - 1) : len };
        s += len;
      }
      out.push(bar);
    }
    return out;
  }
  function cadence(line, steps) {
    const half = Math.floor(steps / 2);
    const out = line.map(function(e, s) {
      return s < half ? e : null;
    });
    for (let s = 0; s < half; s++) if (out[s] && s + out[s].len > half) out[s] = { rel: out[s].rel, len: half - s };
    out[half] = { rel: 0, len: steps - half };
    return out;
  }
  function section(random, feel, steps) {
    const template = CHORD_TEMPLATES[feel.templates[Math.floor(random() * feel.templates.length)]];
    const answer = template.slice();
    answer[3] = random() < 0.5 ? 4 : 0;
    const degrees = template.concat(answer);
    const motifs = [motif(random, feel, steps), motif(random, feel, steps)];
    const bars = [];
    for (let i = 0; i < SECTION_BARS; i++) {
      let line = motifs[i < 4 ? 0 : 1][i % 2].slice();
      if (i === SECTION_BARS - 1) line = cadence(line, steps);
      bars.push({ degree: degrees[i], line });
    }
    return bars;
  }
  function stingBars(direction, steps) {
    const up = direction !== "down";
    const climb = up ? [0, 2, 4, 7] : [4, 2, 0, -3];
    const first = new Array(steps).fill(null);
    for (let i = 0; i < climb.length; i++) first[i * 2] = { rel: climb[i], len: 2 };
    const second = new Array(steps).fill(null);
    second[0] = { rel: up ? 7 : -5, len: steps };
    return [{ degree: up ? 4 : 3, line: first }, { degree: 0, line: second }];
  }
  function compose(p) {
    const scale = SCALES[p.scale] || SCALES.major;
    const chordSteps = (scale.parent ? SCALES[scale.parent] : scale).steps;
    const steps = p.feel.meter * STEPS_PER_BEAT;
    const random = rng(p.seed);
    const plan2 = [];
    if (p.sting) {
      for (const b of stingBars(p.sting, steps)) plan2.push({ section: "sting", degree: b.degree, line: b.line });
    } else {
      const made2 = { A: section(random, p.feel, steps), B: section(random, p.feel, steps) };
      for (const name of FORM) for (const b of made2[name]) plan2.push({ section: name, degree: b.degree, line: b.line });
    }
    const leadBase = p.root + 12;
    return plan2.map(function(b) {
      const chord = chordOn(chordSteps, p.root, b.degree);
      const from = nearestDegree(scale.steps, ((chord[0] - p.root) % 12 + 12) % 12);
      return {
        section: b.section,
        root: chord[0],
        chord,
        lead: b.line.map(function(e) {
          return e ? { n: degreeMidi(scale.steps, leadBase, from + e.rel), len: e.len } : null;
        })
      };
    });
  }

  // src/static/sdk-libs/phaser/chiptune.js
  var TICK_MS = 25;
  var LOOKAHEAD = 0.15;
  var SILENCE2 = 1e-4;
  var VOICE_CAP = 8;
  var TEMPO_MIN = 40;
  var TEMPO_MAX = 300;
  var DIAL_MS = 600;
  var STOP_MS = 400;
  var TAIL_S = 0.6;
  var CHANNELS = {
    bass: { from: 0, to: 0 },
    arp: { from: 0, to: 0 },
    lead: { from: 0.25, to: 0.5 },
    drums: { from: 0.5, to: 0.85 }
  };
  var PAD_BELOW = 0.35;
  var ARP_FAST_FROM = 0.7;
  var DRUMS_FULL_FROM = 0.8;
  var VOICE = {
    lead: { peak: 0.16, a: 0.01, d: 0.06, s: 0.7, r: 0.05 },
    bass: { peak: 0.2, a: 5e-3, d: 0.08, s: 0.6, r: 0.04 },
    arp: { peak: 0.09, a: 5e-3, d: 0.05, s: 0.4, r: 0.03 },
    pad: { peak: 0.06, a: 0.25, d: 0.2, s: 0.8, r: 0.3 },
    kick: { peak: 0.55, a: 2e-3, d: 0.1, s: 0.2, r: 0.05, dur: 0.22, hz: 160, sweep: 45 },
    snare: { peak: 0.28, a: 2e-3, d: 0.08, s: 0.3, r: 0.04, dur: 0.16 },
    hat: { peak: 0.09, a: 1e-3, d: 0.02, s: 0.3, r: 0.01, dur: 0.045 }
  };
  var ARP_WALK = [0, 1, 2, 3, 2, 1];
  function clamp012(v) {
    const n = typeof v === "number" && isFinite(v) ? v : 0;
    return Math.max(0, Math.min(1, n));
  }
  function chiptune(bus, spec) {
    const given = (
      /** @type {ChiptuneSpec} */
      typeof spec === "string" ? { style: spec } : spec || {}
    );
    if (given.style && !STYLES[given.style]) {
      console.warn('[aimeat-phaser] chiptune knows no style "' + given.style + '", so it plays "title".');
    }
    const base = given.style ? STYLES[given.style] || STYLES.title : null;
    const feelName = given.feel && FEELS[given.feel] ? given.feel : base ? base.feel : "pop";
    const feel = FEELS[feelName];
    const once = given.once != null ? !!given.once : !!(base && base.once);
    const st = {
      feel,
      feelName,
      tempo: 0,
      swing: clamp012(given.swing != null ? given.swing : base && base.swing != null ? base.swing : feel.swing),
      seed: given.seed != null ? Number(given.seed) >>> 0 : 1,
      root: parseNote(given.root, parseNote(base ? base.root : "C4", 60)),
      scale: SCALES[given.scale] ? given.scale : base ? base.scale : "major",
      once,
      bars: given.bars > 0 ? Math.floor(given.bars) : base && base.bars ? base.bars : 2,
      sting: once && base && base.sting ? base.sting : null,
      volume: given.volume != null ? clamp012(given.volume) : 1
    };
    const stepsPerBar = feel.meter * STEPS_PER_BEAT;
    const ctx = (
      /** @type {any} */
      bus && bus.context || given.context || given.game && given.game.sound && given.game.sound.context || null
    );
    const out = bus && bus.destination || given.destination || given.game && given.game.sound && given.game.sound.destination || (ctx ? ctx.destination : null);
    const live = !!(ctx && typeof ctx.createOscillator === "function" && out);
    if (!live) {
      console.warn("[aimeat-phaser] chiptune has no Web Audio to play through: pass the game (chiptune(bus, { style, game })) or give the bus a context. This tune stays silent.");
    }
    let bars = [];
    let pending = true;
    let state = "idle";
    let dead = false;
    let selfMuted = false;
    let level = -1;
    let timer = null;
    let offUnlock = null;
    let step = 0;
    let bar = 0;
    let nextStepTime = 0;
    let arpCount = 0;
    let stopping = false;
    let stopAt = 0;
    let done = false;
    const barLog = [];
    const ramp = { from: clamp012(given.intensity != null ? given.intensity : base ? base.intensity : 0.5), to: 0, start: 0, end: 0 };
    ramp.to = ramp.from;
    const listeners = { start: [], bar: [], beat: [], end: [] };
    let levelGain = null;
    let fadeGain = null;
    const channels2 = {};
    const slots = [];
    let noise = null;
    function emit(name, ev) {
      for (const fn of listeners[name].slice()) fn(ev);
    }
    function clampTempo(bpm) {
      const n = typeof bpm === "number" && isFinite(bpm) ? bpm : feel.tempo;
      return Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, n));
    }
    st.tempo = clampTempo(given.tempo != null ? given.tempo : base ? base.tempo : feel.tempo);
    function stepDur() {
      return 60 / st.tempo / STEPS_PER_BEAT;
    }
    function intensityAt(t) {
      if (t >= ramp.end || ramp.end <= ramp.start) return ramp.to;
      if (t <= ramp.start) return ramp.from;
      return ramp.from + (ramp.to - ramp.from) * ((t - ramp.start) / (ramp.end - ramp.start));
    }
    function levelOf(name, x) {
      const c = CHANNELS[name];
      if (c.to <= c.from) return 1;
      return x <= c.from ? 0 : x >= c.to ? 1 : (x - c.from) / (c.to - c.from);
    }
    function rampChannel(name, from, to, start2, end2) {
      const p = channels2[name].gain;
      p.cancelScheduledValues(start2);
      p.setValueAtTime(Math.max(SILENCE2, levelOf(name, from)), start2);
      const c = CHANNELS[name];
      if (c.to > c.from && end2 > start2 && to !== from) {
        const knees = [c.from, c.to].map(function(knee) {
          return (knee - from) / (to - from);
        }).filter(function(f) {
          return f > 0 && f < 1;
        }).sort(function(a, b) {
          return a - b;
        });
        for (const f of knees) {
          p.linearRampToValueAtTime(Math.max(SILENCE2, levelOf(name, from + (to - from) * f)), start2 + f * (end2 - start2));
        }
      }
      p.linearRampToValueAtTime(Math.max(SILENCE2, levelOf(name, to)), Math.max(end2, start2 + 1e-3));
    }
    function ensureGraph() {
      if (levelGain) return;
      levelGain = ctx.createGain();
      levelGain.gain.value = SILENCE2;
      levelGain.connect(out);
      fadeGain = ctx.createGain();
      fadeGain.gain.value = SILENCE2;
      fadeGain.connect(levelGain);
      for (const name in CHANNELS) {
        const g = ctx.createGain();
        g.gain.value = SILENCE2;
        g.connect(fadeGain);
        channels2[name] = g;
      }
    }
    function applyLevel(force) {
      const s = bus && typeof bus.settings === "function" ? bus.settings() : null;
      const music = s && typeof s.music === "number" ? clamp012(s.music) : 1;
      const want = selfMuted || s && s.muted ? 0 : music * st.volume;
      if (!force && want === level) return;
      level = want;
      levelGain.gain.setTargetAtTime(Math.max(SILENCE2, want), ctx.currentTime, 0.03);
    }
    function fadeTo(to, ms2, at) {
      const from = at != null ? at : ctx.currentTime;
      const p = fadeGain.gain;
      p.cancelScheduledValues(from);
      p.setValueAtTime(Math.max(SILENCE2, typeof p.value === "number" ? p.value : SILENCE2), from);
      p.linearRampToValueAtTime(Math.max(SILENCE2, to), from + Math.max(1e-3, ms2 / 1e3));
    }
    function takeSlot(channel, at, until) {
      const now = ctx.currentTime;
      let slot = null;
      for (const s of slots) if (s.busyUntil <= at && s.channel === channel) {
        slot = s;
        break;
      }
      if (!slot) {
        for (const s of slots) if (s.busyUntil <= now) {
          slot = s;
          break;
        }
      }
      if (!slot && slots.length < VOICE_CAP) {
        const g = ctx.createGain();
        g.gain.value = SILENCE2;
        slot = { gain: g, busyUntil: 0, channel: "" };
        slots.push(slot);
      }
      if (!slot) {
        for (const s of slots) if (s.busyUntil <= at) {
          slot = s;
          break;
        }
      }
      if (!slot) return null;
      if (slot.channel !== channel) {
        slot.gain.disconnect();
        slot.gain.connect(channels2[channel]);
        slot.channel = channel;
      }
      slot.busyUntil = until;
      return slot;
    }
    function envelope(p, at, dur, v) {
      const a = Math.min(v.a, dur * 0.2);
      const d = Math.min(v.d, dur * 0.3);
      const r = Math.min(v.r, dur * 0.3);
      const sustain = Math.max(SILENCE2, v.peak * v.s);
      p.cancelScheduledValues(at);
      p.setValueAtTime(SILENCE2, at);
      p.linearRampToValueAtTime(v.peak, at + a);
      p.exponentialRampToValueAtTime(sustain, at + a + d);
      p.setValueAtTime(sustain, at + dur - r);
      p.exponentialRampToValueAtTime(SILENCE2, at + dur);
    }
    function tone6(channel, wave, hz, at, dur, v, sweepTo) {
      const slot = takeSlot(channel, at, at + dur);
      if (!slot) return false;
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.setValueAtTime(hz, at);
      if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, at + dur * 0.4);
      envelope(slot.gain.gain, at, dur, v);
      osc.connect(slot.gain);
      osc.onended = function() {
        osc.disconnect();
      };
      osc.start(at);
      osc.stop(at + dur);
      return true;
    }
    function burst(at, dur, v) {
      const slot = takeSlot("drums", at, at + dur);
      if (!slot) return false;
      if (!noise) {
        const rate = ctx.sampleRate || 44100;
        noise = ctx.createBuffer(1, Math.floor(rate / 4), rate);
        const data = noise.getChannelData(0);
        const random = rng(24301);
        for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
      }
      const src = ctx.createBufferSource();
      src.buffer = noise;
      envelope(slot.gain.gain, at, dur, v);
      src.connect(slot.gain);
      src.onended = function() {
        src.disconnect();
      };
      src.start(at);
      src.stop(at + dur);
      return true;
    }
    function wanted(name, at, dur) {
      return levelOf(name, intensityAt(at)) > 0 || levelOf(name, intensityAt(at + dur)) > 0;
    }
    function scheduleStep() {
      const t = nextStepTime;
      const s = step;
      const b = bar;
      const dur = stepDur();
      if (s === 0) {
        if (pending) {
          bars = compose({ seed: st.seed, feel: st.feel, scale: st.scale, root: st.root, sting: st.sting });
          pending = false;
        }
        barLog.push({ bar: b, start: t, dur: dur * stepsPerBar, x: intensityAt(t) });
        if (barLog.length > 3) barLog.shift();
      }
      const here = barLog[barLog.length - 1];
      const data = bars[b % bars.length];
      const at = t + (s % 2 === 1 ? st.swing * dur / 3 : 0);
      const letter = feel.bassLine.charAt(s % feel.bassLine.length);
      if (letter === "r" || letter === "f" || letter === "o") {
        let len = 1;
        while (s + len < stepsPerBar && feel.bassLine.charAt((s + len) % feel.bassLine.length) === "-") len++;
        const n = letter === "r" ? data.root - 12 : letter === "f" ? data.chord[2] - 12 : data.root;
        const v = feel.bass === "square" ? { peak: 0.13, a: VOICE.bass.a, d: VOICE.bass.d, s: VOICE.bass.s, r: VOICE.bass.r } : VOICE.bass;
        tone6("bass", feel.bass, midiToHz(n), at, len * dur * 0.9, v);
      }
      const ev = data.lead[s];
      if (ev && wanted("lead", at, ev.len * dur)) tone6("lead", feel.lead, midiToHz(ev.n), at, ev.len * dur * 0.92, VOICE.lead);
      if (wanted("drums", at, VOICE.kick.dur)) {
        const kit2 = here.x >= DRUMS_FULL_FROM ? feel.drums.full : feel.drums.light;
        if (kit2.kick && kit2.kick.charAt(s) === "x") tone6("drums", "sine", VOICE.kick.hz, at, VOICE.kick.dur, VOICE.kick, VOICE.kick.sweep);
        if (kit2.snare && kit2.snare.charAt(s) === "x") burst(at, VOICE.snare.dur, VOICE.snare);
        if (kit2.hat && kit2.hat.charAt(s) === "x") burst(at, VOICE.hat.dur, VOICE.hat);
      }
      if (here.x < PAD_BELOW) {
        if (s === 0) for (const n of data.chord) tone6("arp", "triangle", midiToHz(n), at, here.dur * 0.98, VOICE.pad);
      } else {
        const perBar = here.x >= ARP_FAST_FROM ? feel.arp[1] : feel.arp[0];
        const every = Math.max(1, Math.round(stepsPerBar / perBar));
        if (s % every === 0) {
          const walk = ARP_WALK[arpCount % ARP_WALK.length];
          arpCount++;
          const n = walk === 3 ? data.chord[0] + 12 : data.chord[walk];
          tone6("arp", "square", midiToHz(n), at, every * dur * 0.8, VOICE.arp);
        }
      }
      step = s + 1;
      nextStepTime = t + dur;
      if (step >= stepsPerBar) {
        step = 0;
        bar = b + 1;
      }
      const inMs = Math.max(0, Math.round((t - ctx.currentTime) * 1e3));
      if (s % STEPS_PER_BEAT === 0) emit("beat", { bar: b, beat: s / STEPS_PER_BEAT, time: t, inMs });
      if (s === 0) emit("bar", { bar: b, section: data.section, time: t, inMs });
    }
    function tick() {
      if (dead || state !== "playing") return;
      applyLevel(false);
      const horizon = ctx.currentTime + LOOKAHEAD;
      while (!done && nextStepTime < horizon && !(stopping && nextStepTime >= stopAt)) {
        if (st.once && bar >= st.bars) {
          done = true;
          stopping = true;
          stopAt = nextStepTime + TAIL_S;
          fadeTo(SILENCE2, TAIL_S * 1e3, nextStepTime);
          break;
        }
        scheduleStep();
      }
      if (stopping && ctx.currentTime >= stopAt) end();
    }
    function end() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      stopping = false;
      state = "idle";
      emit("end", { time: ctx.currentTime });
    }
    function start() {
      offUnlock = null;
      if (dead) return;
      ensureGraph();
      const now = ctx.currentTime;
      state = "playing";
      stopping = false;
      done = false;
      step = 0;
      bar = 0;
      arpCount = 0;
      barLog.length = 0;
      nextStepTime = now + 0.05;
      ramp.from = ramp.to;
      ramp.start = now;
      ramp.end = now;
      for (const name in CHANNELS) rampChannel(name, ramp.to, ramp.to, now, now);
      applyLevel(true);
      fadeTo(1, 20);
      timer = setInterval(tick, TICK_MS);
      emit("start", { time: nextStepTime });
    }
    function unlocked() {
      if (bus && typeof bus.unlocked === "boolean") return bus.unlocked;
      return !ctx.state || ctx.state === "running";
    }
    function heard() {
      const t = ctx.currentTime;
      for (let i = barLog.length - 1; i >= 0; i--) if (barLog[i].start <= t) return barLog[i];
      return barLog.length ? barLog[0] : null;
    }
    const api = {
      /**
       * Start, or resume. False when there is no Web Audio, when the handle is destroyed, or when
       * the bus is still locked; in that last case the tune starts by itself on the unlock.
       * @returns {boolean}
       */
      play() {
        if (dead || !live) return false;
        if (state === "playing") return true;
        if (state === "paused") return api.resume();
        if (state === "waiting") return false;
        if (!unlocked()) {
          state = "waiting";
          offUnlock = bus && typeof bus.onUnlock === "function" ? bus.onUnlock(start) : null;
          return false;
        }
        start();
        return true;
      },
      /**
       * Fade out and end. The notes keep coming under the fade, so a long one is a real ending.
       * @param {number} [fadeMs]  default 400
       * @returns {void}
       */
      stop(fadeMs) {
        if (dead) return;
        if (state === "waiting") {
          if (offUnlock) offUnlock();
          offUnlock = null;
          state = "idle";
          return;
        }
        if (state === "idle") return;
        const ms2 = fadeMs != null && isFinite(fadeMs) ? Math.max(0, fadeMs) : STOP_MS;
        if (state === "paused" || ms2 === 0) {
          end();
          return;
        }
        stopping = true;
        stopAt = ctx.currentTime + ms2 / 1e3;
        fadeTo(SILENCE2, ms2);
      },
      /** Hold the place and go quiet. @returns {boolean} */
      pause() {
        if (state !== "playing") return false;
        if (stopping) {
          end();
          return false;
        }
        fadeTo(SILENCE2, 60);
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        state = "paused";
        return true;
      },
      /** Carry on from the held place. @returns {boolean} */
      resume() {
        if (state !== "paused") return false;
        nextStepTime = ctx.currentTime + 0.05;
        fadeTo(1, 60);
        state = "playing";
        timer = setInterval(tick, TICK_MS);
        return true;
      },
      /**
       * Move the dial. Called with no argument it reports where the dial is now.
       * @param {number} [x]  0..1
       * @param {number} [ms]  how long the move takes, default 600
       * @returns {number}
       */
      intensity(x, ms2) {
        if (x == null || dead) return intensityAt(live ? ctx.currentTime : 0);
        const now = live ? ctx.currentTime : 0;
        const span2 = ms2 != null && isFinite(ms2) ? Math.max(0, ms2) / 1e3 : DIAL_MS / 1e3;
        const from = intensityAt(now);
        ramp.from = from;
        ramp.to = clamp012(x);
        ramp.start = now;
        ramp.end = now + span2;
        if (levelGain) for (const name in CHANNELS) rampChannel(name, from, ramp.to, now, now + span2);
        return ramp.to;
      },
      /**
       * @param {number} [bpm]  40..300; takes effect on the next sixteenth
       * @returns {number}
       */
      tempo(bpm) {
        if (bpm != null) st.tempo = clampTempo(bpm);
        return st.tempo;
      },
      /**
       * Change key; the tune is regenerated on the next bar. Called with nothing it reports.
       * @param {number|string} [root]  MIDI or a note name
       * @param {string} [scale]  major, minor, dorian or pentatonic
       * @returns {{ root: number, scale: string }}
       */
      key(root, scale) {
        if (root != null) {
          st.root = parseNote(root, st.root);
          pending = true;
        }
        if (scale != null && SCALES[scale]) {
          st.scale = scale;
          pending = true;
        }
        return { root: st.root, scale: st.scale };
      },
      /**
       * Another tune; regenerated on the next bar. Called with nothing it reports the seed.
       * @param {number} [n]
       * @returns {number}
       */
      seed(n) {
        if (n != null) {
          st.seed = Number(n) >>> 0;
          pending = true;
        }
        return st.seed;
      },
      /**
       * This tune's own mute, beside the bus's. Reports when called with nothing.
       * @param {boolean} [on]
       * @returns {boolean}
       */
      mute(on) {
        if (on != null) {
          selfMuted = !!on;
          if (levelGain) applyLevel(true);
        }
        return selfMuted;
      },
      /**
       * Where the music is, for syncing a picture to it.
       * @returns {Position}
       */
      now() {
        const t = live ? ctx.currentTime : 0;
        const b = live ? heard() : null;
        if (!b) return { bar: 0, beat: 0, step: 0, phase: 0, time: t, intensity: intensityAt(t) };
        const phase = Math.max(0, Math.min(0.9999, (t - b.start) / b.dur));
        return {
          bar: b.bar,
          beat: Math.floor(phase * feel.meter),
          step: Math.floor(phase * stepsPerBar),
          phase,
          time: t,
          intensity: intensityAt(t)
        };
      },
      /**
       * Hear the scheduler: 'beat' and 'bar' carry the audio time the moment lands and inMs, the
       * milliseconds until then; 'start' and 'end' bracket a play.
       * @param {'start'|'bar'|'beat'|'end'} name
       * @param {(ev: any) => void} fn
       * @returns {() => void} stop listening
       */
      on(name, fn) {
        if (!listeners[name] || typeof fn !== "function") return function() {
        };
        listeners[name].push(fn);
        return function() {
          const i = listeners[name].indexOf(fn);
          if (i >= 0) listeners[name].splice(i, 1);
        };
      },
      /** @returns {'idle'|'waiting'|'playing'|'paused'} */
      get state() {
        return (
          /** @type {any} */
          state
        );
      },
      /** The feel and the numbers in force, for a settings screen or a debug line. */
      get spec() {
        return { style: given.style || null, feel: feelName, tempo: st.tempo, swing: st.swing, seed: st.seed, root: st.root, scale: st.scale, once: st.once, bars: st.bars };
      },
      /** Silence everything at once and leave nothing running. */
      destroy() {
        if (dead) return;
        dead = true;
        if (offUnlock) offUnlock();
        offUnlock = null;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        if (levelGain) levelGain.disconnect();
        state = "idle";
        for (const name in listeners) listeners[name].length = 0;
      }
    };
    return api;
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
      const span2 = Math.max(FRAME_MS, typeof msWanted === "number" && isFinite(msWanted) ? msWanted : SHAKE_MS);
      scene.cameras.main.shake(span2, power);
      return true;
    }
    function flash(colour, msWanted) {
      if (dead || !scene.cameras || !scene.cameras.main) return false;
      const c = channels(tone(th, colour, th.accent));
      const span2 = Math.max(FRAME_MS, typeof msWanted === "number" && isFinite(msWanted) ? msWanted : 120);
      scene.cameras.main.flash(span2, c.r, c.g, c.b);
      return true;
    }
    function hitStop(msWanted, scale) {
      if (dead || reducedMotion()) return false;
      const span2 = Math.max(FRAME_MS, typeof msWanted === "number" && isFinite(msWanted) ? msWanted : 90);
      const k = Math.max(SCALE_FLOOR, typeof scale === "number" && isFinite(scale) ? scale : 0.05);
      if (ramp) {
        cancelAnimationFrame(ramp);
        ramp = 0;
      }
      setSpeed(k);
      later(span2, restoreSpeed);
      return true;
    }
    function slowmo(msWanted, scale) {
      if (dead || reducedMotion()) return false;
      const span2 = Math.max(FRAME_MS, typeof msWanted === "number" && isFinite(msWanted) ? msWanted : 600);
      const k = Math.max(SCALE_FLOOR, Math.min(1, typeof scale === "number" && isFinite(scale) ? scale : 0.35));
      if (ramp) {
        cancelAnimationFrame(ramp);
        ramp = 0;
      }
      setSpeed(k);
      later(span2, function() {
        const back = Math.max(FRAME_MS, span2 * 0.5);
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
    function number2(x, y, text, numOpts) {
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
      const span2 = Math.max(200, typeof n.ms === "number" ? n.ms : Math.max(600, pace * 3));
      const rise = still ? 0 : typeof n.rise === "number" ? n.rise : 38;
      scene.tweens.add({
        targets: label,
        y: y - rise,
        alpha: 0,
        duration: span2,
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
      const box2 = target.getBoundingClientRect();
      const frame = canvas.getBoundingClientRect();
      const kx = frame.width > 0 ? scene.scale.width / frame.width : 1;
      const ky = frame.height > 0 ? scene.scale.height / frame.height : 1;
      return {
        x: (box2.left + box2.width / 2 - frame.left) * kx,
        y: (box2.top + box2.height / 2 - frame.top) * ky
      };
    }
    let comboBox = null;
    let comboTimer = 0;
    function dropCombo() {
      if (!comboBox) return;
      const box2 = comboBox;
      comboBox = null;
      disown(box2);
      if (!box2.scene) return;
      scene.tweens.add({
        targets: box2,
        alpha: 0,
        duration: Math.max(120, pace),
        onComplete: function() {
          box2.destroy();
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
        const word3 = scene.add.text(0, 4, "", {
          fontFamily: th.fontMono,
          fontSize: "12px",
          color: hex(th.inkDim)
        }).setOrigin(0.5, 0);
        comboBox = own(scene.add.container(at.x, at.y, [digits2, word3]).setDepth(depth));
        comboBox.setData("digits", digits2);
        comboBox.setData("word", word3);
      }
      const digits = comboBox.getData("digits");
      const word2 = comboBox.getData("word");
      digits.setFontSize(size);
      digits.setText(String(count));
      word2.setText(c.label ? String(c.label) : "");
      word2.setVisible(!!c.label);
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
      const span2 = Math.max(FRAME_MS, typeof t.ms === "number" ? t.ms : 280);
      const top2 = Math.max(0, Math.min(1, typeof t.alpha === "number" ? t.alpha : 0.5));
      for (let i = 0; i < count; i++) {
        const timer = scene.time.delayedCall(i * step, function() {
          if (dead || !gameObject.scene) return;
          const frame = gameObject.frame ? gameObject.frame.name : void 0;
          const ghost = scene.add.image(gameObject.x, gameObject.y, gameObject.texture.key, frame);
          ghost.setOrigin(gameObject.originX, gameObject.originY).setScale(gameObject.scaleX, gameObject.scaleY).setRotation(gameObject.rotation).setFlipX(!!gameObject.flipX).setFlipY(!!gameObject.flipY).setAlpha(top2).setDepth((gameObject.depth || 0) - 1);
          if (typeof t.tint === "number") ghost.setTint(t.tint);
          own(ghost);
          scene.tweens.add({
            targets: ghost,
            alpha: 0,
            duration: span2,
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
      number: number2,
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
        return rt.createRoom({ app_type: s.app, name: s.room, is_public: true }).then(function(made2) {
          return String(made2.id);
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
  function colourOf(mark, paint2) {
    const named = mark && mark.colour;
    if (named && ROLE[named] && paint2[ROLE[named]]) return paint2[ROLE[named]];
    if (named && paint2[named]) return paint2[named];
    return paint2[ROLE[mark ? mark.kind : "empty"]] || paint2.ink;
  }
  function letterOn(ctx, text, font, px, py, size) {
    ctx.font = Math.round(size * 0.72) + "px " + font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, px + size / 2, py + size * 0.54);
  }
  function drawCell(ctx, mark, paint2, px, py, size) {
    ctx.fillStyle = paint2.surface;
    ctx.fillRect(px, py, size, size);
    const kind = mark ? mark.kind : "empty";
    if (!mark || kind === "empty") return;
    const mid = size / 2;
    ctx.fillStyle = colourOf(mark, paint2);
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
      letterOn(ctx, mark.char, paint2.fontMono, px, py, size);
    } else {
      ctx.fillRect(px, py, size, size);
      ctx.fillStyle = paint2.surface;
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
        letterOn(ctx, mark.char, paint2.fontMono, px, py, size);
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
    let paint2 = (
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
    const palette3 = el("div", { class: "ak-leveled__palette", role: "group", "aria-label": "Tools" });
    const status2 = el("p", { class: "ak-leveled__status", role: "status" });
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
    function button2(label, run, needsWrite) {
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
    function build2() {
      for (const char of offered()) toolMarks.push(legend[char]);
      toolMarks.push(legend[EMPTY] || { char: EMPTY, kind: "empty", label: "Eraser" });
      for (let i = 0; i < toolMarks.length; i += 1) palette3.appendChild(toolButton(toolMarks[i], i));
      root.appendChild(el("div", { class: "ak-leveled__bar" }, [
        el("div", { class: "ak-leveled__group" }, [
          el("span", { class: "ak-leveled__legendword", text: "Size" }),
          colsInput,
          el("span", { class: "ak-leveled__times", text: "x" }),
          rowsInput
        ]),
        el("div", { class: "ak-leveled__group" }, [
          button2("Undo", function() {
            api.undo();
          }, true),
          button2("Redo", function() {
            api.redo();
          }, true),
          button2("Clear", function() {
            api.clear();
          }, true),
          button2("Copy as JS", copyAsJs)
        ]),
        store ? el("div", { class: "ak-leveled__group ak-leveled__group--store" }, [
          nameInput,
          picker,
          button2("Save", function() {
            void saveLevel();
          }, true),
          button2("Load", loadLevel),
          button2("New", newLevel, true),
          button2("Delete", function() {
            void deleteLevel();
          }, true)
        ]) : null
      ]));
      root.appendChild(el("div", { class: "ak-leveled__main" }, [
        palette3,
        el("div", { class: "ak-leveled__stage" }, canvas)
      ]));
      root.appendChild(status2);
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
      if (!paint2) paint2 = theme.css(root);
      return paint2;
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
    function overlay(ctx, p, box2) {
      ctx.globalAlpha = RULE_ALPHA;
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 1;
      if (box2) {
        ctx.strokeRect(box2[0] * tile + 0.5, box2[1] * tile + 0.5, tile, tile);
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
      const box2 = canvas.getBoundingClientRect();
      if (!box2.width || !box2.height) return null;
      const x = Math.floor((ev.clientX - box2.left) / (box2.width / cols));
      const y = Math.floor((ev.clientY - box2.top) / (box2.height / rowCount));
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
      status2.textContent = words;
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
      paint2 = null;
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
    build2();
    api.tool(toolChar);
    adopt(grid, false);
    if (store) void refreshLevels();
    return api;
  }

  // src/static/sdk-libs/phaser/fx-presets.js
  var PRESETS = {
    rain: {
      shape: "drop",
      colours: ["ch1"],
      weather: {
        zone: "top",
        rate: 140,
        life: 2400,
        wind: 0,
        sway: 20,
        align: true,
        config: {
          speedY: { min: 640, max: 880 },
          lifespan: { min: 1600, max: 2400 },
          alpha: { min: 0.35, max: 0.8 },
          scale: { min: 0.8, max: 1.2 }
        }
      },
      at: {
        count: 14,
        life: 700,
        config: {
          speedX: { min: -60, max: 60 },
          speedY: { min: 300, max: 520 },
          gravityY: 500,
          lifespan: { min: 400, max: 700 },
          alpha: { start: 0.8, end: 0 },
          scale: { min: 0.7, max: 1 }
        }
      }
    },
    snow: {
      shape: "flake",
      colours: ["inkDim"],
      weather: {
        zone: "top",
        rate: 36,
        life: 9e3,
        wind: 0,
        sway: 18,
        config: {
          speedY: { min: 40, max: 90 },
          lifespan: { min: 6e3, max: 9e3 },
          alpha: { min: 0.5, max: 0.95 },
          scale: { min: 0.6, max: 1.4 }
        }
      },
      at: {
        count: 10,
        life: 1400,
        config: {
          speed: { min: 20, max: 70 },
          angle: { min: 0, max: 360 },
          gravityY: 30,
          lifespan: { min: 800, max: 1400 },
          alpha: { start: 0.9, end: 0 },
          scale: { min: 0.6, max: 1.2 }
        }
      }
    },
    fog: {
      shape: "puff",
      colours: ["inkDim"],
      weather: {
        zone: "all",
        rate: 5,
        life: 9e3,
        wind: 12,
        sway: 6,
        config: {
          speedY: { min: -4, max: 4 },
          lifespan: { min: 6e3, max: 9e3 },
          alpha: { values: [0, 0.5, 0.5, 0], interpolation: "linear" },
          scale: { min: 1.6, max: 3.2 }
        }
      },
      at: {
        count: 6,
        life: 1800,
        config: {
          speed: { min: 6, max: 24 },
          angle: { min: 0, max: 360 },
          lifespan: { min: 1200, max: 1800 },
          alpha: { start: 0.5, end: 0 },
          scale: { start: 1, end: 2.4 }
        }
      }
    },
    smoke: {
      shape: "puff",
      colours: ["inkDim"],
      follow: {
        life: 1800,
        config: {
          frequency: 90,
          quantity: 1,
          speedX: { min: -14, max: 14 },
          speedY: { min: -70, max: -30 },
          lifespan: { min: 1200, max: 1800 },
          alpha: { start: 0.55, end: 0 },
          scale: { start: 0.5, end: 1.6 }
        }
      },
      at: {
        count: 8,
        life: 1400,
        config: {
          speed: { min: 10, max: 50 },
          angle: { min: -120, max: -60 },
          gravityY: -30,
          lifespan: { min: 900, max: 1400 },
          alpha: { start: 0.6, end: 0 },
          scale: { start: 0.6, end: 1.8 }
        }
      }
    },
    fire: {
      shape: "dot",
      colours: ["warn", "err", "ch3"],
      follow: {
        life: 700,
        config: {
          frequency: 28,
          quantity: 2,
          speedX: { min: -18, max: 18 },
          speedY: { min: -120, max: -60 },
          gravityY: -60,
          lifespan: { min: 400, max: 700 },
          scale: { start: 1.4, end: 0 },
          alpha: { start: 0.95, end: 0 }
        }
      },
      at: {
        count: 18,
        life: 700,
        config: {
          speed: { min: 40, max: 160 },
          angle: { min: -130, max: -50 },
          gravityY: -80,
          lifespan: { min: 400, max: 700 },
          scale: { start: 1.4, end: 0 },
          alpha: { start: 1, end: 0 }
        }
      }
    },
    embers: {
      shape: "flake",
      colours: ["warn", "ch3"],
      weather: {
        zone: "bottom",
        rate: 10,
        life: 7e3,
        wind: 8,
        sway: 14,
        config: {
          speedY: { min: -70, max: -25 },
          accelerationY: -6,
          lifespan: { min: 4e3, max: 7e3 },
          alpha: { start: 0.9, end: 0, ease: "Sine.easeIn" },
          scale: { min: 0.6, max: 1.2 }
        }
      },
      follow: {
        life: 1600,
        config: {
          frequency: 120,
          quantity: 1,
          speedX: { min: -30, max: 30 },
          speedY: { min: -80, max: -30 },
          lifespan: { min: 900, max: 1600 },
          alpha: { start: 1, end: 0 },
          scale: { start: 1, end: 0.3 }
        }
      },
      at: {
        count: 12,
        life: 1400,
        config: {
          speed: { min: 30, max: 120 },
          angle: { min: -150, max: -30 },
          gravityY: -40,
          lifespan: { min: 800, max: 1400 },
          alpha: { start: 1, end: 0 },
          scale: { start: 1, end: 0.2 }
        }
      }
    },
    sparks: {
      shape: "spark",
      colours: ["accent", "ch3"],
      at: {
        count: 16,
        life: 420,
        config: {
          speed: { min: 120, max: 360 },
          angle: { min: 0, max: 360 },
          gravityY: 300,
          lifespan: { min: 220, max: 420 },
          rotate: { min: -180, max: 180 },
          scale: { start: 1, end: 0 }
        }
      },
      follow: {
        life: 500,
        config: {
          frequency: 40,
          quantity: 2,
          speed: { min: 80, max: 240 },
          angle: { min: -170, max: -10 },
          gravityY: 400,
          lifespan: { min: 250, max: 500 },
          rotate: { min: -180, max: 180 },
          scale: { start: 1, end: 0 }
        }
      }
    },
    dust: {
      shape: "dot",
      colours: ["inkDim"],
      weather: {
        zone: "all",
        rate: 6,
        life: 8e3,
        wind: 4,
        sway: 8,
        config: {
          speedY: { min: -6, max: 6 },
          lifespan: { min: 5e3, max: 8e3 },
          alpha: { values: [0, 0.6, 0], interpolation: "linear" },
          scale: { min: 0.25, max: 0.6 }
        }
      },
      at: {
        count: 8,
        life: 460,
        config: {
          speed: { min: 20, max: 80 },
          angle: { min: 190, max: 350 },
          gravityY: 40,
          lifespan: { min: 300, max: 460 },
          scale: { start: 0.9, end: 0.1 },
          alpha: { start: 0.55, end: 0 }
        }
      },
      follow: {
        life: 500,
        behind: true,
        config: {
          frequency: 70,
          quantity: 1,
          speed: { min: 10, max: 40 },
          angle: { min: -160, max: -20 },
          lifespan: { min: 300, max: 500 },
          scale: { start: 0.8, end: 0.1 },
          alpha: { start: 0.5, end: 0 }
        }
      }
    },
    bubbles: {
      shape: "bubble",
      colours: ["ch1"],
      follow: {
        life: 2200,
        config: {
          frequency: 160,
          quantity: 1,
          speedX: { min: -12, max: 12 },
          speedY: { min: -70, max: -35 },
          lifespan: { min: 1400, max: 2200 },
          scale: { start: 0.5, end: 1.1 },
          alpha: { start: 0.9, end: 0 }
        }
      },
      weather: {
        zone: "bottom",
        rate: 8,
        life: 9e3,
        wind: 0,
        sway: 10,
        config: {
          speedY: { min: -60, max: -25 },
          lifespan: { min: 6e3, max: 9e3 },
          scale: { min: 0.5, max: 1.3 },
          alpha: { min: 0.4, max: 0.9 }
        }
      },
      at: {
        count: 10,
        life: 1200,
        config: {
          speed: { min: 20, max: 70 },
          angle: { min: -140, max: -40 },
          gravityY: -50,
          lifespan: { min: 700, max: 1200 },
          scale: { start: 0.6, end: 1.1 },
          alpha: { start: 0.9, end: 0 }
        }
      }
    },
    stars: {
      shape: "star",
      colours: ["ch3", "ink"],
      weather: {
        zone: "all",
        rate: 7,
        life: 2600,
        config: {
          speedX: 0,
          speedY: 0,
          lifespan: { min: 1200, max: 2600 },
          alpha: { values: [0, 1, 0], interpolation: "linear" },
          scale: { min: 0.5, max: 1.2 },
          rotate: { min: 0, max: 90 }
        }
      },
      at: {
        count: 12,
        life: 900,
        config: {
          speed: { min: 10, max: 60 },
          angle: { min: 0, max: 360 },
          lifespan: { min: 500, max: 900 },
          alpha: { start: 1, end: 0 },
          scale: { start: 1.2, end: 0.2 },
          rotate: { min: -90, max: 90 }
        }
      }
    },
    leaves: {
      shape: "leaf",
      colours: ["ok", "warn"],
      weather: {
        zone: "top",
        rate: 8,
        life: 9e3,
        wind: 25,
        sway: 30,
        config: {
          speedY: { min: 45, max: 110 },
          lifespan: { min: 5e3, max: 9e3 },
          rotate: { min: -180, max: 180 },
          scale: { min: 0.7, max: 1.3 },
          alpha: { min: 0.7, max: 1 }
        }
      },
      at: {
        count: 10,
        life: 1600,
        config: {
          speed: { min: 40, max: 140 },
          angle: { min: -170, max: -10 },
          gravityY: 90,
          lifespan: { min: 1e3, max: 1600 },
          rotate: { min: -180, max: 180 },
          alpha: { start: 1, end: 0.3 },
          scale: { min: 0.7, max: 1.2 }
        }
      }
    },
    confetti: {
      shape: "chip",
      colours: ["ch1", "ch2", "ch3", "ch4"],
      at: {
        count: 22,
        life: 1e3,
        config: {
          speed: { min: 140, max: 320 },
          angle: { min: -160, max: -20 },
          gravityY: 430,
          lifespan: { min: 640, max: 1e3 },
          rotate: { min: -180, max: 180 },
          scale: { start: 1, end: 0.7 },
          alpha: { start: 1, end: 0.2 }
        }
      },
      weather: {
        zone: "top",
        rate: 20,
        life: 6e3,
        wind: 0,
        sway: 40,
        config: {
          speedY: { min: 80, max: 200 },
          lifespan: { min: 4e3, max: 6e3 },
          rotate: { min: -180, max: 180 },
          scale: { min: 0.7, max: 1.2 }
        }
      }
    },
    explosion: {
      shape: "dot",
      colours: ["err", "warn", "ch3"],
      at: {
        count: 32,
        life: 800,
        config: {
          speed: { min: 80, max: 420 },
          angle: { min: 0, max: 360 },
          gravityY: 120,
          lifespan: { min: 300, max: 800 },
          scale: { start: 1.8, end: 0 },
          alpha: { start: 1, end: 0 }
        }
      }
    },
    portal: {
      shape: "flake",
      colours: ["accent", "ch2"],
      at: {
        count: 26,
        life: 1e3,
        ring: 28,
        config: {
          speed: { min: 20, max: 60 },
          angle: { min: 0, max: 360 },
          gravityY: -80,
          lifespan: { min: 600, max: 1e3 },
          alpha: { start: 1, end: 0 },
          scale: { start: 1, end: 0.2 }
        }
      },
      follow: {
        life: 900,
        ring: 22,
        config: {
          frequency: 50,
          quantity: 1,
          speed: { min: 5, max: 20 },
          angle: { min: 0, max: 360 },
          gravityY: -40,
          lifespan: { min: 500, max: 900 },
          alpha: { start: 1, end: 0 },
          scale: { start: 1, end: 0.2 }
        }
      }
    },
    trail: {
      shape: "dot",
      colours: ["accent"],
      follow: {
        life: 420,
        behind: true,
        config: {
          frequency: 24,
          quantity: 1,
          speed: 0,
          lifespan: { min: 260, max: 420 },
          alpha: { start: 0.6, end: 0 },
          scale: { start: 1, end: 0.2 }
        }
      }
    },
    splash: {
      shape: "flake",
      colours: ["ch1"],
      at: {
        count: 16,
        life: 700,
        config: {
          speed: { min: 90, max: 260 },
          angle: { min: -150, max: -30 },
          gravityY: 600,
          lifespan: { min: 400, max: 700 },
          scale: { start: 1, end: 0.4 },
          alpha: { start: 0.95, end: 0.2 }
        }
      }
    },
    footsteps: {
      shape: "print",
      colours: ["inkDim"],
      at: {
        count: 1,
        life: 900,
        config: { speed: 0, lifespan: 900, alpha: { start: 0.45, end: 0 } }
      },
      follow: {
        life: 1200,
        behind: true,
        config: { frequency: 260, quantity: 1, speed: 0, lifespan: 1200, alpha: { start: 0.45, end: 0 } }
      }
    }
  };
  var ALIASES = { mist: "fog", magic: "portal" };

  // src/static/sdk-libs/phaser/fx-parts.js
  var MAX_PER_SECOND = 60;
  var MARGIN = 48;
  var MOTION_KEYS = [
    "speed",
    "speedX",
    "speedY",
    "gravityX",
    "gravityY",
    "accelerationX",
    "accelerationY",
    "maxVelocityX",
    "maxVelocityY"
  ];
  var SHAPES = {
    dot: { w: 8, h: 8 },
    chip: { w: 7, h: 10 },
    spark: { w: 12, h: 3 },
    drop: { w: 2, h: 14 },
    flake: { w: 5, h: 5 },
    puff: { w: 32, h: 32 },
    ring: { w: 24, h: 24 },
    star: { w: 9, h: 9 },
    leaf: { w: 12, h: 7 },
    bubble: { w: 10, h: 10 },
    print: { w: 6, h: 9 }
  };
  var CELL_GAP = 2;
  function drawCell2(g, shape, colour, ox, w, h) {
    const cx = ox + w / 2;
    const cy = h / 2;
    g.fillStyle(colour, 1);
    if (shape === "dot" || shape === "flake") {
      g.fillCircle(cx, cy, w / 2);
    } else if (shape === "puff") {
      g.fillStyle(colour, 0.1);
      g.fillCircle(cx, cy, 16);
      g.fillStyle(colour, 0.12);
      g.fillCircle(cx, cy, 11);
      g.fillStyle(colour, 0.14);
      g.fillCircle(cx, cy, 6);
    } else if (shape === "ring") {
      g.lineStyle(2, colour, 1);
      g.strokeCircle(cx, cy, 10);
    } else if (shape === "star") {
      g.fillRect(ox + 3.5, 0, 2, h);
      g.fillRect(ox, 3.5, w, 2);
    } else if (shape === "leaf" || shape === "print") {
      g.fillEllipse(cx, cy, w, h);
    } else if (shape === "bubble") {
      g.lineStyle(1.5, colour, 0.9);
      g.strokeCircle(cx, cy, 4);
      g.fillStyle(colour, 0.9);
      g.fillCircle(ox + 3.5, 3.5, 1);
    } else {
      g.fillRect(ox, 0, w, h);
    }
  }
  function strip(scene, shape, colours) {
    const size = SHAPES[shape] || SHAPES.dot;
    const key = "ak-fx-" + shape + "-" + colours.map(function(c) {
      return (c >>> 0 & 16777215).toString(16);
    }).join("-");
    const frames = [];
    for (let i = 0; i < colours.length; i++) frames.push("c" + i);
    if (scene.textures && scene.textures.exists(key)) {
      return { key, frames: frames.length === 1 ? frames[0] : frames };
    }
    const g = scene.make.graphics({ add: false });
    const cell = size.w + CELL_GAP;
    for (let i = 0; i < colours.length; i++) drawCell2(g, shape, colours[i], i * cell, size.w, size.h);
    g.generateTexture(key, cell * colours.length, size.h);
    g.destroy();
    const texture = scene.textures.get(key);
    for (let i = 0; i < colours.length; i++) texture.add(frames[i], 0, i * cell, 0, size.w, size.h);
    return { key, frames: frames.length === 1 ? frames[0] : frames };
  }
  function box(x, y, w, h) {
    return {
      x,
      y,
      w,
      h,
      fit: function(nx, ny, nw, nh) {
        this.x = nx;
        this.y = ny;
        this.w = nw;
        this.h = nh;
      },
      getRandomPoint: function(p) {
        p.x = this.x + Math.random() * this.w;
        p.y = this.y + Math.random() * this.h;
        return p;
      },
      contains: function(px, py) {
        return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h;
      }
    };
  }
  function ring(radius) {
    return {
      getRandomPoint: function(p) {
        const a = Math.random() * Math.PI * 2;
        const r = radius * (0.9 + Math.random() * 0.2);
        p.x = Math.cos(a) * r;
        p.y = Math.sin(a) * r;
        return p;
      }
    };
  }
  function fitZones(born, kept, zone, w, h, wind, life) {
    const drift = Math.min(w, Math.abs(wind) * life / 1e3);
    const left = wind > 0 ? -MARGIN - drift : -MARGIN;
    const width = w + MARGIN * 2 + drift;
    if (zone === "top") born.fit(left, -MARGIN, width, MARGIN);
    else if (zone === "bottom") born.fit(left, h, width, MARGIN);
    else born.fit(wind > 0 ? -drift : 0, 0, w + drift, h);
    kept.fit(left - MARGIN, -MARGIN * 2, width + MARGIN * 2, h + MARGIN * 3);
  }
  function merge(base, extra) {
    const out = {};
    for (const name in base) out[name] = base[name];
    if (extra) for (const name in extra) out[name] = extra[name];
    return out;
  }
  function scaled(v, k) {
    if (typeof v === "number") return v * k;
    if (v && typeof v === "object") {
      const out = merge(v);
      if (typeof out.min === "number") out.min *= k;
      if (typeof out.max === "number") out.max *= k;
      if (typeof out.start === "number") out.start *= k;
      if (typeof out.end === "number") out.end *= k;
      return out;
    }
    return v;
  }
  function slowed(config, k) {
    const out = merge(config);
    for (const name of MOTION_KEYS) if (name in out) out[name] = scaled(out[name], k);
    return out;
  }
  function mean(v) {
    if (typeof v === "number") return v;
    if (v && typeof v.min === "number" && typeof v.max === "number") return (v.min + v.max) / 2;
    return 0;
  }
  function flow(perSecond) {
    if (!(perSecond > 0)) return { frequency: 1e3, quantity: 0 };
    const quantity = Math.max(1, Math.ceil(perSecond / MAX_PER_SECOND));
    return { frequency: 1e3 * quantity / perSecond, quantity };
  }

  // src/static/sdk-libs/phaser/fx.js
  var WEATHER_DEPTH = 800;
  var BURST_DEPTH = 850;
  var DEPTH_CEILING = OVERLAY_DEPTH - 30;
  var REF_WIDTH = 960;
  var SLACK = 80;
  var STILL_DENSITY = 0.35;
  var STILL_SPEED = 0.5;
  var PUFF = {
    count: 4,
    life: 240,
    config: {
      speed: { min: 0, max: 10 },
      angle: { min: 0, max: 360 },
      lifespan: 240,
      alpha: { start: 0.6, end: 0 },
      scale: { start: 1, end: 0.6 }
    }
  };
  var CUSTOM = {};
  function tone2(th, want, fallback) {
    if (typeof want === "number" && isFinite(want)) return want;
    if (typeof want === "string" && typeof th[want] === "number") return th[want];
    return fallback;
  }
  function fx(scene, opts) {
    const o = opts || /** @type {FxOptions} */
    {};
    const th = o.theme || look(scene);
    let dead = false;
    const timeouts = /* @__PURE__ */ new Set();
    const emitters = [];
    const weathers = [];
    const layers = [];
    const handles = [];
    let watchingResize = false;
    function later(wait, run) {
      const id = setTimeout(function() {
        timeouts.delete(id);
        if (!dead) run();
      }, Math.max(0, wait));
      timeouts.add(id);
    }
    function own(emitter) {
      emitters.push(emitter);
      return emitter;
    }
    function drop(emitter) {
      const at2 = emitters.indexOf(emitter);
      if (at2 >= 0) emitters.splice(at2, 1);
      if (emitter && emitter.scene !== void 0 && typeof emitter.destroy === "function") emitter.destroy();
    }
    function drain(emitter, life) {
      if (!emitter) return;
      if (typeof emitter.stop === "function") emitter.stop();
      later(life + SLACK, function() {
        drop(emitter);
      });
    }
    function depthOf(want, fallback) {
      const d = typeof want === "number" && isFinite(want) ? want : fallback;
      return Math.min(d, DEPTH_CEILING);
    }
    function resolve2(name) {
      if (typeof name !== "string") return null;
      const custom = CUSTOM[name];
      if (custom) return typeof custom === "function" ? custom(th) : custom;
      return PRESETS[ALIASES[name] || name] || null;
    }
    function textureOf(preset, want) {
      if (preset.texture) return { key: preset.texture, frames: preset.frame };
      const words = Array.isArray(preset.colours) && preset.colours.length ? preset.colours : ["accent"];
      const colours = want === void 0 ? words.map(function(w) {
        return tone2(th, w, th.accent);
      }) : [tone2(th, want, th.accent)];
      return strip(scene, preset.shape || "dot", colours);
    }
    function assemble(family, tex, extra) {
      const config = merge(family.config, extra);
      config.texture = tex.key;
      if (tex.frames !== void 0) config.frame = tex.frames;
      return config;
    }
    function onResize() {
      for (const layer of layers) layer.refit();
    }
    function watchResize() {
      if (watchingResize || !scene.scale || typeof scene.scale.on !== "function") return;
      watchingResize = true;
      scene.scale.on("resize", onResize);
    }
    function weatherConfig(preset, s, born, kept, still) {
      const wx = preset.weather;
      const cam = scene.cameras.main;
      const density = Math.max(0, typeof s.density === "number" ? s.density : 1) * (still ? STILL_DENSITY : 1);
      const wind = still ? 0 : typeof s.wind === "number" ? s.wind : wx.wind || 0;
      let config = merge(wx.config);
      if (typeof wx.sway === "number") {
        const sway = still ? 0 : wx.sway;
        config.speedX = { min: wind - sway, max: wind + sway };
      }
      if (wx.align) config.rotate = 0 - Math.atan2(wind, mean(config.speedY)) * 180 / Math.PI;
      if (still) config = slowed(config, STILL_SPEED);
      const rate = flow(wx.rate * (cam.width / REF_WIDTH) * density);
      config.frequency = rate.frequency;
      config.quantity = rate.quantity;
      fitZones(born, kept, wx.zone, cam.width, cam.height, wind, wx.life);
      config.emitZone = { type: "random", source: born };
      config.deathZone = { type: "onLeave", source: kept };
      if (s.config) config = merge(config, s.config);
      const tex = textureOf(preset, s.colour);
      config.texture = tex.key;
      if (tex.frames !== void 0) config.frame = tex.frames;
      return config;
    }
    function weather(kind, wopts) {
      if (dead || !scene.add || !scene.cameras || !scene.cameras.main) return null;
      const preset = resolve2(kind);
      if (!preset || !preset.weather) return null;
      const settings = merge(wopts || {});
      if (!settings.stack) for (const other of weathers.slice()) other.stop();
      const born = box(0, 0, 1, 1);
      const kept = box(0, 0, 1, 1);
      const life = preset.weather.life;
      let gone = false;
      const layer = {
        kind,
        emitter: null,
        active: true,
        refit: function() {
          if (gone) return;
          const cam = scene.cameras.main;
          const still = reducedMotion();
          const wind = still ? 0 : typeof settings.wind === "number" ? settings.wind : preset.weather.wind || 0;
          fitZones(born, kept, preset.weather.zone, cam.width, cam.height, wind, life);
        },
        set: function(patch) {
          if (gone) return layer;
          for (const name in patch || {}) settings[name] = patch[name];
          const old = layer.emitter;
          layer.emitter = build2();
          drain(old, life);
          return layer;
        },
        stop: function() {
          if (gone) return;
          gone = true;
          layer.active = false;
          forget();
          drain(layer.emitter, life);
          layer.emitter = null;
        },
        destroy: function() {
          if (gone) {
            if (layer.emitter) drop(layer.emitter);
            layer.emitter = null;
            return;
          }
          gone = true;
          layer.active = false;
          forget();
          drop(layer.emitter);
          layer.emitter = null;
        }
      };
      function forget() {
        let at2 = weathers.indexOf(layer);
        if (at2 >= 0) weathers.splice(at2, 1);
        at2 = layers.indexOf(layer);
        if (at2 >= 0) layers.splice(at2, 1);
        at2 = handles.indexOf(layer);
        if (at2 >= 0) handles.splice(at2, 1);
      }
      function build2() {
        const config = weatherConfig(preset, settings, born, kept, reducedMotion());
        const emitter = scene.add.particles(0, 0, config.texture, config);
        emitter.setScrollFactor(0);
        emitter.setDepth(depthOf(settings.depth, WEATHER_DEPTH));
        return own(emitter);
      }
      layer.emitter = build2();
      weathers.push(layer);
      layers.push(layer);
      handles.push(layer);
      watchResize();
      return layer;
    }
    function at(x, y, kind, aopts) {
      if (dead || !scene.add) return null;
      const preset = resolve2(kind);
      if (!preset || !preset.at) return null;
      const a = aopts || {};
      const still = reducedMotion();
      const family = still ? PUFF : preset.at;
      const tex = textureOf(preset, a.colour);
      const config = assemble(family, tex, still ? void 0 : a.config);
      if (!still && preset.at.ring) config.emitZone = { type: "random", source: ring(preset.at.ring) };
      config.emitting = false;
      const emitter = own(scene.add.particles(x, y, tex.key, config));
      emitter.setDepth(depthOf(a.depth, BURST_DEPTH));
      if (typeof a.scrollFactor === "number") emitter.setScrollFactor(a.scrollFactor);
      const count = still ? PUFF.count : Math.max(1, Math.round(typeof a.count === "number" ? a.count : family.count));
      emitter.explode(count);
      let done = false;
      const finish = function() {
        if (done) return;
        done = true;
        drop(emitter);
      };
      if (typeof emitter.once === "function") emitter.once("complete", finish);
      later(family.life + SLACK, finish);
      return emitter;
    }
    function follow(target, kind, fopts) {
      if (dead || !scene.add || !target) return null;
      const preset = resolve2(kind);
      if (!preset || !preset.follow) return null;
      const settings = merge(fopts || {});
      const life = preset.follow.life;
      if (reducedMotion()) {
        const still = { kind, emitter: null, active: false };
        still.set = function() {
          return still;
        };
        still.stop = function() {
        };
        still.destroy = function() {
        };
        return still;
      }
      let gone = false;
      const layer = {
        kind,
        emitter: null,
        active: true,
        set: function(patch) {
          if (gone) return layer;
          for (const name in patch || {}) settings[name] = patch[name];
          const old = layer.emitter;
          layer.emitter = build2();
          drain(old, life);
          return layer;
        },
        stop: function() {
          if (gone) return;
          gone = true;
          layer.active = false;
          unhook();
          drain(layer.emitter, life);
          layer.emitter = null;
        },
        destroy: function() {
          if (gone) {
            if (layer.emitter) drop(layer.emitter);
            layer.emitter = null;
            return;
          }
          gone = true;
          layer.active = false;
          unhook();
          drop(layer.emitter);
          layer.emitter = null;
        }
      };
      const onTargetGone = function() {
        layer.destroy();
      };
      function unhook() {
        if (typeof target.off === "function") target.off("destroy", onTargetGone);
        const at2 = handles.indexOf(layer);
        if (at2 >= 0) handles.splice(at2, 1);
      }
      function build2() {
        const tex = textureOf(preset, settings.colour);
        const config = assemble(preset.follow, tex, settings.config);
        if (typeof settings.density === "number") {
          const rate = flow(1e3 / Math.max(1, config.frequency) * (config.quantity || 1) * Math.max(0, settings.density));
          config.frequency = rate.frequency;
          config.quantity = rate.quantity;
        }
        if (preset.follow.ring) config.emitZone = { type: "random", source: ring(preset.follow.ring) };
        const emitter = scene.add.particles(0, 0, tex.key, config);
        const off = settings.offset || {};
        emitter.startFollow(target, off.x || 0, off.y || 0, true);
        const step = preset.follow.behind ? -1 : 1;
        emitter.setDepth(depthOf(settings.depth, (typeof target.depth === "number" ? target.depth : 0) + step));
        if (typeof target.scrollFactorX === "number") {
          emitter.setScrollFactor(target.scrollFactorX, target.scrollFactorY);
        }
        return own(emitter);
      }
      layer.emitter = build2();
      handles.push(layer);
      if (typeof target.once === "function") target.once("destroy", onTargetGone);
      return layer;
    }
    function presetOf(name, family) {
      if (dead) return null;
      const p = resolve2(name);
      const fam = family || "at";
      if (!p || !p[fam]) return null;
      if (fam === "weather") {
        if (!scene.cameras || !scene.cameras.main) return null;
        return weatherConfig(p, {}, box(0, 0, 1, 1), box(0, 0, 1, 1), false);
      }
      const tex = textureOf(p, void 0);
      const config = assemble(p[fam], tex);
      if (p[fam].ring) config.emitZone = { type: "random", source: ring(p[fam].ring) };
      if (fam === "at") config.emitting = false;
      return config;
    }
    function define(name, def) {
      if (typeof name !== "string" || !name || (!def || typeof def !== "object" && typeof def !== "function")) {
        throw new Error("fx.define wants a name and a preset object or a function of the theme.");
      }
      CUSTOM[name] = def;
      return name;
    }
    function kinds(family) {
      const out = [];
      const seen = {};
      const add = function(name, p) {
        if (seen[name] || !p || family && !p[family]) return;
        seen[name] = true;
        out.push(name);
      };
      for (const name in CUSTOM) add(name, resolve2(name));
      for (const name in PRESETS) add(name, PRESETS[name]);
      return out;
    }
    function destroy() {
      if (dead) return;
      dead = true;
      if (scene.events && typeof scene.events.off === "function") {
        scene.events.off("shutdown", destroy);
        scene.events.off("destroy", destroy);
      }
      if (watchingResize && scene.scale && typeof scene.scale.off === "function") {
        scene.scale.off("resize", onResize);
      }
      watchingResize = false;
      for (const id of timeouts) clearTimeout(id);
      timeouts.clear();
      for (const layer of handles.slice()) layer.destroy();
      weathers.length = 0;
      layers.length = 0;
      handles.length = 0;
      for (const emitter of emitters.slice()) drop(emitter);
      emitters.length = 0;
    }
    if (scene.events && typeof scene.events.once === "function") {
      scene.events.once("shutdown", destroy);
      scene.events.once("destroy", destroy);
    }
    return {
      weather,
      at,
      follow,
      preset: presetOf,
      define,
      kinds,
      destroy
    };
  }

  // src/static/sdk-libs/phaser/parallax-layers.js
  var TAU = Math.PI * 2;
  var WHITE = 16777215;
  var BLACK = 0;
  function rng2(seed) {
    let a = Math.floor(Number(seed) || 0) >>> 0 || 2654435769;
    return function() {
      a = a + 1831565813 >>> 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function mix(a, b, t) {
    const k = Math.max(0, Math.min(1, t));
    const from = channels(a);
    const to = channels(b);
    const r = Math.round(from.r + (to.r - from.r) * k);
    const g = Math.round(from.g + (to.g - from.g) * k);
    const bl = Math.round(from.b + (to.b - from.b) * k);
    return r << 16 | g << 8 | bl;
  }
  function shade2(colour, amount) {
    return mix(colour, amount >= 0 ? WHITE : BLACK, Math.abs(amount));
  }
  function luminance(colour) {
    const c = channels(colour);
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }
  function pot(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }
  function css(colour, alpha) {
    const c = channels(colour);
    const a = alpha == null ? 1 : Math.max(0, Math.min(1, alpha));
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")";
  }
  var KIND_DEFAULTS = {
    sky: { height: 1, scroll: 0, tone: "ch1", alpha: 1, drift: 0, haze: 0 },
    stars: { height: 0.7, scroll: 0.04, tone: "light", alpha: 1, drift: 0, haze: 0 },
    clouds: { height: 0.5, scroll: 0.12, tone: "surface", alpha: 0.9, drift: 6, haze: 0.15 },
    mountains: { height: 0.5, scroll: 0.2, tone: "inkDim", alpha: 1, drift: 0, haze: 0.5 },
    hills: { height: 0.36, scroll: 0.35, tone: "ok", alpha: 1, drift: 0, haze: 0.35 },
    forest: { height: 0.34, scroll: 0.5, tone: "ok", alpha: 1, drift: 0, haze: 0.25 },
    city: { height: 0.55, scroll: 0.3, tone: "inkDim", alpha: 1, drift: 0, haze: 0.4 },
    sea: { height: 0.3, scroll: 0.45, tone: "ch1", alpha: 1, drift: 12, haze: 0.2 },
    fog: { height: 0.22, scroll: 0.55, tone: "line", alpha: 0.6, drift: 4, haze: 0 },
    ground: { height: 0.14, scroll: 0.85, tone: "inkDim", alpha: 1, drift: 0, haze: 0 }
  };
  var KINDS = Object.keys(KIND_DEFAULTS);
  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.2, r), 0, TAU);
    ctx.fill();
  }
  function wrapped(w, x, draw2) {
    draw2(x);
    draw2(x - w);
    draw2(x + w);
  }
  function sky(ctx, box2, layer, pal, _rand) {
    const grad = ctx.createLinearGradient(0, 0, 0, box2.viewH);
    grad.addColorStop(0, css(pal.skyTop, 1));
    grad.addColorStop(1, css(pal.skyBottom, 1));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, box2.w, box2.viewH);
    ctx.fillStyle = css(pal.skyBottom, 1);
    ctx.fillRect(0, box2.viewH, box2.w, Math.max(0, box2.h - box2.viewH));
    const disc = layer.disc === void 0 || layer.disc === "auto" ? pal.disc : layer.disc;
    if (disc !== "sun" && disc !== "moon") return;
    const r = box2.viewH * 0.065;
    const x = box2.viewW * (typeof layer.discX === "number" ? layer.discX : 0.74);
    const y = box2.viewH * (typeof layer.discY === "number" ? layer.discY : 0.2);
    const tone6 = disc === "moon" ? pal.moon : pal.sun;
    for (let i = 3; i >= 1; i--) {
      ctx.fillStyle = css(tone6, 0.07 * i);
      circle(ctx, x, y, r * (1 + i * 0.55));
    }
    ctx.fillStyle = css(tone6, 1);
    circle(ctx, x, y, r);
    if (disc === "moon") {
      ctx.fillStyle = css(pal.skyTop, 1);
      circle(ctx, x + r * 0.45, y - r * 0.2, r * 0.82);
    }
  }
  function stars(ctx, box2, layer, pal, rand) {
    const density = typeof layer.density === "number" ? layer.density : 1;
    const count = Math.round(box2.w * box2.band / 2600 * density);
    const subset = typeof layer.subset === "number" ? layer.subset : -1;
    for (let i = 0; i < count; i++) {
      const x = rand() * box2.w;
      const y = rand() * box2.band;
      const r = 0.5 + rand() * rand() * 1.6;
      const a = 0.45 + rand() * 0.55;
      if (subset >= 0 && i % 2 !== subset) continue;
      ctx.fillStyle = css(pal.tone, a);
      circle(ctx, x, y, r);
    }
  }
  function clouds(ctx, box2, layer, pal, rand) {
    const density = typeof layer.density === "number" ? layer.density : 1;
    const count = Math.max(2, Math.round(box2.w / 300 * density));
    for (let i = 0; i < count; i++) {
      const cx = rand() * box2.w;
      const cy = box2.band * (0.12 + rand() * 0.6);
      const size = box2.band * (0.1 + rand() * 0.14);
      const puffs = 3 + Math.floor(rand() * 3);
      const list = [];
      for (let p = 0; p < puffs; p++) {
        list.push({
          dx: (p - (puffs - 1) / 2) * size * 0.9,
          dy: (rand() - 0.5) * size * 0.4,
          r: size * (0.6 + rand() * 0.6)
        });
      }
      wrapped(box2.w, cx, function(x) {
        ctx.fillStyle = css(pal.dim, 0.45);
        for (const puff of list) circle(ctx, x + puff.dx, cy + puff.dy + size * 0.28, puff.r);
        ctx.fillStyle = css(pal.tone, 1);
        for (const puff of list) circle(ctx, x + puff.dx, cy + puff.dy, puff.r);
      });
    }
  }
  function ridge(ctx, box2, colour, tall, perK, rand) {
    const n = Math.max(4, Math.round(perK * box2.w / 1024));
    const step = box2.w / n;
    const peaks = [];
    for (let i = 0; i < n; i++) peaks.push(box2.band * (1 - tall * (0.35 + rand() * 0.65)));
    peaks.push(peaks[0]);
    ctx.fillStyle = css(colour, 1);
    ctx.beginPath();
    ctx.moveTo(0, box2.h);
    for (let i = 0; i <= n; i++) {
      ctx.lineTo(i * step, peaks[i]);
      if (i < n) {
        ctx.lineTo(i * step + step * (0.5 + (rand() - 0.5) * 0.3), box2.band * (0.72 + rand() * 0.22));
      }
    }
    ctx.lineTo(box2.w, box2.h);
    ctx.closePath();
    ctx.fill();
  }
  function mountains(ctx, box2, layer, pal, rand) {
    const jag = typeof layer.jag === "number" ? layer.jag : 1;
    ridge(ctx, box2, pal.back, 0.95, 7 * jag, rand);
    ridge(ctx, box2, pal.tone, 0.75, 10 * jag, rand);
  }
  function roll(ctx, box2, colour, lift, rand) {
    const k1 = 1 + Math.floor(rand() * 2);
    const k2 = 3 + Math.floor(rand() * 3);
    const k3 = 6 + Math.floor(rand() * 4);
    const p1 = rand() * TAU;
    const p2 = rand() * TAU;
    const p3 = rand() * TAU;
    ctx.fillStyle = css(colour, 1);
    ctx.beginPath();
    ctx.moveTo(0, box2.h);
    for (let x = 0; x <= box2.w; x += 4) {
      const t = x / box2.w * TAU;
      const wave = 0.5 + 0.25 * Math.sin(k1 * t + p1) + 0.15 * Math.sin(k2 * t + p2) + 0.1 * Math.sin(k3 * t + p3);
      ctx.lineTo(x, box2.band * (1 - lift * wave));
    }
    ctx.lineTo(box2.w, box2.h);
    ctx.closePath();
    ctx.fill();
  }
  function hills(ctx, box2, _layer, pal, rand) {
    roll(ctx, box2, pal.back, 1, rand);
    roll(ctx, box2, pal.tone, 0.7, rand);
  }
  function tree(ctx, box2, x, h) {
    const base = box2.band;
    const top2 = base - h;
    const width = h * 0.55;
    ctx.fillRect(x - width * 0.08, base - h * 0.22, width * 0.16, h * 0.22);
    for (let i = 0; i < 3; i++) {
      const ty = top2 + i * h * 0.22;
      const tw = width * (0.45 + i * 0.28);
      const th = h * 0.45;
      ctx.beginPath();
      ctx.moveTo(x, ty);
      ctx.lineTo(x - tw / 2, ty + th);
      ctx.lineTo(x + tw / 2, ty + th);
      ctx.closePath();
      ctx.fill();
    }
  }
  function treeRow(ctx, box2, colour, minH, maxH, rand) {
    ctx.fillStyle = css(colour, 1);
    const gap = maxH * 0.42;
    let x = rand() * gap;
    while (x < box2.w) {
      const h = minH + rand() * (maxH - minH);
      wrapped(box2.w, x, function(at) {
        tree(ctx, box2, at, h);
      });
      x += gap * (0.6 + rand() * 0.8);
    }
    ctx.fillRect(0, box2.band * 0.98, box2.w, Math.max(0, box2.h - box2.band * 0.98));
  }
  function forest(ctx, box2, _layer, pal, rand) {
    treeRow(ctx, box2, pal.back, box2.band * 0.5, box2.band * 0.72, rand);
    treeRow(ctx, box2, pal.tone, box2.band * 0.72, box2.band * 0.98, rand);
  }
  function skyline(ctx, box2, colour, tall, window2, rand) {
    const gap = Math.max(1, box2.w * 4e-3);
    const cell = Math.max(3, Math.round(box2.band * 0.035));
    let x = 0;
    while (x < box2.w) {
      const bw = box2.w * (0.03 + rand() * 0.06);
      const bh = box2.band * tall * (0.3 + rand() * 0.7);
      const right = Math.min(box2.w, x + bw);
      const top2 = box2.band - bh;
      ctx.fillStyle = css(colour, 1);
      ctx.fillRect(x, top2, right - x, box2.h - top2);
      if (rand() < 0.2) {
        ctx.fillRect(x + (right - x) / 2 - 1, top2 - box2.band * 0.08, 2, box2.band * 0.08);
      }
      if (window2 && window2.alpha > 0) {
        ctx.fillStyle = css(window2.tone, window2.alpha);
        const cols = Math.floor((right - x - cell) / (cell * 2));
        const rows = Math.floor((bh - cell) / (cell * 2));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (rand() < window2.share) {
              ctx.fillRect(x + cell + c * cell * 2, top2 + cell + r * cell * 2, cell, cell);
            }
          }
        }
      }
      x = right + gap;
    }
    ctx.fillStyle = css(colour, 1);
    ctx.fillRect(0, box2.band * 0.95, box2.w, Math.max(0, box2.h - box2.band * 0.95));
  }
  function city(ctx, box2, layer, pal, rand) {
    skyline(ctx, box2, pal.back, 0.95, null, rand);
    skyline(ctx, box2, pal.tone, 0.72, layer.windows === false ? null : pal.window, rand);
  }
  function sea(ctx, box2, _layer, pal, rand) {
    const k = 2 + Math.floor(rand() * 3);
    const phase = rand() * TAU;
    const grad = ctx.createLinearGradient(0, 0, 0, box2.band);
    grad.addColorStop(0, css(pal.lit, 1));
    grad.addColorStop(1, css(pal.tone, 1));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, box2.h);
    for (let x = 0; x <= box2.w; x += 4) {
      const t = x / box2.w * TAU;
      ctx.lineTo(x, box2.band * 0.05 * (1 + Math.sin(k * t + phase)));
    }
    ctx.lineTo(box2.w, box2.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = css(pal.tone, 1);
    ctx.fillRect(0, box2.band, box2.w, Math.max(0, box2.h - box2.band));
    const rows = 5;
    ctx.lineCap = "round";
    for (let r = 0; r < rows; r++) {
      const y = box2.band * (0.2 + r / rows * 0.72);
      const len = box2.w / (16 - r * 2);
      ctx.strokeStyle = css(pal.lit, 0.6 - r * 0.08);
      ctx.lineWidth = 1 + r * 0.5;
      for (let x = rand() * len; x < box2.w; x += len * (1.4 + rand() * 0.9)) {
        wrapped(box2.w, x, function(at) {
          ctx.beginPath();
          ctx.moveTo(at, y);
          ctx.quadraticCurveTo(at + len * 0.3, y - len * 0.08, at + len * 0.6, y);
          ctx.stroke();
        });
      }
    }
  }
  function fog(ctx, box2, _layer, pal, rand) {
    const grad = ctx.createLinearGradient(0, 0, 0, box2.band);
    grad.addColorStop(0, css(pal.tone, 0));
    grad.addColorStop(0.7, css(pal.tone, 0.55));
    grad.addColorStop(1, css(pal.tone, 0.7));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, box2.w, box2.band);
    ctx.fillStyle = css(pal.tone, 0.7);
    ctx.fillRect(0, box2.band, box2.w, Math.max(0, box2.h - box2.band));
    const n = Math.max(2, Math.round(box2.w / 220));
    ctx.fillStyle = css(pal.lit, 0.18);
    for (let i = 0; i < n; i++) {
      const cx = rand() * box2.w;
      const cy = box2.band * (0.4 + rand() * 0.5);
      const rx = box2.w * (0.08 + rand() * 0.12);
      const ry = box2.band * (0.12 + rand() * 0.15);
      wrapped(box2.w, cx, function(at) {
        ctx.beginPath();
        ctx.ellipse(at, cy, rx, ry, 0, 0, TAU);
        ctx.fill();
      });
    }
  }
  function ground(ctx, box2, _layer, pal, rand) {
    ctx.fillStyle = css(pal.tone, 1);
    ctx.fillRect(0, 0, box2.w, box2.h);
    ctx.fillStyle = css(pal.lit, 1);
    ctx.fillRect(0, 0, box2.w, Math.max(2, box2.band * 0.06));
    const n = Math.max(4, Math.round(box2.w / 40));
    ctx.fillStyle = css(pal.dim, 0.7);
    for (let i = 0; i < n; i++) {
      const x = rand() * box2.w;
      const y = box2.band * (0.15 + rand() * 0.75);
      const s = 2 + rand() * 3;
      ctx.fillRect(x, y, s * 1.6, s * 0.7);
    }
  }
  var PAINTERS = { sky, stars, clouds, mountains, hills, forest, city, sea, fog, ground };
  function paint(kind, ctx, box2, layer, pal, rand) {
    const painter = PAINTERS[kind];
    if (!painter) return false;
    painter(ctx, box2, layer, pal, rand);
    return true;
  }

  // src/static/sdk-libs/phaser/parallax.js
  var BASE_DEPTH = -100;
  var MAX_PERIOD = 2048;
  var DRAW_WIDTH = 1536;
  var TIMES = { day: true, dusk: true, night: true };
  var SEA_BOB = 3;
  var nextId = 1;
  var HILLS = [
    { kind: "sky" },
    { kind: "stars" },
    { kind: "clouds" },
    { kind: "mountains" },
    { kind: "hills", name: "hills-far", scroll: 0.28, height: 0.4, haze: 0.45 },
    { kind: "hills", scroll: 0.5, height: 0.28, haze: 0.18 },
    { kind: "ground" }
  ];
  var PRESETS2 = {
    hills: { layers: HILLS },
    night: { time: "night", layers: HILLS },
    city: {
      layers: [
        { kind: "sky" },
        { kind: "stars" },
        { kind: "clouds", alpha: 0.6, height: 0.4 },
        { kind: "city", name: "city-far", scroll: 0.15, height: 0.62, haze: 0.55, windows: false },
        { kind: "city", scroll: 0.35, height: 0.44, tone: "ink", haze: 0.22 },
        { kind: "fog", alpha: 0.4 },
        { kind: "ground", tone: "ink" }
      ]
    },
    sea: {
      layers: [
        { kind: "sky" },
        { kind: "stars" },
        { kind: "clouds" },
        { kind: "mountains", scroll: 0.15, height: 0.34, haze: 0.6 },
        { kind: "sea", name: "sea-far", scroll: 0.3, height: 0.3, haze: 0.35, drift: 8 },
        { kind: "sea", scroll: 0.5, height: 0.2, haze: 0.08, drift: 18 },
        { kind: "ground", name: "shore", tone: "warn", height: 0.09 }
      ]
    },
    forest: {
      layers: [
        { kind: "sky" },
        { kind: "stars" },
        { kind: "clouds" },
        { kind: "mountains" },
        { kind: "hills", scroll: 0.3, height: 0.42, haze: 0.45 },
        { kind: "forest", name: "forest-far", scroll: 0.42, height: 0.38, haze: 0.38 },
        { kind: "forest", scroll: 0.65, height: 0.3, haze: 0.1 },
        { kind: "fog", scroll: 0.72, alpha: 0.35 },
        { kind: "ground" }
      ]
    },
    desert: {
      layers: [
        { kind: "sky", tone: "warn" },
        { kind: "stars" },
        { kind: "mountains", tone: "warn", haze: 0.5, jag: 0.8 },
        { kind: "hills", name: "dunes-far", tone: "warn", scroll: 0.35, height: 0.32, haze: 0.35 },
        { kind: "hills", name: "dunes", tone: "warn", scroll: 0.55, height: 0.22, haze: 0.1 },
        { kind: "ground", tone: "warn" }
      ]
    },
    cave: {
      layers: [
        { kind: "sky", top: "dark", bottom: "inkDim", disc: false },
        { kind: "mountains", name: "ceiling", tone: "dark", flip: true, scroll: 0.2, height: 0.38, haze: 0.35 },
        { kind: "mountains", name: "rocks-far", tone: "dark", scroll: 0.25, height: 0.42, haze: 0.5 },
        { kind: "hills", name: "rubble", tone: "dark", scroll: 0.5, height: 0.24, haze: 0.18 },
        { kind: "fog", tone: "inkDim", alpha: 0.3 },
        { kind: "ground", tone: "dark" }
      ]
    }
  };
  var PARALLAX_PRESETS = Object.keys(PRESETS2);
  function seedOf(base, name, own) {
    if (typeof own === "number" && isFinite(own)) return own;
    let h = Math.floor(base) >>> 0 ^ 2166136261;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
    return h;
  }
  function normaliseLayer(raw, index, names, depthBase) {
    const d = raw && KIND_DEFAULTS[raw.kind];
    if (!d) {
      console.warn('[aimeat-phaser] parallax: a layer of kind "' + (raw && raw.kind) + '" is not one of ' + Object.keys(KIND_DEFAULTS).join(", ") + " and was left out.");
      return null;
    }
    let name = raw.name || raw.kind;
    if (names[name]) {
      let n = 2;
      while (names[name + "-" + n]) n += 1;
      name = name + "-" + n;
    }
    names[name] = true;
    const scroll = typeof raw.scroll === "number" ? { x: raw.scroll, y: 0 } : Object.assign({ x: d.scroll, y: 0 }, raw.scroll || {});
    return Object.assign({}, raw, {
      name,
      kind: raw.kind,
      scroll,
      height: typeof raw.height === "number" ? raw.height : d.height,
      tone: raw.tone != null ? raw.tone : d.tone,
      alpha: typeof raw.alpha === "number" ? raw.alpha : d.alpha,
      drift: typeof raw.drift === "number" ? raw.drift : d.drift,
      haze: typeof raw.haze === "number" ? raw.haze : d.haze,
      depth: typeof raw.depth === "number" ? raw.depth : depthBase + index
    });
  }
  function normalise(spec) {
    const s = (
      /** @type {any} */
      typeof spec === "string" ? { preset: spec } : spec || {}
    );
    let preset = null;
    if (s.preset) {
      preset = PRESETS2[s.preset] || null;
      if (!preset) {
        console.warn('[aimeat-phaser] parallax: no preset is named "' + s.preset + '". The presets are ' + PARALLAX_PRESETS.join(", ") + "; hills is used.");
      }
    }
    if (!preset && !Array.isArray(s.layers)) preset = PRESETS2.hills;
    const source = Array.isArray(s.layers) ? s.layers : preset.layers;
    const depthBase = typeof s.depth === "number" ? s.depth : BASE_DEPTH;
    const names = {};
    const layers = [];
    for (let i = 0; i < source.length; i++) {
      const layer = normaliseLayer(source[i], layers.length, names, depthBase);
      if (layer) layers.push(layer);
    }
    return {
      time: TIMES[s.time] ? s.time : preset && preset.time || "day",
      layers,
      seed: typeof s.seed === "number" ? s.seed : 1,
      drift: typeof s.drift === "number" ? s.drift : 1,
      twinkle: s.twinkle !== false,
      auto: s.auto !== false,
      depth: depthBase,
      width: typeof s.width === "number" ? s.width : void 0,
      height: typeof s.height === "number" ? s.height : void 0,
      theme: s.theme
    };
  }
  function poles(th) {
    const bgIsLight = luminance(th.bg) >= luminance(th.ink);
    return { light: bgIsLight ? th.bg : th.ink, dark: bgIsLight ? th.ink : th.bg };
  }
  function tone3(th, p, want, fallback) {
    if (typeof want === "number" && isFinite(want)) return want;
    if (want === "light") return p.light;
    if (want === "dark") return p.dark;
    if (typeof want === "string" && typeof th[want] === "number") return th[want];
    return fallback;
  }
  function palette(th, p, time, skyLayer) {
    const lean = tone3(th, p, skyLayer ? skyLayer.tone : "ch1", th.ch1);
    const lit = shade2(th.warn, 0.4);
    let out;
    if (time === "night") {
      out = {
        top: mix(p.dark, lean, 0.06),
        bottom: mix(p.dark, lean, 0.2),
        tint: function(c) {
          return mix(c, p.dark, 0.62);
        },
        disc: "moon",
        starAlpha: 1,
        window: { tone: lit, alpha: 0.95, share: 0.6 }
      };
    } else if (time === "dusk") {
      const warm = mix(p.dark, th.warn, 0.3);
      out = {
        top: mix(mix(th.bg, p.dark, 0.45), lean, 0.2),
        bottom: mix(mix(th.bg, p.dark, 0.2), th.warn, 0.5),
        tint: function(c) {
          return mix(c, warm, 0.42);
        },
        disc: "sun",
        starAlpha: 0.5,
        window: { tone: lit, alpha: 0.8, share: 0.5 }
      };
    } else {
      out = {
        top: mix(th.bg, lean, 0.45),
        bottom: mix(th.bg, lean, 0.12),
        tint: function(c) {
          return c;
        },
        disc: "sun",
        starAlpha: 0,
        window: { tone: mix(p.light, lean, 0.2), alpha: 0.35, share: 0.45 }
      };
    }
    if (skyLayer && skyLayer.top != null) out.top = out.tint(tone3(th, p, skyLayer.top, out.top));
    if (skyLayer && skyLayer.bottom != null) out.bottom = out.tint(tone3(th, p, skyLayer.bottom, out.bottom));
    out.sun = time === "dusk" ? mix(th.ch3, th.warn, 0.5) : mix(th.ch3, p.light, 0.25);
    out.moon = mix(p.light, lean, 0.12);
    return out;
  }
  function coloursFor(th, p, pal, layer) {
    const base = tone3(th, p, layer.tone, th.inkDim);
    const tinted = layer.kind === "stars" ? base : pal.tint(base);
    const colour = mix(tinted, pal.bottom, layer.haze);
    return {
      tone: colour,
      lit: shade2(colour, 0.22),
      dim: shade2(colour, -0.25),
      back: mix(colour, pal.bottom, 0.45),
      skyTop: pal.top,
      skyBottom: pal.bottom,
      disc: pal.disc,
      sun: pal.sun,
      moon: pal.moon,
      window: pal.window
    };
  }
  function parallax(scene, spec) {
    const id = nextId++;
    let raw = (
      /** @type {any} */
      typeof spec === "string" ? { preset: spec } : Object.assign({}, spec || {})
    );
    let stack = normalise(raw);
    const th = stack.theme || look(scene);
    const auto = stack.auto;
    let override = stack.width && stack.height ? { w: stack.width, h: stack.height } : null;
    let built = [];
    let textures2 = [];
    let handles = [];
    let generation = 0;
    let gone = false;
    let driftT = 0;
    let last = null;
    function clock2() {
      if (scene.time && typeof scene.time.now === "number") return scene.time.now;
      return typeof performance !== "undefined" ? performance.now() : Date.now();
    }
    function viewport() {
      if (override) return override;
      const cam = scene.cameras && scene.cameras.main;
      const w = scene.scale && scene.scale.width || cam && cam.width || 960;
      const h = scene.scale && scene.scale.height || cam && cam.height || 540;
      return { w, h };
    }
    function teardown() {
      for (const L of built) {
        for (const sp of L.sprites) if (sp && typeof sp.destroy === "function") sp.destroy();
      }
      built = [];
      handles = [];
      for (const key of textures2) {
        if (scene.textures && scene.textures.exists(key)) scene.textures.remove(key);
      }
      textures2 = [];
    }
    function makeTexture(L, subset, box2, colours) {
      const key = "ak-parallax-" + id + "-" + generation + "-" + L.name + (subset > 0 ? "-b" : "");
      const tex = scene.textures.createCanvas(key, box2.w, box2.h);
      if (!tex) return null;
      const ctx = typeof tex.getContext === "function" ? tex.getContext() : tex.context;
      if (L.flip) {
        ctx.save();
        ctx.translate(0, box2.h);
        ctx.scale(1, -1);
      }
      paint(L.kind, ctx, box2, Object.assign({}, L, { subset }), colours, rng2(seedOf(stack.seed, L.name, L.seed)));
      if (L.flip) ctx.restore();
      if (typeof tex.refresh === "function") tex.refresh();
      textures2.push(key);
      return key;
    }
    function build2() {
      teardown();
      generation += 1;
      const view = viewport();
      const vw = Math.max(16, view.w);
      const vh = Math.max(16, view.h);
      const res = Math.min(1, DRAW_WIDTH / vw);
      const texW = Math.min(MAX_PERIOD, pot(Math.ceil(vw * res)));
      const p = poles(th);
      const skyLayer = stack.layers.filter(function(L) {
        return L.kind === "sky";
      })[0] || null;
      const pal = palette(th, p, stack.time, skyLayer);
      for (const L of stack.layers) {
        const isSky = L.kind === "sky";
        const bandD = isSky ? vh : Math.max(8, Math.round(vh * Math.max(0.02, Math.min(1, L.height))));
        const band = Math.max(4, Math.round(bandD * res));
        const texH = isSky ? pot(Math.ceil(vh * res)) : pot(band);
        const box2 = { w: texW, h: texH, band, viewW: Math.round(vw * res), viewH: Math.round(vh * res) };
        const colours = coloursFor(th, p, pal, L);
        const twinkle = L.kind === "stars" && stack.twinkle;
        const starFactor = L.kind === "stars" && !L.always ? pal.starAlpha : 1;
        const alpha = Math.max(0, Math.min(1, L.alpha * starFactor));
        const subsets = twinkle ? [0, 1] : [-1];
        const sprites = [];
        for (const subset of subsets) {
          const key = makeTexture(L, subset, box2, colours);
          if (!key) continue;
          const sprite = scene.add.tileSprite(0, 0, vw, texH / res, key);
          sprite.setOrigin(0, 0).setScrollFactor(0).setDepth(L.depth).setAlpha(alpha);
          if (alpha === 0) sprite.setVisible(false);
          if (res !== 1 && typeof sprite.setTileScale === "function") sprite.setTileScale(1 / res);
          sprites.push(sprite);
        }
        const texHD = texH / res;
        const record = {
          spec: L,
          sprites,
          anchorY: isSky ? 0 : L.flip ? bandD - texHD : vh - texHD,
          res,
          fx: L.scroll.x,
          fy: L.scroll.y,
          drift: L.drift,
          alpha,
          twinkle: twinkle && alpha > 0,
          bob: L.kind === "sea" ? typeof L.bob === "number" ? L.bob : SEA_BOB : 0,
          phase: rng2(seedOf(stack.seed, L.name + ":phase", void 0))() * Math.PI * 2
        };
        built.push(record);
        handles.push(layerHandle(record));
      }
      place();
    }
    function layerHandle(record) {
      const name = record.spec.name;
      return {
        name,
        kind: record.spec.kind,
        spec: record.spec,
        sprites: record.sprites,
        set(patch) {
          const layers = {};
          layers[name] = patch || {};
          api.set({ layers });
        },
        setAlpha(alpha) {
          record.alpha = Math.max(0, Math.min(1, alpha));
          for (const sp of record.sprites) sp.setAlpha(record.alpha).setVisible(record.alpha > 0);
        },
        setVisible(visible) {
          for (const sp of record.sprites) sp.setVisible(!!visible);
        }
      };
    }
    function place() {
      const now = clock2();
      const dt = last == null ? 0 : Math.max(0, (now - last) / 1e3);
      last = now;
      const still = reducedMotion();
      if (!still) driftT += dt * stack.drift;
      const cam = scene.cameras && scene.cameras.main;
      const sx = cam ? cam.scrollX || 0 : 0;
      const sy = cam ? cam.scrollY || 0 : 0;
      for (const L of built) {
        const tx = (sx * L.fx - driftT * L.drift) * L.res;
        let y = L.anchorY - sy * L.fy;
        if (L.bob && !still) y += Math.sin(driftT * 1.2 + L.phase) * L.bob;
        for (let i = 0; i < L.sprites.length; i++) {
          const sp = L.sprites[i];
          sp.tilePositionX = tx;
          sp.y = y;
          if (L.twinkle) {
            sp.alpha = still ? L.alpha : L.alpha * (0.6 + 0.4 * Math.sin(driftT * 2.2 + L.phase + i * Math.PI));
          }
        }
      }
    }
    function tick() {
      if (gone) return;
      place();
    }
    function onResize() {
      if (gone) return;
      override = null;
      build2();
    }
    const api = {
      get layers() {
        return handles.slice();
      },
      layer(name) {
        for (const h of handles) if (h.name === name) return h;
        return null;
      },
      set(patch) {
        if (gone) return;
        const q = (
          /** @type {any} */
          patch || {}
        );
        const next = Object.assign({}, raw);
        for (const key in q) if (key !== "layers") next[key] = q[key];
        if (Array.isArray(q.layers)) {
          next.layers = q.layers;
        } else if (q.preset && q.preset !== raw.preset) {
          delete next.layers;
        }
        if (q.layers && typeof q.layers === "object" && !Array.isArray(q.layers)) {
          const merged = [];
          for (const L of normalise(next).layers) {
            const change = q.layers[L.name];
            if (change === false) continue;
            merged.push(change && typeof change === "object" ? Object.assign({}, L, change) : L);
          }
          next.layers = merged;
        }
        raw = next;
        stack = normalise(raw);
        build2();
      },
      update() {
        tick();
      },
      resize(w, h) {
        if (gone) return;
        override = typeof w === "number" && typeof h === "number" && w > 0 && h > 0 ? { w, h } : null;
        build2();
      },
      destroy() {
        if (gone) return;
        gone = true;
        if (scene.events && typeof scene.events.off === "function") {
          scene.events.off("postupdate", tick);
          scene.events.off("shutdown", api.destroy);
        }
        if (auto && scene.scale && typeof scene.scale.off === "function") scene.scale.off("resize", onResize);
        teardown();
      }
    };
    build2();
    if (auto && scene.events && typeof scene.events.on === "function") scene.events.on("postupdate", tick);
    if (auto && scene.scale && typeof scene.scale.on === "function") scene.scale.on("resize", onResize);
    if (scene.events && typeof scene.events.once === "function") scene.events.once("shutdown", api.destroy);
    return api;
  }

  // src/static/sdk-libs/phaser/daynight.js
  var AMBIENT_DEPTH = 790;
  var LIGHT_DEPTH = 791;
  var NIGHT_ALPHA = 0.45;
  var WARM_ALPHA = 0.18;
  var FLASH_ALPHA = 0.55;
  var FLASH_STEPS = [{ ms: 80, lit: true }, { ms: 40, lit: false }, { ms: 50, lit: true }];
  var STILL_FLASH_ALPHA = 0.25;
  var STILL_FLASH_STEPS = [{ ms: 120, lit: true }];
  var FLASH_GAP_MIN = 6e3;
  var FLASH_GAP_MAX = 14e3;
  var DEFAULT_HOUR = 12;
  var DEFAULT_SPEED = 0.05;
  var DEFAULT_PHASES = { dawn: 5, day: 7, dusk: 17, night: 20 };
  var PHASE_TIME = { dawn: "dusk", day: "day", dusk: "dusk", night: "night" };
  var WEATHER_LAYERS = {
    clear: null,
    rain: { kind: "rain" },
    snow: { kind: "snow" },
    fog: { kind: "fog" },
    storm: { kind: "rain", density: 1.6, wind: 140 }
  };
  var FOG_AT_DAWN = 0.5;
  var RAIN_IN_EVENING = 0.45;
  var STORM_SHARE = 0.35;
  var SHOWER_BY_DAY = 0.12;
  var LIGHT_TEXTURE = 128;
  var LIGHT_RADIUS = 80;
  var LIGHT_ALPHA = 0.9;
  var SUN_ARC = 0.85;
  var HOUR_EVENTS_CAP = 48;
  var DAYNIGHT_PHASES = ["dawn", "day", "dusk", "night"];
  var DAYNIGHT_WEATHERS = ["clear", "rain", "snow", "fog", "storm", "auto"];
  var nextId2 = 1;
  function tone4(th, p, want, fallback) {
    if (typeof want === "number" && isFinite(want)) return want;
    if (want === "light") return p.light;
    if (want === "dark") return p.dark;
    if (typeof want === "string" && typeof th[want] === "number") return th[want];
    return fallback;
  }
  function poles2(th) {
    const bgIsLight = luminance(th.bg) >= luminance(th.ink);
    return { light: bgIsLight ? th.bg : th.ink, dark: bgIsLight ? th.ink : th.bg };
  }
  function wrap(h) {
    return (h % 24 + 24) % 24;
  }
  function smooth(t) {
    const k = Math.max(0, Math.min(1, t));
    return k * k * (3 - 2 * k);
  }
  function normalisePhases(raw) {
    const out = Object.assign({}, DEFAULT_PHASES);
    const q = raw && typeof raw === "object" ? raw : {};
    for (const name of DAYNIGHT_PHASES) {
      if (typeof q[name] === "number" && isFinite(q[name])) out[name] = q[name];
    }
    const ok = out.dawn >= 0 && out.dawn < out.day && out.day < out.dusk && out.dusk < out.night && out.night < 24;
    if (ok) return out;
    console.warn("[aimeat-phaser] dayNight: phases want dawn < day < dusk < night, each an hour in 0..24; the defaults (5, 7, 17, 20) are used.");
    return Object.assign({}, DEFAULT_PHASES);
  }
  function phaseOf(ph, h) {
    if (h >= ph.night || h < ph.dawn) return "night";
    if (h < ph.day) return "dawn";
    if (h < ph.dusk) return "day";
    return "dusk";
  }
  function keyframes(ph, dark, warm, alphas) {
    return [
      { at: ph.dawn, colour: dark, alpha: alphas.night },
      { at: (ph.dawn + ph.day) / 2, colour: warm, alpha: alphas.warm },
      { at: ph.day, colour: warm, alpha: 0 },
      { at: ph.dusk, colour: warm, alpha: 0 },
      { at: (ph.dusk + ph.night) / 2, colour: warm, alpha: alphas.warm },
      { at: ph.night, colour: dark, alpha: alphas.night }
    ];
  }
  function ambientAt(keys, h) {
    const last = keys[keys.length - 1];
    if (h < keys[0].at || h >= last.at) return { colour: last.colour, alpha: last.alpha };
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i];
      const b = keys[i + 1];
      if (h >= a.at && h < b.at) {
        const t = smooth((h - a.at) / (b.at - a.at));
        return { colour: mix(a.colour, b.colour, t), alpha: a.alpha + (b.alpha - a.alpha) * t };
      }
    }
    return { colour: last.colour, alpha: last.alpha };
  }
  function ambientStill(phase, dark, warm, alphas) {
    if (phase === "night") return { colour: dark, alpha: alphas.night };
    if (phase === "day") return { colour: warm, alpha: 0 };
    return { colour: warm, alpha: alphas.warm };
  }
  function forecast(seed, day, phase, hour, ph) {
    const roll2 = rng2(Math.floor(seed) * 1000003 + day * 7919 + 1 >>> 0);
    const fog2 = roll2();
    const rain = roll2();
    const storm = roll2();
    const shower = roll2();
    if (phase === "dawn") return fog2 < FOG_AT_DAWN ? "fog" : "clear";
    const evening = phase === "dusk" || phase === "night" && hour >= ph.night;
    if (evening) {
      if (rain < RAIN_IN_EVENING) return storm < STORM_SHARE ? "storm" : "rain";
      return "clear";
    }
    if (phase === "day") return shower < SHOWER_BY_DAY ? "rain" : "clear";
    return "clear";
  }
  function dayNight(scene, spec) {
    const id = nextId2++;
    const s = (
      /** @type {any} */
      spec || {}
    );
    const th = s.theme || look(scene);
    const p = poles2(th);
    const auto = s.auto !== false;
    const depth = typeof s.depth === "number" ? s.depth : AMBIENT_DEPTH;
    const alphas = {
      night: s.ambient && typeof s.ambient.night === "number" ? s.ambient.night : NIGHT_ALPHA,
      warm: s.ambient && typeof s.ambient.warm === "number" ? s.ambient.warm : WARM_ALPHA
    };
    let phases = normalisePhases(s.phases);
    let keys = keyframes(phases, p.dark, th.warn, alphas);
    let hour = wrap(typeof s.hour === "number" && isFinite(s.hour) ? s.hour : DEFAULT_HOUR);
    let speed = typeof s.speed === "number" && isFinite(s.speed) ? Math.max(0, s.speed) : DEFAULT_SPEED;
    let seed = typeof s.seed === "number" && isFinite(s.seed) ? s.seed : 1;
    let lightning = s.lightning !== false;
    let day = 0;
    let phase = phaseOf(phases, hour);
    let paused = false;
    let gone = false;
    let weatherMode = typeof s.weather === "string" ? s.weather : "clear";
    let weatherNow = "clear";
    let layer = null;
    let warnedNoFx = false;
    let flashIn = -1;
    let flashSteps = [];
    let flashLeft = 0;
    let flashLit = false;
    let flashRoll = rng2((seed ^ 1540483477) >>> 0);
    const listeners = { phase: [], hour: [], day: [], weather: [], lightning: [] };
    let timeWord = null;
    let px = s.parallax || null;
    let fxh = s.fx || null;
    const made2 = { parallax: false, fx: false };
    if (s.create) {
      if (!px) {
        timeWord = PHASE_TIME[phase];
        px = parallax(scene, { preset: s.preset || "hills", time: timeWord, seed, theme: th });
        made2.parallax = true;
      }
      if (!fxh) {
        fxh = fx(scene, { theme: th });
        made2.fx = true;
      }
    }
    let rect = null;
    let lamps = [];
    const textures2 = [];
    let lastColour = -1;
    let lastAlpha = -1;
    function viewport() {
      const cam = scene.cameras && scene.cameras.main;
      const w = scene.scale && scene.scale.width || cam && cam.width || 960;
      const h = scene.scale && scene.scale.height || cam && cam.height || 540;
      return { w, h };
    }
    function addBlend() {
      const P = typeof window !== "undefined" ? (
        /** @type {any} */
        window.Phaser
      ) : void 0;
      return P && P.BlendModes && typeof P.BlendModes.ADD === "number" ? P.BlendModes.ADD : 1;
    }
    function emit(name, a, b) {
      for (const fn of listeners[name].slice()) fn(a, b);
    }
    function applyTime() {
      const word2 = PHASE_TIME[phase];
      if (word2 === timeWord) return;
      timeWord = word2;
      if (px && typeof px.set === "function") px.set({ time: word2 });
    }
    function scheduleFlash() {
      flashIn = lightning ? FLASH_GAP_MIN + flashRoll() * (FLASH_GAP_MAX - FLASH_GAP_MIN) : -1;
    }
    function endStorm() {
      flashIn = -1;
      flashSteps = [];
      flashLit = false;
    }
    function applyWeather(word2) {
      if (!Object.prototype.hasOwnProperty.call(WEATHER_LAYERS, word2)) {
        console.warn('[aimeat-phaser] dayNight: no weather is named "' + word2 + '". The words are ' + DAYNIGHT_WEATHERS.join(", ") + "; clear is used.");
        word2 = "clear";
      }
      if (word2 === weatherNow) return;
      const previous = weatherNow;
      weatherNow = word2;
      if (layer) {
        layer.stop();
        layer = null;
      }
      const recipe = WEATHER_LAYERS[word2];
      if (recipe && fxh && typeof fxh.weather === "function") {
        const opts = {};
        if (typeof recipe.density === "number") opts.density = recipe.density;
        if (typeof recipe.wind === "number") opts.wind = recipe.wind;
        layer = fxh.weather(recipe.kind, opts) || null;
      } else if (recipe && !fxh && !warnedNoFx) {
        warnedNoFx = true;
        console.warn('[aimeat-phaser] dayNight: weather "' + word2 + '" was asked for with no fx handle (pass fx, or create: true), so the schedule runs and nothing falls.');
      }
      if (word2 === "storm") scheduleFlash();
      else endStorm();
      emit("weather", word2, previous);
    }
    function wantedWeather() {
      return weatherMode === "auto" ? forecast(seed, day, phase, hour, phases) : weatherMode;
    }
    function stormStep(dt, still) {
      if (flashSteps.length) {
        flashLeft -= dt;
        if (flashLeft > 0) return;
        flashSteps.shift();
        if (flashSteps.length) {
          flashLeft = flashSteps[0].ms;
          flashLit = flashSteps[0].lit;
        } else {
          flashLit = false;
          if (weatherNow === "storm") scheduleFlash();
        }
        return;
      }
      if (flashIn < 0) return;
      flashIn -= dt;
      if (flashIn > 0) return;
      flashIn = -1;
      const steps = still ? STILL_FLASH_STEPS : FLASH_STEPS;
      flashSteps = steps.map(function(step2) {
        return { ms: step2.ms, lit: step2.lit };
      });
      flashLeft = flashSteps[0].ms;
      flashLit = true;
      emit("lightning", still ? 1 : 2);
    }
    function advance(next, jump) {
      const before = hour;
      const wholeBefore = Math.floor(before);
      let hourChanged = false;
      if (jump) {
        hour = wrap(next);
        if (Math.floor(hour) !== wholeBefore) {
          hourChanged = true;
          emit("hour", Math.floor(hour));
        }
      } else {
        let raw = next;
        const crossed = Math.min(HOUR_EVENTS_CAP, Math.floor(raw) - wholeBefore);
        while (raw >= 24) {
          raw -= 24;
          day += 1;
          emit("day", day);
        }
        hour = raw;
        for (let k = 1; k <= crossed; k++) {
          hourChanged = true;
          emit("hour", (wholeBefore + k) % 24);
        }
      }
      const ph = phaseOf(phases, hour);
      const phaseChanged = ph !== phase;
      if (phaseChanged) {
        phase = ph;
        applyTime();
        emit("phase", ph, hour);
      }
      if (weatherMode === "auto" && (hourChanged || phaseChanged)) applyWeather(wantedWeather());
    }
    function buildAmbient() {
      if (!scene.add || typeof scene.add.rectangle !== "function") return;
      const view = viewport();
      rect = scene.add.rectangle(0, 0, view.w, view.h, p.dark, 0);
      rect.setOrigin(0, 0).setScrollFactor(0).setDepth(depth).setVisible(false);
    }
    function lightTexture(colour) {
      if (!scene.textures || typeof scene.textures.createCanvas !== "function") return null;
      const key = "ak-daynight-" + id + "-light-" + (colour >>> 0 & 16777215).toString(16);
      if (scene.textures.exists(key)) return key;
      const tex = scene.textures.createCanvas(key, LIGHT_TEXTURE, LIGHT_TEXTURE);
      if (!tex) return null;
      const ctx = typeof tex.getContext === "function" ? tex.getContext() : tex.context;
      const half = LIGHT_TEXTURE / 2;
      const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
      grad.addColorStop(0, css(colour, 1));
      grad.addColorStop(0.35, css(colour, 0.55));
      grad.addColorStop(1, css(colour, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, LIGHT_TEXTURE, LIGHT_TEXTURE);
      if (typeof tex.refresh === "function") tex.refresh();
      textures2.push(key);
      return key;
    }
    function clearLights() {
      for (const L of lamps) if (L.image && typeof L.image.destroy === "function") L.image.destroy();
      lamps = [];
    }
    function buildLights(list) {
      clearLights();
      if (!Array.isArray(list) || !scene.add || typeof scene.add.image !== "function") return;
      for (const raw of list) {
        if (!raw || typeof raw.x !== "number" || typeof raw.y !== "number") continue;
        const key = lightTexture(tone4(th, p, raw.tone, th.warn));
        if (!key) continue;
        const radius = typeof raw.radius === "number" && raw.radius > 0 ? raw.radius : LIGHT_RADIUS;
        const image = scene.add.image(raw.x, raw.y, key);
        image.setOrigin(0.5, 0.5).setDepth(depth + (LIGHT_DEPTH - AMBIENT_DEPTH)).setDisplaySize(radius * 2, radius * 2).setAlpha(0).setVisible(false);
        if (typeof image.setBlendMode === "function") image.setBlendMode(addBlend());
        if (typeof raw.scrollFactor === "number") image.setScrollFactor(raw.scrollFactor);
        lamps.push({ image, alpha: typeof raw.alpha === "number" ? Math.max(0, Math.min(1, raw.alpha)) : LIGHT_ALPHA });
      }
    }
    function paint2(still) {
      const a = still ? ambientStill(phase, p.dark, th.warn, alphas) : ambientAt(keys, hour);
      let colour = a.colour;
      let alpha = a.alpha;
      if (flashLit) {
        colour = p.light;
        alpha = Math.max(alpha, still ? STILL_FLASH_ALPHA : FLASH_ALPHA);
      }
      if (rect && (colour !== lastColour || alpha !== lastAlpha)) {
        lastColour = colour;
        lastAlpha = alpha;
        rect.setFillStyle(colour, alpha);
        rect.setVisible(alpha > 0);
      }
      const dark = alphas.night > 0 ? Math.min(1, a.alpha / alphas.night) : 0;
      for (const L of lamps) {
        L.image.setAlpha(dark * L.alpha);
        L.image.setVisible(dark > 1e-3);
      }
    }
    function step(deltaMs) {
      if (gone) return;
      const dt = typeof deltaMs === "number" && isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
      const still = reducedMotion();
      if (!paused) {
        if (speed > 0 && dt > 0) advance(hour + speed * dt / 1e3, false);
        stormStep(dt, still);
      }
      paint2(still);
    }
    function onUpdate(_time, delta) {
      step(delta);
    }
    function onResize() {
      if (gone || !rect) return;
      const view = viewport();
      if (typeof rect.setSize === "function") rect.setSize(view.w, view.h);
      if (typeof rect.setPosition === "function") rect.setPosition(0, 0);
    }
    const api = {
      hour() {
        return hour;
      },
      phase() {
        return phase;
      },
      day() {
        return day;
      },
      weather() {
        return weatherNow;
      },
      parallax: px,
      fx: fxh,
      get ambient() {
        return rect;
      },
      set(patch) {
        if (gone) return;
        const q = (
          /** @type {any} */
          patch || {}
        );
        if (typeof q.speed === "number" && isFinite(q.speed)) speed = Math.max(0, q.speed);
        if (typeof q.lightning === "boolean") {
          lightning = q.lightning;
          if (weatherNow === "storm") {
            if (!lightning) endStorm();
            else if (flashIn < 0 && !flashSteps.length) scheduleFlash();
          }
        }
        if (typeof q.seed === "number" && isFinite(q.seed)) {
          seed = q.seed;
          flashRoll = rng2((seed ^ 1540483477) >>> 0);
        }
        if (q.phases) {
          phases = normalisePhases(q.phases);
          keys = keyframes(phases, p.dark, th.warn, alphas);
        }
        if (q.lights !== void 0) buildLights(q.lights);
        if (typeof q.hour === "number" && isFinite(q.hour)) {
          advance(q.hour, true);
        } else if (q.phases) {
          advance(hour, true);
        }
        if (typeof q.weather === "string") weatherMode = q.weather;
        if (typeof q.weather === "string" || typeof q.seed === "number") applyWeather(wantedWeather());
        paint2(reducedMotion());
      },
      pause() {
        paused = true;
      },
      resume() {
        paused = false;
      },
      on(event, fn) {
        const bucket = listeners[event];
        if (!bucket) {
          console.warn('[aimeat-phaser] dayNight: no event is named "' + event + '". The events are ' + Object.keys(listeners).join(", ") + ".");
          return function() {
          };
        }
        if (typeof fn !== "function") return function() {
        };
        bucket.push(fn);
        return function() {
          const at = bucket.indexOf(fn);
          if (at >= 0) bucket.splice(at, 1);
        };
      },
      update(delta) {
        step(typeof delta === "number" ? delta : 0);
      },
      sunPosition() {
        const rise = phases.dawn;
        const set = phases.night;
        const daySpan = set - rise;
        const t = (hour - rise) / daySpan;
        if (t >= 0 && t <= 1) {
          const e2 = Math.sin(t * Math.PI);
          return { x: t, y: 1 - e2 * SUN_ARC, elevation: e2, up: true };
        }
        const u = wrap(hour - set) / (24 - daySpan);
        const e = Math.sin(u * Math.PI);
        return { x: u, y: 1 + e * SUN_ARC, elevation: 0 - e, up: false };
      },
      destroy() {
        if (gone) return;
        gone = true;
        if (scene.events && typeof scene.events.off === "function") {
          scene.events.off("update", onUpdate);
          scene.events.off("shutdown", api.destroy);
        }
        if (auto && scene.scale && typeof scene.scale.off === "function") scene.scale.off("resize", onResize);
        for (const name in listeners) listeners[name].length = 0;
        endStorm();
        if (layer) {
          layer.stop();
          layer = null;
        }
        clearLights();
        for (const key of textures2) {
          if (scene.textures && scene.textures.exists(key)) scene.textures.remove(key);
        }
        textures2.length = 0;
        if (rect && typeof rect.destroy === "function") rect.destroy();
        rect = null;
        if (made2.parallax && px && typeof px.destroy === "function") px.destroy();
        if (made2.fx && fxh && typeof fxh.destroy === "function") fxh.destroy();
      }
    };
    buildAmbient();
    buildLights(s.lights);
    applyTime();
    applyWeather(wantedWeather());
    paint2(reducedMotion());
    if (auto && scene.events && typeof scene.events.on === "function") scene.events.on("update", onUpdate);
    if (auto && scene.scale && typeof scene.scale.on === "function") scene.scale.on("resize", onResize);
    if (scene.events && typeof scene.events.once === "function") scene.events.once("shutdown", api.destroy);
    return api;
  }

  // src/static/sdk-libs/phaser/sprites-draw.js
  function tint(colour, amount) {
    const to = amount < 0 ? 0 : 255;
    const k = Math.min(1, Math.abs(amount));
    const channel = function(shift) {
      const c = colour >> shift & 255;
      return Math.round(c + (to - c) * k) << shift;
    };
    return channel(16) | channel(8) | channel(0);
  }
  var KINDS2 = {
    hero: { width: 32, height: 40, body: "accent", visor: "ink", trim: -0.34 },
    topdown: { width: 32, height: 32, body: "accent", visor: "ink", trim: -0.34 },
    slime: { width: 32, height: 24, body: "ok", visor: "ink", trim: 0.45 },
    bat: { width: 32, height: 24, body: "inkDim", visor: "err", trim: -0.3 },
    walker: { width: 28, height: 36, body: "warn", visor: "ink", trim: -0.34 },
    coin: { width: 20, height: 20, body: "ch3", visor: -0.4, trim: 0.5 },
    pickup: { width: 20, height: 20, body: "ch4", visor: -0.4, trim: 0.5 }
  };
  var CLIPS = {
    hero: [
      { name: "idle", count: 2, rate: 2, repeat: -1, still: true },
      { name: "walk", count: 6, rate: 10, repeat: -1, alias: "run", aliasRate: 14 },
      { name: "jump", count: 1 },
      { name: "fall", count: 1 },
      { name: "hit", count: 1 },
      { name: "die", count: 3, rate: 6, repeat: 0 }
    ],
    slime: [
      { name: "idle", count: 2, rate: 2, repeat: -1, still: true },
      { name: "walk", count: 4, rate: 6, repeat: -1 },
      { name: "hit", count: 1 },
      { name: "die", count: 2, rate: 6, repeat: 0 }
    ],
    bat: [
      { name: "idle", count: 2, rate: 4, repeat: -1, still: true },
      { name: "walk", count: 4, rate: 12, repeat: -1, alias: "fly" },
      { name: "hit", count: 1 },
      { name: "die", count: 2, rate: 6, repeat: 0 }
    ],
    walker: [
      { name: "idle", count: 2, rate: 2, repeat: -1, still: true },
      { name: "walk", count: 4, rate: 8, repeat: -1 },
      { name: "hit", count: 1 },
      { name: "die", count: 2, rate: 6, repeat: 0 }
    ],
    coin: [
      { name: "spin", count: 6, rate: 10, repeat: -1, still: true, alias: "idle" }
    ],
    pickup: [
      { name: "bob", count: 4, rate: 6, repeat: -1, still: true, alias: "idle" }
    ]
  };
  var DIRS4 = ["down", "left", "right", "up"];
  var DIRS8 = ["down", "downleft", "left", "upleft", "up", "upright", "right", "downright"];
  var DIR_VECTORS = {
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
    up: [0, -1],
    downleft: [-0.7, 0.7],
    upleft: [-0.7, -0.7],
    upright: [0.7, -0.7],
    downright: [0.7, 0.7]
  };
  var STEP4 = [1, 0, -1, 0];
  var BOB4 = [0, -1, 0, -1];
  var SWING6 = [1, 0.5, -0.4, -1, -0.5, 0.4];
  var BOB6 = [0, -1, 0, 0, -1, 0];
  var HOP = [[0.82, 1.14, 0], [1.1, 0.88, -0.08], [1, 0.94, -0.16], [0.9, 1.08, 0]];
  var FLAP = [-0.7, -0.1, 0.6, 0.1];
  var SPIN = [1, 0.72, 0.36, 0.12, 0.36, 0.72];
  function topdownClips(directions) {
    const dirs = directions === 8 ? DIRS8 : DIRS4;
    const out = [];
    for (const d of dirs) {
      out.push({ name: "idle-" + d, count: 1, alias: d === "down" ? "idle" : void 0 });
      out.push({ name: "walk-" + d, count: 4, rate: 8, repeat: -1, alias: d === "down" ? "walk" : void 0 });
    }
    return out;
  }
  function plan(kind, spec) {
    const k = KINDS2[kind] || KINDS2.hero;
    const clips = kind === "topdown" ? topdownClips(spec && spec.directions === 8 ? 8 : 4) : (CLIPS[kind] || CLIPS.hero).map(function(c) {
      return Object.assign({}, c);
    });
    return { width: k.width, height: k.height, clips };
  }
  function derive(rule, body, look2) {
    return typeof rule === "number" ? tint(body, rule) : look2[rule];
  }
  function palette2(kind, look2, asked) {
    const k = KINDS2[kind] || KINDS2.hero;
    const a = asked || {};
    const body = typeof a.body === "number" ? a.body : look2[k.body];
    return {
      body,
      visor: typeof a.visor === "number" ? a.visor : derive(k.visor, body, look2),
      trim: typeof a.trim === "number" ? a.trim : derive(k.trim, body, look2)
    };
  }
  function figure(g, left, top2, w, h, pal, pose) {
    const ground2 = top2 + h - 1;
    const lie = pose.lie;
    const bodyW = Math.round(w * (0.6 + 0.3 * lie));
    const bodyH = Math.max(3, Math.round(h * 0.5 * pose.squash * (1 - 0.72 * lie)));
    const legH = Math.round(h * 0.26 * (1 - lie));
    const bodyX = left + Math.round((w - bodyW) / 2) + Math.round(pose.lean * w * 0.06);
    const standY = top2 + Math.round(h * 0.16) + pose.bob;
    const bodyY = Math.round(standY + (ground2 - bodyH - standY) * lie);
    const radius = Math.round(Math.min(bodyW, bodyH) * 0.3);
    if (legH > 0) {
      const legW = Math.max(3, Math.round(w * 0.14));
      const legTop = bodyY + bodyH - 2;
      const legLeft = bodyX + Math.round(bodyW * 0.13);
      const legRight = bodyX + bodyW - Math.round(bodyW * 0.13) - legW;
      const reach = Math.max(2, Math.round(legH * 0.3));
      const leg = function(len) {
        return Math.max(1, Math.min(ground2, legTop + Math.round(len)) - legTop);
      };
      g.fillStyle(pal.trim, 1);
      if (pose.tuck) {
        g.fillRect(legLeft, legTop, legW, leg(legH - reach));
        g.fillRect(legRight, legTop, legW, leg(legH - reach / 2));
      } else if (pose.spread) {
        g.fillRect(legLeft - reach, legTop, legW, leg(legH));
        g.fillRect(legRight + reach, legTop, legW, leg(legH));
      } else {
        g.fillRect(legLeft, legTop, legW, leg(legH + pose.swing * reach));
        g.fillRect(legRight, legTop, legW, leg(legH - pose.swing * reach));
      }
    }
    g.fillStyle(pal.body, 1).fillRoundedRect(bodyX, bodyY, bodyW, bodyH, radius);
    const visorH = Math.max(2, Math.round(bodyH * 0.26));
    const visorW = Math.round(bodyW * (0.68 - 0.3 * lie));
    g.fillStyle(pal.visor, 1).fillRoundedRect(
      bodyX + Math.round(bodyW * 0.16) - Math.round(pose.lean * 2),
      bodyY + Math.round(bodyH * 0.18),
      visorW,
      visorH,
      Math.round(visorH / 2)
    );
    if (lie < 0.6) {
      const armW = Math.max(3, Math.round(bodyW * 0.22));
      const armH = Math.max(3, Math.round(bodyH * 0.26));
      const armY = bodyY + Math.round(bodyH * 0.5) - Math.round(pose.arm * bodyH * 0.3);
      g.fillStyle(pal.trim, 1).fillRect(bodyX - Math.round(armW / 2), armY, armW, armH);
    }
  }
  function drawHero2(g, clip, i, left, top2, w, h, pal) {
    const pose = { swing: 0, bob: 0, arm: 0, lean: 0, squash: 1, lie: 0, tuck: false, spread: false };
    if (clip === "idle") {
      pose.bob = i;
      pose.squash = i ? 0.96 : 1;
    } else if (clip === "walk") {
      pose.swing = SWING6[i];
      pose.bob = BOB6[i];
      pose.arm = -SWING6[i];
    } else if (clip === "jump") {
      pose.tuck = true;
      pose.arm = 1;
    } else if (clip === "fall") {
      pose.spread = true;
      pose.arm = 1.2;
    } else if (clip === "hit") {
      pose.lean = -1;
      pose.arm = 0.7;
      pose.squash = 0.94;
    } else if (clip === "die") {
      pose.lie = (i + 1) / 3;
    }
    figure(g, left, top2, w, h, pal, pose);
  }
  function drawTopdown(g, clip, i, left, top2, w, h, pal) {
    const dir = clip.slice(clip.indexOf("-") + 1);
    const v = DIR_VECTORS[dir] || DIR_VECTORS.down;
    const walking = clip.indexOf("walk") === 0;
    const step = walking ? STEP4[i] : 0;
    const bob = walking ? BOB4[i] : 0;
    const cx = left + w / 2;
    const cy = top2 + h / 2;
    const bodyW = w * 0.56;
    const bodyH = h * 0.56;
    const footW = Math.max(3, Math.round(w * 0.16));
    const footH = Math.max(3, Math.round(h * 0.16));
    const apart = w * 0.16;
    const stride = h * 0.12 * step;
    const px = -v[1];
    const py = v[0];
    g.fillStyle(pal.trim, 1);
    g.fillRect(
      Math.round(cx + px * apart + v[0] * stride - footW / 2),
      Math.round(cy + py * apart + v[1] * stride + bodyH * 0.32 - footH / 2),
      footW,
      footH
    );
    g.fillRect(
      Math.round(cx - px * apart - v[0] * stride - footW / 2),
      Math.round(cy - py * apart - v[1] * stride + bodyH * 0.32 - footH / 2),
      footW,
      footH
    );
    g.fillStyle(pal.body, 1).fillRoundedRect(
      Math.round(cx - bodyW / 2),
      Math.round(cy - bodyH / 2 + bob),
      Math.round(bodyW),
      Math.round(bodyH),
      Math.round(bodyW * 0.3)
    );
    if (v[1] < -0.5) {
      g.fillStyle(pal.trim, 1).fillRect(
        Math.round(cx - bodyW * 0.3),
        Math.round(cy - bodyH * 0.38 + bob),
        Math.round(bodyW * 0.6),
        Math.max(2, Math.round(bodyH * 0.14))
      );
      return;
    }
    const visorW = Math.round(bodyW * (Math.abs(v[0]) > 0.5 ? 0.34 : 0.56));
    const visorH = Math.max(2, Math.round(bodyH * 0.2));
    g.fillStyle(pal.visor, 1).fillRoundedRect(
      Math.round(cx + v[0] * bodyW * 0.22 - visorW / 2),
      Math.round(cy - bodyH * 0.22 + v[1] * bodyH * 0.1 + bob),
      visorW,
      visorH,
      Math.round(visorH / 2)
    );
  }
  function drawSlime(g, clip, i, left, top2, w, h, pal) {
    let sx = 1;
    let sy = 1;
    let lift = 0;
    let eyes = "open";
    if (clip === "idle") {
      sy = i ? 0.9 : 1;
      sx = i ? 1.06 : 1;
    } else if (clip === "walk") {
      sy = HOP[i][0];
      sx = HOP[i][1];
      lift = HOP[i][2];
    } else if (clip === "hit") {
      sy = 0.7;
      sx = 1.2;
      eyes = "shut";
    } else if (clip === "die") {
      sy = i ? 0.22 : 0.45;
      sx = i ? 1.15 : 1.3;
      eyes = i ? "none" : "shut";
    }
    const cx = left + w / 2;
    const bw = Math.min(w - 2, Math.round(w * 0.8 * sx));
    const bh = Math.max(2, Math.round(h * 0.8 * sy));
    const bottom = top2 + h - 1 + Math.round(lift * h);
    const x = Math.round(cx - bw / 2);
    const y = bottom - bh;
    const r = Math.round(Math.min(bw, bh) * 0.45);
    const rb = Math.round(Math.min(bw, bh) * 0.15);
    g.fillStyle(pal.body, 1).fillRoundedRect(x, y, bw, bh, { tl: r, tr: r, bl: rb, br: rb });
    if (bh > 6) {
      g.fillStyle(pal.trim, 1).fillEllipse(
        Math.round(cx - bw * 0.22),
        Math.round(y + bh * 0.3),
        Math.round(bw * 0.18),
        Math.round(bh * 0.2)
      );
    }
    if (eyes !== "none") {
      const ew = Math.max(2, Math.round(bw * 0.09));
      const eh = eyes === "shut" ? 1 : Math.max(2, Math.round(bh * 0.22));
      const ey = Math.round(y + bh * 0.42);
      g.fillStyle(pal.visor, 1);
      g.fillRect(Math.round(cx - bw * 0.2 - ew / 2), ey, ew, eh);
      g.fillRect(Math.round(cx + bw * 0.2 - ew / 2), ey, ew, eh);
    }
  }
  function drawBat(g, clip, i, left, top2, w, h, pal) {
    let wing = 0.3;
    let drop = 0;
    let flip = false;
    let eyes = true;
    if (clip === "idle") {
      wing = i ? 0.5 : 0.25;
    } else if (clip === "walk") {
      wing = FLAP[i];
    } else if (clip === "hit") {
      wing = 0.55;
      eyes = false;
    } else if (clip === "die") {
      wing = i ? 0.95 : 0.85;
      drop = i ? 0.12 : 0.06;
      flip = i === 1;
    }
    const cx = left + w / 2;
    const cy = top2 + h * 0.5 + drop * h;
    const bodyW = Math.round(w * 0.28);
    const bodyH = Math.round(h * 0.5);
    const span2 = w * 0.48;
    const tipY = Math.min(top2 + h - 1, Math.round(cy + wing * h * 0.4));
    g.fillStyle(pal.body, 1);
    g.fillTriangle(cx - bodyW * 0.4, cy - bodyH * 0.25, cx - bodyW * 0.4, cy + bodyH * 0.25, cx - span2, tipY);
    g.fillTriangle(cx + bodyW * 0.4, cy - bodyH * 0.25, cx + bodyW * 0.4, cy + bodyH * 0.25, cx + span2, tipY);
    g.fillEllipse(cx, cy, bodyW, bodyH);
    const earY = flip ? cy + bodyH * 0.5 : cy - bodyH * 0.5;
    const earTip = flip ? Math.min(top2 + h - 1, earY + h * 0.1) : earY - h * 0.14;
    g.fillStyle(pal.trim, 1);
    g.fillTriangle(cx - bodyW * 0.45, earY, cx - bodyW * 0.1, earY, cx - bodyW * 0.35, earTip);
    g.fillTriangle(cx + bodyW * 0.1, earY, cx + bodyW * 0.45, earY, cx + bodyW * 0.35, earTip);
    if (eyes) {
      const e = Math.max(2, Math.round(w * 0.06));
      g.fillStyle(pal.visor, 1);
      g.fillRect(Math.round(cx - bodyW * 0.25 - e / 2), Math.round(cy - bodyH * 0.12), e, e);
      g.fillRect(Math.round(cx + bodyW * 0.25 - e / 2), Math.round(cy - bodyH * 0.12), e, e);
    }
  }
  function drawWalker(g, clip, i, left, top2, w, h, pal) {
    let swing = 0;
    let bob = 0;
    let lean = 0;
    let lamp = true;
    let tilt = 0;
    let flat = false;
    if (clip === "idle") {
      bob = i;
      lamp = !i;
    } else if (clip === "walk") {
      swing = STEP4[i];
      bob = BOB4[i];
    } else if (clip === "hit") {
      lean = -1;
      lamp = false;
    } else if (clip === "die") {
      tilt = i ? 0 : 1;
      flat = i === 1;
      lamp = false;
    }
    const ground2 = top2 + h - 1;
    const bodyW = Math.round(w * (flat ? 0.9 : 0.64));
    const bodyH = Math.round(h * (flat ? 0.22 : 0.46));
    const legH = flat ? 0 : Math.round(h * 0.24);
    const bodyX = left + Math.round((w - bodyW) / 2) + Math.round(lean * w * 0.06) + Math.round(tilt * w * 0.08);
    const bodyY = flat ? ground2 - bodyH : top2 + Math.round(h * 0.24) + bob + Math.round(tilt * h * 0.1);
    if (legH > 0) {
      const legW = Math.max(3, Math.round(w * 0.16));
      const reach = Math.max(2, Math.round(legH * 0.3));
      const legTop = bodyY + bodyH - 1;
      const leg = function(len) {
        return Math.max(1, Math.min(ground2, legTop + Math.round(len)) - legTop);
      };
      g.fillStyle(pal.trim, 1);
      g.fillRect(bodyX + Math.round(bodyW * 0.12), legTop, legW, leg(legH + swing * reach));
      g.fillRect(bodyX + bodyW - Math.round(bodyW * 0.12) - legW, legTop, legW, leg(legH - swing * reach));
    }
    g.fillStyle(pal.body, 1).fillRect(bodyX, bodyY, bodyW, bodyH);
    g.fillStyle(pal.trim, 1).fillRect(bodyX, bodyY + bodyH - Math.max(2, Math.round(bodyH * 0.14)), bodyW, Math.max(2, Math.round(bodyH * 0.14)));
    const slitH = Math.max(2, Math.round(bodyH * (flat ? 0.3 : 0.2)));
    g.fillStyle(pal.visor, 1).fillRect(
      bodyX + Math.round(bodyW * 0.15),
      bodyY + Math.round(bodyH * 0.22),
      Math.round(bodyW * 0.7),
      slitH
    );
    if (!flat) {
      const ax = bodyX + Math.round(bodyW * 0.5);
      const antH = Math.round(h * 0.12);
      g.fillStyle(pal.trim, 1).fillRect(ax - 1, bodyY - antH, 2, antH);
      if (lamp) g.fillStyle(pal.visor, 1).fillRect(ax - 2, bodyY - antH - 3, 4, 4);
    }
  }
  function drawCoin(g, clip, i, left, top2, w, h, pal) {
    const share = SPIN[i] || 1;
    const cx = left + w / 2;
    const cy = top2 + h / 2;
    const r = Math.min(w, h) / 2 - 1;
    g.fillStyle(pal.visor, 1).fillEllipse(cx, cy, Math.max(2, 2 * r * share), 2 * r);
    g.fillStyle(pal.body, 1).fillEllipse(cx, cy, Math.max(2, 2 * r * share - 3), 2 * r - 3);
    if (share > 0.3) {
      g.fillStyle(pal.trim, 1).fillEllipse(cx - r * 0.3 * share, cy - r * 0.3, Math.max(1, r * 0.5 * share), r * 0.5);
    }
  }
  function drawPickup(g, clip, i, left, top2, w, h, pal) {
    const bob = [0, -1, -2, -1][i] || 0;
    const cx = left + w / 2;
    const cy = top2 + h / 2 + bob;
    const r = Math.min(w, h) * 0.4;
    g.fillStyle(pal.visor, 1).fillTriangle(cx - r, cy, cx + r, cy, cx, cy + r * 1.1);
    g.fillStyle(pal.body, 1).fillTriangle(cx - r, cy, cx, cy - r * 0.7, cx + r, cy);
    g.fillStyle(pal.trim, 1).fillTriangle(cx - r * 0.7, cy, cx - r * 0.15, cy - r * 0.5, cx - r * 0.2, cy);
  }
  var DRAWERS = {
    hero: drawHero2,
    topdown: drawTopdown,
    slime: drawSlime,
    bat: drawBat,
    walker: drawWalker,
    coin: drawCoin,
    pickup: drawPickup
  };
  function draw(kind, g, clip, i, left, top2, w, h, pal) {
    (DRAWERS[kind] || drawHero2)(g, clip, i, left, top2, w, h, pal);
  }

  // src/static/sdk-libs/phaser/sprites-actor.js
  var BUILT_IN = { idle: true, walk: true, run: true, jump: true, fall: true, hit: true, die: true };
  var DIRECTIONAL = { idle: true, walk: true, run: true };
  var FALLBACK = { run: ["walk"], walk: ["run"], fall: ["jump"], jump: ["fall"] };
  var BY_ANGLE8 = ["right", "downright", "down", "downleft", "left", "upleft", "up", "upright"];
  var BY_ANGLE4 = ["right", "down", "left", "up"];
  var FLASH_MS = 90;
  var BUBBLE_PAD = 6;
  var BUBBLE_TAIL = 6;
  var BUBBLE_WIDTH = 140;
  var BUBBLE_MIN_MS = 1200;
  var BUBBLE_MS_PER_CHAR = 45;
  var BUBBLE_MAX_MS = 6e3;
  function directionOf(vx, vy, directions, directional) {
    if (!directional) return vx < 0 ? "left" : vx > 0 ? "right" : "";
    const angle = Math.atan2(vy, vx) * 180 / Math.PI;
    if (directions === 8) return BY_ANGLE8[(Math.round(angle / 45) % 8 + 8) % 8];
    return BY_ANGLE4[(Math.round(angle / 90) % 4 + 4) % 4];
  }
  function actor(scene, spec) {
    const s = spec || /** @type {ActorSpec} */
    {};
    const th = look(scene);
    const key = s.key || "hero";
    const mode = s.mode === "topdown" ? "topdown" : "platformer";
    const move2 = {
      speed: typeof s.speed === "number" ? s.speed : 220,
      jump: typeof s.jump === "number" ? s.jump : 420,
      doubleJump: !!s.doubleJump,
      runSpeed: typeof s.runSpeed === "number" ? s.runSpeed : 0
    };
    const names = s.anims || {};
    const artLeft = s.artFaces === "left";
    const hitMs = typeof s.hitMs === "number" ? s.hitMs : 220;
    const graceMs = typeof s.invulnerableMs === "number" ? s.invulnerableMs : 600;
    const dieMs = typeof s.dieMs === "number" ? s.dieMs : 700;
    const startX = s.x || 0;
    const startY = s.y || 0;
    const sprite = s.physics === false || !scene.physics ? scene.add.sprite(startX, startY, key) : scene.physics.add.sprite(startX, startY, key);
    if (sprite.body) {
      sprite.setCollideWorldBounds(s.collideWorldBounds !== false);
      if (typeof s.bounce === "number") sprite.setBounce(s.bounce);
    }
    if (typeof s.depth === "number") sprite.setDepth(s.depth);
    if (typeof s.scale === "number") sprite.setScale(s.scale);
    const directional = scene.anims.exists(key + "-walk-down");
    const eightWay = directional && scene.anims.exists(key + "-walk-upleft");
    const directions = s.directions === 8 || s.directions !== 4 && eightWay ? 8 : 4;
    let state = "";
    let facing = s.facing || (directional ? "down" : "right");
    let playing = "";
    let custom = false;
    let dead = false;
    let gone = false;
    let wasDown = true;
    let jumpHeld = false;
    let airJumps = 0;
    let stunUntil = 0;
    let graceUntil = 0;
    let bubble = null;
    let blink = null;
    const timers = [];
    const handlers = { state: [], hit: [], die: [], land: [] };
    function emit(event, a, b) {
      const list = handlers[event];
      if (!list) return;
      for (const fn of list.slice()) {
        try {
          fn(a, b);
        } catch (err) {
          console.warn('[aimeat-phaser] an actor handler for "' + event + '" threw:', err);
        }
      }
    }
    function after(ms2, fn) {
      const timer = scene.time.delayedCall(Math.max(0, ms2), function() {
        const at = timers.indexOf(timer);
        if (at >= 0) timers.splice(at, 1);
        if (!gone) fn();
      });
      timers.push(timer);
    }
    function animFor(want) {
      const tries = [];
      if (directional && DIRECTIONAL[want]) tries.push(key + "-" + want + "-" + facing);
      tries.push(names[want] || key + "-" + want);
      for (const other of FALLBACK[want] || []) tries.push(names[other] || key + "-" + other);
      for (const name of tries) if (scene.anims.exists(name)) return name;
      return "";
    }
    function play() {
      if (!state) return;
      const name = animFor(state);
      if (name && name !== playing) {
        sprite.play(name, true);
        playing = name;
      } else if (!name && playing) {
        sprite.anims.stop();
        playing = "";
      }
    }
    function set(next) {
      if (gone || !next) return false;
      if (dead && next !== "die") return false;
      const prev = state;
      if (next === prev) {
        play();
        return false;
      }
      state = next;
      custom = !BUILT_IN[next];
      play();
      if (custom) {
        const held = playing;
        if (held) {
          sprite.once("animationcomplete-" + held, function() {
            if (!gone && state === next) {
              custom = false;
              set("idle");
            }
          });
        } else {
          custom = false;
        }
      }
      emit("state", next, prev);
      return true;
    }
    function face(dir) {
      if (!dir || dir === facing) return;
      facing = dir;
      applyFlip();
      play();
    }
    function applyFlip() {
      if (directional) return;
      const left = facing.indexOf("left") >= 0;
      const right = facing.indexOf("right") >= 0;
      if (left || right) sprite.setFlipX(left !== artLeft);
    }
    function stopBlink() {
      if (!blink) return;
      blink.stop();
      blink = null;
      sprite.setAlpha(1);
    }
    function placeBubble() {
      if (!bubble) return;
      const originY = typeof sprite.originY === "number" ? sprite.originY : 0.5;
      bubble.setPosition(Math.round(sprite.x), Math.round(sprite.y - sprite.displayHeight * originY - 2));
    }
    function dropBubble() {
      if (!bubble) return;
      const old = bubble;
      bubble = null;
      scene.events.off("postupdate", placeBubble);
      if (scene.tweens) scene.tweens.killTweensOf(old);
      if (old.scene) old.destroy();
    }
    function say(text, opts) {
      const o = opts || {};
      dropBubble();
      const words = text == null ? "" : String(text);
      if (gone || !words) return null;
      const size = typeof o.size === "number" ? o.size : 12;
      const label = scene.add.text(0, 0, words, {
        fontFamily: th.font,
        fontSize: size + "px",
        color: hex(th.ink),
        align: "center",
        wordWrap: { width: typeof o.width === "number" ? o.width : BUBBLE_WIDTH }
      }).setOrigin(0.5, 1);
      const w = Math.round(label.width) + BUBBLE_PAD * 2;
      const h = Math.round(label.height) + BUBBLE_PAD * 2;
      const plate = scene.add.graphics();
      plate.fillStyle(th.surface, 1).fillRoundedRect(-w / 2, -h - BUBBLE_TAIL, w, h, 6);
      plate.lineStyle(1, th.line, 1).strokeRoundedRect(-w / 2, -h - BUBBLE_TAIL, w, h, 6);
      plate.fillStyle(th.surface, 1).fillTriangle(-4, -BUBBLE_TAIL - 1, 4, -BUBBLE_TAIL - 1, 0, 0);
      label.setPosition(0, -BUBBLE_TAIL - BUBBLE_PAD);
      bubble = scene.add.container(0, 0, [plate, label]).setDepth((sprite.depth || 0) + 1);
      placeBubble();
      scene.events.on("postupdate", placeBubble);
      const ms2 = typeof o.ms === "number" ? o.ms : Math.min(BUBBLE_MAX_MS, BUBBLE_MIN_MS + words.length * BUBBLE_MS_PER_CHAR);
      const mine = bubble;
      after(ms2, function() {
        if (bubble !== mine) return;
        if (reducedMotion() || !scene.tweens) {
          dropBubble();
          return;
        }
        scene.tweens.add({
          targets: mine,
          alpha: 0,
          duration: 160,
          onComplete: function() {
            if (bubble === mine) dropBubble();
          }
        });
      });
      return bubble;
    }
    function hit(opts) {
      const o = opts || {};
      const now = scene.time.now;
      if (gone || dead || now < graceUntil) return false;
      const grace = typeof o.invulnerableMs === "number" ? o.invulnerableMs : graceMs;
      const stun = typeof o.stunMs === "number" ? o.stunMs : hitMs;
      graceUntil = now + grace;
      stunUntil = now + stun;
      if (sprite.body && o.from) {
        const k = typeof o.knockback === "number" ? o.knockback : move2.speed * 0.8;
        const dx = sprite.x - o.from.x;
        const dy = sprite.y - o.from.y;
        if (mode === "platformer") {
          const side = dx === 0 ? facing === "left" ? 1 : -1 : dx < 0 ? -1 : 1;
          sprite.setVelocity(side * k, -k * 0.55);
        } else {
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          sprite.setVelocity(dx / len * k, dy / len * k);
        }
      }
      sprite.setTint(th.err);
      const PH = (
        /** @type {any} */
        window.Phaser
      );
      if (typeof sprite.setTintMode === "function" && PH && PH.TintModes) {
        sprite.setTintMode(PH.TintModes.FILL);
      }
      after(FLASH_MS, function() {
        sprite.clearTint();
      });
      stopBlink();
      if (!reducedMotion() && scene.tweens && grace > FLASH_MS * 2) {
        blink = scene.tweens.add({
          targets: sprite,
          alpha: 0.35,
          duration: 70,
          yoyo: true,
          repeat: Math.max(0, Math.floor(grace / 140) - 1),
          onComplete: function() {
            blink = null;
            sprite.setAlpha(1);
          }
        });
      }
      set("hit");
      after(stun, function() {
        if (!dead && state === "hit") set("idle");
      });
      emit("hit", o);
      return true;
    }
    function die2(cb) {
      if (gone || dead) return;
      dead = true;
      graceUntil = Infinity;
      stunUntil = 0;
      stopBlink();
      sprite.clearTint();
      dropBubble();
      if (sprite.body) {
        if (mode === "platformer") sprite.setVelocityX(0);
        else sprite.setVelocity(0, 0);
      }
      set("die");
      let done = false;
      const finish = function() {
        if (done || gone) return;
        done = true;
        emit("die");
        if (typeof cb === "function") cb();
      };
      if (playing) sprite.once("animationcomplete-" + playing, finish);
      after(dieMs, finish);
    }
    function update(c) {
      if (gone) return;
      const body = sprite.body;
      const onGround = !!(body && (body.blocked.down || body.touching.down));
      if (onGround) airJumps = 0;
      if (onGround && !wasDown && !dead) emit("land");
      wasDown = onGround;
      if (dead || scene.time.now < stunUntil) return;
      const left = !!(c && c.left);
      const right = !!(c && c.right);
      const wantJump = !!(c && c.jump);
      const running = move2.runSpeed > 0 && !!(c && c.run);
      const pace = running ? move2.runSpeed : move2.speed;
      const vx = left === right ? 0 : left ? -pace : pace;
      if (body) sprite.setVelocityX(vx);
      if (vx !== 0) face(vx < 0 ? "left" : "right");
      let jumped = false;
      if (wantJump && !jumpHeld && body) {
        if (onGround) {
          sprite.setVelocityY(-move2.jump);
          jumped = true;
        } else if (move2.doubleJump && airJumps < 1) {
          sprite.setVelocityY(-move2.jump * 0.86);
          airJumps += 1;
          jumped = true;
        }
      }
      jumpHeld = wantJump;
      if (custom) return;
      if (body && (jumped || !onGround)) set(jumped || body.velocity.y < 0 ? "jump" : "fall");
      else if (vx !== 0) set(running ? "run" : "walk");
      else set("idle");
    }
    function drive(vx, vy) {
      if (gone || dead || scene.time.now < stunUntil) return;
      const ax = typeof vx === "number" && isFinite(vx) ? vx : 0;
      const ay = typeof vy === "number" && isFinite(vy) ? vy : 0;
      if (sprite.body) sprite.setVelocity(ax, ay);
      const moving = ax !== 0 || ay !== 0;
      if (moving) face(directionOf(ax, ay, directions, directional));
      if (custom) return;
      set(moving ? "walk" : "idle");
    }
    function on(event, fn) {
      if (typeof fn !== "function" || !handlers[event]) {
        return function() {
        };
      }
      handlers[event].push(fn);
      return function off() {
        const at = handlers[event].indexOf(fn);
        if (at >= 0) handlers[event].splice(at, 1);
      };
    }
    function reset(nx, ny) {
      if (gone) return;
      dead = false;
      custom = false;
      stunUntil = 0;
      graceUntil = 0;
      airJumps = 0;
      jumpHeld = false;
      wasDown = true;
      stopBlink();
      sprite.clearTint();
      dropBubble();
      if (sprite.body) sprite.setVelocity(0, 0);
      if (typeof nx === "number" && typeof ny === "number") sprite.setPosition(nx, ny);
      state = "";
      playing = "";
      set("idle");
    }
    function destroy() {
      if (gone) return;
      gone = true;
      scene.events.off("shutdown", destroy);
      dropBubble();
      stopBlink();
      for (const timer of timers) {
        if (timer && typeof timer.remove === "function") timer.remove(false);
      }
      timers.length = 0;
      for (const name in handlers) handlers[name].length = 0;
      if (scene.tweens) scene.tweens.killTweensOf(sprite);
      if (sprite.scene) sprite.destroy();
    }
    applyFlip();
    set("idle");
    scene.events.once("shutdown", destroy);
    return {
      sprite,
      key,
      mode,
      move: move2,
      get state() {
        return state;
      },
      get facing() {
        return facing;
      },
      get dead() {
        return dead;
      },
      face,
      set,
      on,
      hit,
      die: die2,
      say,
      update,
      drive,
      reset,
      destroy
    };
  }

  // src/static/sdk-libs/phaser/sprites.js
  var MAX_COLUMNS = 16;
  var DECORATION = { idle: true, bob: true, spin: true, breathe: true };
  var ONCE = { die: true, hit: true, jump: true, fall: true };
  function register2(scene, key, name, frames, how) {
    const animKey = key + "-" + name;
    if (scene.anims.exists(animKey)) return animKey;
    scene.anims.create({
      key: animKey,
      frames: frames.map(function(f) {
        return { key, frame: f };
      }),
      frameRate: how.rate || 8,
      repeat: frames.length > 1 && typeof how.repeat === "number" ? how.repeat : 0,
      yoyo: !!how.yoyo
    });
    return animKey;
  }
  function spriteSheet(scene, spec) {
    const s = spec || /** @type {SheetSpec} */
    {};
    if (s.kind && !KINDS2[s.kind]) {
      console.warn('[aimeat-phaser] spriteSheet(): "' + s.kind + '" is not a kind it draws. The kinds are ' + Object.keys(KINDS2).join(", ") + "; drawing a hero.");
    }
    const kind = KINDS2[s.kind] ? s.kind : "hero";
    const key = s.key || kind;
    const th = look(scene);
    const p = plan(kind, s);
    const w = s.width || p.width;
    const h = s.height || p.height;
    const pal = palette2(kind, th, s.palette);
    let total = 0;
    for (const clip of p.clips) {
      clip.start = total;
      total += clip.count;
    }
    const columns = Math.min(total, MAX_COLUMNS);
    const rows = Math.ceil(total / columns);
    if (!scene.textures.exists(key)) {
      const g = scene.make.graphics({ add: false });
      for (const clip of p.clips) {
        for (let i = 0; i < clip.count; i++) {
          const cell = clip.start + i;
          draw(kind, g, clip.name, i, cell % columns * w, Math.floor(cell / columns) * h, w, h, pal);
        }
      }
      g.generateTexture(key, columns * w, rows * h);
      g.destroy();
      const texture = scene.textures.get(key);
      for (let i = 0; i < total; i++) {
        texture.add(i, 0, i % columns * w, Math.floor(i / columns) * h, w, h);
      }
    }
    const still = reducedMotion();
    const anims = {};
    const clips = {};
    for (const clip of p.clips) {
      const frames = [];
      const count = still && clip.still ? 1 : clip.count;
      for (let i = 0; i < count; i++) frames.push(clip.start + i);
      anims[clip.name] = register2(scene, key, clip.name, frames, { rate: clip.rate, repeat: clip.repeat });
      if (clip.alias) {
        anims[clip.alias] = register2(scene, key, clip.alias, frames, {
          rate: clip.aliasRate || clip.rate,
          repeat: clip.repeat
        });
      }
      clips[clip.name] = { start: clip.start, end: clip.start + clip.count - 1 };
    }
    return { key, kind, width: w, height: h, frames: total, anims, clips };
  }
  function readClip(want) {
    if (typeof want === "number") return { frames: [want] };
    if (typeof want === "string") return { frames: [want] };
    if (Array.isArray(want)) return want.length ? { frames: want.slice() } : null;
    if (!want || typeof want !== "object") return null;
    let frames = [];
    if (Array.isArray(want.frames)) {
      frames = want.frames.slice();
    } else if (typeof want.start === "number") {
      const end = typeof want.end === "number" ? want.end : typeof want.count === "number" ? want.start + want.count - 1 : want.start;
      for (let i = want.start; i <= end; i++) frames.push(i);
    }
    if (!frames.length) return null;
    return { frames, rate: want.rate, repeat: want.repeat, yoyo: want.yoyo, essential: want.essential };
  }
  function animations(scene, key, map) {
    const anims = {};
    if (!scene.textures.exists(key)) {
      console.warn('[aimeat-phaser] animations(): the texture "' + key + '" is not loaded, so its clips were not registered. Load the sheet first (preloadPack) and call again; the names will be the same.');
      for (const name in map || {}) anims[name] = key + "-" + name;
      return { key, anims };
    }
    const still = reducedMotion();
    for (const name in map || {}) {
      const clip = readClip(map[name]);
      if (!clip) {
        console.warn('[aimeat-phaser] animations(): "' + name + '" names no frames and was skipped.');
        continue;
      }
      const frames = still && DECORATION[name] && !clip.essential ? clip.frames.slice(0, 1) : clip.frames;
      const repeat = typeof clip.repeat === "number" ? clip.repeat : ONCE[name] ? 0 : -1;
      anims[name] = register2(scene, key, name, frames, { rate: clip.rate, repeat, yoyo: clip.yoyo });
    }
    return { key, anims };
  }
  function spriteFromLibrary(scene, lib, key, opts) {
    const o = opts || {};
    const man = lib && typeof lib.get === "function" ? lib.get() : lib;
    const entry = man && man.images ? man.images[key] : null;
    if (!entry) {
      throw new Error('[aimeat-phaser] the library has no image "' + key + '". lib.get().images lists what it holds; a sheet is an image entry with frames { frameWidth, frameHeight, count }.');
    }
    if (!scene.textures.exists(key)) {
      throw new Error('[aimeat-phaser] "' + key + '" is not loaded yet. preloadPack(this, lib) in preload(), or awaited in create(), puts the library on the scene first.');
    }
    if (!entry.frames && o.animations) {
      console.warn('[aimeat-phaser] "' + key + '" is a single image, not a sheet: its manifest entry has no frames, so every clip in the animations map cuts the same one frame. Give the entry frames { frameWidth, frameHeight, count } and load again.');
    }
    const anims = o.animations ? animations(scene, key, o.animations).anims : {};
    const x = o.x || 0;
    const y = o.y || 0;
    if (o.actor) {
      const given = o.actor === true ? {} : o.actor;
      const handle = actor(scene, Object.assign({ x, y, anims }, given, { key }));
      return { sprite: handle.sprite, anims, entry, actor: handle };
    }
    const sprite = o.physics && scene.physics ? scene.physics.add.sprite(x, y, key) : scene.add.sprite(x, y, key);
    if (o.play && anims[o.play]) sprite.play(anims[o.play]);
    return { sprite, anims, entry, actor: null };
  }

  // src/static/sdk-libs/phaser/transitions.js
  function transition(scene, toKey, opts) {
    const o = opts || {};
    const th = look(scene);
    const kind = reducedMotion() ? "cut" : o.kind || "fade";
    const span2 = o.duration != null ? o.duration : Math.max(180, ms(th.motion, 200) * 2);
    const tint2 = o.colour === "ink" ? th.ink : o.colour === "accent" ? th.accent : th.bg;
    const ease = curve(th);
    if (kind === "cut") {
      scene.scene.start(toKey, o.data);
      return Promise.resolve();
    }
    if (kind === "fade") return fadeOver(scene, toKey, o.data, span2, tint2);
    if (kind === "wipe") return coverOver(scene, toKey, o.data, span2, tint2, ease, wipeIn, wipeOut);
    return coverOver(scene, toKey, o.data, span2, tint2, ease, irisIn, irisOut);
  }
  function fadeOver(scene, toKey, data, span2, tint2) {
    const c = channels(tint2);
    return new Promise(function(done) {
      scene.cameras.main.fadeOut(span2, c.r, c.g, c.b, function(camera, progress) {
        if (progress < 1) return;
        onceCreated(scene, toKey, function(target) {
          target.cameras.main.fadeIn(span2, c.r, c.g, c.b);
        });
        scene.scene.start(toKey, data);
        done();
      });
    });
  }
  function coverOver(scene, toKey, data, span2, tint2, ease, cover, uncover) {
    return cover(scene, span2, tint2, ease).then(function() {
      onceCreated(scene, toKey, function(target) {
        uncover(target, span2, tint2, ease);
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
  function wipeIn(scene, span2, tint2, ease) {
    const width = scene.scale.width;
    const height = scene.scale.height;
    const bar = scene.add.rectangle(0, height / 2, width, height, tint2).setOrigin(0, 0.5);
    bar.setScrollFactor(0).setDepth(OVERLAY_DEPTH).setScale(0, 1);
    return new Promise(function(done) {
      scene.tweens.add({ targets: bar, scaleX: 1, duration: span2, ease, onComplete: function() {
        done();
      } });
    });
  }
  function wipeOut(scene, span2, tint2, ease) {
    const width = scene.scale.width;
    const height = scene.scale.height;
    const bar = scene.add.rectangle(width, height / 2, width, height, tint2).setOrigin(1, 0.5);
    bar.setScrollFactor(0).setDepth(OVERLAY_DEPTH);
    scene.tweens.add({
      targets: bar,
      scaleX: 0,
      duration: span2,
      ease,
      onComplete: function() {
        bar.destroy();
      }
    });
  }
  function irisIn(scene, span2, tint2, ease) {
    const ring2 = makeRing(scene, tint2);
    return new Promise(function(done) {
      scene.tweens.add({
        targets: ring2.state,
        r: 0,
        duration: span2,
        ease,
        onUpdate: ring2.draw,
        onComplete: function() {
          ring2.draw();
          done();
        }
      });
    });
  }
  function irisOut(scene, span2, tint2, ease) {
    const ring2 = makeRing(scene, tint2);
    ring2.state.r = 0;
    ring2.draw();
    scene.tweens.add({
      targets: ring2.state,
      r: ring2.outer,
      duration: span2,
      ease,
      onUpdate: ring2.draw,
      onComplete: function() {
        ring2.graphics.destroy();
      }
    });
  }
  function makeRing(scene, tint2) {
    const width = scene.scale.width;
    const height = scene.scale.height;
    const cx = width / 2;
    const cy = height / 2;
    const outer = Math.sqrt(width * width + height * height) / 2 + 4;
    const g = scene.add.graphics();
    g.setScrollFactor(0).setDepth(OVERLAY_DEPTH);
    const state = { r: outer };
    const draw2 = function() {
      const inner = Math.max(0, state.r);
      g.clear();
      if (inner >= outer) return;
      g.lineStyle(outer - inner, tint2, 1);
      g.strokeCircle(cx, cy, (outer + inner) / 2);
    };
    draw2();
    return { graphics: g, state, outer, draw: draw2 };
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
      const box2 = scene.add.container(0, i * gap);
      const label = scene.add.text(0, 0, item.label, labelStyle);
      label.setOrigin(centred ? 0.5 : 0, 0.5);
      if (item.locked) label.setAlpha(0.55);
      box2.add(label);
      let hint = null;
      if (item.hint) {
        hint = scene.add.text(0, Math.round(size * 0.78), item.hint, hintStyle);
        hint.setOrigin(centred ? 0.5 : 0, 0.5);
        box2.add(hint);
      }
      root.add(box2);
      label.setInteractive({ useHandCursor: true });
      label.on("pointerover", function() {
        if (live) api.select(i);
      });
      label.on("pointerdown", function() {
        if (live) pick(i);
      });
      rows.push({ item, box: box2, label, hint, text: item.label, homeX: 0 });
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
      const span2 = Math.round(pace * 1.6);
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
          duration: span2,
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
    const made2 = [];
    let total = 0;
    for (const ch of chars) {
      const letter = scene.add.text(0, cy, ch, style).setOrigin(0, 0.5);
      made2.push(letter);
      total += letter.width;
    }
    let x = cx - total / 2;
    made2.forEach(function(letter, i) {
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
    const scaled2 = (mag - dead) / (1 - dead);
    return n < 0 ? -scaled2 : scaled2;
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
      const box2 = stick.getBoundingClientRect();
      const radius = Math.max(1, Math.min(box2.width, box2.height) / 2);
      const dx = clamp1((ev.clientX - (box2.left + box2.width / 2)) / radius);
      const dy = clamp1((ev.clientY - (box2.top + box2.height / 2)) / radius);
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
    function fire2(name) {
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
        if (edges[name]) fire2(name);
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

  // src/static/sdk-libs/phaser/worldmap-draw.js
  var NODE_RADIUS = { level: 14, town: 15, boss: 19, secret: 11 };
  var NODE_ROLE = { level: "accent", town: "ok", boss: "err", secret: "ch3" };
  var STAR_GAP = 13;
  var STAR_OUTER = 5.2;
  var STAR_INNER = 2.3;
  var DOT_STEP = 9;
  var DASH_ON = 8;
  var DASH_OFF = 6;
  function toneOf(th, want, fallback) {
    if (typeof want === "number" && isFinite(want)) return want;
    if (typeof want === "string" && typeof th[want] === "number") return th[want];
    return fallback;
  }
  function pointAt(geom, t) {
    const a = geom.from;
    const b = geom.to;
    const c = geom.control || [];
    const u = 1 - t;
    if (c.length === 0) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (c.length === 1) {
      const p2 = c[0];
      return {
        x: u * u * a.x + 2 * u * t * p2.x + t * t * b.x,
        y: u * u * a.y + 2 * u * t * p2.y + t * t * b.y
      };
    }
    const p = c[0];
    const q = c[1];
    return {
      x: u * u * u * a.x + 3 * u * u * t * p.x + 3 * u * t * t * q.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * p.y + 3 * u * t * t * q.y + t * t * t * b.y
    };
  }
  function samplePath(geom, count) {
    const n = Math.max(2, Math.floor(count));
    const pts = [];
    for (let i = 0; i <= n; i += 1) pts.push(pointAt(geom, i / n));
    return pts;
  }
  function pathLength(geom) {
    const pts = samplePath(geom, 24);
    let len = 0;
    for (let i = 1; i < pts.length; i += 1) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return len;
  }
  function drawRegions(scene, regions, th) {
    const g = scene.add.graphics();
    const captions = [];
    for (const r of regions || []) {
      const tone6 = toneOf(th, r.tone, th.line);
      const radius = Math.max(4, Math.min(18, r.w / 4, r.h / 4));
      g.fillStyle(tone6, 0.09);
      g.fillRoundedRect(r.x, r.y, r.w, r.h, radius);
      g.lineStyle(1, tone6, 0.4);
      g.strokeRoundedRect(r.x, r.y, r.w, r.h, radius);
      if (r.label) {
        captions.push(scene.add.text(r.x + 14, r.y + 10, String(r.label), {
          fontFamily: th.fontDisplay || th.font,
          fontSize: "14px",
          color: hex(th.inkDim)
        }).setOrigin(0, 0));
      }
    }
    return { graphics: g, captions };
  }
  function drawPaths(g, list, th, defaultStyle) {
    g.clear();
    for (const item of list) {
      if (!item.shown) continue;
      const colour = item.open ? th.ink : th.line;
      const alpha = item.open ? 0.85 : 0.8;
      const style = item.style || defaultStyle || "dotted";
      const pts = samplePath(item.geom, Math.max(8, Math.ceil(pathLength(item.geom) / 3)));
      if (style === "dashed") dashes(g, pts, colour, alpha, item.open ? 2 : 1.5);
      else dots(g, pts, colour, alpha, item.open ? 1.8 : 1.4);
    }
  }
  function dots(g, pts, colour, alpha, radius) {
    g.fillStyle(colour, alpha);
    let carry = 0;
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      let d = carry;
      while (d <= seg) {
        const k = seg > 0 ? d / seg : 0;
        g.fillCircle(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, radius);
        d += DOT_STEP;
      }
      carry = d - seg;
    }
  }
  function dashes(g, pts, colour, alpha, width) {
    g.lineStyle(width, colour, alpha);
    let on = true;
    let left = DASH_ON;
    for (let i = 1; i < pts.length; i += 1) {
      let a = pts[i - 1];
      const b = pts[i];
      let seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (seg > 0 && left < seg) {
        const k = left / seg;
        const m = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        if (on) g.lineBetween(a.x, a.y, m.x, m.y);
        on = !on;
        left = on ? DASH_ON : DASH_OFF;
        a = m;
        seg = Math.hypot(b.x - a.x, b.y - a.y);
      }
      if (on && seg > 0) g.lineBetween(a.x, a.y, b.x, b.y);
      left -= seg;
    }
  }
  function buildNode(scene, node, th) {
    const kind = NODE_RADIUS[node.kind] ? node.kind : "level";
    const r = NODE_RADIUS[kind];
    const box2 = scene.add.container(node.x, node.y);
    const ring2 = scene.add.graphics();
    const body = scene.add.graphics();
    const lock = scene.add.graphics();
    const stars2 = scene.add.graphics();
    const label = scene.add.text(0, r + 9, node.label != null ? String(node.label) : String(node.id), {
      fontFamily: th.font,
      fontSize: "13px",
      color: hex(th.ink),
      align: "center"
    }).setOrigin(0.5, 0);
    const best = scene.add.text(0, r + 41, "", {
      fontFamily: th.fontMono || th.font,
      fontSize: "11px",
      color: hex(th.inkDim)
    }).setOrigin(0.5, 0);
    const hit = scene.add.circle(0, 0, r + 8);
    box2.add([ring2, body, lock, stars2, label, best, hit]);
    return {
      node,
      kind,
      r,
      box: box2,
      ring: ring2,
      body,
      lock,
      stars: stars2,
      label,
      best,
      hit,
      lifting: false
    };
  }
  function paintNode(entry, state, th) {
    const r = entry.r;
    const open2 = !!state.unlocked;
    const fill3 = open2 ? th[NODE_ROLE[entry.kind]] : th.surface;
    const edge = open2 ? th.ink : th.line;
    const body = entry.body;
    body.clear();
    body.fillStyle(fill3, 1);
    body.lineStyle(open2 ? 2 : 1.5, edge, open2 ? 0.9 : 0.8);
    if (entry.kind === "town") {
      body.fillRoundedRect(-r, -r, r * 2, r * 2, r * 0.35);
      body.strokeRoundedRect(-r, -r, r * 2, r * 2, r * 0.35);
    } else if (entry.kind === "boss") {
      const pts = [{ x: 0, y: -r }, { x: r, y: 0 }, { x: 0, y: r }, { x: -r, y: 0 }];
      body.fillPoints(pts, true);
      body.strokePoints(pts, true);
    } else if (entry.kind === "secret") {
      body.lineStyle(3, open2 ? fill3 : edge, 1);
      body.strokeCircle(0, 0, r * 0.8);
      body.fillStyle(open2 ? fill3 : edge, 1);
      body.fillCircle(0, 0, r * 0.3);
    } else {
      body.fillCircle(0, 0, r);
      body.strokeCircle(0, 0, r);
    }
    entry.lock.clear();
    if (!open2) drawLock(entry.lock, th.inkDim);
    entry.stars.clear();
    if (open2 && entry.kind !== "town") drawStars(entry.stars, state.stars, r + 30, th);
    entry.best.setText(open2 && state.best > 0 ? String(state.best) : "");
    const inkFor = state.current || state.hover ? th.accent : open2 ? th.ink : th.inkDim;
    entry.label.setColor(hex(inkFor));
    entry.ring.clear();
    if (state.current) {
      entry.ring.lineStyle(2, th.accent, 0.9);
      entry.ring.strokeCircle(0, 0, r + 5);
    }
  }
  function drawLock(g, colour) {
    g.fillStyle(colour, 1);
    g.fillRoundedRect(-5, -1, 10, 8, 2);
    g.lineStyle(2, colour, 1);
    g.beginPath();
    g.arc(0, -1, 3.5, Math.PI, 0, false);
    g.strokePath();
  }
  function drawStars(g, count, y, th) {
    const n = Math.max(0, Math.min(3, Math.floor(typeof count === "number" ? count : 0)));
    for (let i = 0; i < 3; i += 1) {
      const earned = i < n;
      g.fillStyle(earned ? th.warn : th.line, earned ? 1 : 0.7);
      g.fillPoints(starPoints((i - 1) * STAR_GAP, y, STAR_OUTER, STAR_INNER), true);
    }
  }
  function starPoints(cx, cy, outer, inner) {
    const pts = [];
    for (let i = 0; i < 10; i += 1) {
      const rad = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
    }
    return pts;
  }
  function buildWalker(scene, th) {
    const box2 = scene.add.container(0, 0);
    const shadow = scene.add.graphics();
    shadow.fillStyle(th.ink, 0.18);
    shadow.fillEllipse(0, 9, 16, 6);
    const body = scene.add.graphics();
    body.fillStyle(th.accent, 1);
    body.fillCircle(0, 0, 9);
    body.lineStyle(2, th.ink, 0.9);
    body.strokeCircle(0, 0, 9);
    body.fillStyle(th.bg, 1);
    body.fillCircle(-3, -3, 2.6);
    box2.add([shadow, body]);
    return { box: box2, body };
  }
  function buildHaze(scene, x, y, th) {
    const g = scene.add.graphics();
    g.setPosition(x, y);
    g.fillStyle(th.bg, 0.6);
    g.fillCircle(0, 10, 40);
    g.fillStyle(th.surface, 0.92);
    g.fillCircle(-13, 6, 17);
    g.fillCircle(10, -2, 19);
    g.fillCircle(6, 16, 15);
    g.fillCircle(-5, -9, 13);
    g.lineStyle(1, th.line, 0.45);
    g.strokeCircle(10, -2, 19);
    g.strokeCircle(-13, 6, 17);
    return g;
  }
  function pulseAt(scene, parent, x, y, r, th, pace, ease, done) {
    const g = scene.add.graphics();
    g.setPosition(x, y);
    g.lineStyle(2, th.accent, 1);
    g.strokeCircle(0, 0, r + 4);
    parent.add(g);
    scene.tweens.add({
      targets: g,
      scaleX: 1.9,
      scaleY: 1.9,
      alpha: 0,
      duration: pace * 3,
      ease,
      repeat: 0,
      onComplete: function() {
        if (g.scene) g.destroy();
        done(g);
      }
    });
    return g;
  }

  // src/static/sdk-libs/phaser/worldmap-graph.js
  var DIRS = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };
  var DIR_MATCH = 0.34;
  var DIR_PROBE = 0.3;
  var MARGIN2 = 80;
  function normalizePaths(given, byId) {
    const out = [];
    for (const raw of given || []) {
      const p = Array.isArray(raw) ? { from: raw[0], to: raw[1] } : raw;
      const a = p && byId[String(p.from)];
      const b = p && byId[String(p.to)];
      if (!a || !b) {
        console.warn("[aimeat-phaser] worldMap: a path names a node that is not on the map:", raw);
        continue;
      }
      const control = Array.isArray(p.control) ? p.control.slice(0, 2) : [];
      out.push({ a, b, geom: { from: a, to: b, control }, style: p.style });
    }
    return out;
  }
  function buildGraph(nodes, paths) {
    const byId = {};
    for (const n of nodes) byId[String(n.id)] = n;
    const list = normalizePaths(paths, byId);
    const edges = {};
    for (const n of nodes) edges[String(n.id)] = [];
    for (const p of list) {
      edges[String(p.a.id)].push({ to: String(p.b.id), path: p, reverse: false });
      edges[String(p.b.id)].push({ to: String(p.a.id), path: p, reverse: true });
    }
    return { byId, edges, paths: list };
  }
  function along(edge, t) {
    return pointAt(edge.path.geom, edge.reverse ? 1 - t : t);
  }
  function neighbourToward(graph, current, dir) {
    const here = graph.byId[current];
    const want = DIRS[dir];
    if (!here || !want) return null;
    let best = null;
    let bestDot = DIR_MATCH;
    for (const e of graph.edges[current] || []) {
      const p = along(e, DIR_PROBE);
      const dx = p.x - here.x;
      const dy = p.y - here.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const dot = dx / len * want.x + dy / len * want.y;
      if (dot > bestDot) {
        bestDot = dot;
        best = e;
      }
    }
    return best;
  }
  function routeTo(graph, current, key, isOpen) {
    const cameFrom = {};
    const queue = [current];
    cameFrom[current] = "";
    while (queue.length) {
      const at = queue.shift();
      if (at === key) break;
      for (const e of graph.edges[at] || []) {
        if (cameFrom[e.to] !== void 0 || !isOpen(e.to)) continue;
        cameFrom[e.to] = at;
        queue.push(e.to);
      }
    }
    if (cameFrom[key] === void 0) return null;
    const route = [];
    for (let k = key; k !== current; k = cameFrom[k]) route.unshift(k);
    return route;
  }
  function mapSize(nodes, regions, scene, width, height) {
    let maxX = 0;
    let maxY = 0;
    for (const n of nodes) {
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    for (const r of regions || []) {
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
    }
    const vw = scene.scale ? scene.scale.width : 0;
    const vh = scene.scale ? scene.scale.height : 0;
    return {
      w: width || Math.max(vw, maxX + MARGIN2),
      h: height || Math.max(vh, maxY + MARGIN2)
    };
  }

  // src/static/sdk-libs/phaser/worldmap.js
  var WALK_SPEED = 240;
  var HOP_MIN = 140;
  var HOP_MAX = 2400;
  var BOB_PX = 4;
  var BOB_MS = 120;
  var SHAKE_PX2 = 8;
  var DIM = 0.6;
  function worldMap(scene, spec) {
    const s = spec || /** @type {WorldMapSpec} */
    { nodes: [] };
    const th = look(scene);
    const still = reducedMotion();
    const pace = ms(th.motion, 200);
    const ease = curve(th);
    const store = s.store && s.store.levels ? s.store : null;
    const fog2 = !!s.fog;
    const speed = typeof s.speed === "number" && s.speed > 0 ? s.speed : WALK_SPEED;
    const nodes = (s.nodes || []).slice();
    const graph = buildGraph(nodes, s.paths);
    const byId = graph.byId;
    const edges = graph.edges;
    const paths = graph.paths;
    const local = { unlocked: (
      /** @type {Record<string, boolean>} */
      {}
    ), stars: (
      /** @type {Record<string, number>} */
      {}
    ), best: (
      /** @type {Record<string, number>} */
      {}
    ) };
    if (Array.isArray(s.unlocked)) for (const id of s.unlocked) local.unlocked[String(id)] = true;
    else if (s.unlocked && typeof s.unlocked === "object") for (const id in s.unlocked) local.unlocked[id] = !!s.unlocked[id];
    for (const id in s.stars || {}) local.stars[id] = s.stars[id];
    for (const id in s.best || {}) local.best[id] = s.best[id];
    function stateOf(key) {
      const node = byId[key];
      const forced = !!(node && node.unlocked);
      if (store) {
        const rec = store.levels.get(key);
        return {
          unlocked: forced || store.levels.isUnlocked(key),
          stars: rec ? rec.stars : 0,
          best: rec ? rec.best : 0
        };
      }
      return {
        unlocked: forced || !!local.unlocked[key],
        stars: local.stars[key] || 0,
        best: local.best[key] || 0
      };
    }
    const size = mapSize(nodes, s.regions || [], scene, s.width, s.height);
    if (typeof s.backdrop === "function") s.backdrop(scene);
    const root = scene.add.container(0, 0);
    if (typeof s.depth === "number") root.setDepth(s.depth);
    const regions = drawRegions(scene, s.regions || [], th);
    root.add(regions.graphics);
    for (const cap2 of regions.captions) root.add(cap2);
    const pathsG = scene.add.graphics();
    root.add(pathsG);
    const entries = {};
    for (const n of nodes) {
      const entry = buildNode(scene, n, th);
      entries[String(n.id)] = entry;
      root.add(entry.box);
      wirePointer(entry, String(n.id));
    }
    const hazes = {};
    const drawn = s.walker ? null : buildWalker(scene, th);
    const walker = s.walker || drawn.box;
    const walkerBody = drawn ? drawn.body : null;
    if (drawn) root.add(walker);
    const pulses = [];
    const handlers = {};
    let current = pickStart();
    let hoverKey = "";
    let moving = false;
    let live = true;
    let gone = false;
    let walkTween = null;
    let bobTween = null;
    let walkGen = 0;
    let settleWalk = null;
    placeWalker(byId[current]);
    repaint(true);
    const cam = scene.cameras && scene.cameras.main ? scene.cameras.main : null;
    const following = !!(cam && s.camera === "follow");
    if (following) {
      cam.setBounds(0, 0, size.w, size.h);
      cam.startFollow(walker, true, still ? 1 : 0.1, still ? 1 : 0.1);
    }
    function pickStart() {
      if (s.current != null && byId[String(s.current)]) return String(s.current);
      for (const n of nodes) if (stateOf(String(n.id)).unlocked) return String(n.id);
      return nodes.length ? String(nodes[0].id) : "";
    }
    function placeWalker(node) {
      if (!node) return;
      walker.setPosition(node.x, node.y);
    }
    function emit(event, value) {
      const list = handlers[event];
      if (!list) return;
      for (const fn of list.slice()) fn(value);
    }
    function repaint(initial) {
      const facts = {};
      for (const key in entries) facts[key] = stateOf(key);
      const inView = /* @__PURE__ */ new Set();
      for (const key in entries) {
        if (!fog2 || facts[key].unlocked) {
          inView.add(key);
          for (const e of edges[key]) inView.add(e.to);
        }
      }
      if (current) inView.add(current);
      for (const key in entries) {
        const entry = entries[key];
        const f = facts[key];
        paintNode(entry, {
          unlocked: f.unlocked,
          stars: f.stars,
          best: f.best,
          current: key === current,
          hover: key === hoverKey
        }, th);
        const rest = f.unlocked ? 1 : DIM;
        if (!inView.has(key)) hide(entry, key);
        else if (hazes[key]) reveal(entry, key, rest, !!initial);
        else if (!entry.lifting) entry.box.setAlpha(rest);
      }
      drawPaths(pathsG, paths.map(function(p) {
        const ka = String(p.a.id);
        const kb = String(p.b.id);
        return {
          geom: p.geom,
          style: p.style,
          open: facts[ka].unlocked && facts[kb].unlocked,
          shown: inView.has(ka) && inView.has(kb)
        };
      }), th, s.pathStyle);
    }
    function hide(entry, key) {
      if (hazes[key]) return;
      if (scene.tweens) scene.tweens.killTweensOf(entry.box);
      entry.lifting = false;
      entry.box.setAlpha(0);
      entry.hit.disableInteractive();
      const haze = buildHaze(scene, entry.node.x, entry.node.y, th);
      hazes[key] = haze;
      root.add(haze);
    }
    function reveal(entry, key, rest, instant) {
      const haze = hazes[key];
      delete hazes[key];
      entry.hit.setInteractive({ useHandCursor: true });
      if (instant || still) {
        haze.destroy();
        entry.box.setAlpha(rest);
        return;
      }
      entry.lifting = true;
      scene.tweens.add({
        targets: haze,
        alpha: 0,
        duration: pace * 3,
        ease,
        onComplete: function() {
          if (haze.scene) haze.destroy();
        }
      });
      scene.tweens.add({
        targets: entry.box,
        alpha: rest,
        duration: pace * 3,
        ease,
        onComplete: function() {
          entry.lifting = false;
        }
      });
    }
    function wirePointer(entry, key) {
      entry.hit.setInteractive({ useHandCursor: true });
      entry.hit.on("pointerover", function() {
        if (!live || gone) return;
        hoverKey = key;
        paintOne(key);
      });
      entry.hit.on("pointerout", function() {
        if (gone) return;
        if (hoverKey === key) hoverKey = "";
        paintOne(key);
      });
      entry.hit.on("pointerdown", function() {
        if (!live || moving || gone) return;
        if (key === current) pickCurrent();
        else api.goTo(key);
      });
    }
    function paintOne(key) {
      const f = stateOf(key);
      paintNode(entries[key], {
        unlocked: f.unlocked,
        stars: f.stars,
        best: f.best,
        current: key === current,
        hover: key === hoverKey
      }, th);
    }
    function isOpen(key) {
      return stateOf(key).unlocked;
    }
    function hop(toKey, done) {
      const edge = (edges[current] || []).find(function(e) {
        return e.to === toKey;
      });
      const target = byId[toKey];
      if (!edge || !target) {
        done();
        return;
      }
      if (still) {
        current = toKey;
        placeWalker(target);
        done();
        return;
      }
      const len = pathLength(edge.path.geom);
      const duration = Math.round(Math.min(HOP_MAX, Math.max(HOP_MIN, len / speed * 1e3)));
      const probe = along(edge, DIR_PROBE);
      if (typeof walker.setFlipX === "function") walker.setFlipX(probe.x < byId[current].x);
      bob(duration);
      const ride = { t: 0 };
      const gen = walkGen;
      walkTween = scene.tweens.add({
        targets: ride,
        t: 1,
        duration,
        ease: "Sine.easeInOut",
        onUpdate: function() {
          if (gen !== walkGen) return;
          const p = along(edge, ride.t);
          walker.setPosition(p.x, p.y);
        },
        onComplete: function() {
          if (gen !== walkGen) return;
          walkTween = null;
          current = toKey;
          placeWalker(target);
          done();
        }
      });
    }
    function settle(ok) {
      const resolve2 = settleWalk;
      settleWalk = null;
      if (resolve2) resolve2(ok);
    }
    function bob(duration) {
      if (!walkerBody || still) return;
      const beats = Math.max(1, Math.floor(duration / (BOB_MS * 2)));
      bobTween = scene.tweens.add({
        targets: walkerBody,
        y: -BOB_PX,
        duration: BOB_MS,
        yoyo: true,
        repeat: beats - 1,
        ease: "Sine.easeInOut",
        onComplete: function() {
          bobTween = null;
          walkerBody.y = 0;
        }
      });
    }
    function travel(route) {
      moving = true;
      emit("move", { from: byId[current], to: byId[route[route.length - 1]] });
      return new Promise(function(resolve2) {
        settleWalk = resolve2;
        const step2 = function(i) {
          if (gone) {
            settle(false);
            return;
          }
          if (i >= route.length) {
            moving = false;
            arrive();
            settle(true);
            return;
          }
          hop(route[i], function() {
            step2(i + 1);
          });
        };
        step2(0);
      });
    }
    function arrive() {
      repaint();
      const node = byId[current];
      const entry = entries[current];
      if (node && entry && !still) {
        const ring2 = pulseAt(scene, root, node.x, node.y, entry.r, th, pace, ease, function(gone_) {
          const at = pulses.indexOf(gone_);
          if (at >= 0) pulses.splice(at, 1);
        });
        if (ring2.scene) pulses.push(ring2);
      }
      emit("arrive", node);
    }
    function refuse(node) {
      emit("refuse", node);
      if (still || !scene.tweens) return;
      const home = walker.x;
      scene.tweens.killTweensOf(walker);
      scene.tweens.add({
        targets: walker,
        x: home + SHAKE_PX2,
        duration: Math.round(pace * 0.28),
        ease: "Sine.easeInOut",
        yoyo: true,
        repeat: 2,
        onComplete: function() {
          walker.x = home;
        }
      });
    }
    function step(dir) {
      if (!live || moving || gone) return;
      const edge = neighbourToward(graph, current, dir);
      if (!edge) return;
      if (!isOpen(edge.to)) {
        refuse(byId[edge.to]);
        return;
      }
      travel([edge.to]);
    }
    function pickCurrent() {
      if (!live || moving || gone) return;
      const node = byId[current];
      if (!node) return;
      if (!isOpen(current)) {
        refuse(node);
        return;
      }
      emit("pick", node);
      if (typeof node.onPick === "function") node.onPick(node);
    }
    const held = { left: false, right: false, up: false, down: false, act: false };
    const tick = function() {
      const c = s.controls;
      if (!live || !c || gone) return;
      for (const dir in DIRS) {
        const now = !!c[dir];
        if (now && !held[dir]) step(
          /** @type {any} */
          dir
        );
        held[dir] = now;
      }
      const act = !!(c.action || c.jump && !c.up);
      if (act && !held.act) pickCurrent();
      held.act = act;
    };
    if (s.controls) scene.events.on("update", tick);
    const keyboard = !s.controls && scene.input && scene.input.keyboard ? scene.input.keyboard : null;
    const keys = {
      "keydown-LEFT": function() {
        step("left");
      },
      "keydown-A": function() {
        step("left");
      },
      "keydown-RIGHT": function() {
        step("right");
      },
      "keydown-D": function() {
        step("right");
      },
      "keydown-UP": function() {
        step("up");
      },
      "keydown-W": function() {
        step("up");
      },
      "keydown-DOWN": function() {
        step("down");
      },
      "keydown-S": function() {
        step("down");
      },
      "keydown-ENTER": pickCurrent,
      "keydown-SPACE": pickCurrent
    };
    if (keyboard) for (const name in keys) keyboard.on(name, keys[name]);
    const offStore = store && typeof store.onChange === "function" ? store.onChange(function() {
      if (!gone) repaint();
    }) : null;
    const api = {
      el: root,
      walker,
      on(event, fn) {
        const list = handlers[event] || (handlers[event] = []);
        list.push(fn);
        return function off() {
          const at = list.indexOf(fn);
          if (at >= 0) list.splice(at, 1);
        };
      },
      goTo(id, opts) {
        const key = String(id);
        const target = byId[key];
        if (!target || gone) return Promise.resolve(false);
        if (key === current && !moving) return Promise.resolve(true);
        if (opts && opts.instant) {
          stopWalk();
          current = key;
          placeWalker(target);
          repaint();
          emit("arrive", target);
          return Promise.resolve(true);
        }
        if (moving) return Promise.resolve(false);
        const route = routeTo(graph, current, key, isOpen);
        if (!route) {
          refuse(target);
          return Promise.resolve(false);
        }
        return travel(route);
      },
      current() {
        return byId[current] ? byId[current].id : null;
      },
      refresh() {
        if (!gone) repaint();
      },
      setUnlocked(id, on) {
        const want = on !== false;
        if (store) {
          if (want) store.levels.unlock(id);
          else console.warn("[aimeat-phaser] worldMap: a saves() store cannot relock a level; nothing changed for", id);
        } else {
          local.unlocked[String(id)] = want;
        }
        if (!gone) repaint();
      },
      setStars(id, n) {
        const want = Math.max(0, Math.min(3, Math.floor(typeof n === "number" ? n : 0)));
        if (store) store.levels.stars(id, want);
        else local.stars[String(id)] = want;
        if (!gone) repaint();
      },
      setBest(id, n) {
        const want = typeof n === "number" && isFinite(n) ? n : 0;
        if (store) store.levels.best(id, want);
        else local.best[String(id)] = want;
        if (!gone) repaint();
      },
      enable(on) {
        live = !!on;
      },
      destroy() {
        if (gone) return;
        gone = true;
        moving = false;
        scene.events.off("update", tick);
        scene.events.off("shutdown", api.destroy);
        if (keyboard) for (const name in keys) keyboard.off(name, keys[name]);
        if (offStore) offStore();
        stopWalk();
        if (scene.tweens) {
          scene.tweens.killTweensOf(walker);
          for (const key in entries) scene.tweens.killTweensOf(entries[key].box);
          for (const key in hazes) scene.tweens.killTweensOf(hazes[key]);
          for (const ring2 of pulses) scene.tweens.killTweensOf(ring2);
        }
        pulses.length = 0;
        if (following && scene.cameras && scene.cameras.main && typeof scene.cameras.main.stopFollow === "function") {
          scene.cameras.main.stopFollow();
        }
        for (const key in handlers) handlers[key].length = 0;
        if (root.scene) root.destroy(true);
      }
    };
    function stopWalk() {
      walkGen += 1;
      if (walkTween && typeof walkTween.stop === "function") walkTween.stop();
      walkTween = null;
      if (bobTween && typeof bobTween.stop === "function") bobTween.stop();
      bobTween = null;
      if (walkerBody) walkerBody.y = 0;
      moving = false;
      settle(false);
    }
    scene.events.once("shutdown", api.destroy);
    return api;
  }
  function worldMapScene(spec) {
    const s = spec || /** @type {any} */
    { nodes: [] };
    const key = s.key || "map";
    let pad2 = null;
    let last = s.current;
    return {
      key,
      create: function(data) {
        const scene = (
          /** @type {any} */
          this
        );
        const th = look(scene);
        scene.cameras.main.setBackgroundColor(th.bg);
        const wants = s.controls;
        let own = false;
        if (wants === true || wants && typeof wants === "object" && typeof wants.update !== "function") {
          pad2 = controls(scene, wants === true ? { touch: "auto" } : wants);
          own = true;
        } else {
          pad2 = wants || null;
        }
        const start = data && data.current != null ? data.current : last;
        const map = worldMap(
          scene,
          /** @type {any} */
          Object.assign({}, s, { controls: pad2, current: start })
        );
        map.on("arrive", function(node) {
          last = node.id;
        });
        map.on("pick", function(node) {
          last = node.id;
          if (!node.scene) return;
          map.enable(false);
          transition(scene, node.scene, {
            kind: s.transition || "fade",
            data: node.data !== void 0 ? node.data : { node: node.id }
          });
        });
        scene.events.once("shutdown", function() {
          if (own && pad2) pad2.destroy();
          pad2 = null;
        });
      },
      update: function() {
        if (pad2 && typeof pad2.update === "function") pad2.update();
      }
    };
  }

  // src/static/sdk-libs/phaser/tileworld-tiles.js
  var DRAW_KINDS = [
    "floor",
    "grass",
    "water",
    "bridge",
    "wall",
    "tree",
    "door",
    "chest",
    "canopy",
    "canopytop"
  ];
  function mix2(from, to, k) {
    const t = Math.max(0, Math.min(1, k));
    const channel = function(shift) {
      const a = from >> shift & 255;
      const b = to >> shift & 255;
      return Math.round(a + (b - a) * t);
    };
    return channel(16) << 16 | channel(8) << 8 | channel(0);
  }
  function shade3(colour, amount) {
    const end = amount >= 0 ? 255 : 0;
    const target = end << 16 | end << 8 | end;
    return mix2(colour, target, Math.abs(amount));
  }
  function gauge(s) {
    return { edge: Math.max(2, Math.round(s / 8)), dot: Math.max(1, Math.round(s / 16)) };
  }
  function drawFloor(g, left, s, th) {
    const d = gauge(s).dot;
    g.fillStyle(th.surface, 1).fillRect(left, 0, s, s);
    g.fillStyle(th.line, 1);
    g.fillRect(left + s * 0.28, s * 0.34, d, d);
    g.fillRect(left + s * 0.66, s * 0.7, d, d);
    g.fillRect(left + s * 0.52, s * 0.14, d, d);
  }
  function drawGrass(g, left, s, th) {
    const d = gauge(s).dot;
    drawFloor(g, left, s, th);
    g.fillStyle(mix2(th.ok, th.surface, 0.3), 1);
    g.fillRect(left + s * 0.2, s * 0.5, d, d * 3);
    g.fillRect(left + s * 0.42, s * 0.22, d, d * 3);
    g.fillRect(left + s * 0.68, s * 0.58, d, d * 3);
    g.fillRect(left + s * 0.3, s * 0.78, d, d * 2);
    g.fillRect(left + s * 0.78, s * 0.3, d, d * 2);
  }
  function drawWater(g, left, s, th) {
    const d = gauge(s).dot;
    g.fillStyle(shade3(th.ch1, -0.42), 1).fillRect(left, 0, s, s);
    g.fillStyle(shade3(th.ch1, 0.05), 1);
    g.fillRect(left + s * 0.12, s * 0.3, s * 0.42, d);
    g.fillRect(left + s * 0.5, s * 0.66, s * 0.38, d);
  }
  function drawBridge(g, left, s, th) {
    const e = gauge(s).edge;
    const rail = Math.max(1, Math.round(e / 3));
    drawWater(g, left, s, th);
    g.fillStyle(th.warn, 1).fillRect(left, e / 2, s, s - e);
    g.fillStyle(shade3(th.warn, -0.35), 1);
    g.fillRect(left, s / 3, s, 1);
    g.fillRect(left, s * 2 / 3, s, 1);
    g.fillRect(left, e / 2, s, rail);
    g.fillRect(left, s - e / 2 - rail, s, rail);
  }
  function drawWall(g, left, s, th) {
    g.fillStyle(th.inkDim, 1).fillRect(left, 0, s, s);
    g.fillStyle(shade3(th.inkDim, -0.4), 1);
    g.fillRect(left, s / 2 - 1, s, 2);
    g.fillRect(left + s / 2 - 1, 0, 2, s / 2);
    g.fillRect(left + s / 4 - 1, s / 2, 2, s / 2);
    g.fillRect(left + s * 3 / 4 - 1, s / 2, 2, s / 2);
    g.fillStyle(shade3(th.inkDim, 0.22), 1).fillRect(left, 0, s, 2);
  }
  function drawTree(g, left, s, th) {
    const trunk = Math.max(3, Math.round(s * 0.22));
    drawFloor(g, left, s, th);
    g.fillStyle(shade3(th.ok, -0.5), 0.35).fillCircle(left + s / 2, s * 0.62, s * 0.38);
    g.fillStyle(shade3(th.warn, -0.3), 1).fillRect(left + s / 2 - trunk / 2, s * 0.4, trunk, s * 0.6);
    g.fillStyle(th.warn, 1).fillRect(left + s / 2 - trunk / 2, s * 0.4, Math.max(1, Math.round(trunk / 3)), s * 0.6);
  }
  function drawCanopy(g, left, s, th) {
    g.fillStyle(shade3(th.ok, -0.12), 1).fillCircle(left + s / 2, s * 0.16, s * 0.5);
    g.fillStyle(shade3(th.ok, 0.12), 1).fillCircle(left + s / 2 - s * 0.14, s * 0.04, s * 0.2);
  }
  function drawCanopyTop(g, left, s, th) {
    g.fillStyle(shade3(th.ok, -0.12), 1).fillCircle(left + s / 2, s * 1.16, s * 0.5);
    g.fillStyle(shade3(th.ok, 0.12), 1).fillCircle(left + s / 2 - s * 0.14, s * 1.04, s * 0.2);
  }
  function drawDoor(g, left, s, th) {
    const e = gauge(s).edge;
    const d = gauge(s).dot;
    drawFloor(g, left, s, th);
    g.fillStyle(shade3(th.warn, -0.45), 1).fillRect(left + e / 2, e / 2, s - e, s - e);
    g.fillStyle(th.warn, 1).fillRect(left + e, e, s - 2 * e, s - 2 * e);
    g.fillStyle(shade3(th.warn, -0.3), 1).fillRect(left + s / 2 - 1, e, 2, s - 2 * e);
    g.fillStyle(shade3(th.warn, 0.45), 1).fillCircle(left + s * 0.62, s * 0.5, d + 1);
  }
  function drawChest(g, left, s, th) {
    const d = gauge(s).dot;
    const radius = Math.max(2, Math.round(s / 12));
    drawFloor(g, left, s, th);
    g.fillStyle(shade3(th.warn, -0.4), 1).fillRect(left + s * 0.15, s * 0.3, s * 0.7, s * 0.52);
    g.fillStyle(th.warn, 1).fillRoundedRect(left + s * 0.15, s * 0.25, s * 0.7, s * 0.5, radius);
    g.fillStyle(shade3(th.warn, -0.4), 1).fillRect(left + s * 0.15, s * 0.45, s * 0.7, 1);
    g.fillStyle(th.ch3, 1).fillRect(left + s / 2 - d, s * 0.41, d * 2, d * 2 + 1);
  }
  function drawBlock(g, left, s, th) {
    const e = gauge(s).edge;
    g.fillStyle(th.accent, 1).fillRect(left, 0, s, s);
    g.fillStyle(shade3(th.accent, 0.3), 1).fillRect(left, 0, s, e);
    g.fillStyle(shade3(th.accent, -0.3), 1).fillRect(left, s - Math.round(e / 2), s, Math.round(e / 2));
  }
  var DRAW = {
    floor: drawFloor,
    grass: drawGrass,
    water: drawWater,
    bridge: drawBridge,
    wall: drawWall,
    tree: drawTree,
    door: drawDoor,
    chest: drawChest,
    canopy: drawCanopy,
    canopytop: drawCanopyTop
  };
  function tileStrip(scene, kinds, size, th) {
    const list = kinds.slice();
    const key = "ak-tileworld-" + size + "-" + list.join(".");
    const index = {};
    for (let i = 0; i < list.length; i++) index[list[i]] = i;
    if (!scene.textures.exists(key)) {
      const g = scene.make.graphics({ add: false });
      for (let i = 0; i < list.length; i++) (DRAW[list[i]] || drawBlock)(g, i * size, size, th);
      g.generateTexture(key, size * list.length, size);
      g.destroy();
    }
    return { key, index, count: list.length };
  }
  function marker(scene, size, th) {
    const key = "ak-tileworld-marker-" + size;
    if (!scene.textures.exists(key)) {
      const d = gauge(size).dot;
      const g = scene.make.graphics({ add: false });
      g.fillStyle(th.ink, 1).fillCircle(size / 2, size / 2, size * 0.34);
      g.fillStyle(th.accent, 1).fillCircle(size / 2, size / 2, size * 0.28);
      g.fillStyle(th.surface, 1).fillCircle(size * 0.6, size * 0.44, Math.max(1.5, d));
      g.generateTexture(key, size, size);
      g.destroy();
    }
    return key;
  }
  function minimapTone(th, kind, solid) {
    if (kind === "water") return shade3(th.ch1, -0.25);
    if (kind === "tree") return shade3(th.ok, -0.15);
    if (kind === "bridge" || kind === "door") return th.warn;
    if (kind === "chest") return th.ch3;
    if (solid) return th.inkDim;
    return th.line;
  }
  function markTone(th, kind) {
    if (kind === "enemy") return th.err;
    if (kind === "npc") return th.ok;
    if (kind === "chest") return th.ch3;
    if (kind === "door") return th.warn;
    return th.accent;
  }

  // src/static/sdk-libs/phaser/tileworld-minimap.js
  var MINIMAP_DEPTH = 940;
  var made = 0;
  function minimap(scene, world, opts) {
    const o = opts || /** @type {MinimapOptions} */
    {};
    const th = o.theme || look(scene);
    const b = world.bounds;
    const cols = Math.max(1, b.cols);
    const rows = Math.max(1, b.rows);
    const size = Math.max(1, typeof o.size === "number" ? o.size : 140);
    const cell = typeof o.scale === "number" && o.scale > 0 ? o.scale : size / Math.max(cols, rows);
    const w = Math.ceil(cols * cell);
    const h = Math.ceil(rows * cell);
    const pad2 = typeof o.pad === "number" ? o.pad : 10;
    const depth = typeof o.depth === "number" ? o.depth : MINIMAP_DEPTH;
    const corner = o.corner || "tr";
    const marks = Array.isArray(o.marks) ? o.marks : [];
    const showPlayer = o.showPlayer !== false;
    const id = ++made;
    let version = 0;
    let key = "";
    let gone = false;
    const origin = { x: 0, y: 0 };
    function zoom() {
      const cam = scene.cameras && scene.cameras.main;
      return cam && cam.zoom > 0 ? cam.zoom : 1;
    }
    function draw2() {
      version += 1;
      const next = "ak-minimap-" + id + "-" + version;
      const g = scene.make.graphics({ add: false });
      const box2 = Math.ceil(cell);
      const dots2 = [];
      g.fillStyle(th.surface, 0.92).fillRect(0, 0, w + 2, h + 2);
      g.fillStyle(th.line, 1).fillRect(1, 1, w, h);
      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const mark = world.tileAt(tx, ty);
          const kind = world.legend[mark] || "";
          if (marks.indexOf(mark) >= 0) dots2.push({ tx, ty, kind });
          const tone6 = minimapTone(th, kind, !world.walkable(tx, ty));
          if (tone6 === th.line) continue;
          g.fillStyle(tone6, 1).fillRect(1 + tx * cell, 1 + ty * cell, box2, box2);
        }
      }
      const r = Math.max(1.5, cell * 0.6);
      for (const d of dots2) {
        g.fillStyle(markTone(th, d.kind), 1).fillCircle(1 + (d.tx + 0.5) * cell, 1 + (d.ty + 0.5) * cell, r);
      }
      g.lineStyle(1, th.line, 1).strokeRect(0.5, 0.5, w + 1, h + 1);
      g.generateTexture(next, w + 2, h + 2);
      g.destroy();
      return next;
    }
    key = draw2();
    const image = scene.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0).setDepth(depth);
    const dot = scene.add.graphics().setScrollFactor(0).setDepth(depth + 1);
    const radius = Math.max(2, cell * 0.8);
    dot.fillStyle(th.ink, 1).fillCircle(0, 0, radius + 1);
    dot.fillStyle(th.accent, 1).fillCircle(0, 0, radius);
    dot.setVisible(showPlayer);
    function place() {
      const z = zoom();
      const vw = scene.scale.width;
      const vh = scene.scale.height;
      const sx = corner.indexOf("r") >= 0 ? vw - pad2 - (w + 2) : pad2;
      const sy = corner.indexOf("b") >= 0 ? vh - pad2 - (h + 2) : pad2;
      origin.x = vw / 2 + (sx - vw / 2) / z;
      origin.y = vh / 2 + (sy - vh / 2) / z;
      image.setPosition(origin.x, origin.y).setScale(1 / z);
    }
    function follow() {
      if (gone || !dot.visible) return;
      const p = world.player;
      if (!p) return;
      const z = zoom();
      dot.setPosition(
        origin.x + (1 + p.x / b.tileWidth * cell) / z,
        origin.y + (1 + p.y / b.tileHeight * cell) / z
      ).setScale(1 / z);
    }
    place();
    follow();
    scene.events.on("postupdate", follow);
    const api = {
      image,
      dot,
      refresh() {
        if (gone) return;
        const old = key;
        key = draw2();
        image.setTexture(key);
        place();
        follow();
        if (old !== key && scene.textures.exists(old)) scene.textures.remove(old);
      },
      toggle(on) {
        if (gone) return false;
        const show = typeof on === "boolean" ? on : !image.visible;
        image.setVisible(show);
        dot.setVisible(show && showPlayer);
        return show;
      },
      destroy() {
        if (gone) return;
        gone = true;
        scene.events.off("postupdate", follow);
        scene.events.off("shutdown", api.destroy);
        image.destroy();
        dot.destroy();
        if (scene.textures && scene.textures.exists(key)) scene.textures.remove(key);
      }
    };
    scene.events.once("shutdown", api.destroy);
    return api;
  }

  // src/static/sdk-libs/phaser/tileworld.js
  var DEFAULT_LEGEND2 = {
    "#": "wall",
    ".": "floor",
    "~": "water",
    T: "tree",
    D: "door",
    C: "chest",
    P: "spawn",
    E: "enemy",
    N: "npc",
    "=": "bridge",
    ",": "grass"
  };
  var KIND = {
    floor: { layer: "floor" },
    grass: { layer: "floor" },
    water: { layer: "floor" },
    bridge: { layer: "floor" },
    wall: { layer: "walls", solid: true },
    tree: { layer: "walls", solid: true },
    door: { layer: "decor", object: true },
    chest: { layer: "decor", object: true },
    spawn: { layer: null },
    enemy: { layer: null, object: true },
    npc: { layer: null, object: true }
  };
  var OWN_KIND = { layer: "walls", solid: true };
  var UNDER_CANOPY = { floor: true, grass: true, bridge: true, spawn: true, enemy: true, npc: true };
  var LAYER_NAMES = ["floor", "decor", "walls", "overhead"];
  var GROUND_DEPTH = -10;
  var OVERHEAD_DEPTH = 5;
  var FIRST_GID = 1;
  var WATER_SPEED = 0.5;
  var DEADZONE_SHARE = 0.25;
  var FOLLOW_LERP = 0.1;
  function warn(text) {
    console.warn("[aimeat-phaser] tileWorld: " + text);
  }
  function property(props, name) {
    if (Array.isArray(props)) {
      for (const p of props) if (p && p.name === name) return p.value;
      return void 0;
    }
    return props && typeof props === "object" ? props[name] : void 0;
  }
  function parseRows(rows, legend) {
    const lines = Array.isArray(rows) && rows.length ? rows : ["."];
    let cols = 1;
    for (const line of lines) cols = Math.max(cols, String(line == null ? "" : line).length);
    const marks = [];
    const strays = {};
    for (let y = 0; y < lines.length; y++) {
      const line = String(lines[y] == null ? "" : lines[y]);
      const row = [];
      for (let x = 0; x < cols; x++) {
        let mark = x < line.length ? line.charAt(x) : ".";
        if (mark === " ") mark = ".";
        if (!legend[mark]) {
          strays[mark] = true;
          mark = ".";
        }
        row.push(mark);
      }
      marks.push(row);
    }
    const unknown = Object.keys(strays);
    if (unknown.length) {
      warn("the map uses marks the legend does not name (" + unknown.join(" ") + "); each was read as floor. Name them in spec.legend, mark → kind.");
    }
    return { cols, rows: lines.length, marks };
  }
  function buildAscii(scene, s, th) {
    const legend = Object.assign({}, DEFAULT_LEGEND2, s.legend || {});
    const tile = s.tile || 32;
    const waterBlocks = s.water !== "slow";
    const parsed = parseRows(s.map, legend);
    const cols = parsed.cols;
    const rows = parsed.rows;
    const marks = parsed.marks;
    function solid(kind) {
      const info = KIND[kind];
      if (!info) return true;
      if (kind === "water") return waterBlocks;
      return !!info.solid;
    }
    const kinds = DRAW_KINDS.slice();
    for (const mark in legend) {
      const kind = legend[mark];
      if (!KIND[kind] && kinds.indexOf(kind) < 0) kinds.push(kind);
    }
    const strip2 = tileStrip(scene, kinds, tile, th);
    const map = scene.make.tilemap({ tileWidth: tile, tileHeight: tile, width: cols, height: rows });
    const tileset = map.addTilesetImage("ak-tileworld", strip2.key, tile, tile, 0, 0, FIRST_GID);
    const layers = {};
    const order = [];
    for (let i = 0; i < LAYER_NAMES.length; i++) {
      const name = LAYER_NAMES[i];
      const layer = map.createBlankLayer(name, tileset);
      layer.setDepth(name === "overhead" ? OVERHEAD_DEPTH : GROUND_DEPTH + i);
      layers[name] = layer;
      order.push(layer);
    }
    const collideIndexes = [];
    for (const mark in legend) {
      const index = strip2.index[legend[mark]] + FIRST_GID;
      if (solid(legend[mark]) && collideIndexes.indexOf(index) < 0) collideIndexes.push(index);
    }
    layers.walls.setCollision(collideIndexes, true, false);
    function inside(tx, ty) {
      return tx >= 0 && ty >= 0 && tx < cols && ty < rows;
    }
    function kindAt(tx, ty) {
      return legend[marks[ty][tx]] || "floor";
    }
    function slot(kind) {
      return strip2.index[kind] + FIRST_GID;
    }
    function paint2(tx, ty, faces) {
      const kind = kindAt(tx, ty);
      const info = KIND[kind] || OWN_KIND;
      const below = ty + 1 < rows ? kindAt(tx, ty + 1) : "";
      layers.floor.putTileAt(slot(info.layer === "floor" ? kind : "floor"), tx, ty, faces);
      layers.decor.putTileAt(info.layer === "decor" ? slot(kind) : -1, tx, ty, faces);
      layers.walls.putTileAt(solid(kind) ? slot(kind) : -1, tx, ty, faces);
      let over = -1;
      if (kind === "tree") over = slot("canopy");
      else if (below === "tree" && UNDER_CANOPY[kind]) over = slot("canopytop");
      layers.overhead.putTileAt(over, tx, ty, faces);
    }
    for (let ty = 0; ty < rows; ty++) for (let tx = 0; tx < cols; tx++) paint2(tx, ty, false);
    layers.walls.calculateFacesWithin(0, 0, cols, rows);
    const objects = [];
    let spawn2 = null;
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const kind = kindAt(tx, ty);
        if (KIND[kind] && KIND[kind].object) objects.push({ tx, ty, mark: marks[ty][tx] });
        if (kind === "spawn" && !spawn2) spawn2 = { tx, ty };
      }
    }
    return {
      map,
      layers,
      order,
      blocking: [layers.walls],
      cols,
      rows,
      tileWidth: tile,
      tileHeight: tile,
      legend,
      spawn: spawn2,
      objects,
      tileAt(tx, ty) {
        return inside(tx, ty) ? marks[ty][tx] : "";
      },
      kindAt(tx, ty) {
        return inside(tx, ty) ? kindAt(tx, ty) : "";
      },
      walkable(tx, ty) {
        return inside(tx, ty) && !solid(kindAt(tx, ty));
      },
      set(tx, ty, mark) {
        if (!inside(tx, ty)) return false;
        if (!legend[mark]) {
          warn('"' + mark + '" is not in the legend; set() left the cell alone.');
          return false;
        }
        marks[ty][tx] = mark;
        paint2(tx, ty, true);
        if (ty > 0) paint2(tx, ty - 1, true);
        return true;
      }
    };
  }
  function buildTiled(scene, s) {
    const legend = Object.assign({}, DEFAULT_LEGEND2, s.legend || {});
    const map = scene.make.tilemap({ key: s.tiled });
    const wanted = Array.isArray(s.tileset) ? s.tileset : s.tileset ? [s.tileset] : [];
    const sets = [];
    for (const t of wanted) {
      const set = t && map.addTilesetImage(t.name, t.image);
      if (set) sets.push(set);
    }
    if (!sets.length) {
      warn('the Tiled map "' + s.tiled + '" has no tileset image. Pass tileset: { name, image }, the name from the Tiled file and the key of the image the pack loaded.');
    }
    const marks = s.marks || {};
    const reverse = {};
    for (const index in marks) reverse[String(marks[index])] = Number(index);
    const collidesList = Array.isArray(s.collides) ? s.collides : [];
    const overheadList = Array.isArray(s.overhead) ? s.overhead : ["overhead"];
    const cols = map.width;
    const rows = map.height;
    let last = FIRST_GID;
    for (const set of map.tilesets || []) {
      last = Math.max(last, (set.firstgid || FIRST_GID) + (set.total || 0) - 1);
    }
    const layers = {};
    const order = [];
    const blocking = [];
    let overheads = 0;
    const data = map.layers || [];
    for (let i = 0; i < data.length; i++) {
      const ld = data[i];
      const layer = map.createLayer(ld.name, sets, 0, 0);
      if (!layer) continue;
      const over = overheadList.indexOf(ld.name) >= 0 || property(ld.properties, "overhead") === true;
      layer.setDepth(over ? OVERHEAD_DEPTH + overheads++ : GROUND_DEPTH + i);
      layers[ld.name] = layer;
      order.push(layer);
      const blocks = collidesList.indexOf(ld.name) >= 0 || property(ld.properties, "collides") === true;
      if (blocks) layer.setCollisionBetween(FIRST_GID, last, true, false);
      else layer.setCollisionByProperty({ collides: true }, true, false);
      const found = layer.layer && Array.isArray(layer.layer.collideIndexes) && layer.layer.collideIndexes.length > 0;
      if (blocks || found) {
        layer.calculateFacesWithin(0, 0, cols, rows);
        blocking.push(layer);
      }
    }
    function inside(tx, ty) {
      return tx >= 0 && ty >= 0 && tx < cols && ty < rows;
    }
    function top2(tx, ty) {
      for (let i = order.length - 1; i >= 0; i--) {
        const t = order[i].getTileAt(tx, ty);
        if (t && t.index > -1) return { tile: t, layer: order[i] };
      }
      return null;
    }
    function walkable(tx, ty) {
      if (!inside(tx, ty)) return false;
      for (const layer of blocking) {
        const t = layer.getTileAt(tx, ty);
        if (t && t.index > -1 && t.collides) return false;
      }
      return true;
    }
    function tileAt(tx, ty) {
      if (!inside(tx, ty)) return "";
      for (let i = order.length - 1; i >= 0; i--) {
        const t = order[i].getTileAt(tx, ty);
        if (t && t.index > -1 && marks[t.index] != null) return String(marks[t.index]);
      }
      return walkable(tx, ty) ? "." : "#";
    }
    function kindAt(tx, ty) {
      const mark = tileAt(tx, ty);
      return mark ? legend[mark] || "" : "";
    }
    function target(tx, ty) {
      const t = top2(tx, ty);
      if (t && order.indexOf(t.layer) > 0) return t.layer;
      for (let i = order.length - 1; i >= 0; i--) if (order[i].depth < OVERHEAD_DEPTH) return order[i];
      return order[0] || null;
    }
    const objects = [];
    let spawn2 = null;
    if (Object.keys(marks).length) {
      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const mark = tileAt(tx, ty);
          const kind = legend[mark];
          if (KIND[kind] && KIND[kind].object) objects.push({ tx, ty, mark });
          if (kind === "spawn" && !spawn2) spawn2 = { tx, ty };
        }
      }
    }
    return {
      map,
      layers,
      order,
      blocking,
      cols,
      rows,
      tileWidth: map.tileWidth,
      tileHeight: map.tileHeight,
      legend,
      spawn: spawn2,
      objects,
      tileAt,
      kindAt,
      walkable,
      set(tx, ty, mark, layerName) {
        if (!inside(tx, ty)) return false;
        let layer = layerName ? layers[layerName] : null;
        if (layerName && !layer) {
          warn('the Tiled map has no layer "' + layerName + '"; set() left the cell alone.');
          return false;
        }
        if (!layer) layer = target(tx, ty);
        if (!layer) return false;
        let index = -1;
        if (mark !== ".") {
          if (reverse[mark] == null) {
            warn('"' + mark + '" has no tile index in spec.marks; set() left the cell alone.');
            return false;
          }
          index = reverse[mark];
        }
        layer.putTileAt(index, tx, ty, true);
        return true;
      }
    };
  }
  function tileWorld(scene, spec) {
    const s = spec || /** @type {TileWorldSpec} */
    {};
    const th = s.theme || look(scene);
    if (!s.tiled && !Array.isArray(s.map)) {
      warn("nothing to build from: pass map (ASCII rows) or tiled (a loaded map key). A one-cell floor stands in.");
    }
    const w = s.tiled ? buildTiled(scene, s) : buildAscii(scene, s, th);
    const tw = w.tileWidth;
    const tHeight = w.tileHeight;
    const pxW = w.cols * tw;
    const pxH = w.rows * tHeight;
    let gone = false;
    let cache = null;
    function toWorld(tx, ty) {
      return { x: tx * tw + tw / 2, y: ty * tHeight + tHeight / 2 };
    }
    function toTile(x, y) {
      return { x: Math.floor(x / tw), y: Math.floor(y / tHeight) };
    }
    let cell = w.spawn;
    if (!cell) {
      for (let ty = 0; ty < w.rows && !cell; ty++) {
        for (let tx = 0; tx < w.cols; tx++) {
          if (w.walkable(tx, ty)) {
            cell = { tx, ty };
            break;
          }
        }
      }
    }
    if (!cell) cell = { tx: 0, ty: 0 };
    const start = toWorld(cell.tx, cell.ty);
    const spawn2 = { x: start.x, y: start.y, tx: cell.tx, ty: cell.ty };
    const physics = scene.physics && scene.physics.world ? scene.physics : null;
    if (s.bounds !== false && physics) physics.world.setBounds(0, 0, pxW, pxH);
    let player = s.player || null;
    let ownPlayer = false;
    if (!player && physics) {
      const key = marker(scene, Math.min(tw, tHeight), th);
      player = physics.add.sprite(spawn2.x, spawn2.y, key);
      player.setCollideWorldBounds(s.bounds !== false);
      if (player.body && typeof player.body.setSize === "function") {
        player.body.setSize(tw * 0.6, tHeight * 0.6, true);
      }
      ownPlayer = true;
    }
    const colliders = [];
    if (player && physics) {
      for (const layer of w.blocking) colliders.push(physics.add.collider(player, layer));
    }
    const cam = scene.cameras && scene.cameras.main ? scene.cameras.main : null;
    let following = false;
    if (cam) {
      if (typeof s.zoom === "number" && s.zoom > 0) cam.setZoom(s.zoom);
      if (s.camera !== "fixed" && player) {
        if (s.bounds !== false) cam.setBounds(0, 0, pxW, pxH);
        const lerp = typeof s.lerp === "number" ? s.lerp : FOLLOW_LERP;
        cam.startFollow(player, true, lerp, lerp);
        if (s.deadzone !== false) {
          const dz = s.deadzone || {};
          cam.setDeadzone(
            dz.width || Math.round(cam.width * DEADZONE_SHARE),
            dz.height || Math.round(cam.height * DEADZONE_SHARE)
          );
        }
        following = true;
      }
    }
    let slow = null;
    if (s.water === "slow" && player) {
      const keep = typeof s.waterSpeed === "number" ? Math.max(0, Math.min(1, s.waterSpeed)) : WATER_SPEED;
      slow = function() {
        const body = player.body;
        if (!body || !body.velocity) return;
        const t = toTile(player.x, player.y);
        if (w.kindAt(t.x, t.y) !== "water") return;
        body.velocity.x *= keep;
        body.velocity.y *= keep;
      };
      scene.events.on("postupdate", slow);
    }
    if (typeof s.objects === "function") {
      for (const o of w.objects) {
        const p = toWorld(o.tx, o.ty);
        s.objects(p.x, p.y, o.mark, o.tx, o.ty);
      }
    }
    const api = {
      map: w.map,
      layers: w.layers,
      player,
      spawn: spawn2,
      bounds: {
        x: 0,
        y: 0,
        width: pxW,
        height: pxH,
        cols: w.cols,
        rows: w.rows,
        tileWidth: tw,
        tileHeight: tHeight
      },
      legend: w.legend,
      at(x, y) {
        const t = toTile(x, y);
        return w.tileAt(t.x, t.y);
      },
      tileAt(tx, ty) {
        return w.tileAt(tx, ty);
      },
      set(tx, ty, mark, layerName) {
        if (gone) return false;
        const ok = w.set(tx, ty, mark, layerName);
        if (ok) cache = null;
        return ok;
      },
      walkable(tx, ty) {
        return w.walkable(tx, ty);
      },
      grid() {
        if (cache) return cache;
        const rows = [];
        for (let ty = 0; ty < w.rows; ty++) {
          const row = [];
          for (let tx = 0; tx < w.cols; tx++) row.push(w.walkable(tx, ty));
          rows.push(row);
        }
        cache = rows;
        return rows;
      },
      toWorld,
      toTile,
      destroy() {
        if (gone) return;
        gone = true;
        scene.events.off("shutdown", api.destroy);
        if (slow) scene.events.off("postupdate", slow);
        if (cam && following && typeof cam.stopFollow === "function") cam.stopFollow();
        const world = scene.physics && scene.physics.world;
        if (world && typeof world.removeCollider === "function") {
          for (const c of colliders) world.removeCollider(c);
        }
        colliders.length = 0;
        for (const layer of w.order) if (layer && typeof layer.destroy === "function") layer.destroy();
        if (w.map && typeof w.map.destroy === "function") w.map.destroy();
        if (ownPlayer && player && typeof player.destroy === "function") player.destroy();
        cache = null;
      }
    };
    scene.events.once("shutdown", api.destroy);
    return api;
  }

  // src/static/sdk-libs/phaser/status-parts.js
  var RING_R = 17;
  var RING_GAP = 10;
  var RING_LINE = 3;
  var CHIP_H = 22;
  var CHIP_GAP = 6;
  var QUEST_TITLE = 14;
  var QUEST_STEP = 12;
  var QUEST_BOX = 10;
  var STILL_STEPS = 8;
  var TONE_KEYS = {
    ok: "ok",
    warn: "warn",
    err: "err",
    accent: "accent",
    ink: "ink",
    dim: "inkDim",
    ch1: "ch1",
    ch2: "ch2",
    ch3: "ch3",
    ch4: "ch4"
  };
  function toneColour(th, want, fallback) {
    if (typeof want === "number" && isFinite(want)) return want;
    const key = typeof want === "string" ? TONE_KEYS[want] : void 0;
    return key && typeof th[key] === "number" ? th[key] : fallback;
  }
  function motionPool(scene) {
    const flying = /* @__PURE__ */ new Set();
    return {
      run(config) {
        const after = config.onComplete;
        let t = null;
        config.onComplete = function() {
          if (t) flying.delete(t);
          if (typeof after === "function") after();
        };
        t = scene.tweens.add(config);
        flying.add(t);
        return t;
      },
      stop(target) {
        scene.tweens.killTweensOf(target);
        for (const t of Array.from(flying)) {
          if (t && Array.isArray(t.targets) && t.targets.indexOf(target) >= 0) flying.delete(t);
        }
      },
      killAll() {
        for (const t of flying) {
          if (!t) continue;
          if (typeof t.remove === "function") t.remove();
          else if (typeof t.stop === "function") t.stop();
        }
        flying.clear();
      }
    };
  }
  function num(v, fallback) {
    return typeof v === "number" && isFinite(v) ? v : fallback;
  }
  function glyph(scene, th, what, size, colour) {
    const key = what == null ? "" : String(what);
    if (key && scene.textures && scene.textures.exists(key)) {
      const img = scene.add.image(0, 0, key);
      img.setScale(size / Math.max(1, img.width, img.height));
      return img;
    }
    return scene.add.text(0, 0, key.slice(0, 2), {
      fontFamily: th.fontDisplay,
      fontSize: Math.round(size * 0.62) + "px",
      color: hex(colour)
    }).setOrigin(0.5, 0.5);
  }
  function cooldownRings(ctx, box2, specs) {
    const scene = ctx.scene;
    const th = ctx.th;
    const pool = ctx.pool;
    const rings = [];
    function drawRing(r) {
      const g = r.ring;
      g.clear();
      if (r.ready) {
        g.lineStyle(RING_LINE, r.tone, 1);
        g.strokeCircle(0, 0, RING_R);
        return;
      }
      const share = ctx.still ? Math.ceil(r.state.p * STILL_STEPS) / STILL_STEPS : r.state.p;
      if (share <= 0) return;
      g.lineStyle(RING_LINE, th.inkDim, 1);
      g.beginPath();
      g.arc(0, 0, RING_R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share, false);
      g.strokePath();
    }
    function buildRing(c, i) {
      const tone6 = toneColour(th, c.tone, th.accent);
      const cell = scene.add.container(i * (RING_R * 2 + RING_GAP) + RING_R, RING_R);
      const back = scene.add.graphics();
      back.fillStyle(th.surface, 0.9);
      back.fillCircle(0, 0, RING_R);
      back.lineStyle(1, th.line, 1);
      back.strokeCircle(0, 0, RING_R);
      const ring2 = scene.add.graphics();
      const mark = glyph(scene, th, c.icon != null ? c.icon : c.id.charAt(0), RING_R * 1.1, th.ink);
      cell.add([back, ring2, mark]);
      box2.add(cell);
      const r = { id: c.id, spec: c, tone: tone6, box: cell, ring: ring2, mark, state: { p: 0 }, ready: true };
      rings.push(r);
      drawRing(r);
    }
    (specs || []).forEach(function(c, i) {
      if (c && c.id) buildRing(c, i);
    });
    function ringOf(id) {
      for (const r of rings) if (r.id === id) return r;
      return null;
    }
    function becomeReady(r, pop) {
      r.ready = true;
      r.state.p = 0;
      r.mark.setAlpha(1);
      drawRing(r);
      if (!pop || ctx.still) return;
      pool.run({
        targets: r.box,
        scale: 1.16,
        duration: Math.max(60, ctx.pace * 0.6),
        yoyo: true,
        ease: "Quad.easeOut",
        onComplete: function() {
          r.box.setScale(1);
        }
      });
    }
    const api = {
      /** Start draining, for ms or for the spec's length. A ring already cooling starts over. */
      start(id, msWanted) {
        const r = ringOf(id);
        if (!r || !ctx.alive()) return false;
        const span2 = Math.max(16, num(msWanted, num(r.spec.ms, 1e3)));
        pool.stop(r.state);
        r.ready = false;
        r.state.p = 1;
        r.mark.setAlpha(0.5);
        drawRing(r);
        pool.run({
          targets: r.state,
          p: 0,
          duration: span2,
          ease: "Linear",
          onUpdate: function() {
            drawRing(r);
          },
          onComplete: function() {
            becomeReady(r, true);
          }
        });
        return true;
      },
      ready(id) {
        const r = ringOf(id);
        return !!(r && r.ready);
      },
      /** Make it ready now, with no pop: the game granted it rather than the clock. */
      reset(id) {
        const r = ringOf(id);
        if (!r || !ctx.alive()) return false;
        pool.stop(r.state);
        becomeReady(r, false);
        return true;
      }
    };
    return {
      api,
      width: rings.length ? rings.length * (RING_R * 2 + RING_GAP) - RING_GAP : 0,
      height: RING_R * 2
    };
  }
  function buffChips(ctx, box2) {
    const scene = ctx.scene;
    const th = ctx.th;
    const pool = ctx.pool;
    const chips = [];
    let rightSide = true;
    function chipOf(id) {
      for (const c of chips) if (c.id === id) return c;
      return null;
    }
    function place() {
      let y = 0;
      for (const c of chips) {
        y -= CHIP_H;
        c.box.setPosition(rightSide ? -c.w : 0, y);
        y -= CHIP_GAP;
      }
    }
    function drawDrain(c) {
      const share = ctx.still ? Math.ceil(c.state.p * STILL_STEPS) / STILL_STEPS : c.state.p;
      c.drain.clear();
      const w = Math.round((c.w - 12) * Math.max(0, Math.min(1, share)));
      if (w < 1) return;
      c.drain.fillStyle(c.tone, 1);
      c.drain.fillRect(6, CHIP_H - 4, w, 2);
    }
    function dropChip(c, now) {
      const at = chips.indexOf(c);
      if (at >= 0) chips.splice(at, 1);
      pool.stop(c.state);
      pool.stop(c.box);
      place();
      if (now || ctx.still) {
        c.box.destroy(true);
        return;
      }
      pool.run({ targets: c.box, alpha: 0, duration: Math.max(80, ctx.pace), onComplete: function() {
        c.box.destroy(true);
      } });
    }
    const api = {
      /** Show a chip for ms; the same id again restarts it. Returns the chip's container. */
      add(id, b) {
        if (!ctx.alive()) return null;
        const o = b && typeof b === "object" ? b : {};
        const key = String(id);
        const had = chipOf(key);
        if (had) dropChip(had, true);
        const tone6 = toneColour(th, o.tone, th.accent);
        const label = scene.add.text(8, CHIP_H / 2 - 1, o.label != null ? String(o.label) : key, {
          fontFamily: th.fontMono,
          fontSize: "11px",
          color: hex(th.ink)
        }).setOrigin(0, 0.5);
        const w = Math.ceil(label.width) + 16;
        const pill = scene.add.graphics();
        pill.fillStyle(th.surface, 0.94);
        pill.fillRoundedRect(0, 0, w, CHIP_H, CHIP_H / 2);
        pill.lineStyle(1, tone6, 1);
        pill.strokeRoundedRect(0, 0, w, CHIP_H, CHIP_H / 2);
        const drain = scene.add.graphics();
        const chip = scene.add.container(0, 0, [pill, drain, label]);
        box2.add(chip);
        const c = { id: key, box: chip, w, drain, tone: tone6, state: { p: 1 } };
        chips.push(c);
        drawDrain(c);
        place();
        pool.run({
          targets: c.state,
          p: 0,
          duration: Math.max(16, num(o.ms, 3e3)),
          ease: "Linear",
          onUpdate: function() {
            drawDrain(c);
          },
          onComplete: function() {
            dropChip(c, false);
          }
        });
        return chip;
      },
      remove(id) {
        const c = chipOf(String(id));
        if (!c) return false;
        dropChip(c, true);
        return true;
      },
      has(id) {
        return !!chipOf(String(id));
      },
      clear() {
        for (const c of chips.slice()) dropChip(c, true);
      }
    };
    return {
      api,
      /** Which way the chips grow from the corner: leftward from a right corner, or rightward. */
      align(fromRight) {
        rightSide = fromRight !== false;
        place();
      }
    };
  }
  function questLog(ctx, box2, label) {
    const scene = ctx.scene;
    const th = ctx.th;
    const pool = ctx.pool;
    const caption = scene.add.text(0, 0, label, {
      fontFamily: th.fontMono,
      fontSize: "11px",
      color: hex(th.inkDim)
    }).setOrigin(0, 0).setVisible(false);
    box2.add(caption);
    const rows = [];
    function questOf(id) {
      for (const q of rows) if (q.id === id) return q;
      return null;
    }
    function drawSquare(g, size, done) {
      g.clear();
      if (done) {
        g.fillStyle(th.ok, 1);
        g.fillRoundedRect(0, 0, size, size, 2);
      } else {
        g.lineStyle(1, th.inkDim, 1);
        g.strokeRoundedRect(0, 0, size, size, 2);
      }
    }
    function paint2(q) {
      drawSquare(q.square, QUEST_BOX, q.rec.done);
      q.tick.setVisible(q.rec.done);
      q.title.setColor(hex(q.rec.done ? th.inkDim : th.ink));
      q.steps.forEach(function(st, i) {
        drawSquare(st.square, QUEST_BOX - 2, !!q.rec.steps[i].done);
      });
    }
    function height(q) {
      return QUEST_TITLE + 6 + q.steps.length * (QUEST_STEP + 5) + 6;
    }
    function place() {
      caption.setVisible(rows.length > 0);
      let y = rows.length ? 16 : 0;
      for (const q of rows) {
        q.box.setPosition(0, y);
        y += height(q);
      }
    }
    function norm(id, q) {
      const src = q && typeof q === "object" ? q : {};
      const steps = Array.isArray(src.steps) ? src.steps.map(function(st) {
        return { text: st && st.text != null ? String(st.text) : "", done: !!(st && st.done) };
      }) : [];
      return { id: String(id), title: src.title != null ? String(src.title) : String(id), done: !!src.done, steps };
    }
    function copy(rec) {
      return {
        id: rec.id,
        title: rec.title,
        done: rec.done,
        steps: rec.steps.map(function(st) {
          return { text: st.text, done: st.done };
        })
      };
    }
    function build2(rec, at) {
      const row = scene.add.container(0, 0);
      const square = scene.add.graphics().setPosition(0, 3);
      const tick = scene.add.text(QUEST_BOX / 2, 3 + QUEST_BOX / 2, "✓", {
        fontFamily: th.fontMono,
        fontSize: "11px",
        color: hex(th.surface)
      }).setOrigin(0.5, 0.5);
      const title = scene.add.text(QUEST_BOX + 8, 0, rec.title, {
        fontFamily: th.font,
        fontSize: QUEST_TITLE + "px",
        color: hex(th.ink)
      }).setOrigin(0, 0);
      row.add([square, tick, title]);
      const steps = rec.steps.map(function(st, i) {
        const y = QUEST_TITLE + 6 + i * (QUEST_STEP + 5);
        const sq = scene.add.graphics().setPosition(16, y + 3);
        const text = scene.add.text(16 + QUEST_BOX + 4, y, st.text, {
          fontFamily: th.font,
          fontSize: QUEST_STEP + "px",
          color: hex(th.inkDim)
        }).setOrigin(0, 0);
        row.add([sq, text]);
        return { square: sq };
      });
      box2.add(row);
      const q = { id: rec.id, rec, box: row, square, tick, title, steps };
      if (typeof at === "number" && at >= 0 && at < rows.length) rows.splice(at, 0, q);
      else rows.push(q);
      paint2(q);
      place();
      return q;
    }
    function drop(q) {
      const at = rows.indexOf(q);
      if (at >= 0) rows.splice(at, 1);
      pool.stop(q.tick);
      q.box.destroy(true);
      return at;
    }
    const api = {
      /** Add a quest, or replace one by the same id in its place. */
      set(id, q) {
        const rec = norm(id, q);
        if (!ctx.alive()) return rec;
        const had = questOf(rec.id);
        build2(rec, had ? drop(had) : -1);
        ctx.persist();
        return copy(rec);
      },
      /** Mark it done, every step with it, with one check-off. */
      complete(id) {
        const q = questOf(String(id));
        if (!q || !ctx.alive()) return false;
        const was = q.rec.done;
        q.rec.done = true;
        for (const st of q.rec.steps) st.done = true;
        paint2(q);
        if (!was && !ctx.still) {
          q.tick.setScale(0);
          pool.run({ targets: q.tick, scale: 1, duration: Math.max(80, ctx.pace * 1.2), ease: "Back.easeOut" });
        }
        ctx.persist();
        return true;
      },
      remove(id) {
        const q = questOf(String(id));
        if (!q || !ctx.alive()) return false;
        drop(q);
        place();
        ctx.persist();
        return true;
      },
      get(id) {
        const q = questOf(String(id));
        return q ? copy(q.rec) : null;
      }
    };
    return {
      api,
      /** The quests as records, for the store section. */
      records() {
        return rows.map(function(q) {
          return copy(q.rec);
        });
      },
      /** Every quest replaced from stored records, silently: a load, not a change. */
      replace(list) {
        for (const q of rows.slice()) drop(q);
        for (const rec of Array.isArray(list) ? list : []) {
          if (rec && rec.id != null) build2(norm(rec.id, rec));
        }
        place();
      }
    };
  }

  // src/static/sdk-libs/phaser/status.js
  var STATUS_DEPTH = 940;
  var BAR_W = 160;
  var BAR_H = 10;
  var BAR_ROW = 34;
  var LOW_SHARE = 0.25;
  var LOW_PULSES = 3;
  var SLOT = 44;
  var SLOT_GAP = 8;
  var SLOT_LIFT = 6;
  var DIGIT_KEYS = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"];
  function status(scene, spec) {
    const s = spec || /** @type {StatusSpec} */
    {};
    const th = s.theme || look(scene);
    const still = reducedMotion();
    const pace = ms(th.motion, 200);
    const ease = curve(th);
    const depth = num(s.depth, STATUS_DEPTH);
    const store = s.store && typeof s.store.get === "function" && typeof s.store.set === "function" ? s.store : null;
    const lay = Object.assign({ corner: "left", scale: 1, pad: 14, top: 96 }, s.layout || {});
    const keyboard = s.keys !== false && scene.input && scene.input.keyboard ? scene.input.keyboard : null;
    const pool = motionPool(scene);
    let dead = false;
    let loading = false;
    let lastWritten = "";
    function fixed(box2) {
      return box2.setScrollFactor(0).setDepth(depth);
    }
    const barsBox = fixed(scene.add.container(0, 0));
    const questBox = fixed(scene.add.container(0, 0));
    const coolBox = fixed(scene.add.container(0, 0));
    const invBox = fixed(scene.add.container(0, 0));
    const buffBox = fixed(scene.add.container(0, 0));
    const boxes = [barsBox, questBox, coolBox, invBox, buffBox];
    const ctx = {
      scene,
      th,
      still,
      pace,
      pool,
      alive: function() {
        return !dead;
      },
      persist: function() {
        return persist();
      }
    };
    const barRows = [];
    const barX = (s.bars || []).some(function(b) {
      return !!(b && b.icon);
    }) ? 22 : 0;
    function drawFill(row) {
      const w = Math.round(BAR_W * Math.max(0, Math.min(1, row.shown.p)));
      row.fill.clear();
      if (w < 1) return;
      row.fill.fillStyle(row.tone, 1);
      row.fill.fillRoundedRect(0, 0, w, BAR_H, Math.min(BAR_H / 2, w / 2));
    }
    function barFigure(row) {
      row.figure.setText(Math.round(row.value) + " / " + Math.round(row.max));
    }
    function buildBar(b, i) {
      const tone6 = toneColour(th, b.tone, th.accent);
      const box2 = scene.add.container(0, i * BAR_ROW);
      const label = scene.add.text(barX, 0, b.label != null ? String(b.label) : b.id, {
        fontFamily: th.fontMono,
        fontSize: "12px",
        color: hex(th.inkDim)
      }).setOrigin(0, 0);
      const figure2 = scene.add.text(barX + BAR_W, 0, "", {
        fontFamily: th.fontMono,
        fontSize: "12px",
        color: hex(th.ink)
      }).setOrigin(1, 0);
      const back = scene.add.graphics().setPosition(barX, 16);
      back.fillStyle(th.surface, 0.9);
      back.fillRoundedRect(0, 0, BAR_W, BAR_H, BAR_H / 2);
      back.lineStyle(1, th.line, 1);
      back.strokeRoundedRect(0, 0, BAR_W, BAR_H, BAR_H / 2);
      const fill3 = scene.add.graphics().setPosition(barX, 16);
      const flash = scene.add.graphics().setPosition(barX, 16).setAlpha(0);
      flash.fillStyle(th.ink, 1);
      flash.fillRoundedRect(0, 0, BAR_W, BAR_H, BAR_H / 2);
      box2.add([label, figure2, back, fill3, flash]);
      if (b.icon) box2.add(glyph(scene, th, b.icon, 18, tone6).setPosition(9, 21));
      barsBox.add(box2);
      const max = Math.max(1, num(b.max, 100));
      const value = Math.max(0, Math.min(max, num(b.value, max)));
      const row = {
        id: b.id,
        spec: b,
        max,
        value,
        tone: tone6,
        shown: { p: value / max },
        fill: fill3,
        flash,
        figure: figure2
      };
      barRows.push(row);
      drawFill(row);
      barFigure(row);
    }
    (s.bars || []).forEach(function(b, i) {
      if (b && b.id) buildBar(b, i);
    });
    function barOf(id) {
      for (const row of barRows) if (row.id === id) return row;
      return null;
    }
    function blink(row) {
      pool.stop(row.flash);
      row.flash.setAlpha(0.6);
      pool.run({ targets: row.flash, alpha: 0, duration: Math.max(80, pace * 1.2), ease: "Quad.easeOut" });
    }
    function pulse(row) {
      if (still) return;
      pool.stop(row.fill);
      row.fill.setAlpha(1);
      pool.run({
        targets: row.fill,
        alpha: 0.35,
        duration: pace,
        yoyo: true,
        repeat: LOW_PULSES - 1,
        onComplete: function() {
          row.fill.setAlpha(1);
        }
      });
    }
    function moveBar(row, prev, next) {
      const target = next / row.max;
      const low = num(row.spec.low, LOW_SHARE);
      const wentLow = target <= low && prev / row.max > low;
      pool.stop(row.shown);
      if (next < prev) blink(row);
      if (still || prev === next) {
        row.shown.p = target;
        drawFill(row);
        return;
      }
      pool.run({
        targets: row.shown,
        p: target,
        duration: next < prev ? pace * 1.5 : pace * 2,
        ease,
        onUpdate: function() {
          drawFill(row);
        },
        onComplete: function() {
          drawFill(row);
        }
      });
      if (wentLow) pulse(row);
    }
    const bars = {
      /** Put a bar at a value, clamped to 0..max. Returns what landed, or null for an unknown id. */
      set(id, value) {
        const row = barOf(id);
        if (!row || dead) return null;
        const next = Math.max(0, Math.min(row.max, num(value, 0)));
        const prev = row.value;
        row.value = next;
        barFigure(row);
        moveBar(row, prev, next);
        persist();
        return next;
      },
      /** Read the maximum with one argument, or change it with two. The value is clamped to it. */
      max(id, n) {
        const row = barOf(id);
        if (!row || dead) return null;
        if (typeof n === "number" && isFinite(n) && n > 0) {
          row.max = n;
          if (row.value > n) row.value = n;
          pool.stop(row.shown);
          row.shown.p = row.value / row.max;
          drawFill(row);
          barFigure(row);
          persist();
        }
        return row.max;
      },
      get(id) {
        const row = barOf(id);
        return row ? { value: row.value, max: row.max, share: row.value / row.max } : null;
      }
    };
    const rings = cooldownRings(ctx, coolBox, s.cooldowns || []);
    const chips = buffChips(ctx, buffBox);
    const quests = questLog(ctx, questBox, s.quest && s.quest.label || "Quests");
    const slotCount = Math.max(0, Math.floor(num(typeof s.inventory === "number" ? s.inventory : s.inventory && s.inventory.slots, 0)));
    const slots = [];
    let selectedAt = -1;
    const nameText = scene.add.text(0, -SLOT_LIFT - 6, "", {
      fontFamily: th.fontMono,
      fontSize: "11px",
      color: hex(th.inkDim)
    }).setOrigin(0.5, 1);
    invBox.add(nameText);
    function drawSlotBack(slot, on) {
      slot.back.clear();
      slot.back.fillStyle(th.surface, on ? 0.98 : 0.9);
      slot.back.fillRoundedRect(0, 0, SLOT, SLOT, 8);
      slot.back.lineStyle(on ? 2 : 1, on ? th.accent : th.line, 1);
      slot.back.strokeRoundedRect(0, 0, SLOT, SLOT, 8);
    }
    for (let i = 0; i < slotCount; i++) {
      const box2 = scene.add.container(i * (SLOT + SLOT_GAP), 0);
      const back = scene.add.graphics();
      const hit = scene.add.rectangle(SLOT / 2, SLOT / 2, SLOT, SLOT).setOrigin(0.5, 0.5);
      hit.setInteractive({ useHandCursor: true });
      hit.on("pointerdown", function() {
        inventory.select(i);
      });
      const digit = scene.add.text(4, 2, i < DIGIT_KEYS.length ? String(i + 1) : "", {
        fontFamily: th.fontMono,
        fontSize: "10px",
        color: hex(th.inkDim)
      }).setOrigin(0, 0);
      const count = scene.add.text(SLOT - 4, SLOT - 3, "", {
        fontFamily: th.fontMono,
        fontSize: "11px",
        color: hex(th.ink)
      }).setOrigin(1, 1);
      box2.add([back, hit, digit, count]);
      invBox.add(box2);
      const slot = { box: box2, back, face: null, count, item: null };
      slots.push(slot);
      drawSlotBack(slot, false);
    }
    function fillSlot(slot, item) {
      if (slot.face) {
        slot.face.destroy();
        slot.face = null;
      }
      slot.item = item;
      if (!item) {
        slot.count.setText("");
        return;
      }
      const what = item.key != null ? item.key : item.icon != null ? item.icon : String(item.label || "").charAt(0);
      slot.face = glyph(scene, th, what, SLOT - 14, th.ink).setPosition(SLOT / 2, SLOT / 2);
      slot.box.addAt(slot.face, 2);
      slot.count.setText(num(item.count, 0) > 1 ? String(Math.round(item.count)) : "");
    }
    function lift(slot, y) {
      pool.stop(slot.box);
      if (still) {
        slot.box.y = y;
        return;
      }
      pool.run({ targets: slot.box, y, duration: Math.max(60, pace * 0.7), ease });
    }
    function cleanItem(item) {
      const out = {};
      for (const k of ["key", "icon", "count", "label"]) if (item[k] !== void 0) out[k] = item[k];
      return out;
    }
    const inventory = {
      /** Put an item in a slot, or null to empty it. */
      setSlot(i, item) {
        const slot = slots[i];
        if (!slot || dead) return false;
        fillSlot(slot, item && typeof item === "object" ? cleanItem(item) : null);
        if (i === selectedAt) nameText.setText(item && item.label ? String(item.label) : "");
        persist();
        return true;
      },
      /** Choose a slot; anything out of range chooses none. Returns the chosen index. */
      select(i) {
        if (dead) return selectedAt;
        const want = typeof i === "number" && slots[i] ? i : -1;
        if (want === selectedAt) return selectedAt;
        const prev = slots[selectedAt];
        selectedAt = want;
        if (prev) {
          drawSlotBack(prev, false);
          lift(prev, 0);
        }
        const now = slots[want];
        if (now) {
          drawSlotBack(now, true);
          lift(now, -SLOT_LIFT);
          nameText.setX(now.box.x + SLOT / 2);
        }
        nameText.setText(now && now.item && now.item.label ? String(now.item.label) : "");
        persist();
        return selectedAt;
      },
      selected() {
        return selectedAt;
      },
      get(i) {
        const slot = slots[i];
        return slot && slot.item ? Object.assign({}, slot.item) : null;
      },
      /** Empty one slot, or every slot with no argument. */
      clear(i) {
        if (dead) return;
        if (typeof i === "number") {
          if (slots[i]) fillSlot(slots[i], null);
        } else {
          for (const slot of slots) fillSlot(slot, null);
        }
        if (i === void 0 || i === selectedAt) nameText.setText("");
        persist();
      }
    };
    const keyHandlers = [];
    if (keyboard) {
      for (let i = 0; i < Math.min(slots.length, DIGIT_KEYS.length); i++) {
        const fn = function() {
          inventory.select(i);
        };
        keyboard.on("keydown-" + DIGIT_KEYS[i], fn);
        keyHandlers.push({ name: "keydown-" + DIGIT_KEYS[i], fn });
      }
    }
    function place() {
      if (dead) return;
      const W = scene.scale.width;
      const H = scene.scale.height;
      const k = Math.max(0.25, num(lay.scale, 1));
      const pad2 = num(lay.pad, 14);
      const top2 = num(lay.top, 96);
      const left = lay.corner !== "right";
      const colX = left ? pad2 : W - pad2 - (barX + BAR_W) * k;
      barsBox.setScale(k).setPosition(colX, top2);
      questBox.setScale(k).setPosition(colX, top2 + barRows.length * (BAR_ROW * k) + (barRows.length ? 8 : 0));
      coolBox.setScale(k).setPosition(left ? pad2 : W - pad2 - rings.width * k, H - pad2 - rings.height * k);
      const rowW = slots.length ? (slots.length * (SLOT + SLOT_GAP) - SLOT_GAP) * k : 0;
      invBox.setScale(k).setPosition(Math.round((W - rowW) / 2), H - pad2 - SLOT * k);
      buffBox.setScale(k).setPosition(left ? W - pad2 : pad2, H - pad2);
      chips.align(left);
    }
    function section2() {
      const out = { bars: {}, inventory: { slots: [], selected: selectedAt }, quests: quests.records() };
      for (const row of barRows) out.bars[row.id] = { value: row.value, max: row.max };
      for (const slot of slots) out.inventory.slots.push(slot.item ? Object.assign({}, slot.item) : null);
      return out;
    }
    function persist() {
      if (!store || dead || loading) return Promise.resolve();
      const sec = section2();
      lastWritten = JSON.stringify(sec);
      store.set({ status: sec });
      return typeof store.save === "function" ? store.save() : Promise.resolve();
    }
    function load() {
      if (!store) return false;
      const state = store.get();
      const sec = state && state.status && typeof state.status === "object" ? state.status : null;
      if (!sec) return false;
      loading = true;
      try {
        const saved = sec.bars && typeof sec.bars === "object" ? sec.bars : {};
        for (const row of barRows) {
          const b = saved[row.id];
          if (!b || typeof b !== "object") continue;
          if (typeof b.max === "number" && b.max > 0) row.max = b.max;
          row.value = Math.max(0, Math.min(row.max, num(b.value, row.value)));
          pool.stop(row.shown);
          row.shown.p = row.value / row.max;
          drawFill(row);
          barFigure(row);
        }
        const inv = sec.inventory && typeof sec.inventory === "object" ? sec.inventory : {};
        const list = Array.isArray(inv.slots) ? inv.slots : [];
        inventory.select(-1);
        slots.forEach(function(slot, i) {
          fillSlot(slot, list[i] && typeof list[i] === "object" ? list[i] : null);
        });
        inventory.select(typeof inv.selected === "number" ? inv.selected : -1);
        quests.replace(sec.quests);
        lastWritten = JSON.stringify(section2());
      } finally {
        loading = false;
      }
      return true;
    }
    const unhook = store && typeof store.onChange === "function" ? store.onChange(function(state) {
      if (dead || loading) return;
      const sec = state && state.status;
      if (!sec || typeof sec !== "object" || JSON.stringify(sec) === lastWritten) return;
      load();
    }) : null;
    function show() {
      for (const box2 of boxes) box2.setVisible(true);
    }
    function hide() {
      for (const box2 of boxes) box2.setVisible(false);
    }
    function destroy() {
      if (dead) return;
      dead = true;
      scene.events.off("shutdown", destroy);
      scene.events.off("destroy", destroy);
      if (scene.scale && typeof scene.scale.off === "function") scene.scale.off("resize", place);
      if (keyboard) for (const h of keyHandlers) keyboard.off(h.name, h.fn);
      if (unhook) unhook();
      pool.killAll();
      for (const box2 of boxes) box2.destroy(true);
    }
    if (scene.scale && typeof scene.scale.on === "function") scene.scale.on("resize", place);
    scene.events.once("shutdown", destroy);
    scene.events.once("destroy", destroy);
    place();
    if (store) load();
    return {
      bars,
      cooldowns: rings.api,
      inventory,
      quest: quests.api,
      buffs: chips.api,
      /** Change the corner, the scale or the insets; returns the layout in force. */
      layout(patch) {
        if (patch && typeof patch === "object") Object.assign(lay, patch);
        place();
        return Object.assign({}, lay);
      },
      load,
      persist,
      show,
      hide,
      destroy
    };
  }

  // src/static/sdk-libs/phaser/achievements.js
  var BANNER_DEPTH = 945;
  var BANNER_MS = 2400;
  var BANNER_H = 52;
  var MEDAL = 28;
  var ROOM_DEPTH = OVERLAY_DEPTH - 1;
  var ROW_H = 46;
  var ROOM_PAD = 18;
  var KINDS3 = { count: true, flag: true, max: true, min: true };
  function num2(v, fallback) {
    return typeof v === "number" && isFinite(v) ? v : fallback;
  }
  function medalTexture(scene, th, colour) {
    const key = "ak-phaser-medal-" + (colour >>> 0 & 16777215).toString(16);
    if (scene.textures && scene.textures.exists(key)) return key;
    const g = scene.make.graphics({ add: false });
    const s = MEDAL;
    g.fillStyle(colour, 0.7);
    g.fillTriangle(s * 0.22, 0, s * 0.5, 0, s * 0.5, s * 0.5);
    g.fillTriangle(s * 0.5, 0, s * 0.78, 0, s * 0.5, s * 0.5);
    g.fillStyle(colour, 1);
    g.fillCircle(s * 0.5, s * 0.66, s * 0.3);
    g.fillStyle(th.surface, 1);
    g.fillCircle(s * 0.5, s * 0.66, s * 0.16);
    g.generateTexture(key, s, s);
    g.destroy();
    return key;
  }
  function achievements(scene, spec) {
    const s = spec || /** @type {AchievementsSpec} */
    { list: [] };
    const th = s.theme || look(scene);
    const still = reducedMotion();
    const pace = ms(th.motion, 200);
    const depth = num2(s.depth, BANNER_DEPTH);
    const store = s.store && typeof s.store.get === "function" && typeof s.store.set === "function" ? s.store : null;
    const bannerOn = s.banner !== false;
    const bannerOpts = s.banner && typeof s.banner === "object" ? s.banner : {};
    const pool = motionPool(scene);
    const list = [];
    for (const t of Array.isArray(s.list) ? s.list : []) {
      if (!t || typeof t !== "object" || !t.id || !KINDS3[t.kind]) {
        console.warn("[aimeat-phaser] a trophy needs an id and a kind of count, flag, max or min:", t);
        continue;
      }
      if (t.kind !== "flag" && !(typeof t.target === "number" && isFinite(t.target))) {
        console.warn("[aimeat-phaser] trophy " + t.id + " needs a numeric target");
        continue;
      }
      list.push(t);
    }
    let unlockedAt = {};
    let stats = {};
    let flags = {};
    const listeners = { unlock: [], reset: [] };
    const queue = [];
    let showing = null;
    let holdTimer = null;
    let dead = false;
    let loading = false;
    let lastWritten = "";
    function trophyOf(id) {
      for (const t of list) if (t.id === id) return t;
      return null;
    }
    function met(t) {
      if (t.kind === "flag") return !!flags[t.stat];
      const v = stats[t.stat];
      if (typeof v !== "number") return false;
      return t.kind === "min" ? v <= t.target : v >= t.target;
    }
    function emit(event, value) {
      for (const fn of (listeners[event] || []).slice()) {
        try {
          fn(value);
        } catch (err) {
          console.warn("[aimeat-phaser] an achievements listener threw:", err);
        }
      }
    }
    function record(t) {
      return {
        id: t.id,
        title: t.title,
        hint: t.hint || "",
        kind: t.kind,
        stat: t.stat,
        target: t.kind === "flag" ? 1 : t.target,
        tone: t.tone,
        secret: !!t.secret,
        done: !!unlockedAt[t.id],
        at: unlockedAt[t.id] || null
      };
    }
    function unlock(t) {
      if (unlockedAt[t.id]) return false;
      unlockedAt[t.id] = (/* @__PURE__ */ new Date()).toISOString();
      emit("unlock", record(t));
      if (bannerOn) {
        queue.push(t);
        nextBanner();
      }
      return true;
    }
    function evaluate(statName) {
      let n = 0;
      for (const t of list) {
        if (unlockedAt[t.id] || statName != null && t.stat !== statName) continue;
        if (met(t) && unlock(t)) n += 1;
      }
      return n;
    }
    function post(statName) {
      if (!store || typeof store.leaderboard !== "function") return;
      const v = stats[statName];
      if (typeof v !== "number") return;
      for (const t of list) {
        if (!t.board || t.stat !== statName || t.kind !== "count" && t.kind !== "max") continue;
        const state = store.get();
        if (v > num2(state && state.best, 0)) store.set({ best: v });
        return;
      }
    }
    function section2() {
      return { unlocked: Object.assign({}, unlockedAt), stats: Object.assign({}, stats), flags: Object.assign({}, flags) };
    }
    function persist() {
      if (!store || dead || loading) return Promise.resolve();
      const sec = section2();
      lastWritten = JSON.stringify(sec);
      store.set({ achievements: sec });
      return typeof store.save === "function" ? store.save() : Promise.resolve();
    }
    function load() {
      if (!store) return false;
      const state = store.get();
      const sec = state && state.achievements && typeof state.achievements === "object" ? state.achievements : null;
      if (!sec) return false;
      loading = true;
      unlockedAt = Object.assign({}, sec.unlocked && typeof sec.unlocked === "object" ? sec.unlocked : {}, unlockedAt);
      stats = Object.assign({}, stats, sec.stats && typeof sec.stats === "object" ? sec.stats : {});
      flags = Object.assign({}, flags, sec.flags && typeof sec.flags === "object" ? sec.flags : {});
      lastWritten = JSON.stringify(section2());
      loading = false;
      if (evaluate(null) > 0) persist();
      return true;
    }
    const unhook = store && typeof store.onChange === "function" ? store.onChange(function(state) {
      if (dead || loading) return;
      const sec = state && state.achievements;
      if (!sec || typeof sec !== "object" || JSON.stringify(sec) === lastWritten) return;
      load();
    }) : null;
    function nextBanner() {
      if (dead || showing || !queue.length) return;
      const t = queue.shift();
      const tone6 = toneColour(
        th,
        /** @type {any} */
        t.tone,
        th.accent
      );
      const caption = scene.add.text(0, 0, bannerOpts.caption || "Trophy unlocked", {
        fontFamily: th.fontMono,
        fontSize: "11px",
        color: hex(th.inkDim)
      }).setOrigin(0, 0);
      const title = scene.add.text(0, 0, t.title, {
        fontFamily: th.fontDisplay,
        fontSize: "17px",
        color: hex(th.ink)
      }).setOrigin(0, 0);
      const w = Math.ceil(Math.max(caption.width, title.width)) + MEDAL + 44;
      const h = BANNER_H;
      const plate = scene.add.graphics();
      plate.fillStyle(th.surface, 0.97);
      plate.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      plate.lineStyle(1, tone6, 1);
      plate.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
      plate.fillStyle(tone6, 1);
      plate.fillRoundedRect(-w / 2, -h / 2, 6, h, { tl: 10, bl: 10, tr: 0, br: 0 });
      const medal = scene.add.image(-w / 2 + 16 + MEDAL / 2, 0, medalTexture(scene, th, tone6));
      const tx = -w / 2 + 16 + MEDAL + 12;
      caption.setPosition(tx, -h / 2 + 9);
      title.setPosition(tx, -h / 2 + 24);
      const restY = num2(bannerOpts.y, num2(bannerOpts.pad, 14) + h / 2);
      const box2 = scene.add.container(scene.scale.width / 2, still ? restY : -h, [plate, medal, caption, title]).setScrollFactor(0).setDepth(depth);
      showing = box2;
      const hold = Math.max(300, num2(bannerOpts.ms, BANNER_MS));
      const leave = function() {
        holdTimer = null;
        if (dead) return;
        pool.run({
          targets: box2,
          y: still ? restY : -h,
          alpha: still ? 0 : 1,
          duration: still ? pace : pace * 1.6,
          ease: "Quad.easeIn",
          onComplete: function() {
            box2.destroy(true);
            showing = null;
            nextBanner();
          }
        });
      };
      const settle = function() {
        holdTimer = scene.time.delayedCall(hold, leave);
      };
      if (still) {
        box2.setAlpha(0);
        pool.run({ targets: box2, alpha: 1, duration: pace, onComplete: settle });
      } else {
        pool.run({ targets: box2, y: restY, duration: pace * 2, ease: "Back.easeOut", onComplete: settle });
      }
    }
    function after(key) {
      evaluate(key);
      post(key);
      persist();
    }
    function destroy() {
      if (dead) return;
      dead = true;
      scene.events.off("shutdown", destroy);
      scene.events.off("destroy", destroy);
      if (unhook) unhook();
      if (holdTimer) {
        holdTimer.remove(false);
        holdTimer = null;
      }
      queue.length = 0;
      pool.killAll();
      if (showing) {
        showing.destroy(true);
        showing = null;
      }
      listeners.unlock.length = 0;
      listeners.reset.length = 0;
    }
    scene.events.once("shutdown", destroy);
    scene.events.once("destroy", destroy);
    if (store) load();
    return {
      stat(name, delta) {
        if (dead) return 0;
        const key = String(name);
        stats[key] = num2(stats[key], 0) + (delta === void 0 ? 1 : num2(delta, 0));
        after(key);
        return stats[key];
      },
      set(name, value) {
        if (dead) return 0;
        const key = String(name);
        stats[key] = num2(value, 0);
        after(key);
        return stats[key];
      },
      flag(name, on) {
        if (dead) return false;
        const key = String(name);
        if (on === false) delete flags[key];
        else flags[key] = true;
        evaluate(key);
        persist();
        return !!flags[key];
      },
      unlock(id) {
        const t = trophyOf(String(id));
        if (!t || dead || !unlock(t)) return false;
        persist();
        return true;
      },
      unlocked() {
        return Object.keys(unlockedAt).sort(function(a, b) {
          return unlockedAt[a] < unlockedAt[b] ? -1 : 1;
        });
      },
      progress(id) {
        const t = trophyOf(String(id));
        if (!t) return null;
        const done = !!unlockedAt[t.id];
        if (t.kind === "flag") return { value: flags[t.stat] ? 1 : 0, target: 1, done };
        const v = stats[t.stat];
        return { value: typeof v === "number" ? v : t.kind === "min" ? null : 0, target: t.target, done };
      },
      list() {
        return list.map(function(t) {
          const r = record(t);
          if (r.secret && !r.done) {
            r.title = "???";
            r.hint = "";
          }
          return r;
        });
      },
      reset() {
        if (dead) return;
        unlockedAt = {};
        stats = {};
        flags = {};
        queue.length = 0;
        persist();
        emit("reset", void 0);
      },
      on(event, fn) {
        const bucket = listeners[event];
        if (!bucket || typeof fn !== "function") return function() {
        };
        bucket.push(fn);
        return function() {
          const at = bucket.indexOf(fn);
          if (at >= 0) bucket.splice(at, 1);
        };
      },
      load,
      persist,
      destroy
    };
  }
  function trophyRoom(scene, ach, opts) {
    const o = opts || {};
    const th = o.theme || look(scene);
    const still = reducedMotion();
    const pace = ms(th.motion, 200);
    const ease = curve(th);
    const depth = num2(o.depth, ROOM_DEPTH);
    const pool = motionPool(scene);
    const W = scene.scale.width;
    const H = scene.scale.height;
    const w = Math.min(W - 28, num2(o.width, 460));
    const h = Math.min(H - 28, num2(o.height, 340));
    const rows = ach && typeof ach.list === "function" ? ach.list() : [];
    const doneCount = rows.filter(function(r) {
      return r.done;
    }).length;
    let gone = false;
    const root = scene.add.container(0, 0).setScrollFactor(0).setDepth(depth);
    const scrim = scene.add.rectangle(0, 0, W, H, th.bg, 0.78).setOrigin(0, 0);
    scrim.setInteractive();
    scrim.on("pointerdown", close);
    root.add(scrim);
    const x0 = Math.round((W - w) / 2);
    const y0 = Math.round((H - h) / 2);
    const panel2 = scene.add.graphics();
    panel2.fillStyle(th.surface, 1);
    panel2.fillRoundedRect(x0, y0, w, h, 12);
    panel2.lineStyle(1, th.line, 1);
    panel2.strokeRoundedRect(x0, y0, w, h, 12);
    const shield = scene.add.rectangle(x0, y0, w, h).setOrigin(0, 0);
    shield.setInteractive();
    root.add([panel2, shield]);
    const title = scene.add.text(x0 + ROOM_PAD, y0 + ROOM_PAD, o.title || "Trophies", {
      fontFamily: th.fontDisplay,
      fontSize: "20px",
      color: hex(th.ink)
    }).setOrigin(0, 0);
    const tally = scene.add.text(x0 + w - ROOM_PAD, y0 + ROOM_PAD + 5, doneCount + " / " + rows.length, {
      fontFamily: th.fontMono,
      fontSize: "13px",
      color: hex(th.inkDim)
    }).setOrigin(1, 0);
    const closeText = scene.add.text(x0 + w - ROOM_PAD, y0 + h - ROOM_PAD, o.closeLabel || "Close", {
      fontFamily: th.fontMono,
      fontSize: "12px",
      color: hex(th.accent)
    }).setOrigin(1, 1);
    closeText.setInteractive({ useHandCursor: true });
    closeText.on("pointerdown", close);
    root.add([title, tally, closeText]);
    const vx = x0 + ROOM_PAD;
    const vy = y0 + ROOM_PAD + 36;
    const vw = w - ROOM_PAD * 2;
    const vh = h - ROOM_PAD * 2 - 36 - 24;
    const listBox = scene.add.container(vx, vy);
    root.add(listBox);
    const shape = scene.make.graphics({ add: false });
    shape.fillStyle(th.ink, 1);
    shape.fillRect(vx, vy, vw, vh);
    shape.setScrollFactor(0);
    listBox.setMask(shape.createGeometryMask());
    const dimKey = medalTexture(scene, th, th.line);
    const unlockedLabel = o.unlockedLabel || "Unlocked";
    rows.forEach(function(r, i) {
      const rowBox = scene.add.container(0, i * ROW_H);
      const medal = scene.add.image(
        MEDAL / 2 + 2,
        ROW_H / 2,
        r.done ? medalTexture(scene, th, toneColour(
          th,
          /** @type {any} */
          r.tone,
          th.accent
        )) : dimKey
      );
      const name = scene.add.text(MEDAL + 16, 8, r.title, {
        fontFamily: th.font,
        fontSize: "15px",
        color: hex(r.done ? th.ink : th.inkDim)
      }).setOrigin(0, 0);
      const line = r.done ? unlockedLabel + (r.at ? " " + String(r.at).slice(0, 10) : "") : r.hint;
      const hint = scene.add.text(MEDAL + 16, 27, line, {
        fontFamily: th.fontMono,
        fontSize: "11px",
        color: hex(th.inkDim)
      }).setOrigin(0, 0);
      const rule = scene.add.graphics();
      rule.lineStyle(1, th.line, 0.6);
      rule.lineBetween(0, ROW_H - 1, vw, ROW_H - 1);
      rowBox.add([rule, medal, name, hint]);
      listBox.add(rowBox);
      if (still) return;
      rowBox.setAlpha(0);
      pool.run({ targets: rowBox, alpha: 1, delay: Math.min(i, 8) * pace * 0.25, duration: pace * 1.5, ease });
    });
    const maxScroll = Math.max(0, rows.length * ROW_H - vh);
    let scrollY = 0;
    function scroll(dy) {
      if (gone) return;
      scrollY = Math.max(0, Math.min(maxScroll, scrollY + num2(dy, 0)));
      listBox.y = vy - scrollY;
    }
    const onWheel = function(_pointer, _over, _dx, dy) {
      scroll(dy);
    };
    const onMove = function(pointer) {
      if (pointer && pointer.isDown && pointer.prevPosition) scroll(pointer.prevPosition.y - pointer.y);
    };
    scene.input.on("wheel", onWheel);
    scene.input.on("pointermove", onMove);
    const keyboard = scene.input && scene.input.keyboard ? scene.input.keyboard : null;
    const onUp = function() {
      scroll(-ROW_H);
    };
    const onDown = function() {
      scroll(ROW_H);
    };
    const keys = [
      ["keydown-UP", onUp],
      ["keydown-W", onUp],
      ["keydown-DOWN", onDown],
      ["keydown-S", onDown],
      ["keydown-ESC", close],
      ["keydown-ENTER", close],
      ["keydown-SPACE", close]
    ];
    if (keyboard) for (const k of keys) keyboard.on(k[0], k[1]);
    const held = { up: false, down: false, act: true, pause: true };
    const tick = function() {
      const c = o.controls;
      if (gone || !c) return;
      const up = !!c.up;
      const down = !!c.down;
      const act = !!(c.action || c.jump);
      const pause = !!c.pause;
      if (up && !held.up) scroll(-ROW_H);
      if (down && !held.down) scroll(ROW_H);
      held.up = up;
      held.down = down;
      const fresh = act && !held.act || pause && !held.pause;
      held.act = act;
      held.pause = pause;
      if (fresh) close();
    };
    if (o.controls) scene.events.on("update", tick);
    function close() {
      if (gone) return;
      gone = true;
      scene.events.off("update", tick);
      scene.events.off("shutdown", close);
      scene.input.off("wheel", onWheel);
      scene.input.off("pointermove", onMove);
      if (keyboard) for (const k of keys) keyboard.off(k[0], k[1]);
      pool.killAll();
      listBox.clearMask(true);
      shape.destroy();
      root.destroy(true);
      if (typeof o.onClose === "function") o.onClose();
    }
    scene.events.once("shutdown", close);
    if (!still) {
      root.setAlpha(0);
      pool.run({ targets: root, alpha: 1, duration: pace, ease });
    }
    return { close, destroy: close, scroll };
  }

  // src/static/sdk-libs/phaser/dialogue-draw.js
  var DIALOGUE_DEPTH = 940;
  var MARGIN3 = 16;
  var PAD = 16;
  var MAX_WIDTH = 760;
  var PORTRAIT = 56;
  var TAB_H = 26;
  var ROW_H2 = 30;
  var MARK = 8;
  var ROWS_GAP = 10;
  var RISE = 10;
  var TONES = { accent: 1, ok: 1, warn: 1, err: 1, ch1: 1, ch2: 1, ch3: 1, ch4: 1, ink: 1, inkDim: 1 };
  function tone5(th, want, fallback) {
    if (typeof want === "number" && isFinite(want)) return want;
    if (typeof want === "string" && TONES[want] && typeof th[want] === "number") return th[want];
    return fallback;
  }
  function luminance2(colour) {
    const c = channels(colour);
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
  }
  function inkOn(th, colour) {
    const l = luminance2(colour);
    let best = th.ink;
    let gap = -1;
    for (const candidate of [th.ink, th.surface, th.bg]) {
      const d = Math.abs(luminance2(candidate) - l);
      if (d > gap) {
        gap = d;
        best = candidate;
      }
    }
    return best;
  }
  function inRect(area, x, y) {
    return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
  }
  function panel(scene, th, spec, hooks) {
    const s = spec || /** @type {PanelSpec} */
    {};
    const h = hooks || {};
    const fs = typeof s.fontSize === "number" ? s.fontSize : 18;
    const lineH = Math.round(fs * 1.4);
    const lines = Math.max(1, Math.round(typeof s.lines === "number" ? s.lines : 3));
    const atTop = s.position === "top";
    const depth = typeof s.depth === "number" ? s.depth : DIALOGUE_DEPTH;
    const column = s.portrait !== false;
    const still = !!s.still;
    const pace = typeof s.pace === "number" ? s.pace : 200;
    const ease = s.ease || "Cubic.easeOut";
    const display = th.fontDisplay || th.font;
    const root = scene.add.container(0, 0).setScrollFactor(0).setDepth(depth);
    root.setVisible(false);
    root.setAlpha(0);
    const area = { x: 0, y: 0, width: 10, height: 10 };
    const plate = scene.add.graphics().setScrollFactor(0);
    plate.setInteractive({ hitArea: area, hitAreaCallback: inRect, useHandCursor: true });
    plate.on("pointerdown", function() {
      if (typeof h.plate === "function") h.plate();
    });
    const tab = scene.add.graphics().setScrollFactor(0);
    const name = scene.add.text(0, 0, "", {
      fontFamily: display,
      fontSize: "15px",
      color: hex(th.ink)
    }).setOrigin(0, 0.5);
    const disc = scene.add.graphics().setScrollFactor(0);
    const initial = scene.add.text(0, 0, "", {
      fontFamily: display,
      fontSize: Math.round(PORTRAIT * 0.46) + "px",
      color: hex(th.ink)
    }).setOrigin(0.5, 0.5);
    const body = scene.add.text(0, 0, "", {
      fontFamily: th.font,
      fontSize: fs + "px",
      color: hex(th.ink),
      wordWrap: { width: MAX_WIDTH, useAdvancedWrap: true }
    }).setOrigin(0, 0);
    const mark = scene.add.graphics().setScrollFactor(0);
    const bar = scene.add.rectangle(0, 0, 3, ROW_H2 - 10, th.accent).setOrigin(0, 0).setScrollFactor(0);
    bar.setVisible(false);
    root.add([plate, tab, name, disc, initial, body, mark, bar]);
    let image = null;
    let hasPortrait = column;
    let toneNow = th.accent;
    let rowList = [];
    let selected = 0;
    let markKind = null;
    let gone = false;
    let geo = measure(0);
    function measure(rowCount) {
      const camW = scene.scale.width;
      const camH = scene.scale.height;
      const w = Math.max(160, Math.min(MAX_WIDTH, camW - MARGIN3 * 2));
      const portraitW = hasPortrait ? PORTRAIT + PAD : 0;
      const textH = Math.max(hasPortrait ? PORTRAIT : 0, lines * lineH);
      const rowsH = rowCount > 0 ? ROWS_GAP + rowCount * ROW_H2 : 0;
      const boxH = PAD + textH + rowsH + PAD;
      return {
        x: Math.round((camW - w) / 2),
        y: atTop ? MARGIN3 + TAB_H : Math.max(TAB_H, camH - MARGIN3 - boxH),
        w,
        h: boxH,
        bodyLeft: PAD + portraitW,
        bodyWidth: w - PAD - portraitW - PAD - MARK * 2 - 4,
        rowsTop: PAD + textH + ROWS_GAP,
        rows: rowCount
      };
    }
    function layout(rowCount) {
      if (gone) return;
      geo = measure(rowCount);
      root.setPosition(geo.x, geo.y);
      plate.clear();
      plate.fillStyle(th.surface, 0.96);
      plate.fillRoundedRect(0, 0, geo.w, geo.h, 10);
      plate.lineStyle(1, th.line, 1);
      plate.strokeRoundedRect(0, 0, geo.w, geo.h, 10);
      area.width = geo.w;
      area.height = geo.h;
      tab.clear();
      if (name.text) {
        const tabW = Math.ceil(name.width) + 24;
        const corners = { tl: 8, tr: 8, bl: 0, br: 0 };
        tab.fillStyle(th.surface, 1);
        tab.fillRoundedRect(PAD, 1 - TAB_H, tabW, TAB_H, corners);
        tab.lineStyle(1, toneNow, 1);
        tab.strokeRoundedRect(PAD, 1 - TAB_H, tabW, TAB_H, corners);
      }
      name.setPosition(PAD + 12, 1 - TAB_H / 2);
      const px = PAD + PORTRAIT / 2;
      const py = PAD + PORTRAIT / 2;
      disc.setPosition(px, py);
      initial.setPosition(px, py);
      if (image) image.setPosition(px, py);
      body.setPosition(geo.bodyLeft, PAD);
      body.setWordWrapWidth(geo.bodyWidth, true);
      for (let i = 0; i < rowList.length; i += 1) {
        const row = rowList[i];
        const top2 = geo.rowsTop + i * ROW_H2;
        row.rect.setPosition(PAD, top2);
        row.rect.setSize(geo.w - PAD * 2, ROW_H2);
        row.label.setPosition(PAD + 22, top2 + ROW_H2 / 2);
      }
      placeBar();
      drawMark();
    }
    function placeBar() {
      if (!rowList.length || selected < 0 || selected >= rowList.length) {
        bar.setVisible(false);
        return;
      }
      bar.setVisible(true);
      bar.setPosition(PAD + 8, geo.rowsTop + selected * ROW_H2 + 5);
    }
    function drawMark() {
      mark.clear();
      if (!markKind) return;
      const cx = geo.w - PAD - MARK;
      const cy = geo.h - PAD - MARK + 2;
      mark.fillStyle(th.accent, 1);
      if (markKind === "more") {
        mark.fillTriangle(cx - MARK, cy - MARK / 2, cx + MARK, cy - MARK / 2, cx, cy + MARK / 2);
      } else {
        mark.fillTriangle(cx - MARK / 2, cy - MARK, cx - MARK / 2, cy + MARK, cx + MARK / 2, cy);
      }
    }
    function speaker(look2) {
      const sp = look2 || /** @type {SpeakerLook} */
      {};
      toneNow = tone5(th, sp.tone, th.accent);
      name.setText(sp.name == null ? "" : String(sp.name));
      hasPortrait = column && sp.portrait !== false;
      disc.clear();
      initial.setText("");
      if (image) image.setVisible(false);
      if (!hasPortrait) return;
      const key = typeof sp.texture === "string" ? sp.texture : "";
      const known = key && scene.textures && typeof scene.textures.exists === "function" && scene.textures.exists(key);
      if (known) {
        if (!image) {
          image = scene.add.image(0, 0, key).setScrollFactor(0);
          root.add(image);
        } else {
          image.setTexture(key);
        }
        image.setVisible(true);
        image.setDisplaySize(PORTRAIT, PORTRAIT);
        return;
      }
      disc.fillStyle(toneNow, 1);
      disc.fillCircle(0, 0, PORTRAIT / 2);
      initial.setText(String(sp.initial || sp.name || "?").charAt(0).toUpperCase());
      initial.setColor(hex(inkOn(th, toneNow)));
    }
    function rows(labels) {
      for (const row of rowList) {
        row.rect.destroy();
        row.label.destroy();
      }
      rowList = [];
      selected = 0;
      const list = Array.isArray(labels) ? labels : [];
      geo = measure(list.length);
      for (let i = 0; i < list.length; i += 1) {
        const top2 = geo.rowsTop + i * ROW_H2;
        const rect = scene.add.rectangle(PAD, top2, geo.w - PAD * 2, ROW_H2, th.surface, 1).setOrigin(0, 0).setScrollFactor(0);
        rect.setInteractive({ useHandCursor: true });
        rect.on("pointerover", onRow(i, "over"));
        rect.on("pointerdown", onRow(i, "down"));
        const label = scene.add.text(PAD + 22, top2 + ROW_H2 / 2, String(list[i]), {
          fontFamily: th.font,
          fontSize: Math.round(fs * 0.94) + "px",
          color: hex(th.ink)
        }).setOrigin(0, 0.5);
        root.add([rect, label]);
        rowList.push({ rect, label });
      }
      layout(list.length);
      select(0);
    }
    function onRow(i, kind) {
      return function() {
        if (typeof h.row === "function") h.row(i, kind);
      };
    }
    function select(i) {
      const n = rowList.length;
      if (!n) {
        selected = 0;
        placeBar();
        return 0;
      }
      selected = (Math.round(i) % n + n) % n;
      for (let k = 0; k < n; k += 1) {
        const on = k === selected;
        rowList[k].rect.setFillStyle(on ? th.accent : th.surface, on ? 0.14 : 1);
        rowList[k].label.setColor(hex(on ? th.accent : th.ink));
      }
      placeBar();
      return selected;
    }
    function show(on, done) {
      if (gone) return;
      if (scene.tweens) scene.tweens.killTweensOf(root);
      const home = geo.y;
      if (on) {
        root.setVisible(true);
        if (still) {
          root.setAlpha(1);
          root.y = home;
          if (done) done();
          return;
        }
        root.setAlpha(0);
        root.y = home + RISE;
        scene.tweens.add({
          targets: root,
          alpha: 1,
          y: home,
          duration: Math.round(pace * 0.8),
          ease,
          onComplete: function() {
            if (done) done();
          }
        });
        return;
      }
      if (still) {
        root.setAlpha(0);
        root.setVisible(false);
        if (done) done();
        return;
      }
      scene.tweens.add({
        targets: root,
        alpha: 0,
        y: home + RISE,
        duration: Math.round(pace * 0.6),
        ease,
        onComplete: function() {
          root.setVisible(false);
          root.y = home;
          if (done) done();
        }
      });
    }
    return {
      root,
      lines,
      /**
       * The text as the body will break it, one string per line, at the width the box has now.
       * @param {string} text
       * @returns {string[]}
       */
      wrap(text) {
        const str = text == null ? "" : String(text);
        if (typeof body.getWrappedText !== "function") return str.split("\n");
        return body.getWrappedText(str);
      },
      speaker,
      /** @param {string} str */
      text(str) {
        body.setText(str == null ? "" : String(str));
      },
      layout,
      /** The same geometry again, after the camera changed size. */
      relayout() {
        layout(geo.rows);
      },
      /** @param {'more'|'next'|null} kind */
      mark(kind) {
        markKind = kind === "more" || kind === "next" ? kind : null;
        drawMark();
      },
      rows,
      select,
      show,
      destroy() {
        if (gone) return;
        gone = true;
        if (scene.tweens) scene.tweens.killTweensOf(root);
        rowList = [];
        root.destroy();
      }
    };
  }

  // src/static/sdk-libs/phaser/dialogue.js
  var PAUSE_END = 7;
  var PAUSE_MID = 3;
  var PAUSE_LINE = 4;
  var VAR_RE = /\{(\w+)\}/g;
  function fill(text, vars) {
    const value = String(text == null ? "" : text);
    if (!vars) return value;
    return value.replace(VAR_RE, function(whole, name) {
      return vars[name] == null ? whole : String(vars[name]);
    });
  }
  function pauseAfter(ch, next) {
    if (ch === "\n") return PAUSE_LINE;
    const endsWord = next === "" || next === " " || next === "\n";
    if (!endsWord) return 1;
    if (ch === "." || ch === "!" || ch === "?") return PAUSE_END;
    if (ch === "," || ch === ";" || ch === ":") return PAUSE_MID;
    return 1;
  }
  function pages(lines, perPage) {
    const out = [];
    for (let i = 0; i < lines.length; i += perPage) out.push(lines.slice(i, i + perPage).join("\n"));
    return out.length ? out : [""];
  }
  function cap(s) {
    const str = String(s == null ? "" : s);
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  function dialogue(scene, opts) {
    const o = opts || /** @type {DialogueOptions} */
    {};
    const th = o.theme || look(scene);
    const still = reducedMotion();
    const pace = ms(th.motion, 200);
    const rate = typeof o.rate === "number" && isFinite(o.rate) ? Math.max(0, o.rate) : Math.max(10, Math.round(pace / 8));
    const lib = o.library && typeof o.library.t === "function" ? o.library : null;
    const speakers = o.speakers || {};
    const pad2 = o.controls || null;
    let current = null;
    const queue = [];
    let timer = null;
    let visible = false;
    let dead = false;
    const held = { act: false, up: false, down: false };
    const view = panel(scene, th, {
      position: o.position,
      depth: o.depth,
      fontSize: o.fontSize,
      lines: o.lines,
      portrait: o.portrait,
      still,
      pace,
      ease: curve(th)
    }, { plate: onPlate, row: onRow });
    function tr(key, vars) {
      if (!lib) return null;
      let got;
      try {
        got = lib.t(key, vars);
      } catch (err) {
        console.warn('[aimeat-phaser] the library could not look up "' + key + '":', err);
        return null;
      }
      return typeof got === "string" && got !== key ? got : null;
    }
    function words(text, vars) {
      const key = text == null ? "" : String(text);
      return tr(key, vars) || fill(key, vars);
    }
    function lookOf(speaker, lo) {
      const id = speaker == null ? "" : String(speaker);
      const sp = speakers[id] || /** @type {SpeakerSpec} */
      {};
      const name = lo.name || sp.name || (id ? tr("speaker." + id) || cap(id) : "");
      const portrait = lo.portrait !== void 0 ? lo.portrait : sp.portrait;
      return {
        name,
        tone: lo.tone != null ? lo.tone : sp.tone,
        texture: typeof portrait === "string" ? portrait : "",
        portrait: portrait !== false,
        initial: name.charAt(0)
      };
    }
    function cancelTimer() {
      if (!timer) return;
      timer.remove(false);
      timer = null;
    }
    function open2(entry) {
      current = entry;
      view.speaker(lookOf(entry.speaker, entry.opts));
      view.layout(entry.choices ? entry.choices.length : 0);
      entry.pages = pages(view.wrap(entry.text), view.lines);
      entry.page = 0;
      startPage();
      if (!visible) {
        visible = true;
        view.show(true);
      }
    }
    function startPage() {
      const cur = current;
      if (!cur) return;
      cancelTimer();
      cur.typing = true;
      cur.shown = 0;
      view.mark(null);
      if (still || cur.rate <= 0) {
        reveal();
        return;
      }
      view.text("");
      tick();
    }
    function tick() {
      timer = null;
      const cur = current;
      if (!cur || !cur.typing) return;
      const page = cur.pages[cur.page];
      cur.shown += 1;
      view.text(page.slice(0, cur.shown));
      if (cur.shown >= page.length) {
        finishPage();
        return;
      }
      const ch = page.charAt(cur.shown - 1);
      const next = page.charAt(cur.shown);
      timer = scene.time.delayedCall(cur.rate * pauseAfter(ch, next), tick);
    }
    function reveal() {
      const cur = current;
      if (!cur) return;
      cancelTimer();
      const page = cur.pages[cur.page];
      cur.shown = page.length;
      view.text(page);
      finishPage();
    }
    function finishPage() {
      const cur = current;
      if (!cur) return;
      cur.typing = false;
      if (cur.page < cur.pages.length - 1) {
        view.mark("more");
        return;
      }
      if (cur.choices) {
        view.rows(cur.choices.map(function(c) {
          return c.label;
        }));
        cur.index = view.select(cur.index);
        return;
      }
      view.mark("next");
    }
    function asking() {
      const cur = current;
      return !!(cur && cur.choices && !cur.typing && cur.page === cur.pages.length - 1);
    }
    function advance() {
      const cur = current;
      if (!cur || dead) return;
      if (cur.typing) {
        reveal();
        return;
      }
      if (cur.page < cur.pages.length - 1) {
        cur.page += 1;
        startPage();
        return;
      }
      if (cur.choices) {
        settle(cur.choices[cur.index] ? cur.choices[cur.index].value : null);
        return;
      }
      settle(void 0);
    }
    function settle(value) {
      const cur = current;
      if (!cur) return;
      current = null;
      cancelTimer();
      view.mark(null);
      view.rows([]);
      if (queue.length) open2(queue.shift());
      else close();
      cur.resolve(value);
    }
    function close() {
      if (!visible) return;
      visible = false;
      view.show(false);
    }
    function enqueue(speaker, text, choices, lineOpts) {
      const lo = lineOpts || {};
      return new Promise(function(resolve2) {
        if (dead) {
          resolve2(choices ? null : void 0);
          return;
        }
        const entry = {
          speaker,
          opts: lo,
          text: words(text, lo.vars),
          pages: [""],
          page: 0,
          shown: 0,
          typing: false,
          choices,
          index: 0,
          rate: typeof lo.rate === "number" && isFinite(lo.rate) ? Math.max(0, lo.rate) : rate,
          resolve: resolve2
        };
        if (current) queue.push(entry);
        else open2(entry);
      });
    }
    function onPlate() {
      if (asking()) return;
      advance();
    }
    function onRow(i, kind) {
      const cur = current;
      if (!asking() || dead) return;
      cur.index = view.select(i);
      if (kind === "down") settle(cur.choices[cur.index] ? cur.choices[cur.index].value : null);
    }
    function update() {
      const c = pad2;
      const act = !!(c && (c.action || c.jump));
      const up = !!(c && c.up);
      const down = !!(c && c.down);
      const actEdge = act && !held.act;
      const upEdge = up && !held.up;
      const downEdge = down && !held.down;
      held.act = act;
      held.up = up;
      held.down = down;
      const cur = current;
      if (!cur || dead) return;
      if (asking()) {
        if (upEdge) cur.index = view.select(cur.index - 1);
        if (downEdge) cur.index = view.select(cur.index + 1);
      }
      if (actEdge) advance();
    }
    const onResize = function() {
      if (dead) return;
      const cur = current;
      view.layout(cur && cur.choices ? cur.choices.length : 0);
      if (!cur) return;
      cur.pages = pages(view.wrap(cur.text), view.lines);
      cur.page = Math.min(cur.page, cur.pages.length - 1);
      reveal();
    };
    if (scene.scale && typeof scene.scale.on === "function") scene.scale.on("resize", onResize);
    if (o.auto !== false && pad2 && scene.events) scene.events.on("update", update);
    function destroy() {
      if (dead) return;
      dead = true;
      cancelTimer();
      if (scene.events) {
        scene.events.off("update", update);
        scene.events.off("shutdown", destroy);
      }
      if (scene.scale && typeof scene.scale.off === "function") scene.scale.off("resize", onResize);
      const pending = queue.splice(0);
      const cur = current;
      current = null;
      view.destroy();
      if (cur) cur.resolve(cur.choices ? null : void 0);
      for (const e of pending) e.resolve(e.choices ? null : void 0);
    }
    if (scene.events && typeof scene.events.once === "function") scene.events.once("shutdown", destroy);
    return {
      el: view.root,
      get open() {
        return !!current;
      },
      /**
       * One line. Resolves when the player has read it and moved on.
       * @param {string} speaker
       * @param {string} text
       * @param {LineOptions} [lineOpts]
       * @returns {Promise<void>}
       */
      say(speaker, text, lineOpts) {
        return enqueue(speaker, text, null, lineOpts);
      },
      /**
       * A question. Resolves with the value of the answer picked; with no answers to offer it
       * behaves as say().
       * @param {string} speaker
       * @param {string} text
       * @param {Choice[]} choices
       * @param {LineOptions} [lineOpts]
       * @returns {Promise<any>}
       */
      ask(speaker, text, choices, lineOpts) {
        const lo = lineOpts || {};
        const list = (Array.isArray(choices) ? choices : []).filter(function(c) {
          return c && typeof c === "object";
        }).map(function(c) {
          return { label: words(c.label == null ? c.value : c.label, lo.vars), value: c.value };
        });
        return enqueue(speaker, text, list.length ? list : null, lo);
      },
      skip() {
        if (current && current.typing) reveal();
      },
      advance,
      hide() {
        for (const e of queue.splice(0)) e.resolve(e.choices ? null : void 0);
        if (current) settle(current.choices ? null : void 0);
        else close();
      },
      update,
      destroy
    };
  }

  // src/static/sdk-libs/phaser/cutscene.js
  var HOLD_MS = 700;
  function number(v, fallback) {
    return typeof v === "number" && isFinite(v) ? v : fallback;
  }
  function cutscene(scene, steps, opts) {
    const o = opts || /** @type {CutsceneOptions} */
    {};
    const th = o.theme || look(scene);
    const still = reducedMotion();
    const pace = ms(th.motion, 200);
    const ease = curve(th);
    const list = Array.isArray(steps) ? steps : [];
    const own = !o.dialogue;
    const talk = o.dialogue || dialogue(scene, {
      controls: o.controls,
      library: o.library,
      speakers: o.speakers,
      position: o.position,
      theme: th
    });
    const pad2 = o.controls || null;
    const skippable = o.skippable === true || list.some(function(s) {
      return !!(s && s.skip);
    });
    let stopped = false;
    let finished = false;
    let cancel = null;
    let cover = null;
    let ring2 = null;
    let heldMs = 0;
    let pointerHeld = false;
    function lineOf(spec) {
      if (Array.isArray(spec)) {
        const withChoices = Array.isArray(spec[2]);
        return {
          speaker: spec[0],
          text: spec[1],
          choices: withChoices ? spec[2] : null,
          opts: (withChoices ? spec[3] : spec[2]) || {}
        };
      }
      if (spec && typeof spec === "object") {
        return { speaker: spec.speaker, text: spec.text, choices: spec.choices || null, opts: spec.opts || spec };
      }
      return { speaker: "", text: spec == null ? "" : String(spec), choices: null, opts: {} };
    }
    function hideTalk() {
      talk.hide();
    }
    function doSay(spec) {
      const line = lineOf(spec);
      cancel = hideTalk;
      return talk.say(line.speaker, line.text, line.opts);
    }
    function doAsk(spec, branch) {
      const line = lineOf(spec);
      cancel = hideTalk;
      return talk.ask(line.speaker, line.text, line.choices || [], line.opts).then(function(value) {
        cancel = null;
        if (stopped || typeof branch !== "function") return void 0;
        const more = branch(value);
        return Array.isArray(more) ? runList(more) : void 0;
      });
    }
    function doWait(wait) {
      return new Promise(function(res) {
        const t = scene.time.delayedCall(Math.max(0, wait), function() {
          cancel = null;
          res();
        });
        cancel = function() {
          t.remove(false);
          res();
        };
      });
    }
    function doMove(m) {
      const target = m && m.target;
      if (!target) return Promise.resolve();
      const props = {};
      let any = false;
      for (const k in m) {
        if (k === "target" || k === "ms" || k === "ease" || typeof m[k] !== "number") continue;
        props[k] = m[k];
        any = true;
      }
      const land = function() {
        for (const k in props) target[k] = props[k];
      };
      const span2 = number(m.ms, pace * 3);
      if (!any) return Promise.resolve();
      if (still || span2 <= 0 || !scene.tweens) {
        land();
        return Promise.resolve();
      }
      return new Promise(function(res) {
        let tween = null;
        cancel = function() {
          if (tween) tween.stop();
          land();
          res();
        };
        tween = scene.tweens.add(Object.assign({
          targets: target,
          duration: span2,
          ease: m.ease || ease,
          onComplete: function() {
            cancel = null;
            res();
          }
        }, props));
      });
    }
    function doCamera(c) {
      const cam = scene.cameras && scene.cameras.main;
      if (!cam) return Promise.resolve();
      const hasPoint = typeof c.x === "number" || typeof c.y === "number";
      const x = number(c.x, cam.midPoint ? cam.midPoint.x : 0);
      const y = number(c.y, cam.midPoint ? cam.midPoint.y : 0);
      const zoom = typeof c.zoom === "number" ? c.zoom : null;
      const span2 = number(c.ms, pace * 4);
      const land = function() {
        if (hasPoint) cam.centerOn(x, y);
        if (zoom != null) cam.setZoom(zoom);
      };
      if (still || span2 <= 0) {
        land();
        return Promise.resolve();
      }
      return new Promise(function(res) {
        let pending = 0;
        const one = function(_camera, progress) {
          if (progress < 1) return;
          pending -= 1;
          if (pending > 0) return;
          cancel = null;
          res();
        };
        cancel = function() {
          if (cam.panEffect) cam.panEffect.reset();
          if (cam.zoomEffect) cam.zoomEffect.reset();
          land();
          res();
        };
        if (hasPoint) {
          pending += 1;
          cam.pan(x, y, span2, c.ease || ease, true, one);
        }
        if (zoom != null) {
          pending += 1;
          cam.zoomTo(zoom, span2, c.ease || ease, true, one);
        }
        if (!pending) {
          cancel = null;
          res();
        }
      });
    }
    function doFade(kind, msWanted, colour) {
      const tint2 = tone5(th, colour, th.bg);
      const target = kind === "out" ? 1 : 0;
      const span2 = number(msWanted, pace * 2);
      if (!cover) {
        cover = scene.add.rectangle(0, 0, scene.scale.width, scene.scale.height, tint2, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(DIALOGUE_DEPTH - 10);
        cover.setAlpha(kind === "out" ? 0 : 1);
      }
      cover.setFillStyle(tint2, 1);
      if (still || span2 <= 0 || !scene.tweens) {
        cover.setAlpha(target);
        return Promise.resolve();
      }
      return new Promise(function(res) {
        cancel = function() {
          scene.tweens.killTweensOf(cover);
          cover.setAlpha(target);
          res();
        };
        scene.tweens.add({
          targets: cover,
          alpha: target,
          duration: span2,
          ease: "Linear",
          onComplete: function() {
            cancel = null;
            res();
          }
        });
      });
    }
    function doFn(fn) {
      cancel = null;
      return Promise.resolve().then(function() {
        return fn(scene);
      }).then(function() {
        return void 0;
      });
    }
    function runStep2(s) {
      if (!s || typeof s !== "object") return Promise.resolve();
      if (s.say !== void 0) return doSay(s.say);
      if (s.ask !== void 0) return doAsk(s.ask, s.then);
      if (typeof s.wait === "number") return doWait(s.wait);
      if (s.move) return doMove(s.move);
      if (s.camera) return doCamera(s.camera);
      if (typeof s.fn === "function") return doFn(s.fn);
      if (s.fade === "in" || s.fade === "out") return doFade(s.fade, s.ms, s.colour);
      if (s.skip) return Promise.resolve();
      console.warn("[aimeat-phaser] a cutscene step was not understood and was left out:", s);
      return Promise.resolve();
    }
    async function runList(items) {
      for (const s of items) {
        if (stopped) return;
        await runStep2(s);
      }
    }
    function release() {
      pointerHeld = false;
    }
    function drawArc(p) {
      if (!ring2) return;
      ring2.arc.clear();
      if (p <= 0) return;
      ring2.arc.lineStyle(3, th.accent, 1);
      ring2.arc.beginPath();
      ring2.arc.arc(ring2.cx, ring2.cy, ring2.r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p, false);
      ring2.arc.strokePath();
    }
    function tick(_time, delta) {
      if (finished) return;
      const down = pointerHeld || !!(pad2 && (pad2.action || pad2.jump));
      if (!down) {
        if (heldMs > 0) {
          heldMs = 0;
          drawArc(0);
        }
        return;
      }
      heldMs += typeof delta === "number" && isFinite(delta) ? delta : 16;
      const p = Math.min(1, heldMs / HOLD_MS);
      drawArc(p);
      if (p >= 1) skip();
    }
    function armSkip() {
      const r = 9;
      const hgt = 28;
      const label = scene.add.text(0, 0, o.skipLabel || "Hold to skip", {
        fontFamily: th.fontMono || th.font,
        fontSize: "12px",
        color: hex(th.inkDim)
      }).setOrigin(0, 0.5).setScrollFactor(0);
      const w = 12 + Math.ceil(label.width) + 10 + r * 2 + 12;
      const area = { x: 0, y: 0, width: w, height: hgt };
      const plate = scene.add.graphics().setScrollFactor(0);
      plate.fillStyle(th.surface, 0.96);
      plate.fillRoundedRect(0, 0, w, hgt, hgt / 2);
      plate.lineStyle(1, th.line, 1);
      plate.strokeRoundedRect(0, 0, w, hgt, hgt / 2);
      plate.setInteractive({ hitArea: area, hitAreaCallback: inRect, useHandCursor: true });
      plate.on("pointerdown", function() {
        pointerHeld = true;
      });
      plate.on("pointerup", release);
      plate.on("pointerout", release);
      label.setPosition(12, hgt / 2);
      const cx = w - 12 - r;
      const cy = hgt / 2;
      const track = scene.add.graphics().setScrollFactor(0);
      track.lineStyle(2, th.line, 1);
      track.strokeCircle(cx, cy, r);
      const arc = scene.add.graphics().setScrollFactor(0);
      const root = scene.add.container(scene.scale.width - MARGIN3 - w, MARGIN3, [plate, label, track, arc]).setScrollFactor(0).setDepth(DIALOGUE_DEPTH + 5);
      ring2 = { root, arc, cx, cy, r };
      if (scene.events) scene.events.on("update", tick);
      if (scene.input) scene.input.on("pointerup", release);
    }
    function skip() {
      if (stopped || finished) return;
      stopped = true;
      const fn = cancel;
      cancel = null;
      if (fn) fn();
    }
    function cleanup() {
      if (finished) return;
      finished = true;
      cancel = null;
      if (scene.events) {
        scene.events.off("update", tick);
        scene.events.off("shutdown", onShutdown);
      }
      if (scene.input) scene.input.off("pointerup", release);
      if (ring2) {
        ring2.root.destroy();
        ring2 = null;
      }
      if (cover) {
        if (scene.tweens) scene.tweens.killTweensOf(cover);
        cover.destroy();
        cover = null;
      }
      if (own) talk.destroy();
      else talk.hide();
    }
    function onShutdown() {
      skip();
      cleanup();
    }
    if (scene.events && typeof scene.events.once === "function") scene.events.once("shutdown", onShutdown);
    if (skippable) armSkip();
    const done = runList(list).then(function() {
      cleanup();
      return { skipped: stopped };
    }, function(err) {
      cleanup();
      throw err;
    });
    return Object.assign(done, { skip, dialogue: talk });
  }

  // src/static/sdk-libs/phaser/designer-parts.js
  var ONE_LINE = 72;
  function fmt(value, step) {
    const n = Number(value);
    if (!isFinite(n)) return "0";
    const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return n.toFixed(digits);
  }
  function quote(text) {
    return "'" + String(text).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n") + "'";
  }
  function keySource(key) {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? key : quote(key);
  }
  function toSource(value, depth) {
    const level = depth || 0;
    const pad2 = "  ".repeat(level + 1);
    const close = "  ".repeat(level);
    if (Array.isArray(value)) {
      const items = value.map(function(v) {
        return toSource(v, level + 1);
      });
      const flat = items.every(function(item) {
        return item.indexOf("\n") < 0;
      });
      const oneLine = "[" + items.join(", ") + "]";
      if (flat && oneLine.length <= ONE_LINE) return oneLine;
      return "[\n" + items.map(function(item) {
        return pad2 + item;
      }).join(",\n") + "\n" + close + "]";
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value).filter(function(k) {
        return value[k] !== void 0 && typeof value[k] !== "function";
      });
      if (!keys.length) return "{}";
      const parts = keys.map(function(k) {
        return keySource(k) + ": " + toSource(value[k], level + 1);
      });
      const oneLine = "{ " + parts.join(", ") + " }";
      const flat = parts.every(function(part) {
        return part.indexOf("\n") < 0;
      });
      if (flat && oneLine.length <= ONE_LINE) return oneLine;
      return "{\n" + parts.map(function(part) {
        return pad2 + part;
      }).join(",\n") + "\n" + close + "}";
    }
    if (typeof value === "string") return quote(value);
    if (typeof value === "number") return isFinite(value) ? String(Math.round(value * 1e3) / 1e3) : "0";
    if (typeof value === "boolean") return String(value);
    return "null";
  }
  function rangeField(host, spec) {
    const id = uid("akd");
    const out = el("output", { class: "ak-designer__value", for: id });
    const input = (
      /** @type {HTMLInputElement} */
      el("input", {
        id,
        type: "range",
        class: "ak-input ak-designer__range",
        min: String(spec.min),
        max: String(spec.max),
        step: String(spec.step),
        on: {
          input: function() {
            show();
            if (spec.onInput) spec.onInput(Number(input.value));
          },
          change: function() {
            show();
            if (spec.onChange) spec.onChange(Number(input.value));
          }
        }
      })
    );
    function show() {
      out.textContent = fmt(Number(input.value), spec.step) + (spec.unit || "");
    }
    const label = el("label", { class: spec.srOnly ? "ak-sr-only" : "ak-form__label", for: id, text: spec.label });
    const control = el("div", { class: "ak-designer__control" }, [input, out]);
    host.appendChild(el("div", {
      class: spec.srOnly ? "ak-designer__half" : "ak-form__field ak-designer__field"
    }, [label, control]));
    const api = {
      input,
      /** @param {number} value */
      set: function(value) {
        input.value = String(value);
        show();
      }
    };
    api.set(spec.value);
    return api;
  }
  function pairField(host, spec) {
    const box2 = el("fieldset", { class: "ak-designer__field ak-designer__pair" }, el("legend", {
      class: "ak-form__label",
      text: spec.label + " (" + spec.words[0] + " / " + spec.words[1] + ")"
    }));
    host.appendChild(box2);
    const halves = [];
    const pair = function() {
      return [Number(halves[0].input.value), Number(halves[1].input.value)];
    };
    for (let i = 0; i < 2; i += 1) {
      halves.push(rangeField(box2, {
        srOnly: true,
        label: spec.label + ", " + spec.words[i],
        min: spec.min,
        max: spec.max,
        step: spec.step,
        unit: spec.unit,
        value: spec.value[i],
        onInput: function() {
          if (spec.onInput) spec.onInput(pair());
        },
        onChange: function() {
          if (spec.onChange) spec.onChange(pair());
        }
      }));
    }
    return {
      inputs: [halves[0].input, halves[1].input],
      /** @param {[number, number]} value */
      set: function(value) {
        halves[0].set(value[0]);
        halves[1].set(value[1]);
      }
    };
  }
  function fill2(select, options) {
    clear(select);
    for (const option of options) select.appendChild(el("option", { value: option.value, text: option.text }));
  }
  function selectField(host, spec) {
    const id = uid("akd");
    const select = (
      /** @type {HTMLSelectElement} */
      el("select", {
        id,
        class: "ak-input ak-designer__select",
        on: { change: function() {
          spec.onChange(select.value);
        } }
      })
    );
    fill2(select, spec.options);
    select.value = spec.value;
    host.appendChild(el("div", {
      class: "ak-form__field ak-designer__field" + (spec.inline ? " ak-designer__field--inline" : "")
    }, [
      el("label", { class: "ak-form__label", for: id, text: spec.label }),
      select
    ]));
    return {
      select,
      /** @param {string} value */
      set: function(value) {
        select.value = value;
      },
      /** @param {Choice[]} options */
      options: function(options) {
        const kept = select.value;
        fill2(select, options);
        select.value = kept;
      }
    };
  }
  function toggleField(host, spec) {
    const id = uid("akd");
    const input = (
      /** @type {HTMLInputElement} */
      el("input", {
        id,
        type: "checkbox",
        class: "ak-toggle",
        on: { change: function() {
          spec.onChange(input.checked);
        } }
      })
    );
    input.checked = !!spec.checked;
    host.appendChild(el("div", { class: "ak-form__field ak-form__field--inline ak-designer__field ak-designer__field--inline" }, [
      input,
      el("label", { class: "ak-form__label", for: id, text: spec.label })
    ]));
    return {
      input,
      /** @param {boolean} on */
      set: function(on) {
        input.checked = !!on;
      }
    };
  }
  function button(label, run, opts) {
    const o = opts || {};
    return (
      /** @type {HTMLButtonElement} */
      el("button", {
        type: "button",
        class: "ak-btn " + (o.primary ? "ak-btn--primary" : "ak-btn--ghost"),
        "data-ak-noguard": true,
        "aria-label": o.ariaLabel || null,
        on: { click: function() {
          run();
        } }
      }, label)
    );
  }
  function notes(host) {
    const status2 = el("p", { class: "ak-designer__status", role: "status" });
    const box2 = (
      /** @type {HTMLTextAreaElement} */
      el("textarea", {
        class: "ak-designer__code",
        readonly: true,
        hidden: true,
        rows: "10",
        spellcheck: "false",
        "aria-label": "The code and the settings, as text"
      })
    );
    host.appendChild(status2);
    host.appendChild(box2);
    return {
      say: function(words) {
        status2.textContent = words;
      },
      show: function(text) {
        box2.value = text;
        box2.hidden = false;
      },
      hide: function() {
        box2.value = "";
        box2.hidden = true;
      }
    };
  }
  function copyText(text) {
    const clip = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (!clip || typeof clip.writeText !== "function") return Promise.resolve(false);
    return clip.writeText(text).then(function() {
      return true;
    }, function(err) {
      console.warn("[aimeat-phaser] the clipboard refused the code:", err);
      return false;
    });
  }

  // src/static/sdk-libs/phaser/designer-fx.js
  var FAMILIES = { at: "Bursts", weather: "Weather", follow: "Follow" };
  var WORDS = ["accent", "ink", "inkDim", "ok", "warn", "err", "ch1", "ch2", "ch3", "ch4", "surface", "bg", "line"];
  var TEMP = "ak-designer";
  var BURST_PACE = 160;
  var ASSEMBLED = { texture: 1, frame: 1, emitting: 1, emitZone: 1, deathZone: 1 };
  var DEFAULT_COUNT = 12;
  var CONTROLS = [
    { key: "count", label: "Particles per burst", min: 1, max: 120, step: 1, families: ["at"] },
    { key: "density", label: "Density", min: 0, max: 3, step: 0.05, families: ["weather", "follow"] },
    { key: "wind", label: "Wind", min: -300, max: 300, step: 5, unit: " px/s", families: ["weather"] },
    { key: "speed", label: "Speed", pair: "range", min: 0, max: 800, step: 5, unit: " px/s", families: ["at", "weather", "follow"] },
    { key: "angle", label: "Angle", pair: "range", min: -360, max: 360, step: 5, unit: " deg", families: ["at", "weather", "follow"], radial: true },
    { key: "lifespan", label: "Lifespan", pair: "range", min: 50, max: 1e4, step: 50, unit: " ms", families: ["at", "weather", "follow"] },
    { key: "scale", label: "Scale", pair: "life", min: 0, max: 4, step: 0.05, families: ["at", "weather", "follow"] },
    { key: "alpha", label: "Alpha", pair: "life", min: 0, max: 1, step: 0.05, families: ["at", "weather", "follow"] },
    { key: "gravityY", label: "Gravity", min: -800, max: 800, step: 10, families: ["at", "weather", "follow"] },
    { key: "rotate", label: "Rotation", pair: "range", min: -360, max: 360, step: 5, unit: " deg", families: ["at", "weather", "follow"] },
    { key: "quantity", label: "Particles per emission", min: 1, max: 20, step: 1, families: ["follow"] },
    { key: "frequency", label: "Time between emissions", min: 0, max: 1e3, step: 5, unit: " ms", families: ["follow"] }
  ];
  function readPair(value) {
    if (typeof value === "number") return [value, value];
    if (value && typeof value === "object") {
      if (typeof value.start === "number") return [value.start, typeof value.end === "number" ? value.end : value.start];
      if (typeof value.min === "number") return [value.min, typeof value.max === "number" ? value.max : value.min];
      if (Array.isArray(value.values) && value.values.length) {
        return [Math.max.apply(null, value.values), value.values[value.values.length - 1]];
      }
    }
    return [0, 0];
  }
  function pairMode(value, fallback) {
    if (value && typeof value === "object") {
      if (typeof value.start === "number") return "life";
      if (typeof value.min === "number") return "range";
    }
    return fallback;
  }
  function writePair(mode, a, b) {
    return mode === "life" ? { start: a, end: b } : { min: Math.min(a, b), max: Math.max(a, b) };
  }
  function top(value) {
    const pair = readPair(value);
    return Math.max(pair[0], pair[1]);
  }
  function baseOf(fx2, name, family) {
    const known = PRESETS[ALIASES[name] || name];
    if (known && known[family]) return known;
    const cfg2 = typeof fx2.preset === "function" ? fx2.preset(name, family) : null;
    if (!cfg2 || typeof cfg2 !== "object") return null;
    const config = {};
    for (const key in cfg2) if (!ASSEMBLED[key]) config[key] = cfg2[key];
    const fam = { life: top(config.lifespan) || 1e3, config };
    if (family === "at") fam.count = DEFAULT_COUNT;
    if (family === "weather") {
      fam.zone = "top";
      fam.rate = 1e3 / Math.max(1, Number(config.frequency) || 1e3) * (Number(config.quantity) || 1);
      delete config.frequency;
      delete config.quantity;
    }
    const out = { texture: cfg2.texture };
    if (cfg2.frame !== void 0) out.frame = cfg2.frame;
    out[family] = fam;
    return out;
  }
  function fxDesigner(spec) {
    const s = spec || /** @type {any} */
    {};
    const fx2 = s.fx;
    if (!fx2 || typeof fx2.define !== "function") {
      throw new Error("fxDesigner wants the fx handle: pass fx: AIMEAT.phaser.fx(scene).");
    }
    const family = FAMILIES[s.family] ? s.family : "at";
    const temp = uid(TEMP);
    const root = el("div", { class: "ak-root ak-designer ak-designer--fx" });
    resolve(s.target, document.body).appendChild(root);
    let state = null;
    let standing = null;
    let burst = null;
    let timer = null;
    let gone = false;
    function kindsOf() {
      const list = typeof fx2.kinds === "function" ? fx2.kinds(family) : Object.keys(PRESETS);
      return list.filter(function(name) {
        return name.indexOf(TEMP + "-") !== 0;
      });
    }
    function fresh(name, base) {
      const fam = base[family] || {};
      return {
        name,
        base,
        touched: {},
        count: typeof fam.count === "number" ? fam.count : DEFAULT_COUNT,
        density: 1,
        wind: typeof fam.wind === "number" ? fam.wind : 0,
        tint: "",
        additive: false
      };
    }
    function baseConfig() {
      return state.base[family] && state.base[family].config || {};
    }
    function current(key) {
      return state.touched[key] !== void 0 ? state.touched[key] : baseConfig()[key];
    }
    function directional() {
      const cfg2 = baseConfig();
      return cfg2.speedY !== void 0 && cfg2.speed === void 0;
    }
    function definition(forExport) {
      const base = state.base;
      const fam = merge(base[family]);
      const config = merge(fam.config, state.touched);
      if (state.additive) config.blendMode = "ADD";
      fam.config = config;
      if (family === "at") fam.count = state.count;
      if (state.touched.lifespan !== void 0) fam.life = top(state.touched.lifespan);
      const def = {};
      if (base.texture) {
        def.texture = base.texture;
        if (base.frame !== void 0) def.frame = base.frame;
      } else {
        def.shape = base.shape || "dot";
      }
      def.colours = forExport && state.tint ? [state.tint] : (base.colours || ["accent"]).slice();
      def[family] = fam;
      return def;
    }
    function liveOptions() {
      const o = { colour: state.tint || void 0 };
      if (family === "weather") {
        o.density = state.density;
        o.wind = state.wind;
      }
      if (family === "follow") o.density = state.density;
      return o;
    }
    function exportOptions() {
      const o = {};
      if (family !== "at" && state.density !== 1) o.density = state.density;
      if (family === "weather" && state.wind !== state.base.weather.wind && !(state.wind === 0 && state.base.weather.wind == null)) {
        o.wind = state.wind;
      }
      return Object.keys(o).length ? o : null;
    }
    function code() {
      const name = quote("my-" + state.name);
      const opts = exportOptions();
      const tail = opts ? ", " + toSource(opts, 0) : "";
      const lines = ["fx.define(" + name + ", " + toSource(definition(true), 0) + ");"];
      if (family === "at") lines.push("fx.at(x, y, " + name + tail + ");");
      else if (family === "weather") lines.push("const sky = fx.weather(" + name + tail + ");");
      else lines.push("const rider = fx.follow(target, " + name + tail + ");");
      return lines.join("\n");
    }
    function json() {
      return JSON.stringify({
        preset: "my-" + state.name,
        family,
        definition: definition(true),
        options: exportOptions() || {}
      }, null, 2);
    }
    function where() {
      if (typeof s.x === "number" && typeof s.y === "number") return { x: s.x, y: s.y };
      const cam = s.scene && s.scene.cameras && s.scene.cameras.main;
      if (cam) return { x: (cam.scrollX || 0) + cam.width / 2, y: (cam.scrollY || 0) + cam.height / 2 };
      return { x: 0, y: 0 };
    }
    function fire2() {
      const at = where();
      if (family === "at") {
        burst = fx2.at(at.x, at.y, temp, liveOptions()) || null;
      } else if (family === "weather") {
        standing = fx2.weather(temp, liveOptions()) || null;
      } else {
        if (standing) standing.stop();
        standing = fx2.follow(s.follow || at, temp, liveOptions()) || null;
      }
    }
    function cancelQueue() {
      if (timer == null) return;
      clearTimeout(timer);
      timer = null;
    }
    function queue() {
      if (family !== "at" || timer != null) return;
      timer = setTimeout(function() {
        timer = null;
        if (!gone) apply("drag");
      }, BURST_PACE);
    }
    function apply(key) {
      cancelQueue();
      fx2.define(temp, definition(false));
      const cheap = standing && standing.active !== false && family !== "at" && (key === "density" || key === "wind" || key === "tint");
      if (cheap) standing.set(liveOptions());
      else fire2();
      tell();
    }
    function tell() {
      if (typeof s.onChange !== "function") return;
      try {
        s.onChange({ family, preset: state.name, definition: definition(true), options: exportOptions(), code: code() });
      } catch (err) {
        console.warn("[aimeat-phaser] an fxDesigner onChange listener threw:", err);
      }
    }
    function kill(emitter) {
      if (!emitter || emitter.scene === void 0) return;
      if (typeof emitter.killAll === "function") emitter.killAll();
      if (typeof emitter.stop === "function") emitter.stop();
    }
    const head = el("div", { class: "ak-designer__head" });
    const grid = el("div", { class: "ak-designer__grid" });
    const names = kindsOf();
    const opening = names.indexOf(s.preset) >= 0 ? s.preset : names[0];
    const picker = selectField(head, {
      label: "Preset",
      value: opening || "",
      options: names.map(function(name) {
        return { value: name, text: name };
      }),
      onChange: choose
    });
    head.appendChild(el("p", { class: "ak-designer__caption", text: FAMILIES[family] }));
    root.appendChild(head);
    root.appendChild(grid);
    root.appendChild(el("div", { class: "ak-designer__bar" }, [
      button("Play", play, { primary: true }),
      button("Stop", stop),
      button("Reset to preset", reset),
      el("span", { class: "ak-designer__push" }),
      button("Copy as JS", copy),
      button("Export JSON", exportJson)
    ]));
    const note = notes(root);
    function control(c) {
      const key = c.key === "speed" && directional() ? "speedY" : c.key;
      const label = key === "speedY" ? "Vertical speed" : c.label;
      const setting = key === "count" || key === "density" || key === "wind";
      const write = function(v) {
        if (setting) state[key] = v;
        else state.touched[key] = v;
      };
      if (c.pair) {
        const mode = pairMode(baseConfig()[key], c.pair);
        pairField(grid, {
          label,
          words: mode === "life" ? ["start", "end"] : ["min", "max"],
          min: key === "speedY" ? -c.max : c.min,
          max: c.max,
          step: c.step,
          unit: c.unit,
          value: readPair(current(key)),
          onInput: function(v) {
            state.touched[key] = writePair(mode, v[0], v[1]);
            queue();
          },
          onChange: function(v) {
            state.touched[key] = writePair(mode, v[0], v[1]);
            apply(key);
          }
        });
        return;
      }
      const value = setting ? state[key] : current(key);
      rangeField(grid, {
        label,
        min: c.min,
        max: c.max,
        step: c.step,
        unit: c.unit,
        value: typeof value === "number" ? value : 0,
        onInput: function(v) {
          write(v);
          queue();
        },
        onChange: function(v) {
          write(v);
          apply(key);
        }
      });
    }
    function buildGrid() {
      clear(grid);
      for (const c of CONTROLS) {
        if (c.families.indexOf(family) < 0) continue;
        if (c.radial && directional()) continue;
        control(c);
      }
      selectField(grid, {
        label: "Colour",
        value: state.tint,
        options: [{ value: "", text: "The preset's own" }].concat(WORDS.map(function(w) {
          return { value: w, text: w };
        })),
        onChange: function(v) {
          state.tint = v;
          apply("tint");
        }
      });
      toggleField(grid, {
        label: "Additive blend",
        checked: state.additive,
        onChange: function(on) {
          state.additive = on;
          apply("additive");
        }
      });
    }
    function choose(name) {
      const base = baseOf(fx2, name, family);
      if (!base) {
        note.say('The preset "' + name + '" has no ' + FAMILIES[family].toLowerCase() + " form. Pick another.");
        if (state) picker.set(state.name);
        return;
      }
      state = fresh(name, base);
      picker.set(name);
      buildGrid();
      note.say("");
      apply("preset");
    }
    function play() {
      if (!state) return;
      fx2.define(temp, definition(false));
      fire2();
      note.say("");
    }
    function stop() {
      if (standing) {
        standing.stop();
        standing = null;
      }
      if (burst) {
        kill(burst);
        burst = null;
      }
      cancelQueue();
      note.say("Stopped. Play fires it again.");
    }
    function reset() {
      if (!state) return;
      state = fresh(state.name, state.base);
      buildGrid();
      apply("reset");
      note.say("Back to the preset.");
    }
    function copy() {
      if (!state) return;
      const text = code();
      copyText(text).then(function(ok) {
        if (gone) return;
        if (ok) {
          note.say("Copied. Paste it into your scene.");
          return;
        }
        note.show(text);
        note.say("This browser keeps the clipboard closed. The code is in the box below.");
      });
    }
    function exportJson() {
      if (!state) return;
      note.show(json());
      note.say("The preset as JSON is in the box below.");
    }
    const api = {
      el: root,
      /** The preset as the code writes it, tint included. @returns {any} */
      definition() {
        return state ? definition(true) : null;
      },
      /** The define() and the call line. @returns {string} */
      code() {
        return state ? code() : "";
      },
      play,
      stop,
      reset,
      destroy() {
        if (gone) return;
        gone = true;
        cancelQueue();
        if (standing) {
          standing.stop();
          standing = null;
        }
        burst = null;
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
    if (opening) choose(opening);
    else note.say("fx has no preset with a " + FAMILIES[family].toLowerCase() + " form. Define one first.");
    return api;
  }

  // src/static/sdk-libs/phaser/designer-parallax.js
  var TONES2 = [
    "bg",
    "surface",
    "ink",
    "inkDim",
    "line",
    "accent",
    "ok",
    "warn",
    "err",
    "ch1",
    "ch2",
    "ch3",
    "ch4",
    "light",
    "dark"
  ];
  var TIMES2 = [
    { value: "", text: "The preset's own" },
    { value: "day", text: "Day" },
    { value: "dusk", text: "Dusk" },
    { value: "night", text: "Night" }
  ];
  var LAYER_CONTROLS = [
    { key: "scroll", label: "Scroll", min: 0, max: 1, step: 0.01 },
    { key: "alpha", label: "Alpha", min: 0, max: 1, step: 0.05 },
    { key: "height", label: "Height", min: 0.02, max: 1, step: 0.02 },
    { key: "haze", label: "Haze", min: 0, max: 1, step: 0.05 },
    { key: "drift", label: "Drift", min: -60, max: 60, step: 1, unit: " px/s" }
  ];
  var OWN = { kind: 1, name: 1, scroll: 1, tone: 1, alpha: 1, height: 1, haze: 1, drift: 1, depth: 1 };
  var SEED_MAX = 1e6;
  function word(kind) {
    const text = String(kind || "");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  function slim(spec) {
    const d = KIND_DEFAULTS[spec.kind] || /** @type {any} */
    {};
    const out = { kind: spec.kind };
    if (spec.name && spec.name !== spec.kind) out.name = spec.name;
    const sx = spec.scroll && typeof spec.scroll === "object" ? spec.scroll.x : spec.scroll;
    const sy = spec.scroll && typeof spec.scroll === "object" ? spec.scroll.y : 0;
    if (sy) out.scroll = { x: sx, y: sy };
    else if (typeof sx === "number" && sx !== d.scroll) out.scroll = sx;
    for (const key of ["tone", "alpha", "height", "haze", "drift"]) {
      if (spec[key] !== void 0 && spec[key] !== d[key]) out[key] = spec[key];
    }
    for (const key in spec) if (!OWN[key] && spec[key] !== void 0) out[key] = spec[key];
    return out;
  }
  function bare(spec) {
    const out = {};
    for (const key in spec) if (key !== "depth") out[key] = spec[key];
    return out;
  }
  function parallaxDesigner(spec) {
    const s = spec || /** @type {any} */
    {};
    const handle = s.parallax;
    if (!handle || typeof handle.set !== "function" || typeof handle.layer !== "function") {
      throw new Error("parallaxDesigner wants the parallax handle: pass parallax: AIMEAT.phaser.parallax(scene, spec).");
    }
    const state = {
      preset: PARALLAX_PRESETS.indexOf(s.preset) >= 0 ? s.preset : "hills",
      time: TIMES2.some(function(t) {
        return t.value === s.time;
      }) ? s.time : "",
      seed: typeof s.seed === "number" ? s.seed : 1,
      drift: typeof s.drift === "number" ? s.drift : 1,
      /** @type {Record<string, boolean>} layer names hidden for a look, still in the stack */
      hidden: {}
    };
    const root = el("div", { class: "ak-root ak-designer ak-designer--parallax" });
    resolve(s.target, document.body).appendChild(root);
    let rows = [];
    let gone = false;
    function exportSpec() {
      const out = { preset: state.preset };
      if (state.time) out.time = state.time;
      out.seed = state.seed;
      if (state.drift !== 1) out.drift = state.drift;
      out.layers = handle.layers.filter(function(h) {
        return !state.hidden[h.name];
      }).map(function(h) {
        return slim(h.spec);
      });
      return out;
    }
    function code() {
      return "const bg = AIMEAT.phaser.parallax(this, " + toSource(exportSpec(), 0) + ");";
    }
    function json() {
      return JSON.stringify(exportSpec(), null, 2);
    }
    function stack() {
      return handle.layers.map(function(h) {
        return bare(h.spec);
      });
    }
    function tell() {
      if (typeof s.onChange !== "function") return;
      try {
        s.onChange({ spec: exportSpec(), code: code() });
      } catch (err) {
        console.warn("[aimeat-phaser] a parallaxDesigner onChange listener threw:", err);
      }
    }
    function reapplyHidden() {
      for (const name in state.hidden) {
        const L = handle.layer(name);
        if (L && typeof L.setVisible === "function") L.setVisible(false);
      }
    }
    function after(structural) {
      reapplyHidden();
      if (structural) buildRows();
      else syncRows();
      tell();
    }
    function valueOf(spec2, key) {
      if (key === "scroll") {
        const sc = spec2.scroll;
        if (sc && typeof sc === "object") return typeof sc.x === "number" ? sc.x : 0;
        return typeof sc === "number" ? sc : 0;
      }
      return typeof spec2[key] === "number" ? spec2[key] : 0;
    }
    function toneOptions(current) {
      const list2 = TONES2.map(function(w) {
        return { value: w, text: w };
      });
      const now = String(current);
      if (TONES2.indexOf(now) < 0) list2.unshift({ value: now, text: now });
      return list2;
    }
    function change(name, key, value) {
      const L = handle.layer(name);
      if (!L) {
        buildRows();
        return;
      }
      const patch = {};
      if (key === "scroll") {
        const sc = L.spec && L.spec.scroll;
        patch.scroll = { x: value, y: sc && typeof sc === "object" && typeof sc.y === "number" ? sc.y : 0 };
      } else if (key === "tone") {
        patch.tone = /^-?\d+$/.test(value) ? Number(value) : value;
      } else {
        patch[key] = value;
      }
      L.set(patch);
      after(false);
    }
    function row(h) {
      const name = h.name;
      const hid = uid("akd");
      const section2 = el("section", { class: "ak-designer__layer", "aria-labelledby": hid });
      const headEl = el("div", { class: "ak-designer__layer-head" }, el("h3", { class: "ak-designer__kind", id: hid }, [
        word(h.kind),
        name !== h.kind ? el("span", { class: "ak-designer__name", text: name }) : null
      ]));
      const visible = toggleField(headEl, {
        label: "Visible",
        checked: !state.hidden[name],
        onChange: function(on) {
          if (on) delete state.hidden[name];
          else state.hidden[name] = true;
          const L = handle.layer(name);
          if (L && typeof L.setVisible === "function") L.setVisible(on);
          tell();
        }
      });
      headEl.appendChild(button("Remove", function() {
        const patch = {};
        patch[name] = false;
        handle.set({ layers: patch });
        delete state.hidden[name];
        after(true);
        note.say("The " + name + " layer is gone.");
      }, { ariaLabel: "Remove the " + name + " layer" }));
      section2.appendChild(headEl);
      const grid = el("div", { class: "ak-designer__grid ak-designer__grid--layer" });
      const tone6 = selectField(grid, {
        label: "Tone",
        options: toneOptions(h.spec.tone),
        value: String(h.spec.tone),
        onChange: function(v) {
          change(name, "tone", v);
        }
      });
      const fields = {};
      for (const c of LAYER_CONTROLS) {
        if (c.key === "height" && h.kind === "sky") continue;
        fields[c.key] = rangeField(grid, {
          label: c.label,
          min: c.min,
          max: c.max,
          step: c.step,
          unit: c.unit,
          value: valueOf(h.spec, c.key),
          onChange: function(v) {
            change(name, c.key, v);
          }
        });
      }
      section2.appendChild(grid);
      return {
        name,
        el: section2,
        /** @param {any} next  the layer's handle after a rebuild */
        read: function(next) {
          tone6.options(toneOptions(next.spec.tone));
          tone6.set(String(next.spec.tone));
          for (const key in fields) fields[key].set(valueOf(next.spec, key));
          visible.set(!state.hidden[name]);
        }
      };
    }
    function buildRows() {
      clear(list);
      rows = handle.layers.map(row);
      for (const r of rows) list.appendChild(r.el);
    }
    function syncRows() {
      for (const r of rows) {
        const h = handle.layer(r.name);
        if (!h) {
          buildRows();
          return;
        }
        r.read(h);
      }
    }
    const top2 = el("div", { class: "ak-designer__grid" });
    selectField(top2, {
      label: "Preset",
      value: state.preset,
      options: PARALLAX_PRESETS.map(function(name) {
        return { value: name, text: name };
      }),
      onChange: function(v) {
        state.preset = v;
        state.hidden = {};
        handle.set({ preset: v });
        after(true);
        note.say("");
      }
    });
    selectField(top2, {
      label: "Time of day",
      value: state.time,
      options: TIMES2,
      onChange: function(v) {
        state.time = v;
        handle.set({ time: v || void 0 });
        after(false);
      }
    });
    const seedId = uid("akd");
    const seedInput = (
      /** @type {HTMLInputElement} */
      el("input", {
        id: seedId,
        type: "number",
        class: "ak-input ak-designer__number",
        min: "0",
        max: String(SEED_MAX),
        step: "1",
        on: { change: function() {
          seed(Math.floor(Number(seedInput.value)));
        } }
      })
    );
    seedInput.value = String(state.seed);
    top2.appendChild(el("div", { class: "ak-form__field ak-designer__field" }, [
      el("label", { class: "ak-form__label", for: seedId, text: "Seed" }),
      el("div", { class: "ak-designer__control" }, [
        seedInput,
        button("Reroll", function() {
          seed(Math.floor(Math.random() * SEED_MAX));
        })
      ])
    ]));
    rangeField(top2, {
      label: "Drift",
      min: 0,
      max: 3,
      step: 0.1,
      value: state.drift,
      onChange: function(v) {
        state.drift = v;
        handle.set({ drift: v });
        after(false);
      }
    });
    root.appendChild(top2);
    const list = el("div", { class: "ak-designer__layers" });
    root.appendChild(list);
    const addRow = el("div", { class: "ak-designer__add" });
    const addPicker = selectField(addRow, {
      label: "Add a layer",
      value: KINDS[0],
      options: KINDS.map(function(kind) {
        return { value: kind, text: word(kind) };
      }),
      onChange: function() {
      }
    });
    addRow.appendChild(button("Add", function() {
      const kind = addPicker.select.value;
      handle.set({ layers: stack().concat([{ kind }]) });
      after(true);
      note.say("A " + kind + " layer was added at the front.");
    }));
    root.appendChild(addRow);
    root.appendChild(el("div", { class: "ak-designer__bar" }, [
      el("span", { class: "ak-designer__push" }),
      button("Copy as JS", copy),
      button("Export JSON", exportJson)
    ]));
    const note = notes(root);
    function seed(n) {
      const next = isFinite(n) ? Math.max(0, Math.min(SEED_MAX, n)) : state.seed;
      state.seed = next;
      seedInput.value = String(next);
      handle.set({ seed: next });
      after(false);
    }
    function hiddenWords() {
      const n = Object.keys(state.hidden).length;
      if (!n) return "";
      return n === 1 ? " The one hidden layer was left out." : " The " + n + " hidden layers were left out.";
    }
    function copy() {
      const text = code();
      copyText(text).then(function(ok) {
        if (gone) return;
        if (ok) {
          note.say("Copied. Paste it into your scene." + hiddenWords());
          return;
        }
        note.show(text);
        note.say("This browser keeps the clipboard closed. The code is in the box below." + hiddenWords());
      });
    }
    function exportJson() {
      note.show(json());
      note.say("The backdrop as JSON is in the box below." + hiddenWords());
    }
    const api = {
      el: root,
      /** The spec the code writes. @returns {any} */
      spec: exportSpec,
      /** The parallax() call. @returns {string} */
      code,
      /** Read the stack again, for an app that changed it itself. */
      refresh() {
        if (gone) return;
        after(true);
      },
      destroy() {
        if (gone) return;
        gone = true;
        rows = [];
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
    buildRows();
    return api;
  }

  // src/static/sdk-libs/phaser/boss-bar.js
  function toneColour2(th, want, fallback) {
    if (typeof want === "number" && isFinite(want)) return want;
    const key = want === "dim" ? "inkDim" : want;
    return typeof key === "string" && typeof th[key] === "number" ? th[key] : fallback;
  }
  function motionPool2(scene) {
    const flying = /* @__PURE__ */ new Set();
    return {
      run(config) {
        const after = config.onComplete;
        let t = null;
        config.onComplete = function() {
          if (t) flying.delete(t);
          if (typeof after === "function") after();
        };
        t = scene.tweens.add(config);
        flying.add(t);
        return t;
      },
      stop(target) {
        scene.tweens.killTweensOf(target);
        for (const t of Array.from(flying)) {
          if (t && Array.isArray(t.targets) && t.targets.indexOf(target) >= 0) flying.delete(t);
        }
      },
      killAll() {
        for (const t of flying) {
          if (!t) continue;
          if (typeof t.remove === "function") t.remove();
          else if (typeof t.stop === "function") t.stop();
        }
        flying.clear();
      }
    };
  }
  var BAR_DEPTH = 920;
  var TOP = 14;
  var NAME_SIZE = 14;
  var BAR_H2 = 12;
  var BAR_DY = 20;
  var SHARE = 0.6;
  var CLEAR = 140;
  var MIN_W = 120;
  var LAG_HOLD = 2;
  var LAG_MOVE = 2.5;
  function bossBar(scene, opts) {
    const o = opts || /** @type {BossBarOptions} */
    {};
    const th = o.theme || look(scene);
    const pace = ms(th.motion, 200);
    const ease = curve(th);
    const depth = typeof o.depth === "number" ? o.depth : BAR_DEPTH;
    const top2 = typeof o.y === "number" ? o.y : TOP;
    const share = typeof o.share === "number" && o.share > 0 ? Math.min(1, o.share) : SHARE;
    const tone6 = toneColour2(th, o.tone, th.err);
    const pool = motionPool2(scene);
    const bounds = (o.phases || []).map(function(p) {
      return p && typeof p.at === "number" ? p.at : 1;
    }).filter(function(at) {
      return at > 0 && at < 1;
    });
    let fraction = 1;
    const shown = { fill: 1, lag: 1 };
    let width = MIN_W;
    let dead = false;
    let visible = true;
    let lagTimer = null;
    let lagTween = null;
    const box2 = scene.add.container(0, top2).setScrollFactor(0).setDepth(depth);
    const nameText = scene.add.text(0, 0, o.name != null ? String(o.name) : "", {
      fontFamily: th.fontDisplay,
      fontSize: NAME_SIZE + "px",
      color: hex(th.ink)
    }).setOrigin(0, 0);
    const phaseText = scene.add.text(0, 2, "", {
      fontFamily: th.fontMono,
      fontSize: "11px",
      color: hex(th.inkDim)
    }).setOrigin(1, 0);
    const back = scene.add.graphics().setPosition(0, BAR_DY);
    const lag = scene.add.graphics().setPosition(0, BAR_DY);
    const fill3 = scene.add.graphics().setPosition(0, BAR_DY);
    const ticks = scene.add.graphics().setPosition(0, BAR_DY);
    const flashG = scene.add.graphics().setPosition(0, BAR_DY).setAlpha(0);
    box2.add([back, lag, fill3, ticks, flashG, nameText, phaseText]);
    function viewWidth() {
      const cam = scene.cameras && scene.cameras.main;
      return cam && typeof cam.width === "number" ? cam.width : scene.scale.width;
    }
    function drawFills() {
      const r = BAR_H2 / 2;
      lag.clear();
      const lw = Math.round(width * Math.max(0, Math.min(1, shown.lag)));
      if (lw >= 1) {
        lag.fillStyle(th.warn, 0.85);
        lag.fillRoundedRect(0, 0, lw, BAR_H2, Math.min(r, lw / 2));
      }
      fill3.clear();
      const fw = Math.round(width * Math.max(0, Math.min(1, shown.fill)));
      if (fw >= 1) {
        fill3.fillStyle(tone6, 1);
        fill3.fillRoundedRect(0, 0, fw, BAR_H2, Math.min(r, fw / 2));
      }
    }
    function drawFrame() {
      const r = BAR_H2 / 2;
      back.clear();
      back.fillStyle(th.surface, 0.9);
      back.fillRoundedRect(0, 0, width, BAR_H2, r);
      back.lineStyle(1, th.line, 1);
      back.strokeRoundedRect(0, 0, width, BAR_H2, r);
      ticks.clear();
      ticks.lineStyle(1, th.ink, 0.55);
      for (const at of bounds) {
        const x = Math.round(width * at) + 0.5;
        ticks.lineBetween(x, -2, x, BAR_H2 + 2);
      }
      flashG.clear();
      flashG.fillStyle(th.ink, 1);
      flashG.fillRoundedRect(0, 0, width, BAR_H2, r);
    }
    function layout() {
      if (dead) return;
      const vw = viewWidth();
      width = Math.max(MIN_W, Math.min(Math.round(vw * share), vw - CLEAR * 2));
      box2.setPosition(Math.round((vw - width) / 2), top2);
      phaseText.setX(width);
      drawFrame();
      drawFills();
    }
    function dropLagTimer() {
      if (!lagTimer) return;
      lagTimer.remove(false);
      lagTimer = null;
    }
    function dropLagTween() {
      if (!lagTween) return;
      const t = lagTween;
      lagTween = null;
      if (typeof t.remove === "function") t.remove();
      else if (typeof t.stop === "function") t.stop();
    }
    function chaseLag() {
      dropLagTimer();
      dropLagTween();
      lagTimer = scene.time.delayedCall(pace * LAG_HOLD, function() {
        lagTimer = null;
        if (dead) return;
        if (reducedMotion() || !scene.tweens) {
          shown.lag = fraction;
          drawFills();
          return;
        }
        lagTween = pool.run({
          targets: shown,
          lag: fraction,
          duration: pace * LAG_MOVE,
          ease,
          onUpdate: drawFills,
          onComplete: function() {
            lagTween = null;
            drawFills();
          }
        });
      });
    }
    function set(want, setOpts) {
      if (dead) return;
      const next = Math.max(0, Math.min(1, typeof want === "number" && isFinite(want) ? want : 0));
      const prev = fraction;
      fraction = next;
      const snap = setOpts && setOpts.instant || reducedMotion() || !scene.tweens;
      dropLagTimer();
      dropLagTween();
      pool.stop(shown);
      if (next >= prev) {
        shown.lag = Math.max(shown.lag, next);
        if (snap) {
          shown.fill = next;
          shown.lag = next;
          drawFills();
          return;
        }
        shown.lag = next;
        pool.run({ targets: shown, fill: next, duration: pace * 1.5, ease, onUpdate: drawFills, onComplete: drawFills });
        return;
      }
      if (snap) {
        shown.fill = next;
        if (setOpts && setOpts.instant) shown.lag = next;
        drawFills();
        if (!(setOpts && setOpts.instant)) chaseLag();
        return;
      }
      pool.run({ targets: shown, fill: next, duration: Math.max(60, pace * 0.6), ease, onUpdate: drawFills, onComplete: drawFills });
      chaseLag();
    }
    function flash() {
      if (dead) return;
      pool.stop(flashG);
      flashG.setAlpha(0.6);
      pool.run({ targets: flashG, alpha: 0, duration: Math.max(80, pace * 1.2), ease: "Quad.easeOut" });
    }
    const onResize = function() {
      layout();
    };
    if (scene.scale && typeof scene.scale.on === "function") scene.scale.on("resize", onResize);
    function destroy() {
      if (dead) return;
      dead = true;
      if (scene.scale && typeof scene.scale.off === "function") scene.scale.off("resize", onResize);
      dropLagTimer();
      pool.killAll();
      box2.destroy();
    }
    layout();
    drawFills();
    return {
      show: function() {
        if (!dead) {
          visible = true;
          box2.setVisible(true);
        }
      },
      hide: function() {
        if (!dead) {
          visible = false;
          box2.setVisible(false);
        }
      },
      setName: function(name) {
        if (!dead) nameText.setText(name == null ? "" : String(name));
      },
      setPhase: function(name) {
        if (!dead) phaseText.setText(name == null ? "" : String(name));
      },
      set,
      flash,
      state: function() {
        return { fraction, shown: shown.fill, lag: shown.lag, visible };
      },
      layout,
      destroy
    };
  }

  // src/static/sdk-libs/phaser/boss-steps.js
  var MOVE_MS = 600;
  var DASH_SPEED = 600;
  var DASH_MS = 400;
  var TELEGRAPH_MS = 500;
  var RING_RADIUS = 70;
  var LINE_LENGTH = 480;
  var FIRE_SPEED = 260;
  var SPREAD_DEG = 60;
  var RAIN_MS = 600;
  var SPAWN_RADIUS = 80;
  var SLAM_MS = 700;
  var SLAM_HEIGHT = 60;
  var EDGE = 24;
  var FLASH_MS2 = 90;
  var BLINK_HALF = 80;
  function viewOf(scene) {
    const cam = scene.cameras && scene.cameras.main;
    let x = 0;
    let y = 0;
    let w = scene.scale ? scene.scale.width : 960;
    let h = scene.scale ? scene.scale.height : 540;
    if (cam) {
      const wv = cam.worldView;
      if (wv && typeof wv.width === "number" && wv.width > 0) {
        x = wv.x;
        y = wv.y;
        w = wv.width;
        h = wv.height;
      } else {
        x = cam.scrollX || 0;
        y = cam.scrollY || 0;
        w = cam.width || w;
        h = cam.height || h;
      }
    }
    return { x, y, width: w, height: h, right: x + w, bottom: y + h, cx: x + w / 2, cy: y + h / 2 };
  }
  function resolveTo(world, to) {
    const sprite = world.sprite;
    const view = viewOf(world.scene);
    const margin = (sprite.displayWidth || 32) / 2 + EDGE;
    if (to && typeof to === "object" && typeof to.x === "number" && typeof to.y === "number") return { x: to.x, y: to.y };
    if (to === "left") return { x: view.x + margin, y: sprite.y };
    if (to === "right") return { x: view.right - margin, y: sprite.y };
    if (to === "center") return { x: view.cx, y: sprite.y };
    if (to === "top") return { x: sprite.x, y: view.y + (sprite.displayHeight || 32) / 2 + EDGE };
    const t = world.target();
    if (t) return { x: t.x, y: t.y };
    return { x: view.cx, y: view.cy };
  }
  function anglesFor(kind, aim, count, spreadDeg) {
    const n = Math.max(1, Math.round(count));
    const out = [];
    if (kind === "ring") {
      for (let i = 0; i < n; i++) out.push(aim + Math.PI * 2 * i / n);
      return out;
    }
    const span2 = kind === "spread" ? spreadDeg * Math.PI / 180 : 0;
    for (let i = 0; i < n; i++) out.push(n === 1 ? aim : aim - span2 / 2 + span2 * i / (n - 1));
    return out;
  }
  function phaserGlobal2() {
    return typeof window !== "undefined" ? (
      /** @type {any} */
      window.Phaser
    ) : void 0;
  }
  function tintFill(sprite, colour) {
    if (typeof sprite.setTint !== "function") return;
    sprite.setTint(colour);
    const P = phaserGlobal2();
    if (typeof sprite.setTintMode === "function" && P && P.TintModes) sprite.setTintMode(P.TintModes.FILL);
  }
  function untint(sprite) {
    if (typeof sprite.clearTint === "function") sprite.clearTint();
    const P = phaserGlobal2();
    if (typeof sprite.setTintMode === "function" && P && P.TintModes) sprite.setTintMode(P.TintModes.MULTIPLY);
  }
  function angleTo(world, p) {
    return Math.atan2(p.y - world.sprite.y, p.x - world.sprite.x);
  }
  function faceToward(world, dx) {
    if (world.actor && dx !== 0) world.actor.face(dx < 0 ? "left" : "right");
  }
  function holdBody(world) {
    const body = world.sprite.body;
    if (!body) return;
    if (typeof body.setVelocity === "function") body.setVelocity(0, 0);
    world.bodyMoves = body.moves;
    body.moves = false;
  }
  function releaseBody(world) {
    const body = world.sprite.body;
    if (!body || world.bodyMoves === void 0) return;
    body.moves = world.bodyMoves;
    world.bodyMoves = void 0;
  }
  function move(world, st, next) {
    const to = resolveTo(world, st.to !== void 0 ? st.to : st);
    const span2 = world.ms(st.ms, MOVE_MS);
    const sprite = world.sprite;
    faceToward(world, to.x - sprite.x);
    if (!world.scene.tweens || span2 <= 0) {
      sprite.setPosition(to.x, to.y);
      world.after(span2, next);
      return;
    }
    holdBody(world);
    world.tween({
      targets: sprite,
      x: to.x,
      y: to.y,
      duration: span2,
      ease: world.ease,
      onComplete: function() {
        releaseBody(world);
        next();
      }
    });
  }
  function dash(world, st, next) {
    const to = resolveTo(world, st.toward || "target");
    const sprite = world.sprite;
    const dx = to.x - sprite.x;
    const dy = to.y - sprite.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = typeof st.speed === "number" ? st.speed : DASH_SPEED;
    const span2 = world.ms(st.ms, DASH_MS);
    faceToward(world, dx);
    if (sprite.body && typeof sprite.setVelocity === "function") {
      world.held = { vx: dx / len * speed, vy: dy / len * speed };
      sprite.setVelocity(world.held.vx, world.held.vy);
      world.after(span2, function() {
        world.held = null;
        sprite.setVelocity(0, 0);
        next();
      });
      return;
    }
    const far = speed * span2 / 1e3;
    if (!world.scene.tweens) {
      sprite.setPosition(sprite.x + dx / len * far, sprite.y + dy / len * far);
      world.after(span2, next);
      return;
    }
    world.tween({
      targets: sprite,
      x: sprite.x + dx / len * far,
      y: sprite.y + dy / len * far,
      duration: span2,
      ease: "Quad.easeOut",
      onComplete: next
    });
  }
  function telegraph(world, st, next) {
    const kind = st.kind === "ring" || st.kind === "line" ? st.kind : "flash";
    const span2 = world.ms(st.ms, TELEGRAPH_MS);
    const colour = toneColour2(world.th, st.tone, world.th.warn);
    const sprite = world.sprite;
    const scene = world.scene;
    const aim = angleTo(world, resolveTo(world, "target"));
    const still = reducedMotion();
    world.emit("telegraph", { kind, ms: span2, tone: colour, angle: aim, x: sprite.x, y: sprite.y });
    if (kind === "flash") {
      if (still || span2 < BLINK_HALF * 2) {
        tintFill(sprite, colour);
        world.after(Math.min(FLASH_MS2, span2), function() {
          untint(sprite);
        });
      } else {
        let left = Math.floor(span2 / (BLINK_HALF * 2));
        const blink = function() {
          if (left <= 0) return;
          left -= 1;
          tintFill(sprite, colour);
          world.after(BLINK_HALF, function() {
            untint(sprite);
            world.after(BLINK_HALF, blink);
          });
        };
        blink();
      }
      world.after(span2, next);
      return;
    }
    const g = world.own(scene.add.graphics());
    g.setDepth((sprite.depth || 0) - 1);
    const radius = typeof st.radius === "number" ? st.radius : RING_RADIUS;
    const length = typeof st.length === "number" ? st.length : LINE_LENGTH;
    const draw2 = function(r, a) {
      g.clear();
      g.setPosition(sprite.x, sprite.y);
      g.lineStyle(kind === "ring" ? 2 : 3, colour, a);
      if (kind === "ring") g.strokeCircle(0, 0, r);
      else g.lineBetween(0, 0, Math.cos(aim) * length, Math.sin(aim) * length);
    };
    const done = function() {
      world.disown(g);
      next();
    };
    if (still || !scene.tweens) {
      draw2(radius, 0.9);
      world.after(Math.min(FLASH_MS2, span2), function() {
        g.clear();
      });
      world.after(span2, done);
      return;
    }
    const state = { r: kind === "ring" ? 6 : radius, a: 0.25 };
    draw2(state.r, state.a);
    world.tween({
      targets: state,
      r: radius,
      a: 0.95,
      duration: span2,
      ease: "Linear",
      onUpdate: function() {
        draw2(state.r, state.a);
      },
      onComplete: done
    });
  }
  function fire(world, st, next) {
    const kind = st.kind === "spread" || st.kind === "ring" || st.kind === "rain" ? st.kind : "aimed";
    const count = Math.max(1, Math.round(typeof st.count === "number" ? st.count : kind === "aimed" ? 1 : 8));
    const speed = typeof st.speed === "number" ? st.speed : FIRE_SPEED;
    const sprite = world.sprite;
    const call = function(origin, angles2) {
      world.emit("fire", { origin, angles: angles2 });
      if (typeof world.spec.onFire === "function") world.spec.onFire(origin, angles2);
    };
    if (kind === "rain") {
      const span2 = world.ms(st.ms, RAIN_MS);
      const view = viewOf(world.scene);
      const t = world.target();
      const spread = typeof st.spread === "number" ? st.spread : view.width;
      const cx = t ? t.x : view.cx;
      for (let i = 0; i < count; i++) {
        world.after(span2 * i / count, function() {
          const x = Math.max(view.x, Math.min(view.right, cx - spread / 2 + Math.random() * spread));
          call({ x, y: view.y - 12, speed, kind: "rain" }, [Math.PI / 2]);
        });
      }
      world.after(span2, next);
      return;
    }
    const aim = angleTo(world, resolveTo(world, "target"));
    const angles = anglesFor(kind, aim, count, typeof st.spread === "number" ? st.spread : SPREAD_DEG);
    call({ x: sprite.x, y: sprite.y, speed, kind }, angles);
    next();
  }
  function spawn(world, st, next) {
    const kind = st.kind == null ? "minion" : String(st.kind);
    const count = Math.max(1, Math.round(typeof st.count === "number" ? st.count : 2));
    const where = st.at === "top" || st.at === "around" ? st.at : "sides";
    const view = viewOf(world.scene);
    const sprite = world.sprite;
    const radius = typeof st.radius === "number" ? st.radius : SPAWN_RADIUS;
    for (let i = 0; i < count; i++) {
      let x;
      let y;
      if (where === "sides") {
        x = i % 2 === 0 ? view.x + EDGE : view.right - EDGE;
        y = sprite.y;
      } else if (where === "top") {
        x = view.x + view.width * (i + 1) / (count + 1);
        y = view.y + EDGE;
      } else {
        const a = Math.PI * 2 * i / count - Math.PI / 2;
        x = sprite.x + Math.cos(a) * radius;
        y = sprite.y + Math.sin(a) * radius;
      }
      world.emit("spawn", { kind, x, y });
      if (typeof world.spec.onSpawn === "function") world.spec.onSpawn(x, y, kind);
    }
    next();
  }
  function slam(world, st, next) {
    const span2 = world.ms(st.ms, SLAM_MS);
    const height = typeof st.height === "number" ? st.height : SLAM_HEIGHT;
    const sprite = world.sprite;
    const land = function() {
      const feetY = sprite.y + (sprite.displayHeight || 32) * (typeof sprite.originY === "number" ? 1 - sprite.originY : 0.5);
      if (world.juice) world.juice.shake();
      if (world.fx) world.fx.at(sprite.x, feetY, "dust", { count: 14 });
      else if (world.juice) world.juice.burst(sprite.x, feetY, "dust");
      world.emit("slam", { x: sprite.x, y: feetY });
      world.after(span2 * 0.3, next);
    };
    if (reducedMotion() || !world.scene.tweens) {
      world.after(span2 * 0.7, land);
      return;
    }
    holdBody(world);
    const ground2 = sprite.y;
    world.tween({
      targets: sprite,
      y: ground2 - height,
      duration: span2 * 0.45,
      ease: "Quad.easeOut",
      onComplete: function() {
        world.tween({
          targets: sprite,
          y: ground2,
          duration: span2 * 0.25,
          ease: "Quad.easeIn",
          onComplete: function() {
            releaseBody(world);
            land();
          }
        });
      }
    });
  }
  function die(world, next) {
    const sprite = world.sprite;
    if (world.actor && typeof world.actor.die === "function") {
      world.actor.die(next);
      return;
    }
    if (sprite.body && typeof sprite.setVelocity === "function") sprite.setVelocity(0, 0);
    const hide = function() {
      if (typeof sprite.setVisible === "function") sprite.setVisible(false);
      if (sprite.body && typeof sprite.body.setEnable === "function") sprite.body.setEnable(false);
      next();
    };
    if (reducedMotion() || !world.scene.tweens) {
      hide();
      return;
    }
    world.tween({ targets: sprite, alpha: 0, duration: 300, ease: "Quad.easeIn", onComplete: hide });
  }
  function runStep(world, st, next) {
    if (!st || typeof st !== "object") {
      next();
      return;
    }
    if (st.move) {
      move(world, st.move, next);
      return;
    }
    if (st.dash) {
      dash(world, st.dash, next);
      return;
    }
    if (st.telegraph) {
      telegraph(world, st.telegraph, next);
      return;
    }
    if (st.fire) {
      fire(world, st.fire, next);
      return;
    }
    if (st.spawn) {
      spawn(world, st.spawn, next);
      return;
    }
    if (st.slam) {
      slam(world, st.slam === true ? {} : st.slam, next);
      return;
    }
    if (st.die) {
      die(world, next);
      return;
    }
    if (typeof st.wait === "number") {
      world.after(world.ms(st.wait, 0), next);
      return;
    }
    if (typeof st.fn === "function") {
      const r = st.fn(world.ctx);
      if (typeof r === "number" && isFinite(r) && r > 0) world.after(world.ms(r, 0), next);
      else next();
      return;
    }
    console.warn("[aimeat-phaser] boss: a step with none of move, dash, telegraph, fire, spawn, slam, wait, fn, loop, random or die was skipped:", st);
    next();
  }

  // src/static/sdk-libs/phaser/boss.js
  var DEFEAT_BEAT = 160;
  var DEFEAT_SLOWMO_MS = 700;
  var DEFEAT_SLOWMO_SCALE = 0.35;
  var DEFEAT_EXPLOSIONS = 3;
  var DEFEAT_SCATTER = 26;
  var EVENTS = ["phase", "pattern", "telegraph", "fire", "spawn", "slam", "damage", "heal", "defeat"];
  function boss(scene, spec) {
    const s = spec || /** @type {BossSpec} */
    {};
    if (!s.actor) throw new Error("boss() wants spec.actor: an actor() handle or a physics sprite.");
    const actorHandle = s.actor.sprite && typeof s.actor.die === "function" ? s.actor : null;
    const sprite = actorHandle ? actorHandle.sprite : s.actor;
    const th = s.theme || look(scene);
    const ease = curve(th);
    const max = Math.max(1, typeof s.health === "number" && isFinite(s.health) ? s.health : 100);
    const patterns = s.patterns || {};
    const phases = (Array.isArray(s.phases) && s.phases.length ? s.phases.slice() : [{ at: 1, patterns: Object.keys(patterns) }]).map(function(p, i) {
      return Object.assign({}, p, {
        at: i === 0 && typeof p.at !== "number" ? 1 : Math.max(0, Math.min(1, typeof p.at === "number" ? p.at : 1)),
        name: p.name != null ? String(p.name) : "phase " + (i + 1),
        patterns: Array.isArray(p.patterns) ? p.patterns : []
      });
    }).sort(function(a, b) {
      return b.at - a.at;
    });
    phases[0].at = 1;
    let health = max;
    let phaseAt = 0;
    let pendingPhase = null;
    let started = false;
    let running = false;
    let paused = false;
    let invulnerable = false;
    let defeated = false;
    let gone = false;
    let token = 0;
    const runTimers = [];
    const keepTimers = [];
    const tweens = [];
    const drawn = [];
    const handlers = {};
    for (const name of EVENTS) handlers[name] = [];
    let targetObj = s.target || null;
    let fxHandle = s.fx || null;
    let juiceHandle = s.juice || null;
    let ownFx = false;
    let ownJuice = false;
    const bar = bossBar(scene, Object.assign({ name: s.name, phases, theme: th }, s.bar || {}));
    if (s.bar && s.bar.hidden) bar.hide();
    bar.setPhase(phases[0].name);
    function emit(event, a, b) {
      const list = handlers[event];
      if (!list) return;
      for (const fn of list.slice()) {
        try {
          fn(a, b);
        } catch (err) {
          console.warn('[aimeat-phaser] a boss handler for "' + event + '" threw:', err);
        }
      }
    }
    function after(ms2, fn, keep) {
      const list = keep ? keepTimers : runTimers;
      const timer = scene.time.delayedCall(Math.max(0, ms2), function() {
        const at = list.indexOf(timer);
        if (at >= 0) list.splice(at, 1);
        if (!gone) fn();
      });
      if (paused && !keep) timer.paused = true;
      list.push(timer);
      return timer;
    }
    function tween(config) {
      const done = config.onComplete;
      let t = null;
      config.onComplete = function() {
        const at = tweens.indexOf(t);
        if (at >= 0) tweens.splice(at, 1);
        if (!gone && typeof done === "function") done();
      };
      t = scene.tweens.add(config);
      tweens.push(t);
      if (paused && typeof t.pause === "function") t.pause();
      return t;
    }
    function targetPoint() {
      if (!targetObj) return null;
      const o = targetObj.sprite ? targetObj.sprite : targetObj;
      return typeof o.x === "number" && typeof o.y === "number" ? o : null;
    }
    const world = {
      scene,
      sprite,
      actor: actorHandle,
      th,
      ease,
      spec: s,
      fx: null,
      juice: null,
      held: null,
      bodyMoves: void 0,
      ctx: null,
      target: targetPoint,
      ms: function(want, fallback) {
        const raw = typeof want === "number" && isFinite(want) ? want : fallback;
        const speed = phases[phaseAt].speed;
        return Math.max(0, raw / (typeof speed === "number" && speed > 0 ? speed : 1));
      },
      after,
      tween,
      own: function(g) {
        drawn.push(g);
        return g;
      },
      disown: function(g) {
        const at = drawn.indexOf(g);
        if (at >= 0) drawn.splice(at, 1);
        if (g && g.scene) g.destroy();
      },
      emit
    };
    function cancelRun() {
      token += 1;
      running = false;
      for (const t of runTimers) if (t && typeof t.remove === "function") t.remove(false);
      runTimers.length = 0;
      for (const t of tweens.slice()) {
        if (typeof t.remove === "function") t.remove();
        else if (typeof t.stop === "function") t.stop();
      }
      tweens.length = 0;
      for (const g of drawn.slice()) if (g && g.scene) g.destroy();
      drawn.length = 0;
      if (world.held && sprite.body && typeof sprite.setVelocity === "function") sprite.setVelocity(0, 0);
      world.held = null;
      if (sprite.body && world.bodyMoves !== void 0) {
        sprite.body.moves = world.bodyMoves;
        world.bodyMoves = void 0;
      }
      if (!defeated) untint(sprite);
    }
    function stepsOf(entry) {
      if (Array.isArray(entry)) return entry;
      const list = patterns[entry];
      if (!Array.isArray(list)) {
        console.warn('[aimeat-phaser] boss: no pattern named "' + entry + '" in spec.patterns.');
        return [];
      }
      return list;
    }
    function play(steps, i, mine, done) {
      if (mine !== token || gone) return;
      if (pendingPhase !== null && !defeated) {
        transition2();
        return;
      }
      if (i >= steps.length) {
        done();
        return;
      }
      const st = steps[i];
      const next = function() {
        play(steps, i + 1, mine, done);
      };
      if (st && typeof st.loop === "number" && Array.isArray(st.steps)) {
        let left = Math.max(0, Math.round(st.loop));
        const again = function() {
          if (left <= 0) {
            next();
            return;
          }
          left -= 1;
          play(st.steps, 0, mine, again);
        };
        again();
        return;
      }
      if (st && Array.isArray(st.random) && st.random.length) {
        const pick = st.random[Math.floor(Math.random() * st.random.length)];
        emit("pattern", typeof pick === "string" ? pick : "random");
        play(stepsOf(pick), 0, mine, next);
        return;
      }
      runStep(world, st, next);
    }
    function cycle(mine) {
      const phase = phases[phaseAt];
      const list = phase.patterns;
      let at = 0;
      const one = function() {
        if (mine !== token || gone) return;
        if (at >= list.length) {
          if (phase.loop === false || !list.length) {
            running = false;
            return;
          }
          at = 0;
        }
        const entry = list[at];
        at += 1;
        emit("pattern", typeof entry === "string" ? entry : "inline");
        play(stepsOf(entry), 0, mine, one);
      };
      one();
    }
    function startPhase(i, prev) {
      phaseAt = i;
      const phase = phases[i];
      const mine = token;
      running = true;
      bar.setPhase(phase.name);
      const window2 = typeof phase.invulnerableMs === "number" ? phase.invulnerableMs : typeof s.invulnerableMs === "number" ? s.invulnerableMs : 0;
      if (window2 > 0) {
        invulnerable = true;
        after(window2, function() {
          invulnerable = false;
        }, true);
      }
      emit("phase", phase.name, prev === null ? null : phases[prev].name);
      play(Array.isArray(phase.enter) ? phase.enter : [], 0, mine, function() {
        cycle(mine);
      });
    }
    function transition2() {
      const i = (
        /** @type {number} */
        pendingPhase
      );
      const prev = phaseAt;
      pendingPhase = null;
      cancelRun();
      bar.flash();
      startPhase(i, prev);
    }
    function phaseFor(fraction) {
      let found = 0;
      for (let i = 0; i < phases.length; i++) if (phases[i].at >= fraction) found = i;
      return found;
    }
    function defeat() {
      defeated = true;
      pendingPhase = null;
      invulnerable = false;
      cancelRun();
      untint(sprite);
      const mine = token;
      running = true;
      const steps = Array.isArray(s.defeat) ? s.defeat : defaultDefeat();
      play(steps, 0, mine, function() {
        running = false;
        emit("defeat");
      });
    }
    function defaultDefeat() {
      const steps = [];
      for (let i = 0; i < DEFEAT_EXPLOSIONS; i++) {
        steps.push({
          fn: function() {
            const dx = (Math.random() - 0.5) * DEFEAT_SCATTER * 2;
            const dy = (Math.random() - 0.5) * DEFEAT_SCATTER * 2;
            if (world.fx) world.fx.at(sprite.x + dx, sprite.y + dy, "explosion");
            else if (world.juice) world.juice.burst(sprite.x + dx, sprite.y + dy, "hit");
            if (i === 0 && world.juice) world.juice.slowmo(DEFEAT_SLOWMO_MS, DEFEAT_SLOWMO_SCALE);
            return DEFEAT_BEAT;
          }
        });
      }
      steps.push({ die: true });
      return steps;
    }
    function damage(n) {
      const amount = typeof n === "number" && isFinite(n) ? n : 0;
      if (gone || defeated || invulnerable || amount <= 0) return health / max;
      health = Math.max(0, health - amount);
      const fraction = health / max;
      bar.set(fraction);
      emit("damage", { amount, health, fraction });
      if (health <= 0) {
        defeat();
        return 0;
      }
      const want = phaseFor(fraction);
      if (want > phaseAt && want !== pendingPhase) {
        pendingPhase = want;
        if (started && !running) transition2();
      }
      return fraction;
    }
    function heal(n) {
      const amount = typeof n === "number" && isFinite(n) ? n : 0;
      if (gone || defeated || amount <= 0) return health / max;
      health = Math.min(max, health + amount);
      const fraction = health / max;
      bar.set(fraction);
      emit("heal", { amount, health, fraction });
      return fraction;
    }
    function start() {
      if (gone || started || defeated) return;
      started = true;
      if (!fxHandle) {
        fxHandle = fx(scene, { theme: th });
        ownFx = true;
      }
      if (!juiceHandle) {
        juiceHandle = juice(scene, { theme: th });
        ownJuice = true;
      }
      world.fx = fxHandle;
      world.juice = juiceHandle;
      pendingPhase = null;
      startPhase(phaseFor(health / max), null);
    }
    function pause() {
      if (gone || paused) return;
      paused = true;
      for (const t of runTimers) if (t) t.paused = true;
      for (const t of tweens) if (t && typeof t.pause === "function") t.pause();
      if (world.held && sprite.body && typeof sprite.setVelocity === "function") sprite.setVelocity(0, 0);
    }
    function resume() {
      if (gone || !paused) return;
      paused = false;
      for (const t of runTimers) if (t) t.paused = false;
      for (const t of tweens) if (t && typeof t.resume === "function") t.resume();
      if (world.held && sprite.body && typeof sprite.setVelocity === "function") sprite.setVelocity(world.held.vx, world.held.vy);
    }
    function stop() {
      if (gone) return;
      cancelRun();
      started = false;
      pendingPhase = null;
    }
    function skipTo(name) {
      if (gone || defeated) return false;
      let i = -1;
      for (let k = 0; k < phases.length; k++) if (phases[k].name === name) i = k;
      if (i < 0) return false;
      const prev = phaseAt;
      health = i === 0 ? max : Math.max(1, Math.round(phases[i].at * max));
      bar.set(health / max, { instant: true });
      pendingPhase = null;
      cancelRun();
      if (started) {
        bar.flash();
        startPhase(i, prev);
      } else {
        phaseAt = i;
        bar.setPhase(phases[i].name);
      }
      return true;
    }
    function on(event, fn) {
      if (typeof fn !== "function" || !handlers[event]) {
        return function() {
        };
      }
      handlers[event].push(fn);
      return function off() {
        const at = handlers[event].indexOf(fn);
        if (at >= 0) handlers[event].splice(at, 1);
      };
    }
    function destroy() {
      if (gone) return;
      cancelRun();
      gone = true;
      scene.events.off("shutdown", destroy);
      for (const t of keepTimers) if (t && typeof t.remove === "function") t.remove(false);
      keepTimers.length = 0;
      for (const name in handlers) handlers[name].length = 0;
      bar.destroy();
      if (ownFx && fxHandle) fxHandle.destroy();
      if (ownJuice && juiceHandle) juiceHandle.destroy();
      fxHandle = null;
      juiceHandle = null;
      world.fx = null;
      world.juice = null;
    }
    const handle = {
      sprite,
      actor: actorHandle,
      start,
      pause,
      resume,
      stop,
      phase: function() {
        return phases[phaseAt].name;
      },
      health: function() {
        return health;
      },
      damage,
      heal,
      target: function(t) {
        targetObj = t || null;
      },
      skipTo,
      on,
      bar: { show: bar.show, hide: bar.hide, setName: bar.setName, state: bar.state },
      running: function() {
        return running && !paused;
      },
      destroy
    };
    world.ctx = {
      boss: handle,
      scene,
      sprite,
      actor: actorHandle,
      target: targetPoint,
      get fx() {
        return world.fx;
      },
      get juice() {
        return world.juice;
      }
    };
    scene.events.once("shutdown", destroy);
    return handle;
  }

  // src/static/sdk-libs/phaser/ai-path.js
  var DEFAULT_BUDGET = 4e3;
  var DIAGONAL = Math.SQRT2;
  var STRAIGHT = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  function gridOf(source) {
    if (Array.isArray(source)) return source;
    if (source && typeof source.grid === "function") {
      const g = source.grid();
      return Array.isArray(g) ? g : null;
    }
    return null;
  }
  function open(grid, x, y) {
    const row = grid[y];
    return !!(row && row[x]);
  }
  function point(p) {
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") return null;
    return { x: Math.floor(p.x), y: Math.floor(p.y) };
  }
  function lineClear(gridSource, from, to) {
    const grid = gridOf(gridSource);
    const a = point(from);
    const b = point(to);
    if (!grid || !a || !b) return false;
    let x = a.x;
    let y = a.y;
    const dx = Math.abs(b.x - x);
    const dy = -Math.abs(b.y - y);
    const sx = x < b.x ? 1 : -1;
    const sy = y < b.y ? 1 : -1;
    let err = dx + dy;
    for (; ; ) {
      if (!open(grid, x, y)) return false;
      if (x === b.x && y === b.y) return true;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
  function heap(score) {
    const items = [];
    return {
      size() {
        return items.length;
      },
      push(i) {
        items.push(i);
        let at = items.length - 1;
        while (at > 0) {
          const parent = at - 1 >> 1;
          if (score[items[parent]] <= score[items[at]]) break;
          const t = items[parent];
          items[parent] = items[at];
          items[at] = t;
          at = parent;
        }
      },
      pop() {
        const top2 = items[0];
        const last = items.pop();
        if (items.length && last !== void 0) {
          items[0] = last;
          let at = 0;
          for (; ; ) {
            const l = at * 2 + 1;
            const r = l + 1;
            let best = at;
            if (l < items.length && score[items[l]] < score[items[best]]) best = l;
            if (r < items.length && score[items[r]] < score[items[best]]) best = r;
            if (best === at) break;
            const t = items[best];
            items[best] = items[at];
            items[at] = t;
            at = best;
          }
        }
        return top2;
      }
    };
  }
  function findPath(gridSource, from, to, opts) {
    const grid = gridOf(gridSource);
    const a = point(from);
    const b = point(to);
    if (!grid || !a || !b || !grid.length) return null;
    const o = opts || {};
    const rows = grid.length;
    let cols = 0;
    for (const row of grid) if (row && row.length > cols) cols = row.length;
    if (!cols) return null;
    if (!open(grid, a.x, a.y)) return null;
    if (a.x === b.x && a.y === b.y) return [a];
    const goalOpen = open(grid, b.x, b.y);
    if (!goalOpen && !o.nearest) return null;
    const diagonal = !!o.diagonal;
    const cut = !!o.cutCorners;
    const cost = typeof o.cost === "function" ? o.cost : null;
    const budget = typeof o.budget === "number" && o.budget > 0 ? o.budget : DEFAULT_BUDGET;
    const moves = diagonal ? STRAIGHT.concat(DIAGONALS) : STRAIGHT;
    function h(x, y) {
      const dx = Math.abs(x - b.x);
      const dy = Math.abs(y - b.y);
      return diagonal ? Math.max(dx, dy) + (DIAGONAL - 1) * Math.min(dx, dy) : dx + dy;
    }
    const total = rows * cols;
    const g = new Float64Array(total).fill(Infinity);
    const f = new Float64Array(total).fill(Infinity);
    const parent = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const start = a.y * cols + a.x;
    const goal = b.y * cols + b.x;
    g[start] = 0;
    f[start] = h(a.x, a.y);
    const queue = heap(f);
    queue.push(start);
    let expanded = 0;
    let nearestIndex = start;
    let nearestH = f[start];
    while (queue.size()) {
      const current = queue.pop();
      if (closed[current]) continue;
      if (current === goal) return unwind(parent, current, cols);
      closed[current] = 1;
      if (++expanded > budget) break;
      const cx = current % cols;
      const cy = (current - cx) / cols;
      const hc = h(cx, cy);
      if (hc < nearestH) {
        nearestH = hc;
        nearestIndex = current;
      }
      for (let m = 0; m < moves.length; m++) {
        const nx = cx + moves[m][0];
        const ny = cy + moves[m][1];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !open(grid, nx, ny)) continue;
        const isDiagonal = m >= 4;
        if (isDiagonal && !cut && (!open(grid, cx, ny) || !open(grid, nx, cy))) continue;
        const next = ny * cols + nx;
        if (closed[next]) continue;
        let step = isDiagonal ? DIAGONAL : 1;
        if (cost) {
          const k = cost(nx, ny);
          if (!(k > 0) || !isFinite(k)) continue;
          step *= k;
        }
        const tentative = g[current] + step;
        if (tentative >= g[next]) continue;
        g[next] = tentative;
        f[next] = tentative + h(nx, ny);
        parent[next] = current;
        queue.push(next);
      }
    }
    if (o.nearest && nearestIndex !== start) return unwind(parent, nearestIndex, cols);
    if (o.nearest) return [a];
    return null;
  }
  function unwind(parent, end, cols) {
    const out = [];
    let at = end;
    while (at >= 0) {
      const x = at % cols;
      out.push({ x, y: (at - x) / cols });
      at = parent[at];
    }
    out.reverse();
    return out;
  }
  function smoothPath(gridSource, path) {
    const grid = gridOf(gridSource);
    if (!Array.isArray(path) || path.length < 3 || !grid) return Array.isArray(path) ? path.slice() : [];
    const out = [path[0]];
    let anchor = 0;
    while (anchor < path.length - 1) {
      let far = anchor + 1;
      for (let i = path.length - 1; i > anchor + 1; i--) {
        if (lineClear(grid, path[anchor], path[i])) {
          far = i;
          break;
        }
      }
      out.push(path[far]);
      anchor = far;
    }
    return out;
  }
  function flowField(gridSource, target, opts) {
    const grid = gridOf(gridSource) || [];
    const t = point(target) || { x: -1, y: -1 };
    const o = opts || {};
    const rows = grid.length;
    let cols = 0;
    for (const row of grid) if (row && row.length > cols) cols = row.length;
    const diagonal = !!o.diagonal;
    const cut = !!o.cutCorners;
    const cost = typeof o.cost === "function" ? o.cost : null;
    const moves = diagonal ? STRAIGHT.concat(DIAGONALS) : STRAIGHT;
    const dist = [];
    for (let y = 0; y < rows; y++) {
      const row = [];
      for (let x = 0; x < cols; x++) row.push(Infinity);
      dist.push(row);
    }
    if (cols && open(grid, t.x, t.y)) {
      const score = new Float64Array(rows * cols).fill(Infinity);
      const closed = new Uint8Array(rows * cols);
      const startIndex = t.y * cols + t.x;
      score[startIndex] = 0;
      const queue = heap(score);
      queue.push(startIndex);
      while (queue.size()) {
        const current = queue.pop();
        if (closed[current]) continue;
        closed[current] = 1;
        const cx = current % cols;
        const cy = (current - cx) / cols;
        dist[cy][cx] = score[current];
        for (let m = 0; m < moves.length; m++) {
          const nx = cx + moves[m][0];
          const ny = cy + moves[m][1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !open(grid, nx, ny)) continue;
          const isDiagonal = m >= 4;
          if (isDiagonal && !cut && (!open(grid, cx, ny) || !open(grid, nx, cy))) continue;
          const next = ny * cols + nx;
          if (closed[next]) continue;
          let step2 = isDiagonal ? DIAGONAL : 1;
          if (cost) {
            const k = cost(cx, cy);
            if (!(k > 0) || !isFinite(k)) continue;
            step2 *= k;
          }
          const tentative = score[current] + step2;
          if (tentative >= score[next]) continue;
          score[next] = tentative;
          queue.push(next);
        }
      }
    }
    function reachable(x, y) {
      const row = dist[y];
      return !!row && isFinite(row[x]);
    }
    function step(x, y) {
      if (!reachable(x, y)) return null;
      const here = dist[y][x];
      if (here === 0) return null;
      let best = null;
      let bestDist = here;
      for (let m = 0; m < moves.length; m++) {
        const nx = x + moves[m][0];
        const ny = y + moves[m][1];
        if (!reachable(nx, ny)) continue;
        if (m >= 4 && !cut && (!open(grid, x, ny) || !open(grid, nx, y))) continue;
        if (dist[ny][nx] < bestDist) {
          bestDist = dist[ny][nx];
          best = { x: nx, y: ny };
        }
      }
      return best;
    }
    return { dist, target: t, step, reachable };
  }

  // src/static/sdk-libs/phaser/ai-behaviours.js
  var WAYPOINT_SHARE = 0.35;
  var REPATH_MS = 250;
  var STUCK_MS = 4e3;
  function hypot(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function motor(subject) {
    const scene = subject.scene;
    const sprite = subject.sprite;
    const actor2 = subject.actor;
    const topdown = subject.mode === "topdown";
    const tile = subject.tile;
    let facingX = 1;
    let facingY = 0;
    let route = null;
    let routeKey = "";
    let routeAt = -Infinity;
    let routeIndex = 0;
    function now() {
      return scene.time ? scene.time.now : 0;
    }
    function toTile(x, y) {
      return { x: Math.floor(x / tile), y: Math.floor(y / tile) };
    }
    function toWorld(t) {
      return { x: t.x * tile + tile / 2, y: t.y * tile + tile / 2 };
    }
    function grid() {
      return gridOf(subject.gridSource);
    }
    function walkable(tx, ty) {
      const g = grid();
      return !!(g && g[ty] && g[ty][tx]);
    }
    function outside(x, y) {
      const world = scene.physics && scene.physics.world;
      const b = world && world.bounds;
      if (!b || typeof b.x !== "number") return false;
      return x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height;
    }
    function solidAt(x, y) {
      if (subject.solid) return !!subject.solid(x, y);
      if (outside(x, y)) return true;
      const g = grid();
      if (g) {
        const t = toTile(x, y);
        return !walkable(t.x, t.y);
      }
      const physics = scene.physics;
      if (physics && typeof physics.overlapRect === "function") {
        return physics.overlapRect(x - 1, y - 1, 2, 2, false, true).length > 0;
      }
      return false;
    }
    function halfWidth() {
      return (sprite.displayWidth || sprite.width || tile) / 2;
    }
    function halfHeight() {
      return (sprite.displayHeight || sprite.height || tile) / 2;
    }
    function probe(dir) {
      const d = dir < 0 ? -1 : 1;
      const hw = halfWidth();
      const hh = halfHeight();
      const ax = sprite.x + d * (hw + tile * 0.35);
      return {
        gap: !solidAt(ax, sprite.y + hh + tile * 0.5),
        wall: solidAt(ax, sprite.y + hh - tile * 0.25),
        high: solidAt(ax, sprite.y - hh - tile * 0.6),
        edge: outside(ax, sprite.y)
      };
    }
    function onGround() {
      if (topdown) return true;
      const body = sprite.body;
      return !!(body && (body.blocked && body.blocked.down || body.touching && body.touching.down));
    }
    function flip(vx) {
      if (actor2 || vx === 0 || typeof sprite.setFlipX !== "function") return;
      sprite.setFlipX(vx < 0 !== (subject.artFaces === "left"));
    }
    function stop() {
      route = null;
      if (actor2) {
        if (topdown) actor2.drive(0, 0);
        else actor2.update({});
      } else if (sprite.body) {
        if (topdown) sprite.setVelocity(0, 0);
        else sprite.setVelocityX(0);
      }
    }
    function drive(vx, vy) {
      if (vx !== 0 || vy !== 0) {
        const len = Math.sqrt(vx * vx + vy * vy);
        facingX = vx / len;
        facingY = vy / len;
      }
      if (actor2) actor2.drive(vx, vy);
      else if (sprite.body) sprite.setVelocity(vx, vy);
      flip(vx);
    }
    function walk(dir, speed, o) {
      const d = dir < 0 ? -1 : 1;
      const pace = speed > 0 ? speed : subject.speed;
      const p = probe(d);
      const jumpNow = !!(o && o.jump) && onGround() && (p.wall && !p.high || p.gap);
      facingX = d;
      facingY = 0;
      if (actor2) {
        actor2.move.speed = pace;
        actor2.update({ left: d < 0, right: d > 0, jump: jumpNow });
      } else if (sprite.body) {
        sprite.setVelocityX(d * pace);
        if (jumpNow && typeof sprite.setVelocityY === "function") sprite.setVelocityY(-subject.jump);
        flip(d);
      }
      return { gap: p.gap, wall: p.wall, high: p.high, edge: p.edge, jumped: jumpNow };
    }
    function face(dir) {
      let fx2 = facingX;
      let fy = facingY;
      if (dir === "left") {
        fx2 = -1;
        fy = 0;
      } else if (dir === "right") {
        fx2 = 1;
        fy = 0;
      } else if (dir && typeof dir.x === "number") {
        const len = hypot(sprite.x, sprite.y, dir.x, dir.y) || 1;
        fx2 = (dir.x - sprite.x) / len;
        fy = (dir.y - sprite.y) / len;
      }
      facingX = fx2;
      facingY = fy;
      if (actor2) {
        if (topdown && actor2.facing.length > 5) return;
        if (fx2 !== 0) actor2.face(fx2 < 0 ? "left" : "right");
      } else {
        flip(fx2);
      }
    }
    function facing() {
      if (actor2 && !topdown) {
        facingX = actor2.facing === "left" ? -1 : 1;
        facingY = 0;
      }
      return { x: facingX, y: facingY };
    }
    function waypoint(point2, g) {
      const here = toTile(sprite.x, sprite.y);
      const goal = toTile(point2.x, point2.y);
      const key = goal.x + "," + goal.y;
      if (!route || routeKey !== key || now() - routeAt > REPATH_MS) {
        const steps = findPath(g, here, goal, { diagonal: true, nearest: true, budget: subject.budget });
        if (steps && steps.length > 1) {
          const last = steps[steps.length - 1];
          route = smoothPath(g, steps).map(toWorld);
          if (last.x === goal.x && last.y === goal.y) route[route.length - 1] = { x: point2.x, y: point2.y };
          routeIndex = 1;
        } else {
          route = null;
        }
        routeKey = key;
        routeAt = now();
      }
      if (!route) return null;
      while (routeIndex < route.length - 1 && hypot(sprite.x, sprite.y, route[routeIndex].x, route[routeIndex].y) <= tile * WAYPOINT_SHARE) {
        routeIndex += 1;
      }
      return route[routeIndex];
    }
    function go(point2, speed, o) {
      const opt = o || {};
      const pace = speed > 0 ? speed : subject.speed;
      const arrive = typeof opt.arrive === "number" ? opt.arrive : subject.arrive;
      if (!topdown) {
        const dx = point2.x - sprite.x;
        if (Math.abs(dx) <= arrive) {
          stop();
          return 0;
        }
        const p = walk(dx < 0 ? -1 : 1, pace, { jump: !!opt.jump });
        if (!opt.jump && (p.gap || p.wall || p.edge)) {
          stop();
          return -1;
        }
        return Math.abs(dx);
      }
      const d = hypot(sprite.x, sprite.y, point2.x, point2.y);
      if (d <= arrive) {
        stop();
        return 0;
      }
      const g = opt.straight ? null : grid();
      const aim = g && waypoint(point2, g) || point2;
      const len = hypot(sprite.x, sprite.y, aim.x, aim.y) || 1;
      drive((aim.x - sprite.x) / len * pace, (aim.y - sprite.y) / len * pace);
      return d;
    }
    return {
      get x() {
        return sprite.x;
      },
      get y() {
        return sprite.y;
      },
      get path() {
        return route;
      },
      tile,
      toTile,
      toWorld,
      grid,
      walkable,
      solidAt,
      probe,
      onGround,
      stop,
      drive,
      walk,
      face,
      facing,
      go,
      forgetRoute() {
        route = null;
      }
    };
  }
  function span(ctx, value, min, max) {
    if (typeof value === "number") return value;
    if (Array.isArray(value) && value.length === 2) return ctx.rand(value[0], value[1]);
    return ctx.rand(min, max);
  }
  function num3(cfg2, name, fallback) {
    return typeof cfg2[name] === "number" && isFinite(cfg2[name]) ? cfg2[name] : fallback;
  }
  var behaviours = {
    /** Stand still. */
    idle(ctx) {
      return { update() {
        ctx.stop();
        ctx.done = true;
      } };
    },
    /**
     * Between points when given, otherwise back and forth: along a platform (turning at an edge
     * or a wall) or across a span of `range` around home. Config: points, speed, pauseMs, range.
     */
    patrol(ctx, cfg2) {
      const speed = num3(cfg2, "speed", ctx.speed);
      const pauseMs = num3(cfg2, "pauseMs", 0);
      let points = Array.isArray(cfg2.points) && cfg2.points.length ? cfg2.points : null;
      let i = 0;
      let step = 1;
      let dir = 1;
      let pauseUntil = 0;
      return {
        enter() {
          dir = cfg2.dir === -1 || cfg2.dir === 1 ? cfg2.dir : ctx.facing().x < 0 ? -1 : 1;
          if (!points && ctx.mode === "topdown") {
            const range = num3(cfg2, "range", ctx.tile * 3);
            points = [{ x: ctx.home.x - range, y: ctx.home.y }, { x: ctx.home.x + range, y: ctx.home.y }];
            i = dir < 0 ? 0 : 1;
          }
        },
        update() {
          ctx.done = false;
          if (ctx.now < pauseUntil) {
            ctx.stop();
            return;
          }
          if (points) {
            const remain = ctx.go(points[i], speed, { arrive: num3(cfg2, "arrive", ctx.tile * 0.25), jump: false });
            if (remain === 0 || remain === -1) {
              if (i + step >= points.length || i + step < 0) step = -step;
              i += step;
              i = Math.max(0, Math.min(points.length - 1, i));
              pauseUntil = ctx.now + pauseMs;
              ctx.done = true;
            }
            return;
          }
          const p = ctx.walk(dir, speed);
          if (p.wall || p.gap || p.edge) {
            dir = -dir;
            pauseUntil = ctx.now + pauseMs;
            ctx.done = true;
          }
        }
      };
    },
    /**
     * A random walk within `radius` of home, with pauses. Over the grid a leg goes to a walkable
     * tile by route; on a platform it is a random direction for a random while.
     */
    wander(ctx, cfg2) {
      const speed = num3(cfg2, "speed", ctx.speed * 0.6);
      const radius = num3(cfg2, "radius", ctx.tile * 4);
      let goal = null;
      let legUntil = 0;
      let pauseUntil = 0;
      let dir = 1;
      function pickGoal() {
        const g = ctx.grid();
        for (let tries = 0; tries < 8; tries++) {
          const a = ctx.rand(0, Math.PI * 2);
          const r = ctx.rand(radius * 0.3, radius);
          const p = { x: ctx.home.x + Math.cos(a) * r, y: ctx.home.y + Math.sin(a) * r };
          if (!g) return p;
          const t = ctx.toTile(p.x, p.y);
          if (ctx.walkable(t.x, t.y)) return ctx.toWorld(t);
        }
        return null;
      }
      function rest() {
        goal = null;
        pauseUntil = ctx.now + span(ctx, cfg2.pauseMs, 400, 1400);
        ctx.stop();
        ctx.done = true;
      }
      return {
        enter() {
          goal = null;
          pauseUntil = 0;
        },
        update() {
          ctx.done = false;
          if (ctx.now < pauseUntil) {
            ctx.stop();
            ctx.done = true;
            return;
          }
          if (ctx.mode === "platformer") {
            if (!goal) {
              goal = { x: 0, y: 0 };
              dir = ctx.rand(0, 1) < 0.5 ? -1 : 1;
              legUntil = ctx.now + span(ctx, cfg2.legMs, 500, 1500);
            }
            if (ctx.now >= legUntil) {
              rest();
              return;
            }
            if (Math.abs(ctx.x - ctx.home.x) > radius && (ctx.x - ctx.home.x) * dir > 0) dir = -dir;
            const p = ctx.walk(dir, speed);
            if (p.wall || p.gap || p.edge) dir = -dir;
            return;
          }
          if (!goal) {
            goal = pickGoal();
            legUntil = ctx.now + STUCK_MS;
            if (!goal) {
              rest();
              return;
            }
          }
          const remain = ctx.go(goal, speed, { jump: false });
          if (remain <= 0 || ctx.now >= legUntil) rest();
        }
      };
    },
    /** Hold a post (home unless cfg.post): return to it when away, face what comes near. */
    guard(ctx, cfg2) {
      const speed = num3(cfg2, "speed", ctx.speed);
      const faceRange = num3(cfg2, "faceRange", ctx.sight);
      const post = cfg2.post && typeof cfg2.post.x === "number" ? cfg2.post : null;
      return {
        update() {
          const at = post || ctx.home;
          const remain = ctx.go(at, speed, { arrive: num3(cfg2, "arrive", ctx.tile * 0.25), jump: true });
          ctx.done = remain === 0;
          if (remain !== 0) return;
          if (ctx.target && ctx.distance() <= faceRange) ctx.face(ctx.target);
          else if (ctx.noise) ctx.face(ctx.noise);
        }
      };
    },
    /**
     * Toward wherever the target is believed to be: seen now, remembered, or heard. Over a route
     * when there is a grid; with jumps on a platform. Reaching a noise forgets it.
     */
    chase(ctx, cfg2) {
      const speed = num3(cfg2, "speed", ctx.speed);
      const arrive = num3(cfg2, "arrive", ctx.tile * 0.4);
      return {
        update() {
          const goal = ctx.goal();
          if (!goal) {
            ctx.stop();
            ctx.done = true;
            return;
          }
          const remain = ctx.go(goal, speed, { arrive, jump: cfg2.jump !== false });
          ctx.done = remain === 0;
          if (remain === 0 && !ctx.sees && ctx.noise) ctx.forgetNoise();
        }
      };
    },
    /**
     * Away from the target (or the last noise) while it is closer than `safe`. With a grid, to the
     * reachable tile within `radius` tiles that is farthest from the threat.
     */
    flee(ctx, cfg2) {
      const speed = num3(cfg2, "speed", ctx.speed * 1.25);
      const safe = num3(cfg2, "safe", ctx.sight * 1.5);
      const radius = Math.max(2, Math.round(num3(cfg2, "radius", 8)));
      let refuge = null;
      let refugeAt = -Infinity;
      function threat() {
        return ctx.target || ctx.noise || null;
      }
      function pickRefuge(from) {
        const g = ctx.grid();
        if (!g) return null;
        const me = ctx.toTile(ctx.x, ctx.y);
        const field = flowField(g, me, { diagonal: true });
        let best = null;
        let bestScore = -1;
        for (let ty = me.y - radius; ty <= me.y + radius; ty++) {
          for (let tx = me.x - radius; tx <= me.x + radius; tx++) {
            if (!field.reachable(tx, ty) || field.dist[ty][tx] > radius * 1.5) continue;
            const w = ctx.toWorld({ x: tx, y: ty });
            const score = ctx.dist(from, w);
            if (score > bestScore) {
              bestScore = score;
              best = w;
            }
          }
        }
        return best;
      }
      return {
        enter() {
          refuge = null;
        },
        update() {
          const from = threat();
          ctx.done = false;
          if (!from || ctx.dist(from) > safe) {
            ctx.stop();
            ctx.done = true;
            return;
          }
          if (ctx.mode === "platformer") {
            const dx = ctx.x - from.x;
            ctx.walk(dx === 0 ? ctx.facing().x : dx < 0 ? -1 : 1, speed, { jump: true });
            return;
          }
          if (ctx.grid()) {
            if (!refuge || ctx.now - refugeAt > REPATH_MS * 2 || ctx.dist(refuge) <= ctx.tile * 0.3) {
              refuge = pickRefuge(from);
              refugeAt = ctx.now;
            }
            if (refuge) {
              ctx.go(refuge, speed, { jump: true });
              return;
            }
          }
          const len = ctx.dist(from) || 1;
          ctx.drive((ctx.x - from.x) / len * speed, (ctx.y - from.y) / len * speed);
        }
      };
    },
    /**
     * Stop and fire at the target every intervalMs while it is within range and in sight. The
     * game owns the projectile: spec.onShoot(origin, angle, ctx). With telegraphMs the brain
     * announces the shot that long before it, with a 'telegraph' event and a one-frame flash.
     */
    shoot(ctx, cfg2) {
      const range = num3(cfg2, "range", ctx.sight);
      const interval = num3(cfg2, "intervalMs", 900);
      const telegraphMs = num3(cfg2, "telegraphMs", 0);
      const muzzle = cfg2.muzzle && typeof cfg2.muzzle.x === "number" ? cfg2.muzzle : { x: 0, y: 0 };
      let since = 0;
      let pending = null;
      function aim() {
        const f = ctx.facing();
        const origin = { x: ctx.x + muzzle.x * (f.x < 0 ? -1 : 1), y: ctx.y + muzzle.y };
        const t = ctx.target;
        const angle = t ? Math.atan2(t.y - origin.y, t.x - origin.x) : Math.atan2(f.y, f.x);
        return { origin, angle };
      }
      function fire2(shot) {
        since = 0;
        pending = null;
        if (typeof ctx.spec.onShoot === "function") ctx.spec.onShoot(shot.origin, shot.angle, ctx);
        ctx.emit("shoot", shot);
      }
      return {
        enter() {
          since = interval - num3(cfg2, "firstMs", interval * 0.5);
          pending = null;
        },
        update(dt) {
          ctx.stop();
          ctx.done = false;
          since += dt;
          if (ctx.target && cfg2.turn !== false) ctx.face(ctx.target);
          if (pending) {
            if (ctx.now >= pending.at) fire2(ctx.visible(range) ? aim() : pending);
            return;
          }
          if (since < interval || !ctx.visible(range)) return;
          if (telegraphMs > 0) {
            const shot = aim();
            pending = { at: ctx.now + telegraphMs, origin: shot.origin, angle: shot.angle };
            ctx.flash();
            ctx.emit("telegraph", { origin: shot.origin, angle: shot.angle, ms: telegraphMs });
            return;
          }
          fire2(aim());
        },
        exit() {
          pending = null;
        }
      };
    },
    /** Still until the target (or a noise) is within `trigger`, then the state named by `then`. */
    ambush(ctx, cfg2) {
      const trigger = num3(cfg2, "trigger", ctx.sight * 0.5);
      const then = typeof cfg2.then === "string" ? cfg2.then : "chase";
      return {
        update() {
          ctx.stop();
          ctx.done = false;
          const near = ctx.target && ctx.distance() <= trigger || ctx.noise && ctx.dist(ctx.noise) <= trigger;
          if (near) ctx.set(then);
        }
      };
    },
    /**
     * Round a centre: the target when there is one, else home, or cfg.centre. Topdown; on a
     * platform it reduces to walking back and forth under the centre.
     */
    orbit(ctx, cfg2) {
      const speed = num3(cfg2, "speed", ctx.speed);
      const radius = Math.max(4, num3(cfg2, "radius", ctx.tile * 2.5));
      const turn = cfg2.clockwise === false ? -1 : 1;
      let angle = 0;
      function centre() {
        if (cfg2.centre && typeof cfg2.centre.x === "number") return cfg2.centre;
        if (cfg2.centre === "home") return ctx.home;
        return ctx.target || ctx.home;
      }
      return {
        enter() {
          const c = centre();
          angle = Math.atan2(ctx.y - c.y, ctx.x - c.x);
        },
        update(dt) {
          const c = centre();
          ctx.done = false;
          if (ctx.mode === "platformer") {
            const side = Math.cos(angle) < 0 ? -1 : 1;
            angle += turn * (speed / radius) * (dt / 1e3);
            ctx.go({ x: c.x + side * radius, y: ctx.y }, speed, { jump: true });
            return;
          }
          const r = ctx.dist(c);
          if (Math.abs(r - radius) > radius * 0.3) {
            angle = Math.atan2(ctx.y - c.y, ctx.x - c.x);
          } else {
            angle += turn * (speed / radius) * (dt / 1e3);
          }
          const aim = { x: c.x + Math.cos(angle) * radius, y: c.y + Math.sin(angle) * radius };
          ctx.go(aim, speed, { straight: true, arrive: 1 });
        }
      };
    },
    /**
     * Steps in turn, each a behaviour for a while: steps: [{ do: 'wander', ms: 2000 }, { do:
     * 'idle', ms: 600 }]. loop: false ends on the last step, which is when 'done' becomes true.
     */
    sequence(ctx, cfg2) {
      const steps = Array.isArray(cfg2.steps) ? cfg2.steps : [];
      const loop = cfg2.loop !== false;
      let i = -1;
      let stepAt = 0;
      let sub = null;
      let ended = false;
      function start(index) {
        if (sub && sub.exit) sub.exit();
        i = index;
        const step = steps[i];
        sub = step ? build(ctx, step.do, step) : null;
        if (sub && sub.enter) sub.enter();
        stepAt = ctx.now;
      }
      return {
        enter() {
          ended = false;
          start(0);
        },
        update(dt) {
          ctx.done = false;
          if (ended || !steps.length) {
            ctx.stop();
            ctx.done = true;
            return;
          }
          const step = steps[i];
          if (typeof step.ms === "number" && ctx.now - stepAt >= step.ms) {
            if (i + 1 < steps.length) start(i + 1);
            else if (loop) start(0);
            else {
              ended = true;
              ctx.stop();
              ctx.done = true;
              return;
            }
          }
          if (sub) sub.update(dt);
        },
        exit() {
          if (sub && sub.exit) sub.exit();
          sub = null;
        }
      };
    }
  };
  function build(ctx, type, cfg2) {
    const factory = typeof type === "function" ? type : behaviours[String(type)];
    if (!factory) {
      console.warn('[aimeat-phaser] brain: no behaviour is called "' + type + '". The built-in ones are ' + Object.keys(behaviours).join(", ") + "; a state of another name wants a type in spec.behaviours, or a factory added to AIMEAT.phaser.behaviours. Standing still.");
      return behaviours.idle(ctx, {});
    }
    return factory(ctx, cfg2 || {});
  }

  // src/static/sdk-libs/phaser/ai.js
  var pathfind = { findPath, smoothPath, flowField, lineClear };
  var DEBUG_DEPTH = 890;
  var MAX_DT = 100;
  var MEMORY_MS = 1500;
  var PRESETS3 = {
    slime: { start: "patrol", rules: [] },
    bat: {
      start: "wander",
      mode: "topdown",
      fly: true,
      rules: [{ from: "wander", to: "chase", when: "sees" }, { from: "chase", to: "wander", when: "lost" }]
    },
    walker: {
      start: "patrol",
      behaviours: { shoot: { telegraphMs: 200 } },
      rules: [{ from: "patrol", to: "shoot", when: "sees" }, { from: "shoot", to: "patrol", when: "lost" }]
    },
    "boss-minion": { start: "ambush", rules: [{ from: "chase", to: "ambush", when: "lost" }] },
    guard: {
      start: "guard",
      rules: [{ from: "guard", to: "chase", when: { any: ["sees", "heard"] } }, { from: "chase", to: "guard", when: "lost" }]
    }
  };
  var WORDS2 = { sees: true, lost: true, hurt: true, heard: true, done: true };
  var LIVE = /* @__PURE__ */ new Set();
  function distance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function brain(scene, subject, spec) {
    const given = typeof spec === "string" ? { archetype: spec } : spec || {};
    const preset = PRESETS3[given.archetype] || {};
    if (given.archetype && !PRESETS3[given.archetype]) {
      console.warn('[aimeat-phaser] brain: "' + given.archetype + '" is not an archetype. They are ' + Object.keys(PRESETS3).join(", ") + "; going on with the spec alone.");
    }
    const s = Object.assign({}, preset, given);
    s.behaviours = Object.assign({}, preset.behaviours || {}, given.behaviours || {});
    s.rules = Array.isArray(given.rules) ? given.rules : preset.rules || [];
    const isActor = !!(subject && subject.sprite && typeof subject.update === "function");
    const actor2 = isActor ? subject : null;
    const sprite = isActor ? subject.sprite : subject;
    if (!sprite || typeof sprite.x !== "number") {
      throw new Error("[aimeat-phaser] brain(): the second argument is an actor (from actor()) or a sprite with a physics body.");
    }
    const th = look(scene);
    const world = scene.physics && scene.physics.world;
    const gravity = world && world.gravity ? world.gravity.y : 0;
    const mode = s.mode === "topdown" || s.mode === "platformer" ? s.mode : actor2 ? actor2.mode : gravity ? "platformer" : "topdown";
    if (s.fly && sprite.body) {
      if (typeof sprite.body.setAllowGravity === "function") sprite.body.setAllowGravity(false);
      else sprite.body.allowGravity = false;
    }
    const gridSource = s.grid || null;
    const tile = typeof s.tile === "number" ? s.tile : gridSource && gridSource.bounds && gridSource.bounds.tileWidth || 32;
    const sight = typeof s.sight === "number" ? s.sight : 200;
    const hearing = s.hearing === false ? -1 : typeof s.hearing === "number" ? s.hearing : sight;
    const fovRad = typeof s.fov === "number" && s.fov > 0 && s.fov < 360 ? s.fov * Math.PI / 180 : 0;
    const memoryMs = typeof s.memoryMs === "number" ? s.memoryMs : MEMORY_MS;
    const random = typeof s.random === "function" ? s.random : Math.random;
    const home = s.home && typeof s.home.x === "number" ? { x: s.home.x, y: s.home.y } : { x: sprite.x, y: sprite.y };
    const legs = motor({
      scene,
      sprite,
      actor: actor2,
      mode,
      speed: typeof s.speed === "number" ? s.speed : actor2 ? actor2.move.speed : 80,
      jump: typeof s.jump === "number" ? s.jump : actor2 ? actor2.move.jump : 320,
      tile,
      gridSource,
      solid: typeof s.solid === "function" ? s.solid : null,
      arrive: 6,
      artFaces: s.artFaces === "left" ? "left" : "right",
      budget: typeof s.budget === "number" ? s.budget : 0
    });
    let state = "";
    let stateSince = 0;
    let rawTarget = s.target;
    let targetPos = null;
    let sees = false;
    let wasSeeing = false;
    let lastSeen = null;
    let noise = null;
    let hurt = false;
    let paused = false;
    let gone = false;
    let flashLeft = 0;
    let current = null;
    const instances = {};
    const warned = {};
    const handlers = { state: [], see: [], lose: [], shoot: [], telegraph: [], hear: [] };
    let debugGfx = null;
    let debugLabel = null;
    function now() {
      return scene.time ? scene.time.now : 0;
    }
    function emit(event, a, b) {
      const list = handlers[event];
      if (!list) return;
      for (const fn of list.slice()) {
        try {
          fn(a, b);
        } catch (err) {
          console.warn('[aimeat-phaser] a brain handler for "' + event + '" threw:', err);
        }
      }
    }
    function once(key, text) {
      if (warned[key]) return;
      warned[key] = true;
      console.warn("[aimeat-phaser] brain: " + text);
    }
    function resolveTarget() {
      const t = typeof rawTarget === "function" ? rawTarget() : rawTarget;
      if (!t) return null;
      if (t.dead === true) return null;
      const pos = t.sprite && typeof t.sprite.x === "number" ? t.sprite : t;
      if (pos.active === false) return null;
      return typeof pos.x === "number" && typeof pos.y === "number" ? { x: pos.x, y: pos.y } : null;
    }
    function visible(range) {
      if (!targetPos) return false;
      const d = distance(sprite, targetPos);
      if (d > range) return false;
      if (fovRad && d > 0) {
        const f = legs.facing();
        const cos = (f.x * (targetPos.x - sprite.x) + f.y * (targetPos.y - sprite.y)) / d;
        if (cos < Math.cos(fovRad / 2)) return false;
      }
      if (typeof s.los === "function") return !!s.los({ x: sprite.x, y: sprite.y }, targetPos);
      const g = legs.grid();
      if (g) return lineClear(g, legs.toTile(sprite.x, sprite.y), legs.toTile(targetPos.x, targetPos.y));
      return true;
    }
    function perceive() {
      const t = now();
      targetPos = resolveTarget();
      sees = visible(sight);
      if (sees && targetPos) {
        lastSeen = { x: targetPos.x, y: targetPos.y, at: t };
        if (!wasSeeing) emit("see", targetPos);
      } else if (lastSeen && t - lastSeen.at > memoryMs) {
        lastSeen = null;
        emit("lose");
      }
      wasSeeing = sees;
      if (noise && t > noise.until) noise = null;
    }
    function hear(x, y, radius) {
      if (gone || hearing < 0) return false;
      const r = typeof radius === "number" ? radius : 0;
      const d = distance(sprite, { x, y });
      if (d > Math.max(r, hearing)) return false;
      noise = { x, y, radius: r, at: now(), until: now() + memoryMs };
      emit("hear", noise);
      return true;
    }
    function health() {
      if (typeof s.health === "function") return Number(s.health());
      once("health", "a healthBelow rule needs spec.health, a function answering 0..1. Read as 1.");
      return 1;
    }
    function holds(when) {
      if (typeof when === "function") return !!when(ctx);
      if (typeof when === "string") {
        if (!WORDS2[when]) once("word:" + when, '"' + when + '" is not a condition word (' + Object.keys(WORDS2).join(", ") + "). It never holds.");
        if (when === "sees") return sees;
        if (when === "lost") return !sees && !ctx.goal();
        if (when === "hurt") return hurt;
        if (when === "heard") return !!noise;
        if (when === "done") return !!ctx.done;
        return false;
      }
      if (Array.isArray(when)) return when.every(holds);
      if (!when || typeof when !== "object") return false;
      if (Array.isArray(when.all)) return when.all.every(holds);
      if (Array.isArray(when.any)) return when.any.some(holds);
      if (when.not !== void 0) return !holds(when.not);
      if (typeof when.near === "number") return !!targetPos && distance(sprite, targetPos) <= when.near;
      if (typeof when.far === "number") return !targetPos || distance(sprite, targetPos) > when.far;
      if (typeof when.healthBelow === "number") return health() < when.healthBelow;
      if (typeof when.timer === "number") return now() - stateSince >= when.timer;
      once("cond", "a rule has a condition with none of near, far, healthBelow, timer, all, any or not. It never holds.");
      return false;
    }
    function fromMatches(from) {
      if (from === "any" || from === void 0) return true;
      if (Array.isArray(from)) return from.indexOf(state) >= 0;
      return from === state;
    }
    function rules() {
      for (const rule of s.rules) {
        if (!rule || typeof rule.to !== "string" || rule.to === state) continue;
        if (!fromMatches(rule.from)) continue;
        if (holds(rule.when)) {
          set(rule.to);
          return;
        }
      }
    }
    function make(name) {
      const cfg2 = s.behaviours[name];
      if (typeof cfg2 === "function") return build(ctx, cfg2, {});
      const c = cfg2 || {};
      return build(ctx, c.type || name, c);
    }
    function set(next) {
      if (gone || !next || next === state) return false;
      const prev = state;
      if (current && typeof current.exit === "function") current.exit();
      state = next;
      stateSince = now();
      ctx.done = false;
      legs.forgetRoute();
      current = instances[next] || (instances[next] = make(next));
      if (typeof current.enter === "function") current.enter();
      emit("state", next, prev);
      return true;
    }
    function step(delta) {
      if (gone || paused) return;
      if (actor2 && actor2.dead) return;
      const dt = Math.max(0, Math.min(MAX_DT, typeof delta === "number" && isFinite(delta) ? delta : 16));
      ctx.dt = dt;
      ctx.now = now();
      if (flashLeft > 0 && --flashLeft === 0 && typeof sprite.clearTint === "function") sprite.clearTint();
      perceive();
      rules();
      hurt = false;
      if (current) current.update(dt);
      if (debugGfx) drawDebug();
    }
    function drawDebug() {
      const g = debugGfx;
      const x = sprite.x;
      const y = sprite.y;
      g.clear();
      g.lineStyle(1, th.accent, 0.5);
      g.strokeCircle(x, y, sight);
      if (fovRad) {
        const f = legs.facing();
        const a = Math.atan2(f.y, f.x);
        g.lineStyle(1, th.accent, 0.35);
        g.beginPath();
        g.moveTo(x, y);
        g.arc(x, y, sight, a - fovRad / 2, a + fovRad / 2, false);
        g.closePath();
        g.strokePath();
      }
      if (hearing > 0 && hearing !== sight) {
        g.lineStyle(1, th.inkDim, 0.35);
        g.strokeCircle(x, y, hearing);
      }
      const route = legs.path;
      if (route && route.length) {
        g.lineStyle(2, th.ok, 0.8);
        g.beginPath();
        g.moveTo(x, y);
        for (const p of route) g.lineTo(p.x, p.y);
        g.strokePath();
      }
      if (sees && targetPos) {
        g.lineStyle(1, th.err, 0.7);
        g.lineBetween(x, y, targetPos.x, targetPos.y);
      } else if (lastSeen) {
        g.lineStyle(1, th.warn, 0.5);
        g.lineBetween(x, y, lastSeen.x, lastSeen.y);
      }
      if (noise) {
        g.lineStyle(1, th.inkDim, 0.5);
        g.strokeCircle(noise.x, noise.y, 6);
      }
      const hh = (sprite.displayHeight || sprite.height || tile) / 2;
      debugLabel.setText(state);
      debugLabel.setPosition(Math.round(x), Math.round(y - hh - 4));
    }
    function debug(on) {
      if (gone || !scene.add) return;
      if (on && !debugGfx) {
        debugGfx = scene.add.graphics().setDepth(DEBUG_DEPTH);
        debugLabel = scene.add.text(0, 0, state, {
          fontFamily: th.fontMono,
          fontSize: "10px",
          color: hex(th.ink)
        }).setOrigin(0.5, 1).setDepth(DEBUG_DEPTH);
        drawDebug();
      } else if (!on && debugGfx) {
        debugGfx.destroy();
        debugLabel.destroy();
        debugGfx = null;
        debugLabel = null;
      }
    }
    const ctx = {
      sprite,
      actor: actor2,
      mode,
      get x() {
        return sprite.x;
      },
      get y() {
        return sprite.y;
      },
      speed: typeof s.speed === "number" ? s.speed : actor2 ? actor2.move.speed : 80,
      sight,
      tile,
      home,
      spec: s,
      now: 0,
      dt: 0,
      get state() {
        return state;
      },
      get stateMs() {
        return now() - stateSince;
      },
      get target() {
        return targetPos;
      },
      get sees() {
        return sees;
      },
      get lastSeen() {
        return lastSeen;
      },
      get noise() {
        return noise;
      },
      done: false,
      distance() {
        return targetPos ? distance(sprite, targetPos) : Infinity;
      },
      dist(a, b) {
        return b ? distance(a, b) : distance(sprite, a);
      },
      goal() {
        if (sees && targetPos) return targetPos;
        if (lastSeen) return { x: lastSeen.x, y: lastSeen.y };
        if (noise) return { x: noise.x, y: noise.y };
        return null;
      },
      visible,
      forgetNoise() {
        noise = null;
      },
      set,
      emit,
      rand(min, max) {
        return min + random() * (max - min);
      },
      flash() {
        if (typeof sprite.setTintFill !== "function") return;
        sprite.setTintFill(th.warn);
        flashLeft = 2;
      },
      go: legs.go,
      walk: legs.walk,
      drive: legs.drive,
      stop: legs.stop,
      face: legs.face,
      facing: legs.facing,
      probe: legs.probe,
      solidAt: legs.solidAt,
      onGround: legs.onGround,
      grid: legs.grid,
      walkable: legs.walkable,
      toTile: legs.toTile,
      toWorld: legs.toWorld
    };
    const onSceneUpdate = function(_time, delta) {
      step(delta);
    };
    const offHit = actor2 ? actor2.on("hit", function() {
      hurt = true;
    }) : null;
    function destroy() {
      if (gone) return;
      gone = true;
      LIVE.delete(api);
      scene.events.off("shutdown", destroy);
      if (s.auto !== false) scene.events.off("update", onSceneUpdate);
      if (offHit) offHit();
      if (current && typeof current.exit === "function") current.exit();
      current = null;
      if (debugGfx) {
        if (debugGfx.scene) debugGfx.destroy();
        if (debugLabel && debugLabel.scene) debugLabel.destroy();
        debugGfx = null;
        debugLabel = null;
      }
      for (const name in handlers) handlers[name].length = 0;
    }
    const api = {
      sprite,
      actor: actor2,
      mode,
      ctx,
      state() {
        return state;
      },
      set,
      target(t) {
        if (arguments.length) rawTarget = t;
        return rawTarget;
      },
      pause() {
        if (paused || gone) return;
        paused = true;
        legs.stop();
      },
      resume() {
        paused = false;
      },
      get paused() {
        return paused;
      },
      on(event, fn) {
        if (typeof fn !== "function" || !handlers[event]) {
          return function() {
          };
        }
        handlers[event].push(fn);
        return function off() {
          const at = handlers[event].indexOf(fn);
          if (at >= 0) handlers[event].splice(at, 1);
        };
      },
      update: step,
      path() {
        return legs.path;
      },
      debug,
      hurt() {
        hurt = true;
      },
      hear,
      destroy
    };
    set(typeof s.start === "string" ? s.start : "patrol");
    LIVE.add(api);
    if (s.auto !== false) scene.events.on("update", onSceneUpdate);
    scene.events.once("shutdown", destroy);
    if (s.debug) debug(true);
    return api;
  }
  brain.noise = function(x, y, radius, scene) {
    let heard = 0;
    for (const b of LIVE) {
      if (scene && b.sprite && b.sprite.scene && b.sprite.scene !== scene) continue;
      if (b.hear(x, y, radius)) heard += 1;
    }
    return heard;
  };

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
  function num4(v) {
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
        stars: Math.max(num4(r.stars), num4(g.stars)),
        best: Math.max(num4(r.best), num4(g.best))
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
    out.best = Math.max(num4(remote.best), num4(guest.best));
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
      best: num4(state.best),
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
      rec.stars = num4(rec.stars);
      rec.best = num4(rec.best);
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
          return rec2 ? num4(rec2.stars) : 0;
        }
        const rec = ensureLevel(id);
        const want = Math.max(0, Math.floor(num4(n)));
        if (want <= rec.stars) return false;
        rec.stars = want;
        touch();
        return true;
      },
      /** Record a score on this level. Returns true when it beat what was there. */
      best(id, score2) {
        const rec = ensureLevel(id);
        const want = num4(score2);
        if (want <= rec.best) return false;
        rec.best = want;
        touch();
        return true;
      },
      /** This level's record, or null when the player has never reached it. */
      get(id) {
        const rec = state.levels[String(id)];
        return rec ? { unlocked: !!rec.unlocked, stars: num4(rec.stars), best: num4(rec.best) } : null;
      }
    };
    function score(add) {
      if (typeof add === "number" && isFinite(add) && add !== 0) {
        sessionScore += add;
        if (sessionScore > num4(state.best)) {
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
      const limit = Math.max(1, Math.floor(num4(opts && opts.limit) || 10));
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
          best: num4(v.best),
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
      const top2 = pad2 + scoreText.height + 6;
      for (let i = 0; i < hearts.length; i++) {
        hearts[i].setPosition(pad2 + 9 + i * 22, top2 + 9);
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
    const box2 = scene.add.container(x, y, [pill, label]).setScrollFactor(0).setDepth(depth).setAlpha(0);
    scene.tweens.add({
      targets: box2,
      alpha: 1,
      y: y - 8,
      duration: 160,
      ease: "Quad.easeOut"
    });
    scene.time.delayedCall(hold, function() {
      if (!box2.scene) return;
      scene.tweens.add({
        targets: box2,
        alpha: 0,
        y: y - rise,
        duration: 260,
        ease: "Quad.easeIn",
        onComplete: function() {
          box2.destroy();
        }
      });
    });
    return box2;
  }

  // src/static/sdk-libs/phaser/level.js
  var DEFAULT_LEGEND3 = {
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
    const marks = Object.assign({}, DEFAULT_LEGEND3, legend || {});
    const tiles2 = [];
    const coins = [];
    const enemies = [];
    const spikes = [];
    let spawn2 = null;
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
        else if (kind === "spawn") spawn2 = { x, y };
        else if (kind === "goal") goal = { x, y };
      }
    }
    return {
      width,
      height: lines.length,
      tiles: tiles2,
      spawn: spawn2,
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
    const given = s.player && s.player.sprite ? s.player : null;
    const move2 = Object.assign({ speed: 220, jump: 420, doubleJump: false }, given ? given.move : s.player || {});
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
    let backdrop = null;
    if (s.parallaxBackdrop === true) drawParallax(scene, th, pxW, pxH);
    else if (s.parallaxBackdrop) backdrop = parallax(scene, s.parallaxBackdrop);
    const ground2 = scene.physics.add.staticGroup();
    for (const t of map.tiles) {
      if (NOT_SOLID[t.kind]) continue;
      const key = ensureTexture(scene, tex[t.kind] || "tile-" + t.kind, t.kind, tile, th);
      const block2 = ground2.create(t.x * tile + tile / 2, t.y * tile + tile / 2, key);
      block2.setDisplaySize(tile, tile);
      block2.refreshBody();
    }
    const coins = scene.physics.add.staticGroup();
    const spikes = scene.physics.add.staticGroup();
    const goal = scene.physics.add.staticGroup();
    const enemies = scene.physics.add.group();
    const playerKey = given ? given.key : ensureTexture(scene, tex.player, "player", tile, th);
    const start = map.spawn || { x: 1, y: Math.max(0, map.height - 2) };
    const player = given ? given.sprite : scene.physics.add.sprite(start.x * tile + tile / 2, start.y * tile + tile / 2, playerKey);
    if (given) {
      player.setPosition(start.x * tile + tile / 2, start.y * tile + tile / 2);
    } else {
      player.setBounce(0.04);
      player.setCollideWorldBounds(s.bounds !== false);
    }
    scene.physics.add.collider(player, ground2);
    scene.physics.add.collider(enemies, ground2);
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
        foe.setVelocityX(move2.speed * ENEMY_SHARE);
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
      if (given) {
        given.die(function() {
          placePlayer();
          given.reset();
          dead = false;
        });
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
      groups: { ground: ground2, coins, enemies, spikes, goal },
      map,
      backdrop,
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
          if (!given) animate(0, onGround);
          return;
        }
        if (given) {
          given.update(s.controls);
          return;
        }
        const c = s.controls;
        const left = !!(c && c.left);
        const right = !!(c && c.right);
        const wantJump = !!(c && c.jump);
        const vx = left === right ? 0 : left ? -move2.speed : move2.speed;
        player.setVelocityX(vx);
        if (vx !== 0) player.setFlipX(vx < 0);
        if (wantJump && !jumpHeld) {
          if (onGround) player.setVelocityY(-move2.jump);
          else if (move2.doubleJump && airJumps < 1) {
            player.setVelocityY(-move2.jump * 0.86);
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
        [coins, spikes, goal, enemies, ground2].forEach(function(group) {
          if (group && group.children) group.clear(true, true);
        });
        if (backdrop) {
          backdrop.destroy();
          backdrop = null;
        }
        if (!given) player.destroy();
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
        foe.setVelocityX(move2.speed * ENEMY_SHARE * dir);
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
      const made2 = K.section({ target: host, title });
      return made2.body;
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
        const button2 = el("button", {
          type: "button",
          class: "ak-btn ak-btn--ghost",
          "data-ak-noguard": true,
          "aria-label": "Change the key for " + words,
          on: { click: function() {
            capture(action, button2);
          } }
        }, "Rebind");
        body.appendChild(el("tr", {}, [
          el("th", { scope: "row", text: words }),
          cell,
          el("td", {}, button2)
        ]));
      }
      const read = function() {
        const now = readKeys();
        for (const action of actions) cells[action].textContent = keyLabel(now[action]);
      };
      readers.push(read);
      read();
    }
    function capture(action, button2) {
      if (capturing) window.removeEventListener("keydown", capturing, true);
      button2.classList.add("akp-settings__listening");
      button2.textContent = "Press a key";
      const listener = function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        window.removeEventListener("keydown", listener, true);
        capturing = null;
        button2.classList.remove("akp-settings__listening");
        button2.textContent = "Rebind";
        if (ev.key === "Escape") return;
        writeKeys(action, [phaserKey(ev)]);
        api.refresh();
      };
      capturing = listener;
      window.addEventListener("keydown", listener, true);
    }
    function build2() {
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
    build2();
    return api;
  }

  // src/static/sdk-libs/phaser/index.js
  var phaser = {
    /**
     * The library version. It MUST match the newest entry in /lib/aimeat-phaser.css's version
     * history; e2e-libs.ts fails when the two drift.
     */
    version: "1.2.0",
    // ── Boot and the look ──
    ensurePhaser,
    theme,
    game,
    // ── Assets (a pack by hand, or an aimeat-assets library through fromLibrary) ──
    pack,
    preloadPack,
    fromLibrary,
    textures,
    // ── Sound: the bus, and a tune generated on it ──
    audio,
    chiptune,
    // ── Feel, players together, phones ──
    juice,
    net,
    mobile,
    // ── The DOM panels: the level editor, and the two designers that tune fx and parallax live ──
    levelEditor,
    fxDesigner,
    parallaxDesigner,
    // ── Effects, backdrops, sprites and the overworld ──
    fx,
    parallax,
    dayNight,
    spriteSheet,
    animations,
    actor,
    spriteFromLibrary,
    worldMap,
    worldMapScene,
    tileWorld,
    minimap,
    // ── The player's status, trophies, talk ──
    status,
    achievements,
    trophyRoom,
    dialogue,
    cutscene,
    // ── Enemies that think, and the boss fight ──
    brain,
    behaviours,
    pathfind,
    boss,
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
