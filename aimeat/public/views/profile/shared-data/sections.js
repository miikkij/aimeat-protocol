/**
 * @file public/views/profile/shared-data/sections.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts of "Data you share" (WP11; design canvas "Jaettu data", board Jakamasi-data):
 *   the filters with their counts, the data products, the shares to people and who reads. The rows come
 *   from GET /v1/datapackages/shared (services/datapackage/shared-data.ts) and the products from
 *   GET /v1/dataproducts; a package a product builds is one row, a package published without a product
 *   is a row of its own, and a product that has not run yet stands under All only.
 *   Made of the component kit: it passes data and never a class.
 * @structure S · secFilters · secProducts · secPeople · secReaders
 * @usage ${secProducts({ ctx, shared, products, filter, orgNames })}
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (WP11).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, tn } from '/js/i18n.js';
import { date as fmtDate, dateTime } from '/js/format.js';
import { Section } from '/components/Section.js';
import { Tabs } from '/components/Tabs.js';
import { List, Row, Name, Who, When, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { d, FRESH_TONE, freshWord, audienceWord } from '../offers/data-model.js';
import { wordsOf, licenceOf, shortLicence } from '../offers/data-words.js';
import { openTabAt } from '../landing-page.helpers.js';

/** The page's words: sharedData.<key>, the plural form when `n` is given. */
export const S = (key, vars) => (vars && 'n' in vars ? tn('sharedData.' + key, vars.n, vars) : t('sharedData.' + key, vars));
const enc = encodeURIComponent;
/** A moment as the reader writes it, to the minute: "1.11.2026 klo 21.55". */
const when = (s) => dateTime(s, { dateStyle: 'short', timeStyle: 'short' });
const FILTERS = ['all', 'public', 'named', 'sale', 'space'];

/** A press on a link to another profile tab opens that tab here. */
const inProfile = (e) => {
  const href = e.currentTarget?.getAttribute?.('href');
  if (href && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button !== 1 && openTabAt(href)) e.preventDefault();
};

export function secFilters({ counts, filter, setFilter }) {
  return html`<${Tabs} tone="filter" label=${S('filterLabel')} value=${filter} onSelect=${setFilter}
    items=${FILTERS.map((f) => ({ value: f, label: S('filter.' + f), count: counts[f] ?? 0 }))} />`;
}

/** One row per product and per package that no product builds, the newest first. */
function rowsOf(shared, products) {
  const pkgs = shared.packages || [];
  const byName = new Map(pkgs.map((p) => [p.name, p]));
  const rows = (products || []).map((p) => ({ name: p.name, product: p, pkg: byName.get(p.name) || null }));
  for (const p of pkgs) if (!rows.some((r) => r.name === p.name)) rows.push({ name: p.name, product: null, pkg: p });
  return rows;
}

/** Who may read it, in words, and the line under: where it is read, or who it is shared with. */
function whoOf(pkg, product, orgNames) {
  const audience = pkg?.audience || product?.visibility || 'private';
  const names = (pkg?.shares || []).map((s) => s.party_name);
  if (audience === 'public') return { who: S('who.public'), sub: S('who.publicSub') };
  if (audience === 'members') return { who: S('who.members'), sub: names.length ? names.join(', ') : undefined };
  if (String(audience).startsWith('organism:')) return { who: audienceWord(audience, { ...orgNames, ...(pkg?.organism_name ? { [audience.slice(9)]: pkg.organism_name } : {}) }), sub: names.length ? names.join(', ') : undefined };
  return names.length ? { who: names.join(', '), sub: S('who.namedSub') } : { who: S('who.private'), sub: undefined };
}

