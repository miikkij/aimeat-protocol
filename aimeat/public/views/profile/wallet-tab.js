/**
 * @file wallet-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile tab: the wallet in the poster face. Morsels first (what they are, the
 *   balance and its daily pace, where they came from and went to, the ledger in words), money
 *   apart from them (the shares owed to you, purchases and sales, the three payout rails), and
 *   how your AI uses the wallet. This file holds the reads and the handlers: the composite mount,
 *   the whole ledger in pages, the payout rails, the beneficiary shares and the agents' names; the
 *   day's morsels when there is room, a rail's key or address, the filters and the opened rows. The
 *   render is wallet/page.js and wallet/rows.js.
 * @structure WalletTab() — state + handlers → renderPage(ctx)
 * @usage registered in profile.js TABS as id 'wallet'
 * @version-history
 *   v2.0.0 — 2026-09-04 — The poster face (design canvas "AIMEAT Lompakko-sivu", direction A): the
 *     lifetime from every row kind, the pace that credits without a row said as a figure, the rows
 *     in words with who made the call, the shares owed to you on the page, a stale checkout no
 *     longer counted as a purchase, the request form replaced by one door that shows only below
 *     the cap, every word through the locales.
 *   v1.8.0 — 2026-08-08 — Copy labels from the shared common.copy keys.
 *   v1.7.0 — 2026-08-06 — Expandable per-rail setup help under the Card and Stablecoin rails.
 *   v1.6.0 — 2026-07-28 — One "Selling & payments" section from GET /v1/commerce/payout.
 *   v1.4.0 — 2026-07-16 — Mount folds the reads into GET /v1/wallet/overview.
 *   v1.0.0 — 2026-03-16 — Initial wallet tab.
 */
import { useState, useEffect, useCallback, useMemo } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { apiGet, apiPut, apiPost, apiDelete } from '/js/api.js';
import { renderPage } from './wallet/page.js';
import { x, GRANTED, openTab, morsels } from './wallet/frame.js';

const PAGE = 200;
const MAX_PAGES = 5;
const FIRST_SHOWN = 10;
const flashFor = (setter) => (text, error = false) => { setter({ text, error }); setTimeout(() => setter(null), 7000); };
const errText = (e, fallback) => e?.error?.message || e?.response?.error?.message || e?.message || (typeof e === 'string' ? e : '') || fallback || t('profile.error');

