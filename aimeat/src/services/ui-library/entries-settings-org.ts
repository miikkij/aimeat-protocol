/**
 * @file src/services/ui-library/entries-settings-org.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Catalogue entries for the parts of Settings & Controls that the organism, notebook and
 *   memory pages drew alone and that became library parts by a move (UI consolidation phase 5, wave 4).
 *   Split out of entries-settings.ts, which reached the file-length limit. The purpose half only;
 *   facts.generated.ts carries what the files say.
 * @structure ORG_SETTINGS_ENTRIES
 * @usage import { ORG_SETTINGS_ENTRIES } from './entries-settings-org.js';
 * @version-history
 *   v1.8.0 — 2026-09-26 — The Check line (css/components/check-line.css), Jouni's decision "Check line".
 *   v1.7.0 — 2026-09-26 — The Sub-heading (css/components/sub-heading.css), Jouni's decision "Sub-heading".
 *   v1.6.0 — 2026-09-26 — The Field row, moved here from entries-settings.ts, on the page's ground (Jouni's decision "Dashed field box").
 *   v1.5.0 — 2026-09-26 — The Job prompt (css/components/job-prompt.css): a scheduled job's prompt, one part for the Scheduler and an agent's schedules (Jouni's decision "Box").
 *   v1.4.0 — 2026-09-26 — The App cards (css/components/app-cards.css), a library part by a move.
 *   v1.3.0 — 2026-09-26 — The People list (css/components/people-list.css), a library part by a move.
 *   v1.2.0 — 2026-09-26 — The Record row (css/components/record-row.css), a library part by a move.
 *   v1.1.0 — 2026-09-26 — The Key (css/components/key-name.css): the look most tabs gave a key, a unification.
 *   v1.0.0 — 2026-09-26 — Initial: the Organism timeline, Progress steps, Organism row and Comments, moved here from entries-settings.ts unchanged.
 */
import type { UiEntryWritten } from './types.js';

