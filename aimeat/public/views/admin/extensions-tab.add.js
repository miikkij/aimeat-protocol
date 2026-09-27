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
 *   v2.0.0 — 2026-09-27 — Every part is a library component that gets data (admin page group G7): the
 *     sections are Section, the leads and hints Notes, the cards a CardGrid, the sandbox rules a List
 *     in the Object box beside the form, the manual the ExpandableHelp fold with the Code block and the
 *     StepList. No class.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-12 — Initial, with the page renamed from Services to Extensions.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, Empty, ExpandableHelp, useToast, Toast } from './shared.js';
import { getAvailableExtensions, installBundledExtension, reinstallExtension } from '/js/services/admin.js';
import { Section } from '/components/Section.js';
import { CardGrid } from '/components/Card.js';
import { Box } from '/components/Box.js';
import { List, Row, Name, Cell } from '/components/List.js';
import { Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { StepList } from '/components/StepList.js';
import { Beside } from '/components/Layout.js';
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
    <${Section} num="03" title=${X('bundled.title')}
      doors=${html`<${Note} kind="meta" inline>${X('bundled.count', { n: num(notIn), total: num(list.length) })}<//>`}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Note} kind="lead">${X('bundled.lead')}<//>
      ${loading ? html`<${Note} kind="loading">${t('dashboard.loading')}<//>` : null}
      ${!loading && list.length === 0 ? html`<${Empty} text=${X('bundled.none')} />` : null}
      <${CardGrid} cols="two">
        ${list.map(e => html`<${AvailableExtCard} key=${e.name} ext=${e}
          isInstalled=${e.installed || installedNames.has(e.name)}
          isInstalling=${busy === e.name}
          onInstall=${install} onReinstall=${again} reload=${onReload} loadAvailable=${load} />`)}
      <//>
      <${Note}>${X('bundled.note')}<//>
    <//>`;
}

/** Section 04: write one, and what the sandbox will and will not let it do. */
export function Scaffold({ onReload }) {
  const rules = [
    [X('write.ownStorage'), 'ext:<name>'],
    [X('write.personData'), X('write.withConsent')],
    [X('write.outside'), X('write.declaredOnly')],
    [X('write.otherExts'), X('write.no')],
  ];
  const may = html`
    <${Label} block>${X('write.mayTitle')}<//>
    <${Box}>
      <${List} cols="name-what" keepCols dense>
        ${rules.map(([what, answer]) => html`<${Row} key=${what}><${Name}>${what}<//><${Cell} meta>${answer}<//><//>`)}
      <//>
    <//>
    <${Note}>${X('write.sandboxWhy')}<//>`;

  return html`
    <${Section} num="04" title=${X('write.title')}>
      <${Note} kind="lead">${X('write.lead')}<//>
      <${Beside} narrow side=${may}>
        <${ScaffoldForm} onCreated=${onReload} />
      <//>

      <${ExpandableHelp} title=${X('write.ctxTitle')}>
        <${Note}>${X('write.ctxLead')}<//>
        <${Code} block>${[
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
        <${StepList} steps=${[X('write.step1'), X('write.step2'), X('write.step3'), X('write.step4')]} />
      <//>
    <//>`;
}
