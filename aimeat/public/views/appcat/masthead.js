/**
 * @file public/views/appcat/masthead.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalogue's masthead (features.md F22–F24, F79–F85): the page's name and its mono
 *   line, the one loud control ("+ Create an app", which opens the generate-with-AI dialog), and the
 *   quiet words: add a finished app (after a sign-in), a portfolio page of your apps (a prompt shown in
 *   the source dialog), "Backups and imports" (a small menu: export every app as a ZIP, import from a
 *   backup ZIP), Help and Settings. The acts keep the old page's routes (GET /v1/apps/backup; the
 *   import dialog reads the file). Drawn with PageHead low, Loud, Action and CardMenu; no class here.
 * @structure CatMasthead({ own, me, loaded }) · portfolioPrompt(rows) · exportBackup() · openAdd()
 * @usage html`<${CatMasthead} own=${cat.own} me=${cat.me} loaded=${cat.loaded} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat, the shell).
 */
import { h } from 'preact';
import { useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { PageHead } from '/components/PageHead.js';
import { Loud, Action, Actions } from '/components/Action.js';
import { CardMenu } from '/components/CardMenu.js';
import { getSession, authHeaders } from '/js/services/auth.js';
import { x } from '/views/appcat/i18n.js';
import { notice } from '/views/appcat/store.js';
import { openDialog } from '/views/appcat/dialogs/host.js';
import { signInThen } from '/views/appcat/dialogs/app-io.js';
import { appName, appIcon, appTags, host } from '/views/appcat/model.js';

const html = htm.bind(h);

/** Add a finished app (F80): sign in first when needed, then the Add dialog on its Paste tab. */
export function openAdd() { signInThen(() => openDialog('add', { tab: 'paste' })); }

/**
 * The portfolio page's prompt (F81, render.js generateHomepagePrompt): one line per own app, then what
 * the page must be. The prompt is for an AI, in English, as it was.
 */
export function portfolioPrompt(rows) {
  const lines = rows.map((sa) => {
    const m = sa.manifest || {};
    const url = location.origin + '/v1/apps/' + encodeURIComponent(sa.owner || '') + '/' + encodeURIComponent(sa.filename || '');
    const tags = appTags(sa);
    return '- ' + appIcon(sa) + ' ' + appName(sa) + (m.description ? ' (' + m.description + ')' : '') + ' [URL: ' + url + ']'
      + (tags.length ? ' Tags: ' + tags.join(', ') : '');
  }).join('\n');
  return 'Create a single HTML file that serves as my personal homepage/dashboard.\n\n'
    + 'My apps:\n' + lines + '\n\n'
    + 'Requirements:\n'
    + '- Show each app as a clickable card with its icon and name\n'
    + '- For URL-based apps, clicking opens the URL in a new tab\n'
    + '- For local apps, show a note that they can be opened from the App Launcher\n'
    + '- Modern, responsive design with light theme\n'
    + '- Group apps by their tags if they have tags\n'
    + '- Everything in one self-contained HTML file, no external dependencies\n'
    + '- Add a header with my name/title (I will customize this)\n'
    + '- Make it visually distinctive and professional';
}

/**
 * Save every own app as a ZIP (F83, F241, F269): the node streams it; the file is named from its
 * Content-Disposition. Resolves when the download has been handed to the browser.
 */
export async function exportBackup() {
  const resp = await fetch('/v1/apps/backup', { headers: authHeaders() });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  const cd = resp.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="([^"]+)"/);
  const blob = await resp.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = m ? m[1] : 'aimeat-apps-backup.zip';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/**
 * @param {{ own: any[], me: string|null, loaded: boolean }} props
 */
export function CatMasthead({ own, me, loaded }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const portfolio = () => {
    if (!own.length) { notice(x('homepage.needApps')); return; }
    openDialog('source', { title: x('homepage.title'), text: portfolioPrompt(own), prompt: true });
  };
  const exportAll = async () => {
    if (!getSession()) { notice(x('backup.loginRequired')); return; }
    setBusy(true);
    try { await exportBackup(); } catch (e) { notice(x('backup.exportFailed', { msg: e?.message || String(e) }), 'error'); } finally { setBusy(false); }
  };
  const importPick = () => {
    if (!getSession()) { notice(x('backup.loginRequired')); return; }
    fileRef.current?.click();
  };
  const picked = (e) => {
    const file = e.currentTarget.files && e.currentTarget.files[0];
    e.currentTarget.value = ''; // the same file can be picked again (F84)
    if (file) openDialog('backup-import', { file });
  };
  const line = loaded && own.length ? x('mast.line', { owner: (own[0] && own[0].owner) || me || '', n: own.length, host: host() }) : '';

  return html`<${PageHead} low title=${x('header.title')} line=${line} actions=${html`
    <${Loud} mark="+" title=${x('action.generate')} onClick=${() => openDialog('generate', { mode: 'new' })}>${x('action.createApp')}<//>
    <${Actions} end>
      <${Action} onClick=${openAdd}>${x('action.haveApp')}<//>
      <${Action} onClick=${portfolio}>${x('action.portfolio')}<//>
    <//>
    <${Actions} end>
      <${CardMenu} word=${x('action.backups')} framed disabled=${busy} label=${x('backup.menu')}
        actions=${[{ label: x('backup.exportAll'), run: exportAll }, { label: x('backup.importFrom'), run: importPick }]} />
      <${Action} onClick=${() => openDialog('help')}>${x('action.help')}<//>
      <${Action} onClick=${() => openDialog('settings')}>${x('action.settings')}<//>
    <//>
    <input type="file" hidden ref=${fileRef} accept=".zip,application/zip,application/x-zip-compressed" onChange=${picked} />`} />`;
}

export default CatMasthead;
