/**
 * @file public/views/appcat/dialogs/protect.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Copy protection for an own published app (features F141, F195): "Copy protection
 *   {filename}", the help paragraph on what these can and cannot do, four checks prefilled from the
 *   listing (Obfuscate, Domain-lock, Watermark, No raw download), each with its one-line meaning, a
 *   status line, Close and Save. Save sends PATCH /v1/apps/{filename} {protection}, says "Saving…" then
 *   "✔ Saved", reads the listing again and closes 0.8 s later.
 * @structure default ProtectDialog({ filename, owner, protection })
 * @usage openDialog('protect', { filename })  — props: filename (the own app); owner (optional, to find
 *   the listing row); protection (optional: the flags now; without it the store's listing row's
 *   manifest.protection is read); onDone (optional: called after a save, e.g. the detail's reload).
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity: the filename after the title in the typewriter face (titleRef), the
 *     help in the small grey line, the four flags as ruled rows, the status line holding its room, a
 *     refusal in coral, as the old dialog.
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old detail.js protection modal.
 */
import { h } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Check } from '/components/Check.js';
import { Note } from '/components/Note.js';
import { Stack } from '/components/Layout.js';
import { apiPatch } from '/js/api.js';
import { getSession } from '/js/services/auth.js';
import { useCatalog, reloadCatalog, notice } from '/views/appcat/store.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog } from '/views/appcat/dialogs/host.js';
import { Status } from '/views/appcat/dialogs/parts.js';
import { me, sameOwner } from '/views/appcat/dialogs/app-io.js';

const html = htm.bind(h);

const FLAGS = ['obfuscate', 'domainLock', 'watermark', 'noRawDownload'];

export default function ProtectDialog({ filename, owner, protection, onDone, close }) {
  const cat = useCatalog();
  const row = (cat.own || cat.all || []).find((r) => r && r.filename === filename && sameOwner(r.owner, owner || me()));
  const start = protection || (row && row.manifest && row.manifest.protection) || {};
  const [flags, setFlags] = useState(() => Object.fromEntries(FLAGS.map((f) => [f, !!start[f]])));
  const [status, setStatus] = useState(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const save = async () => {
    if (!getSession()) { notice(x('common.loginRequired'), 'error'); return; }
    setStatus({ text: x('protect.saving'), tone: 'busy' });
    try {
      await apiPatch('/v1/apps/' + encodeURIComponent(filename), { protection: { ...flags } });
      setStatus({ text: '✔ ' + x('protect.saved'), tone: 'ok' });
      reloadCatalog();
      onDone?.();
      timer.current = setTimeout(() => close?.(), 800);
    } catch (e) {
      setStatus({ text: '✘ ' + (e.message || x('protect.failed')), tone: 'refused' });
    }
  };

  const footer = html`
    <${Action} onClick=${close}>${x('common.close')}<//>
    <${Loud} control onClick=${save}>${x('protect.save')}<//>`;
  return html`<${Dialog} title=${x('protect.title')} titleRef=${filename} size="md" footer=${footer}>
    <${Stack} gap="medium">
      <${Note} kind="caption">${x('protect.help')}<//>
      <${Stack} gap="none">
        ${FLAGS.map((f) => html`<${Check} ruled key=${f} checked=${flags[f]} onChange=${(on) => setFlags((all) => ({ ...all, [f]: on }))}>
          <span><strong>${x('protect.' + f)}</strong> — ${x('protect.' + f + 'Hint')}</span>
        <//>`)}
      <//>
    <//>
    <${Status} keep status=${status} />
  <//>`;
}
