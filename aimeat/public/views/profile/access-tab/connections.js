/**
 * @file views/profile/access-tab/connections.js
 * @description Connected Accounts section (TARGET-057) — the accounts the owner holds at external
 *   services, and the one place they can all be seen and taken away.
 *
 *   IT LIVES HERE AND NOT IN AN APP because a person must be able to find everything they have
 *   given a third party in ONE place. An app-by-app panel means that revoking an account requires
 *   remembering which app created it, which is the same as not being able to revoke it.
 *
 *   `needs_reauth` is rendered as a BUTTON THAT FIXES IT, not as an error. It is the expected end of
 *   a token's life, it happens to every long-lived connection eventually, and showing it in red
 *   turns a two-click repair into a support question.
 * @structure ConnectionsSection — GET /v1/connections + /providers, connect via a pop-up, revoke.
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial (TARGET-057 phase 3).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { apiGet, apiPost, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** Things a user must be told BEFORE they try, because the failure they prevent is unreadable. */
const NOTES = {
  mastodon: ['cxNoteMastodonNeeds', 'cxNoteMastodonBefore'],
  youtube: ['cxNoteYoutubeBefore'],
  bluesky: ['cxNoteBlueskyNeeds', 'cxNoteBlueskyWhere', 'cxNoteBlueskyBefore'],
};

