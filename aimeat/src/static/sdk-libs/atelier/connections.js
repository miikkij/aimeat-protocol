/**
 * @file atelier/connections.js
 * @description The person's connected outside accounts, as a kit component (iam-members-and-
 *   library-blocks plan, Phase D block 5). aimeat-connect.js ships its own panel() in a neutral
 *   look; this draws the same accounts in the kit's tokens, so the list wears the app's look.
 *
 *   Each account shows the service, the account's own name, its status (connected, needs sign-in
 *   again, not working) and what it can do, read from AIMEAT.connect.capabilities() and never
 *   guessed from the service's name. An account that needs a new sign-in offers Sign in again;
 *   Disconnect asks first. Below the accounts, one Connect button per service, started from the
 *   click itself (the provider's window is a pop-up), with the server field a Mastodon account
 *   needs and the fields a service connected by a supplied credential needs. `need` ('readMail',
 *   'sendMail' or 'publish') keeps only the services that can do what the app needs.
 *
 *   WHAT FETCHES AND WHY. Nothing here fetches. Every read and write goes through AIMEAT.connect,
 *   which the page loads with aimeat-auth.js; this component never holds a token, because the
 *   library never has one either. Without the library the component says what is missing.
 *
 *   THE SAMPLE STATE. `sample: true` draws three sample accounts in the three states and four
 *   services, marked as sample content; nothing is connected or changed.
 * @parts connections root · title · intro · need · failure · notice · accounts · row · who · status · can · acts · reconnect · disconnect · add · provider · instance · connect · providerNote
 * @tokens connections --ak-conn-width
 * @fork connections Copying it out means calling AIMEAT.connect's list(), providers(), capabilities(), start(), attach() and revoke() yourself, starting start() inside the click, and keeping the confirm before a disconnect and the words for each status.
 * @structure connections(spec) (helpers: connectOf · signedOut · capWords · statusOf · instanceOf)
 * @usage
 *   AIMEAT.atelier.connections({ target: '#accounts' });
 *   AIMEAT.atelier.connections({ target: '#accounts', need: 'sendMail', title: 'Send from' });
 * @version-history
 *   v0.61.0 — 2026-10-01 — Initial (iam-members-and-library-blocks plan, Phase D block 5).
 */
import { el, clear, resolve, enter, whileBusy } from './dom.js';
import { ti } from './intake-connect-i18n.js';
import { sampleBadge, watch, ask, refusal } from './members-shared.js';

/** The capability words, in the order a row lists them. */
const CAPS = ['readMail', 'sendMail', 'publishPost', 'publishVideo', 'readMetrics', 'readItems'];

/** What `need` accepts. */
const NEEDS = ['readMail', 'sendMail', 'publish'];

/** The sample, shaped like list() and providers() answer. */
const SAMPLE = {
  accounts: [
    { id: 's1', provider: 'google-mail-send', mode: 'personal', accountLabel: 'robin@example.com', status: 'active' },
    { id: 's2', provider: 'mastodon', mode: 'personal', accountLabel: '@robin@mastodon.social', status: 'needs_reauth' },
    { id: 's3', provider: 'linkedin', mode: 'personal', accountLabel: 'Robin Aho', status: 'revoked' },
  ],
  providers: [
    { id: 'google-mail', label: 'Gmail', instanceScoped: false, capabilities: ['read-mail'], attachFields: null },
    { id: 'google-mail-send', label: 'Gmail (sending)', instanceScoped: false, capabilities: ['send-mail'], attachFields: null },
    { id: 'mastodon', label: 'Mastodon', instanceScoped: true, capabilities: ['publish-post', 'publish-video', 'read-metrics'], attachFields: null },
    { id: 'linkedin', label: 'LinkedIn', instanceScoped: false, capabilities: ['publish-post'], attachFields: null },
  ],
};

/** The page's AIMEAT.connect, or null. */
function connectOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.connect ? ns.connect : null;
}

/** True when the page knows for certain that nobody is signed in. */
function signedOut() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const auth = ns && ns.auth;
  return !!(auth && typeof auth.getSession === 'function' && !auth.getSession());
}

