/**
 * @file knowledge-tab.shape.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 01 and 02 of the Knowledge page: the moderation state, and the shape of
 *   the collection.
 *
 *   02 IS THE SECTION A WALL OF CARDS CANNOT BE. An operator's first question is not "which one do
 *   I open" but "what am I even looking at", and the answer is three counts the server already
 *   holds: by author, by kind, by how finished. On the node this was written against the answer
 *   turned out to be "one person's bulk import from two days in August, plus six things somebody
 *   actually wrote" — which is the difference between a corpus to moderate and a pile to leave
 *   alone, and no surface had ever said it.
 *
 *   IT IS ALSO WHERE THE DATA'S OWN DEFECTS SHOW. Two spellings of one author, and a maturity word
 *   this node does not define, both sitting in the facet where a person cannot miss them. Neither
 *   is invented by the page: the author is a string the writer supplies, and nothing validates
 *   maturity on the way in. → services/knowledge-overview.ts
 * @structure
 *   - RightNow (01) — the word, the five rows, the strip
 *   - WhatIsHere (02) — the facets, each part with a bar
 * @usage Imported by views/admin/knowledge-tab.js.
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Knowledge page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { num, Badge, Row } from './shared.js';

const S = (key, params) => t('admin.knowledge.' + key, params);

/** One part of a facet: its name, a bar whose length is the encoding, and the count. */
function Part({ name, note, packages, widest, tone, onPick }) {
  const width = widest > 0 ? Math.max(2, Math.round((packages / widest) * 100)) : 0;
  return html`
    <span class="adm-kn-part">
      <span class="adm-kn-part-l">
        ${onPick
    ? html`<button type="button" class="adm-kn-pick" onClick=${onPick}>${name}</button>`
    : html`<span>${name}</span>`}
        ${note ? html`<b class="adm-kn-flagword">${note}</b>` : null}
      </span>
      <span class="adm-kn-track"><i class=${tone ? 'adm-kn-fill adm-kn-fill--' + tone : 'adm-kn-fill'}
        style=${`width:${width}%`}></i></span>
      <span class="adm-kn-part-n">${num(packages)}</span>
    </span>`;
}

/** One cut of the collection: what it groups by, and its parts. */
function Cut({ title, why, parts, last }) {
  const widest = parts.reduce((m, p) => Math.max(m, p.packages), 0);
  return html`
    <div class="adm-kn-cut ${last ? 'adm-kn-cut--last' : ''}">
      <span><b>${title}</b><span class="adm-why">${why}</span></span>
      <span class="adm-kn-parts">
        ${parts.map(p => html`<${Part} ...${p} widest=${widest} />`)}
      </span>
    </div>`;
}

/**
 * Section 01: the moderation state.
 *
 * The word is whether anything has been reported. On a quiet node that is "nothing flagged", and
 * saying so is what stops an operator scanning every card for a problem that is not there.
 */
