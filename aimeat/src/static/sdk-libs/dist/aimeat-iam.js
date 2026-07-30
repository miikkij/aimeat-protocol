// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/iam/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-iam.js (with a per-node config prelude).
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

  // src/static/sdk-libs/_core/config.js
  function cfg() {
    return window.__AIMEAT_SDK_CFG__ || { nodeId: "", baseUrl: "" };
  }
  function resolveNodeUrl() {
    const meta = document.querySelector('meta[name="aimeat-node"]');
    if (meta) return (meta.getAttribute("content") || "").replace(/\/$/, "");
    if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
    return cfg().baseUrl;
  }
  var NODE_URL = resolveNodeUrl();
  var APEX_URL = cfg().baseUrl;
  var NODE_ID = cfg().nodeId;
  var HEARTBEAT_MS = cfg().heartbeatMs || 3e4;

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

  // src/static/sdk-libs/iam/dialect.js
  var DIALECTS = {
    node: { gate: null, admin: null, key: null, state: "state", assign: "assign", revoke: "revoke" },
    op: { gate: "check", admin: "admin", key: "op", state: "getState", assign: "assign", revoke: "revoke" },
    command: { gate: "check", admin: "admin", key: "command", state: "list", assign: "approve", revoke: "revoke" },
    level: { gate: "mylevel", admin: "admin", key: "op", state: "getState", assign: "assign", revoke: "revoke" }
  };
  async function detectDialect(nodeUrl, ext) {
    const res = await fetch(nodeUrl + "/v1/extensions/" + encodeURIComponent(ext));
    if (!res.ok) {
      throw new Error('aimeat-iam: extension "' + ext + '" was not found on this node (' + res.status + ")");
    }
    const body = await res.json();
    const record = body.data && (body.data.extension || body.data) || {};
    const actions = (record.actions || []).map((a) => a.id);
    if (!actions.length) throw new Error('aimeat-iam: extension "' + ext + '" advertises no actions');
    if (actions.indexOf("mylevel") !== -1) {
      return { dialect: "level", actions, hasRequest: false };
    }
    const admin = (record.actions || []).find((a) => a.id === "admin");
    const props = admin && (admin.inputSchema || admin.input_schema) && (admin.inputSchema || admin.input_schema).properties || {};
    const dialect = props.command && !props.op ? "command" : "op";
    return { dialect, actions, hasRequest: actions.indexOf("request") !== -1 };
  }
  function callCheck(call, ext, dialect, input) {
    const d = DIALECTS[dialect];
    const body = dialect === "command" ? input && input.owner ? { owner: input.owner } : {} : input || {};
    return unwrap(call("/v1/ext/" + ext + "/" + d.gate, { method: "POST", body: JSON.stringify(body) }));
  }
  function callAdmin(call, ext, dialect, op, args) {
    const d = DIALECTS[dialect];
    const resolved = d[op] || op;
    const body = Object.assign({}, args || {});
    body[d.key] = resolved;
    return unwrap(call("/v1/ext/" + ext + "/" + d.admin, { method: "POST", body: JSON.stringify(body) }));
  }
  async function callRequest(call, ext, dialect, hasRequest, note) {
    if (!hasRequest) {
      return { recorded: true, passive: true };
    }
    const r = await unwrap(call("/v1/ext/" + ext + "/request", {
      method: "POST",
      body: JSON.stringify(note ? { note } : {})
    }));
    return { recorded: r.recorded !== false, passive: false, note: r.note, alreadyMember: r.alreadyMember };
  }
  async function unwrap(p) {
    const body = await p;
    if (body && body.data !== void 0) return body.data;
    return body;
  }

  // src/static/sdk-libs/iam/gate.js
  function makeGate(store, serverCheck) {
    function can(cap) {
      const me = store.me();
      if (!me) return false;
      const caps = me.caps || [];
      return caps.indexOf("*") !== -1 || caps.indexOf(cap) !== -1;
    }
    function gate(target, cap) {
      const el2 = (
        /** @type {HTMLElement|null} */
        typeof target === "string" ? document.querySelector(target) : target
      );
      if (!el2) return;
      el2.hidden = !can(cap);
    }
    async function guard(cap, fn) {
      const verdict = await serverCheck({ permission: cap });
      if (!verdict || !verdict.allowed) return void 0;
      return fn();
    }
    return { can, gate, guard };
  }

  // src/static/sdk-libs/iam/dom.js
  var STYLE_ID = "aimeat-iam-style";
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
  function injectPanelStyle(enabled) {
    if (enabled === false) return;
    if (document.getElementById(STYLE_ID)) return;
    const css = [
      ".aim-iam{display:flex;flex-direction:column;gap:1rem;color:inherit;font:inherit}",
      ".aim-iam-sec{display:flex;flex-direction:column;gap:.5rem}",
      ".aim-iam-h{font-weight:600;margin:0}",
      ".aim-iam-lead{opacity:.75;font-size:.9em;margin:0;max-width:66ch}",
      ".aim-iam-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;padding:.4rem 0;border-bottom:1px solid currentColor;border-bottom-color:color-mix(in srgb,currentColor 15%,transparent)}",
      ".aim-iam-id{font-family:ui-monospace,monospace;font-size:.85em;word-break:break-all;min-width:0;flex:1 1 12rem}",
      ".aim-iam-badge{font-size:.75em;padding:.1rem .5rem;border:1px solid currentColor;border-radius:999px;opacity:.85;white-space:nowrap}",
      ".aim-iam-muted{opacity:.65;font-size:.85em}",
      ".aim-iam-warn{opacity:1;font-weight:600}",
      ".aim-iam-note{opacity:.8;font-size:.85em;font-style:italic;flex-basis:100%}",
      // The panel is often narrow inside an app tab, so the controls wrap instead of forcing the page
      // to scroll sideways. A horizontal scrollbar on an admin panel reads as a broken layout.
      ".aim-iam-form{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}",
      ".aim-iam-form input,.aim-iam-form select{min-width:0;flex:1 1 12rem;font:inherit;padding:.35rem .5rem}",
      ".aim-iam-form button,.aim-iam-row button{font:inherit;padding:.3rem .7rem;cursor:pointer}",
      ".aim-iam-empty{opacity:.65;font-size:.9em;padding:.4rem 0}"
    ].join("");
    const tag = document.createElement("style");
    tag.id = STYLE_ID;
    tag.textContent = css;
    document.head.appendChild(tag);
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toISOString().slice(0, 10);
  }

  // src/static/sdk-libs/iam/i18n.js
  var STRINGS = {
    en: {
      whoTitle: "Who may use this",
      modeLabel: "Mode",
      modeOpen: "open",
      modeMembers: "members-only",
      modeInvite: "invite-only",
      modeSwitch: "Switch",
      modeMeaningOpen: "Anyone signed in may use it. Approving someone still changes what they pay.",
      modeMeaningMembers: "Only approved members may use it. Everyone else is refused and told how to ask.",
      approveTitle: "Approve someone",
      approvePlaceholder: "account name, or owner@node",
      approveBtn: "Approve",
      approveHelp: "A role belongs to the person, so their agents inherit it. Add a row for agent#owner@node only to give that one agent something different.",
      pendingTitle: "Asked for access",
      pendingNone: "Nobody is waiting.",
      seenTitle: "Turned up, holds no role",
      seenNone: "Nobody has turned up yet.",
      visits: "{n} visits, last {d}",
      membersTitle: "Approved",
      membersNone: "Nobody is approved yet.",
      colAccount: "Account",
      colRole: "Role",
      colSince: "Member since",
      colGrants: "Free access",
      remove: "Remove",
      decline: "Decline",
      carried: "{n} / {of} carried",
      carriedNone: "none carried",
      usage: "{n} calls, {cost} carried",
      carriedWarn: "{n} not carried",
      payingTitle: "Paying customers: {n}",
      payingLead: "They took a contract and let themselves in. Nothing here is waiting for you.",
      payingNone: "No paying customers yet.",
      strangerTitle: "What a stranger gets",
      strangerRole: 'Anyone signed in who is not on the list gets "{role}".',
      strangerDeny: "Anyone not on the list is refused.",
      settingsTitle: "Settings",
      joinTitle: "Ask for access",
      joinNote: "Who you are and what you need it for",
      joinBtn: "Send request",
      joinSent: "Your request was recorded. The owner decides.",
      joinPassive: "Your visit has been recorded. The owner sees you in their list and can approve you.",
      joinAlready: "You already have access.",
      notOwner: "Only the owner manages members.",
      failed: "That did not go through.",
      loading: "Loading…"
    },
    fi: {
      whoTitle: "Ketkä saavat käyttää",
      modeLabel: "Tila",
      modeOpen: "avoin",
      modeMembers: "vain jäsenet",
      modeInvite: "vain kutsutut",
      modeSwitch: "Vaihda",
      modeMeaningOpen: "Kuka tahansa kirjautunut saa käyttää. Hyväksyntä muuttaa silti sen mitä käyttäjä maksaa.",
      modeMeaningMembers: "Vain hyväksytyt jäsenet saavat käyttää. Muille kerrotaan miten pääsyä pyydetään.",
      approveTitle: "Hyväksy käyttäjä",
      approvePlaceholder: "tilinimi tai omistaja@solmu",
      approveBtn: "Hyväksy",
      approveHelp: "Rooli kuuluu ihmiselle, joten hänen agenttinsa perivät sen. Lisää rivi muodossa agentti#omistaja@solmu vain jos haluat että juuri se agentti pitää jotain muuta.",
      pendingTitle: "Pyytäneet pääsyä",
      pendingNone: "Kukaan ei odota.",
      seenTitle: "Käyneet, ei roolia",
      seenNone: "Kukaan ei ole vielä käynyt.",
      visits: "{n} käyntiä, viimeksi {d}",
      membersTitle: "Hyväksytyt",
      membersNone: "Ketään ei ole vielä hyväksytty.",
      colAccount: "Tili",
      colRole: "Rooli",
      colSince: "Jäsen alkaen",
      colGrants: "Maksuton käyttö",
      remove: "Poista",
      decline: "Hylkää",
      carried: "{n} / {of} katettu",
      carriedNone: "ei katettuja",
      usage: "{n} kutsua, {cost} katettu",
      carriedWarn: "{n} kattamatta",
      payingTitle: "Maksavat asiakkaat: {n}",
      payingLead: "He ottivat sopimuksen ja päästivät itsensä sisään. Täällä ei odota mitään päätöstä.",
      payingNone: "Ei vielä maksavia asiakkaita.",
      strangerTitle: "Mitä tuntematon saa",
      strangerRole: 'Kirjautunut joka ei ole listalla saa roolin "{role}".',
      strangerDeny: "Listan ulkopuolinen ei saa käyttää tätä.",
      settingsTitle: "Asetukset",
      joinTitle: "Pyydä pääsyä",
      joinNote: "Kuka olet ja mihin tarvitset tätä",
      joinBtn: "Lähetä pyyntö",
      joinSent: "Pyyntösi on kirjattu. Omistaja päättää.",
      joinPassive: "Käyntisi on kirjattu. Omistaja näkee sinut listallaan ja voi hyväksyä sinut.",
      joinAlready: "Sinulla on jo pääsy.",
      notOwner: "Vain omistaja hallinnoi jäseniä.",
      failed: "Se ei mennyt läpi.",
      loading: "Ladataan…"
    }
  };
  function pickLang(explicit) {
    const raw = explicit || document.documentElement && document.documentElement.lang || "en";
    const short = String(raw).toLowerCase().slice(0, 2);
    return STRINGS[short] ? short : "en";
  }
  function t(lang, key, vars, overrides) {
    const table = STRINGS[lang] || STRINGS.en;
    let s = overrides && overrides[key] || table[key] || STRINGS.en[key] || key;
    if (vars) {
      for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(String(vars[k]));
    }
    return s;
  }

  // src/static/sdk-libs/iam/panel.js
  var MODES = ["open", "members-only", "invite-only"];
  function mountMemberAdmin(iam2, opts) {
    const host = typeof opts.target === "string" ? document.querySelector(opts.target) : opts.target;
    if (!host) throw new Error("aimeat-iam: MemberAdmin target not found");
    injectPanelStyle(opts.styles);
    const lang = pickLang(opts.lang);
    const S = (k, v) => t(lang, k, v, opts.strings);
    const cls = (hook) => hook + (opts.classMap && opts.classMap[hook] ? " " + opts.classMap[hook] : "");
    let grants = (
      /** @type {Record<string, { carried: number, total: number, calls: number, units: number, unit: string }>} */
      {}
    );
    let paying = (
      /** @type {Array<{id:string,label?:string,spend?:string}>} */
      []
    );
    async function loadGrants() {
      if (!opts.appId) return;
      try {
        const body = await iam2.adminFetch("/v1/exchange/grants?app_id=" + encodeURIComponent(opts.appId));
        const rows = body && body.grants || [];
        const byConsumer = {};
        for (const g of rows) {
          const who = String(g.consumer_gaii || g.consumer || "").toLowerCase().split("@")[0].split("#").pop();
          if (!who) continue;
          byConsumer[who] = byConsumer[who] || { carried: 0, total: 0, calls: 0, units: 0, unit: "" };
          byConsumer[who].total += 1;
          if ((g.state || g.status) === "active") byConsumer[who].carried += 1;
          byConsumer[who].calls += g.budget && g.budget.calls || 0;
          byConsumer[who].units += g.carried_units || 0;
          if (!byConsumer[who].unit) byConsumer[who].unit = g.unit === "money" ? g.currency || "EUR" : "morsels";
        }
        grants = byConsumer;
      } catch {
        grants = {};
      }
    }
    async function loadPaying() {
      if (!opts.payingCustomers) return;
      try {
        paying = await opts.payingCustomers() || [];
      } catch {
        paying = [];
      }
    }
    function usageCell(id) {
      const key = String(id).toLowerCase().split("@")[0].split("#").pop();
      const g = grants[key];
      if (!g || !g.calls) return null;
      const cost = g.unit === "morsels" ? `${g.units} ${g.unit}` : `${(g.units / 1e6).toFixed(2)} ${g.unit}`;
      return el("span", { cls: cls("aim-iam-muted"), text: S("usage", { n: g.calls, cost }) });
    }
    function grantCell(id) {
      const key = String(id).toLowerCase().split("@")[0].split("#").pop();
      const g = grants[key];
      if (!g || !g.total) return null;
      const done = g.carried === g.total;
      return el("span", {
        cls: cls("aim-iam-badge") + (done ? "" : " aim-iam-warn"),
        text: done ? S("carried", { n: g.carried, of: g.total }) : S("carriedWarn", { n: g.total - g.carried })
      });
    }
    async function act(fn) {
      try {
        await fn();
      } catch {
      }
      await render();
    }
    async function render() {
      host.textContent = "";
      const me = iam2.me();
      const wrap = el("div", { cls: cls("aim-iam") });
      host.appendChild(wrap);
      if (!me || !me.isOwner) {
        wrap.appendChild(el("p", { cls: cls("aim-iam-empty"), text: S("notOwner") }));
        return;
      }
      const state2 = await iam2.admin("state").catch(() => null);
      const roster = await iam2.roster().catch(() => ({ ok: false, members: [] }));
      await loadGrants();
      await loadPaying();
      const roles = state2 && state2.roles ? Object.keys(state2.roles) : [];
      const defaultRole = state2 && state2.config && state2.config.defaultRole || null;
      if (me.mode) {
        const next = MODES[(MODES.indexOf(me.mode) + 1) % MODES.length];
        wrap.appendChild(el("section", { cls: cls("aim-iam-sec") }, [
          el("h3", { cls: cls("aim-iam-h"), text: S("whoTitle") }),
          el("div", { cls: cls("aim-iam-form") }, [
            el("span", { cls: cls("aim-iam-muted"), text: S("modeLabel") }),
            el("span", { cls: cls("aim-iam-badge"), text: me.mode }),
            el("button", {
              cls: cls("aim-iam-btn"),
              text: S("modeSwitch"),
              attrs: { type: "button" },
              on: { click: () => act(() => iam2.admin("setMode", { set: next, subject: next })) }
            })
          ]),
          el("p", {
            cls: cls("aim-iam-lead"),
            text: me.mode === "open" ? S("modeMeaningOpen") : S("modeMeaningMembers")
          })
        ]));
      }
      const input = el("input", { attrs: { type: "text", placeholder: S("approvePlaceholder"), "aria-label": S("approveTitle") } });
      const roleSel = el(
        "select",
        { attrs: { "aria-label": S("colRole") } },
        roles.map((r) => el("option", { text: r, attrs: { value: r } }))
      );
      wrap.appendChild(el("section", { cls: cls("aim-iam-sec") }, [
        el("h3", { cls: cls("aim-iam-h"), text: S("approveTitle") }),
        el("div", { cls: cls("aim-iam-form") }, [
          input,
          roles.length ? roleSel : null,
          el("button", {
            cls: cls("aim-iam-btn"),
            text: S("approveBtn"),
            attrs: { type: "button" },
            on: { click: () => {
              const id = (
                /** @type {HTMLInputElement} */
                input.value.trim()
              );
              if (!id) return;
              const role = roles.length ? (
                /** @type {HTMLSelectElement} */
                roleSel.value
              ) : void 0;
              return act(() => iam2.admin("assign", role ? { ghii: id, role, owner: id } : { ghii: id, owner: id }));
            } }
          })
        ]),
        el("p", { cls: cls("aim-iam-lead"), text: S("approveHelp") })
      ]));
      if (opts.payingCustomers) {
        const body = [
          el("h3", { cls: cls("aim-iam-h"), text: S("payingTitle", { n: paying.length }) }),
          el("p", { cls: cls("aim-iam-lead"), text: S("payingLead") })
        ];
        if (!paying.length) body.push(el("p", { cls: cls("aim-iam-empty"), text: S("payingNone") }));
        for (const c of paying) {
          body.push(el("div", { cls: cls("aim-iam-row") }, [
            el("span", { cls: cls("aim-iam-id"), text: c.label || c.id }),
            c.spend ? el("span", { cls: cls("aim-iam-muted"), text: c.spend }) : null
          ]));
        }
        wrap.appendChild(el("section", { cls: cls("aim-iam-sec") }, body));
      }
      const payingIds = new Set(paying.map((p) => String(p.id).toLowerCase().split("@")[0]));
      const pending = collectPending(state2).filter((p) => !payingIds.has(String(p.id).toLowerCase().split("@")[0]));
      const isPassive = !state2 || !state2.requests;
      const qBody = [el("h3", { cls: cls("aim-iam-h"), text: isPassive ? S("seenTitle") : S("pendingTitle") })];
      if (!pending.length) {
        qBody.push(el("p", { cls: cls("aim-iam-empty"), text: isPassive ? S("seenNone") : S("pendingNone") }));
      }
      for (const p of pending) {
        qBody.push(el("div", { cls: cls("aim-iam-row") }, [
          el("span", { cls: cls("aim-iam-id"), text: p.id }),
          p.visits ? el("span", { cls: cls("aim-iam-muted"), text: S("visits", { n: p.visits, d: fmtDate(p.lastSeen) }) }) : null,
          el("button", {
            cls: cls("aim-iam-btn"),
            text: S("approveBtn"),
            attrs: { type: "button" },
            on: { click: () => act(() => iam2.admin("assign", { ghii: p.id, owner: p.id, role: roles[roles.length - 1] || void 0, note: p.note })) }
          }),
          isPassive ? null : el("button", {
            cls: cls("aim-iam-btn"),
            text: S("decline"),
            attrs: { type: "button" },
            on: { click: () => act(() => iam2.admin("decline", { owner: p.id, ghii: p.id })) }
          }),
          p.note ? el("span", { cls: cls("aim-iam-note"), text: p.note }) : null
        ]));
      }
      wrap.appendChild(el("section", { cls: cls("aim-iam-sec") }, qBody));
      const mBody = [el("h3", { cls: cls("aim-iam-h"), text: S("membersTitle") + ": " + roster.members.length })];
      if (!roster.members.length) mBody.push(el("p", { cls: cls("aim-iam-empty"), text: S("membersNone") }));
      for (const m of roster.members) {
        const sel = roles.length ? el(
          "select",
          { attrs: { "aria-label": S("colRole") } },
          roles.map((r) => el("option", { text: r, attrs: Object.assign({ value: r }, r === m.role ? { selected: "selected" } : {}) }))
        ) : null;
        if (sel) sel.addEventListener("change", () => act(() => iam2.admin(
          "assign",
          { ghii: m.id, owner: m.id, role: (
            /** @type {HTMLSelectElement} */
            sel.value
          ) }
        )));
        mBody.push(el("div", { cls: cls("aim-iam-row") }, [
          el("span", { cls: cls("aim-iam-id"), text: m.id }),
          // The select IS the role display when there is one. Showing a badge beside it repeats the
          // same word twice and, at 390px, costs a whole row per member for nothing.
          !sel && m.role ? el("span", { cls: cls("aim-iam-badge"), text: m.role }) : null,
          m.since ? el("span", { cls: cls("aim-iam-muted"), text: fmtDate(m.since) }) : null,
          grantCell(m.id),
          usageCell(m.id),
          sel,
          el("button", {
            cls: cls("aim-iam-btn"),
            text: S("remove"),
            attrs: { type: "button" },
            on: { click: () => act(() => iam2.admin("revoke", { ghii: m.id, owner: m.id })) }
          })
        ]));
      }
      wrap.appendChild(el("section", { cls: cls("aim-iam-sec") }, mBody));
      if (opts.sections && opts.sections.length) {
        const sBody = [el("h3", { cls: cls("aim-iam-h"), text: S("settingsTitle") })];
        for (const s of opts.sections) {
          const ctrl = s.type === "toggle" ? el("button", {
            cls: cls("aim-iam-btn"),
            text: s.value ? "on" : "off",
            attrs: { type: "button" },
            on: { click: () => act(async () => {
              await s.onChange(!s.value);
              s.value = !s.value;
            }) }
          }) : el("input", {
            attrs: { type: "text", value: s.value == null ? "" : String(s.value) },
            on: { change: (e) => s.onChange(
              /** @type {HTMLInputElement} */
              e.target.value
            ) }
          });
          sBody.push(el("div", { cls: cls("aim-iam-row") }, [
            el("span", { cls: cls("aim-iam-id"), text: s.label }),
            ctrl,
            s.help ? el("span", { cls: cls("aim-iam-note"), text: s.help }) : null
          ]));
        }
        wrap.appendChild(el("section", { cls: cls("aim-iam-sec") }, sBody));
      }
      wrap.appendChild(el("section", { cls: cls("aim-iam-sec") }, [
        el("h3", { cls: cls("aim-iam-h"), text: S("strangerTitle") }),
        el("p", {
          cls: cls("aim-iam-lead"),
          text: defaultRole ? S("strangerRole", { role: defaultRole }) : S("strangerDeny")
        })
      ]));
    }
    render();
    return { refresh: render, destroy: () => {
      host.textContent = "";
    } };
  }
  function collectPending(state2) {
    if (!state2) return [];
    if (Array.isArray(state2.requests)) {
      return state2.requests.map((r) => ({ id: r.owner || r.gaii || r.id, note: r.note, lastSeen: r.at }));
    }
    const seen = state2.seen || {};
    return Object.keys(seen).map((id) => ({ id, visits: seen[id].visits, lastSeen: seen[id].lastSeen }));
  }
  function mountJoinPanel(iam2, opts) {
    const host = typeof opts.target === "string" ? document.querySelector(opts.target) : opts.target;
    if (!host) throw new Error("aimeat-iam: JoinPanel target not found");
    injectPanelStyle(opts.styles);
    const lang = pickLang(opts.lang);
    const S = (k, v) => t(lang, k, v, opts.strings);
    const cls = (hook) => hook + (opts.classMap && opts.classMap[hook] ? " " + opts.classMap[hook] : "");
    host.textContent = "";
    const out = el("p", { cls: cls("aim-iam-lead") });
    const note = el("input", { attrs: { type: "text", placeholder: S("joinNote"), "aria-label": S("joinNote") } });
    const btn = el("button", { cls: cls("aim-iam-btn"), text: S("joinBtn"), attrs: { type: "button" } });
    btn.addEventListener("click", async () => {
      try {
        const r = await iam2.request(
          /** @type {HTMLInputElement} */
          note.value.trim()
        );
        out.textContent = r.alreadyMember ? S("joinAlready") : r.passive ? S("joinPassive") : S("joinSent");
      } catch {
        out.textContent = S("failed");
      }
    });
    host.appendChild(el("section", { cls: cls("aim-iam") }, [
      el("h3", { cls: cls("aim-iam-h"), text: S("joinTitle") }),
      el("div", { cls: cls("aim-iam-form") }, [note, btn]),
      out
    ]));
    return { destroy: () => {
      host.textContent = "";
    } };
  }

  // src/static/sdk-libs/iam/node-roster.js
  function base(appId) {
    const [owner, filename] = String(appId).split("/");
    return "/v1/apps/" + encodeURIComponent(owner || "") + "/" + encodeURIComponent(filename || "") + "/members";
  }
  async function un(p) {
    const body = await p;
    return body && body.data !== void 0 ? body.data : body;
  }
  async function nodeMe(call, appId) {
    const d = await un(call(base(appId) + "/me"));
    const m = d && d.member;
    return {
      role: d && d.isOwner ? "owner" : m ? m.role : null,
      level: m && typeof m.level === "number" ? m.level : d && d.isOwner ? 0 : null,
      isOwner: !!(d && d.isOwner),
      member: !!m,
      since: m ? m.since : null,
      // The node roster is the person's row by construction, so a role always resolved through them.
      via: m ? "owner" : "none",
      requested: d ? d.requested : null
    };
  }
  async function nodeState(call, appId, roles) {
    const d = await un(call(base(appId)));
    if (d && d.ok === false) return d;
    const members = d && d.members || [];
    const seen = new Set(roles || []);
    for (const m of members) if (m.role) seen.add(m.role);
    const roleMap = {};
    for (const r of seen) roleMap[r] = [];
    return {
      ok: true,
      isOwner: true,
      roles: roleMap,
      levels: {},
      commands: [],
      config: {},
      assignments: Object.fromEntries(members.map((m) => [m.owner, m.role])),
      requests: d && d.requests || [],
      members
    };
  }
  function nodeAssign(call, appId, args) {
    const body = {
      account: args.ghii || args.owner || args.account,
      role: args.role
    };
    if (args.note) body.note = args.note;
    if (Array.isArray(args.offerings)) body.offerings = args.offerings;
    return un(call(base(appId), { method: "POST", body: JSON.stringify(body) }));
  }
  function nodeRevoke(call, appId, args) {
    const who = args.ghii || args.owner || args.account;
    return un(call(base(appId) + "/" + encodeURIComponent(String(who)), { method: "DELETE" }));
  }
  function nodeDecline(call, appId, args) {
    const who = args.ghii || args.owner || args.account;
    return un(call(base(appId) + "/requests/" + encodeURIComponent(String(who)), { method: "DELETE" }));
  }
  async function nodeRequest(call, appId, note) {
    const r = await un(call(base(appId) + "/requests", {
      method: "POST",
      body: JSON.stringify(note ? { note } : {})
    }));
    return { recorded: r && r.recorded !== false, passive: false, alreadyMember: !!(r && r.alreadyMember) };
  }

  // src/static/sdk-libs/iam/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-iam.js");
  var state = {
    ext: null,
    app: (
      /** @type {string|null} */
      null
    ),
    roleNames: (
      /** @type {string[]} */
      []
    ),
    dialect: (
      /** @type {Dialect} */
      "op"
    ),
    // Which dialect the CAPABILITY gate speaks, when the roster is the node's and the vocabulary an
    // extension's. Null means there is no extension to ask, not that the app is ungated.
    gateDialect: (
      /** @type {Dialect|null} */
      null
    ),
    hasRequest: false,
    me: null,
    roles: {}
  };
  function normalise(raw, roles, dialect) {
    const r = raw || {};
    if (dialect === "command") {
      return {
        member: !!(r.member || r.isOwner),
        isOwner: !!r.isOwner,
        role: r.role || null,
        level: typeof r.level === "number" ? r.level : null,
        caps: Array.isArray(r.may) ? r.may : [],
        mode: r.mode || null,
        via: null,
        subject: null,
        since: r.since || null
      };
    }
    if (dialect === "level") {
      return {
        member: typeof r.level === "number",
        isOwner: !!r.isOwner,
        role: r.role || r.key || null,
        level: typeof r.level === "number" ? r.level : null,
        caps: [],
        mode: null,
        via: null,
        subject: null,
        since: r.since || null
      };
    }
    const role = r.role || null;
    return {
      member: !!role && role !== (r.defaultRole || null),
      isOwner: !!r.isOwner,
      role,
      level: typeof r.level === "number" ? r.level : null,
      caps: role && roles[role] || [],
      mode: r.mode || null,
      via: r.via || null,
      subject: r.subject || null,
      since: r.since || null
    };
  }
  var iam = {
    /**
     * Learn how this app's gate is shaped, then read the caller's standing. One detection round-trip,
     * after which nothing guesses. Pass `dialect` to skip detection entirely.
     * @param {Object} opts
     * @param {string} [opts.app]   `owner/file.html` — use the NODE's roster (preferred for anything new).
     * @param {string} [opts.ext]   An installed IAM extension, when the gate lives there.
     * @param {string[]} [opts.roles] The app's role vocabulary. The node deliberately does not own it.
     * @param {'node'|'op'|'command'|'level'} [opts.dialect] Skip detection.
     * @returns {Promise<IamMe>}
     */
    async init(opts) {
      if (!opts || !opts.ext && !opts.app) {
        throw new Error("aimeat-iam: init needs { app } for the node roster, or { ext } for an extension gate");
      }
      state.ext = opts.ext || null;
      state.app = opts.app || null;
      state.roleNames = Array.isArray(opts.roles) ? opts.roles : [];
      if (state.app) {
        state.dialect = /** @type {Dialect} */
        "node";
        state.hasRequest = true;
        state.gateDialect = null;
        if (state.ext) {
          try {
            const d = await detectDialect(resolveNodeUrl(), state.ext);
            state.gateDialect = d.dialect;
          } catch {
            state.gateDialect = null;
          }
        }
        return iam.refresh();
      }
      if (opts.dialect) {
        state.dialect = opts.dialect;
        state.hasRequest = opts.dialect === "command";
      } else {
        const d = await detectDialect(resolveNodeUrl(), opts.ext);
        state.dialect = d.dialect;
        state.hasRequest = d.hasRequest;
      }
      return iam.refresh();
    },
    /**
     * Re-read the caller's standing from the server. Call this after anything that could change it,
     * and on the `aimeat-live-update` event if the host page listens for one.
     * @returns {Promise<IamMe>}
     */
    async refresh() {
      requireInit();
      if (state.dialect === "node") {
        const raw2 = await nodeMe(
          authFetch2,
          /** @type {string} */
          state.app
        );
        state.me = {
          member: raw2.member,
          isOwner: raw2.isOwner,
          role: raw2.role,
          level: raw2.level,
          caps: raw2.isOwner ? ["*"] : state.roles[raw2.role] || [],
          mode: null,
          via: raw2.via,
          subject: "owner",
          since: raw2.since
        };
        return state.me;
      }
      let adminState = null;
      if (state.dialect !== "command") {
        adminState = await callAdmin(authFetch2, state.ext, state.dialect, "state").catch(() => null);
        if (adminState && adminState.roles) state.roles = adminState.roles;
      }
      const probe = state.dialect === "op" ? { permission: "\0probe" } : {};
      const raw = await callCheck(authFetch2, state.ext, state.dialect, probe);
      state.me = normalise(raw, state.roles, state.dialect);
      if (adminState && typeof adminState.isOwner === "boolean") state.me.isOwner = adminState.isOwner;
      return state.me;
    },
    /**
     * The caller's standing as last read. Null until init() has run.
     * @returns {IamMe|null}
     */
    me() {
      return state.me;
    },
    /** The dialect in use, for an app that wants to explain itself. @returns {string} */
    dialect() {
      return state.dialect;
    },
    /**
     * Ask the gate directly. This is the call an app should mirror server-side before it mutates
     * anything; the answer carries the mutation tier when a command id is passed, so an agent knows
     * when to seek human confirmation.
     * @param {{ permission?: string, command?: string }} input
     * @returns {Promise<{ allowed: boolean, role?: string, tier?: string, needsConfirmation?: boolean, via?: string }>}
     */
    async check(input) {
      requireInit();
      if (state.dialect === "node") {
        if (!state.gateDialect) {
          const me = state.me || await iam.refresh();
          const cap = input && (input.permission || input.command) || "";
          return { allowed: me.caps.indexOf("*") !== -1 || me.caps.indexOf(cap) !== -1, role: me.role || void 0 };
        }
        return callCheck(
          authFetch2,
          /** @type {string} */
          state.ext,
          state.gateDialect,
          input || {}
        );
      }
      if (state.dialect === "command") {
        const raw = await callCheck(authFetch2, state.ext, state.dialect, {});
        const me = normalise(raw, state.roles, state.dialect);
        const cap = input && (input.permission || input.command) || "";
        const allowed = me.caps.indexOf("*") !== -1 || me.caps.indexOf(cap) !== -1;
        return { allowed, role: me.role || void 0 };
      }
      return callCheck(authFetch2, state.ext, state.dialect, input || {});
    },
    /**
     * Ask the owner for access. Where the extension has no request action the visit itself is the
     * application, and the answer says so (`passive: true`) instead of reporting a send that did not
     * happen.
     * @param {string} [note]  Who you are and what you need it for.
     * @returns {Promise<{ recorded: boolean, passive: boolean }>}
     */
    request(note) {
      requireInit();
      if (state.dialect === "node") return nodeRequest(
        authFetch2,
        /** @type {string} */
        state.app,
        note
      );
      return callRequest(authFetch2, state.ext, state.dialect, state.hasRequest, note);
    },
    /**
     * The member roster, owner-only. Normalised to one row shape across the dialects that keep a map
     * (`op`) and the one that keeps a list (`command`).
     * @returns {Promise<{ ok: boolean, members: Array<{ id: string, role: string|null, level: number|null, since: string|null, grants: string[] }>, error?: string }>}
     */
    async roster() {
      requireInit();
      if (state.dialect === "node") {
        const st2 = await nodeState(
          authFetch2,
          /** @type {string} */
          state.app,
          state.roleNames
        );
        if (st2 && st2.ok === false) return { ok: false, members: [], error: st2.error };
        return {
          ok: true,
          members: (st2.members || []).map((m) => ({
            id: m.owner,
            role: m.role || null,
            level: typeof m.level === "number" ? m.level : null,
            since: m.since || null,
            grants: m.offerings || []
          }))
        };
      }
      const st = await callAdmin(authFetch2, state.ext, state.dialect, "state");
      if (st && st.ok === false) return { ok: false, members: [], error: st.error };
      if (state.dialect === "command") {
        const rows = st && st.members || [];
        return {
          ok: true,
          members: rows.map((m) => ({
            id: m.owner,
            role: m.role || null,
            level: typeof m.level === "number" ? m.level : null,
            since: m.since || null,
            grants: m.grants || []
          }))
        };
      }
      const map = st && st.assignments || {};
      const levels = st && st.levels || {};
      return {
        ok: true,
        members: Object.keys(map).map((id) => ({
          id,
          role: map[id],
          level: typeof levels[map[id]] === "number" ? levels[map[id]] : null,
          since: null,
          grants: []
        }))
      };
    },
    /**
     * Drive the admin surface in this app's own dialect. `op` is a logical name (state | assign |
     * revoke) that the adapter translates, so a caller never learns which key its fork multiplexes on.
     * @param {string} op
     * @param {Record<string, unknown>} [args]
     * @returns {Promise<any>}
     */
    admin(op, args) {
      requireInit();
      if (state.dialect === "node") {
        const app = (
          /** @type {string} */
          state.app
        );
        if (op === "state") return nodeState(authFetch2, app, state.roleNames);
        if (op === "assign") return nodeAssign(authFetch2, app, args || {});
        if (op === "revoke") return nodeRevoke(authFetch2, app, args || {});
        if (op === "decline") return nodeDecline(authFetch2, app, args || {});
        return Promise.resolve({ ok: false, error: `"${op}" is not a node-roster operation; the capability vocabulary lives in the app's extension` });
      }
      return callAdmin(authFetch2, state.ext, state.dialect, op, args);
    },
    /**
     * An authed GET against the node, for the panel's free-access column. It reads
     * /v1/exchange/grants?app_id=, which is a NODE surface rather than the extension's, so it works
     * for any app that issues zero-priced grants on approval without that app writing the lookup.
     * @param {string} path
     * @returns {Promise<any>}
     */
    async adminFetch(path) {
      const body = await authFetch2(path);
      return body && body.data !== void 0 ? body.data : body;
    },
    /**
     * The owner's panel: the union of the six that already exist on this node. See panel.js for what
     * each section is and which app it came from.
     * @param {import('./panel.js').PanelOpts} opts
     */
    MemberAdmin(opts) {
      requireInit();
      return mountMemberAdmin(iam, opts);
    },
    /**
     * The applicant's side.
     * @param {{ target: string|Element, lang?: string, strings?: Record<string,string>, classMap?: Record<string,string>, styles?: boolean }} opts
     */
    JoinPanel(opts) {
      requireInit();
      return mountJoinPanel(iam, opts);
    }
  };
  function requireInit() {
    if (!state.ext && !state.app) throw new Error("aimeat-iam: call AIMEAT.iam.init({ app }) or init({ ext }) first");
  }
  var gateApi = makeGate({ me: () => state.me }, (input) => iam.check(input));
  iam.can = gateApi.can;
  iam.gate = gateApi.gate;
  iam.guard = gateApi.guard;
  attach("iam", iam);
})();
