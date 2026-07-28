/**
 * @file wallet-tab.js
 * @description Profile tab for morsel wallet: balance overview, lifetime stats,
 *   morsel request form, and transaction history with expandable details.
 * @version-history
 *   v1.6.0 — 2026-07-28 — One "Selling & payments" section replaces the separate PSP and x402 blocks:
 *     card, stablecoin and invoice rails render from a single GET /v1/commerce/payout, and the Stripe
 *     key is written through /v1/commerce/payout/stripe. The old block called the removed edition's
 *     own endpoint and hid itself when that 404'd, so on a node without the module a seller was never
 *     shown the credential field at all.
 *   v1.5.1 — 2026-07-25 — The x402 chip reports every currency → token pair the node can settle
 *     (USD → USDC, EUR → EURC) instead of a single hardcoded token (TARGET-042).
 *   v1.5.0 — 2026-07-25 — Payout rails: an x402 USDC payout-address section beside the Stripe one, so a
 *     seller can set the address a stablecoin sale settles to and tell the two rails apart (Stripe moves
 *     fiat through a provider; x402 settles USDC on-chain to an address the seller controls).
 *   v1.0.0 — 2026-03-16 — Initial wallet tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes
 *   v1.2.0 — 2026-05-22 — Show info message for federated users instead of infinite spinner
 *   v1.3.0 — 2026-06-02 — Component unification (#1): copy buttons use canonical
 *     <CopyButton>; delete local copyToClipboard helper + dead copied-state/handlers.
 *   v1.4.0 — 2026-07-16 — Mount folds the tab's wallet+transactions AND MoneyActivity's checkout+orders
 *     into ONE GET /v1/wallet/overview (WalletTabService); MoneyActivity seeds from `initial` + skips its
 *     own mount fetch. The Selling & payments section keeps its own payout call. Falls back to the
 *     individual endpoints if the composite is unavailable. (Phase 4 slice 3 — frontend half.)
 *   v1.5.0 — 2026-07-18 — Vaihe 3 card-cohesion: the two remaining unframed sections now sit in a `.card`
 *     like the balance/lifetime/history sections do — PSP `.wallet-psp` block and MoneyActivity's
 *     purchases/sales `.tx-list`s (were bare blocks straight under their section headers). Campsite Rule 8:
 *     the tx-item / tx-item-wrap dividers + hover swapped hardcoded rgba(232,86,74,…) for --border /
 *     --accent-subtle tokens (theme-aware).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo, fmtMoney } from '/js/utils.js';
import { Spinner } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { getWallet, getTransactions, requestMorsels } from '/js/services/wallet.js';
import { apiGet, apiPut, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/**
 * Map backend transaction type to a display label.
 */
function txTypeLabel(tx) {
  const type = tx.type || '';
  if (type === 'allowance' || type === 'daily_allowance') return t('profile.wallet.allowance');
  if (type === 'welcome_bonus') return t('profile.wallet.welcomeBonus');
  if (type === 'earned') return t('profile.wallet.earned');
  if (type === 'spent') return t('profile.wallet.spent');
  // Fallback based on amount sign
  return tx.amount > 0 ? t('profile.wallet.earned') : t('profile.wallet.shared');
}

/* "Selling & payments" — every rail that can pay this seller, from ONE read of /v1/commerce/payout.
 *
 * The three rails are shown together because the question a seller actually has is "can I take
 * money yet, and how does it reach me", and the answers differ in kind:
 *   - Card (Stripe): runs on the seller's OWN secret key. They are the merchant of record, the money
 *     lands on their Stripe balance, and this node holds neither key nor funds.
 *   - Stablecoin (x402): settles on-chain straight to an address the seller controls. The token
 *     follows the price (USD → USDC, EUR → EURC) and ONE address receives them all, so the chip
 *     reports the pairs this node can really settle instead of naming a single token. A money sale
 *     over x402 with no address fails with SELLER_NO_X402_ADDRESS, which this section prevents.
 *   - Invoice: always available because it captures nothing — the order completes and the amount is
 *     booked as a payable the seller bills offline.
 * Nothing here is edition-gated: the node has no platform account of its own to gate it on. */
