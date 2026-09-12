/**
 * @file public/views/admin/extensions-tab.add.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 03 and 04 of the Extensions page: installing one that ships with the
 *   release, and writing a new one. The install cards and the scaffold form are the ones that
 *   shipped before; what is new is that the sandbox rules are stated where somebody is about to
 *   write an action, instead of at the bottom of the page under a heading nobody reached.
 *
 * @structure
 *   - Bundled({ installed, onReload }) — section 03, the extensions in the release
 *   - Scaffold({ onReload }) — section 04, the form and what an action script may do
 *
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the page renamed from Services to Extensions.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, Empty, useToast, Toast } from './shared.js';
import { getAvailableExtensions, installBundledExtension, reinstallExtension } from '/js/services/admin.js';
import { AvailableExtCard } from './extensions-tab.available-card.js';
import { ScaffoldForm } from './extensions-tab.scaffold-form.js';

const X = (key, params) => t('admin.ext.' + key, params);

/** Section 03: what the release carries, and whether it is already in. */
export function Bundled({ installedNames, onReload }) {
  const [toast, showErr, , clearToast] = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);

  function load() {
    setLoading(true);
    getAvailableExtensions()
      .then(r => setList(r.data?.extensions || []))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }
  // One read when the page opens; load() is stable for this section's lifetime.
  useEffect(() => { load(); }, []);

  async function install(name) {
    setBusy(name);
    try { await installBundledExtension(name); onReload(); load(); } catch (e) { showErr(e.message); }
    setBusy(null);
  }
  async function again(name) {
    setBusy(name);
    try { await reinstallExtension(name); onReload(); load(); } catch (e) { showErr(e.message); }
    setBusy(null);
  }

  const notIn = list.filter(e => !(e.installed || installedNames.has(e.name))).length;

  return html`
    <section class="og-sec">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <div class="og-sec-h">
        <h2>${X('bundled.title')}<small>03</small></h2>
        <div class="og-doors"><span class="og-door og-door--quiet">${X('bundled.count', { n: num(notIn), total: num(list.length) })}</span></div>
      </div>
      <p class="adm-ex-lead">${X('bundled.lead')}</p>
      ${loading && html`<p class="adm-ex-hint">${t('dashboard.loading')}</p>`}
      ${!loading && list.length === 0 && html`<${Empty} text=${X('bundled.none')} />`}
      <div class="adm-ex-cards">
        ${list.map(e => html`<${AvailableExtCard} ext=${e}
          isInstalled=${e.installed || installedNames.has(e.name)}
          isInstalling=${busy === e.name}
          onInstall=${install} onReinstall=${again} reload=${onReload} loadAvailable=${load} />`)}
      </div>
      <p class="adm-ex-note">${X('bundled.note')}</p>
    </section>`;
}

/** Section 04: write one, and what the sandbox will and will not let it do. */
export function Scaffold({ onReload }) {
  return html`
    <section class="og-sec">
      <div class="og-sec-h"><h2>${X('write.title')}<small>04</small></h2></div>
      <p class="adm-ex-lead">${X('write.lead')}</p>
      <div class="adm-ex-grid">
        <div>
          <${ScaffoldForm} onCreated=${onReload} />
        </div>
        <div>
          <div class="adm-ex-lbl">${X('write.mayTitle')}</div>
          <div class="adm-ex-box">
            <div class="adm-ex-box-row"><em>${X('write.ownStorage')}</em><span>${'ext:<name>'}</span></div>
            <div class="adm-ex-box-row"><em>${X('write.personData')}</em><span>${X('write.withConsent')}</span></div>
            <div class="adm-ex-box-row"><em>${X('write.outside')}</em><span>${X('write.declaredOnly')}</span></div>
            <div class="adm-ex-box-row"><em>${X('write.otherExts')}</em><span>${X('write.no')}</span></div>
          </div>
          <p class="adm-ex-hint">${X('write.sandboxWhy')}</p>
        </div>
      </div>

      <details class="adm-ex-manual">
        <summary class="adm-ex-lbl">${X('write.ctxTitle')}</summary>
        <p class="adm-ex-hint">${X('write.ctxLead')}</p>
        <pre>${[
    'const { input, memory, wallet, caller, config, instance, log } = ctx;',
    '',
    '// caller.gaii                       ' + X('ctx.caller'),
    '// caller.owner                      ' + X('ctx.owner'),
    '// input                             ' + X('ctx.input'),
    '// instance.id                       ' + X('ctx.instance'),
    '',
    '// memory.get(key)                   ' + X('ctx.memGet'),
    '// memory.set(key, value)            ' + X('ctx.memSet'),
    '// memory.list(prefix)               ' + X('ctx.memList'),
    '// memory.delete(key)                ' + X('ctx.memDel'),
    '',
    '// wallet.balance(gaii)              ' + X('ctx.walBal'),
    '// wallet.transfer(from, to, amount) ' + X('ctx.walTx'),
    '// log(message)                      ' + X('ctx.log'),
    '',
    'return { ok: true, data: {} };',
  ].join('\n')}</pre>
        <ol>
          <li>${X('write.step1')}</li>
          <li>${X('write.step2')}</li>
          <li>${X('write.step3')}</li>
          <li>${X('write.step4')}</li>
        </ol>
      </details>
    </section>`;
}
