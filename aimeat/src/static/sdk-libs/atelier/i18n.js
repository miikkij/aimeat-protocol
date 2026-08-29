/**
 * @file atelier/i18n.js
 * @description Translation for the aimeat-atelier kit's OWN handful of strings, and the merge
 *   point for the host's. The kit ships English, Finnish and Spanish for the words it puts on
 *   screen itself (Loading, Retry, Nothing here yet, …); everything else — every label in your
 *   app — comes from the host, because the kit has no idea what your things are called.
 *
 *   Each language is written in that language, not as translated English.
 *
 *   It follows the PLATFORM language choice rather than inventing a second one: the current
 *   language is read from AIMEAT.auth.getLang() when the auth library is present, else the
 *   `aimeat-lang` storage key, else the browser, and it re-renders on the platform's
 *   `aimeat-lang-change` event. There is no language switch in this kit — the login pill has one.
 * @structure BASE (en/fi/es) · lang/setLang · use(dict) · t(key, vars) · onChange
 * @usage  AIMEAT.atelier.i18n.use({ fi: { addTask: 'Lisää tehtävä' }, en: { addTask: 'Add task' } });
 *         AIMEAT.atelier.i18n.t('addTask');
 * @version-history
 *   v0.2.1 — 2026-08-28 — copilot* keys become aide* (the component was renamed before any app
 *     uses it), visible titles per language: Aide / Apuri / Ayudante.
 *   v0.2.0 — 2026-08-28 — The aide's words (title, notice, no-AI state, run/confirm) and the
 *     explain-screen title, in all three languages (TARGET-074 phase 6).
 *   v0.1.1 — 2026-08-28 — +signInHint, the shell's default hint on the designed sign-in state.
 *   v0.1.0 — 2026-08-27 — Initial (TARGET-074 phase 1, slice 1).
 */

