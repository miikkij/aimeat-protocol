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
 *   v1.69.0 — 2026-09-26 — The Check line: edit, pick (Jouni's decision "Check line").
 *   v1.68.0 — 2026-09-26 — The Sub-heading: explain (Jouni's decision "Sub-heading").
 *   v1.67.0 — 2026-09-26 — The Job prompt: view (Jouni's decision "Box").
 *   v1.66.0 — 2026-09-26 — A workspace's app launch cards are the library's App cards (css/components/app-cards.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.65.0 — 2026-09-26 — The People panel's list is the library's People list (css/components/people-list.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.64.0 — 2026-09-26 — A record's row (.pj-rec) is the library's Record row (css/components/record-row.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.63.0 — 2026-09-26 — The Key (css/components/key-name.css), a unification: the look most tabs use.
 *   v1.62.0 — 2026-09-26 — The comments on a workspace record or document (.pj-comment*) are the library's Comments (css/components/comments.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.61.0 — 2026-09-26 — The organism row (.pj-org-row and its parts) is the library's Organism row (css/components/org-row.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.60.0 — 2026-09-26 — The steps of a note's sorting (.pf-nb-steps, .pf-nb-step) are the library's Progress steps (css/components/progress-steps.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.59.0 — 2026-09-26 — An organism's development timeline (.pj-timeline-*) is the library's Organism timeline (css/components/org-timeline.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.58.0 — 2026-09-26 — The password's requirements (.pf-pw-rules) are the library's Requirement list (css/components/requirement-list.css), moved unchanged (UI consolidation phase 5, a move).
 *   v1.57.0 — 2026-09-26 — The figures that open their tab (.pf-usage-chip*) are the library's Figure door (css/components/figure-door.css), moved unchanged (UI consolidation phase 5, a move).
 *   v1.56.0 — 2026-09-26 — The Drag grip, moved out of the agent page's sheet (a move).
 *   v1.55.0 — 2026-09-25 — The signed-out door (.pf-door-*), its sheet moved unchanged from views/profile-door.css to css/components/signed-out-door.css (UI consolidation phase 5, a move).
 *   v1.54.0 — 2026-09-25 — The ecosystem automation (its flow, status timeline and run log: .pf-eco-auto-*, .pf-eco-recipe-head), moved unchanged out of views/profile.css into css/components/eco-automation.css (UI consolidation phase 5, a move).
 *   v1.53.0 — 2026-09-25 — The schedule calendar (the scheduler's month, week and day, .sch-cal-*), moved unchanged out of views/scheduler.css into css/components/schedule-calendar.css (UI consolidation phase 5, a move).
 *   v1.52.0 — 2026-09-25 — An organism search hit is the library's Search hits (css/components/search-hits.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.51.0 — 2026-09-25 — The People panel's agent chip is the library's Agent chip (css/components/agent-chip.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.50.0 — 2026-09-25 — The devices signed in are the library's Device list (css/components/device-list.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.49.0 — 2026-09-25 — Discover's question desk is the library's Question desk (css/components/question-desk.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.48.0 — 2026-09-25 — The ways to do one thing are the library's How roads (css/components/how-roads.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.47.0 — 2026-09-25 — The inbox rows are the library's Notification feed (css/components/notification-feed.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.46.0 — 2026-09-25 — The morsel flow is the library's Morsel flow (css/components/morsel-flow.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.45.0 — 2026-09-25 — A field and its button in a dashed row are the library's Field row (css/components/field-row.css), moved unchanged under one name (UI consolidation phase 5, a move).
 *   v1.44.0 — 2026-09-25 — The preview of a pasted package is the library's Package preview (css/components/package-preview.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.43.0 — 2026-09-25 — A package's entries are the library's Knowledge entry (css/components/knowledge-entry.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.42.0 — 2026-09-25 — A board's notices are the library's Board notices (css/components/board-notices.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.41.0 — 2026-09-25 — A workflow's steps are the library's Workflow steps (css/components/workflow-steps.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.40.0 — 2026-09-25 — The jobs that run all the time are the library's Job chips (css/components/job-chips.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.39.0 — 2026-09-25 — The week's rhythm is the library's Week rhythm (css/components/week-rhythm.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.38.0 — 2026-09-25 — What the AI found for a need is the library's Offer hits (css/components/offer-hits.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.37.0 — 2026-09-25 — Rating a delivery is the library's Rating stars (css/components/rating-stars.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.36.0 — 2026-09-25 — The request on an offer's page is the library's Offer request (css/components/offer-request.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.35.0 — 2026-09-25 — The map of offers is the library's Offer map (css/components/offer-map.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.34.0 — 2026-09-25 — The production lines are the library's Offer lines (css/components/offer-lines.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.33.0 — 2026-09-25 — The score chart is the library's Score chart (css/components/score-chart.css), moved unchanged with its class names (UI consolidation phase 5, a move).
 *   v1.32.0 — 2026-09-25 — A prompt's versions and its two editors are the library's Prompt versions (css/components/prompt-versions.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.31.0 — 2026-09-25 — The opened run's parts are the library's Calibration run (css/components/calibration-run.css), moved unchanged with their class names (UI consolidation phase 5, a move).
 *   v1.30.0 — 2026-09-25 — The model picker is the library's Model picker (css/components/model-picker.css), moved unchanged out of ai-poster.css and calibrator-poster.css (UI consolidation phase 5, a move).
 *   v1.29.0 — 2026-09-25 — The loading line's blinking mark is the library's Loading mark (css/components/loading-mark.css), moved unchanged out of five sheets (UI consolidation phase 5, a move).
 *   v1.28.0 — 2026-09-25 — GaiiChip's uses.
 *   v1.27.0 — 2026-09-25 — TaskDag's uses.
 *   v1.26.0 — 2026-09-25 — The To-do list's uses.
 *   v1.25.0 — 2026-09-25 — The tag input's uses.
 *   v1.24.0 — 2026-09-25 — The file drop's uses.
 *   v1.23.0 — 2026-09-25 — The file preview's uses.
 *   v1.22.0 — 2026-09-25 — The document tree's uses.
 *   v1.21.0 — 2026-09-25 — The colour tag's uses.
 *   v1.20.0 — 2026-09-25 — The heatmap's uses.
 *   v1.19.0 — 2026-09-25 — The More line's uses.
 *   v1.18.0 — 2026-09-25 — The Loading mark's uses.
 *   v1.17.0 — 2026-09-25 — The Address preview's uses.
 *   v1.16.0 — 2026-09-25 — The Access log's uses.
 *   v1.15.0 — 2026-09-25 — The Item grid's uses.
 *   v1.14.0 — 2026-09-25 — The App picker's uses.
 *   v1.13.0 — 2026-09-25 — The Delegation lines' uses.
 *   v1.12.0 — 2026-09-25 — The Sent log's uses.
 *   v1.11.0 — 2026-09-25 — The Uses list's uses.
 *   v1.10.0 — 2026-09-25 — The Tier list's uses.
 *   v1.9.0 — 2026-09-25 — The Changelog's uses.
 *   v1.8.0 — 2026-09-25 — The Proof ledger's uses.
 *   v1.7.0 — 2026-09-25 — The Page row's uses.
 *   v1.6.0 — 2026-09-25 — The Select field's uses.
 *   v1.5.0 — 2026-09-25 — The Switch's uses.
 *   v1.4.0 — 2026-09-25 — Facts, listing, search line, code block and form message: the looks most Settings tabs draw, unused until the tabs move.
 *   v1.3.0 — 2026-09-25 — The Status's uses.
 *   v1.2.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.1.0 — 2026-09-25 — The parts of Settings & Controls: settings-frame, side-menu (UI consolidation phase 5).
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
    // Settings & Controls (phase 5)
    'settings-frame': ['layout', 'navigate'], 'side-menu': ['navigate', 'count'],
    'tab-page': ['layout', 'navigate'], 'crumb-trail': ['navigate'], 'page-head': ['explain', 'act'], 'figure-strip': ['count'],
    'page-section': ['layout'], 'fold-row': ['list', 'open'], 'setting-box': ['edit', 'confirm'], 'form-fields': ['edit'],
    'space-table': ['list', 'open'], facts: ['view'], listing: ['list', 'open', 'act'], 'search-line': ['search'],
    'code-block': ['view', 'copy'], 'form-message': ['status', 'notify'], switch: ['edit', 'status'], 'select-field': ['pick', 'edit'],
    'page-row': ['view', 'open'], 'proof-ledger': ['list', 'status'], changelog: ['list'], 'tier-list': ['explain'], 'uses-list': ['explain', 'status'], 'sent-log': ['list', 'status'], 'delegation-lines': ['list', 'act'], 'app-picker': ['pick'], 'item-grid': ['view', 'count'], 'access-log': ['list', 'status'], 'address-preview': ['status', 'explain'], 'loading-mark': ['wait'], 'more-line': ['navigate', 'count'],
    heatmap: ['view', 'compare'], 'colour-tag': ['pick', 'status'], 'doc-tree': ['navigate', 'list'], 'file-preview': ['view', 'open'], 'file-drop': ['pick', 'edit'], 'tag-input': ['edit'],
    'todo-list': ['list', 'status'], 'crew-dag': ['view', 'explain'], 'gaii-chip': ['copy', 'view'], 'drag-grip': ['act', 'list'],
    'model-picker': ['pick', 'search'],
    'schedule-calendar': ['view', 'navigate'],
    'eco-automation': ['edit', 'status'],
    'signed-out-door': ['navigate', 'explain'],
    'figure-door': ['count', 'navigate'],
    'requirement-list': ['status', 'explain'],
    'org-timeline': ['view', 'list', 'pick'],
    'progress-steps': ['wait', 'status'],
    'org-row': ['list', 'open', 'act'],
    comments: ['list', 'edit'],
    'key-name': ['view'],
    'record-row': ['list', 'open', 'edit'],
    'people-list': ['list', 'view'],
    'app-cards': ['open', 'list'],
    'calibration-run': ['view', 'compare'], 'prompt-versions': ['list', 'edit'],
    'score-chart': ['view', 'compare'],
    'offer-lines': ['list', 'status'],
    'offer-map': ['list', 'navigate'],
    'offer-request': ['act', 'status'],
    'rating-stars': ['edit', 'pick'],
    'offer-hits': ['search', 'list'],
    'week-rhythm': ['view', 'list'],
    'job-chips': ['list', 'navigate'],
    'workflow-steps': ['list', 'status'],
    'board-notices': ['list', 'view'],
    'knowledge-entry': ['view', 'open'],
    'package-preview': ['view', 'confirm'],
    'field-row': ['edit', 'act'],
    'job-prompt': ['view'],
    'sub-heading': ['explain'],
    'check-line': ['edit', 'pick'],
    'morsel-flow': ['count', 'view'],
    'notification-feed': ['list', 'notify'],
    'how-roads': ['explain', 'navigate'],
    'question-desk': ['search', 'pick'],
    'device-list': ['list', 'status'],
    'agent-chip': ['list', 'status'],
    'search-hits': ['search', 'list', 'open'],
    // The shapes of poster.css
    'page-title': ['explain'], section: ['layout'], panel: ['layout'], row: ['layout', 'list'], label: ['explain'],
    action: ['act', 'navigate', 'pick'], slab: ['act'], icon: ['act'], 'menu-row': ['pick', 'act'], box: ['view'], frame: ['view'], record: ['view', 'open'], choice: ['pick'],
    sticker: ['status', 'navigate'], aside: ['explain', 'notify'], chip: ['status'], status: ['status'], crumb: ['navigate'], count: ['count', 'status'],
    time: ['view'], stat: ['count', 'navigate'], 'showroom-band': ['layout'], 'showroom-section': ['layout'],
    'showroom-door': ['navigate'], 'showroom-slab': ['act'],
};
