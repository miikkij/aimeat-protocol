/**
 * @file public/views/appcat/sections/marks.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Marks and authorship" (features F329, routes F198, F228): the two
 *   switches on the chrome the node adds when it serves the app (the "publish your own app" badge and
 *   the browser install offer), the declaration of the natural person who reviewed the app and
 *   answers for it, what this node sees about the app's own AI use, and the log of every declaration
 *   and withdrawal. The state is the listing row's manifest (`marks`, `authorship`, `authorshipLog`)
 *   and `ai_posture`; writes go through PATCH /v1/apps/{filename} with `marks` or `author`, and the
 *   server decides everything (it refuses a declaration from anything but the account holder in
 *   person) and its note is what the person is told.
 *
 *   The node's visible-label policy (GET /v1/ai-transparency, posture.visible_label) is read once per
 *   page and decides what a named reviewer does to the label: until it is read, and when the read
 *   fails, the section says what `strict` says, because that promise is the one that is never false.
 *   The row comes from the page's whole listing (not the first 200 as the old page's F229, F361). The
 *   shell draws the chapter line and the headline from `meta`; this is the body.
 * @structure meta · MarksSection({ d })
 * @usage const mod = await import('./sections/marks.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity with the old page (sections-c): the switches as .mk-row (List tone
 *     switches), the part headings as its h4, the reviewer's form as .mk-author-form (Enter no longer
 *     declares: the old field had no key), the aside, the law's paragraph with its ink link, the
 *     readout as .mk-sees and the log as .mk-log.
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's js/marks.js on components (appcat detail builder B).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { TextField } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { SubHeading } from '/components/SubHeading.js';
import { List, Row, Name, Desc, Doors, When, Cell, Who } from '/components/List.js';
import { x } from '/views/appcat/i18n.js';
import { patchApp, dateText, errorText, noticeKind } from '/views/appcat/sections/app-write.js';

const html = htm.bind(h);
const LAW_URL = 'https://eur-lex.europa.eu/eli/reg/2024/1689/oj#art_50';

export const meta = { id: 'marks', title: 'marks.title', show: (d) => !!(d && d.isOwnPublished) };

/** The node's label policy, read once per page: null until read, then 'strict' | 'light' | 'off'. */
let policy = null;
let policyAsk = null;
function loadPolicy() {
  if (!policyAsk) {
    policyAsk = fetch('/v1/ai-transparency')
      .then((r) => r.json())
      .then((res) => { const p = res && res.data && res.data.posture && res.data.posture.visible_label; policy = typeof p === 'string' ? p : 'strict'; })
      // eslint-disable-next-line aimeat/no-silent-catch -- an unread policy is read as strict, the promise that is never false
      .catch(() => { policy = 'strict'; })
      .then(() => policy);
  }
  return policyAsk;
}

function fromRow(app) {
  const m = (app && app.manifest) || {};
  return {
    marks: { badge: !(m.marks && m.marks.badge === false), install: !(m.marks && m.marks.install === false) },
    authorship: m.authorship || null,
    log: m.authorshipLog || [],
    posture: app.ai_posture || null,
    agents: (m.cortex && m.cortex.agents && m.cortex.agents.length) || 0,
    cortex: m.usesCortex || [],
  };
}

