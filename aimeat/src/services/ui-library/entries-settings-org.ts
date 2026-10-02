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
 *   v1.10.3 — 2026-09-27 — The Sub-heading's rule, rule="readout", quiet and part, which appcat added (catalogue pass).
 *   v1.10.2 —2026-09-27 — The Check's pill, ruled and strong, and its focus and pointer handlers, which appcat added (catalogue pass).
 *   v1.10.1 — 2026-09-27 — The Key says the List's Name asKey draws it in a list (catalogue pass).
 *   v1.10.0 — 2026-09-27 — The Sub-heading is components/SubHeading.js (SubHeading, HeadDesc), catalogue pass.
 *   v1.9.0 — 2026-09-27 — The Check line is components/Check.js; the Field row says TextField `box` draws it (catalogue pass).
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
        id: 'progress-steps', name: 'Progress steps', kind: 'component', status: 'active',
        summary: 'What the AI is doing now, while a slow call runs. The steps of the job one per line: the steps done in the success colour with a ✓, the step now in bold with a →, the steps to come dimmed with a dot. Or, in a dialog that waits, a block in the middle: the spinner with its words, a bold line that says what the AI does, and the step it is at in grey under it.',
        module: '/components/ProgressSteps.js', sheet: '/css/components/progress-steps.css',
        data: {
            shape: 'ProgressSteps({ steps, at }) · ProgressNow({ label, title, step })',
            fields: {
                steps: 'the words of each step, in order',
                at: 'the index of the step now; the ones before it are done',
                label: 'the spinner\'s words', title: 'the bold line: what the AI does', step: 'the grey line: the step it is at',
            },
        },
        useFor: ['Showing where a job the AI runs now has got to: under a note while the AI sorts it, or in a dialog that waits for the AI.'],
        variants: [
            { name: 'done', class: 'progress-step--done', prop: 'at', when: 'a step already done' },
            { name: 'now', class: 'progress-step--active', prop: 'at', when: 'the step running now' },
            { name: 'in a dialog', class: 'progress-now', prop: 'ProgressNow', when: 'a dialog\'s body while it waits for the AI' },
        ],
        example: { steps: ['Reading the note', 'Finding where it belongs', 'Writing the suggestion'], at: 1 },
        note: 'Moved on 2026-09-26 from notebook.css with its class names (.pf-nb-steps, .pf-nb-step); the same day it became components/ProgressSteps.js with its own names (.progress-steps, .progress-step and its done and active tones), and ProgressNow took the Track a response dialog\'s waiting block (.inbox-track-classify in css/views/inbox.css). A notebook note and the Track a response dialog draw it. The sheet\'s old .pf-nb-* rules were written only by the design lab\'s old demo.',
    },
    {
        id: 'key-name', name: 'Key', kind: 'component', status: 'active',
        summary: 'A key (the name of a memory record, a file or a rule) written as the identifier it is: the typewriter face at medium weight, in the size and colour of the line it sits in; it breaks anywhere rather than run out of its line. In a Settings list the List\'s Name with `asKey` (components/List.js) draws it, as a plain name or as the button into the key.',
        module: null, sheet: '/css/components/key-name.css', classes: ['key-name'],
        data: { shape: 'Name({ asKey, onOpen }) (components/List.js) · as markup outside a list: <span class="key-name">studio/clients/nordic-ferries</span>', fields: { key: 'the identifier (the Name\'s children)', onOpen: 'the key is a button that opens it' } },
        useFor: ['A memory key in a row, a listing or an event line; a rule\'s name; a key over an opened record (with .text-meta-sm for the caption size).'],
        variants: [],
        example: { key: 'studio/clients/nordic-ferries' },
        note: 'Made on 2026-09-26 from the look most Settings tabs gave a key (Memory, Access, the agents); Memory, Access, the agents and the notebook draw it. No module of its own: the class is shared with the admin pages and memory\'s event rows, and in a list the List\'s Name asKey draws it.',
    },
    {
        id: 'job-prompt', name: 'Job prompt', kind: 'component', status: 'active',
        summary: 'What a scheduled job sends each time it runs, in the Object box: a row label over it, the title at the page\'s size, the body in smaller grey words, long lines wrapped. With neither a title nor a body it draws nothing.',
        module: '/components/JobPrompt.js', sheet: '/css/components/job-prompt.css',
        data: {
            shape: 'JobPrompt({ label, title, body })',
            fields: { label: 'what the box holds', title: 'the prompt\'s first line', body: 'the rest of the prompt' },
        },
        useFor: ['The prompt a scheduled job sends, on the Scheduler\'s job page and in an agent\'s schedules.'],
        variants: [
            { name: 'title only', prop: 'body left out', when: 'a prompt of one line' },
        ],
        example: { label: 'Creates each run', title: 'Morning digest', body: 'Read every workspace I belong to and list the open questions first.' },
        note: 'Built on 2026-09-26 from the Scheduler\'s job prompt (.sc-prompt-*), which an agent\'s schedules drew another way (.sch-dispatch-*): Jouni\'s decision "Box". The same day it became components/JobPrompt.js, which both pages give their words.',
    },
    {
        id: 'field-row', name: 'Field row', kind: 'component', status: 'active',
        summary: 'A field and its button in one row on the page\'s ground inside a thin dashed ink frame; the field takes the room; the row wraps on a phone. TextField draws it when it is given `box` and its `actions`; no page writes the class by hand now.',
        module: null, sheet: '/css/components/field-row.css', classes: ['field-row'],
        data: { shape: 'TextField({ box, actions, value, onInput, ariaLabel, … }) · <div class="field-row"><input class="og-input"><button class="poster-action">…</button></div> (the markup it draws)', fields: { box: 'the row in the dashed frame', actions: 'what is done with what is typed: an action link or a slab', value: 'what is typed in place' } },
        useFor: ['Typing a key, an address or a name in place, with the one action it takes.'],
        variants: [],
        example: { box: true, ariaLabel: 'Key', value: 'sk-or-…', actions: 'Save the key' },
        note: 'Moved on 2026-09-25 from the AI page (ai-field) and the wallet (wal-field), which drew it one way. On the page\'s ground since 2026-09-26 (Jouni\'s decision "Dashed field box"); Packages\' install row (.pk-inst) is drawn with it. Since 2026-09-26 components/TextField.js writes it (`box`); the class keeps its name and the entry has no module, because the class is the shared name the library keeps.',
    },
    {
        id: 'sub-heading', name: 'SubHeading', kind: 'component', status: 'active',
        summary: 'A small heading over a group of fields, a card or a note inside a section: small bold ink letters of the body face, no capitals, and the grey line the classic Settings pages put under it. The coral small capitals stay for a field\'s label and the heading over a list. Three more cuts name a part of a long section: coral capitals over the ink rule, a grey heading over a strip, and bold ink at the reading size.',
        module: '/components/SubHeading.js', sheet: '/css/components/sub-heading.css',
        data: {
            shape: 'SubHeading({ level, inline, id, desc, rule, quiet, part, children }) · HeadDesc({ children })',
            fields: {
                level: '2 to 6: a heading of that level, which counts in the page\'s outline; without it the words stand in a block',
                inline: 'the words stand in a line (a span)', id: 'the anchor a link scrolls to',
                desc: 'the grey line under it (.section-desc, the classic pages\' line)', children: 'what the group, card or note is about',
                rule: 'true: the heading of one part of a long section, in coral small capitals over the ink rule, with 2rem of air above; \'readout\': the same heading opening a part of a readout, 30px under the part before it and 12px over its own',
                quiet: 'a grey heading, a little larger, with no air of its own, over a strip that is not the page\'s matter',
                part: 'true: a part\'s heading in bold ink at the reading size, with no air of its own; \'apart\': the same with 30px of air above and 10px below',
                'rule, quiet, part': 'one at a time; when more are given, rule wins, then quiet, then part',
                HeadDesc: 'the grey line alone, under a heading it does not draw or under a field',
            },
        },
        useFor: ['Naming a group of fields, a card or a note inside a Settings section.'],
        variants: [
            { name: 'heading', prop: 'level={3}', when: 'the words are a heading of the page\'s outline' },
            { name: 'in a line', prop: 'inline', when: 'the words stand in a line with other things' },
            { name: 'with its line', prop: 'desc', when: 'a classic page\'s heading with the grey line that explains it' },
            { name: 'rule', class: 'sub-heading--rule', prop: 'rule', when: 'a part of a long section, such as a chapter of an app\'s detail ("What it holds", "Where people came from")' },
            { name: 'rule, readout', class: 'sub-heading--readout', prop: 'rule="readout"', when: 'the heading that opens each part of a readout, with the air between the parts (an app\'s visitors)' },
            { name: 'quiet', class: 'sub-heading--quiet', prop: 'quiet', when: 'a grey heading over a strip that is not the page\'s matter (the app catalogue\'s "Active Extensions")' },
            { name: 'part', class: 'sub-heading--part', prop: 'part', when: 'a part\'s heading inside a chapter, in the words\' own face ("What people will see")' },
            { name: 'part apart', class: 'sub-heading--apart', prop: 'part="apart"', when: 'the same heading with air above and below it ("Who answers for this app")' },
        ],
        example: { level: 3, children: 'Your own TypeSafe key', desc: 'A key of your own is used before the node\'s.' },
        note: 'Built on 2026-09-26 from the AI page\'s sub-heading (.pf-aitr-sub): Jouni\'s decision "Sub-heading" made the coral small capitals (.card-h3, .pf-agd-section-title, .pj-section-title), the ink bold words (.card-title, .pf-bold) and the coral headline letters (.stat-panel-h4) this one look. The grey line (.section-desc) wears section-header.css and profile-poster.css. On 2026-09-27 appcat, the app catalogue rebuilt on components, added rule and rule="readout" (the old catalogue\'s .vis-h, .dtl-dm-body h4 and #detail-marks h4), quiet (its Active Extensions heading) and part with part="apart" (its detail h4).',
    },
    {
        id: 'check-line', name: 'Check', kind: 'component', status: 'active',
        summary: 'A check box or a radio dot with its words beside it, at the size and colour of the page\'s own text: a row, the box level with the words, the whole line pressable. A grey hint can stand under the words; several checks can stand side by side in a line. Three more faces: a small framed pill on the sun while ticked, a line of a list with a thin rule under it and grey words, and bold words with a larger box for the choice that decides what a form does.',
        module: '/components/Check.js', sheet: '/css/components/check-line.css',
        data: {
            shape: 'Check({ checked, onChange, radio, name, value, hint, help, inline, pill, ruled, strong, disabled, title, id, ariaLabel, onFocus, onBlur, onMouseEnter, onMouseLeave, children })',
            fields: {
                checked: 'the box is ticked, or the dot is picked', onChange: '(checked, event); a radio calls it only when it is picked, with true',
                radio: 'a radio dot instead of a box; `name` (and `value`) group the dots', hint: 'a grey line under the words',
                help: 'a term: the question mark of HelpTip after the line, outside its label, explaining what ticking it does (explain.<term>.* in the locale)',
                inline: 'several checks side by side in a line of words', disabled: 'it cannot change now: dimmed',
                pill: 'one of several small framed choices side by side, bold words, on the sun while ticked',
                ruled: 'one choice of a list: a thin rule under it, the words a step smaller in grey with their bold part (<strong>) in ink, the 18px box in ink at the first line',
                strong: 'a choice that decides what a form does: bold words, an 18px ink box, 14px under what stands above it',
                'onFocus, onBlur': 'reach the box: a page that says what the focused choice is',
                'onMouseEnter, onMouseLeave': 'reach the whole line: a page that says what the pointed choice is',
                'title, id': 'the tooltip, and the box\'s id when code reaches it', ariaLabel: 'its name when the words are not enough',
                children: 'the words: what the box turns on, or what the dot picks',
            },
        },
        useFor: ['A choice a person turns on or off, or picks from a few, in a Settings form. Several under one row label stand in a Field with `group`.'],
        variants: [
            { name: 'radio', prop: 'radio', when: 'one of a few answers, each a dot' },
            { name: 'inline', class: 'check--inline', prop: 'inline', when: 'several short ones side by side in a line of words' },
            { name: 'with a hint', class: 'check--hint', prop: 'hint', when: 'an answer that needs a line under it: the box stands level with the first line' },
            { name: 'disabled', class: 'check--off', prop: 'disabled', when: 'it cannot change now' },
            { name: 'pill', class: 'check--pill', prop: 'pill', when: 'a set of small options to add to something, side by side: the capability packs of a prompt the app catalogue builds' },
            { name: 'ruled', class: 'check--ruled', prop: 'ruled', when: 'a list of choices where each needs a sentence: an app\'s copy protection flags' },
            { name: 'strong', class: 'check--strong', prop: 'strong', when: 'the one choice that decides what a form does: list a tool in EXCHANGE' },
        ],
        example: { checked: true, children: 'Detect on capture' },
        note: 'Built on 2026-09-26 from the check lines drawn at the body\'s size (Packages, Companies, the account dialog): Jouni\'s decision "Check line" made the smaller grey words (.pf-nb-toggle, .sk-check, .pf-dr-check, .ap-hint and kin) this one look. Since 2026-09-26 it is components/Check.js, which lays the line out itself with the layout most Settings check lines drew (sch-check, pj-share-row, cp-check, kp-check, wp-check) and replaces the page wrappers and the radio labels (ai-radio, radio-label, pf-or-radio-label, pf-eco-recipe-radio). `pill`, `ruled`, `strong` and the focus and pointer handlers came with appcat on 2026-09-27 and replace the old app catalogue\'s .pb-pack-item, .protect-row and .mz-check.',
    },
];
