/**
 * @file public/views/appcat/detail-head.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The top of appcat's app detail (features F59–F63, F331): the masthead (the node's
 *   screenshot where the icon would stand, the name, the mono line "{owner} / {file} · {tags}", the
 *   description in the page language, the state chips, the Launch slab, "Open draft" and the hint
 *   under them) and the band with the app's numbers. The toolbar's title (icon, name, ✏️) and the back
 *   link "← Your apps" are the Overlay's own options (detail.js).
 *   Data only: the look is PageHead `thing`, Mark, Loud, Action, Note and NumberBand `fitted`.
 *
 *   As the old page drew them (parity pass): the mono line carries no category (the old page read
 *   it from its server state, which never held one); the chips all look alike, a thin ink frame
 *   around mono words, the legal one in the body face (the old sheet's later .dtl-chip rule overrode
 *   its sun and coral variants, and .lg-chip inherited the body's font), so they carry no tone here
 *   and PageHead `thing` draws that look.
 * @structure DetailHead({ d }) · DetailBand({ d }) · fmtSize(bytes)
 * @usage html`<${DetailHead} d=${d} /><${DetailBand} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity pass: the toolbar title and the back link moved to Overlay's options
 *     (DetailTitle goes); no category in the mono line; the chips without tones, as the old page
 *     showed them.
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's renderDetailView head (detail.js heroHtml,
 *     bandHtml and the #detail-title line).
 */
import { h } from 'preact';
import htm from 'htm';
import { PageHead } from '/components/PageHead.js';
import { Mark } from '/components/Mark.js';
import { Loud, Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { NumberBand } from '/components/NumberBand.js';
import { date } from '/js/format.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);

/** A byte count in words: '—' for none, then B, KB and MB with one decimal. */
export function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

/** The masthead and its side (F60–F62). */
export function DetailHead({ d }) {
  const { app, meta, work } = d;
  const own = d.isOwn ? app : null;
  const lang = d.lang;
  const desc = (meta.descriptions && meta.descriptions[lang]) || meta.description || '';
  const v = d.version ? 'v' + d.version : '';

  // The state as chips (F61): listed with its version, unlisted, the draft, the star, and the legal
  // pages still to write, which takes the reader to them (F331).
  const pending = work.proposal ? 'pending' : work.hasWork ? 'saved' : 'clean';
  const draftWaits = !!(own && own.has_draft) || pending !== 'clean';
  const favRef = d.owner && d.filename ? d.owner + '/' + d.filename : '';
  const missing = d.legal && d.legal.readiness && Array.isArray(d.legal.readiness.missing) ? d.legal.readiness.missing.length : 0;
  const marks = [
    own && own.parked
      ? { key: 'state', label: '■ ' + x('status.parked') }
      : { key: 'state', label: '■ ' + x('status.published') + (v ? ' · ' + v : '') },
    draftWaits ? { key: 'draft', label: '■ ' + x('detail.draftWaiting') } : null,
    favRef && d.isFavourite(favRef) ? { key: 'fav', label: '★ ' + x('detail.favBadge') } : null,
    missing ? html`<${Mark} key="legal" onClick=${() => d.scrollTo('legal')}>■ ${x('legal.chip', { n: missing })}<//>` : null,
  ];

  const line = [
    d.owner && d.filename ? d.owner + ' / ' + d.filename : '',
    meta.tags && meta.tags.length ? meta.tags.join(', ') : '',
  ].filter(Boolean).join(' · ');

  const hasDraft = !!(own && own.has_draft && d.owner && d.filename);
  const actions = html`
    <${Loud} large onClick=${d.launch}>${x('detail.launch')}<//>
    ${hasDraft ? html`<${Action} title=${x('card.openStagingHint')} onClick=${d.openDraft}>${x('detail.openDraft')}<//>` : null}
    <${Note} kind="hint">${x(hasDraft ? 'detail.heroHint' : 'detail.heroHintClean')}<//>`;

  return html`<${PageHead} thing title=${meta.name} line=${line} desc=${desc} marks=${marks} actions=${actions}
    picture=${{ glyph: meta.icon, src: d.shotUrl }} />`;
}

/** The band with the app's numbers (F63): five for the person's own app, only the size otherwise. */
export function DetailBand({ d }) {
  const own = d.isOwn ? d.app : null;
  let items;
  if (own) {
    const updated = own.created_at ? date(own.created_at) : '';
    items = [
      { key: 'opens', n: String(own.downloads || 0), label: x('detail.opens') },
      d.version ? { key: 'versions', n: String(d.version), label: x('detail.versions') } : null,
      own.size ? { key: 'size', n: fmtSize(own.size), label: x('detail.size') } : null,
      updated ? { key: 'updated', n: updated, label: x('detail.updated') } : null,
      { key: 'forks', n: String(own.forks || 0), label: x('detail.forks') },
    ];
  } else {
    const bytes = d.work.b64 ? Math.round(d.work.b64.length * 0.75) : 0;
    items = bytes ? [{ key: 'size', n: fmtSize(bytes), label: x('detail.size') }] : [];
  }
  return html`<${NumberBand} fitted items=${items} />`;
}