/**
 * What a provider entry can do, read the way AIMEAT.connect.capabilities() reads it. Used for the
 * sample only, which has no library behind it.
 * @param {any} p
 */
function sampleCaps(p) {
  const names = (p && p.capabilities) || [];
  const has = function (n) { return names.indexOf(n) !== -1; };
  return {
    readMail: has('read-mail'), sendMail: has('send-mail'),
    publish: has('publish-post') || has('publish-video'), publishPost: has('publish-post'), publishVideo: has('publish-video'),
    readMetrics: has('read-metrics'), readItems: has('read-items'),
  };
}

/** The words of what an account can do, joined; '' when it can do nothing this kit names. */
function capWords(caps) {
  if (!caps) return '';
  return CAPS.filter(function (k) { return caps[k]; }).map(function (k) { return ti('connect.cap.' + k); }).join(', ');
}

/** The three states a person reads: connected, needs sign-in again, or not working. */
function statusOf(c) {
  if (c.status === 'active') return 'active';
  if (c.status === 'needs_reauth') return 'needs_reauth';
  return 'error';
}

/** The server of an account on an instance-scoped service ('@me@mastodon.social' → mastodon.social). */
function instanceOf(c) {
  const m = /@([^@\s]+\.[^@\s]+)$/.exec(String(c.accountLabel || ''));
  return m ? m[1] : undefined;
}

/**
 * The person's connected outside accounts, and a Connect button per service.
 * @param {{ target?: string|Element, title?: string, sample?: boolean,
 *   need?: 'readMail'|'sendMail'|'publish' }} [spec]
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, destroy: () => void }}
 */
