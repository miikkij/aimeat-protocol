import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { getNodeUrl } from '/js/services/auth.js';

export default function AccessTab({ session, showToast }) {
  const NODE_URL = getNodeUrl();
  const ownerKey = typeof localStorage !== 'undefined' ? localStorage.getItem('aimeat_owner_key') : null;
  const [keyBlurred, setKeyBlurred] = useState(true);

  return html`
    <div class="section-title">${t('profile.access.title')}</div>
    <div class="section-desc">${t('profile.access.desc')}</div>

    <h3 style="color:var(--love1);margin-bottom:.75rem">\u{1F4BB} ${t('profile.access.session')}</h3>
    <div class="card">
      <div class="mem-item"><span class="mem-key">${t('profile.access.owner')}</span><span>${escHtml(session.owner || '-')}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.ghii')}</span><span>${escHtml(session.ghii || '-')}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.agentGaii')}</span><span>${escHtml(session.gaii || '-')}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.node')}</span><span>${escHtml(NODE_URL)}</span></div>
      <div class="mem-item"><span class="mem-key">${t('profile.access.jwtValid')}</span><span>${session.valid ? html`<span class="badge badge-success">${t('profile.access.yes')}</span>` : html`<span class="badge badge-danger">${t('profile.access.expired')}</span>`}</span></div>
    </div>

    <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F510} ${t('profile.access.publicKey')}</h3>
    <div class="card"><div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted)">${escHtml(session.publicKey || 'N/A')}</div></div>

    ${ownerKey && html`
      <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F5DD}\uFE0F ${t('profile.access.ownerKey')}</h3>
      <div class="card" style="border-color:var(--warn);cursor:pointer" onClick=${() => copyToClipboard(ownerKey).then(() => showToast(t('profile.access.keyCopied')))}>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-family:monospace;font-size:.75rem;word-break:break-all;color:var(--muted);filter:${keyBlurred ? 'blur(4px)' : 'none'};transition:filter .2s"
            onMouseEnter=${() => setKeyBlurred(false)} onMouseLeave=${() => setKeyBlurred(true)}>
            ${escHtml(ownerKey)}
          </div>
          <span class="badge badge-warn">${t('profile.access.hoverReveal')}</span>
        </div>
        <div style="font-size:.75rem;color:var(--warn);margin-top:.5rem">\u26A0 ${t('profile.access.keepSafe')}</div>
      </div>
    `}

    <h3 style="color:var(--love1);margin:1.5rem 0 .75rem">\u{1F517} ${t('profile.access.mcpEndpoint')}</h3>
    <div class="card">
      <div style="font-family:monospace;font-size:.85rem;color:var(--love3)">${escHtml(NODE_URL + '/v1/mcp')}</div>
      <div style="font-size:.75rem;color:var(--muted);margin-top:.3rem">${t('profile.access.mcpDesc')}</div>
    </div>
  `;
}
