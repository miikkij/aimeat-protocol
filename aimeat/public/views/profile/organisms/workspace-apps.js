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
 *   v2.0.0 — 2026-09-26 — Every part is a library component that takes data: the strip is the Object box
 *     (Box), its head a Layout row of the Sub-heading, the Hint and the Manage action, a pinned app the
 *     Card (the whole card its door, Enter and Space too) in a CardGrid, the picker a Split with the
 *     Text field and the List (its loading and empty lines the List's own). The page writes no class
 *     (page migration G2b).
 *   v1.9.0 — 2026-09-26 — A small heading over a group of fields, a card or a note is the Sub-heading (.sub-heading: small ink headline letters); the coral small capitals, the bold ink words and the coral headline letters go (a unification: Jouni's decision "Sub-heading").
 *   v1.8.0 — 2026-09-26 — A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.7.0 — 2026-09-26 — A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.6.0 — 2026-09-26 — Pin is the action link (.poster-action) and Unpin its danger tone (.poster-action--danger), not the classic buttons (a unification: Jouni's decision "Action link").
 *   v1.5.0 — 2026-09-26 — The app picker's apps are the Listing (css/components/listing.css, name-tags-doors, columns kept on a phone), a unification: the look most tabs use.
 *   v1.4.0 — 2026-09-26 — A pinned app the catalogue no longer has says so with the Status, attention (.poster-status--attention), a unification: Jouni's decision "Status".
 *   v1.3.0 — 2026-09-25 — "Manage" (it opens the app picker, and says "Done" while it is open) is the action link (.poster-action); aria-expanded says it is open (a unification: Jouni's decision "Action link").
 *   v1.2.0 — 2026-09-25 — A search field over a list is the Search line (.search-line with the Text field); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.1.0 — 2026-09-25 — Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
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
import { Box } from '/components/Box.js';
import { Card, CardGrid } from '/components/Card.js';
import { Action } from '/components/Action.js';
import { Mark } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { SubHeading, HeadDesc } from '/components/SubHeading.js';
import { TextField } from '/components/TextField.js';
import { Row as Line, Split } from '/components/Layout.js';
import { List, Row, Name, Desc, Doors } from '/components/List.js';

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

  // One pinned app is a launch card; the whole card is the door (Enter and Space too).
  const renderCard = (b) => {
    const rec = findApp(b);
    const m = rec?.manifest || {};
    const name = b.label || m.name || b.filename;
    const desc = (m.description || '').length > 110 ? m.description.slice(0, 110) + '…' : (m.description || '');
    return html`
      <${Card} key=${b.owner + '/' + b.filename} name=${(m.icon ? m.icon + ' ' : '') + name} text=${desc || undefined} clamp
        meta=${catalog !== null && !rec ? html`<${Mark} kind="status" tone="attention">${t('organisms.apps.missing') || 'Not in the catalog (removed?)'}<//>` : (m.authorDisplay || b.owner)}
        onOpen=${() => launch(b)} openLabel=${t('organisms.apps.open') || 'Open'} />`;
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

  const searchWords = t('organisms.apps.search') || 'Search apps…';
  return html`
    <${Box}>
      <${Line} wrap gap="medium" below="small">
        <${SubHeading} inline>${t('organisms.apps.title') || 'Apps'}<//>
        <${Note} inline>${t('organisms.apps.hint') || 'Pinned to this workspace — they open with it as context.'}<//>
        ${canEdit ? html`
          <${Action} small expanded=${showPicker} onClick=${() => setShowPicker(s => !s)}>
            ${showPicker ? (t('organisms.apps.done') || 'Done') : ('⚙ ' + (t('organisms.apps.manage') || 'Manage'))}
          <//>` : null}
      <//>
      ${bound.length > 0
        ? html`<${CardGrid} cols="fill">${bound.map(renderCard)}<//>`
        : html`<${Note} kind="quiet">${(t('organisms.apps.none') || 'No apps pinned yet.')}${canEdit ? ' ' + (t('organisms.apps.noneHint') || 'Pin a published app so members can launch it from here.') : ''}<//>`}
      ${showPicker ? html`
        <${Split} gap="small">
          <${HeadDesc}>${t('organisms.apps.pickerDesc') || 'Pick published apps to show in this workspace. Pinning only adds a launch card — data access follows workspace access.'}<//>
          <${TextField} placeholder=${searchWords} ariaLabel=${searchWords} value=${q} onInput=${setQ} />
          <${List} cols="name-tags-doors" keepCols loading=${catalog === null ? '…' : false}
            empty=${ql ? (t('organisms.apps.noMatch') || 'No apps match.') : (t('organisms.apps.catalogEmpty') || 'No published apps on this node yet.')}>
            ${pickerRows.map(a => {
              const pinned = bound.some(b => sameApp(a, b));
              return html`
                <${Row} key=${a.owner + '/' + a.filename}>
                  <${Name}>${a.manifest?.icon ? a.manifest.icon + ' ' : ''}${a.manifest?.name || a.filename}<//>
                  <${Desc}>${a.manifest?.authorDisplay || a.owner}<//>
                  <${Doors}><${Action} small row tone=${pinned ? 'danger' : undefined} disabled=${busy} onClick=${() => togglePin(a)}>
                    ${pinned ? (t('organisms.apps.unpin') || 'Unpin') : (t('organisms.apps.pin') || 'Pin')}
                  <//><//>
                <//>`;
            })}
          <//>
        <//>` : null}
    <//>`;
}
