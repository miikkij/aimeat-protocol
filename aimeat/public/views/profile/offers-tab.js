/**
 * @file offers-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Offers: a person's own fleet as a shop window. Loads every agent's published
 *   offers and everything the agents delivered, derives the cover's model from them (offers/model.js)
 *   and renders the poster face (offers/cover.js): what came back, what runs on its own, what can
 *   be asked, whose agent is away, what is for sale; an offer and a delivery each as its own page.
 *   The handlers here call the same services the old card called: ask (mode-aware), the AI need
 *   router, the builder, billing, rating, and a delivery's content.
 * @structure default OffersTab({ session, showToast }) — state, loads, handlers, the ctx bag, render
 * @version-history
 *   v2.0.0 -- 2026-08-30 -- The poster face (design canvas "AIMEAT Tarjoaman sivu", direction A). The
 *     Do/Map/Inbox segments, the facet panel and the wall of opened cards are replaced by the cover
 *     and the pages; grouping honours an offer's own `need`. Every service call is unchanged.
 *   v1.5.1 -- 2026-06-16 -- Clickable Mermaid map: a node click opens that offer's card.
 *   v1.5.0 -- 2026-06-16 -- Findability: Do/Map/Inbox segments; facets + group-by + standing sort;
 *     a Mermaid orientation map; crew-forge "build for this need"; the AI need-router.
 *   v1.4.0 -- 2026-06-16 -- Richer card: structured sample, per-offer recent runs, prerequisites, bundles.
 *   v1.3.0 -- 2026-06-13 -- Image deliverables rendered inline via the shared ImageDeliverable renderer.
 *   v1.2.0 -- 2026-06-12 -- Inbox shows the real deliverable (markdown-rendered); "Requested" links to it.
 *   v1.1.0 -- 2026-06-12 -- Billable offers: price/visibility badges + an owner Selling editor.
 *   v1.0.0 -- 2026-06-12 -- Initial v1: Do feed + offer detail + mode-aware Ask + provenance footer.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import * as offersService from '/js/services/offers.js';
import { swallowed } from '/js/swallowed.js';
import { buildModel } from './offers/model.js';
import { renderOffersView } from './offers/cover.js';

export default function OffersTab({ session, showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [feed, setFeed] = useState(null);           // null = loading
  const [deliverables, setDeliverables] = useState(null);
  const [view, setView] = useState({ kind: 'cover' });
  const [q, setQ] = useState('');
  const [axis, setAxis] = useState('need');
  const [busy, setBusy] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const [aiResult, setAiResult] = useState(null);  // null | 'loading' | { ranked, noMatch, brief }
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [sellFoldOpen, setSellFoldOpen] = useState(false);
  const [inboxFilter, setInboxFilter] = useState('all');
  const [moreOpen, setMoreOpen] = useState(() => new Set());
  const [askInput, setAskInputAll] = useState({});   // offer key → the request text
  const [askResult, setAskResultAll] = useState({}); // offer key → what the ask returned
  const [contents, setContents] = useState({});      // task id → value | 'loading' | null

  const load = useCallback(async () => {
    try {
      const r = await offersService.listOffers();
      setFeed(r?.data?.agents || []);
    } catch (err) { swallowed('offers-tab', err); setFeed([]); }
    try {
      const r = await offersService.listDeliverables();
      setDeliverables(r?.data?.deliverables || []);
    } catch (err) { swallowed('offers-tab: deliverables', err); setDeliverables([]); }
  }, []);
  useEffect(() => { if (session) load(); }, [session, load]);
  useEffect(() => { if (session) offersService.aiAvailable().then(setAiOn).catch(() => setAiOn(false)); }, [session]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  const model = useMemo(() => buildModel({ feed: feed || [], deliverables: deliverables || [], now: new Date() }), [feed, deliverables]);

  // The builder offer (crew-forge): the "no match → make one" path.
  const builder = model.items.find(it => (it.offer.consequences || []).some(x => x.type === 'creates-agent')) || model.items.find(it => /forge/i.test(it.agent)) || null;

  const pickView = (v) => {
    setView(v);
    setSellFoldOpen(!!v.sell);
    if (v.kind === 'page' && v.id === 'inbox' && v.filter) setInboxFilter(v.filter);
    if (v.kind === 'deliverable') ensureContent(v.taskId);
  };
  const toggleMore = (id) => setMoreOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const openTab = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));
  const setAskInput = (key, v) => setAskInputAll(prev => ({ ...prev, [key]: v }));

  // A delivery's content is fetched when its page opens; the record itself is already here.
  const ensureContent = (taskId) => {
    const d = (deliverables || []).find(x => x.task_id === taskId);
    if (!d || d.status === 'failed' || !d.agent_gaii || contents[taskId] !== undefined) return;
    setContents(prev => ({ ...prev, [taskId]: 'loading' }));
    offersService.getDeliverableContent({ agentGaii: d.agent_gaii, deliverableKey: d.deliverable_key, taskId: d.task_id })
      .then(v => setContents(prev => ({ ...prev, [taskId]: v ?? null })))
      .catch(err => { swallowed('offers-tab: content', err); setContents(prev => ({ ...prev, [taskId]: null })); });
  };
  const contentOf = (d) => contents[d.task_id];

  // Ask: schedule-born → fired now; a task-runner → a queued task; else a prompt copied for the chat.
  const doAsk = async (it) => {
    setBusy(true);
    try {
      const r = await offersService.ask(it.entry, it.offer, askInput[it.key] || '');
      if (r.ok === false) { showToast(r.error?.message || t('profile.offers.askFailed')); return; }
      setAskResultAll(prev => ({ ...prev, [it.key]: { ...r, at: new Date().toISOString() } }));
      setAskInput(it.key, '');
      if (r.kind === 'prompt') showToast(t('profile.offers.promptCopied'));
      else if (r.kind === 'triggered') showToast(t('profile.offers.triggered'));
      else if (r.kind === 'task') { showToast(t('profile.offers.requested').replace('{agent}', it.agent)); load(); }
    } catch (e) { showToast((e && e.message) || t('profile.offers.askFailed')); }
    finally { setBusy(false); }
  };
  const ask = (it) => {
    const consequences = it.offer.consequences || [];
    const gated = consequences.some(x => x.persistent || x.requiresApproval || ['external-send', 'mutates-host', 'publishes-public'].includes(x.type));
    if (gated) confirm(t('profile.offers.confirmAsk').replace('{effects}', consequences.map(x => t('profile.offers.consequence.' + x.type) || x.type).join(', ')), () => doAsk(it), { danger: true });
    else doAsk(it);
  };
  const buildForNeed = async (brief) => {
    if (!builder) { showToast(t('profile.offers.noBuilder')); return; }
    setBusy(true);
    try {
      const r = await offersService.ask(builder.entry, builder.offer, brief || q || '');
      if (r?.ok === false) showToast(r.error?.message || t('profile.offers.askFailed'));
      else showToast(t('profile.offers.buildRequested').replace('{agent}', builder.agent));
    } catch (e) { showToast((e && e.message) || t('profile.offers.askFailed')); }
    finally { setBusy(false); }
  };
  // The AI need-router: ranks the catalogue against the typed need, on explicit submit only.
  const runNeedSearch = async () => {
    if (!q.trim()) return;
    setAiResult('loading');
    try { setAiResult(await offersService.rankOffersByNeed(q.trim(), model.askable)); }
    catch (e) {
      setAiResult(null);
      const code = e?.code;
      showToast(code === 'NO_API_KEY' ? t('profile.offers.aiNoKey') : (code === 'QUOTA_EXHAUSTED' || code === 'APP_QUOTA_EXHAUSTED') ? t('profile.offers.aiQuota') : (e?.message || t('profile.offers.aiFailed')));
    }
  };
  const clearAi = () => setAiResult(null);
  const saveBilling = async (it, { price, priceMoney, visibility }) => {
    try {
      const r = await offersService.setOfferBilling(it.agent, it.offer.id, { price, priceMoney, visibility });
      if (r?.ok === false) showToast(r?.error?.message || t('profile.offers.billSaveFailed'));
      else { showToast(t('profile.offers.billSaved')); load(); }
    } catch (e) { showToast((e && e.message) || t('profile.offers.billSaveFailed')); }
  };
  const rate = async (d, stars, comment) => {
    try {
      const r = await offersService.rateDeliverable(d.agent, d.task_id, { stars, comment: comment || undefined });
      if (r?.ok === false) showToast(r?.error?.message || t('profile.offers.rateFailed'));
      else { showToast(t('profile.offers.rated')); load(); }
    } catch (e) { showToast((e && e.message) || t('profile.offers.rateFailed')); }
  };

  if (feed === null) return html`<div class="og og-op"><p class="og-empty">…</p></div>`;

  const ctx = {
    showToast, model, builder, busy, loadingDeliveries: deliverables === null,
    view, pickView, q, setQ: (v) => { setQ(v); if (aiResult) setAiResult(null); }, axis, setAxis, aiOn, aiResult, runNeedSearch, clearAi, buildForNeed,
    offlineOpen, setOfflineOpen, sellOpen, setSellOpen, sellFoldOpen, setSellFoldOpen, inboxFilter, setInboxFilter, moreOpen, toggleMore,
    askInput, setAskInput, askResult, ask, saveBilling, rate, contentOf, openTab,
  };
  return html`${renderOffersView(ctx)}<${ConfirmUI} />`;
}
