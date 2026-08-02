// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/connect/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-connect.js (with a per-node config prelude).
"use strict";
(() => {
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
  function authFetch(path, opts, libLabel) {
    return getSession(libLabel).fetch(path, opts);
  }
  function makeSession(libLabel) {
    return {
      getSession: () => getSession(libLabel),
      authFetch: (path, opts) => authFetch(path, opts, libLabel)
    };
  }

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

  // src/static/sdk-libs/connect/panel.js
  var STYLE_ID = "aimeat-connect-style";
  function el(tag, opts, children) {
    const node = document.createElement(tag);
    const o = opts || {};
    if (o.cls) node.className = o.cls;
    if (o.text != null) node.textContent = o.text;
    if (o.attrs) for (const k of Object.keys(o.attrs)) node.setAttribute(k, o.attrs[k]);
    if (o.on) for (const k of Object.keys(o.on)) node.addEventListener(k, o.on[k]);
    for (const c of children || []) if (c) node.appendChild(c);
    return node;
  }
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
.aim-conn { font: inherit; color: inherit; }
.aim-conn-list { display: flex; flex-direction: column; gap: .5rem; margin: .75rem 0; }
.aim-conn-row { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem .75rem;
  padding: .6rem .75rem; border: 1px solid currentColor; border-radius: .5rem; opacity: .95; }
.aim-conn-main { display: flex; flex-direction: column; min-width: 0; flex: 1 1 12rem; }
.aim-conn-label { font-weight: 600; overflow-wrap: anywhere; }
.aim-conn-meta { font-size: .85em; opacity: .7; }
.aim-conn-actions { display: flex; gap: .5rem; flex-wrap: wrap; }
.aim-conn-btn { font: inherit; color: inherit; background: transparent; cursor: pointer;
  border: 1px solid currentColor; border-radius: .4rem; padding: .35rem .7rem; }
.aim-conn-btn[disabled] { opacity: .5; cursor: default; }
.aim-conn-note { font-size: .85em; opacity: .75; margin: .35rem 0 0; }
.aim-conn-empty { opacity: .7; margin: .75rem 0; }
.aim-conn-add { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .75rem; }
.aim-conn-input { font: inherit; color: inherit; background: transparent; padding: .35rem .5rem;
  border: 1px solid currentColor; border-radius: .4rem; min-width: 0; flex: 1 1 12rem; }
.aim-conn-err { font-size: .9em; margin: .5rem 0 0; }
`;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }
  var DEFAULT_STRINGS = {
    title: "Connected accounts",
    intro: "Accounts you have connected so apps can act at those services on your behalf. The account credential stays on this node; an app is only ever told which account it may use.",
    empty: "You have not connected any accounts yet.",
    add: "Connect",
    connecting: "Connecting…",
    disconnect: "Disconnect",
    reconnect: "Reconnect",
    needsReauth: "needs reconnecting",
    instancePlaceholder: "instance address, e.g. mastodon.social",
    confirm: "Disconnect this account? Apps that publish to it will stop being able to.",
    toldProvider: "Disconnected, and the service was told.",
    notToldProvider: "Disconnected here. The service could not be reached to be told, so check it there too.",
    unavailable: "Connecting accounts is not enabled on this node."
  };
  async function mountConnectPanel(connect2, opts = {}) {
    const host = typeof opts.target === "string" ? document.querySelector(opts.target) : opts.target;
    if (!host) throw new Error("aimeat-connect: panel target not found");
    if (opts.styles !== false) injectStyle();
    const s = { ...DEFAULT_STRINGS, ...opts.strings || {} };
    const root = el("div", { cls: "aim-conn" });
    host.replaceChildren(root);
    let providers2 = [];
    let busy = false;
    async function render() {
      let accounts;
      try {
        [accounts, providers2] = await Promise.all([connect2.list(), connect2.providers()]);
      } catch (err) {
        root.replaceChildren(el("p", { cls: "aim-conn-err", text: `${s.unavailable} (${err && err.message || err})` }));
        return;
      }
      const rows = accounts.map((c) => {
        const needsReauth = c.status === "needs_reauth";
        return el("div", { cls: "aim-conn-row" }, [
          el("div", { cls: "aim-conn-main" }, [
            el("span", { cls: "aim-conn-label", text: c.accountLabel }),
            el("span", {
              cls: "aim-conn-meta",
              text: needsReauth ? `${c.provider} · ${s.needsReauth}` : c.provider
            })
          ]),
          el("div", { cls: "aim-conn-actions" }, [
            // Shown as a FIX, not as an error. Two clicks and it works again.
            needsReauth ? el("button", {
              cls: "aim-conn-btn",
              text: s.reconnect,
              attrs: { type: "button" },
              on: { click: () => void beginConnect(c.provider, null) }
            }) : null,
            el("button", {
              cls: "aim-conn-btn",
              text: s.disconnect,
              attrs: { type: "button" },
              on: {
                click: () => {
                  if (!window.confirm(s.confirm)) return;
                  void (async () => {
                    const r = await connect2.revoke(c.id);
                    await render();
                    window.alert(r.toldProvider ? s.toldProvider : s.notToldProvider);
                  })();
                }
              }
            })
          ])
        ]);
      });
      const list2 = rows.length ? el("div", { cls: "aim-conn-list" }, rows) : el("p", { cls: "aim-conn-empty", text: s.empty });
      root.replaceChildren(
        el("p", { cls: "aim-conn-note", text: s.intro }),
        list2,
        ...providers2.map(renderAdd)
      );
    }
    function renderAdd(p) {
      const note = connect2.notes && connect2.notes[p.id] || {};
      let instanceInput = null;
      if (p.instanceScoped) {
        instanceInput = el("input", {
          cls: "aim-conn-input",
          attrs: { type: "text", placeholder: s.instancePlaceholder, "aria-label": s.instancePlaceholder }
        });
      }
      const attachInputs = (p.attachFields || []).map((f) => el("input", {
        cls: "aim-conn-input",
        attrs: {
          type: f.secret ? "password" : "text",
          autocomplete: f.secret ? "new-password" : "off",
          placeholder: f.placeholder || f.label,
          "aria-label": f.label,
          "data-field": f.name
        }
      }));
      const btn = el("button", {
        cls: "aim-conn-btn",
        text: `${s.add} ${p.label}`,
        attrs: { type: "button" },
        on: {
          click: () => {
            if (!p.attachFields) return void beginConnect(p.id, instanceInput);
            const fields = {};
            for (const input of attachInputs) fields[input.getAttribute("data-field")] = input.value;
            void beginAttach(p.id, fields, attachInputs);
          }
        }
      });
      return el("div", {}, [
        el("div", { cls: "aim-conn-add" }, [instanceInput, ...attachInputs, btn]),
        // Before the attempt, always. Each of these prevents a failure whose message does not
        // explain itself.
        note.needs ? el("p", { cls: "aim-conn-note", text: note.needs }) : null,
        note.where ? el("p", { cls: "aim-conn-note", text: note.where }) : null,
        note.before ? el("p", { cls: "aim-conn-note", text: note.before }) : null
      ]);
    }
    async function beginConnect(providerId, instanceInput) {
      if (busy) return;
      busy = true;
      const instance = instanceInput ? instanceInput.value.trim() : void 0;
      try {
        await connect2.start(providerId, { instance });
      } catch (err) {
        const msg = err && err.message || String(err);
        root.appendChild(el("p", { cls: "aim-conn-err", text: msg }));
      } finally {
        busy = false;
        await render();
      }
    }
    async function beginAttach(providerId, fields, inputs) {
      if (busy) return;
      busy = true;
      try {
        await connect2.attach(providerId, fields);
        for (const i of inputs) i.value = "";
      } catch (err) {
        root.appendChild(el("p", { cls: "aim-conn-err", text: err && err.message || String(err) }));
      } finally {
        busy = false;
        await render();
      }
    }
    connect2.on(() => void render());
    await render();
    return { refresh: render };
  }

  // src/static/sdk-libs/connect/notes.js
  var PROVIDER_NOTES = {
    mastodon: {
      needs: "The address of your instance, for example mastodon.social.",
      before: "Your account lives at one instance, and the same name at another instance is a different account."
    },
    youtube: {
      before: "Sign in with the Google account that owns the channel. A Google account with no YouTube channel will connect and then have nowhere to publish."
    },
    bluesky: {
      needs: "An app password. This is NOT your Bluesky password.",
      where: "Bluesky → Settings → Privacy and security → App passwords.",
      before: "This is the one provider that asks you to copy a secret to us instead of approving on their site. You can revoke it from Bluesky at any time, and it cannot be used to sign in as you."
    },
    instagram: {
      before: "Instagram publishing needs a Business or Creator account linked to a Facebook Page. A personal account will connect and then refuse to publish, with an error that does not say why."
    },
    telegram: {
      needs: "A bot token from @BotFather, and the bot added to your channel with permission to post.",
      before: "Adding the bot to the channel is a step only you can do; without it the connection works and publishing does not."
    }
  };

  // src/static/sdk-libs/connect/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-connect.js");
  var listeners = /* @__PURE__ */ new Set();
  function announce() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        console.warn("[aimeat-connect] a change listener threw", err);
      }
    }
  }
  async function list() {
    const res = await authFetch2("/v1/connections");
    return res?.data?.connections ?? [];
  }
  async function providers() {
    const res = await authFetch2("/v1/connections/providers");
    return res?.data?.providers ?? [];
  }
  async function start(provider, opts = {}) {
    const before = await list();
    const res = await authFetch2("/v1/connections/start", {
      method: "POST",
      body: JSON.stringify({
        provider,
        instance: opts.instance,
        mode: opts.mode ?? "personal",
        // The callback returns the browser here; a same-origin path only, which the node enforces.
        // A static page whose only job is to close the pop-up, because the backend renders no HTML.
        return_url: "/connection-done.html"
      })
    });
    const url = res?.data?.authorize_url;
    if (!url) throw new Error("the node did not return an authorization URL");
    const win = window.open(url, "aimeat-connect", "width=620,height=760,noopener=no");
    if (!win) throw new Error("the connect window was blocked; allow pop-ups for this site");
    await waitForRound(before.length, opts.signal);
    const after = await list();
    const known = new Set(before.map((c) => c.id));
    const added = after.find((c) => !known.has(c.id));
    const repaired = after.find((c) => {
      const prev = before.find((p) => p.id === c.id);
      return prev && prev.status !== "active" && c.status === "active";
    });
    announce();
    const connection = added ?? repaired;
    return { connected: Boolean(connection), connection };
  }
  async function waitForRound(countBefore, signal) {
    const DEADLINE = Date.now() + 18e4;
    let channel = null;
    let announced = false;
    let aborted = false;
    try {
      channel = new BroadcastChannel("aimeat-connect");
      channel.onmessage = () => {
        announced = true;
      };
    } catch (err) {
      console.warn("[aimeat-connect] BroadcastChannel unavailable; falling back to polling", err);
    }
    if (signal) signal.addEventListener("abort", () => {
      aborted = true;
    }, { once: true });
    try {
      while (Date.now() < DEADLINE && !aborted) {
        await new Promise((r) => setTimeout(r, 1200));
        if (announced) return true;
        const now = await list();
        if (now.length > countBefore) return true;
      }
      return false;
    } finally {
      if (channel) channel.close();
    }
  }
  async function attachAccount(provider, fields) {
    const res = await authFetch2("/v1/connections/attach", {
      method: "POST",
      body: JSON.stringify({ provider, mode: "personal", fields })
    });
    announce();
    return { connected: true, connection: res?.data?.connection };
  }
  async function revoke(connectionId) {
    const res = await authFetch2(`/v1/connections/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
    announce();
    return { revoked: true, toldProvider: Boolean(res?.data?.told_provider) };
  }
  function on(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function off(fn) {
    listeners.delete(fn);
  }
  var connect = {
    list,
    providers,
    start,
    attach: attachAccount,
    revoke,
    on,
    off,
    /** Per-provider things a user must be told BEFORE they try. See notes.js. */
    notes: PROVIDER_NOTES,
    /** Mount the ready-made panel. See panel.js. */
    panel: (opts) => mountConnectPanel(connect, opts)
  };
  attach("connect", connect);
  var index_default = connect;
})();
