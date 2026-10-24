/**
 * @file public/views/profile/agreements-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Settings "Agreements": the data processing agreements in which the person is the
 *   counterparty (plan doc-mvmr4i2wdk0p, D5; the design's row 2, approved 2026-10-24). The screen half of
 *   GET /v1/compliance/agreements/mine; the person's AI reads the same with aimeat_compliance_agreement
 *   (action "mine").
 *
 *   WHAT A PERSON DOES HERE. Reads what they are asked to sign in five plain lines, opens the whole
 *   agreement as a PDF, and signs in one of four ways: in the signing app with their account or the EU
 *   wallet, with their own e-signature service (download, sign, send the signed PDF back), or on paper
 *   (print, sign, send the scan back). When the operator announces a change of sub-processors, they
 *   see what changes and may object before the date. They never edit an agreement.
 *
 *   Live data by the `aimeat-live-update` event (the `compliance` domain), never on a timer.
 * @structure SignWays · NoticeBox · AgreementView · AgreementsTab (default)
 * @usage Registered in views/profile.js as the `agreements` tab; menu entry in landing-page.cards.js (Account).
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D5).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { myAgreements, getAgreement, downloadAgreementPdf, sendSignedCopy, objectToChange } from '/js/services/agreements.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Desc, Cell, Doors } from '/components/List.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Columns, Stack } from '/components/Layout.js';
import { FileDrop } from '/components/FileDrop.js';
import { TextArea } from '/components/TextField.js';
import { A, StatusMark, Steps, Annexes, Summary, newestOf, inForceOf, dateOf } from './agreements/parts.js';

const html = htm.bind(h);

/** The four ways to sign, the first the fastest. Shown while the newest version waits for this side. */
function SignWays({ agreement, busy, onFile }) {
  const v = newestOf(agreement);
  const pdf = () => downloadAgreementPdf(agreement.id, v.n).catch((e) => swallowed('agreements-tab: pdf', e));
  return html`
    <${Columns}>
      <${Box} tone=${agreement.sign_link ? 'raised' : undefined} name=${A('way.aimeat')} end=${A('way.fastest')}>
        <${Note} kind="hint" size="text">${A('way.aimeatText')}<//>
        ${agreement.sign_link
          ? html`<${Loud} control href=${agreement.sign_link} newTab>${A('way.aimeatGo')}<//>`
          : html`<${Note} kind="quiet">${A('way.aimeatNone')}<//>`}
      <//>
      <${Box} name=${A('way.wallet')} end=${A('way.strongest')}>
        <${Note} kind="hint" size="text">${A('way.walletText')}<//>
        ${agreement.sign_link
          ? html`<${Action} small href=${agreement.sign_link} newTab>${A('way.walletGo')}<//>`
          : html`<${Note} kind="quiet">${A('way.aimeatNone')}<//>`}
      <//>
      <${Box} name=${A('way.service')} end=${A('way.serviceEg')}>
        <${Note} kind="hint" size="text">${A('way.serviceText')}<//>
        <${Actions}>
          <${Action} small onClick=${pdf}>${A('downloadPdf')}<//>
          <${FileDrop} button=${A('way.serviceUpload')} accept="application/pdf,.pdf" disabled=${busy} onFiles=${([f]) => f && onFile(f, 'pdf')} />
        <//>
      <//>
      <${Box} name=${A('way.paper')} end=${A('way.slowest')}>
        <${Note} kind="hint" size="text">${A('way.paperText')}<//>
        <${Actions}>
          <${Action} small onClick=${pdf}>${A('print')}<//>
          <${FileDrop} button=${A('way.paperUpload')} accept="image/*,application/pdf,.pdf" disabled=${busy} onFiles=${([f]) => f && onFile(f, 'scan')} />
        <//>
      <//>
    <//>`;
}

/** An announced change: what changes, the date, and the way to object. */
function NoticeBox({ agreement, busy, onObject }) {
  const v = newestOf(agreement);
  const [reason, setReason] = useState('');
  if (!v.notice) return null;
  if (v.notice.objectedAt) return html`<${Note} kind="aside">${A('notice.objected', { date: dateOf(v.notice.objectedAt) })}<//>`;
  return html`
    <${Stack} gap="section">
      <${Note} kind="aside">${A('notice.text', { date: dateOf(v.notice.objectionUntil), days: v.options.noticeDays })}<//>
      <div><${Annexes} version=${v} against=${inForceOf(agreement)} /></div>
      <${Stack} gap="medium">
        <${TextArea} label=${A('notice.reasonLabel')} value=${reason} rows=${3} onInput=${setReason} />
        <${Actions}>
          <${Action} small tone="danger" disabled=${busy || !reason.trim()} onClick=${() => onObject(reason.trim())}>${A('notice.object')}<//>
        <//>
      <//>
    <//>`;
}