function SellingSection() {
  const [state, setState] = useState(null);
  const [keyIn, setKeyIn] = useState('');
  const [addr, setAddr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => {
    apiGet('/v1/commerce/payout').then(r => setState(r.data ?? null)).catch(() => setState(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);
  // false = commerce is off on this node (503) — there is nothing to sell through.
  if (state === null || state === false) return null;

  const stripe = state.stripe || {};
  const x = state.x402 || {};
  const addrValid = /^0x[a-fA-F0-9]{40}$/.test(addr.trim());

  async function run(fn, okMsg) {
    setBusy(true); setMsg('');
    try { await fn(); setMsg(okMsg); load(); }
    catch (e) { setMsg(e.message || 'Failed'); }
    finally { setBusy(false); }
  }

  return html`
    <div class="section-title mt-2">${t('profile.wallet.sellingTitle')}</div>
    <div class="section-desc">${t('profile.wallet.sellingDesc')}</div>

    <div class="card wallet-psp">
      <div class="wallet-rail-row">
        <strong>${t('profile.wallet.railCard')}</strong>
        ${stripe.configured
          ? html`<span class="pf-psp-chip pf-psp-chip--ok">${t('profile.wallet.pspConfigured')} ${stripe.keyHint || ''}</span>`
          : html`<span class="pf-psp-chip pf-psp-chip--warn">${t('profile.wallet.pspMissing')}</span>`}
        <span class="pf-psp-chip">${(stripe.currencies || []).join(' · ')}</span>
      </div>
      <div class="wallet-psp-row">
        <input class="input-field input-sm wallet-psp-input" type="password" placeholder="sk_live_…"
               value=${keyIn} onInput=${(e) => setKeyIn(e.target.value)} />
        <button class="btn-primary btn-sm" disabled=${busy || keyIn.trim().length < 8}
                onClick=${() => run(async () => { await apiPut('/v1/commerce/payout/stripe', { secret_key: keyIn.trim() }); setKeyIn(''); }, t('profile.wallet.pspSaved'))}>
          ${t('profile.wallet.pspSave')}</button>
        ${stripe.configured && html`<button class="btn-ghost btn-sm" disabled=${busy}
                onClick=${() => run(() => apiDelete('/v1/commerce/payout/stripe'), t('profile.wallet.pspRemoved'))}>
          ${t('profile.wallet.pspRemove')}</button>`}
      </div>
      <span class="text-meta">${t('profile.wallet.railCardNote')}</span>
    </div>

    ${x.enabled && html`
      <div class="card wallet-psp">
        <div class="wallet-rail-row">
          <strong>${t('profile.wallet.railStablecoin')}</strong>
          ${x.configured
            ? html`<span class="pf-psp-chip pf-psp-chip--ok">${t('profile.wallet.x402Configured')} <code>${x.address}</code></span>`
            : html`<span class="pf-psp-chip pf-psp-chip--warn">${t('profile.wallet.x402Missing')}</span>`}
          <span class="pf-psp-chip">${(x.assets || []).map(a => `${a.currency} → ${a.symbol}`).join(' · ')} · ${x.network}${x.testnet ? ` · ${t('profile.wallet.x402Testnet')}` : ''}</span>
        </div>
        <div class="wallet-psp-row">
          <input class="input-field input-sm wallet-psp-input" type="text" spellcheck="false" placeholder="0x…"
                 value=${addr} onInput=${(e) => setAddr(e.target.value)} />
          <button class="btn-primary btn-sm" disabled=${busy || !addrValid}
                  onClick=${() => run(async () => { await apiPut('/v1/commerce/payout/x402', { address: addr.trim() }); setAddr(''); }, t('profile.wallet.x402Saved'))}>
            ${t('profile.wallet.x402Save')}</button>
          ${x.configured && html`<button class="btn-ghost btn-sm" disabled=${busy}
                  onClick=${() => run(() => apiDelete('/v1/commerce/payout/x402'), t('profile.wallet.x402Removed'))}>
            ${t('profile.wallet.x402Remove')}</button>`}
        </div>
        ${addr.trim() && !addrValid && html`<span class="text-meta">${t('profile.wallet.x402Invalid')}</span>`}
      </div>`}

    <div class="card wallet-psp">
      <div class="wallet-rail-row">
        <strong>${t('profile.wallet.railInvoice')}</strong>
        <span class="pf-psp-chip pf-psp-chip--ok">${t('profile.wallet.railInvoiceReady')}</span>
      </div>
      <span class="text-meta">${t('profile.wallet.railInvoiceNote')}</span>
    </div>

    ${msg && html`<span class="text-meta">${msg}</span>`}`;
}

/* "Money purchases & sales" — real-money (EUR/USD) checkout activity, separate from morsels.
 * Purchases come from the buyer's checkout sessions, sales from received orders; both filtered to
 * money currencies (minor units → major). Renders nothing when there is no money activity. */
function MoneyActivity({ initial }) {
  // Seeded from GET /v1/wallet/overview (checkoutSessions + orders, money currencies only); else self-loads.
  const [data, setData] = useState(() => {
    if (!initial) return null;
    const m = (x) => x.currency && x.currency !== 'morsel';
    return { purchases: (initial.checkoutSessions?.sessions ?? []).filter(m), sales: (initial.orders?.orders ?? []).filter(m) };
  });
  const load = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([
        apiGet('/v1/commerce/checkout-sessions?limit=100').catch(err => { swallowed('wallet-tab: m', err); return null; }),
        apiGet('/v1/commerce/orders?limit=100').catch(err => { swallowed('wallet-tab: m', err); return null; }),
      ]);
      const money = (x) => x.currency && x.currency !== 'morsel';
      const purchases = (s?.data?.sessions ?? []).filter(money);
      const sales = (o?.data?.orders ?? []).filter(money);
      setData({ purchases, sales });
    } catch (err) { swallowed('wallet-tab', err); setData({ purchases: [], sales: [] }); }
  }, []);
  useEffect(() => { if (!initial) load(); }, [load]);   // eslint-disable-line react-hooks/exhaustive-deps -- seed once from `initial`; fetch only when unseeded
  if (!data || (!data.purchases.length && !data.sales.length)) return null;
  const money = (amt, cur) => fmtMoney(amt, cur);
  const row = (x, isSale) => html`
    <div class="tx-item" key=${x.id}>
      <span>${(x.items?.[0]?.title) || (isSale ? t('profile.wallet.moneySale') : t('profile.wallet.moneyPurchase'))}
        <span class="text-meta"> · ${x.status}</span></span>
      <span class="tx-amount ${isSale ? 'success' : ''}">${isSale ? '+' : ''}${money(isSale ? (x.receipt?.earned ?? x.total) : x.total, x.currency)}</span>
    </div>`;
  return html`
    <div class="section-title mt-2">${t('profile.wallet.moneyTitle')}</div>
    <div class="section-desc">${t('profile.wallet.moneyDesc')}</div>
    ${data.purchases.length ? html`
      <div class="text-meta mb-1">${t('profile.wallet.moneyPurchases')}</div>
      <div class="card"><div class="tx-list">${data.purchases.map(x => row(x, false))}</div></div>` : null}
    ${data.sales.length ? html`
      <div class="text-meta mb-1 mt-1">${t('profile.wallet.moneySales')}</div>
      <div class="card"><div class="tx-list">${data.sales.map(x => row(x, true))}</div></div>` : null}`;
}

