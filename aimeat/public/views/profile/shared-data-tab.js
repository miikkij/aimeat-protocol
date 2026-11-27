/**
 * @file public/views/profile/shared-data-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Settings "Data you share" (Jakamasi data): every data package the person lets others
 *   use, in one place (WP11; design canvas "Jaettu data", board Jakamasi-data). The screen half of GET
 *   /v1/datapackages/shared; the person's AI reads the same view with aimeat_dataproduct action
 *   "shared", so the page and the chat answer with one list.
 *
 *   IN THE BOARD'S ORDER. The head and its sentence, with the title's question mark
 *   (concept.shared_data); the page's start (PageStart: what the page is for, the prompt that has
 *   one's own AI make a data product, whose button is "Make a data product", and what happens next);
 *   the filters with their counts (All, Public, Named
 *   shares, For sale, Data space); "Data products" with "Make a data product" as the one loud action;
 *   "Shares to people" (each live named share, its package, until when, its last read, with "Data
 *   Wallet" for an outside party and "End share"); "Who reads" (the party read log: who, which package,
 *   the last read and the reads of 30 days). A data product opens as the same page it was on the Offers
 *   page (offers/data-product.js) and "Make a data product" as the same six-step wizard
 *   (offers/wizard.js); only their home changed, so this tab frames them (`ctx.frame`).
 *
 *   ?product=<name> opens one product; an old ?tab=offers&product=<name> arrives here through
 *   landing-page.helpers.js redirectMovedTab. Live data by the `aimeat-live-update` event, never a timer.
 *   Made of the component kit: it passes data and never a class. How the page explains itself:
 *   .claude/rules/page-guidance.md.
 * @structure SharedDataTab (default) · frame · crumbOf
 * @usage registered in views/profile.js TABS as id 'sharedData'
 * @version-history
 *   v1.2.0 — 2026-11-27 — A figure strip under the head (every data product and shared package, those
 *     late or out of date in the notice tone, the named shares, the reads of 30 days) from the view
 *     the page already reads; not drawn while every figure is zero (FigureStrip hideZeros). With
 *     nothing shared the page is section 01 with one line that says what fills it; the filters are
 *     drawn once there is a row to filter, "Shares to people" once there is a share, and "Who reads"
 *     once someone reads or something is shared beyond the person. The numbers and the contents rail
 *     follow what is drawn, and one section has no rail. Every section keeps its id; no control was
 *     removed.
 *   v1.1.0 — 2026-11-08 — The page explains itself the designed way (.claude/rules/page-guidance.md):
 *     PageStart under the head (folded once the person shares a package or has a product; its button
 *     opens the wizard) and the title's question mark, concept.shared_data. The hint at the foot
 *     with the question for one's own AI goes: the start's prompt is that sentence now.
 *   v1.0.0 — 2026-11-02 — Initial (WP11, board Jakamasi-data); the data products moved here from Offers.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { PageStart } from '/components/PageStart.js';
import { FigureStrip } from '/components/FigureStrip.js';
import * as dp from '/js/services/dataproducts.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';
import { ProductPage } from './offers/data-product.js';
import { DataWizard } from './offers/wizard.js';
import { d } from './offers/data-model.js';
import { secFilters, secProducts, secPeople, secReaders, rowsOf, rowNeedsLook, S } from './shared-data/sections.js';

/** The crumb of this tab: Profile › Account › Data you share, then the page's own steps. */
function crumbOf(ctx, parts) {
  const home = () => ctx.pickView({ kind: 'cover' });
  // The product page names "Data products" as its first step, which is this tab itself now.
  const own = (parts || []).filter((p) => !(p && typeof p === 'object' && p.label === d('list.title')));
  return [
    t('nav.profile'), t('profile.landing.menuAccount'),
    own.length ? { label: t('profile.tabs.sharedData'), onClick: home } : t('profile.tabs.sharedData'),
    ...own.map((p, i) => (i === own.length - 1 || !p.go) ? { label: p.label || p, here: true } : { label: p.label, onClick: p.go }),
  ];
}

/** A page inside this tab (a product, the wizard): the same frame the Offers page gave it, under this tab. */
function frame(ctx, { crumbs, label = null, title, marks = null, actions = null, desc = null, strip = null, after = null, wide = false, children }) {
  return html`
    <${SettingsPage} name="op" page crumb=${crumbOf(ctx, crumbs)} label=${label} title=${title} marks=${marks}
      desc=${desc} actions=${actions ? html`<${Actions}>${actions}<//>` : null} strip=${strip} after=${after}
      rail=${wide ? undefined : {
        title: t('profile.tabs.sharedData'),
        groups: [{ label: t('profile.tabs.sharedData'), items: [{ back: true, label: S('back'), onClick: () => ctx.pickView({ kind: 'cover' }) }] }],
      }}>
      ${children}
    <//>`;
}

