import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { getWallet, getTransactions, requestMorsels } from '/js/services/wallet.js';

/**
 * Copy text to clipboard, return true on success.
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}

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
  const [copiedId, setCopiedId] = useState(null);
  const [balanceCopied, setBalanceCopied] = useState(false);

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

  async function handleCopyBalance() {
    const w = walletData;
    const text = `Balance: ${w.balance ?? 0} | Available: ${(w.balance ?? 0) - (w.in_escrow ?? w.escrow ?? 0)} | Escrow: ${w.in_escrow ?? w.escrow ?? 0}`;
    const ok = await copyToClipboard(text);
    if (ok) {
      setBalanceCopied(true);
      setTimeout(() => setBalanceCopied(false), 2000);
    }
  }

  async function handleCopyTx(tx, e) {
    e.stopPropagation();
    const lines = [
      `ID: ${tx.id || '-'}`,
      `Type: ${tx.type || '-'}`,
      `Amount: ${tx.amount}`,
      tx.counterparty_gaii ? `Counterparty: ${tx.counterparty_gaii}` : null,
      tx.tracking_code ? `Tracking: ${tx.tracking_code}` : null,
      tx.timestamp ? `Time: ${tx.timestamp}` : null,
    ].filter(Boolean).join('\n');
    const ok = await copyToClipboard(lines);
    if (ok) {
      setCopiedId(tx.id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  }

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
    <div style="margin-bottom:1rem">
      <button class="wallet-balance-copy" onClick=${handleCopyBalance}>
        ${balanceCopied ? t('profile.wallet.copied') : t('profile.wallet.copyBalance')}
      </button>
    </div>

    <!-- Lifetime stats -->
    ${(lifetime.earned != null || lifetime.spent != null) && html`
      <div class="section-title" style="margin-top:.5rem">${t('profile.wallet.lifetime')}</div>
      <div class="wallet-lifetime">
        <div class="wl-stat"><div class="wl-val" style="color:var(--success,#22c55e)">${lifetime.earned ?? 0}</div><div class="wl-label">${t('profile.wallet.lifetimeEarned')}</div></div>
        <div class="wl-stat"><div class="wl-val" style="color:var(--danger,#ef4444)">${lifetime.spent ?? 0}</div><div class="wl-label">${t('profile.wallet.lifetimeSpent')}</div></div>
        <div class="wl-stat"><div class="wl-val">${lifetime.received_allowance ?? 0}</div><div class="wl-label">${t('profile.wallet.lifetimeAllowance')}</div></div>
        <div class="wl-stat"><div class="wl-val">${lifetime.welcome_bonus ?? 0}</div><div class="wl-label">${t('profile.wallet.lifetimeWelcome')}</div></div>
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
              style="width:120px"
              required />
          </div>
          <div class="wr-field" style="flex:1;min-width:150px">
            <label>${t('profile.wallet.requestReason')}</label>
            <input type="text"
              value=${reqReason}
              onInput=${e => setReqReason(e.target.value)}
              placeholder=${t('profile.wallet.requestReasonPlaceholder')} />
          </div>
          <button type="submit" class="wr-submit" disabled=${reqLoading}>
            ${reqLoading ? t('profile.wallet.requesting') : t('profile.wallet.requestBtn')}
          </button>
        </div>
      </form>
    </div>

    <!-- Transaction history -->
    <div class="section-title" style="margin-top:1.5rem">${t('profile.wallet.recentTx')}</div>
    ${(!walletTx || walletTx.length === 0)
      ? html`<div class="empty">${t('profile.wallet.empty')}</div>`
      : html`<div class="card"><div class="tx-list">
          ${walletTx.map(tx => {
            const isCredit = tx.amount > 0;
            const typeLabel = txTypeLabel(tx);
            const isExpanded = expandedTx === tx.id;
            const isCopied = copiedId === tx.id;
            return html`
              <div class="tx-item-wrap">
                <div class="tx-item" onClick=${() => toggleTx(tx.id)}>
                  <div>
                    <span class="tx-type">${typeLabel}</span>
                    ${' '}
                    <span style="font-size:.8rem">${escHtml(tx.description || tx.memo || '')}</span>
                  </div>
                  <div style="text-align:right;display:flex;align-items:center;gap:.5rem">
                    <div>
                      <div class="tx-amount ${isCredit ? 'credit' : 'debit'}">${isCredit ? '+' : ''}${tx.amount}</div>
                      <div class="tx-date">${tx.timestamp ? timeAgo(tx.timestamp) : (tx.created_at ? timeAgo(tx.created_at) : '')}</div>
                    </div>
                    <span style="font-size:.7rem;opacity:.5">${isExpanded ? '\u25B2' : '\u25BC'}</span>
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
                      <span class="tx-detail-value" style="grid-column:1/-1">${t('profile.wallet.noDetails')}</span>
                    `}
                    <div style="grid-column:1/-1">
                      <button class="tx-copy-btn" onClick=${(e) => handleCopyTx(tx, e)}>
                        ${isCopied ? t('profile.wallet.copied') : t('profile.wallet.copyTx')}
                      </button>
                    </div>
                  </div>
                `}
              </div>`;
          })}
        </div></div>`
    }`;
}
