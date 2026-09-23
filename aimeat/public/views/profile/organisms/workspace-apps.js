/**
 * @file workspace-apps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Workspace "Apps" strip — the apps pinned to this workspace (the `…meta.apps` binding
 *   record), rendered as launch cards like the landing wall, plus a creator/admin picker to pin/unpin
 *   published apps. Launching passes the workspace context in the URL FRAGMENT
 *   (#aimeat-ws={orgId}/{wsId}) — the fragment survives the app-origin redirect chain, so the app
 *   boots pinned to this workspace no matter which origin finally serves it. Pinning is
 *   presentation/launch-context only: workspace DATA access stays enforced server-side per call.
 * @structure WorkspaceApps
 * @usage import { WorkspaceApps } from '/views/profile/organisms/workspace-apps.js';
 * @version-history
 *   v1.1.0 -- 2026-09-22 -- Composed from the shared set: a small Section, a pinned app is a ListRow that
 *     launches it, the picker is a box of rows; no class of its own, the gear glyph gone.
 *   v1.0.0 — 2026-07-02 — Initial: pinned-app cards + creator/admin pin/unpin picker.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { openAppSandboxed } from '/js/app-sandbox.js';
import { listApps } from '/js/services/apps.js';
import { saveWorkspaceApps } from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';
import { Section, Stack, Surface, ListRow, Action, Field, Text } from '/components/poster-parts.js';

/** The launch URL for a pinned app, carrying the workspace context in the fragment. */
function launchHref(orgId, wsId, b) {
  return `/v1/apps/${encodeURIComponent(b.owner)}/${encodeURIComponent(b.filename)}?mode=inline`
    + `#aimeat-ws=${encodeURIComponent(orgId)}/${encodeURIComponent(wsId)}`;
}

export function WorkspaceApps({ orgId, wsId, apps, canEdit, showToast, onChanged }) {
  const bound = Array.isArray(apps) ? apps : [];
  const [catalog, setCatalog] = useState(null);   // null = not loaded yet; [] = loaded (maybe empty)
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  // The public /v1/apps catalog resolves each binding to its card (name/description/icon) and feeds
  // the picker. Loaded lazily — only when there is something to resolve or the picker is open.
  useEffect(() => {
    if (bound.length === 0 && !showPicker) return undefined;
    let cancelled = false;
    listApps().then(a => { if (!cancelled) setCatalog(a); }).catch((err) => { swallowed('workspace-apps', err); if (!cancelled) setCatalog([]); });
    return () => { cancelled = true; };
  }, [bound.length, showPicker]);

  // Members with no pins and no edit rights see nothing — no empty clutter on the overview.
  if (bound.length === 0 && !canEdit) return null;

  const sameApp = (a, b) => a.owner === b.owner && a.filename === b.filename;
  const findApp = (b) => (catalog || []).find(a => sameApp(a, b)) || null;
  const launch = (b) => {
    const rec = findApp(b);
    openAppSandboxed(launchHref(orgId, wsId, b), b.label || rec?.manifest?.name || b.filename);
  };

  const save = async (next) => {
    setBusy(true);
    try {
      await saveWorkspaceApps(orgId, wsId, next.map(b => ({ owner: b.owner, filename: b.filename, ...(b.label ? { label: b.label } : {}) })));
      showToast?.(t('organisms.apps.saved') || 'Workspace apps updated', 'success');
      onChanged?.();
    } catch (err) {
      swallowed('workspace-apps: save', err);
      showToast?.(t('organisms.apps.saveError') || 'Could not update apps', 'error');
    } finally { setBusy(false); }
  };
  const togglePin = (a) => {
    const has = bound.some(b => sameApp(a, b));
    save(has ? bound.filter(b => !sameApp(a, b)) : [...bound, { owner: a.owner, filename: a.filename }]);
  };

  const renderCard = (b) => {
    const rec = findApp(b);
    const m = rec?.manifest || {};
    const name = b.label || m.name || b.filename;
    const desc = (m.description || '').length > 110 ? m.description.slice(0, 110) + '…' : (m.description || '');
    return html`
      <${ListRow} key=${b.owner + '/' + b.filename} density="compact" detailKind="text"
        name=${`${m.icon ? m.icon + ' ' : ''}${name}`} onOpen=${() => launch(b)} detail=${desc || undefined}
        value=${catalog !== null && !rec ? html`<${Text} kind="caption" tone="danger">${t('organisms.apps.missing') || 'Not in the catalog (removed?)'}<//>` : (m.authorDisplay || b.owner)} />`;
  };

  // Picker rows: pinned apps first, then the rest alphabetically; a search filters by name/owner.
  const ql = q.trim().toLowerCase();
  const pickerRows = (catalog || [])
    .filter(a => !ql || [a.manifest?.name, a.manifest?.description, a.owner, a.filename].some(v => (v || '').toLowerCase().includes(ql)))
    .sort((a, x) => {
      const pa = bound.some(b => sameApp(a, b)) ? 0 : 1;
      const px = bound.some(b => sameApp(x, b)) ? 0 : 1;
      return pa !== px ? pa - px : String(a.manifest?.name || a.filename).localeCompare(String(x.manifest?.name || x.filename));
    });

  return html`
    <${Section} title=${t('organisms.apps.title') || 'Apps'} size="small" density="compact"
      description=${t('organisms.apps.hint') || 'Pinned to this workspace — they open with it as context.'}
      actions=${canEdit ? html`
        <${Action} kind="tab" selected=${showPicker} onClick=${() => setShowPicker(s => !s)}>
          ${showPicker ? (t('organisms.apps.done') || 'Done') : (t('organisms.apps.manage') || 'Manage')}
        <//>` : null}>
      <${Stack}>
        ${bound.length > 0
          ? html`<${Stack} density="compact">${bound.map(renderCard)}<//>`
          : html`<${Text} tone="muted">${(t('organisms.apps.none') || 'No apps pinned yet.')}${canEdit ? ' ' + (t('organisms.apps.noneHint') || 'Pin a published app so members can launch it from here.') : ''}<//>`}
        ${showPicker ? html`
          <${Surface} kind="box" density="compact">
            <${Stack}>
              <${Text} kind="caption" tone="muted">${t('organisms.apps.pickerDesc') || 'Pick published apps to show in this workspace. Pinning only adds a launch card — data access follows workspace access.'}<//>
              <${Field} type="search" placeholder=${t('organisms.apps.search') || 'Search apps…'}
                value=${q} onInput=${e => setQ(e.target.value)} />
              ${catalog === null ? html`<${Text} tone="muted">…<//>`
                : pickerRows.length === 0 ? html`<${Text} tone="muted">${ql ? (t('organisms.apps.noMatch') || 'No apps match.') : (t('organisms.apps.catalogEmpty') || 'No published apps on this node yet.')}<//>`
                : html`<${Stack} density="compact">${pickerRows.map(a => {
                    const pinned = bound.some(b => sameApp(a, b));
                    return html`
                      <${ListRow} key=${a.owner + '/' + a.filename} density="compact" selected=${pinned}
                        name=${`${a.manifest?.icon ? a.manifest.icon + ' ' : ''}${a.manifest?.name || a.filename}`}
                        value=${a.manifest?.authorDisplay || a.owner}
                        actions=${html`<${Action} disabled=${busy} onClick=${() => togglePin(a)}>
                          ${pinned ? (t('organisms.apps.unpin') || 'Unpin') : (t('organisms.apps.pin') || 'Pin')}
                        <//>`} />`;
                  })}<//>`}
            <//>
          <//>` : null}
      <//>
    <//>`;
}