export default function SharedDataTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  // ?product=<name>, read during the first render: the profile shell rewrites the address on mount.
  const [view, setView] = useState(() => {
    const product = new URLSearchParams(window.location.search).get('product');
    return product ? { kind: 'product', name: product } : { kind: 'cover' };
  });
  const [filter, setFilter] = useState('all');
  const [shared, setShared] = useState(null);       // the view, null while it loads
  const [products, setProducts] = useState(null);
  const [intermediation, setIntermediation] = useState('report');
  const [orgNames, setOrgNames] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([dp.sharedData(), dp.listProducts()]);
      setShared(s || { packages: [], counts: {}, people: [], readers: [] });
      setProducts(p?.products || []);
      if (p?.data_intermediation) setIntermediation(p.data_intermediation);
      setError('');
    } catch (err) { swallowed('shared-data-tab', err); setError(err?.message || S('failed')); setShared((x) => x || { packages: [], counts: {}, people: [], readers: [] }); setProducts((x) => x || []); }
  }, []);
  useEffect(() => { if (session) load(); }, [session, load]);
  useEffect(() => {
    if (!session) return;
    getOrganismsTab().then((tab) => setOrgNames(Object.fromEntries((tab?.mine || []).map((o) => [o.id, o.name || o.id]))))
      .catch((err) => swallowed('shared-data-tab: organisms', err));
  }, [session]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  // Back to the list from a product: the cover; the page of every product is this list now.
  const pickView = (v) => setView(v.kind === 'page' ? { kind: 'cover' } : v);
  const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));

  /** End one named share, after the site's confirm: the next read is refused, copies taken stay. */
  const endShare = (s) => confirm(S('people.endConfirm', { who: s.party_name, what: s.package_title }), async () => {
    setBusy(s.id);
    try { await dp.revokeShare(s.id); showToast?.(S('people.ended', { who: s.party_name })); load(); }
    catch (err) { showToast?.(err?.message || S('failed'), 'error'); }
    setBusy('');
  }, { title: S('people.end'), confirmLabel: S('people.end'), danger: true });

  const ctx = {
    showToast, view, pickView, openTab, confirm, session, frame,
    data: { products, intermediation, orgNames, owner: session?.owner || '', reload: load },
  };

  if (view.kind === 'product') return html`<${ProductPage} key=${view.name} ctx=${ctx} name=${view.name} tab=${view.tab} share=${!!view.share} /><${ConfirmUI} />`;
  if (view.kind === 'wizard') return html`<${DataWizard} ctx=${ctx} /><${ConfirmUI} />`;

  const loading = shared === null || products === null;
  // The start: folded once something is shared or a product exists; its button is the page's wizard.
  const start = html`<${PageStart} id="sharedData" done=${loading ? null : (shared.packages || []).length + products.length > 0}
    action=${{ onClick: () => pickView({ kind: 'wizard' }) }} />`;

  // Where things stand, from the view the page already read: every row of the list (a product, or a
  // package no product builds), those late or out of date (the notice tone: they need the person),
  // the live named shares and the reads of the last 30 days. With nothing at all the strip is not
  // drawn (hideZeros), and the list's one line says what fills the page.
  const rows = loading ? [] : rowsOf(shared, products);
  const oldN = rows.filter(rowNeedsLook).length;
  const people = loading ? [] : (shared.people || []);
  const readers = loading ? [] : (shared.readers || []);
  const strip = loading ? (error ? null : html`<${FigureStrip} loading=${4} />`) : html`<${FigureStrip} wrap hideZeros items=${[
    { key: 'all', n: rows.length, label: d('list.title') },
    { key: 'old', n: oldN, tone: oldN ? 'notice' : undefined, label: d('list.filterOld'), sub: oldN ? S('strip.oldSub') : undefined },
    { key: 'shares', n: people.length, label: S('filter.named') },
    { key: 'reads', n: shared.reads_30d || 0, label: S('strip.reads') },
  ]} />`;

  // What is drawn: the data products always (with nothing shared, its one line is the page's empty
  // line); the shares to people once there is one; who reads once someone read or something is
  // shared beyond the person (its note says what is not counted). Numbered as drawn; the contents
  // rail only for two or more.
  const beyondOwn = (shared?.packages || []).some((p) => p.audience && p.audience !== 'private');
  const shown = loading ? [] : [
    { id: 'sd-products', label: d('list.title'), count: rows.length },
    people.length ? { id: 'sd-people', label: S('people.title'), count: people.length } : null,
    readers.length || people.length || beyondOwn ? { id: 'sd-readers', label: S('readers.title'), count: readers.length } : null,
  ].filter(Boolean).map((s, i) => ({ ...s, num: String(i + 1).padStart(2, '0') }));
  const numOf = Object.fromEntries(shown.map((s) => [s.id, s.num]));
  const railed = shown.length > 1;
  return html`
    <${SettingsPage}
      crumb=${crumbOf(ctx, [])}
      title=${S('title')}
      help="concept.shared_data"
      desc=${S('lead')}
      strip=${strip}
      start=${start}
      railTitle=${railed ? t('profile.landing.railTitle') : undefined} sections=${railed ? shown : undefined}
      after=${html`<${ConfirmUI} />`}>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${loading ? html`<${Note} kind="loading" />` : html`
        ${rows.length ? secFilters({ counts: shared.counts || {}, filter, setFilter }) : null}
        ${secProducts({ ctx, shared, products, filter: rows.length ? filter : 'all', orgNames, num: numOf['sd-products'], empty: rows.length ? undefined : S('emptyAll') })}
        ${numOf['sd-people'] ? secPeople({ people, busy, onEnd: endShare, num: numOf['sd-people'] }) : null}
        ${numOf['sd-readers'] ? secReaders({ readers, num: numOf['sd-readers'] }) : null}`}
    <//>`;
}