export function ConnectionsSection({ showToast }) {
  const [connections, setConnections] = useState([]);
  const [providers, setProviders] = useState([]);
  const [instances, setInstances] = useState({});
  // Supplied credentials, per provider per field. Held only until the POST; nothing here is
  // persisted client-side, and the server never sends any of it back.
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async () => {
    try {
      const [list, provs] = await Promise.all([
        apiGet('/v1/connections'),
        apiGet('/v1/connections/providers'),
      ]);
      // apiGet returns the WHOLE envelope, so the payload is under .data. Reading it a level
      // too high yields undefined -> [], which renders as a believable empty state rather than an
      // error, and that is exactly how this stayed wrong through a typecheck and a lint.
      setConnections(list?.data?.connections || []);
      setProviders(provs?.data?.providers || []);
      setUnavailable(false);
    } catch (err) {
      // A node with the capability switched off answers 503. Saying so beats an empty list that
      // reads as "you have no accounts".
      swallowed('connections-load', err);
      setUnavailable(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Every tab showing server data re-reads on a live update.
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

/**
 * Wait for the round to finish, WITHOUT touching the pop-up window.
 *
 * This node sets a Cross-Origin-Opener-Policy, which severs the opener relationship as soon as the
 * pop-up navigates to the provider. `win.closed` is then unreadable — the first version of this
 * polled it and logged ten "COOP would block the window.closed call" errors per connection while
 * appearing to work, because the flow completed for other reasons.
 *
 * Two signals instead, and neither goes near the window:
 *   - the done page announces on a same-origin BroadcastChannel, which COOP does not affect
 *   - the connection list is polled, which is what ACTUALLY decides success and also covers the
 *     user who closes the pop-up before it ever reaches the done page
 *
 * Resolves either way; gives up after the timeout rather than waiting forever on a cancelled round.
 */
  const waitForConnection = useCallback(async (countBefore) => {
    const DEADLINE = Date.now() + 180_000;
    let channel = null;
    let announced = false;
    try {
      channel = new BroadcastChannel('aimeat-connect');
      channel.onmessage = () => { announced = true; };
    } catch (err) {
      // Not fatal: the poll below is the one that decides. Logged so the two paths stay
      // distinguishable when someone is looking at why a connection took four seconds.
      swallowed('connections-broadcast', err);
    }
    try {
      while (Date.now() < DEADLINE) {
        await new Promise(r => setTimeout(r, 1200));
        if (announced) return true;
        const now = (await apiGet('/v1/connections'))?.data?.connections?.length ?? 0;
        // A re-authorisation repairs a row rather than adding one, so a count that did not grow is
        // not proof of failure -- but it is the cheap signal, and the announce covers the rest.
        if (now > countBefore) return true;
      }
      return false;
    } finally {
      if (channel) channel.close();
    }
  }, []);

  /**
   * Consent happens at the provider, in a pop-up. Completion is detected by that window closing and
   * a re-read of the list, because a cross-origin child window cannot be asked what happened to it
   * — and treating "the window opened" as success would report a cancelled connection as connected.
   */
  const connect = useCallback(async (provider) => {
    setBusy(provider.id);
    try {
      const res = await apiPost('/v1/connections/start', {
        provider: provider.id,
        instance: instances[provider.id] || undefined,
        mode: 'personal',
        return_url: '/connection-done.html',
      });
      const url = res?.data?.authorize_url;
      if (!url) throw new Error('no authorize url');
      const before = (await apiGet('/v1/connections'))?.data?.connections?.length ?? 0;
      const win = window.open(url, 'aimeat-connect', 'width=620,height=760');
      if (!win) throw new Error('popup blocked');
      await waitForConnection(before);
      await load();
    } catch (err) {
      swallowed('connections-start', err);
      showToast(t('profile.access.cxConnectFailed') || 'Could not start connecting that account');
    }
    setBusy('');
  }, [instances, load, showToast, waitForConnection]);

  /**
   * The other way to connect: the user supplies a credential and there is no round trip to the
   * provider's consent screen. Kept separate from connect() because the two must never overlap —
   * attaching an OAuth provider would be a way to skip its consent screen, and the server refuses
   * that in both directions.
   */
  const attach = useCallback(async (provider) => {
    setBusy(provider.id);
    try {
      await apiPost('/v1/connections/attach', {
        provider: provider.id,
        mode: 'personal',
        fields: fields[provider.id] || {},
      });
      // Cleared on success so a secret does not sit in a form field after it has been stored.
      setFields(f => ({ ...f, [provider.id]: {} }));
      await load();
    } catch (err) {
      swallowed('connections-attach', err);
      // The server's reason is the useful half here: "that is your account password, not an app
      // password" is actionable in a way that "could not connect" is not.
      showToast(err?.message || t('profile.access.cxConnectFailed') || 'Could not connect that account');
    }
    setBusy('');
  }, [fields, load, showToast]);

  // useConfirm is (message, onConfirm, opts) — positional, with a callback. Passing it an options
  // object and awaiting the result renders an EMPTY dialog and never runs the action: the owner is
  // asked to confirm losing an account without being told which one, and pressing Confirm does
  // nothing. Both halves of that were live until the browser pass caught them.
  const revoke = useCallback((conn) => {
    const message = (t('profile.access.cxConfirm')
      || 'Disconnect {account}? Apps that publish to it will stop being able to.')
      .replace('{account}', conn.accountLabel);
    confirm(message, async () => {
      try {
        const res = await apiDelete('/v1/connections/' + encodeURIComponent(conn.id));
        // Honest about which half happened: a token still live at the provider is something the
        // owner may want to go and remove there themselves.
        showToast(res?.data?.told_provider
          ? (t('profile.access.cxRevokedTold') || 'Disconnected, and the service was told.')
          : (t('profile.access.cxRevokedLocal') || 'Disconnected here. The service could not be reached, so check it there too.'));
        await load();
      } catch (err) {
        swallowed('connections-revoke', err);
        showToast(t('profile.access.cxRevokeFailed') || 'Could not disconnect that account');
      }
    }, {
      title: t('profile.access.cxDisconnect') || 'Disconnect',
      confirmLabel: t('profile.access.cxDisconnect') || 'Disconnect',
      danger: true,
    });
  }, [confirm, load, showToast]);

  if (unavailable) return null;

  return html`
    <div class="access-section">
      <${ConfirmUI} />
      <h3 class="access-h3">${t('profile.access.cxTitle') || 'Connected accounts'}</h3>
      <p class="text-meta-sm">${t('profile.access.cxIntro')
        || 'Accounts you have connected at other services. The credential stays on this node — an app is only ever told which account it may use, never the account itself.'}</p>

      ${connections.length === 0 && html`
        <div class="mem-item"><span class="adm-text-dim">${t('profile.access.cxEmpty') || 'No connected accounts yet.'}</span></div>
      `}

      ${connections.map(c => html`
        <div class="mem-item" key=${c.id}>
          <span class="mem-key">${escHtml(c.accountLabel)}</span>
          <span class="text-meta-sm">
            ${escHtml(c.provider)}${c.status === 'needs_reauth'
              ? ' · ' + (t('profile.access.cxNeedsReauth') || 'needs reconnecting')
              : ''}
          </span>
          ${c.status === 'needs_reauth' && html`
            <button class="btn-outline" onClick=${() => connect({ id: c.provider })}>
              ${t('profile.access.cxReconnect') || 'Reconnect'}
            </button>
          `}
          <button class="btn-ghost btn-danger" onClick=${() => revoke(c)}>
            ${t('profile.access.cxDisconnect') || 'Disconnect'}
          </button>
        </div>
      `)}

      ${providers.map(p => html`
        <div class="access-cx-add" key=${p.id}>
          <div class="mem-item access-fed-add">
            ${p.instanceScoped && html`
              <input type="text" class="input-field input-sm"
                placeholder=${t('profile.access.cxInstance') || 'instance address, e.g. mastodon.social'}
                value=${instances[p.id] || ''}
                onInput=${e => setInstances({ ...instances, [p.id]: e.target.value })} />
            `}
            ${(p.attachFields || []).map(f => html`
              <input key=${f.name}
                type=${f.secret ? 'password' : 'text'}
                class="input-field input-sm"
                autocomplete=${f.secret ? 'new-password' : 'off'}
                placeholder=${f.placeholder || f.label}
                aria-label=${f.label}
                value=${(fields[p.id] || {})[f.name] || ''}
                onInput=${e => setFields(prev => ({
                  ...prev, [p.id]: { ...(prev[p.id] || {}), [f.name]: e.target.value },
                }))} />
            `)}
            <button class="btn-outline" disabled=${busy === p.id}
              onClick=${() => (p.attachFields ? attach(p) : connect(p))}>
              ${busy === p.id
                ? (t('profile.access.cxConnecting') || 'Connecting…')
                : `${t('profile.access.cxConnect') || 'Connect'} ${escHtml(p.label)}`}
            </button>
          </div>
          ${(NOTES[p.id] || []).map(key => html`
            <p class="text-meta-sm" key=${key}>${t('profile.access.' + key)}</p>
          `)}
        </div>
      `)}
    </div>
  `;
}
