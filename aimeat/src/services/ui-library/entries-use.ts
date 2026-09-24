/**
 * @file src/services/ui-library/entries-use.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person does with each part, in the fixed words of 08-component-rules.md (types.ts
 *   UiUse): view, edit, list, pick, compare, status, navigate, converse, act, copy, explain, count,
 *   search, notify, wait, layout, open, confirm. A view asks "what does the person do with this data"
 *   and filters the catalogue by these words; `useFor` beside each entry says it in a sentence.
 *   `pnpm check:ui-library` refuses an entry with no word or a word outside the list.
 * @structure USE_OF — { [entryId]: UiUse[] }
 * @usage import { USE_OF } from './entries-use.js';
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (Jouni's audit: "use" is a fixed word list).
 */
import type { UiUse } from './types.js';

export const USE_OF: Record<string, UiUse[]> = {
    // The setup path
    'step-card': ['layout', 'explain'], 'prompt-card': ['copy', 'act'], 'paste-box': ['edit'], 'koti-paste': ['edit'],
    'text-input': ['edit'], 'koti-agent-name': ['edit'], 'named-value': ['view', 'edit'], 'mode-tabs': ['pick'],
    'step-list': ['explain'], 'waiting-note': ['wait', 'explain'], 'front-door': ['navigate', 'act'],
    // Page parts
    'page-frame': ['layout'], 'page-intro': ['explain'], 'error-note': ['status', 'explain'], 'action-row': ['layout', 'act'],
    hint: ['explain'], masthead: ['view', 'navigate'], 'link-line': ['navigate'], 'stat-line': ['count', 'status'],
    band: ['layout'], 'line-list': ['list', 'navigate'], 'named-row': ['layout', 'view'], 'thing-link': ['navigate', 'count'],
    'star-toggle': ['pick'], 'fold-button': ['open', 'pick'], 'mode-switch': ['pick'], 'quiet-note': ['explain'],
    'numbered-index': ['list', 'open'], 'ink-foot': ['explain', 'navigate'], 'check-item': ['status', 'list'],
    timeline: ['list', 'view'], 'back-link': ['navigate'], 'day-group': ['list'], archive: ['list', 'open'],
    'settings-stack': ['layout', 'edit'], 'settings-switch': ['edit'], 'swatch-picker': ['pick'], 'settings-door': ['navigate'],
    'open-items': ['list', 'act'], chooser: ['pick', 'act'], 'settings-account': ['view', 'edit'], 'free-text': ['edit'],
    specimen: ['view', 'compare'],
    // The conversation
    'conversation-frame': ['layout', 'converse'], 'thread-list': ['list', 'navigate'], 'agent-status': ['status'],
    'rail-action': ['act'], suggestion: ['converse', 'act'], turn: ['converse', 'view'], 'result-card': ['view', 'open'],
    'work-log': ['list', 'status'], 'ai-notice': ['explain'], nudge: ['notify', 'act'], credit: ['explain'], composer: ['converse', 'edit'],
    // The older shared parts
    'card-menu': ['act'], markdown: ['view'], 'ai-label': ['explain', 'status'], 'voice-recorder': ['converse', 'act'],
    'image-deliverable': ['view'], 'install-cta': ['notify', 'act'], 'managed-env': ['explain'], 'mcp-install': ['copy', 'explain'],
    'hello-mcp': ['explain', 'act'], 'contact-picker': ['pick', 'search'], tags: ['pick', 'list'], 'app-sandbox': ['view', 'open'],
    'own-aimeat': ['explain', 'navigate'],
    // The shell and the parts catalogued on 2026-09-24
    'page-base': ['layout'], 'top-bar': ['navigate', 'notify'], button: ['act'], 'copy-button': ['copy'], card: ['layout', 'view'],
    badge: ['status'], pill: ['status'], seg: ['pick'], 'start-page': ['pick', 'edit'], 'status-dot': ['status'],
    'presence-dot': ['status'], 'key-value-row': ['view'], pagination: ['navigate'], collapsible: ['open'],
    'data-table': ['list', 'compare'], 'usage-chart': ['view', 'compare', 'count'], divider: ['layout'], 'form-field': ['edit'],
    'search-bar': ['search'], spinner: ['wait'], 'empty-state': ['explain', 'act'], 'text-utility': ['explain'],
    'toggle-switch': ['edit'], 'site-footer': ['navigate'], alert: ['status', 'notify'], toast: ['notify'],
    'section-header': ['explain'], dialog: ['confirm', 'edit'], 'margin-pattern': ['layout'], 'notification-bell': ['notify', 'act'],
    'open-items-button': ['count', 'navigate'], 'agent-consent': ['confirm'], 'contact-card': ['explain', 'navigate'],
    'display-prefs-fields': ['edit'], 'inbox-link': ['navigate'], 'json-view': ['view'], 'link-preview': ['view', 'open'],
    'memory-embed': ['view'], mermaid: ['view'], 'offer-card-view': ['view', 'explain'],
    // The shapes of poster.css
    'page-title': ['explain'], section: ['layout'], panel: ['layout'], row: ['layout', 'list'], label: ['explain'],
    action: ['act', 'navigate', 'pick'], slab: ['act'], icon: ['act'], 'menu-row': ['pick', 'act'], box: ['view'], frame: ['view'], record: ['view', 'open'], choice: ['pick'],
    sticker: ['status', 'navigate'], aside: ['explain', 'notify'], chip: ['status'], crumb: ['navigate'], count: ['count', 'status'],
    time: ['view'], stat: ['count', 'navigate'], 'showroom-band': ['layout'], 'showroom-section': ['layout'],
    'showroom-door': ['navigate'], 'showroom-slab': ['act'],
};
