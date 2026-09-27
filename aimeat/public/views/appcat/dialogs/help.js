/**
 * @file public/views/appcat/dialogs/help.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's Help dialog (features F121, F145): "How this catalog works", five short
 *   sections each under the section slab at the dialog's size, and Close. The words are the old
 *   catalogue's own keys (help.*), as they read today. Escape closes it whatever was typed (it holds
 *   nothing to type; the old page left it unguarded).
 * @structure HelpDialog({ close })
 * @usage openDialog('help')
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: each section is a part of the dialog (Section part), its words the
 *     running text in ink (Note lead), as the old page drew them.
 *   v1.0.0 — 2026-09-27 — Initial (appcat).
 */
import { h } from 'preact';
import htm from 'htm';
import { Section } from '/components/Section.js';
import { Note } from '/components/Note.js';
import { Action } from '/components/Action.js';
import { Dialog } from '/views/appcat/dialogs/host.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);

/** The five sections, in the old page's order: [title key, text key]. */
const PARTS = [
  ['help.modesTitle', 'help.modes'],
  ['help.whereTitle', 'help.where'],
  ['help.sectionsTitle', 'help.sections'],
  ['help.backupTitle', 'help.backup'],
  ['help.standaloneTitle', 'help.standalone'],
];

export default function HelpDialog({ close }) {
  return html`<${Dialog} title=${x('help.title')} size="md" onClose=${close}
    footer=${html`<${Action} onClick=${close}>${x('common.close')}<//>`}>
    ${PARTS.map(([title, text]) => html`
      <${Section} key=${title} part title=${title ? x(title) : ''}>
        <${Note} kind="lead">${x(text)}<//>
      <//>`)}
  <//>`;
}
