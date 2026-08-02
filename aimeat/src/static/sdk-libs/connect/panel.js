/**
 * @file connect/panel.js
 * @description The ready-made connected-accounts panel (TARGET-057). Mounted by the profile's
 *   Access tab and available to any app that wants the same surface.
 *
 *   THE STATUS ROW IS THE POINT. A connection that needs re-authorising is not an error and must not
 *   look like one: it is a thing the owner can fix in two clicks, and it is shown as a button that
 *   fixes it. Rendering it as red text is how a working feature becomes a support question.
 *
 *   Like the IAM panel, this emits neutral `aim-*` hooks and a stylesheet built on `currentColor`
 *   and inherited font, so it takes the host page's design instead of imposing one. Nothing here
 *   hardcodes a brand colour.
 * @structure mountConnectPanel(connect, opts)
 * @usage AIMEAT.connect.panel({ target: '#accounts' })
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial (TARGET-057 phase 3).
 */

const STYLE_ID = 'aimeat-connect-style';

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

/**
 * Plain, inherited, and scrollable in its own right. The horizontal scroll lives on the list rather
 * than the page: a long account label must not make the whole profile scroll sideways.
 */
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
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

const DEFAULT_STRINGS = {
  title: 'Connected accounts',
  intro: 'Accounts you have connected so apps can act at those services on your behalf. The account credential stays on this node; an app is only ever told which account it may use.',
  empty: 'You have not connected any accounts yet.',
  add: 'Connect',
  connecting: 'Connecting…',
  disconnect: 'Disconnect',
  reconnect: 'Reconnect',
  needsReauth: 'needs reconnecting',
  instancePlaceholder: 'instance address, e.g. mastodon.social',
  confirm: 'Disconnect this account? Apps that publish to it will stop being able to.',
  toldProvider: 'Disconnected, and the service was told.',
  notToldProvider: 'Disconnected here. The service could not be reached to be told, so check it there too.',
  unavailable: 'Connecting accounts is not enabled on this node.',
};

/**
 * Mount the panel.
 *
 * @param {any} connect  The AIMEAT.connect surface.
 * @param {{target?: string|Element, strings?: Record<string,string>, styles?: boolean}} [opts]
 */
export async function mountConnectPanel(connect, opts = {}) {
  const host = typeof opts.target === 'string' ? document.querySelector(opts.target) : opts.target;
  // Named rather than a bare null-deref: "target not found" is the only thing that goes wrong here
  // and the selector is usually a typo.
  if (!host) throw new Error('aimeat-connect: panel target not found');
  if (opts.styles !== false) injectStyle();
  const s = { ...DEFAULT_STRINGS, ...(opts.strings || {}) };

  const root = el('div', { cls: 'aim-conn' });
  host.replaceChildren(root);

  let providers = [];
  let busy = false;

  async function render() {
    let accounts;
    try {
      [accounts, providers] = await Promise.all([connect.list(), connect.providers()]);
    } catch (err) {
      // A capability that is switched off answers 503; saying so beats an empty panel that looks
      // like "you have no accounts".
      root.replaceChildren(el('p', { cls: 'aim-conn-err', text: `${s.unavailable} (${(err && err.message) || err})` }));
      return;
    }

    const rows = accounts.map((c) => {
      const needsReauth = c.status === 'needs_reauth';
      return el('div', { cls: 'aim-conn-row' }, [
        el('div', { cls: 'aim-conn-main' }, [
          el('span', { cls: 'aim-conn-label', text: c.accountLabel }),
          el('span', {
            cls: 'aim-conn-meta',
            text: needsReauth ? `${c.provider} · ${s.needsReauth}` : c.provider,
          }),
        ]),
        el('div', { cls: 'aim-conn-actions' }, [
          // Shown as a FIX, not as an error. Two clicks and it works again.
          needsReauth
            ? el('button', {
              cls: 'aim-conn-btn', text: s.reconnect, attrs: { type: 'button' },
              on: { click: () => void beginConnect(c.provider, null) },
            })
            : null,
          el('button', {
            cls: 'aim-conn-btn', text: s.disconnect, attrs: { type: 'button' },
            on: {
              click: () => {
                if (!window.confirm(s.confirm)) return;
                void (async () => {
                  const r = await connect.revoke(c.id);
                  await render();
                  // Honest about which half happened: a token still live at the provider is
                  // something the owner may want to go and remove there.
                  window.alert(r.toldProvider ? s.toldProvider : s.notToldProvider);
                })();
              },
            },
          }),
        ]),
      ]);
    });

    const list = rows.length
      ? el('div', { cls: 'aim-conn-list' }, rows)
      : el('p', { cls: 'aim-conn-empty', text: s.empty });

    root.replaceChildren(
      el('p', { cls: 'aim-conn-note', text: s.intro }),
      list,
      ...providers.map(renderAdd),
    );
  }

  function renderAdd(p) {
    const note = (connect.notes && connect.notes[p.id]) || {};
    let instanceInput = null;
    if (p.instanceScoped) {
      instanceInput = el('input', {
        cls: 'aim-conn-input',
        attrs: { type: 'text', placeholder: s.instancePlaceholder, 'aria-label': s.instancePlaceholder },
      });
    }
    const btn = el('button', {
      cls: 'aim-conn-btn',
      text: `${s.add} ${p.label}`,
      attrs: { type: 'button' },
      on: { click: () => void beginConnect(p.id, instanceInput) },
    });
    return el('div', {}, [
      el('div', { cls: 'aim-conn-add' }, [instanceInput, btn]),
      // Before the attempt, always. Each of these prevents a failure whose message does not
      // explain itself.
      note.needs ? el('p', { cls: 'aim-conn-note', text: note.needs }) : null,
      note.where ? el('p', { cls: 'aim-conn-note', text: note.where }) : null,
      note.before ? el('p', { cls: 'aim-conn-note', text: note.before }) : null,
    ]);
  }

  async function beginConnect(providerId, instanceInput) {
    if (busy) return;
    busy = true;
    const instance = instanceInput ? instanceInput.value.trim() : undefined;
    try {
      await connect.start(providerId, { instance });
    } catch (err) {
      const msg = (err && err.message) || String(err);
      root.appendChild(el('p', { cls: 'aim-conn-err', text: msg }));
    } finally {
      busy = false;
      await render();
    }
  }

  connect.on(() => void render());
  await render();
  return { refresh: render };
}
