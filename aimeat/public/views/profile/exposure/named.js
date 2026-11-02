/**
 * @file public/views/profile/exposure/named.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts of "What others can see" that name who reads (design canvas "Data ulos",
 *   board Mita-muut-nakevat; plan doc-mvwxcas3dom3 D3, D0.2): the named shares (which product, who,
 *   how they read, until when, the last read, and "End share"), the outside parties (no account here,
 *   their shares and keys, when a key was last used, and "Manage" in the Data Wallet), and every data
 *   product at its own level, a private one with its shares, with "Change" on the Offers page. The
 *   shares and parties are the report's own items (GET /v1/exposure/mine, level `named`); the products
 *   are the owner's packages (GET /v1/datapackages) and data products (GET /v1/dataproducts), because a
 *   private product is exposed to nobody and so is not in the report, yet the person asks where it
 *   stands. Made of the component kit.
 * @structure secNamedShares · secParties · secProducts · NAMED_KINDS
 * @usage ${secNamedShares({ items, num, busy, onRevoke })}
 * @version-history
 *   v1.1.0 — 2026-11-01 — "Manage" and "Change" open the Data Wallet party and the product in the
 *     profile (they changed the address only, WP10e B2).
 *   v1.0.0 — 2026-11-01 — Initial (WP9a).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t, tn } from '/js/i18n.js';
import { ago, date as fmtDate } from '/js/format.js';
import { d as dw } from '../offers/data-model.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Cell, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { openTabAt } from '../landing-page.helpers.js';

const x = (key, vars) => (vars && 'n' in vars ? tn(`exposure.${key}`, vars.n, vars) : t(`exposure.${key}`, vars));
const enc = encodeURIComponent;

/** A press on a link to another profile tab opens that tab here (a plain link changed only the address). */
const inProfile = (e) => {
  const href = e.currentTarget?.getAttribute?.('href');
  if (href && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button !== 1 && openTabAt(href)) e.preventDefault();
};

/** The kinds these sections draw, which the list of everything else then leaves out. */
export const NAMED_KINDS = ['named_share', 'outside_party', 'datapackage'];

export function secNamedShares({ items, num, busy, onRevoke, titles }) {
  const shares = items.filter((i) => i.kind === 'named_share' && i.share);
  return html`<${Section} id="ex-shares" num=${num} title=${x('named.sharesTitle')} count=${shares.length} sub=${x('named.sharesSub')}>
    <${List} cols="item-kind-state-doors" keepCols head=${[x('named.colWho'), x('named.colUntil'), x('named.colLastRead'), '']}
      empty=${x('named.sharesEmpty')} rows=${shares} render=${(i) => {
        const s = i.share;
        return html`<${Row} key=${i.id}>
          <${Name} meta=${`${titles[s.package] || s.package} · ${dw('party.keyOf.' + s.party_kind)}`}>${s.party_name}<//>
          <${Cell} meta>${s.expires ? fmtDate(s.expires) : '–'}<//>
          <${Cell} meta>${s.last_read_at ? dw('product.lastRead', { when: ago(s.last_read_at) }) : dw('product.notRead')}<//>
          <${Doors}><${Action} small row tone="danger" disabled=${busy} onClick=${() => onRevoke(i)}>${x('named.revoke')}<//><//>
        <//>`;
      }} />
  <//>`;
}

export function secParties({ items, num }) {
  const parties = items.filter((i) => i.kind === 'outside_party' && i.party);
  return html`<${Section} id="ex-parties" num=${num} title=${x('named.partiesTitle')} count=${parties.length} sub=${x('named.partiesSub')}>
    <${List} cols="item-kind-state-doors" keepCols head=${[x('named.colParty'), x('named.colGets'), x('named.colKeyUsed'), '']}
      empty=${x('named.partiesEmpty')} rows=${parties} render=${(i) => {
        const p = i.party;
        return html`<${Row} key=${i.id}>
          <${Name} meta=${x('named.noAccount')}>${p.display_name}<//>
          <${Cell}>${x('named.sharesKeys', { shares: p.shares, keys: p.keys })}<//>
          <${Cell} meta>${p.key_last_used_at ? x('named.keyUsed', { when: ago(p.key_last_used_at) }) : x('named.keyNotUsed')}<//>
          <${Doors}><${Action} small row href=${`/v1/profile?tab=dataWallet&party=${enc(p.name)}`} onClick=${inProfile}>${x('named.manage')}<//><//>
        <//>`;
      }} />
  <//>`;
}

/** Each data package of the owner at its level; a product's own page changes it. */
export function secProducts({ packages, products, items, num }) {
  const list = (packages || []).filter((p) => p.status !== 'withdrawn' && p.contentHash);
  const isProduct = new Set((products || []).map((p) => p.name));
  const titleOf = Object.fromEntries((products || []).map((p) => [p.name, p.title || p.name]));
  const sharesOf = (name) => items.filter((i) => i.kind === 'named_share' && i.share?.package === name).length;
  return html`<${Section} id="ex-products" num=${num} title=${x('named.productsTitle')} count=${list.length}>
    <${List} cols="item-kind-state-doors" keepCols head=${[x('colWhat'), x('named.colLevel'), x('colWho'), '']}
      empty=${x('named.productsEmpty')} rows=${list} render=${(p) => {
        const vis = String(p.visibility || 'public');
        const level = vis.startsWith('organism:') ? 'organism' : vis;
        const n = sharesOf(p.name);
        return html`<${Row} key=${p.name}>
          <${Name}>${titleOf[p.name] || p.name}<//>
          <${Cell}><${Marks}><${Mark} tone=${level === 'public' ? 'sun' : level === 'private' ? 'dim' : undefined}>${x('named.level.' + level)}<//>${n ? html`<${Mark}>${x('named.plusShares', { n })}<//>` : null}<//><//>
          <${Cell} meta>${level === 'private' ? (n ? x('named.privateShared') : x('named.privateAlone')) : x('named.who.' + level)}<//>
          <${Doors}>${isProduct.has(p.name)
            ? html`<${Action} small row href=${`/v1/profile?tab=offers&product=${enc(p.name)}`} onClick=${inProfile}>${x('named.change')}<//>`
            : html`<${Action} small row href="/v1/profile?tab=memory" onClick=${inProfile}>${x('named.change')}<//>`}<//>
        <//>`;
      }} />
    <${Note} kind="hint">${x('named.productsNote')}<//>
  <//>`;
}