/** The kit's own strings. A host dictionary of the same shape is merged over this. */
const BASE = {
  en: {
    loading: 'Loading…',
    ready: 'Ready.',
    retry: 'Try again',
    close: 'Close',
    back: 'Back',
    cancel: 'Cancel',
    save: 'Save',
    confirm: 'Confirm',
    search: 'Search',
    menu: 'Menu',
    more: 'More',
    open: 'Open',
    empty: 'Nothing here yet',
    emptyHint: 'What you add will appear here.',
    noResults: 'Nothing matched',
    noResultsHint: 'Try a different word.',
    loadFailed: 'This did not load',
    loadFailedHint: 'Check your connection and try again.',
    signIn: 'Log in to continue.',
    signInHint: 'Use the account button in the top corner.',
    required: 'Required',
    optional: 'Optional',
    total: 'Total',
    you: 'You',
    next: 'Next',
    previous: 'Previous',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitView: 'Fit to view',
    send: 'Send',
    aideTitle: 'Aide',
    aidePlaceholder: 'Ask, or say what to do…',
    opsOk: 'up',
    opsWarn: 'degraded',
    opsDown: 'down',
    'queue.waiting': 'waiting',
    'queue.running': 'running',
    'queue.done': 'done',
    'queue.failed': 'failed',
    consoleEmpty: 'Nothing logged yet',
    atlasDown: 'The map could not load',
    aideNotice: 'You are talking with an AI. Answers can be wrong; actions run only when you confirm them.',
    aideNoAi: 'AI is not set up on this account yet. Connect a key under Profile, and the aide wakes up.',
    aideFailed: 'That did not go through. Try again.',
    aideRun: 'Run it',
    aideUnknownAction: 'The model proposed something this app does not declare — nothing was run.',
    explainTitle: 'What this screen holds',
    delegateGo: 'Let AI handle it',
    delegateHanded: 'Handed over',
    delegateFailed: 'The agent could not finish it.',
    delegateNoAgents: 'No agent is connected to this account yet.',
    agentActivityNone: 'No agent activity yet.',
  },
  fi: {
    loading: 'Ladataan…',
    ready: 'Valmis.',
    retry: 'Yritä uudelleen',
    close: 'Sulje',
    back: 'Takaisin',
    cancel: 'Peruuta',
    save: 'Tallenna',
    confirm: 'Vahvista',
    search: 'Hae',
    menu: 'Valikko',
    more: 'Lisää',
    open: 'Avaa',
    empty: 'Täällä ei ole vielä mitään',
    emptyHint: 'Lisäämäsi asiat näkyvät tässä.',
    noResults: 'Ei osumia',
    noResultsHint: 'Kokeile toista sanaa.',
    loadFailed: 'Tämä ei latautunut',
    loadFailedHint: 'Tarkista yhteys ja yritä uudelleen.',
    signIn: 'Kirjaudu sisään jatkaaksesi.',
    signInHint: 'Käytä yläkulman tilinappia.',
    required: 'Pakollinen',
    optional: 'Valinnainen',
    total: 'Yhteensä',
    you: 'Sinä',
    next: 'Seuraava',
    previous: 'Edellinen',
    zoomIn: 'Lähennä',
    zoomOut: 'Loitonna',
    fitView: 'Sovita näkymään',
    send: 'Lähetä',
    aideTitle: 'Apuri',
    aidePlaceholder: 'Kysy, tai sano mitä tehdään…',
    opsOk: 'toiminnassa',
    opsWarn: 'takkuaa',
    opsDown: 'nurin',
    'queue.waiting': 'jonossa',
    'queue.running': 'käynnissä',
    'queue.done': 'valmis',
    'queue.failed': 'epäonnistui',
    consoleEmpty: 'Ei vielä lokirivejä',
    atlasDown: 'Kartta ei latautunut',
    aideNotice: 'Keskustelet tekoälyn kanssa. Vastaus voi olla väärin; toiminnot ajetaan vasta kun vahvistat ne.',
    aideNoAi: 'Tälle tilille ei ole vielä kytketty tekoälyä. Liitä avain profiilissa, niin apuri herää.',
    aideFailed: 'Se ei mennyt läpi. Yritä uudelleen.',
    aideRun: 'Aja',
    aideUnknownAction: 'Malli ehdotti jotain mitä tämä appsi ei tunne — mitään ei ajettu.',
    explainTitle: 'Mitä tällä näytöllä on',
    delegateGo: 'Anna tekoälyn hoitaa',
    delegateHanded: 'Annettu hoidettavaksi',
    delegateFailed: 'Agentti ei saanut sitä valmiiksi.',
    delegateNoAgents: 'Tähän tiliin ei ole vielä kytketty agenttia.',
    agentActivityNone: 'Ei agenttitoimintaa vielä.',
  },
  es: {
    loading: 'Cargando…',
    ready: 'Listo.',
    retry: 'Inténtalo otra vez',
    close: 'Cerrar',
    back: 'Atrás',
    cancel: 'Cancelar',
    save: 'Guardar',
    confirm: 'Confirmar',
    search: 'Buscar',
    menu: 'Menú',
    more: 'Más',
    open: 'Abrir',
    empty: 'Aquí todavía no hay nada',
    emptyHint: 'Lo que añadas aparecerá aquí.',
    noResults: 'Sin coincidencias',
    noResultsHint: 'Prueba con otra palabra.',
    loadFailed: 'Esto no se cargó',
    loadFailedHint: 'Revisa tu conexión e inténtalo otra vez.',
    signIn: 'Inicia sesión para continuar.',
    signInHint: 'Usa el botón de cuenta en la esquina superior.',
    required: 'Obligatorio',
    optional: 'Opcional',
    total: 'Total',
    you: 'Tú',
    next: 'Siguiente',
    previous: 'Anterior',
    zoomIn: 'Acercar',
    zoomOut: 'Alejar',
    fitView: 'Ajustar a la vista',
    send: 'Enviar',
    aideTitle: 'Ayudante',
    aidePlaceholder: 'Pregunta, o di qué hacer…',
    opsOk: 'en marcha',
    opsWarn: 'degradado',
    opsDown: 'caído',
    'queue.waiting': 'en cola',
    'queue.running': 'en curso',
    'queue.done': 'hecho',
    'queue.failed': 'falló',
    consoleEmpty: 'Sin líneas de registro todavía',
    atlasDown: 'El mapa no se cargó',
    aideNotice: 'Estás hablando con una IA. Las respuestas pueden fallar; las acciones solo se ejecutan cuando las confirmas.',
    aideNoAi: 'Esta cuenta aún no tiene IA configurada. Conecta una clave en el perfil y el ayudante despierta.',
    aideFailed: 'No ha funcionado. Inténtalo otra vez.',
    aideRun: 'Ejecutar',
    aideUnknownAction: 'El modelo propuso algo que esta app no declara — no se ejecutó nada.',
    explainTitle: 'Qué hay en esta pantalla',
    delegateGo: 'Deja que la IA lo haga',
    delegateHanded: 'Encargado',
    delegateFailed: 'El agente no pudo terminarlo.',
    delegateNoAgents: 'Esta cuenta aún no tiene ningún agente conectado.',
    agentActivityNone: 'Sin actividad de agentes todavía.',
  },
};

