/**
 * @file public/views/admin/portal-tab.preview.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a visitor sees, beside the list of parts (design canvas "AIMEAT Admin Portal",
 *   section 02). Two widths, a way to fold it out of sight, and a line that says exactly which
 *   version is in the frame. The frame, its tools and the numbering of the parts are the library's
 *   PagePreview in its `live` look; this file says which page it shows and in which words.
 *
 *   WHICH PAGE THIS SHOWS got it wrong for months and the reason is worth keeping: the site's root
 *   forwards a signed-in person to their own home, so an operator standing here saw their home and
 *   had no way to tell it was not the page they were editing. /v1/portal is the front page itself
 *   and forwards nobody. A custom HTML page has no such forward: it IS what the root hands every
 *   visitor, so once one is saved the frame goes back to the root.
 *
 *   IT SHOWS THE SAVED PAGE, AND SAYS SO. The node renders the front page from what is stored, so
 *   an arrangement you have not saved cannot be in the frame. Rather than let the operator believe
 *   otherwise, the line under it counts the changes that are not in it yet.
 *
 *   THE NUMBERS. The renderer emits exactly one root element per shown part, in order, inside `.ld`,
 *   so the children of that element ARE the parts. That is an assumption about someone else's
 *   markup, so PagePreview checks it rather than trusting it: unless the count matches the number
 *   of parts the list shows, no number is drawn at all.
 * @structure PagePreview
 * @usage html`<${PagePreview} surface="portal" hasCustom=${false} nonce=${n} unsaved=${3} />`
 * @version-history
 *   v2.1.0 — 2026-09-27 — SitePreview folded into the library's PagePreview (`live`): one component for
 *     a web page shown as it looks. Imported as LivePreview, since this file's own export is named
 *     PagePreview.
 *   v2.0.0 — 2026-09-27 — The frame, its tools and the numbering move into the library's
 *     SitePreview (admin group G2); this file passes the page and the words and writes no class.
 *   v1.0.0 — 2026-09-12 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import LivePreview from '/components/PagePreview.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.portal.' + key, params);

export function PagePreview({ surface, hasCustom, nonce, unsaved, shown }) {
  // A member's page is behind a sign-in, so there is nothing honest to put in a frame here.
  if (surface !== 'portal') {
    return html`<${LivePreview} live title=${P('preview.title')} empty=${P('preview.memberOnly')} />`;
  }

  const path = hasCustom ? '/' : '/v1/portal';
  return html`<${LivePreview} live title=${P('preview.title')} src=${path} refresh=${nonce} href=${path}
    openLabel=${P('preview.open')} wideLabel=${P('preview.wide')} phoneLabel=${P('preview.phone')}
    foldLabel=${P('preview.fold')} unfoldLabel=${P('preview.unfold')}
    note=${unsaved > 0 ? P('preview.noteUnsaved', { n: unsaved }) : P('preview.noteSaved')}
    markedNote=${P('preview.noteNumbers')} marks=${{ root: '.ld', count: shown }} />`;
}

export default PagePreview;
