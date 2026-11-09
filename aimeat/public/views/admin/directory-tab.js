/**
 * @file public/views/admin/directory-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard "Directory" tab (Preact + HTM) — shows directory index stats (people and
 *   shared places listed, the most common cities and interests) and an operator control to rebuild the
 *   directory index. The tab draws library
 *   components and passes them data; it writes no class and no style.
 *
 * @structure
 *   - DirectoryTab({ data }): default export; renders StatsGrid + rebuild button, tracks rebuild state
 *   - doRebuild(): calls rebuildDirectory() and surfaces success/error feedback
 *
 * @version-history
 *   v2.1.0 — 2026-11-09 — The figures read data.directoryStats (totalPeople, totalOrganisms, topCities,
 *     topInterests), what the admin frame keeps; the page read data.directory, which nothing set, so
 *     every figure showed 0. "Categories" went: the directory has none (guidance audit 2026-11-09).
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
  // GET /v1/admin/directory/stats (services/directory.ts getStats), kept by the admin frame as directoryStats.
  const dir = data.directoryStats;
  const named = (rows) => (rows || []).slice(0, 5).map((r) => `${r.name} (${r.count})`).join(', ');
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
      { label: t('dashboard.directoryPeople'), value: dir?.totalPeople || 0, tone: 'cyan' },
      { label: t('dashboard.directoryPlaces'), value: dir?.totalOrganisms || 0, tone: 'green' },
    ]} />
    ${named(dir?.topCities) ? html`<${Note} kind="meta">${t('dashboard.directoryTopCities', { list: named(dir.topCities) })}<//>` : null}
    ${named(dir?.topInterests) ? html`<${Note} kind="meta">${t('dashboard.directoryTopInterests', { list: named(dir.topInterests) })}<//>` : null}

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
