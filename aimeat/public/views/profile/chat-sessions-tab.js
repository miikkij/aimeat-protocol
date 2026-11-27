/**
 * @file chat-sessions-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for managing AI chat sessions connected via agents.
 *   Shows active sessions, allows creating new ones via prompt copy, and
 *   removing existing sessions. The page's start (PageStart: what the page shows, the prompt
 *   that connects the person's AI over MCP with this server's address) and the title's question
 *   mark (concept.connect). How the page explains itself: .claude/rules/page-guidance.md.
 * @version-history
 *   v1.19.0 -- 2026-11-27 -- The tools' list has a head row; a row's end says "Open" or "Close" with
 *     the chevron (List RowOpen) instead of the ▼ ▶ letter alone.
 *   v1.18.0 -- 2026-11-26 -- The page leads with where things stand: a figure strip (how many tools,
 *     when one was last here, how many nobody has used in 30 days), then the tools as section 01 and
 *     how to add one as section 02, with the contents rail. The create card stood above the list.
 *   v1.17.0 -- 2026-11-08 -- The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart and the title's question mark concept.connect; the head's paragraph is two sentences.
 *   v1.16.1 -- 2026-09-28 -- No escHtml() on text preact renders: preact escapes text and attributes itself, so names with a quote or an ampersand showed as &quot; / &amp;.
 *   v1.16.0 -- 2026-09-26 -- Every part is a component that takes data (page group G5): the head is the SettingsPage, the create card the Card's section tone, the sessions the List whose row opens its panel (the Facts, the copy and the remove at its foot), the copy the Action's copy; it writes no class.
 *   v1.15.0 -- 2026-09-26 -- A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.14.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.13.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.12.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- The older tabs' remaining help lines are the Hint (.poster-hint); their own sizes and greys go, a place keeps its margin (a unification: the look most tabs use).
 *   v1.10.0 -- 2026-09-25 -- A list drawn as classic cards is the Listing (css/components/listing.css), a row that opens shows the Listing's open panel; the card, its header, arrow and detail rules go (a unification: the look most tabs use).
 *   v1.9.0 -- 2026-09-25 -- An opened session's details are the Facts (css/components/facts.css), a unification: the look most tabs use; the GAII is inline code.
 *   v1.8.0 -- 2026-09-25 -- The crumb is the full trail (Settings & Controls / the menu group / the tab), as in the kit tabs (a unification).
 *   v1.7.0 -- 2026-09-25 -- A section is the kit's section (PageSection in an .og page) and the line under its title is the lead (.og-lead), the look most tabs use (a unification).
 *   v1.6.0 -- 2026-09-25 -- The page head is the kit's crumb trail and page head (.og-crumb, .og-mast, .og-title, .og-desc), the look most tabs use (a unification).
 *   v1.5.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 — 2026-09-25 — A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.1.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   2026-09-13 — V1: compose page and B1 section headings from the shared poster classes.
 *   v1.0.0 — 2026-03-16 — Initial chat sessions tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes; fix fallback strings
 *   v1.2.0 — 2026-06-02 — Component unification (#1): "Copy GAII" uses canonical
 *     <CopyButton> (toast preserved); prompt-copy routed through shared copyToClipboard
 *     (insecure-context fallback) instead of raw navigator.clipboard.
 *   v1.3.0 — 2026-08-31 — The list is the owner's WORKSTATION agents, through the shared
 *     listChatSessions selector. It filtered on a `session-` name prefix here, which no MCP client
 *     uses, so the tab meant for Claude Code and Claude Desktop showed none of them and they read as
 *     ordinary autonomous agents everywhere else. The group says what these are: you start them.
 *   v1.4.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo, copyToClipboard } from '/js/utils.js';
import { LoadingLine } from './shared.js';
import { PageSection } from '/components/PageSection.js';
import { useConfirm } from '/components/Modal.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row as ListRow, Name, Desc, Doors, RowOpen } from '/components/List.js';
import { Facts } from '/components/Facts.js';
import { Action, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Row } from '/components/Layout.js';
import { listChatSessions, deleteAgent } from '/js/services/agents.js';
import { getNodeUrl } from '/js/services/auth.js';
import { PageStart } from '/components/PageStart.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { dateTime as fmtDateTime } from '/js/format.js';

/** A tool nobody has used for this long is counted as one the person may remove. */
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

