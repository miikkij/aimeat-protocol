/**
 * @file public/views/profile/offers/share-dialog.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Share a data product with someone by name (design canvas "Data ulos", board Jako): who,
 *   how they read it (with a program, in a browser, or from a dataspace when this node speaks the
 *   Dataspace Protocol), the address for the link, the purpose, the end (capped at the node's longest
 *   share), the version (always the newest, or one pinned), and the three sentences that say what a
 *   share is. The press is POST /v1/parties/share, the call aimeat_party "share" makes; the answer's
 *   connection file, with the key in it once, stays in the dialog until it is closed. The e-mailed
 *   link goes through sendShareLink (js/services/dataproducts.js): the node mails a one-time link, and
 *   when it sends no mail the dialog shows the link for the owner to pass on (LinkResult).
 *
 *   The dialog is the site's Modal: the X, Escape and a click outside close it only while nothing has
 *   been typed. "From another AIMEAT" shares with a person by their own account on their own server
 *   (name@server): no party and no key; they sign in here as a visitor and read it, and the answer
 *   says whether this server takes sign-ins from theirs (WP9c). Every sentence the dialog shows is
 *   made from the answer's facts in the page's language (data-model.js shareSentence, keyNote,
 *   errText); the node's English `say` stays for an AI.
 * @structure ShareDialog · partyNameOf · VisitorRead · LinkResult · SHARE_HOWS · isAccount
 * @usage html`<${ShareDialog} open=${o} onClose=${close} product=${{ name, title }} versions=${versions} onShared=${reload} />`
 * @version-history
 *   v1.2.0 — 2026-11-01 — LinkResult: the e-mailed one-time link sent, or shown to pass on, and that the
 *     key in the file stops working when the recipient opens it (WP9b).
 *   v1.1.0 — 2026-11-01 — "From another AIMEAT" (a share to a person's own account on another node, the
 *     sign-in state and the addresses they read); the sentences and refusals in the page's language (WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (WP9a, plan doc-mvwxcas3dom3 D3.3, D3.4, D3.6).
 */
import { h } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { Modal } from '/components/Modal.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Select } from '/components/Select.js';
import { Note } from '/components/Note.js';
import { Code } from '/components/Mark.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';
import * as dp from '/js/services/dataproducts.js';
import { Facts } from '/components/Facts.js';
import { d, shortHash, versionNumber, shareSentence, keyNote, errText } from './data-model.js';

const DAY = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** How a recipient reads, and the words of each: with a program, in a browser, from another AIMEAT. */
export const SHARE_HOWS = [['program', 'howProgram'], ['person', 'howBrowser'], ['aimeat', 'howAimeat']];

/** An account on an AIMEAT server, as a person writes it: name@server. */
export const isAccount = (v) => /^[a-z0-9][a-z0-9._-]{0,63}@[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(v || '').trim());

/**
 * What a person on another AIMEAT node needs: whether this server takes their sign-in now, where they
 * sign in and with which account, and the addresses they read.
 */
export function VisitorRead({ out }) {
  const node = String(out?.recipient || '').split('@').pop();
  const who = out?.display_name || out?.recipient;
  const r = out?.read || {};
  return html`
    <${Note} kind="aside" size="small" tone=${out?.sign_in === 'ready' ? undefined : 'irreversible'}>${d('share.signIn.' + (out?.sign_in || 'ready'), { node, who })}<//>
    <${Facts} rows=${[
      { k: d('share.signInAt'), v: r.sign_in_url, mono: true },
      { k: d('share.account'), v: r.account, mono: true },
      { k: d('connect.odata'), v: r.odata_url, mono: true },
      { k: d('connect.descriptor'), v: r.descriptor_url, mono: true },
    ].filter((row) => row.v)} />`;
}

/**
 * What became of the e-mailed link (sendShareLink's answer): sent to the address, or not sent because
 * this server sends no mail, with the link to pass on; a refusal in words. Says too that the key above
 * stops working when the recipient opens the link, because the link makes their own key.
 */
export function LinkResult({ link, email }) {
  if (!link) return null;
  if (link.error && !link.link) return html`<${Note} kind="message" error>${d('share.linkFailed', { email })}<//>`;
  return html`
    <${Note} kind="aside" size="small">${link.sent
      ? d('share.linkSent', { email: link.to || email, date: link.expires_at ? fmtDate(link.expires_at) : '' })
      : d('share.linkManual', { email: link.to || email })}<//>
    ${link.sent ? null : html`<${Code} block scroll>${link.link}<//>
      <${Actions}><${Action} small copy=${link.link}>${d('share.copyLink')}<//><//>`}
    <${Note} kind="quiet">${d('share.linkKey')}<//>`;
}

