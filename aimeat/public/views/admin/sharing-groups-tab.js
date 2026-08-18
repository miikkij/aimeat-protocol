/**
 * @file sharing-groups-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard tab for browsing all sharing groups across all owners.
 *   Shows group name, owner, member count, entry count, and creation date.
 * @version-history
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 *   v1.1.0 -- 2026-07-18 -- Vaihe 2d: hand-rolled <table> → canonical admin <DataTable>
 *     (rows/headers model); cell content preserved verbatim.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { num, dt, Empty, StatsGrid, DataTable } from './shared.js';
import { apiGet } from '/js/api.js';

export default function SharingGroupsTab() {
  const [groups, setGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const loadGroups = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const r = await apiGet('/v1/admin/sharing-groups');
      if (r.data) {
        setGroups(r.data.groups || []);
        setTotal(r.data.total || 0);
      }
    } catch (e) {
      console.warn('Failed to load sharing groups:', e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  // Listen for live updates
  useEffect(() => onLiveUpdate(['groups'], () => loadGroups({ showSpinner: false })), [loadGroups]);

  return html`
    <div>
      <!-- Stats summary -->
      <${StatsGrid} items=${[{ label: t('dashboard.sharingGroupsTotal'), value: total }]} />

      <!-- Table -->
      ${groups.length === 0 && !loading && html`<${Empty} text=${t('dashboard.sharingGroupsEmpty')} />`}

      ${groups.length > 0 && html`
        <${DataTable}
          headers=${[t('dashboard.sharingGroupsName'), t('dashboard.sharingGroupsOwner'), t('dashboard.sharingGroupsMembers'), t('dashboard.sharingGroupsEntries'), t('dashboard.sharingGroupsCreated')]}
          rows=${groups.map(g => [
            escHtml(g.name),
            html`<span class="mono" style="font-size:.8rem">${escHtml(g.owner_gaii)}</span>`,
            num(g.member_count),
            num(g.entry_count),
            html`<span style="color:var(--text-dim)">${dt(g.created_at)}</span>`,
          ])}
        />
      `}
    </div>
  `;
}
