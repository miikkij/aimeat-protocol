/**
 * @file public/views/admin/directory-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard "Directory" tab (Preact + HTM) — shows directory index stats (entries,
 *   cities, categories) and an operator control to rebuild the directory index. The tab draws library
 *   components and passes them data; it writes no class and no style.
 *
 * @structure
 *   - DirectoryTab({ data }): default export; renders StatsGrid + rebuild button, tracks rebuild state
 *   - doRebuild(): calls rebuildDirectory() and surfaces success/error feedback
 *
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components, no class or inline style: the explanation is a hint,
 *     the maintenance card is the Object box under its sub-heading, Rebuild is the loud action, the
 *     result is the form's message (fine or refused).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { StatsGrid, ExpandableHelp } from './shared.js';
import { rebuildDirectory } from '/js/services/admin.js';
import { Box } from '/components/Box.js';
import { Loud } from '/components/Action.js';
import { FormActions } from '/components/Field.js';
import { Space } from '/components/Layout.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';

export default function DirectoryTab({ data }) {
  const dir = data.directory;
  const [rebuilding, setRebuilding] = useState(false);
  const [result, setResult] = useState(null);

  async function doRebuild() {
    setRebuilding(true);
    setResult(null);
    try {
      await rebuildDirectory();
      setResult({ ok: true, msg: t('dashboard.directoryRebuilt') });
    } catch (e) {
      setResult({ ok: false, msg: e.message });
    }
    setRebuilding(false);
  }

  return html`
    <${Note}>${t('dashboard.directoryExplain')}<//>
    <${ExpandableHelp} title=${t('dashboard.directoryHelpTitle')}>${t('dashboard.directoryHelpDetail')}<//>

    <${StatsGrid} items=${[
      { label: t('dashboard.totalEntries'), value: dir?.total || 0, tone: 'cyan' },
      { label: t('dashboard.cities'), value: dir?.cities || 0, tone: 'green' },
      { label: t('dashboard.categories'), value: dir?.categories || 0, tone: 'amber' },
    ]} />

    <${Space} above="medium">
      <${Box}>
        <${SubHeading} level=${4}>${t('dashboard.directoryMaintenance')}<//>
        <${FormActions}>
          <${Loud} control onClick=${doRebuild} disabled=${rebuilding}>
            ${rebuilding ? '...' : t('dashboard.rebuildIndex')}
          <//>
          ${result && html`<${Note} kind="message" error=${!result.ok}>${result.msg}<//>`}
        <//>
      <//>
    <//>
  `;
}
