/**
 * @file public/views/appcat/dialogs/backup.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's "Backups and imports" (features F82–F84, F116, F241, F269): the words in the
 *   masthead open a small menu with "Export all (.zip)" and "Import from backup..."; a press anywhere
 *   else closes it. Both need a signed-in person ("Sign in first to use backups." otherwise).
 *   - Export all: GET /v1/apps/backup with the session, the words can not be pressed while it runs,
 *     and the ZIP the node builds (every app with every version, and the extensions this person
 *     installed; F269) is handed to the browser as a download named by the node's Content-Disposition
 *     (aimeat-apps-backup.zip if it names none). "Export failed: {message}" when it fails.
 *   - Import from backup: the browser's file window for one .zip; the pick opens the backup-import
 *     dialog, which reads it on the node. The same file can be picked again.
 *   BackupMenu is what the shell draws in the masthead. The same two acts also open as a small
 *   dialog by name (openDialog('backup')), for a part that has no room for a menu.
 *   Nothing is kept in the browser: the download's object address is let go 5 s after it was handed
 *   over. The old page's third export is not here: the one-time JSON download of apps left in the
 *   retired browser-local catalogue (F275, F355) read the browser's IndexedDB, and appcat reads no
 *   browser storage (Jouni: "selaimen omaa tallennusta ei pitäisi olla"). The old page still offers it.
 * @structure BackupMenu() · exportBackup(setBusy?) · BackupDialog({ close }) (default)
 * @usage import { BackupMenu } from '/views/appcat/dialogs/backup.js'; html`<${BackupMenu} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat).
 */
import { h } from 'preact';
import { useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { CardMenu } from '/components/CardMenu.js';
import { FileDrop } from '/components/FileDrop.js';
import { Action, Actions } from '/components/Action.js';
import { getSession, authHeaders } from '/js/services/auth.js';
import { notice } from '/views/appcat/store.js';
import { Dialog, openDialog } from '/views/appcat/dialogs/host.js';
import { x } from '/views/appcat/i18n.js';

const html = htm.bind(h);
const ACCEPT = '.zip,application/zip,application/x-zip-compressed';

/** Signed in, or say that backups need it. */
function signedIn() {
  if (getSession()) return true;
  notice(x('backup.loginRequired'), 'info');
  return false;
}

/**
 * Download the whole backup ZIP from the node. `setBusy(true|false)` hears while it runs.
 * @param {(busy: boolean) => void} [setBusy]
 */
export async function exportBackup(setBusy) {
  if (!signedIn()) return;
  setBusy?.(true);
  try {
    const res = await fetch('/v1/apps/backup', { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const m = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m ? m[1] : 'aimeat-apps-backup.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    notice(x('backup.exportFailed', { message: err.message || String(err) }), 'error');
  } finally {
    setBusy?.(false);
  }
}

/** The hidden file window and the act that opens it. */
function useBackupPick() {
  const input = useRef(null);
  const pick = () => { if (signedIn()) input.current?.click(); };
  const field = html`<${FileDrop} hidden accept=${ACCEPT} inputRef=${input}
    onFiles=${([file]) => { if (file) openDialog('backup-import', { file }); }} />`;
  return [pick, field];
}

/** "Backups and imports": the words and the menu they open. */
export function BackupMenu() {
  const [busy, setBusy] = useState(false);
  const [pick, field] = useBackupPick();
  return html`<${CardMenu} word=${x('action.backups')} label=${x('backup.menu')} framed disabled=${busy}
      actions=${[
        { label: x('backup.exportAll'), run: () => exportBackup(setBusy) },
        { label: x('backup.importFrom'), run: pick },
      ]} />${field}`;
}

/** The same two acts as a small dialog (openDialog('backup')). */
export default function BackupDialog({ close }) {
  const [busy, setBusy] = useState(false);
  const [pick, field] = useBackupPick();
  return html`<${Dialog} title=${x('backup.menu')} size="sm" onClose=${close}
    footer=${html`<${Action} onClick=${close}>${x('common.close')}<//>`}>
    <${Actions}>
      <${Action} disabled=${busy} onClick=${() => exportBackup(setBusy)}>${x('backup.exportAll')}<//>
      <${Action} onClick=${pick}>${x('backup.importFrom')}<//>
    <//>
    ${field}
  <//>`;
}
