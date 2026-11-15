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
 *   Another person's app behind an access code needs that code to be forked: the dialog asks for it
 *   (the access code field of the app's own settings, typed hidden) from the start when the caller
 *   says so (`needsCode`), or after the node's first 403 ACCESS_DENIED, and sends it as access_code.
 *   A wrong code says so in the status line and the person types it again.
 * @structure default ForkDialog({ owner, filename, version, needsCode, back })
 * @usage openDialog('fork', { owner, filename })  — props: owner, filename (the app forked); version
 *   (optional: that version, else the newest); needsCode (optional: the app is behind an access code
 *   and the viewer is neither its owner nor the operator); back (optional { name, props }: the dialog
 *   to reopen afterwards, which receives `status`); onDone (optional: called after a fork).
 * @version-history
 *   v1.1.0 — 2026-11-15 — The access code field: POST .../fork asks another person for the code of
 *     an app behind one (E2E audit M093), and the dialog had no field for it.
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

export default function ForkDialog({ owner, filename, version, needsCode, back, onDone, close }) {
  const signedIn = !!getSession();
  const [name, setName] = useState((String(filename || 'app').replace(/\.html?$/i, '')) + '-fork.html');
  const [bad, setBad] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  // The access code of another person's app behind one: asked from the start when the row says so,
  // or from the first 403 ACCESS_DENIED when the caller did not know.
  const [askCode, setAskCode] = useState(!!needsCode);
  const [code, setCode] = useState('');

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
    const accessCode = askCode ? code.trim() : '';
    if (askCode && !accessCode) { setStatus({ text: x('fork.codeEmpty'), tone: 'err' }); return; }
    setBusy(true);
    setStatus({ text: x('fork.forking'), tone: 'ok' });
    try {
      await forkApp({ owner, filename, newName, version, accessCode });
      const done = '✔ ' + x('fork.success') + ' "' + newName + '"';
      reloadCatalog();
      onDone?.();
      if (back && back.name) leave({ text: done, tone: 'ok' });
      else { notice(done, 'success'); close?.(); }
    } catch (e) {
      setBusy(false);
      if (e.status === 403 && e.code === 'ACCESS_DENIED') {
        // The node's refusal in plain words: a sent code was wrong, or the app needs one.
        setAskCode(true);
        setStatus(accessCode ? { text: '✘ ' + x('fork.codeWrong'), tone: 'err' } : null);
        return;
      }
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
      ${askCode ? html`
        <${Note} kind="hint">${x('fork.codeAsk')}<//>
        <${TextField} secret autoFocus label=${x('detail.accessCodeLabel')} value=${code}
          onInput=${(v) => { setCode(v); if (status && status.tone === 'err') setStatus(null); }} onEnter=${submit}
          maxLength=${64} showLabel=${x('secret.show')} hideLabel=${x('secret.hide')} />` : null}
      <${Status} status=${status} />
    <//>
  <//>`;
}