export default function WalletTab({ session, showToast, onStats }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [wallet, setWallet] = useState(null);
  const [rows, setRows] = useState([]);
  const [rowsTotal, setRowsTotal] = useState(0);
  const [sessions, setSessions] = useState([]);
  const [orders, setOrders] = useState([]);
  const [payout, setPayout] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [agents, setAgents] = useState([]);
  const [filter, setFilterState] = useState('all');
  const [shown, setShown] = useState(FIRST_SHOWN);
  const [openTx, setOpenTx] = useState(null);
  const [openRail, setOpenRail] = useState(null);
  const [openShares, setOpenShares] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [addrDraft, setAddrDraft] = useState('');
  const [railMsg, setRailMsg] = useState(null);
  const [requestMsg, setRequestMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const toast = (m, isErr) => showToast?.(m, !!isErr);
  const federated = !!session?.federated;

  /* ── Reads ─────────────────────────────────────────────────────────────────────────────────── */

  /** The whole ledger, newest first, in pages; stops at MAX_PAGES so a huge store cannot stall the page. */
  const loadRows = useCallback(async (total) => {
    const all = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await apiGet(`/v1/wallet/transactions?per_page=${PAGE}&page=${page}`).catch((e) => { swallowed('wallet: rows', e); return null; });
      const list = r?.data?.transactions || [];
      all.push(...list);
      if (list.length < PAGE) break;
    }
    setRows(all);
    if (typeof total !== 'number') setRowsTotal(all.length);
  }, []);

  const load = useCallback(async () => {
    if (federated) return;
    try {
      const ov = await apiGet('/v1/wallet/overview').then((r) => r?.data).catch((e) => { swallowed('wallet: overview', e); return null; });
      if (ov?.wallet) {
        setWallet(ov.wallet);
        onStats?.({ balance: ov.wallet.balance ?? '-' });
        setRows(ov.transactions?.transactions || []);
        setRowsTotal(ov.transactions?.total ?? (ov.transactions?.transactions || []).length);
        setSessions(ov.checkoutSessions?.sessions || []);
        setOrders(ov.orders?.orders || []);
        if ((ov.transactions?.total ?? 0) > (ov.transactions?.transactions || []).length) loadRows(ov.transactions.total);
      } else {
        const w = await apiGet('/v1/wallet').then((r) => r?.data).catch((e) => { swallowed('wallet: wallet', e); return null; });
        if (w) { setWallet(w); onStats?.({ balance: w.balance ?? '-' }); }
        loadRows();
      }
    } catch (e) { swallowed('wallet: load', e); }
    apiGet('/v1/commerce/payout').then((r) => setPayout(r?.data ?? false)).catch((e) => { swallowed('wallet: payout', e); setPayout(false); });
    apiGet('/v1/commerce/beneficiary/earnings').then((r) => setEarnings(r?.data ?? null)).catch((e) => { swallowed('wallet: earnings', e); setEarnings(null); });
    apiGet('/v1/agents').then((r) => setAgents(Array.isArray(r?.data?.agents) ? r.data.agents : Array.isArray(r?.data) ? r.data : [])).catch((e) => { swallowed('wallet: agents', e); });
  }, [federated, loadRows]);   // eslint-disable-line react-hooks/exhaustive-deps -- onStats is a stable prop wrapper

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  /* ── What the page reads off the state ─────────────────────────────────────────────────────── */

  const self = wallet?.gaii || '';
  const counts = useMemo(() => ({
    all: rows.length,
    in: rows.filter((tx) => Number(tx.amount) > 0 && !GRANTED.has(tx.type)).length,
    out: rows.filter((tx) => Number(tx.amount) < 0).length,
    agent: rows.filter((tx) => tx.initiator_gaii).length,
  }), [rows]);
  const filtered = useMemo(() => rows.filter((tx) => (
    filter === 'in' ? Number(tx.amount) > 0 && !GRANTED.has(tx.type)
      : filter === 'out' ? Number(tx.amount) < 0
        : filter === 'agent' ? !!tx.initiator_gaii
          : true)), [rows, filter]);
  const first = rows.length ? rows[rows.length - 1].timestamp : null;
  const last = rows.length ? rows[0].timestamp : null;

  /** The shares owed to you, in the currency that carries the most; a share with no currency is morsels. */
  const shares = useMemo(() => {
    const totals = earnings?.totals || {};
    const keys = Object.keys(totals);
    if (!keys.length) return null;
    const key = keys.sort((a, b) => ((totals[b].accrued || 0) + (totals[b].released || 0)) - ((totals[a].accrued || 0) + (totals[a].released || 0)))[0];
    const tt = totals[key];
    const currency = key === 'null' || key === 'undefined' ? null : key;
    const entries = (earnings.entries || []).filter((e) => (e.currency ?? null) === currency);
    return {
      currency, accrued: tt.accrued || 0, released: tt.released || 0, paid: tt.paid || 0,
      total: (tt.accrued || 0) + (tt.released || 0) + (tt.paid || 0),
      accruedCount: entries.filter((e) => e.status === 'accrued').length,
      releasedCount: entries.filter((e) => e.status === 'released').length,
    };
  }, [earnings]);
  const railsOn = payout ? 1 + (payout.stripe?.configured ? 1 : 0) + (payout.x402?.enabled && payout.x402?.configured ? 1 : 0) : 0;

  /* ── Handlers ──────────────────────────────────────────────────────────────────────────────── */

  const setFilter = (f) => { setFilterState(f); setShown(FIRST_SHOWN); setOpenTx(null); };
  const showMore = () => setShown((n) => n + 20);
  const toggleTx = (id) => setOpenTx((cur) => (cur === id ? null : id));
  const toggleRail = (id) => { setOpenRail((cur) => (cur === id ? null : id)); setKeyDraft(''); setAddrDraft(''); setRailMsg(null); };
  const toggleShares = () => setOpenShares((v) => !v);

  const requestToday = async () => {
    const cap = Number(wallet?.daily_allowance?.accumulation_cap) || 0;
    const pace = Number(wallet?.daily_allowance?.amount) || 0;
    const amount = Math.max(1, Math.min(pace, cap - (Number(wallet?.balance) || 0)));
    setBusy('request');
    const flash = flashFor(setRequestMsg);
    try {
      const r = await apiPost('/v1/wallet/request', { amount });
      if (r?.ok === false) throw r;
      const said = x('requested', { n: morsels(r.data?.granted ?? amount), balance: r.data?.new_balance ?? '' });
      flash(said);
      toast(said);
      await load();
    } catch (e) { flash(errText(e, x('requestFailed')), true); }
    setBusy(false);
  };

  const rail = async (work, okText) => {
    setBusy('rail');
    const flash = flashFor(setRailMsg);
    try {
      const r = await work();
      if (r?.ok === false) throw r;
      flash(okText);
      toast(okText);
      setKeyDraft(''); setAddrDraft('');
      const p = await apiGet('/v1/commerce/payout').catch((e) => { swallowed('wallet: payout', e); return null; });
      if (p?.data) setPayout(p.data);
    } catch (e) { flash(errText(e, x('saveFailed')), true); }
    setBusy(false);
  };
  const saveStripe = () => rail(() => apiPut('/v1/commerce/payout/stripe', { secret_key: keyDraft.trim() }), x('rail.keySaved'));
  const saveX402 = () => rail(() => apiPut('/v1/commerce/payout/x402', { address: addrDraft.trim() }), x('rail.addressSaved'));
  const removeStripe = () => confirm(x('rail.confirmRemoveKey'), () => rail(() => apiDelete('/v1/commerce/payout/stripe'), x('rail.keyRemoved')), { danger: true });
  const removeX402 = () => confirm(x('rail.confirmRemoveAddress'), () => rail(() => apiDelete('/v1/commerce/payout/x402'), x('rail.addressRemoved')), { danger: true });

  const ctx = {
    session, federated, wallet, rows, rowsTotal, rowsPartial: rows.length < rowsTotal, sessions, orders, payout, earnings, agents, self,
    filter, shown, filtered, counts, first, last, shares, railsOn, openTx, openRail, openShares, keyDraft, addrDraft, railMsg, requestMsg, busy, ConfirmUI,
    setFilter, showMore, toggleTx, toggleRail, toggleShares, setKeyDraft, setAddrDraft, saveStripe, saveX402, removeStripe, removeX402, requestToday,
    openAgents: () => openTab('agents'),
  };
  return renderPage(ctx);
}