export function secProducts({ ctx, shared, products, filter, orgNames }) {
  const all = rowsOf(shared, products);
  const list = filter === 'all' ? all : all.filter((r) => (r.pkg?.filters || []).includes(filter));
  const doors = html`<${Loud} onClick=${() => ctx.pickView({ kind: 'wizard' })}>${S('make')}<//>`;
  return html`<${Section} id="sd-products" num="01" title=${d('list.title')} count=${list.length} doors=${doors}>
    <${List} cols="name-who-when-doors" head=${[S('col.product'), S('col.who'), S('col.reads'), '']}
      empty=${filter === 'all' ? d('list.empty') : S('emptyFilter')} rows=${list} render=${(r) => {
        const p = r.pkg;
        const words = wordsOf({ title: r.product?.title || p?.title || r.name, description: p?.description, i18n: p?.i18n });
        const licence = p?.license ? licenceOf({ aimeat: { license: p.license } }) : null;
        const state = p?.freshness?.state || (p ? 'unscheduled' : 'unpublished');
        const audience = p?.audience || r.product?.visibility || 'private';
        const open = r.product ? () => ctx.pickView({ kind: 'product', name: r.name }) : undefined;
        const datasetHref = p ? `/v1/dataset/${enc(p.owner)}/${enc(p.name)}` : undefined;
        const { who, sub } = whoOf(p, r.product, orgNames);
        const marks = [
          html`<${Mark} tone=${audience === 'public' ? 'sun' : undefined}>${audienceWord(audience, { ...orgNames, ...(p?.organism_name ? { [String(audience).slice(9)]: p.organism_name } : {}) })}<//>`,
          licence ? html`<${Mark}>${shortLicence(licence)}<//>` : null,
          html`<${Mark} kind="status" tone=${FRESH_TONE[state] || 'off'}>${freshWord(state)}<//>`,
          p?.shares?.length ? html`<${Mark}>${S('sharesN', { n: p.shares.length })}<//>` : null,
          p?.sale ? html`<${Mark}>EXCHANGE<//>` : null,
          p?.dataspace ? html`<${Mark}>${S('filter.space')}<//>` : null,
        ].filter(Boolean);
        return html`<${Row} key=${r.name}>
          <${Name} onOpen=${open} href=${open ? undefined : datasetHref} marks=${marks}>${words.title}<//>
          <${Who} sub=${sub}>${who}<//>
          <${When} at=${p ? S('reads30', { n: p.reads_30d || 0 }) : undefined}>${p?.last_read_at ? S('lastRead', { when: when(p.last_read_at) }) : p ? S('updated', { date: fmtDate(p.updated_at) }) : d('fresh.unpublished')}<//>
          <${Doors}>
            ${open ? html`<${Action} small row onClick=${open}>${d('list.open')}<//>` : datasetHref ? html`<${Action} small row href=${datasetHref}>${d('list.open')}<//>` : null}
            ${p?.landing_url ? html`<${Action} small row href=${`/v1/dataset/${enc(p.owner)}/${enc(p.name)}`} newTab>${S('publicPage')}<//>` : null}
          <//>
        <//>`;
      }} />
  <//>`;
}

export function secPeople({ people, busy, onEnd }) {
  return html`<${Section} id="sd-people" num="02" title=${S('people.title')} count=${people.length} sub=${S('people.sub')}>
    <${List} cols="name-who-when-doors" head=${[S('people.colWho'), S('people.colWhat'), S('people.colUntil'), '']}
      empty=${S('people.empty')} rows=${people} render=${(s) => html`<${Row} key=${s.id}>
        <${Name} meta=${d('party.keyOf.' + (['program', 'person', 'dataspace', 'visitor'].includes(s.party_kind) ? s.party_kind : 'program'))}>${s.party_name}<//>
        <${Who}>${s.package_title}<//>
        <${When} at=${s.last_read_at ? S('lastRead', { when: when(s.last_read_at) }) : d('product.notRead')}>${s.expires ? S('until', { date: fmtDate(s.expires) }) : S('noEnd')}<//>
        <${Doors}>
          ${s.party_kind === 'visitor' ? null : html`<${Action} small row href=${`/v1/profile?tab=dataWallet&party=${enc(s.party)}`} onClick=${inProfile}>${t('profile.tabs.dataWallet')}<//>`}
          <${Action} small row tone="danger" disabled=${busy === s.id} onClick=${() => onEnd(s)}>${S('people.end')}<//>
        <//>
      <//>`} />
  <//>`;
}

/** The endpoint kinds a reader read through, in words (the read log's `what`). */
const viaWords = (via) => [...new Set((via || []).map((k) => S('via.' + (['odata', 'file', 'rows', 'descriptor', 'versions', 'odps'].includes(k) ? k : 'other'))))].join(', ');

export function secReaders({ readers }) {
  return html`<${Section} id="sd-readers" num="03" title=${S('readers.title')} count=${readers.length} sub=${S('readers.sub')}>
    <${List} cols="name-who-when-doors" head=${[S('readers.colWho'), S('readers.colWhat'), S('readers.colLast'), '']}
      empty=${S('readers.empty')} rows=${readers} render=${(r, i) => html`<${Row} key=${`${r.who}|${r.package}|${i}`}>
        <${Name} meta=${viaWords(r.via) || undefined}>${r.who}<//>
        <${Who}>${r.package_title}<//>
        <${When} at=${S('reads30', { n: r.reads_30d })}>${when(r.last_read_at)}<//>
        <${Doors} />
      <//>`} />
    <${Note} kind="hint">${S('readers.note')}<//>
  <//>`;
}