export function connections(spec) {
  const s = spec || {};
  const sample = s.sample === true;
  const need = NEEDS.indexOf(/** @type {string} */ (s.need)) !== -1 ? s.need : null;
  const root = el('section', { class: 'ak-root ak-conn', 'data-ak-part': 'root' });
  if (s.target) resolve(s.target).appendChild(root);
  let gen = 0;
  let failure = '';
  let notice = '';
  let working = false;
  /** @type {HTMLElement|null} */
  let noticeEl = null;

  /** Run one action, then draw again with its outcome. */
  async function act(work, done) {
    failure = ''; notice = '';
    try {
      const r = await work();
      failure = refusal(r);
      if (!failure && done) notice = done(r) || '';
    } catch (e) {
      failure = refusal(e) || String(e);
    }
    await render();
  }

  function button(label, tone, part, run) {
    const noop = function () { /* the sample connects and changes nothing */ };
    return el('button', {
      type: 'button', class: 'ak-btn ak-btn--' + tone, 'data-ak-part': part,
      disabled: sample || working ? true : null, on: { click: sample ? noop : run },
    }, label);
  }

  async function render() {
    const mine = ++gen;
    const lib = connectOf();
    let stopText = '';
    /** @type {any[]} */
    let accounts = [];
    /** @type {any[]} */
    let providers = [];
    /** @type {Map<string, any>} */
    const caps = new Map();
    if (sample) {
      accounts = SAMPLE.accounts;
      providers = SAMPLE.providers;
      providers.forEach(function (p) { caps.set(p.id, sampleCaps(p)); });
    } else if (!lib) stopText = ti('connect.noLib');
    else if (signedOut()) stopText = ti('connect.signIn');
    else {
      try {
        const both = await Promise.all([lib.list(), lib.providers()]);
        accounts = both[0] || [];
        providers = both[1] || [];
        // An entry of providers() carries its capability names, so capabilities() answers it
        // without another request.
        const read = await Promise.all(providers.map(function (p) {
          return Promise.resolve(lib.capabilities(p)).catch(function () { return null; });
        }));
        providers.forEach(function (p, i) { caps.set(p.id, read[i]); });
      } catch (e) {
        if (!failure) failure = refusal(e) || String(e);
      }
    }
    if (mine !== gen) return;
    clear(root);
    root.appendChild(el('h3', { class: 'ak-conn__title', 'data-ak-part': 'title' },
      [s.title || ti('connect.title'), sample ? sampleBadge() : null].filter(Boolean)));
    root.appendChild(el('p', { class: 'ak-conn__intro', 'data-ak-part': 'intro' }, sample ? ti('connect.sampleNote') : ti('connect.intro')));
    if (need) root.appendChild(el('p', { class: 'ak-conn__need', 'data-ak-part': 'need' }, ti('connect.need.' + need)));
    if (stopText) { root.appendChild(el('p', { class: 'ak-conn__none' }, stopText)); return; }
    if (failure) root.appendChild(el('p', { class: 'ak-conn__failure', role: 'alert', 'data-ak-part': 'failure' }, ti('connect.failed', { why: failure })));
    noticeEl = el('p', { class: 'ak-conn__notice', role: 'status', 'data-ak-part': 'notice', hidden: notice ? null : true }, notice);
    root.appendChild(noticeEl);

    const byId = new Map(providers.map(function (p) { return [p.id, p]; }));
    root.appendChild(el('div', { class: 'ak-conn__group', 'data-ak-part': 'accounts' }, [
      accounts.length
        ? el('ul', { class: 'ak-conn__rows' }, accounts.map(function (c) { return row(lib, c, byId.get(c.provider), caps.get(c.provider)); }))
        : el('p', { class: 'ak-conn__none' }, ti('connect.none')),
    ]));

    const offered = providers.filter(function (p) {
      if (!need) return true;
      const can = caps.get(p.id);
      return !!(can && can[need]);
    });
    root.appendChild(el('div', { class: 'ak-conn__group', 'data-ak-part': 'add' }, [
      el('h4', { class: 'ak-conn__group-title' }, ti('connect.add')),
      offered.length
        ? el('ul', { class: 'ak-conn__rows ak-conn__offers' }, offered.map(function (p) { return offer(lib, p); }))
        : el('p', { class: 'ak-conn__none' }, need ? ti('connect.noProviders') : ti('connect.none')),
    ]));
  }

  /** One connected account. */
  function row(lib, c, p, can) {
    const state = statusOf(c);
    const label = (p && p.label) || c.provider;
    // A service connected by a supplied credential has no sign-in round to repeat; its fields are
    // under Connect, where the person supplies the credential again.
    const reconnect = state !== 'active' && !(p && p.attachFields);
    const words = capWords(can);
    return el('li', { class: 'ak-conn__row', 'data-ak-part': 'row', 'data-ak-status': state }, [
      el('span', { class: 'ak-conn__who', 'data-ak-part': 'who' }, [
        el('span', { class: 'ak-conn__mark', 'aria-hidden': 'true' }, String(label).slice(0, 1).toUpperCase()),
        el('span', { class: 'ak-conn__names' }, [
          el('span', { class: 'ak-conn__account' }, c.accountLabel || label),
          el('span', { class: 'ak-conn__provider' }, label),
        ]),
      ]),
      el('span', { class: 'ak-conn__status ak-conn__status--' + state, 'data-ak-part': 'status' }, ti('connect.status.' + state)),
      words ? el('span', { class: 'ak-conn__can', 'data-ak-part': 'can' }, ti('connect.can', { what: words })) : null,
      el('span', { class: 'ak-conn__acts', 'data-ak-part': 'acts' }, [
        reconnect ? button(ti('connect.reconnect'), 'primary', 'reconnect', function (ev) {
          begin(lib, c.provider, { instance: p && p.instanceScoped ? instanceOf(c) : undefined }, ev);
        }) : null,
        button(ti('connect.disconnect'), 'ghost', 'disconnect', function () {
          ask({
            title: ti('connect.confirm', { account: c.accountLabel || label }),
            text: ti('connect.confirmText', { provider: label }),
            confirmLabel: ti('connect.disconnect'), tone: 'danger',
          }).then(function (yes) {
            if (!yes) return;
            act(function () { return lib.revoke(c.id); }, function (r) {
              return ti(r && r.toldProvider ? 'connect.toldProvider' : 'connect.notToldProvider', { provider: label });
            });
          });
        }),
      ].filter(Boolean)),
    ].filter(Boolean));
  }

  /** One service to connect: its button, the server field or the credential fields it needs. */
  function offer(lib, p) {
    const notes = (lib && lib.notes && lib.notes[p.id]) || {};
    const instance = p.instanceScoped ? /** @type {HTMLInputElement} */ (el('input', {
      type: 'text', class: 'ak-input ak-conn__input', 'data-ak-part': 'instance', placeholder: ti('connect.instance'),
      'aria-label': ti('connect.instance'), autocomplete: 'off', disabled: sample ? true : null,
    })) : null;
    const fields = (p.attachFields || []).map(function (f) {
      return /** @type {HTMLInputElement} */ (el('input', {
        type: f.secret ? 'password' : 'text', class: 'ak-input ak-conn__input', 'data-field': f.name,
        placeholder: f.placeholder || f.label, 'aria-label': f.label,
        autocomplete: f.secret ? 'new-password' : 'off', disabled: sample ? true : null,
      }));
    });
    const go = button(ti('connect.connectTo', { provider: p.label || p.id }), 'ghost', 'connect', function (ev) {
      if (p.attachFields && p.attachFields.length) {
        /** @type {Record<string, string>} */
        const values = {};
        fields.forEach(function (i) { values[i.getAttribute('data-field')] = i.value; });
        act(function () { return lib.attach(p.id, values); }, function (r) {
          // A secret does not stay in a field after it was stored.
          fields.forEach(function (i) { i.value = ''; });
          const added = r && r.connection;
          return ti('connect.connected', { account: (added && added.accountLabel) || p.label });
        });
        return;
      }
      begin(lib, p.id, { instance: instance ? instance.value.trim() || undefined : undefined }, ev);
    });
    return el('li', { class: 'ak-conn__row ak-conn__offer', 'data-ak-part': 'provider', 'data-ak-provider': p.id }, [
      el('span', { class: 'ak-conn__fields' }, /** @type {HTMLElement[]} */ ([instance]).concat(fields, [go]).filter(Boolean)),
      notes.needs ? el('p', { class: 'ak-conn__note', 'data-ak-part': 'providerNote' }, notes.needs) : null,
      notes.before ? el('p', { class: 'ak-conn__note', 'data-ak-part': 'providerNote' }, notes.before) : null,
    ].filter(Boolean));
  }

  /**
   * Start the provider's sign-in round. Called inside the click handler with nothing awaited
   * before it, so the browser lets the provider's window open.
   */
  function begin(lib, provider, opts, ev) {
    if (sample || working || !lib) return;
    working = true;
    failure = '';
    notice = '';
    const btn = ev && ev.currentTarget ? /** @type {Element} */ (ev.currentTarget) : null;
    const round = lib.start(provider, opts || {});
    if (noticeEl) { noticeEl.textContent = ti('connect.waiting'); noticeEl.hidden = false; }
    whileBusy(btn, round).then(function (r) {
      working = false;
      const added = r && r.connection;
      notice = r && r.connected ? ti('connect.connected', { account: (added && added.accountLabel) || provider }) : ti('connect.notConnected');
      return render();
    }, function (e) {
      working = false;
      notice = '';
      failure = refusal(e) || String(e);
      return render();
    });
  }

  const ready = render().then(function () { enter(root); });
  const stopWatch = watch(function () { failure = ''; notice = ''; render(); }, root);
  // A connection made or removed elsewhere on the page (the library's own panel, another block)
  // shows here too. While a round is open this block draws when the round ends.
  const lib0 = connectOf();
  // A block the app took off the page without destroy() stops listening on the next change.
  /** @type {any} */
  let stopLib = null;
  if (!sample && lib0 && typeof lib0.on === 'function') {
    stopLib = lib0.on(function changed() {
      if (!root.isConnected) {
        if (typeof stopLib === 'function') stopLib(); else if (typeof lib0.off === 'function') lib0.off(changed);
        return;
      }
      if (!working) render();
    });
  }
  return {
    el: root,
    refresh: function () { return ready.then(render); },
    destroy: function () {
      stopWatch();
      if (typeof stopLib === 'function') stopLib();
      gen += 1;
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
