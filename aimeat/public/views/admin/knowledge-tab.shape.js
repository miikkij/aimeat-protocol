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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, the metric rows, the
 *     numeral band, each cut a list row and each part a shared progress meter.
 *   v1.1.0 -- 2026-09-13 -- Compose shared B1 headings; facet ratios use SVG width data.
 *   v1.0.0 — 2026-09-12 — Initial (the Knowledge page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { num, Badge, Row } from './shared.js';
import { Section, Columns, Stack, ListRow, NumeralBand, Meter, Action, Text } from '/components/poster-parts.js';

const S = (key, params) => t('admin.knowledge.' + key, params);

/** One part of a facet: its name, a bar whose length is the encoding, and the count. */
function Part({ name, note, packages, widest, onPick }) {
  return html`<${Stack} density="compact">
    <${Stack} direction="horizontal" align="between" density="compact">
      <${Stack} direction="wrap" align="center" density="compact">
        ${onPick ? html`<${Action} kind="text" onClick=${onPick}>${name}<//>` : html`<span>${name}</span>`}
        ${note ? html`<${Text} kind="mono" tone="coral">${note}<//>` : null}
      <//>
      <${Text} kind="mono">${num(packages)}<//>
    <//>
    <${Meter} kind="progress" value=${packages} max=${widest || 1} label=${name} />
  <//>`;
}

/** One cut of the collection: what it groups by, and its parts. */
function Cut({ title, why, parts }) {
  const widest = parts.reduce((m, p) => Math.max(m, p.packages), 0);
  return html`<${ListRow} name=${title} detail=${why} detailKind="text">
    <${Stack}>${parts.map((p, i) => html`<${Part} key=${i} ...${p} widest=${widest} />`)}<//>
  <//>`;
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

  return html`<${Section} id="adm-kn-01" title=${S('now.title')} count="01"
    actions=${html`<${Action} onClick=${() => onShowFlagged()}>${S('now.addOwn')}<//>`}>
    <${Stack}>
      <${Columns} layout="trailing" collapse=${900}>
        <${Stack} density="compact">
          <${Text} kind="number" size="large" tone=${flagged ? 'danger' : 'plain'}>
            ${flagged ? S('now.wordFlagged', { n: num(s.flagged) }) : S('now.wordQuiet')}<//>
          <${Text} kind="lead">${flagged ? S('now.lineFlagged') : S('now.lineQuiet')}<//>
          <${Text} kind="mono" tone="muted">${stamp}<//>
        <//>

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
  })}
        </div>

      <//>

      <${NumeralBand} tone="plain" items=${[
        { label: S('strip.flagged'), value: num(s.flagged), note: flagged ? S('strip.flaggedSub') : S('strip.flaggedNone'), tone: flagged ? 'coral' : undefined },
        { label: S('strip.packages'), value: num(s.total), note: S('strip.packagesSub', { n: num(s.system) }) },
        { label: S('strip.authors'), value: num(s.authors), note: split.length ? S('strip.authorsSplit') : S('strip.authorsSub') },
        { label: S('strip.oneEntry'), value: num(s.one_entry), note: S('strip.oneEntrySub') },
      ]} />
    <//>
  <//>`;
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
  }));

  const seenParts = f.visibility.map(v => ({
    name: t('knowledge.visibility.' + v.name) === 'knowledge.visibility.' + v.name ? v.name : t('knowledge.visibility.' + v.name),
    packages: v.packages,
  }));

  return html`<${Section} id="adm-kn-02" title=${S('shape.title')} count="02" description=${S('shape.lead')}>
    <${Stack}>
      <div>
        <${Cut} title=${S('shape.byAuthor')} why=${S('shape.byAuthorWhy')} parts=${authorParts} />
        <${Cut} title=${S('shape.byKind')} why=${S('shape.byKindWhy')} parts=${kindParts} />
        <${Cut} title=${S('shape.byMaturity')} why=${S('shape.byMaturityWhy')} parts=${maturityParts} />
        <${Cut} title=${S('shape.bySeen')} why=${S('shape.bySeenWhy')} parts=${seenParts} />
      </div>

      ${undeclared.length ? html`<${Text} kind="caption" tone="muted">${S('shape.undeclaredNote', {
        word: undeclared.map(m => m.name).join(', '),
        n: num(s.undeclared_maturity),
        ours: ['draft', 'review', 'published'].map(k => t('knowledge.maturity.' + k)).join(', '),
      })}<//>` : null}
    <//>
  <//>`;
}
