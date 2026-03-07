import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { deleteHook } from '/js/services/admin.js';

export default function HooksTab({ data, reload }) {
  const hooks = data.hooks || {};
  const hookNames = Object.keys(hooks);

  async function doClear(name) {
    if (!confirm(t('dashboard.clearHookConfirm') + ' "' + name + '"?')) return;
    try { await deleteHook(name); reload(); }
    catch (e) { alert(t('dashboard.errorLabel') + ': ' + e.message); }
  }

  // Hook descriptions for inline help
  const hookDesc = {
    pre_owner_registration: t('dashboard.hookDescPreOwnerReg'),
    post_owner_registration: t('dashboard.hookDescPostOwnerReg'),
    pre_agent_registration: t('dashboard.hookDescPreAgentReg'),
    post_agent_registration: t('dashboard.hookDescPostAgentReg'),
    owner_recovery: t('dashboard.hookDescOwnerRecovery'),
    agent_rekey: t('dashboard.hookDescAgentRekey'),
    pre_work_request: t('dashboard.hookDescPreWork'),
    post_work_delivery: t('dashboard.hookDescPostWork'),
    post_settlement: t('dashboard.hookDescPostSettlement'),
    pre_board_post: t('dashboard.hookDescPreBoard'),
    pre_federation_peer: t('dashboard.hookDescPreFederation'),
  };

  return html`
    <div class="adm-card">
      <h2>${t('dashboard.extensionHooks')}</h2>
      <p style="color:var(--text-dim);font-size:.85rem;margin-bottom:8px">${t('dashboard.hooksExplain')}</p>
      <details style="margin-bottom:12px">
        <summary style="cursor:pointer;color:var(--text-dim);font-size:.8rem">${t('dashboard.hooksWhatAre')}</summary>
        <p style="color:var(--text-dim);font-size:.8rem;margin-top:6px;line-height:1.5">${t('dashboard.hooksWhatAreDetail')}</p>
      </details>
      <div class="scrollable">
        <table>
          <thead><tr><th>${t('dashboard.hook')}</th><th>${t('dashboard.details')}</th><th>${t('dashboard.boundActions')}</th><th></th></tr></thead>
          <tbody>
            ${hookNames.map(name => {
              const actions = hooks[name] || [];
              const desc = hookDesc[name] || '';
              return html`<tr>
                <td class="mono" style="font-size:.8rem">${escHtml(name)}</td>
                <td style="color:var(--text-dim);font-size:.8rem;max-width:250px">${desc}</td>
                <td>${actions.length > 0
                  ? actions.map(a => html`<span class="tag">${escHtml(a)}</span> `)
                  : html`<span style="color:var(--text-dim)">${t('dashboard.noneLabel')}</span>`
                }</td>
                <td>${actions.length > 0 && html`<button class="adm-btn-sm" onClick=${() => doClear(name)}>${t('dashboard.clear')}</button>`}</td>
              </tr>`;
            })}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