/** Host dictionaries merged in by `use()`, keyed by language. */
const HOST = { en: {}, fi: {}, es: {} };

/** @type {Array<(lang: string) => void>} */
const listeners = [];

let current = detect();

/** Resolve the platform language: auth library → storage key → browser → 'en'. */
function detect() {
  try {
    const ns = /** @type {any} */ (window).AIMEAT;
    if (ns && ns.auth && typeof ns.auth.getLang === 'function') {
      const l = ns.auth.getLang();
      if (l) return String(l).slice(0, 2);
    }
    const stored = localStorage.getItem('aimeat-lang');
    if (stored) return stored.slice(0, 2);
  } catch { /* storage blocked — fall through to the browser */ }
  return (navigator.language || 'en').slice(0, 2);
}

/** @param {string} lang */
function announce(lang) {
  for (const cb of listeners.slice()) {
    try { cb(lang); } catch { /* one bad listener never stops the rest */ }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('aimeat-lang-change', function (ev) {
    const detail = /** @type {any} */ (ev).detail;
    const lang = (detail && detail.lang) || detect();
    if (lang === current) return;
    current = String(lang).slice(0, 2);
    announce(current);
  });
}

export const i18n = {
  /** The languages the kit itself ships. A host may add more via `use()`. */
  langs: ['en', 'fi', 'es'],

  /** The language in force right now. @returns {string} */
  lang() { return current; },

  /**
   * Set the language for the kit AND the platform (one key, `aimeat-lang`, shared with the site).
   * @param {string} lang
   */
  setLang(lang) {
    const next = String(lang).slice(0, 2);
    if (next === current) return;
    current = next;
    try {
      const ns = /** @type {any} */ (window).AIMEAT;
      if (ns && ns.auth && typeof ns.auth.setLang === 'function') ns.auth.setLang(next);
      else localStorage.setItem('aimeat-lang', next);
    } catch { /* storage blocked — the in-memory language still changed */ }
    announce(current);
  },

  /**
   * Merge the host's dictionary over the kit's. Either `{ en: {...}, fi: {...} }` or a flat
   * object for the current language.
   * @param {Record<string, any>} dict
   */
  use(dict) {
    if (!dict) return;
    const looksNested = Object.keys(dict).every(function (k) {
      return dict[k] && typeof dict[k] === 'object' && !Array.isArray(dict[k]);
    });
    if (looksNested) {
      for (const lang in dict) {
        HOST[lang] = Object.assign({}, HOST[lang] || {}, dict[lang]);
      }
    } else {
      HOST[current] = Object.assign({}, HOST[current] || {}, dict);
    }
    announce(current);
  },

  /**
   * Look up a string: host(current) → kit(current) → kit(en) → the key itself. `{name}` in the
   * text is replaced from `vars`.
   * @param {string} key
   * @param {Record<string, any>} [vars]
   * @returns {string}
   */
  t(key, vars) {
    const text = (HOST[current] && HOST[current][key])
      || (BASE[current] && BASE[current][key])
      || (HOST.en && HOST.en[key])
      || BASE.en[key]
      || key;
    if (!vars) return String(text);
    return String(text).replace(/\{(\w+)\}/g, function (whole, name) {
      return vars[name] == null ? whole : String(vars[name]);
    });
  },

  /**
   * Run a callback whenever the language changes (host `use()` counts — new words arrived).
   * @param {(lang: string) => void} cb
   * @returns {() => void}  stop listening
   */
  onChange(cb) {
    listeners.push(cb);
    return function () {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
};

/** Shorthand used inside the kit's own components. @type {(key: string, vars?: any) => string} */
export const t = i18n.t;