/** The party's name from what the owner typed: lowercase letters, digits and dashes, at most 40. */
export function partyNameOf(words) {
  const base = String(words || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return ['me', 'token', 'share', 'invites'].includes(base) ? `${base}-1` : base;
}

export function ShareDialog({ open, onClose, product, versions = [], showToast, onShared }) {
  const [limits, setLimits] = useState({ maxDays: 365, dataspace: false });
  const [who, setWho] = useState('');
  const [how, setHow] = useState('program');
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [until, setUntil] = useState(() => isoDay(Date.now() + 30 * DAY));
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);   // the share's answer, with the connection file
  const [sent, setSent] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDone(null); setSent(null); setError('');
    dp.listParties().then((r) => setLimits({ maxDays: r?.share_max_days || 365, dataspace: !!r?.dataspace }))
      .catch((err) => swallowed('share-dialog: limits', err));
  }, [open]);

  const name = partyNameOf(who);
  const max = isoDay(Date.now() + limits.maxDays * DAY);
  const visitor = how === 'aimeat';
  const ready = !!name && !!purpose.trim() && !!until && (how !== 'person' || /\S+@\S+/.test(email)) && (!visitor || isAccount(account));
  const file = done ? JSON.stringify(done.connection, null, 2) : '';
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(new Blob([file], { type: 'application/json' })) : ''), [file]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const share = async () => {
    setBusy(true); setError('');
    try {
      const expires = new Date(`${until}T23:59:59`).toISOString();
      const out = await dp.shareWithParty(visitor
        ? { recipient: account.trim(), display_name: who.trim(), package: product.name, purpose: purpose.trim(), expires, ...(pin ? { pinned_version: pin } : {}) }
        : {
          name, display_name: who.trim(), kind: how, package: product.name, purpose: purpose.trim(), expires,
          ...(email.trim() ? { contact: email.trim() } : {}),
          ...(pin ? { pinned_version: pin } : {}),
        });
      setDone(out);
      if (!visitor && email.trim()) setSent(await dp.sendShareLink(out, email.trim()));
      // The dialog says the share's sentence itself; the toast only stands in when it has no facts to say it with.
      if (!out?.share) showToast?.(d('share.done'));
      onShared?.(out);
    } catch (err) { setError(errText(err, 'share.failed')); }
    setBusy(false);
  };

  const close = () => { setWho(''); setEmail(''); setAccount(''); setPurpose(''); setPin(''); setDone(null); onClose(); };
  const footer = done
    ? html`<${Loud} control onClick=${close}>${d('share.close')}<//>`
    : html`<${Action} onClick=${close}>${d('share.cancel')}<//>
        <${Loud} control disabled=${!ready || busy} onClick=${share}>${!visitor && email.trim() ? d('share.submitSend') : d('share.submit')}<//>`;
  const hows = [
    ...SHARE_HOWS.map(([value, key]) => ({ value, label: d('share.' + key), hint: d('share.' + key + 'Hint') })),
    limits.dataspace ? { value: 'dataspace', label: d('share.howDataspace'), hint: d('share.howDataspaceHint') } : null,
  ].filter(Boolean);
  const versionOptions = [['', d('share.versionLatest')],
    ...versions.map((v) => [v.contentHash, d('share.versionOnly', { n: versionNumber(versions, v.contentHash), hash: shortHash(v.contentHash) })])];

  return html`<${Modal} open=${open} onClose=${close} size="md" title=${done ? d('share.doneTitle') : d('share.title')} titleRef=${product?.title || product?.name} footer=${footer}>
    ${done ? html`
      <${Note} kind="lead">${shareSentence(done, who.trim())}<//>
      <${LinkResult} link=${sent} email=${email} />
      ${done.recipient_kind === 'visitor' ? html`<${VisitorRead} out=${done} />` : html`
        <${Note}>${keyNote(done, who.trim())}<//>
        <${Code} block scroll>${file}<//>
        <${Actions}>
          <${Action} small copy=${file}>${d('share.copyFile')}<//>
          <${Action} small href=${fileUrl} download=${`${product.name}-${name}.json`}>${d('share.downloadFile')}<//>
        <//>`}` : html`
      <${Fields}>
        <${TextField} label=${d('share.who')} value=${who} onInput=${setWho} placeholder=${d('share.whoPlaceholder')}
          hint=${name && !visitor ? d('share.whoHint', { name }) : undefined} />
        <${Choice} label=${d('share.how')} boxed cols=${hows.length} dot name="share-how" value=${how} onChange=${setHow} options=${hows} />
        ${visitor
          ? html`<${TextField} label=${d('share.account')} value=${account} onInput=${setAccount} placeholder=${d('share.accountPlaceholder')} hint=${d('share.accountHint')} />`
          : html`<${TextField} label=${d('share.email')} type="email" value=${email} onInput=${setEmail} placeholder=${d('share.emailPlaceholder')}
          hint=${how === 'person' ? d('share.emailNeeded') : d('share.emailHint')} />`}
        <${TextField} label=${d('share.purpose')} value=${purpose} onInput=${setPurpose} placeholder=${d('share.purposePlaceholder')} />
        <${TextField} label=${d('share.until')} type="date" value=${until} onInput=${setUntil}
          hint=${d('share.untilHint', { n: limits.maxDays, date: fmtDate(max) })} min=${isoDay(Date.now() + DAY)} max=${max} />
        <${Select} label=${d('share.version')} value=${pin} onChange=${setPin} options=${versionOptions} />
      <//>
      <${Note} kind="aside" size="small">${d(visitor ? 'share.sentencesAimeat' : 'share.sentences', { who: who.trim() || d('share.theRecipient') })}<//>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}`}
  <//>`;
}
