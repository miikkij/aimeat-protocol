/**
 * @file public/views/admin/directory-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard "Directory" tab (Preact + HTM) — shows directory index stats (entries,
 *   cities, categories) and an operator control to rebuild the directory index.
 *
 * @structure
 *   - DirectoryTab({ data }): default export; renders StatsGrid + rebuild button, tracks rebuild state
 *   - doRebuild(): calls rebuildDirectory() and surfaces success/error feedback
 *
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the maintenance card is a small
 *     section, the rebuild an underlined action, the result a toned line. No inline styles left.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { StatsGrid, ExpandableHelp } from './shared.js';
import { rebuildDirectory } from '/js/services/admin.js';
import { Section, Stack, Action, Text } from '/components/poster-parts.js';

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

  return html`<${Stack}>
    <${Text} tone="muted">${t('dashboard.directoryExplain')}<//>
    <${ExpandableHelp} title=${t('dashboard.directoryHelpTitle')}>${t('dashboard.directoryHelpDetail')}<//>

    <${StatsGrid} items=${[
      { label: t('dashboard.totalEntries'), value: dir?.total || 0, tone: 'cyan' },
      { label: t('dashboard.cities'), value: dir?.cities || 0, tone: 'green' },
      { label: t('dashboard.categories'), value: dir?.categories || 0, tone: 'amber' },
    ]} />

    <${Section} title=${t('dashboard.directoryMaintenance')} size="small">
      <${Stack} direction="wrap" align="center">
        <${Action} onClick=${doRebuild} disabled=${rebuilding}>
          ${rebuilding ? '...' : t('dashboard.rebuildIndex')}<//>
        ${result && html`<${Text} tone=${result.ok ? 'success' : 'danger'}>${result.msg}<//>`}
      <//>
    <//>
  <//>`;
}
