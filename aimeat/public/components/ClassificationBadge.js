/**
 * @file public/components/ClassificationBadge.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How sensitive one thing of the person's is, said on a tag beside the AudienceBadge (plan
 *   doc-mvdipuyqraas, L4.2): the classification's name in the reader's language, after a square in
 *   the classification's own colour. The tooltip says it in a sentence, and where the classification
 *   came from when a workspace, a shared place, a board or an app raised it. The catalogue entry is
 *   `classification-badge`.
 *
 *   THE COLOUR IS DATA. A classification's colour is the one its policy holds (#rrggbb, checked by the
 *   server when the policy is saved, and again here). It fills the square only, through the SVG
 *   `fill` attribute, so the words stay ink on the page in both themes whatever colour the policy
 *   chose, and no inline style is written. A value that is not #rrggbb draws the square in the words'
 *   colour.
 *
 *   A CONFLICT IS ITS OWN MARK: `conflict` adds the danger Status after the tag (the thing is open to
 *   more people than its classification allows), and `excepted` the plain Status (the person's own
 *   exception lets it stay open). Each takes its sentence as `conflictTitle` / `exceptedTitle`.
 *
 *   Shown only where classification is on: the page passes a classification, or nothing is drawn.
 * @structure ClassificationBadge({ label, from, conflict, conflictTitle, excepted, exceptedTitle })
 * @usage
 *   html`<${ClassificationBadge} label=${item.classification} from=${item.classification.from} />`
 *   html`<${ClassificationBadge} label=${c} conflict conflictTitle=${sentence} />`
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L4.2).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { labelName } from '/js/services/classification.js';

const html = htm.bind(h);
const HEX = /^#[0-9a-fA-F]{6}$/;
const FROM = ['workspace', 'organism', 'board', 'app'];

/** The square in the classification's colour: 10px on a 10px grid, framed in the words' colour. */
const swatch = (color) => html`<svg class="classification-badge-swatch" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
  <rect x="0.5" y="0.5" width="9" height="9" fill=${HEX.test(String(color || '')) ? color : 'currentColor'} stroke="currentColor" stroke-width="1" />
</svg>`;

/**
 * @param {{ label: { id: string, name?: { fi?: string, en?: string, es?: string }, color?: string } | null | undefined,
 *   from?: string, conflict?: boolean, conflictTitle?: string, excepted?: boolean, exceptedTitle?: string }} props
 *   `label` a classification as the policy or the exposure report hands it; `from` where it came from
 *   ('own', or the container that raised it).
 */
export function ClassificationBadge({ label, from, conflict, conflictTitle, excepted, exceptedTitle }) {
  if (!label) return null;
  const name = labelName(label);
  const title = FROM.includes(from)
    ? t('classification.badge.titleFrom', { label: name, from: t(`classification.badge.from.${from}`) })
    : t('classification.badge.title', { label: name });
  return html`<span class="classification-badge-group">
    <span class="poster-chip classification-badge" title=${title}>${swatch(label.color)}<span>${name}</span></span>
    ${conflict ? html`<span class="poster-status poster-status--danger" title=${conflictTitle || undefined}>${t('classification.badge.conflict')}</span>` : null}
    ${!conflict && excepted ? html`<span class="poster-status poster-status--off" title=${exceptedTitle || undefined}>${t('classification.badge.excepted')}</span>` : null}
  </span>`;
}

export default ClassificationBadge;
