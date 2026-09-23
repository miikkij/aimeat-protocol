/**
 * @file chat-sessions-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab for managing AI chat sessions connected via agents.
 *   Shows active sessions, allows creating new ones via prompt copy, and
 *   removing existing sessions.
 * @version-history
 *   2026-09-22 -- Composed from the shared set: Page, two Sections, a session is a ListRow that
 *     opens in place into a record of KeyValue rows; the copy is a CopyAction and removal a danger
 *     action. No class of its own; the triangle glyphs are the row's arrow.
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
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo, copyToClipboard } from '/js/utils.js';
import { Spinner } from './shared.js';
import { Page, Section, Stack, ListRow, KeyValue, Surface, Action, CopyAction, Text } from '/components/poster-parts.js';
import { useConfirm } from '/components/Modal.js';
import { listChatSessions, deleteAgent } from '/js/services/agents.js';
import { apiGet } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { dateTime as fmtDateTime } from '/js/format.js';

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

  if (!chatSessions) return html`<${Spinner} text=${t('profile.chatSessions.loading')} />`;
  return html`<${Page} title=${t('profile.chatSessions.title')}
    crumbs=${[{ label: t('nav.profile') }, { label: t('profile.landing.menuActivity') }, { label: t('profile.chatSessions.title') }]}>
    <${Stack}>
    <${Text} kind="lead" tone="muted">${t('profile.chatSessions.desc')}<//>

    <${Section} title=${t('profile.chatSessions.createTitle')} description=${t('profile.chatSessions.createDesc')} density="compact">
      <${Stack}>
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" onClick=${() => copyPrompt('quick')} disabled=${copying === 'quick'}>
            ${copying === 'quick' ? '...' : t('profile.chatSessions.copyQuickPrompt')}
          <//>
          <${Action} onClick=${() => copyPrompt('detailed')} disabled=${copying === 'detailed'}>
            ${copying === 'detailed' ? '...' : t('profile.chatSessions.copyDetailedPrompt')}
          <//>
        <//>
        <${Text} kind="caption" tone="muted">${t('profile.chatSessions.createHint')}<//>
      <//>
    <//>

    ${chatSessions.length === 0
      ? html`<${Surface} kind="box" tone="muted">${t('profile.chatSessions.empty')}<//>`
      : html`
        <${Section} title=${t('profile.chatSessions.startedByYou')} description=${t('profile.chatSessions.startedByYouDesc')} count=${chatSessions.length} density="compact">
          <${Stack} density="compact">
            ${chatSessions.map(s => {
              const isExpanded = expanded === s.name;
              return html`
                <${ListRow} key=${s.name} selected=${isExpanded} arrow onOpen=${() => toggleExpand(s.name)}
                  name=${escHtml(s.display_name || s.name || '-')} detail=${escHtml(s.name || '')}
                  value=${`${t('profile.chatSessions.lastSeen')}: ${s.last_seen ? timeAgo(s.last_seen) : '-'}`}>
                  ${isExpanded && html`<${Stack}>
                    <${Surface} kind="record" density="compact">
                      <${KeyValue} label="GAII" value=${escHtml(s.gaii || '-')} mono />
                      ${s.description ? html`<${KeyValue} label=${t('profile.chatSessions.description')} value=${escHtml(s.description)} />` : null}
                      <${KeyValue} label=${t('profile.chatSessions.trust')} value=${s.trust_score ?? '-'} />
                      <${KeyValue} label=${t('profile.chatSessions.balance')} value=${`${s.morsel_balance ?? '-'} morsels`} />
                      ${s.roles ? html`<${KeyValue} label=${t('profile.chatSessions.roles')} value=${(s.roles || []).join(', ')} />` : null}
                      ${s.created_at ? html`<${KeyValue} label=${t('profile.chatSessions.created')} value=${fmtDateTime(s.created_at)} />` : null}
                      <${Stack} direction="wrap" align="center">
                        <${CopyAction} text=${s.gaii || s.name} label=${t('profile.agents.copyGaii')} onCopied=${() => showToast('GAII copied')} />
                        <${Action} tone="danger" onClick=${() => handleDelete(s)} disabled=${deleting === s.name}>
                          ${deleting === s.name ? '...' : t('profile.chatSessions.remove')}
                        <//>
                      <//>
                    <//>
                  <//>`}
                <//>
              `;
            })}
          <//>
        <//>
      `
    }
    <//>
    <${ConfirmUI} />
  <//>`;
}