export const ORG_SETTINGS_ENTRIES: UiEntryWritten[] = [
    {
        id: 'org-timeline', name: 'Organism timeline', kind: 'component', status: 'active',
        summary: 'An organism\'s development timeline: a diagram of its structural snapshots over a hairline, then the snapshots as a list (the date, the event, the counts), each a button with a grey edge, the chosen one on the grey ground with a coral edge, and beside the list the map of the structure at that point; on a narrow screen the map goes under the list.',
        module: null, sheet: '/css/components/org-timeline.css', classes: ['pj-timeline', 'pj-timeline-diagram', 'pj-timeline-grid', 'pj-timeline-list', 'pj-timeline-item', 'pj-timeline-entry', 'pj-timeline-event', 'pj-timeline-counts', 'pj-timeline-map'],
        data: { shape: '<div class="pj-timeline"><div class="pj-timeline-diagram">…</div><div class="pj-timeline-grid"><ul class="pj-timeline-list"><li class="pj-timeline-item is-active"><button class="pj-timeline-entry"><span class="pj-timeline-date poster-time">…</span><span class="pj-timeline-event">…</span><span class="pj-timeline-counts section-desc">…</span></button></li></ul><div class="pj-timeline-map">…</div></div></div>', fields: { date: 'when the snapshot was taken', event: 'what changed', counts: 'workspaces, documents, records and members then', map: 'the structure at the chosen point' } },
        useFor: ['How an organism\'s structure grew, one snapshot at a time.'],
        variants: [{ name: 'chosen', class: 'is-active', when: 'the snapshot whose map is shown' }],
        example: { snapshots: [['2026-09-25', 'workspace created: +workspace "Client briefs", +2 members', '1 ws · 0d · 0r · 3'], ['2026-09-25', 'organism created: initial snapshot', '0 ws · 0d · 0r · 1']] },
        note: 'Moved on 2026-09-26 from profile.css with its class names; only an organism\'s "What has happened" draws it. Its framed box (.pj-timeline-body) stays in profile.css, a question in the lab.',
    },
    {
        id: 'progress-steps', name: 'Progress steps', kind: 'component', status: 'active',
        summary: 'The steps of a job the AI is doing now, one per line: the steps done in the success colour with a ✓, the step now in bold with a →, the steps to come dimmed with a dot.',
        module: null, sheet: '/css/components/progress-steps.css', classes: ['pf-nb-steps', 'pf-nb-step'],
        data: { shape: '<ol class="pf-nb-steps"><li class="pf-nb-step done">✓ …</li><li class="pf-nb-step active">→ …</li><li class="pf-nb-step">· …</li></ol>', fields: { step: 'one step of the job, in words' } },
        useFor: ['Showing where a job the AI runs now has got to, under its Spinner.'],
        variants: [
            { name: 'done', class: 'done', when: 'a step already done' },
            { name: 'now', class: 'active', when: 'the step running now' },
        ],
        example: { steps: ['Reading the note', 'Finding where it belongs', 'Writing the suggestion'], now: 1 },
        note: 'Moved on 2026-09-26 from notebook.css with its class names; only a notebook note draws it, while the AI sorts it.',
    },
    {
        id: 'org-row', name: 'Organism row', kind: 'component', status: 'active',
        summary: 'One organism, workspace, member or join request as a row that can be dragged into another order: a small avatar box, the name in bold with its marks and state, the counts and the date on fixed tracks, the door and a menu at the right, and the panel the row opens under it (who works here, the access requests); each row over a 2px ink rule.',
        module: null, sheet: '/css/components/org-row.css', classes: ['pj-org-list', 'pj-org-row', 'pj-org-drag-over', 'pj-org-avatar', 'pj-org-main', 'pj-org-titlerow', 'pj-org-name', 'pj-org-marks', 'pj-org-type', 'pj-org-lock', 'pj-org-stats', 'pj-org-stat', 'pj-org-date', 'pj-org-door', 'pj-org-openbtn', 'pj-org-detail', 'pj-ws-person', 'pj-ws-req', 'pj-req-row'],
        data: { shape: '<div class="pj-org-list"><div class="pj-org-row"><div class="pj-org-avatar poster-box poster-box--avatar poster-box--small">…</div><div class="pj-org-main"><div class="pj-org-titlerow"><span class="pj-org-name">…</span></div><div class="pj-org-desc">…</div></div><div class="pj-org-stats"><span class="pj-org-stat">…</span><span class="pj-org-stat pj-org-date poster-time">…</span></div><button class="poster-action pj-org-openbtn">…</button><div class="pj-org-detail">…</div></div></div>', fields: { avatar: 'the mark of the thing', name: 'its name', desc: 'the line under the name', stats: 'its counts and date', detail: 'the panel the row opens' } },
        useFor: ['Organisms, workspaces, members and join requests in the organism pages, in an order the owner can drag.'],
        variants: [
            { name: 'dragged over', class: 'pj-org-drag-over', when: 'another row is dragged over this one' },
            { name: 'request', class: 'pj-req-row', when: 'a join request waiting for an answer' },
        ],
        example: { rows: [['Client briefs', '2 records · 4 documents', '👥 3', '9/26/2026']] },
        note: 'Moved on 2026-09-26 from profile.css and profile-poster.css with its class names; only the organism pages draw it. The line under the name (.pj-org-desc) stays in profile.css, a question in the lab.',
    },
    {
        id: 'comments', name: 'Comments', kind: 'component', status: 'active',
        summary: 'The comments on a workspace record or document: under a hairline, each comment on the grey ground in a thin frame (who, when, what it quotes, the words, its doors), a reply indented with a coral edge, and the form to write one under them.',
        module: null, sheet: '/css/components/comments.css', classes: ['pj-comments', 'pj-comment', 'pj-comment-reply', 'pj-comment-head', 'pj-comment-body', 'pj-comment-actions', 'pj-comment-compose'],
        data: { shape: '<div class="pj-comments"><div class="pj-comment"><div class="pj-comment-head"><b>…</b><span class="poster-time"> · …</span></div><div class="pj-comment-body">…</div><div class="pj-comment-actions">…</div></div><div class="pj-comment-compose">…</div></div>', fields: { head: 'who wrote it, when, and what it quotes', body: 'the words', actions: 'reply, delete', compose: 'the form to write one' } },
        useFor: ['A conversation about one record or document, beside it.'],
        variants: [{ name: 'reply', class: 'pj-comment-reply', when: 'a comment that answers another' }],
        example: { comments: [['bot#sandbox@aimeat-local-001-dev', 'Ferries want the proposal by Friday.'], ['bot#sandbox@aimeat-local-001-dev', 'I will draft it on Wednesday.', 'reply']] },
        note: 'Moved on 2026-09-26 from profile.css with its class names; only views/profile/organisms/workspace-comments.js draws it.',
    },
    {
        id: 'key-name', name: 'Key', kind: 'component', status: 'active',
        summary: 'A key (the name of a memory record, a file or a rule) written as the identifier it is: the typewriter face at medium weight, in the size and colour of the line it sits in; it breaks anywhere rather than run out of its line.',
        module: null, sheet: '/css/components/key-name.css', classes: ['key-name'],
        data: { shape: '<span class="key-name">studio/clients/nordic-ferries</span>', fields: { key: 'the identifier' } },
        useFor: ['A memory key in a row, a listing or an event line; a rule\'s name; a key over an opened record (with .text-meta-sm for the caption size).'],
        variants: [],
        example: { key: 'studio/clients/nordic-ferries' },
        note: 'Made on 2026-09-26 from the look most Settings tabs gave a key (Memory, Access, the agents); Memory, Access, the agents and the notebook draw it.',
    },
    {
        id: 'record-row', name: 'Record row', kind: 'component', status: 'active',
        summary: 'A record of a workspace\'s record space, one per row: its colour mark, a draft\'s state, its title as a button that opens it (coral under the pointer), its tags and doors; opened, its fields or its editor under a dashed hairline. A draft\'s row has a warning rail; inside a workspace page each record is a row over a hairline with no card.',
        module: null, sheet: '/css/components/record-row.css', classes: ['pj-rec', 'pj-item', 'pj-item-draft', 'pj-rec-title', 'pj-rec-fields', 'pj-rec-edit', 'pj-rec-edit-new'],
        data: { shape: '<div class="pj-rec"><div class="pj-item pj-item-draft"><span class="poster-status poster-status--attention">draft</span><button class="pj-rec-title">…</button><button class="poster-action">Edit</button></div><div class="pj-rec-fields">…</div></div>', fields: { title: 'the record\'s main field', fields: 'its fields, opened', edit: 'its editor, while editing' } },
        useFor: ['The records of one record space in a workspace, each opened in place.'],
        variants: [
            { name: 'draft', class: 'pj-item-draft', when: 'a record not yet published' },
            { name: 'new', class: 'pj-rec-edit-new', when: 'the editor of a record being added' },
        ],
        example: { records: [['lead-nordic', 'draft'], ['lead-lumo', 'draft']] },
        note: 'Moved on 2026-09-26 from profile.css, profile-poster.css and organism.css with its class names; only views/profile/organisms/workspace/record-space.js draws it. The row\'s line (.pj-item) came with it; the workspace\'s decisions list writes it too.',
    },
    {
        id: 'people-list', name: 'People list', kind: 'component', status: 'active',
        summary: 'Who has worked in a workspace or an organism, one entry per person: the person\'s line (a person mark, the name in bold, their tags, their node in small grey words when it is not this one, their count) and under it their agents as Agent chips.',
        module: null, sheet: '/css/components/people-list.css', classes: ['pj-parts', 'pj-parts-list', 'pj-part-human', 'pj-part-node', 'pj-part-agents'],
        data: { shape: '<div class="pj-parts-list"><div class="pj-part-owner"><div class="pj-part-human"><span>👤 <strong>…</strong></span><span class="poster-chip">…</span><span class="pj-part-node">🌐 …</span></div><div class="pj-part-agents">…</div></div></div>', fields: { human: 'the person and their tags', node: 'their node, when it is another', agents: 'their agents, as Agent chips' } },
        useFor: ['The People panel of a workspace or an organism, under its chart.'],
        variants: [],
        example: { people: [['sandbox', ['you', 'creator'], 3], ['second', [], 1]] },
        note: 'Moved on 2026-09-26 from profile.css with its class names; only organisms/participants-panel.js draws it. A person\'s framed card (.pj-part-owner) stays in profile.css, a question in the lab.',
    },
    {
        id: 'app-cards', name: 'App cards', kind: 'component', status: 'active',
        summary: 'The apps pinned to a workspace as launch cards in a grid that fills the width: each a button with the app\'s name in bold, two lines of its description in grey and its author small under it; in the poster face each sits over a 2px ink rule.',
        module: null, sheet: '/css/components/app-cards.css', classes: ['pj-apps-grid', 'pj-app-card', 'pj-app-name', 'pj-app-desc', 'pj-app-meta'],
        data: { shape: '<div class="pj-apps-grid"><div class="pj-app-card" role="button" tabindex="0"><div class="pj-app-name">…</div><div class="pj-app-desc">…</div><div class="pj-app-meta">…</div></div></div>', fields: { name: 'the app, with its icon', desc: 'what it does, two lines at most', meta: 'its author, or a Status when the catalogue lost it' } },
        useFor: ['Opening an app with a workspace as its context, from the workspace.'],
        variants: [],
        example: { apps: [['Band Jam', 'Band Jam: a small app for the seed.', 'sandbox'], ['Cadence', 'Cadence: a small app for the seed.', 'sandbox']] },
        note: 'Moved on 2026-09-26 from profile.css and profile-poster.css with its class names; only organisms/workspace-apps.js draws it. The strip around the cards (.pj-apps-strip, its head and title) stays in profile.css: its box and its heading are questions in the lab.',
    },
    {
        id: 'job-prompt', name: 'Job prompt', kind: 'component', status: 'active',
        summary: 'What a scheduled job sends, in the Object box: a row label over it, the title at the page\'s size, the body in smaller grey words, long lines wrapped.',
        module: null, sheet: '/css/components/job-prompt.css', classes: ['job-prompt', 'job-prompt-title', 'job-prompt-body'],
        data: { shape: '<div class="poster-box job-prompt"><span class="poster-label">…</span><div class="job-prompt-title">…</div><div class="job-prompt-body">…</div></div>', fields: { label: 'what the box holds', title: 'the prompt\'s first line', body: 'the rest of the prompt' } },
        useFor: ['The prompt a scheduled job sends, on the Scheduler\'s job page and in an agent\'s schedules.'],
        variants: [],
        example: { label: 'What it sends', title: 'Morning digest', body: 'Read every workspace I belong to and list the open questions first.' },
        note: 'Built on 2026-09-26 from the Scheduler\'s job prompt (.sc-prompt-*), which an agent\'s schedules drew another way (.sch-dispatch-*): Jouni\'s decision "Box".',
    },
    {
        id: 'field-row', name: 'Field row', kind: 'component', status: 'active',
        summary: 'A field and its button in one row on the page\'s ground inside a thin dashed ink frame; the field takes the room; the row wraps on a phone.',
        module: null, sheet: '/css/components/field-row.css', classes: ['field-row'],
        data: { shape: '<div class="field-row"><input class="og-input"><button class="poster-action">…</button></div>', fields: { input: 'what is typed in place', action: 'what is done with it' } },
        useFor: ['Typing a key, an address or a name in place, with the one action it takes.'],
        variants: [],
        example: { input: 'sk-or-…', action: 'Save' },
        note: 'Moved on 2026-09-25 from the AI page (ai-field) and the wallet (wal-field), which drew it one way. On the page\'s ground since 2026-09-26 (Jouni\'s decision "Dashed field box"); Packages\' install row (.pk-inst) is drawn with it.',
    },
    {
        id: 'sub-heading', name: 'Sub-heading', kind: 'component', status: 'active',
        summary: 'A small heading over a group of fields, a card or a note inside a section: small ink headline letters, no capitals. The coral small capitals stay for a field\'s label and the heading over a list.',
        module: null, sheet: '/css/components/sub-heading.css', classes: ['sub-heading'],
        data: { shape: '<h4 class="sub-heading">…</h4>', fields: { text: 'what the group, card or note is about' } },
        useFor: ['Naming a group of fields, a card or a note inside a Settings section.'],
        variants: [],
        example: { text: 'Your own TypeSafe key' },
        note: 'Built on 2026-09-26 from the AI page\'s sub-heading (.pf-aitr-sub): Jouni\'s decision "Sub-heading" made the coral small capitals (.card-h3, .pf-agd-section-title, .pj-section-title), the ink bold words (.card-title, .pf-bold) and the coral headline letters (.stat-panel-h4) this one look.',
    },
    {
        id: 'check-line', name: 'Check line', kind: 'component', status: 'active',
        summary: 'The words beside a check box or a radio dot, at the size and colour of the page\'s own text.',
        module: null, sheet: '/css/components/check-line.css', classes: ['check-line'],
        data: { shape: '<label class="check-line"><input type="checkbox" /> …</label>', fields: { text: 'what the box or the dot turns on or picks' } },
        useFor: ['A choice a person turns on or off, or picks from a few, in a Settings form.'],
        variants: [],
        example: { text: 'Detect on capture' },
        note: 'Built on 2026-09-26 from the check lines drawn at the body\'s size (Packages, Companies, the account dialog): Jouni\'s decision "Check line" made the smaller grey words (.pf-nb-toggle, .sk-check, .pf-dr-check, .ap-hint and kin) this one look. The label keeps its own layout.',
    },
];
