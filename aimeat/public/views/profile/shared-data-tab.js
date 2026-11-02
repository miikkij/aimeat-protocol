/**
 * @file public/views/profile/shared-data-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Settings "Data you share" (Jakamasi data): every data package the person lets others
 *   use, in one place (WP11; design canvas "Jaettu data", board Jakamasi-data). The screen half of GET
 *   /v1/datapackages/shared; the person's AI reads the same view with aimeat_dataproduct action
 *   "shared", so the page and the chat answer with one list.
 *
 *   IN THE BOARD'S ORDER. The head and its sentence; the filters with their counts (All, Public, Named
 *   shares, For sale, Data space); "Data products" with "Make a data product" as the one loud action;
 *   "Shares to people" (each live named share, its package, until when, its last read, with "Data
 *   Wallet" for an outside party and "End share"); "Who reads" (the party read log: who, which package,
 *   the last read and the reads of 30 days). A data product opens as the same page it was on the Offers
 *   page (offers/data-product.js) and "Make a data product" as the same six-step wizard
 *   (offers/wizard.js); only their home changed, so this tab frames them (`ctx.frame`).
 *
 *   ?product=<name> opens one product; an old ?tab=offers&product=<name> arrives here through
 *   landing-page.helpers.js redirectMovedTab. Live data by the `aimeat-live-update` event, never a timer.
 *   Made of the component kit: it passes data and never a class.
 * @structure SharedDataTab (default) · frame · crumbOf
 * @usage registered in views/profile.js TABS as id 'sharedData'
 * @version-history
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
import * as dp from '/js/services/dataproducts.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';
import { ProductPage } from './offers/data-product.js';
import { DataWizard } from './offers/wizard.js';
import { d } from './offers/data-model.js';
import { secFilters, secProducts, secPeople, secReaders, S } from './shared-data/sections.js';

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
  return html`
    <${SettingsPage}
      crumb=${crumbOf(ctx, [])}
      title=${S('title')}
      desc=${S('lead')}
      after=${html`<${ConfirmUI} />`}>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${loading ? html`<${Note} kind="loading" />` : html`
        ${secFilters({ counts: shared.counts || {}, filter, setFilter })}
        ${secProducts({ ctx, shared, products, filter, orgNames })}
        ${secPeople({ people: shared.people || [], busy, onEnd: endShare })}
        ${secReaders({ readers: shared.readers || [] })}
        <${Note} kind="hint">${S('askAi')}<//>`}
    <//>`;
}
