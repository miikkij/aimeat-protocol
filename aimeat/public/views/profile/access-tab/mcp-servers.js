/**
 * @file views/profile/access-tab/mcp-servers.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP servers section — the other MCP servers this account has attached, and the one
 *   place they can all be seen, switched off and removed.
 *
 *   IT LIVES BESIDE CONNECTED ACCOUNTS for the reason that section gives: a person must be able to
 *   find everything they have given a third party in ONE place. These are the same promise pointing
 *   the other way — a credential this node holds so that everything acting for them can use a
 *   server without holding it.
 *
 *   `needs_reauth` is rendered as a BUTTON THAT FIXES IT rather than as an error, copying
 *   connections.js for the same reason: it is the expected end of a token's life, and red turns a
 *   two-click repair into a support question. `unreachable` is the far side being down, which is
 *   somebody else's outage and says so plainly instead of blaming the person.
 *
 *   THE ADDRESS IS SHOWN NOWHERE, because no response carries it. That is deliberate all the way
 *   down: a caller that learns the endpoint can call it directly and leave every gate behind. The
 *   person typed it once; the node keeps it.
 * @structure McpServersSection — GET /v1/mcp-servers, attach, switch off, remove, and the tool list
 *   on demand.
 * @version-history
 *   2026-09-22 -- Composed from the shared component set (ListRow with the tool list as its open
 *     body, Field, Action, Surface); no own classes. The title and introduction the Access page hid
 *     are gone: its section says them. A switched-off server is a muted row.
 *   v1.1.0 — 2026-09-16 — Attach and sign-in are not retried. The shared client retries any 5xx, and
 *     attaching stores the row before it answers, so a dead address was retried into "you already
 *     have a server called X". Found by pressing the button in a real browser.
 *   v1.0.0 — 2026-09-16 — Initial (MCP proxy phase 1).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { Stack, ListRow, Action, Field, Surface, Text } from '/components/poster-parts.js';
import { api, apiGet, apiPatch, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

const EMPTY_DRAFT = { name: '', url: '', title: '', token: '', header: '', auth: 'token' };

export function McpServersSection({ showToast }) {
  const [servers, setServers] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  /** Closed by default: attaching is the rare act, and an open form in front of everybody is noise. */
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState('');
  /** Which server's tool list is open, and what it holds. One at a time. */
  const [toolsFor, setToolsFor] = useState('');
  const [tools, setTools] = useState([]);
  const [unavailable, setUnavailable] = useState(false);
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async () => {
    try {
      const list = await apiGet('/v1/mcp-servers');
      // apiGet returns the WHOLE envelope, so the payload is under .data. A level too high yields
      // undefined -> [], which renders as a believable empty state rather than an error.
      setServers(list?.data?.servers || []);
      setUnavailable(false);
    } catch (err) {
      // A caller without the scope, or a node with no encryption key, answers rather than
      // returning nothing. Saying so beats an empty list that reads as "you have none".
      swallowed('mcp-servers-load', err);
      setUnavailable(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Every tab showing server data re-reads on a live update. This one has a real source: attaching
  // or removing a server emits the `mcp-servers` change domain.
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  /**
   * Send the person to the far side's consent screen.
   *
   * A full page navigation rather than a pop-up: this is the same window they will come back to,
   * the callback redirects them here, and a pop-up would need the COOP dance connections.js
   * documents for a flow that does not need it.
   */
  const authorize = useCallback(async (s) => {
    setBusy(s.id || s.slug);
    try {
      // Not retried: starting a sign-in stores a fresh one-time state on the node, and a retry after a
      // 5xx would start a second round the person never sees.
      const res = await api('/v1/mcp-servers/' + encodeURIComponent(s.id || s.slug) + '/authorize', {
        method: 'POST', body: JSON.stringify({ return_url: '/spa.html#access' }), retries: 0,
      });
      const url = res?.data?.authorize_url;
      if (!url) {
        // The far side needed nobody. Saying so beats silence after a button press.
        showToast(t('profile.access.mcpNoSignInNeeded') || 'That server needed no sign-in. It is ready.');
        await load();
        return;
      }
      window.location.href = url;
    } catch (err) {
      swallowed('mcp-servers-authorize', err);
      showToast(err?.message || t('profile.access.mcpAuthFailed') || 'Could not start the sign-in');
    } finally {
      setBusy('');
    }
  }, [load, showToast]);

  const attach = useCallback(async () => {
    if (!draft.name || !draft.url) {
      showToast(t('profile.access.mcpNeedNameUrl') || 'A server needs a short name and an address.');
      return;
    }
    setBusy('attach');
    try {
      const oauth = draft.auth === 'oauth';
      // NOT RETRIED, and this is the fix for something only a browser showed. The shared client
      // retries any 5xx, and attaching stores the row BEFORE it answers, parked, so an address that
      // does not answer came back 502, was retried, and the retry answered 409. The person was told
      // "you already have a server called X" instead of "X could not be reached". Found 2026-09-16.
      const res = await api('/v1/mcp-servers', {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          url: draft.url.trim(),
          ...(draft.title ? { title: draft.title } : {}),
          ...(oauth ? { auth: 'oauth' } : {}),
          ...(!oauth && draft.token ? { token: draft.token } : {}),
          ...(!oauth && draft.header ? { header: draft.header } : {}),
        }),
        retries: 0,
      });
      setDraft(EMPTY_DRAFT);
      setAddOpen(false);
      await load();

      if (oauth) {
        // Attached but not yet signed in. Send the person straight on rather than making them find
        // a second button: they came here to connect it, and the consent screen is the rest of that
        // one act.
        await authorize({ id: res?.data?.server?.id, slug: draft.name.trim() });
        return;
      }
      const count = res?.data?.tools?.length ?? 0;
      showToast((t('profile.access.mcpAttached') || 'Attached. {n} tool(s) available.')
        .replace('{n}', String(count)));
    } catch (err) {
      // The node's own sentence is the useful one here: it distinguishes a name already taken from
      // a server that would not answer from a node that cannot hold a secret, and a generic
      // "could not attach" would throw away the only part the person can act on.
      swallowed('mcp-servers-attach', err);
      showToast(err?.message || t('profile.access.mcpAttachFailed') || 'Could not attach that server');
    } finally {
      setBusy('');
    }
  }, [authorize, draft, load, showToast]);

  const toggle = useCallback(async (s) => {
    setBusy(s.id);
    try {
      await apiPatch('/v1/mcp-servers/' + encodeURIComponent(s.id), { enabled: !s.enabled });
      await load();
    } catch (err) {
      swallowed('mcp-servers-toggle', err);
      showToast(t('profile.access.mcpToggleFailed') || 'Could not change that server');
    } finally {
      setBusy('');
    }
  }, [load, showToast]);

  const showTools = useCallback(async (s) => {
    if (toolsFor === s.id) { setToolsFor(''); setTools([]); return; }
    setBusy(s.id);
    try {
      const res = await apiGet('/v1/mcp-servers/' + encodeURIComponent(s.id) + '/tools');
      setTools(res?.data?.tools || []);
      setToolsFor(s.id);
    } catch (err) {
      swallowed('mcp-servers-tools', err);
      showToast(t('profile.access.mcpToolsFailed') || 'Could not read that server just now');
    } finally {
      setBusy('');
    }
  }, [toolsFor, showToast]);

  const remove = useCallback((s) => {
    confirm(
      (t('profile.access.mcpRemoveAsk')
        || 'Remove "{name}"? Everything acting for you loses those tools at once.')
        .replace('{name}', s.slug),
      async () => {
        try {
          await apiDelete('/v1/mcp-servers/' + encodeURIComponent(s.id));
          // Worth saying, because it is what a person cutting access actually cares about: the
          // node forgets its copy, and the far side is still theirs to revoke.
          showToast(t('profile.access.mcpRemoved')
            || 'Removed. A token you made at the far side is still yours to revoke there.');
          await load();
        } catch (err) {
          swallowed('mcp-servers-remove', err);
          showToast(t('profile.access.mcpRemoveFailed') || 'Could not remove that server');
        }
      },
      {
        title: t('profile.access.mcpRemove') || 'Remove server',
        confirmLabel: t('profile.access.mcpRemove') || 'Remove server',
        danger: true,
      },
    );
  }, [confirm, load, showToast]);

  if (unavailable) return null;

  /** One line saying what is wrong, when something is. Never a colour on its own. */
  const statusNote = (s) => {
    if (!s.enabled) return t('profile.access.mcpOff') || 'switched off';
    if (s.status === 'needs_reauth') return t('profile.access.mcpNeedsReauth') || 'needs connecting again';
    if (s.status === 'unreachable') return t('profile.access.mcpUnreachable') || 'not answering';
    return '';
  };

  // The Access page's section carries the title and the introduction; this is its body.
  return html`<${Stack}>
    <${ConfirmUI} />
    ${servers.length === 0 && html`<${Text} tone="muted">${t('profile.access.mcpEmpty') || 'No MCP servers attached yet.'}<//>`}

    ${servers.length > 0 && html`<${Stack} density="compact">${servers.map(s => html`
      <${ListRow} key=${s.id} name=${escHtml(s.title || s.slug)} muted=${!s.enabled}
        detail=${`${escHtml(s.slug)} · ${(t('profile.access.mcpToolCount') || '{n} tools').replace('{n}', String(s.toolCount))}${statusNote(s) ? ' · ' + statusNote(s) : ''}`}
        actions=${html`
          ${s.status === 'needs_reauth' && html`<${Action} disabled=${busy === s.id} onClick=${() => authorize(s)}>${t('profile.access.mcpSignIn') || 'Sign in'}<//>`}
          <${Action} kind="text" disabled=${busy === s.id} expanded=${toolsFor === s.id} onClick=${() => showTools(s)}>
            ${toolsFor === s.id ? (t('profile.access.mcpHideTools') || 'Hide tools') : (t('profile.access.mcpShowTools') || 'Show tools')}
          <//>
          <${Action} kind="text" disabled=${busy === s.id} onClick=${() => toggle(s)}>
            ${s.enabled ? (t('profile.access.mcpSwitchOff') || 'Switch off') : (t('profile.access.mcpSwitchOn') || 'Switch on')}
          <//>
          <${Action} kind="text" tone="danger" onClick=${() => remove(s)}>${t('profile.access.mcpRemove') || 'Remove server'}<//>`}>
        ${toolsFor === s.id && html`<${Text} kind="caption" tone="muted">
          ${tools.length ? tools.map(x => x.name).join(', ') : (t('profile.access.mcpNoTools') || 'This server offers no tools right now.')}
        <//>`}
      <//>
    `)}<//>`}

    <${Stack} direction="horizontal" align="start">
      <${Action} onClick=${() => setAddOpen(!addOpen)} expanded=${addOpen}>
        ${addOpen ? (t('profile.access.mcpCancel') || 'Cancel') : (t('profile.access.mcpAdd') || 'Attach a server')}
      <//>
    <//>

    ${addOpen && html`<${Surface} kind="box"><${Stack}>
      <${Field} ariaLabel=${t('profile.access.mcpName') || 'Short name, e.g. jira'} placeholder=${t('profile.access.mcpName') || 'Short name, e.g. jira'}
        value=${draft.name} onInput=${e => setDraft({ ...draft, name: e.target.value })} />
      <${Field} ariaLabel=${t('profile.access.mcpUrl') || 'Address (https)'} placeholder=${t('profile.access.mcpUrl') || 'Address (https)'}
        value=${draft.url} onInput=${e => setDraft({ ...draft, url: e.target.value })} />
      <${Field} ariaLabel=${t('profile.access.mcpTitleField') || 'What to call it (optional)'} placeholder=${t('profile.access.mcpTitleField') || 'What to call it (optional)'}
        value=${draft.title} onInput=${e => setDraft({ ...draft, title: e.target.value })} />
      <${Field} type="select" value=${draft.auth}
        onChange=${e => setDraft({ ...draft, auth: e.target.value })}
        options=${[{ value: 'token', label: t('profile.access.mcpAuthToken') || 'It gave me a token' },
          { value: 'oauth', label: t('profile.access.mcpAuthOauth') || 'I sign in to it' }]} />
      ${draft.auth === 'token' && html`
        <${Field} type="password" autoComplete="off" ariaLabel=${t('profile.access.mcpToken') || 'Token, if it needs one'}
          placeholder=${t('profile.access.mcpToken') || 'Token, if it needs one'}
          value=${draft.token} onInput=${e => setDraft({ ...draft, token: e.target.value })} />
        <${Field} ariaLabel=${t('profile.access.mcpHeader') || 'Header for the token (optional)'} placeholder=${t('profile.access.mcpHeader') || 'Header for the token (optional)'}
          value=${draft.header} onInput=${e => setDraft({ ...draft, header: e.target.value })} />
      `}
      <${Text} kind="caption" tone="muted">${t('profile.access.mcpAddNote')
        || 'The address is checked before anything is saved, so a wrong address or token is reported now. The token is encrypted here and never shown again.'}<//>
      <${Stack} direction="horizontal" align="start">
        <${Action} kind="primary" disabled=${busy === 'attach'} onClick=${attach}>
          ${busy === 'attach' ? (t('profile.access.mcpChecking') || 'Checking the server…') : (t('profile.access.mcpAttach') || 'Attach')}
        <//>
      <//>
    <//><//>`}
  <//>`;
}