export function RightNow({ data, onShowFlagged }) {
  const s = data.summary;
  const authors = data.facets.authors;
  const split = authors.filter(a => a.spellings.length > 1);
  const flagged = s.flagged > 0;

  const stamp = [
    S('now.stampPackages', { n: num(s.total) }),
    S('now.stampAuthors', { n: num(s.authors) }),
    S('now.readAt', { at: fmtTime(new Date()) }),
  ].join(' · ');

  return html`
    <section class="og-sec og-sec--first" id="adm-kn-01">
      <div class="og-sec-h">
        <h2>${S('now.title')}<small>01</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${() => onShowFlagged()}>${S('now.addOwn')}</button>
        </div>
      </div>

      <div class="adm-ov-grid">
        <div>
          <div class="adm-ov-status ${flagged ? 'danger' : ''}">
            ${flagged ? S('now.wordFlagged', { n: num(s.flagged) }) : S('now.wordQuiet')}
          </div>
          <p class="adm-alert-line">${flagged ? S('now.lineFlagged') : S('now.lineQuiet')}</p>
          <div class="adm-ov-up">${stamp}</div>
        </div>

        <div>
          ${Row({
    title: S('now.reported'),
    why: S('now.reportedWhy'),
    chip: flagged
      ? html`<${Badge} type="danger" label=${num(s.flagged)} />`
      : html`<${Badge} type="success" label=${S('now.none')} />`,
    value: S('now.ofTotal', { n: num(s.flagged), total: num(s.total) }),
  })}
          ${Row({
    title: S('now.reviewed'),
    why: S('now.reviewedWhy'),
    chip: s.reviewed_on_page > 0
      ? html`<${Badge} type="info" label=${num(s.reviewed_on_page)} />`
      : html`<${Badge} type="muted" label=${S('now.noneYet')} />`,
    value: S('now.onThisPage', { n: num(s.reviewed_on_page) }),
  })}
          ${Row({
    title: S('now.whoWrote'),
    why: split.length ? S('now.whoWroteSplit') : S('now.whoWroteWhy'),
    chip: split.length
      ? html`<${Badge} type="warning" label=${S('now.spellings', { n: split[0].spellings.length })} />`
      : html`<${Badge} type="muted" label=${num(s.authors)} />`,
    value: authors.length
      ? S('now.topAuthor', { n: num(authors[0].packages), total: num(s.total) })
      : '—',
  })}
          ${Row({
    title: S('now.whatThey'),
    why: S('now.whatTheyWhy'),
    chip: s.one_entry > s.total / 2
      ? html`<${Badge} type="info" label=${S('now.oneImport')} />`
      : html`<${Badge} type="muted" label=${S('now.mixed')} />`,
    value: S('now.oneEntry', { n: num(s.one_entry), total: num(s.total) }),
  })}
          ${Row({
    title: S('now.seenBy'),
    why: S('now.seenByWhy'),
    chip: html`<${Badge} type="info" label=${S('now.publicN', { n: num(s.public) })} />`,
    value: S('now.notPublic', { n: num(s.total - s.public) }),
    last: true,
  })}
        </div>
      </div>

      <div class="og-strip">
        <div>
          <b class=${flagged ? 'adm-kn-coral' : ''}>${num(s.flagged)}</b>
          <span>${S('strip.flagged')}</span>
          <small>${flagged ? S('strip.flaggedSub') : S('strip.flaggedNone')}</small>
        </div>
        <div>
          <b>${num(s.total)}</b><span>${S('strip.packages')}</span>
          <small>${S('strip.packagesSub', { n: num(s.system) })}</small>
        </div>
        <div>
          <b class="adm-kn-dim">${num(s.authors)}</b><span>${S('strip.authors')}</span>
          <small>${split.length ? S('strip.authorsSplit') : S('strip.authorsSub')}</small>
        </div>
        <div>
          <b>${num(s.one_entry)}</b><span>${S('strip.oneEntry')}</span>
          <small>${S('strip.oneEntrySub')}</small>
        </div>
      </div>
    </section>`;
}

/** Section 02: the shape of the collection. */
export function WhatIsHere({ data, onPickAuthor, onPickKind }) {
  const f = data.facets;
  const s = data.summary;
  const undeclared = f.maturity.filter(m => !m.declared);

  const authorParts = f.authors.slice(0, 6).map(a => ({
    name: a.spellings[0],
    note: a.spellings.length > 1 ? S('shape.samePerson', { n: a.spellings.length }) : null,
    packages: a.packages,
    tone: a.spellings.length > 1 ? 'warn' : null,
    onPick: () => onPickAuthor(a.key),
  }));

  const kindParts = f.kinds.slice(0, 6).map(k => ({
    name: t('knowledge.contentType.' + k.name) === 'knowledge.contentType.' + k.name ? k.name : t('knowledge.contentType.' + k.name),
    packages: k.packages,
    onPick: () => onPickKind(k.name),
  }));

  const maturityParts = f.maturity.map(m => ({
    name: m.declared ? t('knowledge.maturity.' + m.name) : m.name,
    note: m.declared ? null : S('shape.notOurs'),
    packages: m.packages,
    tone: m.declared ? null : 'warn',
  }));

  const seenParts = f.visibility.map(v => ({
    name: t('knowledge.visibility.' + v.name) === 'knowledge.visibility.' + v.name ? v.name : t('knowledge.visibility.' + v.name),
    packages: v.packages,
  }));

  return html`
    <section class="og-sec" id="adm-kn-02">
      <div class="og-sec-h">
        <h2>${S('shape.title')}<small>02</small></h2>
      </div>
      <p class="adm-kn-lead">${S('shape.lead')}</p>

      <${Cut} title=${S('shape.byAuthor')} why=${S('shape.byAuthorWhy')} parts=${authorParts} />
      <${Cut} title=${S('shape.byKind')} why=${S('shape.byKindWhy')} parts=${kindParts} />
      <${Cut} title=${S('shape.byMaturity')} why=${S('shape.byMaturityWhy')} parts=${maturityParts} />
      <${Cut} title=${S('shape.bySeen')} why=${S('shape.bySeenWhy')} parts=${seenParts} last=${true} />

      ${undeclared.length ? html`
        <p class="adm-kn-note">${S('shape.undeclaredNote', {
    word: undeclared.map(m => m.name).join(', '),
    n: num(s.undeclared_maturity),
    ours: ['draft', 'review', 'published'].map(k => t('knowledge.maturity.' + k)).join(', '),
  })}</p>` : null}
    </section>`;
}
