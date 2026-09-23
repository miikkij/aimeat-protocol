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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, columns of release
 *     cards, the sandbox rules as compact list rows, and the ctx reference as a folding code surface.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-12 — Initial, with the page renamed from Services to Extensions.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, Empty, useToast, Toast } from './shared.js';
import { Section, Columns, Stack, Surface, ListRow, Steps, Text } from '/components/poster-parts.js';
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

  return html`<${Section} title=${X('bundled.title')} count="03" description=${X('bundled.lead')}
    actions=${html`<${Text} kind="caption" tone="muted">${X('bundled.count', { n: num(notIn), total: num(list.length) })}<//>`}>
    <${Stack}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      ${loading && html`<${Text} kind="caption" tone="muted">${t('dashboard.loading')}<//>`}
      ${!loading && list.length === 0 && html`<${Empty} text=${X('bundled.none')} />`}
      ${list.length > 0 && html`<${Columns} layout="thirds" collapse=${900}>
        ${list.map(e => html`<${AvailableExtCard} key=${e.name} ext=${e}
          isInstalled=${e.installed || installedNames.has(e.name)}
          isInstalling=${busy === e.name}
          onInstall=${install} onReinstall=${again} reload=${onReload} loadAvailable=${load} />`)}
      <//>`}
      <${Text} kind="caption" tone="muted">${X('bundled.note')}<//>
    <//>
  <//>`;
}

/** Section 04: write one, and what the sandbox will and will not let it do. */
export function Scaffold({ onReload }) {
  return html`<${Section} title=${X('write.title')} count="04" description=${X('write.lead')}>
    <${Stack}>
      <${Columns} layout="leading" collapse=${900}>
        <${ScaffoldForm} onCreated=${onReload} />
        <${Stack} density="compact">
          <${Text} kind="label">${X('write.mayTitle')}<//>
          <${Surface} kind="box" density="compact">
            <${ListRow} density="compact" name=${X('write.ownStorage')} value=${html`<${Text} kind="mono">${'ext:<name>'}<//>`} />
            <${ListRow} density="compact" name=${X('write.personData')} value=${html`<${Text} kind="mono">${X('write.withConsent')}<//>`} />
            <${ListRow} density="compact" name=${X('write.outside')} value=${html`<${Text} kind="mono">${X('write.declaredOnly')}<//>`} />
            <${ListRow} density="compact" name=${X('write.otherExts')} value=${html`<${Text} kind="mono">${X('write.no')}<//>`} />
          <//>
          <${Text} kind="caption" tone="muted">${X('write.sandboxWhy')}<//>
        <//>
      <//>

      <${Surface} kind="plain" density="flush" summary=${X('write.ctxTitle')}>
        <${Stack}>
          <${Text} kind="caption" tone="muted">${X('write.ctxLead')}<//>
          <${Surface} kind="code">${[
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
  ].join('\n')}<//>
          <${Steps} items=${[X('write.step1'), X('write.step2'), X('write.step3'), X('write.step4')]} />
        <//>
      <//>
    <//>
  <//>`;
}
