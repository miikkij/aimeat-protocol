// GENERATED FILE — do not edit directly. Source: src/static/sdk-libs/webhook/ (+ _core/).
// Rebuild: pnpm build:sdk  ·  Served at /v1/libs/aimeat-webhook.js (with a per-node config prelude).
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

  // src/static/sdk-libs/_core/lang.js
  var LANG_KEY = "aimeat-lang";
  function storedLang() {
    try {
      return localStorage.getItem(LANG_KEY) || null;
    } catch {
      return null;
    }
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

  // src/static/sdk-libs/living/i18n.js
  function pickLang(map, wanted) {
    const keys = Object.keys(map || {});
    if (!keys.length) return null;
    for (const want of wanted || []) {
      if (!want) continue;
      const w = String(want).toLowerCase();
      const base = w.split("-")[0];
      for (const k of keys) if (k.toLowerCase() === w) return { lang: k, text: map[k] };
      for (const k of keys) if (k.toLowerCase() === base) return { lang: k, text: map[k] };
      for (const k of keys) if (k.toLowerCase().split("-")[0] === base) return { lang: k, text: map[k] };
    }
    return { lang: keys[0], text: map[keys[0]] };
  }

  // src/static/sdk-libs/living/hooks-words.js
  var WORDS = {
    fi: {
      "gear.in": "Tämä arvo voi tulla ulkoa",
      "gear.out": "Kun tämä muuttuu, kerro jollekin",
      "inward.title": "Tämä arvo voi tulla ulkoa",
      "inward.lead": "Arvon voi asettaa käsin, lukea osoitteesta tai kirjoittaa muistiin. Sinä valitset kumpaa tietä.",
      "inward.road": "Mistä arvo tulee",
      "inward.road.hand": "Käsin, tältä sivulta",
      "inward.road.url": "Osoitteesta",
      "inward.road.key": "Muistiavaimesta",
      "inward.url": "Osoite",
      "inward.path": "Polku vastauksen sisällä",
      "inward.every": "Kuinka usein, sekuntia",
      "inward.key": "Muistiavain",
      "inward.expected": "Näin vastauksen pitää näyttää",
      "inward.testRead": "Kokeile lukemista",
      "inward.write": "Kirjoita arvo muistiin",
      "inward.agent": "Sano tämä omalle tekoälyllesi",
      "inward.range": "Sallittu väli",
      "outward.title": "Kun tämä muuttuu, kerro jollekin",
      "outward.lead": "Jokaisesta siirtymästä lähtee yksi viesti, joka kantaa koko asiakirjan tilan.",
      "outward.kind": "Kenelle kerrotaan",
      "outward.kind.url": "Osoitteeseen",
      "outward.kind.agent": "Omalle agentille",
      "outward.url": "Osoite",
      "outward.method": "Menetelmä",
      "outward.agent": "Agentin nimi",
      "outward.enabled": "Päällä",
      "outward.states": "Tilat",
      "outward.watching": "Seurattava kone",
      "outward.payload": "Näin viesti lähtee",
      "outward.testSend": "Kokeile lähetystä",
      "headers": "Otsakkeet",
      "headers.lead": "Otsakkeet lähtevät kutsun mukana. Avainta ei kirjoiteta tähän: nimeä salaisuus arvossa, niin palvelin panee arvon paikalleen kutsun lähtiessä.",
      "headers.add": "Lisää otsake",
      "headers.name": "Otsakkeen nimi",
      "headers.value": "Arvo",
      "headers.remove": "Poista",
      "headers.none": "Ei yhtään otsaketta.",
      "secret.pick": "Lisää salaisuus",
      "secret.none": "Yhtään salaisuutta ei ole vielä tallessa.",
      "secret.add": "Lisää sellainen Pääsy-sivulla",
      "agent.pick": "Valitse agentti",
      "agent.none": "Yksikään agenteistasi ei voi vielä toimia.",
      "agent.connect": "Yhdistä agentti Agenttisi-sivulla",
      "agent.seen": "nähty {date}",
      "agent.unseen": "ei vielä nähty",
      "save": "Tallenna",
      "close": "Sulje",
      "copy": "Kopioi",
      "copied": "Kopioitu",
      "guest.read": "Kirjaudu sisään, niin arvo luetaan ulkoa. Näytössä on viimeisin lukema.",
      "guest.send": "Kirjaudu sisään, niin tämä voi kertoa ulospäin.",
      "stale.lead": "Lukema ei päivittynyt: ",
      "stale.tail": " Näytössä on viimeisin, joka saatiin.",
      "refusal.ALLOWLIST_REFUSED": "Tätä osoitetta ei ole sallittu tällä solmulla.",
      "refusal.RATE_LIMITED": "Kutsuja on tehty liikaa tämän minuutin aikana.",
      "refusal.PAYLOAD_TOO_LARGE": "Viesti on liian iso lähetettäväksi.",
      "refusal.UPSTREAM_FAILED": "Vastaanottaja ei vastannut.",
      "refusal.NO_EXTENSION": "Tämän solmun living-hooks-laajennus ei vastannut.",
      "refusal.UNKNOWN": "Kutsu ei mennyt läpi.",
      "sentence.write": 'Kirjoita AIMEAT-muistiin avaimelle {key} arvo {sample}. Asiakirja "{title}" lukee sen sieltä.',
      "sentence.task": 'Asiakirja "{title}" siirtyi tilasta {from} tilaan {to}. Koko tila on tämän viestin mukana.'
    },
    en: {
      "gear.in": "This value can come from outside",
      "gear.out": "When this changes, tell someone",
      "inward.title": "This value can come from outside",
      "inward.lead": "The value can be set by hand, read from an address, or written into memory. You choose which road.",
      "inward.road": "Where the value comes from",
      "inward.road.hand": "By hand, on this page",
      "inward.road.url": "From an address",
      "inward.road.key": "From a memory key",
      "inward.url": "Address",
      "inward.path": "Path inside the answer",
      "inward.every": "How often, in seconds",
      "inward.key": "Memory key",
      "inward.expected": "This is the shape the answer must have",
      "inward.testRead": "Test read",
      "inward.write": "Write the value into memory",
      "inward.agent": "Say this to your own AI",
      "inward.range": "The range it accepts",
      "outward.title": "When this changes, tell someone",
      "outward.lead": "Every transition sends one message, and it carries the whole document's state.",
      "outward.kind": "Who to tell",
      "outward.kind.url": "An address",
      "outward.kind.agent": "One of your agents",
      "outward.url": "Address",
      "outward.method": "Method",
      "outward.agent": "The agent's name",
      "outward.enabled": "On",
      "outward.states": "The states",
      "outward.watching": "The machine it watches",
      "outward.payload": "This is the message as it goes",
      "outward.testSend": "Test send",
      "headers": "Headers",
      "headers.lead": "The headers go with the call. A key is not typed here: name a secret in the value, and the server puts the value in as the call leaves.",
      "headers.add": "Add a header",
      "headers.name": "Header name",
      "headers.value": "Value",
      "headers.remove": "Remove",
      "headers.none": "No headers.",
      "secret.pick": "Insert a secret",
      "secret.none": "No secrets are kept yet.",
      "secret.add": "Add one on the Access page",
      "agent.pick": "Pick an agent",
      "agent.none": "None of your agents can act yet.",
      "agent.connect": "Connect one on the Your agents page",
      "agent.seen": "seen {date}",
      "agent.unseen": "not seen yet",
      "save": "Save",
      "close": "Close",
      "copy": "Copy",
      "copied": "Copied",
      "guest.read": "Sign in and the value is read from outside. What you see is the last reading.",
      "guest.send": "Sign in and this can tell the outside.",
      "stale.lead": "The reading did not refresh: ",
      "stale.tail": " What you see is the last one that arrived.",
      "refusal.ALLOWLIST_REFUSED": "This address is not one this node is allowed to call.",
      "refusal.RATE_LIMITED": "Too many calls have been made this minute.",
      "refusal.PAYLOAD_TOO_LARGE": "The message is too big to send.",
      "refusal.UPSTREAM_FAILED": "The receiver did not answer.",
      "refusal.NO_EXTENSION": "This node's living-hooks extension did not answer.",
      "refusal.UNKNOWN": "The call did not go through.",
      "sentence.write": 'Write into AIMEAT memory, under the key {key}, the value {sample}. The document "{title}" reads it from there.',
      "sentence.task": 'The document "{title}" went from {from} to {to}. Its whole state is with this message.'
    }
  };
  function say(key, langs2) {
    const map = {};
    for (const lang of Object.keys(WORDS)) {
      if (WORDS[lang][key] != null) map[lang] = WORDS[lang][key];
    }
    const got = pickLang(map, langs2 || []);
    return got ? String(got.text) : String(key);
  }
  function refusalWords(refusal, langs2) {
    if (!refusal) return "";
    if (refusal.message) return String(refusal.message);
    const code = String(refusal.code || "UNKNOWN");
    const known = WORDS.en["refusal." + code] ? code : "UNKNOWN";
    return say("refusal." + known, langs2);
  }

  // src/static/sdk-libs/living/hooks.js
  var EXTENSION = "living-hooks";
  function now() {
    try {
      if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
        return performance.now();
      }
    } catch {
    }
    return Date.now();
  }
  function currentSession() {
    try {
      const ns = (
        /** @type {any} */
        window.AIMEAT
      );
      if (!ns || !ns.auth || typeof ns.auth.getSession !== "function") return null;
      return ns.auth.getSession() || null;
    } catch {
      return null;
    }
  }
  function createHooks(opts) {
    const options = opts || {};
    const transport = typeof options.transport === "function" ? options.transport : null;
    const langs2 = typeof options.langs === "function" ? options.langs : function() {
      return [];
    };
    const ext = String(options.extension || EXTENSION);
    function signedIn() {
      if (typeof options.signedIn === "boolean") return options.signedIn;
      return !!currentSession();
    }
    async function overTheWire(req) {
      const session = currentSession();
      if (!session || typeof session.fetch !== "function") {
        return { error: { code: "NO_EXTENSION", message: say("refusal.NO_EXTENSION", langs2()) } };
      }
      const head = { "Content-Type": "application/json" };
      if (req.kind === "task") {
        const made = await session.fetch("/v1/agents/" + encodeURIComponent(String(req.agent)) + "/tasks", {
          method: "POST",
          headers: head,
          body: JSON.stringify({ title: req.title, description: req.description })
        });
        if (!made || !made.ok) return { error: made && made.error || { code: "UPSTREAM_FAILED" } };
        return { ok: true, status: 201 };
      }
      const body = req.kind === "read" ? { url: req.url, path: req.path, raw: req.raw, headers: req.headers } : { url: req.url, method: req.method, headers: req.headers, body: req.body };
      const answer = await session.fetch("/v1/ext/" + encodeURIComponent(ext) + "/" + (req.kind === "read" ? "read" : "send"), {
        method: "POST",
        headers: head,
        body: JSON.stringify(body)
      });
      if (!answer || !answer.ok) return { error: answer && answer.error || { code: "UPSTREAM_FAILED" } };
      return answer.data || {};
    }
    async function call(req) {
      if (!signedIn()) {
        return {
          refusal: {
            code: "SIGNED_OUT",
            message: say(req.kind === "read" ? "guest.read" : "guest.send", langs2())
          },
          ms: 0
        };
      }
      const started = now();
      try {
        const answer = transport ? await transport(req) : await overTheWire(req);
        const ms = Math.round(now() - started);
        if (answer && answer.error) return { refusal: answer.error, ms };
        return Object.assign({ ms }, answer || {});
      } catch (e) {
        return {
          refusal: { code: "UPSTREAM_FAILED", message: e && e.message || String(e) },
          ms: Math.round(now() - started)
        };
      }
    }
    return {
      /** Whether this page can make the call at all, and the words to say when it cannot. */
      status() {
        const ok = signedIn();
        return { signedIn: ok, reason: ok ? "" : say("guest.send", langs2()) };
      },
      signedIn,
      /** The refusal a read earns for a guest, in words — the source runtime shows this on the node. */
      guestRead() {
        return say("guest.read", langs2());
      },
      /** A refusal as a person reads it: the node's own sentence first, the code's fallback second. */
      words(refusal) {
        return refusalWords(refusal, langs2());
      },
      /** @param {{ url: string, method?: string, headers?: object, body: any }} req */
      send(req) {
        return call({
          kind: "send",
          url: String(req.url),
          method: String(req.method || "POST"),
          headers: req.headers,
          body: req.body
        });
      },
      /** @param {{ url: string, path?: string, raw?: boolean, headers?: object }} req */
      read(req) {
        return call({
          kind: "read",
          url: String(req.url),
          path: req.path,
          raw: req.raw,
          headers: req.headers
        });
      },
      /** @param {{ agent: string, title: string, description: string, body: any }} req */
      task(req) {
        return call({
          kind: "task",
          agent: String(req.agent),
          title: String(req.title),
          description: String(req.description),
          body: req.body
        });
      }
    };
  }

  // src/static/sdk-libs/webhook/index.js
  var { authFetch: authFetch2 } = makeSession("aimeat-webhook.js");
  var SETTINGS_KEY = "living-hooks.settings";
  function langs() {
    const out = [];
    try {
      const attr = document.documentElement.getAttribute("lang");
      if (attr) out.push(attr.slice(0, 2).toLowerCase());
    } catch {
    }
    const saved = storedLang();
    if (saved) out.push(saved.slice(0, 2).toLowerCase());
    return out;
  }
  var hooks = createHooks({ langs });
  function normaliseHost(value) {
    let h = String(value || "").trim().toLowerCase();
    const dot = h.startsWith(".");
    h = h.replace(/^\.+/, "").replace(/^[a-z]+:\/\//, "").split("/")[0].split(":")[0];
    if (!/^[a-z0-9.-]+$/.test(h) || !h.includes(".")) return "";
    return (dot ? "." : "") + h;
  }
  async function readSettings() {
    const res = await authFetch2("/v1/memory/" + encodeURIComponent(SETTINGS_KEY) + "?soft=1");
    if (!res.ok) return {};
    const value = res.data && res.data.value;
    return value && typeof value === "object" ? value : {};
  }
  var webhook = {
    /** Whether this page can send at all, and the words to show when it cannot. */
    status() {
      return hooks.status();
    },
    /**
     * POST (or PUT) a JSON body to `url`. Answers the extension's result with `ms`, or `{ refusal }`
     * with the node's own code and sentence. Never throws.
     * @param {{ url: string, method?: 'POST'|'PUT', headers?: Record<string,string>, body: any }} req
     */
    send(req) {
      return hooks.send(req);
    },
    /**
     * GET `url` and answer the JSON (or the value at `path`, or the raw body with `raw: true`).
     * @param {{ url: string, path?: string, raw?: boolean, headers?: Record<string,string> }} req
     */
    read(req) {
      return hooks.read(req);
    },
    /** A refusal as a person reads it: the node's sentence first, then a fallback per code. */
    words(refusal) {
      return hooks.words(refusal);
    },
    /** The hosts this person allows. The operator's hosts apply as well and are not listed here. */
    async hosts() {
      const settings = await readSettings();
      return Array.isArray(settings.allow_hosts) ? settings.allow_hosts.slice() : [];
    },
    /**
     * Add one host to the person's allowlist. Returns the new list. Call it only from a control the
     * person presses: every app and agent of this person may send to a host on this list.
     * @param {string} host  "api.example.com", "https://api.example.com/x" or ".example.com"
     */
    async allowHost(host) {
      const clean = normaliseHost(host);
      if (!clean) {
        throw Object.assign(new Error("Give a host name such as api.example.com."), { code: "INVALID_INPUT" });
      }
      const settings = await readSettings();
      const list = Array.isArray(settings.allow_hosts) ? settings.allow_hosts.slice() : [];
      if (!list.includes(clean)) list.push(clean);
      const res = await authFetch2("/v1/memory", {
        method: "POST",
        body: JSON.stringify({ key: SETTINGS_KEY, value: Object.assign({}, settings, { allow_hosts: list }), visibility: "public" })
      });
      if (!res.ok) {
        throw Object.assign(
          new Error(res.error && res.error.message || "The allowlist was not saved."),
          { code: res.error && res.error.code }
        );
      }
      return list;
    }
  };
  attach("webhook", webhook);
})();