function AgreementView({ agreement, busy, onFile, onObject }) {
  const v = newestOf(agreement);
  const [annexesOpen, setAnnexesOpen] = useState(false);
  const mine = agreement.ourRole === 'processor' ? 'controller' : 'processor';
  const waitsForMe = v.status === 'sent' && !v.notice && !v.signatures.some((s) => s.party === mine);
  return html`
    <${Section} id="ag-what" num="02" title=${A('cp.whatTitle')}>
      <${Stack} gap="section">
        <${Note} kind="lead">${A('cp.whatLead', { id: agreement.id, n: v.n })}<//>
        <${Summary} agreement=${agreement} />
        <${Actions}>
          <${Action} small onClick=${() => downloadAgreementPdf(agreement.id, v.n).catch((e) => swallowed('agreements-tab: pdf', e))}>${A('openPdf')}<//>
        <//>
      <//>
    <//>
    ${waitsForMe ? html`
      <${Section} id="ag-sign" num="03" title=${A('cp.signTitle')}>
        <${SignWays} agreement=${agreement} busy=${busy} onFile=${onFile} />
        <${Note} kind="hint">${A('cp.afterSign')}<//>
      <//>` : null}
    ${v.status === 'review' ? html`<${Note} kind="aside">${A('cp.inReview')}<//>` : null}
    ${v.notice ? html`
      <${Section} id="ag-notice" num="03" title=${A('notice.title')}>
        <${NoticeBox} agreement=${agreement} busy=${busy} onObject=${onObject} />
      <//>` : null}
    <${Section} id="ag-steps" num="04" title=${A('stepsTitle')}>
      <${Steps} agreement=${agreement} />
    <//>
    <${Section} fold wrap id="ag-annexes" num="05" title=${A('annexes')} sub=${A('annexesSub')}
      open=${annexesOpen} onToggle=${() => setAnnexesOpen(!annexesOpen)}>
      <${Annexes} version=${v} against=${v.status === 'signed' ? null : inForceOf(agreement)} />
    <//>`;
}

/** @param {{ showToast?: (msg: string, kind?: unknown) => void }} props the profile shell's tab props */
export default function AgreementsTab({ showToast }) {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(() => (location.hash.match(/agreements\/(dpa-[a-z0-9]+)/) || [])[1] || '');
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const mine = await myAgreements();
      setList(mine.items || []);
      if (openId) setOpen(await getAgreement(openId));
      setError('');
    } catch (err) {
      swallowed('agreements-tab: load failed', err);
      setError(err?.message || A('loadFailed'));
    }
  }, [openId]);

  useEffect(() => { load(); }, [load]);
  // An address with #agreements/<id> scrolls to the opened agreement once, when it first draws.
  const scrolled = useRef(!location.hash.includes('agreements/'));
  // A link to #agreements/<id> followed while this page is open (the bell's) opens that agreement.
  useEffect(() => {
    const onHash = () => {
      const id = (location.hash.match(/agreements\/(dpa-[a-z0-9]+)/) || [])[1];
      if (id) { scrolled.current = false; setOpenId(id); }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!open || scrolled.current) return;
    scrolled.current = true;
    document.getElementById('ag-what')?.scrollIntoView({ block: 'start' });
  }, [open]);
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [load]);

  const act = async (fn, done) => {
    setBusy(true);
    try { await fn(); showToast?.(done); await load(); }
    catch (err) { swallowed('agreements-tab: action failed', err); setError(err?.message || A('actionFailed')); }
    finally { setBusy(false); }
  };
  const onFile = (file, kind) => act(() => sendSignedCopy(open.id, file, kind), A('cp.copySent'));
  const onObject = (reason) => act(() => objectToChange(open.id, reason), A('notice.sent'));

  const items = list ?? [];
  return html`
    <${SettingsPage}
      crumb=${[t('nav.profile'), t('profile.landing.menuAccount'), t('profile.tabs.agreements')]}
      title=${A('cp.title')}
      desc=${A('cp.intro')}>
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
      ${!list && !error ? html`<${Note} kind="loading">${A('loading')}<//>` : null}
      ${list ? html`
        <${Section} id="ag-list" num="01" title=${A('cp.listTitle')} count=${items.length}>
          <${List} cols="name-desc-state-doors" head=${[A('colSubject'), A('colNext'), A('colState'), '']} empty=${A('cp.empty')}
            rows=${items}
            render=${(a) => html`
              <${Row} key=${a.id} selected=${openId === a.id}>
                <${Name} meta=${`${a.id} · v${a.newest_version}`}>${a.subject}<//>
                <${Desc}>${a.waiting === 'counterparty' ? A('cp.waitsYou') : a.notice ? A('cp.changeAnnounced') : ''}<//>
                <${Cell}><${StatusMark} status=${a.status} /><//>
                <${Doors}><${Action} small row onClick=${() => { setOpenId(a.id); history.replaceState(null, '', `#agreements/${a.id}`); }}>${A('open')}<//><//>
              <//>`} />
        <//>
        ${open ? html`<${AgreementView} agreement=${open} busy=${busy} onFile=${onFile} onObject=${onObject} />` : null}` : null}
    <//>`;
}
