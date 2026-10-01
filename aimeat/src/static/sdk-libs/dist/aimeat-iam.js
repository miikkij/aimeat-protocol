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
    if (typeof self !== "undefined" && typeof self.origin === "string" && self.origin.indexOf("http") === 0) {
      return self.origin;
    }
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
  function callVocabulary(call, ext) {
    return unwrap(call("/v1/ext/" + ext + "/roles", { method: "POST", body: "{}" }));
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
      approveHelpNode: "A role belongs to the person, so their agents have the same role.",
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
      dismiss: "Seen it",
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
      strangerNode: "Anyone who is signed in can open this app. The app hides the parts it marks for members, and only the extension of the app can refuse a change a stranger tries to make.",
      settingsTitle: "Settings",
      joinTitle: "Ask for access",
      joinNote: "Who you are and what you need it for",
      joinBtn: "Send request",
      joinSent: "Your request was recorded. The owner decides.",
      joinPassive: "Your visit has been recorded. The owner sees you in their list and can approve you.",
      joinAlready: "You already have access.",
      joinPending: "You asked on {d}. The owner has not decided yet.",
      joinDeclined: "The owner declined your earlier request. You can ask again.",
      notOwner: "Only the owner manages members.",
      failed: "That did not go through.",
      failedWith: "That did not go through: {why}",
      on: "On",
      off: "Off",
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
      approvePlaceholder: "tilinimi",
      approveBtn: "Hyväksy",
      approveHelp: "Rooli kuuluu ihmiselle, joten hänen agenttinsa perivät sen. Lisää rivi muodossa agent#owner@node vain, jos haluat antaa juuri sille agentille jotain muuta.",
      approveHelpNode: "Rooli kuuluu ihmiselle, joten myös hänen agenteillaan on sama rooli.",
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
      dismiss: "Kuitattu",
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
      strangerNode: "Kuka tahansa kirjautunut voi avata tämän sovelluksen. Sovellus piilottaa jäsenille merkityt osat, ja vain sovelluksen laajennus voi estää muutoksen, jota vieras yrittää tehdä.",
      settingsTitle: "Asetukset",
      joinTitle: "Pyydä pääsyä",
      joinNote: "Kuka olet ja mihin tarvitset tätä",
      joinBtn: "Lähetä pyyntö",
      joinSent: "Pyyntösi on kirjattu. Omistaja päättää.",
      joinPassive: "Käyntisi on kirjattu. Omistaja näkee sinut listallaan ja voi hyväksyä sinut.",
      joinAlready: "Sinulla on jo pääsy.",
      joinPending: "Pyysit pääsyä {d}. Omistaja ei ole vielä päättänyt.",
      joinDeclined: "Omistaja hylkäsi aiemman pyyntösi. Voit pyytää uudelleen.",
      notOwner: "Vain omistaja hallinnoi jäseniä.",
      failed: "Se ei mennyt läpi.",
      failedWith: "Se ei mennyt läpi: {why}",
      on: "Päällä",
      off: "Pois",
      loading: "Ladataan…"
    },
    es: {
      whoTitle: "Quién puede usar esto",
      modeLabel: "Modo",
      modeOpen: "abierto",
      modeMembers: "solo miembros",
      modeInvite: "solo con invitación",
      modeSwitch: "Cambiar",
      modeMeaningOpen: "Cualquier persona con sesión iniciada puede usarla. Aprobar a alguien cambia lo que paga.",
      modeMeaningMembers: "Solo los miembros aprobados pueden usarla. A los demás se les rechaza y se les explica cómo pedir acceso.",
      approveTitle: "Aprobar a alguien",
      approvePlaceholder: "nombre de cuenta",
      approveBtn: "Aprobar",
      approveHelp: "El rol pertenece a la persona, así que sus agentes lo heredan. Agrega una fila para agent#owner@node solo si quieres darle a ese agente algo distinto.",
      approveHelpNode: "El rol pertenece a la persona, así que sus agentes tienen el mismo rol.",
      pendingTitle: "Pidieron acceso",
      pendingNone: "Nadie está esperando.",
      seenTitle: "Entraron, sin rol",
      seenNone: "Todavía no ha entrado nadie.",
      visits: "{n} visitas, la última el {d}",
      membersTitle: "Aprobados",
      membersNone: "Todavía no hay nadie aprobado.",
      colAccount: "Cuenta",
      colRole: "Rol",
      colSince: "Miembro desde",
      colGrants: "Acceso gratuito",
      remove: "Quitar",
      decline: "Rechazar",
      dismiss: "Visto",
      carried: "{n} de {of} cubiertos",
      carriedNone: "ninguno cubierto",
      usage: "{n} llamadas, {cost} cubiertos",
      carriedWarn: "{n} sin cubrir",
      payingTitle: "Clientes que pagan: {n}",
      payingLead: "Contrataron y entraron por su cuenta. Aquí no hay nada pendiente para ti.",
      payingNone: "Todavía no hay clientes que paguen.",
      strangerTitle: "Qué recibe una persona desconocida",
      strangerRole: 'Quien inicia sesión y no está en la lista recibe el rol "{role}".',
      strangerDeny: "Quien no está en la lista no puede usar esto.",
      strangerNode: "Cualquier persona con sesión iniciada puede abrir esta aplicación. La aplicación oculta las partes que marca para miembros, y solo la extensión de la aplicación puede rechazar un cambio que intente hacer una persona desconocida.",
      settingsTitle: "Configuración",
      joinTitle: "Pedir acceso",
      joinNote: "Quién eres y para qué lo necesitas",
      joinBtn: "Enviar solicitud",
      joinSent: "Tu solicitud quedó registrada. El propietario decide.",
      joinPassive: "Tu visita quedó registrada. El propietario te ve en su lista y puede aprobarte.",
      joinAlready: "Ya tienes acceso.",
      joinPending: "Pediste acceso el {d}. El propietario todavía no ha decidido.",
      joinDeclined: "El propietario rechazó tu solicitud anterior. Puedes pedirlo de nuevo.",
      notOwner: "Solo el propietario administra a los miembros.",
      failed: "No se pudo completar.",
      failedWith: "No se pudo completar: {why}",
      on: "Activado",
      off: "Desactivado",
      loading: "Cargando…"
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
    let failure = "";
    async function act(fn) {
      failure = "";
      try {
        const r = await fn();
        if (r && r.ok === false) failure = refusalText(r) || S("failed");
      } catch (e) {
        failure = e && e.message || S("failed");
      }
      await render();
    }
    async function render() {
      host.textContent = "";
      const me = iam2.me();
      const wrap = el("div", { cls: cls("aim-iam") });
      host.appendChild(wrap);
      if (failure) {
        wrap.appendChild(el("p", { cls: cls("aim-iam-warn"), text: S("failedWith", { why: failure }), attrs: { role: "alert" } }));
      }
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
      const nodeRoster = !!(state2 && state2.nodeRoster);
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
        el("p", { cls: cls("aim-iam-lead"), text: S(nodeRoster ? "approveHelpNode" : "approveHelp") })
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
      const approveRole = opts.approveRole && roles.indexOf(opts.approveRole) !== -1 ? opts.approveRole : leastPower(roles, state2 && state2.roles || {}, defaultRole);
      const approveSel = () => {
        if (roles.length < 2) return null;
        const s = el(
          "select",
          { attrs: { "aria-label": S("colRole") } },
          roles.map((r) => el("option", { text: r, attrs: Object.assign({ value: r }, r === approveRole ? { selected: "selected" } : {}) }))
        );
        s.value = approveRole || "";
        return s;
      };
      const roleOf = (s) => (s ? (
        /** @type {HTMLSelectElement} */
        s.value
      ) : approveRole) || void 0;
      if (!isPassive) {
        const qBody = [el("h3", { cls: cls("aim-iam-h"), text: S("pendingTitle") })];
        if (!pending.length) qBody.push(el("p", { cls: cls("aim-iam-empty"), text: S("pendingNone") }));
        for (const p of pending) {
          const sel = approveSel();
          qBody.push(el("div", { cls: cls("aim-iam-row") }, [
            el("span", { cls: cls("aim-iam-id"), text: p.id }),
            sel,
            el("button", {
              cls: cls("aim-iam-btn"),
              text: S("approveBtn"),
              attrs: { type: "button" },
              on: { click: () => act(() => iam2.admin("assign", { ghii: p.id, owner: p.id, role: roleOf(sel), note: p.note })) }
            }),
            el("button", {
              cls: cls("aim-iam-btn"),
              text: S("decline"),
              attrs: { type: "button" },
              on: { click: () => act(() => iam2.admin("decline", { owner: p.id, ghii: p.id })) }
            }),
            p.note ? el("span", { cls: cls("aim-iam-note"), text: p.note }) : null
          ]));
        }
        wrap.appendChild(el("section", { cls: cls("aim-iam-sec") }, qBody));
      }
      const guests = collectSeen(state2).filter((g) => !payingIds.has(String(g.id).toLowerCase().split("@")[0]));
      const gBody = [el("h3", { cls: cls("aim-iam-h"), text: S("seenTitle") })];
      if (!guests.length) gBody.push(el("p", { cls: cls("aim-iam-empty"), text: S("seenNone") }));
      for (const g of guests) {
        const sel = approveSel();
        gBody.push(el("div", { cls: cls("aim-iam-row") }, [
          el("span", { cls: cls("aim-iam-id"), text: g.id }),
          g.visits ? el("span", { cls: cls("aim-iam-muted"), text: S("visits", { n: g.visits, d: fmtDate(g.lastSeen) }) }) : null,
          sel,
          el("button", {
            cls: cls("aim-iam-btn"),
            text: S("approveBtn"),
            attrs: { type: "button" },
            on: { click: () => act(() => iam2.admin("assign", { ghii: g.id, owner: g.id, role: roleOf(sel) })) }
          }),
          // Dismissing is not a block and does not refuse anybody: it says "I have looked at this one",
          // and they are recorded again the next time they come.
          el("button", {
            cls: cls("aim-iam-btn"),
            text: S("dismiss"),
            attrs: { type: "button" },
            on: { click: () => act(() => iam2.dismissGuest(g.id)) }
          })
        ]));
      }
      wrap.appendChild(el("section", { cls: cls("aim-iam-sec") }, gBody));
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
            text: s.value ? S("on") : S("off"),
            attrs: { type: "button", "aria-pressed": s.value ? "true" : "false" },
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
          text: nodeRoster ? S("strangerNode") : defaultRole ? S("strangerRole", { role: defaultRole }) : S("strangerDeny")
        })
      ]));
    }
    render();
    return { refresh: render, destroy: () => {
      host.textContent = "";
    } };
  }
  function leastPower(roles, caps, defaultRole) {
    const pool = roles.filter((r) => r !== defaultRole);
    const list = pool.length ? pool : roles;
    const power = (r) => {
      const c = caps[r] || [];
      return c.indexOf("*") !== -1 ? Infinity : c.length;
    };
    let best;
    for (const r of list) if (best === void 0 || power(r) < power(best)) best = r;
    return best;
  }
  function refusalText(r) {
    if (!r || !r.error) return "";
    if (typeof r.error === "string") return r.error;
    return typeof r.error.message === "string" ? r.error.message : "";
  }
  function collectPending(state2) {
    if (!state2 || !Array.isArray(state2.requests)) return [];
    return state2.requests.map((r) => ({ id: r.owner || r.gaii || r.id, note: r.note, lastSeen: r.at }));
  }
  function collectSeen(state2) {
    const seen = state2 && state2.seen || {};
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
    const asked = iam2.me() && iam2.me().requested;
    if (asked && asked.state === "pending") out.textContent = S("joinPending", { d: fmtDate(asked.at) });
    else if (asked && asked.state === "declined") out.textContent = S("joinDeclined");
    const note = el("input", { attrs: { type: "text", placeholder: S("joinNote"), "aria-label": S("joinNote") } });
    const btn = el("button", { cls: cls("aim-iam-btn"), text: S("joinBtn"), attrs: { type: "button" } });
    btn.addEventListener("click", async () => {
      try {
        const r = await iam2.request(
          /** @type {HTMLInputElement} */
          note.value.trim()
        );
        out.textContent = r.alreadyMember ? S("joinAlready") : r.passive ? S("joinPassive") : S("joinSent");
      } catch (e) {
        out.textContent = e && e.message ? S("failedWith", { why: e.message }) : S("failed");
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
      requested: d ? d.requested : null,
      // A member whose role the plan lists in manageRoles manages members too (not the plan).
      canManage: !!(d && (d.isOwner || d.canManage)),
      displayName: d && d.displayName ? d.displayName : null
    };
  }
  async function nodeState(call, appId, roles, caps) {
    const d = await un(call(base(appId)));
    if (d && d.ok === false) return d;
    const members = d && d.members || [];
    const seen = new Set(roles || []);
    for (const m of members) if (m.role) seen.add(m.role);
    const roleMap = {};
    for (const r of seen) roleMap[r] = caps && caps[r] || [r];
    return {
      ok: true,
      isOwner: true,
      // The panel words its "what a stranger gets" line from this: on the node roster nothing on the
      // server refuses a stranger who opens the app, and saying "refused" there was false.
      nodeRoster: true,
      roles: roleMap,
      levels: {},
      commands: [],
      config: {},
      assignments: Object.fromEntries(members.map((m) => [m.owner, m.role])),
      requests: d && d.requests || [],
      // Everybody who turned up and holds no role. The panel has had a section for these since it was
      // written and the node had nothing to put in it, so it rendered "nobody has turned up yet" on
      // apps people were visiting daily.
      seen: Object.fromEntries((d && d.seen || []).map((v) => [v.owner, { visits: v.visits, lastSeen: v.lastSeen }])),
      members,
      invites: d && d.invites || [],
      total: d && d.total || null,
      canManage: !!(d && d.canManage !== false)
    };
  }
  function nodeAssign(call, appId, args) {
    const body = { role: args.role };
    if (args.email) body.email = args.email;
    else body.account = args.ghii || args.owner || args.account;
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
    if (r && r.ok === false) {
      throw new Error(r.error && typeof r.error.message === "string" && r.error.message || "The request was refused.");
    }
    return { recorded: !!r && r.recorded !== false, passive: false, alreadyMember: !!(r && r.alreadyMember) };
  }
  function nodeDismissGuest(call, appId, who) {
    return un(call(base(appId) + "/seen/" + encodeURIComponent(String(who)), { method: "DELETE" }));
  }
  async function nodeInvites(call, appId) {
    const d = await un(call(base(appId)));
    if (d && d.ok === false) return d;
    return d && d.invites || [];
  }
  function nodeCancelInvite(call, appId, id) {
    return un(call(base(appId) + "/invites/" + encodeURIComponent(String(id)), { method: "DELETE" }));
  }
  async function nodeAudit(call, appId, opts) {
    const o = opts || {};
    const q = [];
    if (o.limit) q.push("limit=" + encodeURIComponent(String(o.limit)));
    if (o.before) q.push("before=" + encodeURIComponent(String(o.before)));
    const d = await un(call(base(appId) + "/audit" + (q.length ? "?" + q.join("&") : "")));
    if (d && d.ok === false) return d;
    return d && d.events || [];
  }
  async function nodePeople(call, q) {
    const d = await un(call("/v1/contacts" + (q ? "?q=" + encodeURIComponent(q) : "")));
    if (d && d.ok === false) return d;
    const rows = d && d.contacts || [];
    const people = rows.filter(function(r) {
      return r && (r.kind === "owner" || r.kind === "person" || r.kind === "ghii");
    }).map(function(r) {
      const id = String(r.contact_id || "");
      const account = id.indexOf("@") > 0 && id.indexOf("#") === -1 ? id.slice(0, id.lastIndexOf("@")) : null;
      return { account, displayName: r.display_name || r.saved_name || null, email: r.email || null };
    });
    people.sort(function(a, b) {
      return (a.account ? 0 : 1) - (b.account ? 0 : 1);
    });
    return people;
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
  function readVocabulary(roles) {
    if (Array.isArray(roles)) {
      const names = roles.filter((r) => typeof r === "string" && r);
      return { names, caps: Object.fromEntries(names.map((r) => [r, [r]])) };
    }
    if (roles && typeof roles === "object") {
      const caps = {};
      for (const [name, list] of Object.entries(roles)) {
        if (!name) continue;
        caps[name] = Array.isArray(list) ? list.filter((c) => typeof c === "string") : [];
      }
      return { names: Object.keys(caps), caps };
    }
    return { names: [], caps: {} };
  }
  var iam = {
    /**
     * Learn how this app's gate is shaped, then read the caller's standing. One detection round-trip,
     * after which nothing guesses. Pass `dialect` to skip detection entirely.
     * @param {Object} opts
     * @param {string} [opts.app]   `owner/file.html` — use the NODE's roster (preferred for anything new).
     * @param {string} [opts.ext]   An installed IAM extension, when the gate lives there.
     * @param {string[]|Record<string, string[]>} [opts.roles] The app's role vocabulary, which the node
     *   deliberately does not own: a map of role to capabilities, or a list of role names, least power first.
     * @param {'node'|'op'|'command'|'level'} [opts.dialect] Skip detection.
     * @returns {Promise<IamMe>}
     */
    async init(opts) {
      if (!opts || !opts.ext && !opts.app) {
        throw new Error("aimeat-iam: init needs { app } for the node roster, or { ext } for an extension gate");
      }
      state.ext = opts.ext || null;
      state.app = opts.app || null;
      const vocab = readVocabulary(opts.roles);
      state.roleNames = vocab.names;
      state.roles = vocab.caps;
      state.me = null;
      if (state.app) {
        state.dialect = /** @type {Dialect} */
        "node";
        state.hasRequest = true;
        state.gateDialect = null;
        if (state.ext) {
          try {
            const d = await detectDialect(resolveNodeUrl(), state.ext);
            state.gateDialect = d.dialect;
            if (!state.roleNames.length && d.actions.indexOf("roles") !== -1) {
              const vocab2 = await callVocabulary(authFetch2, state.ext).catch(() => null);
              if (vocab2 && vocab2.roles) {
                state.roles = vocab2.roles;
                state.roleNames = Array.isArray(vocab2.assignable) && vocab2.assignable.length ? vocab2.assignable : Object.keys(vocab2.roles);
              }
            }
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
        const own = raw2.role ? state.roles[raw2.role] || [raw2.role] : [];
        state.me = {
          member: raw2.member,
          isOwner: raw2.isOwner,
          role: raw2.role,
          level: raw2.level,
          caps: raw2.isOwner ? ["*"] : raw2.member ? own : [],
          mode: null,
          via: raw2.via,
          subject: "owner",
          since: raw2.since,
          // The caller's own ask, so the join form can say "you asked on …" instead of offering the
          // same form again to somebody who is already waiting.
          requested: raw2.requested || null,
          canManage: !!raw2.canManage,
          displayName: raw2.displayName || null
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
          const me = await iam.refresh();
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
          state.roleNames,
          state.roles
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
        if (op === "state") return nodeState(authFetch2, app, state.roleNames, state.roles);
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
     * Take somebody off the list of people who turned up. Owner only, and only where the node keeps
     * the roster — a gate that records visits in its own memory has no such list to clear.
     * @param {string} who
     * @returns {Promise<any>}
     */
    dismissGuest(who) {
      requireInit();
      if (!state.app) {
        return Promise.resolve({ ok: false, error: "the guest list belongs to the node roster; init with { app }" });
      }
      return nodeDismissGuest(
        authFetch2,
        /** @type {string} */
        state.app,
        who
      );
    },
    /**
     * Invite somebody by email: the node approves the account that holds the address, or keeps an
     * invitation and emails it when nobody does yet. Node roster only.
     * @param {string} email
     * @param {string} role
     * @param {string} [note]
     */
    invite(email, role, note) {
      requireInit();
      if (!state.app) return Promise.resolve({ ok: false, error: "invitations belong to the node roster; init with { app }" });
      return nodeAssign(
        authFetch2,
        /** @type {string} */
        state.app,
        { email, role, note }
      );
    },
    /** The open invitations. Node roster only. @returns {Promise<any>} */
    invites() {
      requireInit();
      if (!state.app) return Promise.resolve([]);
      return nodeInvites(
        authFetch2,
        /** @type {string} */
        state.app
      );
    },
    /** Cancel an open invitation. @param {string} id */
    cancelInvite(id) {
      requireInit();
      if (!state.app) return Promise.resolve({ ok: false, error: "invitations belong to the node roster; init with { app }" });
      return nodeCancelInvite(
        authFetch2,
        /** @type {string} */
        state.app,
        id
      );
    },
    /**
     * The roster's history, newest first. Owner and managers. Node roster only.
     * @param {{ limit?: number, before?: string }} [opts]
     */
    audit(opts) {
      requireInit();
      if (!state.app) return Promise.resolve([]);
      return nodeAudit(
        authFetch2,
        /** @type {string} */
        state.app,
        opts
      );
    },
    /**
     * What membership of the app means: access, seats, terms, who reads the roster, which roles
     * manage members. Owner only. Node roster only.
     * @returns {Promise<any>}
     */
    async plan() {
      requireInit();
      if (!state.app) return null;
      const [o, f] = String(state.app).split("/");
      const body = await authFetch2("/v1/apps/" + encodeURIComponent(o || "") + "/" + encodeURIComponent(f || "") + "/members/plan");
      if (body && body.ok === false) return body;
      return body && body.data ? body.data.plan : null;
    },
    /**
     * Declare what membership of the app means. Replaces the whole plan. Owner only.
     * @param {{ roles: Record<string, string[]>, access?: string, rosterVisibility?: string,
     *   seats?: Record<string, number>, terms?: Record<string, { days?: number, renewal?: string }>,
     *   manageRoles?: string[] }} plan
     */
    async setPlan(plan) {
      requireInit();
      if (!state.app) return { ok: false, error: "the plan belongs to the node roster; init with { app }" };
      const [o, f] = String(state.app).split("/");
      const body = await authFetch2(
        "/v1/apps/" + encodeURIComponent(o || "") + "/" + encodeURIComponent(f || "") + "/members/plan",
        { method: "PUT", body: JSON.stringify(plan) }
      );
      return body && body.data !== void 0 ? body.data : body;
    },
    /**
     * The people the owner knows, from their address book, with an account first. The app's token
     * needs the scope word contacts:read (declare it in the page's aimeat-scopes).
     * @param {string} [q]
     */
    people(q) {
      return nodePeople(authFetch2, q);
    },
    /**
     * The role one click on Approve should grant, from the state admin('state') answered: `preferred`
     * when it is one of the roles, else the role with the least power, leaving out the role a stranger
     * already gets. The owner panel and the Atelier kit's members block both ask this, so the two
     * surfaces cannot grant different roles for the same click.
     * @param {any} st  What admin('state') answered.
     * @param {string} [preferred]
     * @returns {string|undefined}
     */
    suggestRole(st, preferred) {
      const roles = st && st.roles ? Object.keys(st.roles) : [];
      if (preferred && roles.indexOf(preferred) !== -1) return preferred;
      const defaultRole = st && st.config && st.config.defaultRole || null;
      return leastPower(roles, st && st.roles || {}, defaultRole);
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
  var authLib = (
    /** @type {any} */
    (typeof window !== "undefined" ? window : {}).AIMEAT?.auth
  );
  if (authLib && typeof authLib.on === "function") {
    const forget = function() {
      state.me = null;
      if (state.app || state.ext) {
        iam.refresh().catch(function(e) {
          console.debug("aimeat-iam: standing not read after a sign-in change", e);
        });
      }
    };
    authLib.on("login", forget);
    authLib.on("logout", forget);
  }
})();
