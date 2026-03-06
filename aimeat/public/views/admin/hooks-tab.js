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

  return html`
    <div class="adm-card">
      <h2>${t('dashboard.extensionHooks')}</h2>
      <p style="color:var(--text-dim);font-size:.8rem;margin-bottom:12px">${t('dashboard.hooksExplain')}</p>
      <div class="scrollable">
        <table>
          <thead><tr><th>${t('dashboard.hook')}</th><th>${t('dashboard.boundActions')}</th><th></th></tr></thead>
          <tbody>
            ${hookNames.map(name => {
              const actions = hooks[name] || [];
              return html`<tr>
                <td class="mono" style="font-size:.8rem">${escHtml(name)}</td>
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
