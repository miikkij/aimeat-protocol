import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { EconRow, Empty, ExpandableHelp } from './shared.js';
import { sendTestEmail } from '/js/services/admin.js';

export default function EmailTab({ data }) {
  const email = data.email;
  const [to, setTo] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  if (!email) return html`<${Empty} text=${t('dashboard.emailNotConfigured')} />`;

  async function doSend() {
    if (!to) return;
    setSending(true);
    setResult(null);
    try {
      await sendTestEmail(to);
      setResult({ ok: true, msg: t('dashboard.emailSent') });
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    }
    setSending(false);
  }

  return html`
    <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:12px">${t('dashboard.emailExplain')}</p>
    <${ExpandableHelp} title=${t('dashboard.emailSmtpHelp')}>${t('dashboard.emailSmtpHelpDetail')}</${ExpandableHelp}>

    <div class="adm-card">
      <h4 style="margin:0 0 12px">${t('dashboard.smtpConfig')}</h4>
      <${EconRow} label=${t('dashboard.host')} value=${email.host || '\u2014'} />
      <${EconRow} label=${t('dashboard.port')} value=${email.port || '\u2014'} />
      <${EconRow} label=${t('dashboard.secure')} value=${email.secure ? '\u2705' : '\u274C'} />
      <${EconRow} label=${t('dashboard.from')} value=${email.from || '\u2014'} />
    </div>

    <div class="adm-card" style="margin-top:12px">
      <h4 style="margin:0 0 12px">${t('dashboard.testEmail')}</h4>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="email" class="adm-input" value=${to}
          onInput=${e => setTo(e.target.value)}
          placeholder=${t('dashboard.emailPlaceholder')} />
        <button class="adm-btn" onClick=${doSend} disabled=${sending || !to}>
          ${sending ? '...' : t('dashboard.send')}
        </button>
      </div>
      ${result && html`<div style="margin-top:8px;font-size:.85rem;color:${result.ok ? '#22c55e' : '#ef4444'}">${result.msg}</div>`}
    </div>

    <div class="adm-card" style="margin-top:12px">
      <h4 style="margin:0 0 12px">${t('dashboard.emailTemplatesTitle')}</h4>
      <p style="color:var(--text-dim);font-size:.85rem;margin:0 0 12px">${t('dashboard.emailTemplatesExplain')}</p>
      <table style="width:100%">
        <thead><tr>
          <th>${t('dashboard.emailTemplateWelcome')}</th>
          <th>${t('dashboard.emailTemplateReset')}</th>
          <th>${t('dashboard.emailTemplateNotification')}</th>
          <th>${t('dashboard.emailTemplateVerification')}</th>
        </tr></thead>
      </table>
      <p style="color:var(--text-dim);font-size:.85rem;margin-top:8px">${t('dashboard.emailNoTemplates')}</p>
    </div>
  `;
}
