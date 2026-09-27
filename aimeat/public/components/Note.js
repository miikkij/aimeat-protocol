/**
 * @file public/components/Note.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sentences a page says about itself, as one component (C8 of the component plan):
 *   the lead that opens a section, the grey hint that explains, the quiet line that says a list is
 *   empty, the loading line, the message after a save, and the attention note (the aside) that asks
 *   the person to look or act. A page passes the words and a kind; it never writes a class. The look
 *   is css/components/hint.css, quiet-note.css, loading-mark.css, form-message.css, page-section.css
 *   (the lead) and the aside shape in css/poster.css.
 *
 *   kind = 'lead' | 'hint' | 'quiet' | 'loading' | 'message' | 'aside' | 'caption' | 'report'.
 *   - caption: a dialog's small grey line on what it is about or what it does; `size` 'medium' for a
 *     summary a step larger, 'large' for the grey body of a small dialog, 'body' for a description at
 *     the running text's size with 18px under it, 'lead' for a chapter's grey opening line; `mono`;
 *     `tone` 'faint' in the lighter grey (added for appcat's dialogs).
 *   - report: the line a dialog reports what it is doing in; `tone` 'busy' | 'ok' | 'err' | 'refused';
 *     `keep` holds one line's room while it is empty (added for appcat's dialogs); `chapter` for a
 *     chapter's status line (10px above, .82rem).
 *   - lead, quiet: `chapter` for a chapter of the app catalogue's detail (its lead; its small light
 *     grey "nothing here" line).
 *   - hint: `slab` for the small line beside a loud action; `size` 'small' | 'intro' (a readout's grey
 *     opening sentence) | 'note' (the grey note under a figure or a table on how to read it).
 *   - quiet: `inline` for one inside a line of words.
 *   - loading: without words it says "Loading…".
 *   - message: `error` for a refusal, otherwise a success.
 *   - aside: `size` = 'small' | 'large'; `tone` = 'irreversible' (an act that cannot be undone) |
 *     'waiting' (the next move is in another window) | 'suggestion' (a line the person can wave away);
 *     `chapter` for the aside of a chapter of the app catalogue's detail (22px above, 14px below).
 *   - hint: `chapter` for a chapter's grey line (its intro, a form's hint) at the words' own reading.
 *   - meta: the small grey words of the classic Settings pages (a count, a status, a key's detail;
 *     .text-meta-sm, .75rem in the dim colour, 75 uses on main); `inline` in a line, else a block;
 *     `mono` in the typewriter face (a record's facts under its head: created, changed, version, size).
 *   - state: the one sentence that says where a thing stands, on a ground tinted by its state;
 *     `tone` = 'fine' | 'attention' | 'danger', else the neutral grey ground (the old app catalogue's
 *     search state line, .dtl-seo-state); `size` 'small' for a short state only as wide as its words
 *     (the EXCHANGE status).
 * @structure Note({ kind, slab, inline, error, size, tone, title, mono, keep, children })
 * @usage html`<${Note} kind="quiet">${t('x.none')}<//>` · html`<${Note} kind="loading" />`
 * @version-history
 *   v1.12.0 — 2026-09-27 — appcat parity (sections-c), additive: the hint's `size` 'text' (a paragraph
 *     to be read, the old .mk-legal; hint.css .poster-hint--text) and the lead's `size` 'record' (a
 *     statement on the record, the old .mk-author-is; page-section.css .og-lead--record).
 *   v1.11.0 — 2026-09-27 — appcat parity (sections-b), additive: the hint's `size` 'intro' (a readout's
 *     grey opening sentence, the old .vis-intro) and 'note' (the grey note under a figure or a table,
 *     the old .vis-note); hint.css .poster-hint--intro, --note.
 *   v1.10.0 — 2026-09-27 — appcat parity (sections-c), additive: the hint's `chapter` (a chapter's grey
 *     line at the words' own reading, the old detail's .dtl-ai-status; hint.css .poster-hint--chapter)
 *     and the aside's `chapter` (the old detail's .mk-aside: its room inside and the air around it;
 *     poster.css .poster-aside--chapter).
 *   v1.9.0 — 2026-09-27 — appcat parity (sections-d), additive: `chapter` on the report (a chapter's
 *     status line, the old detail's .dtl-ai-status; hint.css .note-report--chapter) and on the quiet
 *     line (a chapter's "nothing here" line, the old .dtl-sync.none; quiet-note.css .poster-quiet--chapter);
 *     the state's `size` 'small' (a short state only as wide as its words, the old .od-status;
 *     hint.css .state-line--small), with `mono` in the typewriter face (the old cost summary); the
 *     caption's `size` 'lead' (a chapter's grey opening line: the Bundled agents explanation).
 *   v1.8.0 — 2026-09-27 — appcat parity (sections-a), additive: the lead's `chapter` (a chapter's lead,
 *     the old detail's .dtl-desc; page-section.css .og-lead--chapter); the quiet line's `size` 'small'
 *     (the old .wc-muted; quiet-note.css); the hint's `size` 'small' (the line under a row of verbs,
 *     the old .wc-verbs-hint; hint.css); the aside's tone 'disclosure' (a statement of what a panel is, as the law asks
 *     it said: the old .dtl-ai-notice, a thin frame with a coral bar at its start; poster.css).
 *   v1.7.0 — 2026-09-27 — The caption kind: a dialog's small grey line on what it is about or does (the
 *     old app catalogue's target and help lines), and the report kind: the line a dialog reports what
 *     it is doing in (its #…-status lines, `keep` for the room they held); additive, hint.css
 *     .note-caption, .note-report. appcat parity (dialogs).
 *   v1.6.0 — 2026-09-27 — The state kind: where a thing stands, on a ground tinted by its state (the
 *     old app catalogue's .dtl-seo-state); its rule is css/components/hint.css. Additive, appcat
 *     detail builder B.
 *   v1.5.0 — 2026-09-26 — The message's `pre`: a refusal that names several problems keeps one per
 *     line (the Decide rules and providers, main's .pf-dr-pre; additive, G8).
 *   v1.4.0 — 2026-09-26 — The quiet line takes `role` too (a failure said to a screen reader as an
 *     alert: the Apps page's shared list and roadmap, as main said them; additive, G6).
 *   v1.3.0 — 2026-09-26 — The hint takes `role` too (a hint that is a note to a screen reader, as the
 *     crew's "no key for decisions" line said on main; additive, G1a).
 *   v1.2.0 — 2026-09-26 — The meta kind's `mono` (Memory's record facts, formerly .mp-meta; additive, G3).
 *   v1.1.0 — 2026-09-26 — The meta kind (.text-meta-sm), so a classic page's small grey words need no
 *     class (component plan C9, page parts; additive).
 *   v1.0.0 — 2026-09-26 — Initial (component plan C8).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const ASIDE_TONES = new Set(['irreversible', 'waiting', 'suggestion', 'disclosure']);
const STATE_TONES = new Set(['fine', 'attention', 'danger']);
const REPORT_TONES = new Set(['busy', 'ok', 'err', 'refused']);
// 'text' (added by appcat sections-c): a paragraph to be read, the law said in words (the old .mk-legal).
const HINT_SIZES = new Set(['small', 'intro', 'note', 'text']);

export function Note({ kind = 'hint', slab, inline, error, size, tone, title, role, mono, pre, keep, chapter, children }) {
    switch (kind) {
        // chapter (added by appcat sections-a, parity): the lead of a chapter of a long page of one
        // thing, the old app catalogue's detail sections (.dtl-desc).
        // lead size 'record' (added by appcat sections-c, parity): a statement on the record, semibold ink
        // at the reading size, 10px over what follows (the old detail's .mk-author-is: "Reviewed by …").
        case 'lead': return html`<p class=${cx('og-lead', chapter && 'og-lead--chapter', size === 'record' && 'og-lead--record')}>${children}</p>`;
        // caption (added by appcat's dialogs, parity): a dialog's small grey line that says what it is
        // about or what it does (the old app catalogue's target and help lines); `size` 'medium' for the
        // one a step larger (a summary), `mono` in the typewriter face.
        // caption size 'lead' (added by appcat sections-d, parity): a chapter's grey opening line, .85rem,
        // 6px over what follows (the old detail's Bundled agents explanation).
        case 'caption': return html`<div class=${cx('note-caption', (size === 'medium' || size === 'large' || size === 'body' || size === 'lead') && `note-caption--${size}`, mono && 'note-caption--mono', tone === 'faint' && 'note-caption--faint')} role=${role}>${children}</div>`;
        // report (added by appcat's dialogs, parity): the line a dialog reports what it is doing in, 8px
        // under what is above it; `tone` 'busy' (grey) | 'ok' (green) | 'err' (red) | 'refused' (coral:
        // the form said no); `keep` holds one line's room while it is empty (the old #…-status lines).
        // report `chapter` (added by appcat sections-d, parity): a chapter's status line, 10px under what
        // is above it and a step smaller (the old detail's .dtl-ai-status).
        case 'report': return html`<div class=${cx('note-report', REPORT_TONES.has(tone) && `note-report--${tone}`, keep && 'note-report--keep', chapter && 'note-report--chapter')}
          role=${role || 'status'} aria-live="polite">${children}</div>`;
        // quiet size 'small' (added by appcat sections-a, parity): the old detail's empty lines, a
        // step smaller and not bold (.wc-muted).
        // quiet `chapter` (added by appcat sections-d, parity): a chapter's line that says there is
        // nothing, or what a count leaves out (the old detail's .dtl-sync.none): small, light grey.
        case 'quiet': return inline
            ? html`<span class=${cx('poster-quiet', size === 'small' && 'poster-quiet--small', chapter && 'poster-quiet--chapter')} title=${title} role=${role}>${children}</span>`
            : html`<p class=${cx('poster-quiet', size === 'small' && 'poster-quiet--small', chapter && 'poster-quiet--chapter')} title=${title} role=${role}>${children}</p>`;
        case 'loading': return inline
            ? html`<span class="poster-quiet loading-mark" role="status">${children || t('profile.loading')}</span>`
            : html`<p class="poster-quiet loading-mark" role="status">${children || t('profile.loading')}</p>`;
        case 'message': return html`<span class=${cx('form-message', error && 'form-message--error', pre && 'form-message--pre')} role=${role || (error ? 'alert' : 'status')}>${children}</span>`;
        case 'meta': return inline
            ? html`<span class=${cx('text-meta-sm', mono && 'text-meta-sm--mono')} title=${title}>${children}</span>`
            : html`<div class=${cx('text-meta-sm', mono && 'text-meta-sm--mono')} title=${title}>${children}</div>`;
        // state (added by appcat detail builder B): where a thing stands, on a ground tinted by its state.
        // state size 'small' (added by appcat sections-d, parity): a short state only as wide as its
        // words, bold and a step smaller (the old catalogue's EXCHANGE status, .od-status).
        // `mono` with size 'small' (sections-d): the short state in the typewriter face (the old
        // catalogue's cost summary, a .dtl-sync chip).
        case 'state': return html`<p class=${cx('state-line', STATE_TONES.has(tone) && `state-line--${tone}`, size === 'small' && 'state-line--small', mono && 'state-line--mono')} role=${role}>${children}</p>`;
        // aside `chapter` (added by appcat sections-c, parity): the aside of a chapter of the old app
        // catalogue's detail (.mk-aside): a little less room inside, 22px of air above and 14px below.
        case 'aside': return html`<div class=${cx('poster-aside', (size === 'small' || size === 'large') && `poster-aside--${size}`, ASIDE_TONES.has(tone) && `poster-aside--${tone}`, chapter && 'poster-aside--chapter')} role=${role}>${children}</div>`;
        // hint size 'small' (added by appcat sections-a, parity): the line under a row of verbs that
        // says what they do, a step smaller (the old catalogue's .wc-verbs-hint).
        // hint `chapter` (added by appcat sections-c, parity): a chapter's grey line of words (its intro,
        // a form's hint) at the reading of the words around it, 10px under what is above it (the old
        // detail's .dtl-ai-status).
        // hint size 'intro' | 'note' (added by appcat sections-b, parity): a readout's grey opening
        // sentence, and the grey note under a figure or a table on how to read it (the old visitors'
        // .vis-intro and .vis-note).
        default: return inline
            ? html`<span class=${cx('poster-hint', slab && 'poster-hint--slab', HINT_SIZES.has(size) && `poster-hint--${size}`, chapter && 'poster-hint--chapter')} title=${title} role=${role}>${children}</span>`
            : html`<p class=${cx('poster-hint', slab && 'poster-hint--slab', HINT_SIZES.has(size) && `poster-hint--${size}`, chapter && 'poster-hint--chapter')} title=${title} role=${role}>${children}</p>`;
    }
}

export default Note;
