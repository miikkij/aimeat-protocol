/**
 * @file collaboration.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The dialog that publishes a draft with its change note. Made of the component kit:
 *   the page passes data and never a class.
 * @structure PublishDialog({ app, busy, onPublish, onClose })
 * @usage import { PublishDialog } from './collaboration.js';
 * @version-history
 *   v3.0.0 — 2026-10-04 — CollaborationSection is gone with the Roadmap and shared work section: an
 *     app's design spec, roadmap and builders are sections of its own page in the App Catalog, the
 *     apps built for somebody else its Building for others view, and a draft such an app waits on is
 *     under What waits for you (wish-appcatin-sovellussivulle-design-spec-roadmap-rakentajat-ja-l).
 *   v2.2.0 — 2026-10-04 — The roadmap is RoadmapBlock (roadmap-block.js), which reads it itself, so the
 *     App Catalog's app page shows the same block; the spec no longer waits for the roadmap to load.
 *   v2.1.0 — 2026-10-02 — The chosen app's design spec (design-spec.js) sits above its roadmap, under
 *     its own heading, and the roadmap halves get a heading of their own.
 *   v2.0.0 — 2026-09-26 — Every part is a component call that gets data (page group G6): the dialog's
 *     form Fields with a TextArea and its submit the loud action naming the form, the section Section,
 *     "show the shared ones" a Check, the shared apps and a roadmap's entries the List (an entry's
 *     words kept as written, Desc pre), the halves' headings the Sub-heading, the drop-downs Select,
 *     the entry form Fields with FormActions, the lines Note. The page writes no class.
 *   v1.11.0 — 2026-09-26 — "Show the shared ones" is the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.10.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.9.0 — 2026-09-26 — Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.8.0 — 2026-09-25 — The shared apps are the Listing (listing, listing-row and its name and doors cells), a unification: the look most tabs use.
 *   v1.7.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.6.0 — 2026-09-25 — Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.5.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.4.0 — 2026-09-25 — The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.1 — 2026-09-13 — The publish dialog's submit sits in the dialog's footer and names its form.
 *   v1.0.0 - 2026-09-08 - Make collaboration usable from the Apps page.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { Modal } from '/components/Modal.js';
import { Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextArea } from '/components/TextField.js';
import { Space } from '/components/Layout.js';
import { a, nameOf } from './frame.js';
const html = htm.bind(h);

export function PublishDialog({ app, busy, onPublish, onClose }) {
  const [line, setLine] = useState('');
  // The submit sits in the footer, outside the form, and names the form it submits.
  return html`<${Modal} open=${true} title=${a('publishDraft')} onClose=${onClose}
    footer=${html`<${Loud} control type="submit" form="ap-publish-form" disabled=${busy || (!!line.trim() && line.trim().length < 3)}>${a('publishDraft')}<//>`}>
    <form id="ap-publish-form" onSubmit=${e => { e.preventDefault(); onPublish(app, line); }}>
      <${Note}>${a('publishConfirm', { name: nameOf(app) })}<//>
      <${Space} above="medium">
        <${TextArea} label=${a('roadPublishLabel')} hint=${a('roadPublishHint')} rows=${3} maxLength="600" value=${line} onInput=${setLine} />
      <//>
    </form>
  <//>`;
}
