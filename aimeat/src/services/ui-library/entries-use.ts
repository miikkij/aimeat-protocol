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
 *   v1.72.0 — 2026-09-30 — NodeUpdateNotice: notify, explain, copy.
 *   v1.71.0 — 2026-09-27 — The catalogue family's words (appcat): IndexFrame, Overlay, Stops, SlotBars, WorldMap and
 *     its model, DataMap, DayWindow, the List's tones and the Modal's options; the data table picks (compact), the
 *     empty state waits (loading), the crumb trail's sheet holds Action's dashed, inline and file doors (act), and a step card's question
 *     holds a form's fields (edit).
 *   v1.70.2 — 2026-09-27 — The instruction block's entry id is instruction-block (formerly hello-mcp).
 *   v1.70.1 — 2026-09-27 — The list and conversation family's words: List, Message, MessageComposer, MessageFile,
 *     MessageQuestions, ConversationList, ConversationPane.
 *   v1.70.0 — 2026-09-27 — Settings & Controls on components: the kit's parts and the special views get their words;
 *     the parts no page draws any more go (page row, tier list, uses list, sent log, delegation lines, app
 *     picker, item grid, access log, heatmap, to-do list, crew DAG, drag grip, figure door, requirement list,
 *     organism timeline, organism row, comments, record row, people list, app cards, calibration run, prompt
 *     versions, offer lines, offer hits, package preview, notification feed, how roads, device list, agent chip,
 *     search hits); the box and choice shapes are box-shape and choice-shape.
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
    'step-card': ['layout', 'explain', 'edit'], 'prompt-card': ['copy', 'act'], 'paste-box': ['edit'], 'koti-paste': ['edit'],
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
    'instruction-block': ['explain', 'copy'], 'contact-picker': ['pick', 'search'], tags: ['pick', 'list'], 'app-sandbox': ['view', 'open'],
    'own-aimeat': ['explain', 'navigate'],
    // The shell and the parts catalogued on 2026-09-24
    'page-base': ['layout'], 'top-bar': ['navigate', 'notify'], button: ['act'], 'copy-button': ['copy'], card: ['layout', 'view'],
    badge: ['status'], pill: ['status'], seg: ['pick'], 'start-page': ['pick', 'edit'], 'status-dot': ['status'],
    'presence-dot': ['status'], 'key-value-row': ['view'], pagination: ['navigate'], collapsible: ['open'],
    'data-table': ['list', 'compare', 'pick'], 'usage-chart': ['view', 'compare', 'count'], divider: ['layout'], 'form-field': ['edit'],
    'search-bar': ['search'], spinner: ['wait'], 'empty-state': ['explain', 'act', 'wait'], 'text-utility': ['explain'],
    'toggle-switch': ['edit'], 'site-footer': ['navigate'], alert: ['status', 'notify'], toast: ['notify'],
    'section-header': ['explain'], dialog: ['confirm', 'edit'], 'margin-pattern': ['layout'], 'notification-bell': ['notify', 'act'],
    'open-items-button': ['count', 'navigate'], 'node-update-notice': ['notify', 'explain', 'copy'], 'agent-consent': ['confirm'], 'contact-card': ['explain', 'navigate'],
    'display-prefs-fields': ['edit'], 'inbox-link': ['navigate'], 'json-view': ['view'], 'link-preview': ['view', 'open'],
    'memory-embed': ['view'], mermaid: ['view'], 'offer-card-view': ['view', 'explain'],
    // Settings & Controls (phase 5)
    'settings-frame': ['layout', 'navigate'], 'side-menu': ['navigate', 'count'],
    'tab-page': ['layout', 'navigate'], 'crumb-trail': ['navigate', 'act'], 'page-head': ['explain', 'act'], 'figure-strip': ['count'],
    'page-section': ['layout'], 'fold-row': ['open', 'layout'], 'setting-box': ['edit', 'confirm'], 'form-fields': ['edit'],
    'space-table': ['list', 'open'], facts: ['view'], listing: ['list', 'open', 'act'], 'search-line': ['search'],
    'code-block': ['view', 'copy'], 'form-message': ['status', 'notify'], switch: ['edit', 'status'], 'select-field': ['pick', 'edit'],
    'proof-ledger': ['list', 'status'], changelog: ['list'], 'address-preview': ['status', 'explain'], 'loading-mark': ['wait'], 'more-line': ['navigate', 'count'],
    'colour-tag': ['pick', 'status'], 'doc-tree': ['navigate', 'list'], 'file-preview': ['view', 'open'], 'file-drop': ['pick', 'edit'], 'tag-input': ['edit'],
    'gaii-chip': ['copy', 'view'],
    'model-picker': ['pick', 'search'],
    'schedule-calendar': ['view', 'navigate'],
    'eco-automation': ['edit', 'status'],
    'signed-out-door': ['navigate', 'explain'],
    'progress-steps': ['wait', 'status'],
    'key-name': ['view'],
    'score-chart': ['view', 'compare'],
    'offer-map': ['list', 'navigate'],
    'offer-request': ['act', 'status'],
    'rating-stars': ['edit', 'pick'],
    'week-rhythm': ['view', 'list'],
    'job-chips': ['list', 'navigate'],
    'workflow-steps': ['list', 'status'],
    'board-notices': ['list', 'view'],
    'knowledge-entry': ['view', 'open'],
    'field-row': ['edit', 'act'],
    'job-prompt': ['view'],
    'sub-heading': ['explain'],
    'check-line': ['edit', 'pick'],
    'morsel-flow': ['count', 'view'],
    'question-desk': ['search', 'pick'],
    // The kit of Settings & Controls on components (2026-09-27): one block per family, each filled by its own hand.
    // KIT (Action, Mark, Note, Box, Avatar, Roads, Figure)
    'action-component': ['act', 'navigate', 'copy'], mark: ['status', 'explain', 'count'],
    note: ['explain', 'status', 'wait', 'notify'], box: ['view', 'layout', 'confirm'], avatar: ['view'],
    roads: ['pick', 'act', 'copy'], figure: ['count', 'status'],
    // FIELDS (Field, TextField, Choice)
    field: ['edit', 'layout'], 'text-field': ['edit', 'search'], choice: ['pick', 'edit'],
    // PAGE KIT (SettingsPage, Section, Folds, Tabs, Layout, ContentsTree)
    'settings-page': ['layout', 'navigate'], 'section-component': ['layout', 'open'], folds: ['list', 'open'],
    'tab-row': ['pick', 'navigate'], layout: ['layout'], 'contents-tree': ['navigate', 'count'],
    // LIST AND CONVERSATION (List, Message, MessageComposer, MessageFile, MessageQuestions, ConversationList)
    list: ['list', 'open', 'pick', 'search', 'act', 'count'], message: ['converse', 'view', 'copy'],
    'message-composer': ['converse', 'edit'], 'message-file': ['view', 'open'], 'message-questions': ['pick', 'converse'],
    'conversation-list': ['list', 'navigate', 'pick'], 'conversation-pane': ['layout', 'converse', 'navigate'],
    // KNOWLEDGE VIEWS (organisms, documents, account)
    'activity-calendar': ['view', 'count'], people: ['list', 'view'], 'snapshot-timeline': ['compare', 'pick', 'view'],
    'mind-map': ['view', 'navigate'], 'doc-view': ['view', 'edit'], 'qr-code': ['view'], 'code-grid': ['view', 'copy'],
    'stored-value': ['view'], 'page-preview': ['view', 'wait'], 'number-band': ['count', 'navigate'],
    'open-card': ['open', 'view', 'navigate'], 'how-to': ['explain'], 'setup-guide': ['explain', 'pick', 'copy'],
    // WORK VIEWS (automation, offers, calibrator)
    'task-graph': ['view', 'status'], 'series-bars': ['view', 'compare', 'count'], peek: ['view', 'open'],
    'plan-steps': ['list', 'act', 'pick'], 'run-view': ['view', 'compare', 'open', 'act'], 'step-strip': ['status', 'navigate'],
    // OPERATOR (the admin pages and the small inner pages)
    readings: ['status', 'count', 'view'], 'operator-menu': ['navigate', 'count'], 'operator-frame': ['layout', 'navigate', 'wait'],
    'ask-page': ['confirm', 'act'], 'solo-window': ['view', 'layout', 'wait'], 'quick-find': ['search', 'navigate', 'pick'],
    'pick-field': ['pick', 'search', 'edit'], 'status-page-preview': ['view', 'status'], 'search-preview': ['view'],
    'save-bar': ['act', 'status', 'notify'], 'move-buttons': ['act'], 'day-chart': ['count', 'compare', 'view'],
    'trend-line': ['count', 'view'], 'count-bars': ['count', 'compare', 'pick'], 'print-page': ['view', 'layout'],
    'settings-index': ['edit', 'search', 'navigate', 'list'], shots: ['compare', 'view'],
    // CATALOGUE (appcat: the app catalogue on components)
    'index-frame': ['layout', 'navigate'], overlay: ['open', 'layout', 'view'], stops: ['status', 'explain', 'act'],
    'slot-bars': ['count', 'compare', 'view'], 'world-map': ['count', 'compare', 'view', 'pick'], 'world-map-model': ['count'],
    'data-map': ['view', 'explain'], 'day-window': ['pick'], 'list-tones': ['list', 'view'], modal: ['confirm', 'edit'],
    // The shapes of poster.css
    'page-title': ['explain'], section: ['layout'], panel: ['layout'], row: ['layout', 'list'], label: ['explain'],
    action: ['act', 'navigate', 'pick'], slab: ['act'], icon: ['act'], 'menu-row': ['pick', 'act'], 'box-shape': ['view'], frame: ['view'], record: ['view', 'open'], 'choice-shape': ['pick'],
    sticker: ['status', 'navigate'], aside: ['explain', 'notify'], chip: ['status'], status: ['status'], crumb: ['navigate'], count: ['count', 'status'],
    time: ['view'], stat: ['count', 'navigate'], 'showroom-band': ['layout'], 'showroom-section': ['layout'],
    'showroom-door': ['navigate'], 'showroom-slab': ['act'],
};