export default function ChatSessionsTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [chatSessions, setChatSessions] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [copying, setCopying] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const sessions = await listChatSessions(session.owner);
      setChatSessions(sessions);
      onStats?.({ chatSessions: sessions.length });
    } catch (err) { swallowed('chat-sessions-tab', err); setChatSessions([]); }
  }, [session?.owner, onStats]);

  useEffect(() => {
    if (session) loadData();
  }, [session, loadData]);

  // Live update listener
  const loadRef = useRef(loadData);
  loadRef.current = loadData;
  useEffect(() => onLiveUpdate(['agents'], () => loadRef.current()), []);

  const handleDelete = useCallback(async (s) => {
    confirm(t('profile.chatSessions.confirmDelete'), async () => {
      setDeleting(s.name);
      try {
        await deleteAgent(s.name);
        showToast(t('profile.chatSessions.deleted'));
        setExpanded(null);
        loadData();
      } catch (err) {
        swallowed('chat-sessions-tab: ChatSessionsTab', err);
        showToast(t('profile.chatSessions.deleteError'));
      } finally { setDeleting(null); }
    }, { danger: true });
  }, [confirm, showToast, loadData]);

  const toggleExpand = useCallback((name) => {
    setExpanded(prev => prev === name ? null : name);
  }, []);

  const copyPrompt = useCallback(async (type) => {
    setCopying(type);
    try {
      const endpoint = type === 'quick'
        ? '/v1/templates/chat-session-quick'
        : '/v1/templates/chat-session-human';
      const resp = await apiGet(endpoint);
      const text = resp?.data?.prompt;
      if (text) {
        await copyToClipboard(text);
        showToast(t('profile.chatSessions.promptCopied'));
      } else {
        showToast(t('profile.chatSessions.promptError'));
      }
    } catch (err) {
      swallowed('chat-sessions-tab: ChatSessionsTab', err);
      showToast(t('profile.chatSessions.promptError'));
    } finally { setCopying(null); }
  }, [showToast]);

  if (!chatSessions) return html`<${LoadingLine} text=${t('profile.chatSessions.loading')} />`;
  const x = (key) => t('profile.chatSessions.' + key);
  // The figures under the head: how many tools there are, when one was last here, and how many
  // nobody has used in 30 days (the ones a person may remove).
  const seen = chatSessions.filter(s => s.last_seen).sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen)));
  const stale = chatSessions.filter(s => !s.last_seen || Date.now() - new Date(s.last_seen).getTime() > STALE_MS).length;
  const strip = [
    { key: 'n', n: chatSessions.length, label: x('stripSessions'), sub: x('stripSessionsSub') },
    { key: 'seen', n: seen.length ? timeAgo(seen[0].last_seen) : x('stripSeenNone'), tone: seen.length ? 'coral' : 'dim',
      label: x('stripSeen'), sub: seen.length ? (seen[0].display_name || seen[0].name) : undefined },
    { key: 'stale', n: stale, tone: stale ? 'notice' : undefined, label: x('stripStale'), sub: stale ? x('stripStaleSub') : undefined },
  ];
  return html`
    <${SettingsPage} name="chatsessions" crumb=${[t('nav.profile'), t('profile.landing.menuActivity'), t('profile.tabs.chatSessions')]}
      title=${t('profile.chatSessions.title')} help="concept.connect" desc=${t('profile.chatSessions.desc')}
      strip=${html`<${FigureStrip} wrap items=${strip} />`}
      start=${html`<${PageStart} id="chatsessions" vars=${{ url: getNodeUrl() + '/v1/mcp' }} done=${chatSessions.length > 0} />`}
      railTitle=${t('profile.landing.railTitle')}
      sections=${[
        { id: 'cs-list', num: '01', label: x('startedByYou'), count: chatSessions.length },
        { id: 'cs-create', num: '02', label: x('createTitle') },
      ]}
      after=${html`<${ConfirmUI} />`}>

    ${/* The tools the person has come first: they are what the page is opened for. How to add one
          follows, as the second section. */''}
    <${PageSection} id="cs-list" num="01" title=${x('startedByYou')} count=${chatSessions.length}>
    <${Note} kind="lead">${x('startedByYouDesc')}<//>
    ${chatSessions.length === 0
      ? html`<${Note} kind="quiet">${t('profile.chatSessions.empty')}<//>`
      : html`
        <${List} cols="name-desc-doors" head=${[x('colTool'), x('colSeen'), x('colName')]}>
        ${chatSessions.map(s => {
          const isExpanded = expanded === s.name;
          return html`
            <${ListRow} key=${s.name} open=${isExpanded} onToggle=${() => toggleExpand(s.name)}
              panel=${html`
                  <${Facts} rows=${[
                    { k: 'GAII', v: s.gaii || '-', mono: true },
                    s.description && { k: t('profile.chatSessions.description'), v: s.description },
                    { k: t('profile.chatSessions.trust'), v: s.trust_score ?? '-' },
                    { k: t('profile.chatSessions.balance'), v: `${s.morsel_balance ?? '-'} morsels` },
                    s.roles && { k: t('profile.chatSessions.roles'), v: (s.roles || []).join(', ') },
                    s.created_at && { k: t('profile.chatSessions.created'), v: fmtDateTime(s.created_at) },
                  ]} />`}
              panelDoors=${html`
                    <${Action} small copy=${s.gaii || s.name} onCopied=${() => showToast('GAII copied')}>${t('profile.agents.copyGaii')}<//>
                    <${Action} small tone="danger" onClick=${(e) => { e.stopPropagation(); handleDelete(s); }}
                      disabled=${deleting === s.name}>
                      ${deleting === s.name ? '...' : t('profile.chatSessions.remove')}
                    <//>`}>
              <${Name}>${s.display_name || s.name || '-'}<//>
              <${Desc}>${t('profile.chatSessions.lastSeen')}: ${s.last_seen ? timeAgo(s.last_seen) : '-'}<//>
              <${Doors}><${Mark}>${s.name || ''}<//><${RowOpen} open=${isExpanded} /><//>
            <//>
          `;
        })}
        <//>
      `
    }
    <//>

    <${PageSection} id="cs-create" num="02" title=${x('createTitle')}>
      <${Note}>${x('createDesc')}<//>
      <${Row} wrap below="small">
        <${Loud} control onClick=${() => copyPrompt('quick')}
          disabled=${copying === 'quick'}>
          ${copying === 'quick' ? '...' : x('copyQuickPrompt')}
        <//>
        <${Action} small onClick=${() => copyPrompt('detailed')}
          disabled=${copying === 'detailed'}>
          ${copying === 'detailed' ? '...' : x('copyDetailedPrompt')}
        <//>
      <//>
      <${Note}>${x('createHint')}<//>
    <//>
    <//>`;
}
