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
 *   - RightNow (01) — the word, the five readings, the strip
 *   - WhatIsHere (02) — the facets, each part with a bar (components/CountBars.js, its wide look)
 * @usage Imported by views/admin/knowledge-tab.js.
 * @version-history
 *   v2.1.0 — 2026-09-27 — The facets are CountBars in its wide look (FacetBars folded into it: one
 *     component for counts per key drawn as bars); a part's count is `count`, no longer `n`.
 *   v2.0.0 — 2026-09-27 — Every part is a library component that gets data (admin page group G7): the
 *     sections are Section, the state and its five rows the Verdict with its Readings, the strip the
 *     FigureStrip, each facet the FacetBars component (its bar and its warning tone moved there from
 *     this file's Part and Cut). No class.
 *   v1.1.0 -- 2026-09-13 -- Compose shared B1 headings; facet ratios use SVG width data.
 *   v1.0.0 — 2026-09-12 — Initial (the Knowledge page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { num, Badge } from './shared.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { CountBars } from '/components/CountBars.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';

const S = (key, params) => t('admin.knowledge.' + key, params);

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
    <${Section} first id="adm-kn-01" num="01" title=${S('now.title')}
      doors=${html`<${Action} small soft onClick=${() => onShowFlagged()}>${S('now.addOwn')}<//>`}>
      <${Verdict} tone=${flagged ? 'danger' : undefined}
        word=${flagged ? S('now.wordFlagged', { n: num(s.flagged) }) : S('now.wordQuiet')}
        line=${flagged ? S('now.lineFlagged') : S('now.lineQuiet')} stamp=${stamp}>
        <${Readings} rows=${[
          {
            key: 'reported', name: S('now.reported'), why: S('now.reportedWhy'),
            mark: flagged
              ? html`<${Badge} type="danger" label=${num(s.flagged)} />`
              : html`<${Badge} type="success" label=${S('now.none')} />`,
            value: S('now.ofTotal', { n: num(s.flagged), total: num(s.total) }),
          },
          {
            key: 'reviewed', name: S('now.reviewed'), why: S('now.reviewedWhy'),
            mark: s.reviewed_on_page > 0
              ? html`<${Badge} type="info" label=${num(s.reviewed_on_page)} />`
              : html`<${Badge} type="muted" label=${S('now.noneYet')} />`,
            value: S('now.onThisPage', { n: num(s.reviewed_on_page) }),
          },
          {
            key: 'who', name: S('now.whoWrote'), why: split.length ? S('now.whoWroteSplit') : S('now.whoWroteWhy'),
            mark: split.length
              ? html`<${Badge} type="warning" label=${S('now.spellings', { n: split[0].spellings.length })} />`
              : html`<${Badge} type="muted" label=${num(s.authors)} />`,
            value: authors.length
              ? S('now.topAuthor', { n: num(authors[0].packages), total: num(s.total) })
              : '—',
          },
          {
            key: 'what', name: S('now.whatThey'), why: S('now.whatTheyWhy'),
            mark: s.one_entry > s.total / 2
              ? html`<${Badge} type="info" label=${S('now.oneImport')} />`
              : html`<${Badge} type="muted" label=${S('now.mixed')} />`,
            value: S('now.oneEntry', { n: num(s.one_entry), total: num(s.total) }),
          },
          {
            key: 'seen', name: S('now.seenBy'), why: S('now.seenByWhy'),
            mark: html`<${Badge} type="info" label=${S('now.publicN', { n: num(s.public) })} />`,
            value: S('now.notPublic', { n: num(s.total - s.public) }),
            last: true,
          },
        ]} />
      <//>

      <${FigureStrip} wrap items=${[
        { key: 'flagged', n: num(s.flagged), tone: flagged ? 'notice' : undefined, label: S('strip.flagged'), sub: flagged ? S('strip.flaggedSub') : S('strip.flaggedNone') },
        { key: 'packages', n: num(s.total), label: S('strip.packages'), sub: S('strip.packagesSub', { n: num(s.system) }) },
        { key: 'authors', n: num(s.authors), tone: 'dim', label: S('strip.authors'), sub: split.length ? S('strip.authorsSplit') : S('strip.authorsSub') },
        { key: 'oneEntry', n: num(s.one_entry), label: S('strip.oneEntry'), sub: S('strip.oneEntrySub') },
      ]} />
    <//>`;
}

/** Section 02: the shape of the collection. */
export function WhatIsHere({ data, onPickAuthor, onPickKind }) {
  const f = data.facets;
  const s = data.summary;
  const undeclared = f.maturity.filter(m => !m.declared);

  const authorParts = f.authors.slice(0, 6).map(a => ({
    key: a.key,
    name: a.spellings[0],
    note: a.spellings.length > 1 ? S('shape.samePerson', { n: a.spellings.length }) : null,
    count: a.packages,
    tone: a.spellings.length > 1 ? 'warn' : null,
    onPick: () => onPickAuthor(a.key),
  }));

  const kindParts = f.kinds.slice(0, 6).map(k => ({
    key: k.name,
    name: t('knowledge.contentType.' + k.name) === 'knowledge.contentType.' + k.name ? k.name : t('knowledge.contentType.' + k.name),
    count: k.packages,
    onPick: () => onPickKind(k.name),
  }));

  const maturityParts = f.maturity.map(m => ({
    key: m.name,
    name: m.declared ? t('knowledge.maturity.' + m.name) : m.name,
    note: m.declared ? null : S('shape.notOurs'),
    count: m.packages,
    tone: m.declared ? null : 'warn',
  }));

  const seenParts = f.visibility.map(v => ({
    key: v.name,
    name: t('knowledge.visibility.' + v.name) === 'knowledge.visibility.' + v.name ? v.name : t('knowledge.visibility.' + v.name),
    count: v.packages,
  }));

  return html`
    <${Section} id="adm-kn-02" num="02" title=${S('shape.title')}>
      <${Note} kind="lead">${S('shape.lead')}<//>

      <${CountBars} wide title=${S('shape.byAuthor')} why=${S('shape.byAuthorWhy')} rows=${authorParts} />
      <${CountBars} wide title=${S('shape.byKind')} why=${S('shape.byKindWhy')} rows=${kindParts} />
      <${CountBars} wide title=${S('shape.byMaturity')} why=${S('shape.byMaturityWhy')} rows=${maturityParts} />
      <${CountBars} wide title=${S('shape.bySeen')} why=${S('shape.bySeenWhy')} rows=${seenParts} last=${true} />

      ${undeclared.length ? html`
        <${Note}>${S('shape.undeclaredNote', {
    word: undeclared.map(m => m.name).join(', '),
    n: num(s.undeclared_maturity),
    ours: ['draft', 'review', 'published'].map(k => t('knowledge.maturity.' + k)).join(', '),
  })}<//>` : null}
    <//>`;
}
