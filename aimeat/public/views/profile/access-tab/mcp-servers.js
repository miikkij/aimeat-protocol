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
 *   v1.10.2 — 2026-09-28 — No escHtml() on text preact renders: preact escapes text and attributes
 *     itself, so names with a quote or an ampersand showed as &quot; / &amp;.
 *   v1.10.1 — 2026-09-26 — A server's name turns coral under the pointer again, as main's
 *     .mem-item:hover drew it (Row hover; fix pass).
 *   v1.10.0 — 2026-09-26 — Every part is a component that takes data, and the file writes no class
 *     (component plan, page group G3): the servers are a List (the name a key, its slug, tools and
 *     state the meta line, the tool list under the row while it is open), the attach form the Field
 *     family, the toggles say whether they are open (aria-expanded). `inRow` leaves out the heading
 *     and intro where the page's section says them (Access 04; the .ac-kept rule hid them).
 *   v1.9.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.8.0 — 2026-09-26 — A server's name wears the Key's face (.key-name, css/components/key-name.css); .mem-key keeps only its place (a unification: the look most tabs use).
 *   v1.7.0 — 2026-09-25 — The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.4.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { useConfirm } from '/components/Modal.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { api, apiGet, apiPatch, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

const EMPTY_DRAFT = { name: '', url: '', title: '', token: '', header: '', auth: 'token' };

/**
 * @param {{ showToast: Function, inRow?: boolean }} props `inRow`: the section stands inside a page
 *   section that already says its heading and intro (Access, 04), so it leaves out its own.
 */
export function McpServersSection({ showToast, inRow }) {
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

  return html`
    <${ConfirmUI} />
    ${inRow ? null : html`<${SubHeading} level=${3}>${t('profile.access.mcpTitle') || 'MCP servers'}<//>
      <${Note}>${t('profile.access.mcpIntro')
        || 'Other MCP servers you have attached. Your AI, your agents and your apps can use them, and the credential stays here in your own AIMEAT — nothing acting for you ever sees it.'}<//>`}

    <${List} cols="name-doors" empty=${t('profile.access.mcpEmpty') || 'No MCP servers attached yet.'}>
      ${servers.map(s => html`
        <${Row} key=${s.id} hover below=${toolsFor === s.id ? html`
          <${Note} kind="meta">
            ${tools.length
              ? tools.map(x => x.name).join(', ')
              : (t('profile.access.mcpNoTools') || 'This server offers no tools right now.')}
          <//>` : null}>
          <${Name} asKey meta=${`${s.slug ?? ''} · ${(t('profile.access.mcpToolCount') || '{n} tools')
            .replace('{n}', String(s.toolCount))}${statusNote(s) ? ' · ' + statusNote(s) : ''}`}>${s.title || s.slug}<//>
          <${Doors}>
            ${s.status === 'needs_reauth' && html`
              <${Action} small row disabled=${busy === s.id} onClick=${() => authorize(s)}>
                ${t('profile.access.mcpSignIn') || 'Sign in'}
              <//>
            `}
            <${Action} small row expanded=${toolsFor === s.id} disabled=${busy === s.id} onClick=${() => showTools(s)}>
              ${toolsFor === s.id
                ? (t('profile.access.mcpHideTools') || 'Hide tools')
                : (t('profile.access.mcpShowTools') || 'Show tools')}
            <//>
            <${Action} small row disabled=${busy === s.id} onClick=${() => toggle(s)}>
              ${s.enabled ? (t('profile.access.mcpSwitchOff') || 'Switch off') : (t('profile.access.mcpSwitchOn') || 'Switch on')}
            <//>
            <${Action} small row tone="danger" onClick=${() => remove(s)}>
              ${t('profile.access.mcpRemove') || 'Remove server'}
            <//>
          <//>
        <//>
      `)}
    <//>

    <${Actions}>
      <${Action} small expanded=${addOpen} onClick=${() => setAddOpen(!addOpen)}>
        ${addOpen ? (t('profile.access.mcpCancel') || 'Cancel') : (t('profile.access.mcpAdd') || 'Attach a server')}
      <//>
    <//>

    ${addOpen && html`
      <${Fields}>
        <${TextField} placeholder=${t('profile.access.mcpName') || 'Short name, e.g. jira'}
          ariaLabel=${t('profile.access.mcpName') || 'Short name, e.g. jira'}
          value=${draft.name} onInput=${v => setDraft({ ...draft, name: v })} />
        <${TextField} placeholder=${t('profile.access.mcpUrl') || 'Address (https)'}
          ariaLabel=${t('profile.access.mcpUrl') || 'Address (https)'}
          value=${draft.url} onInput=${v => setDraft({ ...draft, url: v })} />
        <${TextField} placeholder=${t('profile.access.mcpTitleField') || 'What to call it (optional)'}
          ariaLabel=${t('profile.access.mcpTitleField') || 'What to call it (optional)'}
          value=${draft.title} onInput=${v => setDraft({ ...draft, title: v })} />
        <${Select} fit value=${draft.auth} onChange=${v => setDraft({ ...draft, auth: v })}
          options=${[['token', t('profile.access.mcpAuthToken') || 'It gave me a token'], ['oauth', t('profile.access.mcpAuthOauth') || 'I sign in to it']]} />
        ${draft.auth === 'token' && html`
          <${TextField} type="password" autoComplete="off"
            placeholder=${t('profile.access.mcpToken') || 'Token, if it needs one'}
            ariaLabel=${t('profile.access.mcpToken') || 'Token, if it needs one'}
            value=${draft.token} onInput=${v => setDraft({ ...draft, token: v })} />
          <${TextField} placeholder=${t('profile.access.mcpHeader') || 'Header for the token (optional)'}
            ariaLabel=${t('profile.access.mcpHeader') || 'Header for the token (optional)'}
            value=${draft.header} onInput=${v => setDraft({ ...draft, header: v })} />
        `}
        <${Note}>${t('profile.access.mcpAddNote')
          || 'The address is checked before anything is saved, so a wrong address or token is reported now. The token is encrypted here and never shown again.'}<//>
        <${FormActions}>
          <${Loud} control disabled=${busy === 'attach'} onClick=${attach}>
            ${busy === 'attach'
              ? (t('profile.access.mcpChecking') || 'Checking the server…')
              : (t('profile.access.mcpAttach') || 'Attach')}
          <//>
        <//>
      <//>
    `}
  `;
}