export default function WalletTab({ session, showToast, onStats }) {
  const [walletData, setWalletData] = useState(null);
  const [walletTx, setWalletTx] = useState(null);
  const [expandedTx, setExpandedTx] = useState(null);
  const [moneyInitial, setMoneyInitial] = useState(null);   // seeds MoneyActivity from the composite

  // Request form state
  const [reqAmount, setReqAmount] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [reqLoading, setReqLoading] = useState(false);

  useEffect(() => {
    if (session) loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadData is a loader defined below (recreated each render); effect intentionally re-runs only when session changes.
  }, [session]);

  // Live update listener
  const liveRef = useRef(loadData);
  liveRef.current = loadData;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function loadData() {
    try {
      // Mount: ONE composite call (GET /v1/wallet/overview) seeds wallet + recent transactions AND the
      // MoneyActivity section (checkout-sessions + orders). The Selling & payments section stays on its own
      // /v1/me/psp call. Falls back to the individual wallet endpoints if the composite is unavailable.
      const ov = await apiGet('/v1/wallet/overview').then(r => r?.data).catch(err => { swallowed('wallet-tab: loadData', err); return null; });
      if (ov?.wallet) {
        setWalletData(ov.wallet);
        onStats?.({ balance: ov.wallet.balance ?? '-' });
        setWalletTx(ov.transactions?.transactions || []);
        setMoneyInitial(ov);
        return;
      }
      // Fallback — the tab's own two reads (MoneyActivity self-loads when moneyInitial stays null).
      const resp = await getWallet();
      const w = resp?.data || resp || {};
      setWalletData(w);
      onStats?.({ balance: w.balance ?? '-' });
      try {
        const tx = await getTransactions(20);
        setWalletTx(tx);
      } catch (err) { swallowed('wallet-tab', err); setWalletTx([]); }
    } catch (err) { swallowed('wallet-tab', err); setWalletData(null); }
  }

  const toggleTx = useCallback((id) => {
    setExpandedTx(prev => prev === id ? null : id);
  }, []);

  async function handleRequestMorsels(e) {
    e.preventDefault();
    const amount = parseInt(reqAmount, 10);
    if (!amount || amount <= 0) return;
    setReqLoading(true);
    try {
      const resp = await requestMorsels(amount, reqReason || undefined);
      const granted = resp?.granted ?? amount;
      const newBalance = resp?.new_balance ?? '?';
      const msg = t('profile.wallet.requestSuccess')
        .replace('{amount}', granted)
        .replace('{balance}', newBalance);
      showToast?.(msg, 'success');
      setReqAmount('');
      setReqReason('');
      // Reload wallet data to reflect new balance
      await loadData();
    } catch (err) {
      showToast?.(t('profile.wallet.requestError') + ': ' + (err.message || t('profile.unknownError')), 'error');
    } finally {
      setReqLoading(false);
    }
  }

  if (session?.federated) {
    return html`
      <div class="section-title">${t('profile.wallet.title')}</div>
      <div class="section-desc">${t('profile.wallet.desc')}</div>
      <div class="alert alert-info">
        <span class="alert-msg">${t('profile.wallet.federatedInfo')}</span>
      </div>
      <div class="text-meta mt-1">
        ${t('profile.wallet.federatedHomeNode')}: <strong>${session.homeNode || '?'}</strong>
      </div>
    `;
  }

  if (!walletData) return html`<${Spinner} text=${t('profile.wallet.loading')} />`;
  const w = walletData;
  const escrow = w.in_escrow ?? w.escrow ?? 0;
  const lifetime = w.lifetime || {};

  return html`
    <div class="section-title">${t('profile.wallet.title')}</div>
    <div class="section-desc">${t('profile.wallet.desc')}</div>

    <!-- Balance overview cards -->
    <div class="wallet-overview">
      <div class="wallet-card">
        <div class="amount neutral">${w.balance ?? 0}</div>
        <div class="wlabel">${t('profile.wallet.balance')}</div>
      </div>
      <div class="wallet-card">
        <div class="amount neutral">${escrow}</div>
        <div class="wlabel">${t('profile.wallet.inEscrow')}</div>
      </div>
      <div class="wallet-card">
        <div class="amount positive">${(w.balance ?? 0) - escrow}</div>
        <div class="wlabel">${t('profile.wallet.available')}</div>
      </div>
      <div class="wallet-card">
        <div class="amount neutral">${w.daily_allowance?.amount ?? w.daily_allowance ?? 50}</div>
        <div class="wlabel">${t('profile.wallet.dailyAllowance')}</div>
      </div>
    </div>

    <!-- Selling & payments: every rail that can pay this seller, from one read -->
    <${SellingSection} />

    <!-- Real-money (EUR/USD) purchases & sales, separate from the morsel ledger -->
    <${MoneyActivity} initial=${moneyInitial} />

    <!-- Copy balance button -->
    <div class="mb-1">
      <${CopyButton}
        text=${`Balance: ${w.balance ?? 0} | Available: ${(w.balance ?? 0) - escrow} | Escrow: ${escrow}`}
        label=${t('profile.wallet.copyBalance')}
        copiedLabel=${t('profile.wallet.copied')}
        className="btn-outline btn-sm" />
    </div>

    <!-- Lifetime stats -->
    ${(lifetime.earned != null || lifetime.spent != null) && html`
      <div class="section-title">${t('profile.wallet.lifetime')}</div>
      <div class="wallet-lifetime">
        <div class="stat-card"><div class="stat-card-value mono success">${lifetime.earned ?? 0}</div><div class="stat-card-label">${t('profile.wallet.lifetimeEarned')}</div></div>
        <div class="stat-card"><div class="stat-card-value mono danger">${lifetime.spent ?? 0}</div><div class="stat-card-label">${t('profile.wallet.lifetimeSpent')}</div></div>
        <div class="stat-card"><div class="stat-card-value mono">${lifetime.received_allowance ?? 0}</div><div class="stat-card-label">${t('profile.wallet.lifetimeAllowance')}</div></div>
        <div class="stat-card"><div class="stat-card-value mono">${lifetime.welcome_bonus ?? 0}</div><div class="stat-card-label">${t('profile.wallet.lifetimeWelcome')}</div></div>
      </div>
    `}

    <!-- Request morsels form -->
    <div class="wallet-request">
      <div class="wr-title">${t('profile.wallet.requestTitle')}</div>
      <div class="wr-desc">${t('profile.wallet.requestDesc')}</div>
      <form onSubmit=${handleRequestMorsels}>
        <div class="wr-row">
          <div class="wr-field">
            <label>${t('profile.wallet.requestAmount')}</label>
            <input type="number" min="1" max="500" step="1"
              value=${reqAmount}
              onInput=${e => setReqAmount(e.target.value)}
              placeholder=${t('profile.wallet.requestAmountHint')}
              class="wallet-input-w"
              required />
          </div>
          <div class="wr-field wallet-reason-field">
            <label>${t('profile.wallet.requestReason')}</label>
            <input type="text"
              value=${reqReason}
              onInput=${e => setReqReason(e.target.value)}
              placeholder=${t('profile.wallet.requestReasonPlaceholder')} />
          </div>
          <button type="submit" class="btn-primary btn-sm" disabled=${reqLoading}>
            ${reqLoading ? t('profile.wallet.requesting') : t('profile.wallet.requestBtn')}
          </button>
        </div>
      </form>
    </div>

    <!-- Transaction history -->
    <div class="section-title section-title-spaced">${t('profile.wallet.recentTx')}</div>
    ${(!walletTx || walletTx.length === 0)
      ? html`<div class="empty">${t('profile.wallet.empty')}</div>`
      : html`<div class="card"><div class="tx-list">
          ${walletTx.map(tx => {
            const isCredit = tx.amount > 0;
            const typeLabel = txTypeLabel(tx);
            const isExpanded = expandedTx === tx.id;
            const txCopyText = [
              `ID: ${tx.id || '-'}`,
              `Type: ${tx.type || '-'}`,
              `Amount: ${tx.amount}`,
              tx.counterparty_gaii ? `Counterparty: ${tx.counterparty_gaii}` : null,
              tx.tracking_code ? `Tracking: ${tx.tracking_code}` : null,
              tx.timestamp ? `Time: ${tx.timestamp}` : null,
            ].filter(Boolean).join('\n');
            return html`
              <div class="tx-item-wrap">
                <div class="tx-item" onClick=${() => toggleTx(tx.id)}>
                  <div>
                    <span class="tx-type">${typeLabel}</span>
                    ${' '}
                    <span class="work-desc-text">${escHtml(tx.description || tx.memo || '')}</span>
                  </div>
                  <div class="work-tx-right">
                    <div>
                      <div class="tx-amount ${isCredit ? 'credit' : 'debit'}">${isCredit ? '+' : ''}${tx.amount}</div>
                      <div class="tx-date">${tx.timestamp ? timeAgo(tx.timestamp) : (tx.created_at ? timeAgo(tx.created_at) : '')}</div>
                    </div>
                    <span class="expand-arrow">${isExpanded ? '\u25B2' : '\u25BC'}</span>
                  </div>
                </div>
                ${isExpanded && html`
                  <div class="tx-detail">
                    ${tx.id && html`
                      <span class="tx-detail-label">ID</span>
                      <span class="tx-detail-value">${escHtml(tx.id)}</span>
                    `}
                    ${tx.type && html`
                      <span class="tx-detail-label">Type</span>
                      <span class="tx-detail-value">${escHtml(tx.type)}</span>
                    `}
                    ${tx.counterparty_gaii && html`
                      <span class="tx-detail-label">${t('profile.wallet.counterparty')}</span>
                      <span class="tx-detail-value">${escHtml(tx.counterparty_gaii)}</span>
                    `}
                    ${tx.tracking_code && html`
                      <span class="tx-detail-label">${t('profile.wallet.trackingCode')}</span>
                      <span class="tx-detail-value">${escHtml(tx.tracking_code)}</span>
                    `}
                    ${tx.timestamp && html`
                      <span class="tx-detail-label">${t('profile.wallet.timestamp')}</span>
                      <span class="tx-detail-value">${new Date(tx.timestamp).toLocaleString()}</span>
                    `}
                    ${!tx.counterparty_gaii && !tx.tracking_code && !tx.timestamp && html`
                      <span class="tx-detail-value work-grid-span">${t('profile.wallet.noDetails')}</span>
                    `}
                    <div class="work-grid-span">
                      <span onClick=${(e) => e.stopPropagation()}>
                        <${CopyButton}
                          text=${txCopyText}
                          label=${t('profile.wallet.copyTx')}
                          copiedLabel=${t('profile.wallet.copied')}
                          className="btn-outline btn-sm" />
                      </span>
                    </div>
                  </div>
                `}
              </div>`;
          })}
        </div></div>`
    }`;
}