export default function MarksSection({ d }) {
  const [data, setData] = useState(() => (d.app ? fromRow(d.app) : null));
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [label, setLabel] = useState(policy);
  // Only another app starts over from the row: after a write the answer is newer than the row.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the app on purpose
  useEffect(() => { setData(d.app ? fromRow(d.app) : null); setBusy(false); setName(''); }, [d.ref]);
  useEffect(() => { let live = true; loadPolicy().then((p) => { if (live) setLabel(p); }); return () => { live = false; }; }, []);

  if (!data) return html`<${Note} kind="hint" chapter>${x(d.app ? 'marks.loadFailed' : 'marks.loading')}<//>`;
  const strict = label !== 'light' && label !== 'off';

  const write = async (body) => {
    if (busy) return;
    setBusy(true);
    try {
      const a = await patchApp(d.filename, body);
      setData((cur) => ({
        ...cur,
        marks: a.marks ? { badge: a.marks.badge !== false, install: a.marks.install !== false } : cur.marks,
        authorship: 'authorship' in a ? (a.authorship || null) : cur.authorship,
        log: a.authorshipLog || cur.log,
      }));
      if (body.author) setName('');
      const said = a.note || x('marks.saved');
      d.notice(said, noticeKind(said));
      d.reload?.();
    } catch (err) {
      const said = errorText(err, x('marks.saveFailed'));
      d.notice(said, noticeKind(said));
    }
    setBusy(false);
  };
  const declare = () => {
    const n = name.trim();
    if (!n) { d.notice(x('marks.authorEmpty'), noticeKind(x('marks.authorEmpty'))); return; }
    write({ author: n });
  };
  const yesNo = (v) => x(v ? 'marks.yes' : 'marks.no');
  const p = data.posture;
  const sw = (key) => {
    const on = data.marks[key];
    return html`<${Row} key=${key}>
      <${Name}>${x('marks.' + key)}<//>
      <${Desc}>${x('marks.' + key + (on ? 'On' : 'Off'))}<//>
      <${Doors}><${Action} small disabled=${busy} onClick=${() => write({ marks: { [key]: !on } })}>${x(on ? 'marks.turnOff' : 'marks.turnOn')}<//><//>
    <//>`;
  };
  const log = data.log.slice().reverse();

  // The old page's shape: the switches as .mk-row (List tone switches), the part headings its h4
  // (30px above, 10px below), the reviewer's form 520px wide, the aside and the law's paragraph, the
  // readout (.mk-sees) and the log (.mk-log). Enter in the name field sends nothing, as there.
  return html`
    <${Note} kind="hint" chapter>${x('marks.intro')}<//>
    <${List} tone="switches" cols="name-meaning-doors">${sw('badge')}${sw('install')}<//>

    <${SubHeading} level=${4} part="apart">${x('marks.authorTitle')}<//>
    ${data.authorship
      ? html`<${Note} kind="lead" size="record">${x(strict ? 'marks.authorIsStrict' : 'marks.authorIs', { name: data.authorship.name, when: dateText(data.authorship.declaredAt) })}<//>
          <${Actions} chapter><${Action} small disabled=${busy} onClick=${() => write({ author: null })}>${x('marks.withdraw')}<//><//>`
      : html`<${Note} kind="hint" chapter>${x('marks.authorNone')}<//>
          <${Fields} plain column narrow>
            <${TextField} label=${x('marks.authorLabel')} value=${name} onInput=${setName} maxLength=${120} placeholder=${x('marks.authorPh')} />
            <${Actions} chapter><${Loud} control disabled=${busy} onClick=${declare}>${x('marks.declare')}<//><//>
          <//>`}
    <${Note} kind="aside" chapter>${x('marks.audited')}<//>
    <${Note} kind="hint" size="text">${x(strict ? 'marks.legalStrict' : 'marks.legal')} <${Action} tone="inline" href=${LAW_URL} newTab>${x('marks.legalLink')} →<//><//>

    <${SubHeading} level=${4} part="apart">${x('marks.seesTitle')}<//>
    <${Facts} readout rows=${[
      { k: x('marks.seesGenerates'), v: p && p.generates && p.generates.length ? p.generates.join(', ') : x('marks.seesNothing') },
      { k: x('marks.seesUsesAi'), v: yesNo(!!(p && p.usesAi)) },
      { k: x('marks.seesDiscloses'), v: yesNo(!!(p && (p.discloses || p.disclosureCallFound))) },
      { k: x('marks.seesAgents'), v: String(data.agents) },
      { k: x('marks.seesCortex'), v: data.cortex.length ? data.cortex.join(', ') : x('marks.no') },
    ]} />

    <${SubHeading} level=${4} part="apart">${x('marks.logTitle')}<//>
    ${log.length
      ? html`<${List} tone="log" cols="when-kind-name-who">${log.map((e, i) => html`<${Row} key=${i}>
          <${When}>${dateText(e.at)}<//>
          <${Cell} sign>${x(e.action === 'cleared' ? 'marks.logCleared' : 'marks.logDeclared')}<//>
          <${Name}>${e.name}<//>
          <${Who}>${x('marks.by', { by: e.by })}<//>
        <//>`)}<//>`
      : html`<${Note} kind="hint" chapter>${x('marks.logEmpty')}<//>`}`;
}
