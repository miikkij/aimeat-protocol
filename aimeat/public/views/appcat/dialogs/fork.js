/**
 * @file public/views/appcat/dialogs/fork.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Fork an app, or one of its versions, into the signed-in person's catalogue (features
 *   F128, F204). The old page asked for the new filename with the browser's own prompt(); here it is
 *   a small dialog with the same words ("Fork this app into your catalogue. New filename:"), the same
 *   default ("{name}-fork.html") and the same rule for the name. The node copies the bytes and records
 *   where they came from. Signed out it does not open: the notice asks the person to sign in.
 *   Opened from the versions dialog it goes back there when it is done or cancelled, with
 *   "✔ Forked to "{name}"" in that dialog's status line; opened anywhere else the result is a notice.
 *   A refusal (a name already taken, an app its owner has not opened for forking) stays in this
 *   dialog's status line so the name can be changed and tried again.
 * @structure default ForkDialog({ owner, filename, version, back })
 * @usage openDialog('fork', { owner, filename })  — props: owner, filename (the app forked); version
 *   (optional: that version, else the newest); back (optional { name, props }: the dialog to reopen
 *   afterwards, which receives `status`); onDone (optional: called after a fork).
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old detail.js forkVersion.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Stack } from '/components/Layout.js';
import { TextField } from '/components/TextField.js';
import { getSession } from '/js/services/auth.js';
import { reloadCatalog, notice } from '/views/appcat/store.js';
import { x } from '/views/appcat/i18n.js';
import { Dialog, openDialog } from '/views/appcat/dialogs/host.js';
import { Status } from '/views/appcat/dialogs/parts.js';
import { FILENAME_RE, forkApp } from '/views/appcat/dialogs/app-io.js';

const html = htm.bind(h);

export default function ForkDialog({ owner, filename, version, back, onDone, close }) {
  const signedIn = !!getSession();
  const [name, setName] = useState((String(filename || 'app').replace(/\.html?$/i, '')) + '-fork.html');
  const [bad, setBad] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!signedIn) { notice(x('common.loginRequired'), 'error'); close?.(); }
  }, [signedIn, close]);
  if (!signedIn) return null;

  const leave = (withStatus) => {
    if (back && back.name) openDialog(back.name, { ...(back.props || {}), ...(withStatus ? { status: withStatus } : {}) });
    else close?.();
  };

  const submit = async () => {
    const newName = name.trim();
    if (!newName) return;
    if (!FILENAME_RE.test(newName)) { setBad(true); return; }
    setBad(false);
    setBusy(true);
    setStatus({ text: x('fork.forking'), tone: 'ok' });
    try {
      await forkApp({ owner, filename, newName, version });
      const done = '✔ ' + x('fork.success') + ' "' + newName + '"';
      reloadCatalog();
      onDone?.();
      if (back && back.name) leave({ text: done, tone: 'ok' });
      else { notice(done, 'success'); close?.(); }
    } catch (e) {
      setBusy(false);
      setStatus({ text: '✘ ' + (e.message || x('fork.failed')), tone: 'err' });
    }
  };

  const footer = html`
    <${Action} onClick=${() => leave(null)}>${x('common.cancel')}<//>
    <${Loud} control disabled=${busy} onClick=${submit}>${x('card.fork')}<//>`;
  return html`<${Dialog} title=${x('card.fork')} size="sm" footer=${footer} onClose=${() => leave(null)}>
    <${Stack} gap="medium">
      <${Note} kind="hint">${x('fork.prompt')}<//>
      <${TextField} code autoFocus ariaLabel=${x('fork.newName')} value=${name}
        onInput=${(v) => { setName(v); setBad(false); }} onEnter=${submit}
        message=${bad ? x('fork.invalid') : null} error=${bad} />
      <${Status} status=${status} />
    <//>
  <//>`;
}
