/**
 * @file wallet-tab.js
 * @description Profile tab for morsel wallet: balance overview, lifetime stats,
 *   morsel request form, and transaction history with expandable details.
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial wallet tab
 *   v1.1.0 — 2026-03-17 — Replace inline styles with CSS classes
 *   v1.2.0 — 2026-05-22 — Show info message for federated users instead of infinite spinner
 *   v1.3.0 — 2026-06-02 — Component unification (#1): copy buttons use canonical
 *     <CopyButton>; delete local copyToClipboard helper + dead copied-state/handlers.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { getWallet, getTransactions, requestMorsels } from '/js/services/wallet.js';

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

export default function WalletTab({ session, showToast, onStats }) {
  const [walletData, setWalletData] = useState(null);
  const [walletTx, setWalletTx] = useState(null);
  const [expandedTx, setExpandedTx] = useState(null);

  // Request form state
  const [reqAmount, setReqAmount] = useState('');
  const [reqReason, setReqReason] = useState('');
  const [reqLoading, setReqLoading] = useState(false);

  useEffect(() => {
    if (session) loadData();
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
      const resp = await getWallet();
      const w = resp?.data || resp || {};
      setWalletData(w);
      onStats?.({ balance: w.balance ?? '-' });
      try {
        const tx = await getTransactions(20);
        setWalletTx(tx);
      } catch { setWalletTx([]); }
    } catch { setWalletData(null); }
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
