/**
 * @file compliance-tab.shared-data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The list behind each of the four figures of section 12, data intermediation, on the admin
 *   Compliance page (WP11; design canvas "Jaettu data", board Admin-aineistot). A figure is a button;
 *   the list under the section names what it counts: the dataset, its owner, who it is shared with, its
 *   licence, its readers in 30 days and whether it is up to date. No new page.
 *
 *   The rows are `data_intermediation.shared_data` of GET /v1/admin/compliance/report
 *   (services/datapackage/shared-data.ts nodeSharedData, built on the one function that decides what a
 *   listing of data packages names), and for what a figure counts that is not a data package (an
 *   EXCHANGE offering of an extension, an app, a contract on a capability) the finding's own items. The
 *   operator sees names, owners, audiences and counts: never a row of data and never a named
 *   recipient, whose share is a count.
 *
 *   SharedDataPrint is the same list as document text for section 9 of the printout.
 *   Made of the component kit: it passes data and never a class.
 * @structure FIGURES · rowsFor · SharedDataList (default) · SharedDataPrint
 * @usage html`<${SharedDataList} di=${di} which=${'offerings'} />`
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (WP11, board Admin-aineistot).
 */
import { h } from 'preact';
import htm from 'htm';
import { t, tn } from '/js/i18n.js';
import { num } from '/js/format.js';
import { DataTable } from '/components/DataTable.js';
import { Mark, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { PrintTable } from '/components/PrintPage.js';
import { d as dw, freshWord, FRESH_TONE } from '../profile/offers/data-model.js';
import { licenceOf, shortLicence } from '../profile/offers/data-words.js';

const html = htm.bind(h);
const D = (key, vars) => (vars && 'n' in vars ? tn('admin.compliance.di.list.' + key, vars.n, vars) : t('admin.compliance.di.list.' + key, vars));

/** The four figures, in the strip's order. */
export const FIGURES = ['offerings', 'buyers', 'organisms', 'apps'];

const findingItems = (di, id) => (di?.findings || []).filter((f) => f.id === id || f.kind === id).flatMap((f) => f.items || []);

/** Who a package is shared with, as the operator reads it: a level or an organism. */
function audienceOf(r) {
  const a = String(r.audience || 'private');
  return a.startsWith('organism:') ? dw('audience.organismOf', { name: r.organism_name || a.slice(9) }) : dw('audience.' + (['public', 'members', 'private'].includes(a) ? a : 'private'));
}

/**
 * The rows behind one figure: the packages it counts, then what it counts that is no data package,
 * each as { title, name, owner, audience, licence, readers, state } with `package` false for the latter.
 */
export function rowsFor(di, which) {
  const rows = di?.shared_data?.rows || [];
  const pkg = (r) => ({
    package: true, open: r.audience === 'public', title: r.title, name: r.name, owner: r.owner, audience: audienceOf(r),
    extra: r.named_shares ? D('named', { n: r.named_shares }) : '', licence: r.license || '', readers: r.readers_30d, state: r.freshness,
  });
  if (which === 'offerings') {
    // A data package offering is its package's row; an offering of an extension's data is a row of its own.
    const listed = rows.filter((r) => r.offered).map(pkg);
    const others = findingItems(di, 'data_offering_public').filter((o) => o.kind !== 'datapackage')
      .map((o) => ({ package: false, title: o.title, name: o.offering_id, owner: o.provider, audience: D('exchangeAll'), licence: '', readers: null, state: null }));
    return [...listed, ...others];
  }
  if (which === 'buyers') {
    const withBuyers = rows.filter((r) => r.outside_buyers > 0).map((r) => {
      const p = pkg(r);
      return { ...p, extra: [p.extra, D('buyers', { n: r.outside_buyers })].filter(Boolean).join(' · ') };
    });
    const covered = new Set(rows.filter((r) => r.outside_buyers > 0).map((r) => r.name.split('/').pop()));
    const others = findingItems(di, 'contract_outside_buyer').filter((c) => !covered.has(String(c.capability || '').split(' v')[0]))
      .map((c) => ({ package: false, title: c.capability, name: c.entitlement_id, owner: c.provider, audience: D('buyer', { who: c.buyer }), licence: '', readers: null, state: null }));
    return [...withBuyers, ...others];
  }
  if (which === 'organisms') return rows.filter((r) => r.open_organism).map(pkg);
  if (which === 'apps') {
    return findingItems(di, 'app_open_registration_commerce')
      .map((a) => ({ package: false, title: a.app, name: a.app, owner: a.owner, audience: D('openRegistration'), licence: '', readers: null, state: null }));
  }
  return [];
}

const licenceWord = (id) => (id ? shortLicence(licenceOf({ aimeat: { license: id } })) : '–');

/** The list under section 12 for the figure `which`. */
export default function SharedDataList({ di, which }) {
  if (!which) return null;
  const rows = rowsFor(di, which);
  return html`
    <${SubHeading} rule>${D('heading.' + which)}<//>
    ${rows.length ? html`<${DataTable} scroll stack headers=${[D('col.dataset'), D('col.owner'), D('col.audience'), D('col.licence'), D('col.readers'), D('col.state')]}
      rows=${rows.map((r) => [
        html`${r.title} <${Code}>${r.name}<//>`,
        r.owner,
        html`<${Mark} tone=${r.open ? 'sun' : undefined}>${r.audience}<//>${r.extra ? html` ${r.extra}` : null}`,
        licenceWord(r.licence),
        r.readers === null ? '–' : num(r.readers),
        r.state ? html`<${Mark} kind="status" tone=${FRESH_TONE[r.state] || 'off'}>${freshWord(r.state)}<//>` : '–',
      ])} />` : html`<${Note} kind="quiet">${D('empty')}<//>`}
    ${di?.shared_data?.capped ? html`<${Note} kind="hint">${D('capped', { n: di.shared_data.total })}<//>` : null}
    <${Note} kind="hint">${D('privacy')}<//>`;
}

/** The same lists as document text, for the printout's section on data intermediation. */
export function SharedDataPrint({ di }) {
  if (!di?.shared_data) return null;
  return html`${FIGURES.map((which) => {
    const rows = rowsFor(di, which);
    return html`<${Note} kind="quiet" key=${'h' + which}>${D('heading.' + which)}<//>
      ${rows.length ? html`<${PrintTable} key=${'t' + which} head=${[D('col.dataset'), D('col.owner'), D('col.audience'), D('col.licence'), D('col.readers'), D('col.state')]}
        rows=${rows.map((r) => [`${r.title} (${r.name})`, r.owner, [r.audience, r.extra].filter(Boolean).join(' · '), licenceWord(r.licence), r.readers === null ? '–' : num(r.readers), r.state ? freshWord(r.state) : '–'])} />`
        : html`<${Note} kind="quiet" key=${'e' + which}>${D('empty')}<//>`}`;
  })}<${Note} kind="quiet">${D('privacy')}<//>`;
}
