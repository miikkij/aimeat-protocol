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
 *   v1.0.0 — 2026-09-16 — Initial (MCP proxy phase 1).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import { apiGet, apiPost, apiPatch, apiDelete } from '/js/api.js';
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
      const res = await apiPost('/v1/mcp-servers/' + encodeURIComponent(s.id || s.slug) + '/authorize', {
        return_url: '/spa.html#access',
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
      const res = await apiPost('/v1/mcp-servers', {
        name: draft.name.trim(),
        url: draft.url.trim(),
        ...(draft.title ? { title: draft.title } : {}),
        ...(oauth ? { auth: 'oauth' } : {}),
        ...(!oauth && draft.token ? { token: draft.token } : {}),
        ...(!oauth && draft.header ? { header: draft.header } : {}),
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

  return html`
    <div class="access-section">
      <${ConfirmUI} />
      <h3 class="access-h3">${t('profile.access.mcpTitle') || 'MCP servers'}</h3>
      <p class="text-meta-sm">${t('profile.access.mcpIntro')
        || 'Other MCP servers you have attached. Your AI, your agents and your apps can use them, and the credential stays here in your own AIMEAT — nothing acting for you ever sees it.'}</p>

      ${servers.length === 0 && html`
        <div class="mem-item"><span class="adm-text-dim">${t('profile.access.mcpEmpty') || 'No MCP servers attached yet.'}</span></div>
      `}

      ${servers.map(s => html`
        <div class="mem-item" key=${s.id}>
          <span class="mem-key">${escHtml(s.title || s.slug)}</span>
          <span class="text-meta-sm">
            ${escHtml(s.slug)} · ${(t('profile.access.mcpToolCount') || '{n} tools')
              .replace('{n}', String(s.toolCount))}${statusNote(s) ? ' · ' + statusNote(s) : ''}
          </span>
          ${s.status === 'needs_reauth' && html`
            <button class="btn-outline" disabled=${busy === s.id} onClick=${() => authorize(s)}>
              ${t('profile.access.mcpSignIn') || 'Sign in'}
            </button>
          `}
          <button class="btn-ghost" disabled=${busy === s.id} onClick=${() => showTools(s)}>
            ${toolsFor === s.id
              ? (t('profile.access.mcpHideTools') || 'Hide tools')
              : (t('profile.access.mcpShowTools') || 'Show tools')}
          </button>
          <button class="btn-outline" disabled=${busy === s.id} onClick=${() => toggle(s)}>
            ${s.enabled ? (t('profile.access.mcpSwitchOff') || 'Switch off') : (t('profile.access.mcpSwitchOn') || 'Switch on')}
          </button>
          <button class="btn-ghost btn-danger" onClick=${() => remove(s)}>
            ${t('profile.access.mcpRemove') || 'Remove server'}
          </button>
        </div>
        ${toolsFor === s.id && html`
          <div class="mem-item">
            <span class="text-meta-sm">
              ${tools.length
                ? tools.map(x => x.name).join(', ')
                : (t('profile.access.mcpNoTools') || 'This server offers no tools right now.')}
            </span>
          </div>
        `}
      `)}

      <button class="btn-ghost" onClick=${() => setAddOpen(!addOpen)}>
        ${addOpen ? (t('profile.access.mcpCancel') || 'Cancel') : (t('profile.access.mcpAdd') || 'Attach a server')}
      </button>

      ${addOpen && html`
        <div class="mem-item">
          <input class="adm-input" placeholder=${t('profile.access.mcpName') || 'Short name, e.g. jira'}
            value=${draft.name} onInput=${e => setDraft({ ...draft, name: e.target.value })} />
          <input class="adm-input" placeholder=${t('profile.access.mcpUrl') || 'Address (https)'}
            value=${draft.url} onInput=${e => setDraft({ ...draft, url: e.target.value })} />
          <input class="adm-input" placeholder=${t('profile.access.mcpTitleField') || 'What to call it (optional)'}
            value=${draft.title} onInput=${e => setDraft({ ...draft, title: e.target.value })} />
          <select class="adm-input" value=${draft.auth}
            onChange=${e => setDraft({ ...draft, auth: e.target.value })}>
            <option value="token">${t('profile.access.mcpAuthToken') || 'It gave me a token'}</option>
            <option value="oauth">${t('profile.access.mcpAuthOauth') || 'I sign in to it'}</option>
          </select>
          ${draft.auth === 'token' && html`
            <input class="adm-input" type="password" autocomplete="off"
              placeholder=${t('profile.access.mcpToken') || 'Token, if it needs one'}
              value=${draft.token} onInput=${e => setDraft({ ...draft, token: e.target.value })} />
            <input class="adm-input" placeholder=${t('profile.access.mcpHeader') || 'Header for the token (optional)'}
              value=${draft.header} onInput=${e => setDraft({ ...draft, header: e.target.value })} />
          `}
          <p class="text-meta-sm">${t('profile.access.mcpAddNote')
            || 'The address is checked before anything is saved, so a wrong address or token is reported now. The token is encrypted here and never shown again.'}</p>
          <button class="btn-primary" disabled=${busy === 'attach'} onClick=${attach}>
            ${busy === 'attach'
              ? (t('profile.access.mcpChecking') || 'Checking the server…')
              : (t('profile.access.mcpAttach') || 'Attach')}
          </button>
        </div>
      `}
    </div>
  `;
}
