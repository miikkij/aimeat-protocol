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
 *   link goes through sendShareLink (js/services/dataproducts.js), the one call site WP9b fills; until
 *   it sends, the dialog says the link was not sent and hands over the file.
 *
 *   The dialog is the site's Modal: the X, Escape and a click outside close it only while nothing has
 *   been typed. "Another AIMEAT" is not offered: a share reaches an outside party, and a visitor
 *   account from another node has no share of its own on the node yet.
 * @structure ShareDialog · partyNameOf
 * @usage html`<${ShareDialog} open=${o} onClose=${close} product=${{ name, title }} versions=${versions} onShared=${reload} />`
 * @version-history
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
import { d, shortHash, versionNumber } from './data-model.js';

const DAY = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The party's name from what the owner typed: lowercase letters, digits and dashes, at most 40. */
export function partyNameOf(words) {
  const base = String(words || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return ['me', 'token', 'share'].includes(base) ? `${base}-1` : base;
}

export function ShareDialog({ open, onClose, product, versions = [], showToast, onShared }) {
  const [limits, setLimits] = useState({ maxDays: 365, dataspace: false });
  const [who, setWho] = useState('');
  const [how, setHow] = useState('program');
  const [email, setEmail] = useState('');
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
  const ready = !!name && !!purpose.trim() && !!until && (how !== 'person' || /\S+@\S+/.test(email));
  const file = done ? JSON.stringify(done.connection, null, 2) : '';
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(new Blob([file], { type: 'application/json' })) : ''), [file]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const share = async () => {
    setBusy(true); setError('');
    try {
      const out = await dp.shareWithParty({
        name, display_name: who.trim(), kind: how, package: product.name, purpose: purpose.trim(),
        expires: new Date(`${until}T23:59:59`).toISOString(),
        ...(email.trim() ? { contact: email.trim() } : {}),
        ...(pin ? { pinned_version: pin } : {}),
      });
      setDone(out);
      if (email.trim()) setSent(await dp.sendShareLink(out, email.trim()));
      // The dialog says the share's sentence itself; the toast only stands in when it has none.
      if (!out?.say) showToast?.(d('share.done'));
      onShared?.(out);
    } catch (err) { setError(err?.message || d('share.failed')); }
    setBusy(false);
  };

  const close = () => { setWho(''); setEmail(''); setPurpose(''); setPin(''); setDone(null); onClose(); };
  const footer = done
    ? html`<${Loud} control onClick=${close}>${d('share.close')}<//>`
    : html`<${Action} onClick=${close}>${d('share.cancel')}<//>
        <${Loud} control disabled=${!ready || busy} onClick=${share}>${email.trim() ? d('share.submitSend') : d('share.submit')}<//>`;
  const hows = [
    { value: 'program', label: d('share.howProgram'), hint: d('share.howProgramHint') },
    { value: 'person', label: d('share.howBrowser'), hint: d('share.howBrowserHint') },
    limits.dataspace ? { value: 'dataspace', label: d('share.howDataspace'), hint: d('share.howDataspaceHint') } : null,
  ].filter(Boolean);
  const versionOptions = [['', d('share.versionLatest')],
    ...versions.map((v) => [v.contentHash, d('share.versionOnly', { n: versionNumber(versions, v.contentHash), hash: shortHash(v.contentHash) })])];

  return html`<${Modal} open=${open} onClose=${close} size="md" title=${done ? d('share.doneTitle') : d('share.title')} titleRef=${product?.title || product?.name} footer=${footer}>
    ${done ? html`
      <${Note} kind="lead">${done.say}<//>
      ${sent && !sent.sent ? html`<${Note} kind="aside" size="small">${d('share.notSent', { email })}<//>` : null}
      <${Note}>${done.key_note}<//>
      <${Code} block scroll>${file}<//>
      <${Actions}>
        <${Action} small copy=${file}>${d('share.copyFile')}<//>
        <${Action} small href=${fileUrl} download=${`${product.name}-${name}.json`}>${d('share.downloadFile')}<//>
      <//>` : html`
      <${Fields}>
        <${TextField} label=${d('share.who')} value=${who} onInput=${setWho} placeholder=${d('share.whoPlaceholder')}
          hint=${name ? d('share.whoHint', { name }) : undefined} />
        <${Choice} label=${d('share.how')} boxed cols=${hows.length} dot name="share-how" value=${how} onChange=${setHow} options=${hows} />
        <${TextField} label=${d('share.email')} type="email" value=${email} onInput=${setEmail} placeholder=${d('share.emailPlaceholder')}
          hint=${how === 'person' ? d('share.emailNeeded') : d('share.emailHint')} />
        <${TextField} label=${d('share.purpose')} value=${purpose} onInput=${setPurpose} placeholder=${d('share.purposePlaceholder')} />
        <${TextField} label=${d('share.until')} type="date" value=${until} onInput=${setUntil}
          hint=${d('share.untilHint', { n: limits.maxDays, date: fmtDate(max) })} min=${isoDay(Date.now() + DAY)} max=${max} />
        <${Select} label=${d('share.version')} value=${pin} onChange=${setPin} options=${versionOptions} />
      <//>
      <${Note} kind="aside" size="small">${d('share.sentences', { who: who.trim() || d('share.theRecipient') })}<//>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}`}
  <//>`;
}
