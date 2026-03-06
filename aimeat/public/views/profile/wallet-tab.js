import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, timeAgo } from '/js/utils.js';
import { Spinner } from './shared.js';
import { getWallet, getTransactions } from '/js/services/wallet.js';

export default function WalletTab({ session, showToast, onStats }) {
  const [walletData, setWalletData] = useState(null);
  const [walletTx, setWalletTx] = useState(null);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

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

  if (!walletData) return html`<${Spinner} text=${t('profile.wallet.loading')} />`;
  const w = walletData;
  return html`
    <div class="section-title">${t('profile.wallet.title')}</div>
    <div class="section-desc">${t('profile.wallet.desc')}</div>
    <div class="wallet-overview">
      <div class="wallet-card"><div class="amount neutral">${w.balance ?? 0} \u2764\uFE0F</div><div class="wlabel">${t('profile.wallet.balance')}</div></div>
      <div class="wallet-card"><div class="amount neutral">${w.escrow ?? 0}</div><div class="wlabel">${t('profile.wallet.inEscrow')}</div></div>
      <div class="wallet-card"><div class="amount positive">${(w.balance ?? 0) - (w.escrow ?? 0)}</div><div class="wlabel">${t('profile.wallet.available')}</div></div>
      <div class="wallet-card"><div class="amount neutral">${w.daily_allowance ?? 50}</div><div class="wlabel">${t('profile.wallet.dailyAllowance')}</div></div>
    </div>
    <div class="section-title" style="margin-top:1rem">${t('profile.wallet.recentTx')}</div>
    ${(!walletTx || walletTx.length === 0)
      ? html`<div class="empty">${t('profile.wallet.empty')}</div>`
      : html`<div class="card"><div class="tx-list">
          ${walletTx.map(tx => {
            const isCredit = tx.amount > 0;
            const typeLabel = tx.type === 'daily_allowance' ? t('profile.wallet.earned')
              : tx.type === 'welcome_bonus' ? t('profile.wallet.welcomeBonus')
              : isCredit ? t('profile.wallet.earned') : t('profile.wallet.shared');
            return html`
              <div class="tx-item">
                <div><span class="tx-type">${typeLabel}</span> <span style="font-size:.8rem">${escHtml(tx.description || tx.memo || '')}</span></div>
                <div style="text-align:right">
                  <div class="tx-amount ${isCredit ? 'credit' : 'debit'}">${isCredit ? '+' : ''}${tx.amount}</div>
                  <div class="tx-date">${tx.created_at ? timeAgo(tx.created_at) : ''}</div>
                </div>
              </div>`;
          })}
        </div></div>`
    }`;
}
