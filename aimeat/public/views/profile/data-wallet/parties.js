/**
 * @file public/views/profile/data-wallet/parties.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Data Wallet's section Outside parties (design canvas "Data ulos", board
 *   Tietolompakko; plan doc-mvwxcas3dom3 D2, D3): the people and programs with no account here that the
 *   owner gave access to, each with its kind, its live shares and when its key was last used; "Add a
 *   party"; and an opened party: its identity `party:<owner>/<name>@<node>` to copy, Stop (or Resume)
 *   and Delete, its keys with Replace and Delete (a new key is shown once), what it gets with End, and
 *   its last reads, served and refused. The reads and handlers live in useParties (the routes the MCP
 *   tool aimeat_party calls); the render is secParties. A party opens from the address
 *   `?party=<name>` (the "Manage" door of What others can see). Live by the `consent` domain.
 * @structure useParties · secParties · partyCount
 * @usage const parties = useParties({ confirm, toast }); … ${secParties(ctx, '02')}
 * @version-history
 *   v1.2.0 — 2026-11-01 — "What they get" names the product by its title, and a purchase's share by
 *     the page's words (WP10e B4, B14).
 *   v1.1.0 — 2026-11-01 — A refusal in the page's language (data-model.js errText; WP9c).
 *   v1.0.0 — 2026-11-01 — Initial (WP9a).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { ago, date as fmtDate, num } from '/js/format.js';
import { d as p, errText } from '../offers/data-model.js';
import { purposeWords } from '../offers/data-words.js';
import { swallowed } from '/js/swallowed.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import * as dp from '/js/services/dataproducts.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Desc, Who, When, Cell, Doors, Panel } from '/components/List.js';
import { Action, Actions } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';

const KINDS = ['program', 'person', 'dataspace'];

export function useParties({ confirm, toast, federated }) {
  const [list, setList] = useState(null);
  const [openName, setOpenName] = useState(() => new URLSearchParams(window.location.search).get('party'));
  const [reads, setReads] = useState({});
  const [fresh, setFresh] = useState(null);   // { name, key } of a key just made: shown once
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const [titles, setTitles] = useState({});   // package name → the product's title, for "What they get"
  const load = useCallback(async () => {
    if (federated) return;
    try {
      const [r, products] = await Promise.all([dp.listParties(),
        dp.listProducts().catch((err) => { swallowed('data-wallet: product titles', err); return null; })]);
      setList(r?.parties || []);
      if (products?.products) setTitles(Object.fromEntries(products.products.map((x) => [x.name, x.title || x.name])));
    } catch (err) { swallowed('data-wallet: parties', err); setList([]); }
  }, [federated]);
  const loadReads = useCallback(async (name) => {
    try { const r = await dp.partyReads(name, 12); setReads((s) => ({ ...s, [name]: r?.reads || [] })); }
    catch (err) { swallowed('data-wallet: party reads', err); setReads((s) => ({ ...s, [name]: [] })); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (openName) loadReads(openName); }, [openName, loadReads]);
  // A party opened from the address is scrolled to once the list is here.
  const scrolled = useRef(false);
  useEffect(() => {
    if (scrolled.current || !openName || !list) return;
    scrolled.current = true;
    window.setTimeout(() => document.getElementById('dw-parties')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }, [openName, list]);
  const ref = useRef(null);
  ref.current = () => { load(); if (openName) loadReads(openName); };
  useEffect(() => onLiveUpdate(['consent'], () => ref.current()), []);

  const act = async (fn, said) => {
    setBusy(true);
    try { const out = await fn(); if (said) toast(said); await load(); return out; }
    catch (err) { toast(errText(err, 'party.failed'), true); return null; }
    finally { setBusy(false); }
  };
  const toggle = (name) => { setFresh(null); setOpenName((cur) => (cur === name ? null : name)); };
  const stop = (party) => act(() => (party.status === 'stopped' ? dp.resumeParty(party.name) : dp.stopParty(party.name)),
    party.status === 'stopped' ? p('party.resumed', { who: party.display_name }) : p('party.stopped', { who: party.display_name }));
  const remove = (party) => confirm(p('party.deleteConfirm', { who: party.display_name, n: (party.shares || []).filter((s) => s.status === 'active').length }),
    () => act(() => dp.deleteParty(party.name), p('party.deleted', { who: party.display_name })).then(() => setOpenName(null)),
    { danger: true, title: p('party.delete'), confirmLabel: p('party.delete') });
  /** Replace a key: a new key first (shown once), then the old one goes, so the party is never without one. */
  const replaceKey = (party, keyId) => confirm(p('party.replaceConfirm', { who: party.display_name }), async () => {
    const made = await act(() => dp.createPartyKey(party.name));
    if (!made?.key) return;
    await act(() => dp.deletePartyKey(party.name, keyId), p('party.replaced'));
    setFresh({ name: party.name, key: made.key });
  }, { title: p('party.replace'), confirmLabel: p('party.replace') });
  const deleteKey = (party, keyId) => confirm(p('party.deleteKeyConfirm', { who: party.display_name }),
    () => act(() => dp.deletePartyKey(party.name, keyId), p('party.keyDeleted')), { danger: true, title: p('party.deleteKey'), confirmLabel: p('party.deleteKey') });
  const endShare = (party, share) => confirm(p('product.revokeConfirm', { who: party.display_name }),
    () => act(() => dp.revokeShare(share.id), p('product.revoked', { who: party.display_name })), { danger: true, title: p('product.revoke'), confirmLabel: p('product.revoke') });
  const create = () => act(async () => {
    const out = await dp.createParty({ name: form.name, display_name: form.display || form.name, kind: form.kind, ...(form.contact ? { contact: form.contact } : {}) });
    setForm(null); setOpenName(form.name);
    if (out?.key) setFresh({ name: form.name, key: out.key });
    return out;
  }, p('party.created'));

  return { list, titles, openName, reads, fresh, form, setForm, busy, toggle, stop, remove, replaceKey, deleteKey, endShare, create, load };
}

/** The section's count for the rail. */
export const partyCount = (pt) => (pt?.list ? String(pt.list.length) : '');

const keyUsed = (party) => {
  const at = (party.keys || []).map((k) => k.last_used_at).filter(Boolean).sort().pop();
  return at ? p('party.keyUsed', { when: ago(at) }) : p('party.keyNotUsed');
};

function partyPanel(pt, party) {
  const live = (party.shares || []).filter((s) => s.status === 'active');
  const reads = pt.reads[party.name];
  const doors = html`
    <${Action} small disabled=${pt.busy || party.stopped_by === 'operator'} onClick=${() => pt.stop(party)}>${party.status === 'stopped' ? p('party.resume') : p('party.stop')}<//>
    <${Action} small tone="danger" disabled=${pt.busy} onClick=${() => pt.remove(party)}>${p('party.delete')}<//>`;
  return html`<${Panel} title=${party.display_name} mark=${html`<${Mark} kind="status" tone=${party.status === 'active' ? 'fine' : 'off'}>${p('party.status.' + party.status)}<//>`} doors=${doors}>
    <${Label} block>${p('party.label')}<//>
    <${Actions} tight><${Code}>${party.party_ref}<//><${Action} small soft copy=${party.party_ref}>${p('connect.copy')}<//><//>
    ${party.stopped_by === 'operator' ? html`<${Note} kind="aside" size="small">${p('party.operatorStopped')}<//>` : null}
    ${pt.fresh?.name === party.name ? html`<${Box} tone="copy" name=${p('party.newKey')}>
      <${Note}>${p('party.keyOnce')}<//>
      <${Actions} tight><${Code}>${pt.fresh.key}<//><${Action} small copy=${pt.fresh.key}>${p('connect.copy')}<//><//>
    <//>` : null}
    <${Label} block>${p('party.keys')}<//>
    <${List} cols="name-who-when-doors" dense empty=${p('party.noKeys')} rows=${party.keys || []} render=${(k) => html`
      <${Row} key=${k.id}>
        <${Name} code>${p('party.keyId', { id: k.id.slice(-6) })}<//>
        <${Who}>${p('party.keyMade', { date: fmtDate(k.created_at) })}<//>
        <${When}>${k.last_used_at ? p('party.keyUsed', { when: ago(k.last_used_at) }) : p('party.keyNotUsed')}<//>
        <${Doors}>
          <${Action} small row disabled=${pt.busy} onClick=${() => pt.replaceKey(party, k.id)}>${p('party.replace')}<//>
          <${Action} small row tone="danger" disabled=${pt.busy} onClick=${() => pt.deleteKey(party, k.id)}>${p('party.deleteKey')}<//>
        <//>
      <//>`} />
    <${Label} block>${p('party.gets')}<//>
    <${List} cols="name-who-doors" dense empty=${p('party.noShares')} rows=${live} render=${(s) => html`
      <${Row} key=${s.id}>
        <${Name} meta=${p('party.read')}>${pt.titles?.[s.package] || s.package}<//>
        <${Who}>${[purposeWords(s), s.expires ? p('product.until', { date: fmtDate(s.expires) }) : null].filter(Boolean).join(' · ')}<//>
        <${Doors}><${Action} small row tone="danger" disabled=${pt.busy} onClick=${() => pt.endShare(party, s)}>${p('product.revoke')}<//><//>
      <//>`} />
    <${Label} block>${p('party.reads')}<//>
    ${reads === undefined ? html`<${Note} kind="loading" />` : html`<${List} cols="when-name-state" dense empty=${p('party.noReads')} rows=${reads} render=${(r, i) => html`
      <${Row} key=${r.at + i}>
        <${When}>${ago(r.at)}<//>
        <${Desc}>${r.what.replace(/\//g, ' · ')}${typeof r.rows === 'number' ? ` · ${p('list.rows', { n: num(r.rows) })}` : ''}<//>
        <${Cell}><${Mark} kind="status" tone=${r.verdict === 'served' ? 'fine' : 'danger'}>${r.verdict === 'served' ? p('party.served') : p('party.refused')}<//><//>
      <//>`} />`}
    <${Note}>${p('party.refusedMeans')}<//>
  <//>`;
}

function addForm(pt) {
  const f = pt.form;
  const set = (patch) => pt.setForm({ ...f, ...patch });
  const ok = /^[a-z0-9][a-z0-9-]{0,39}$/.test(f.name) && !['me', 'token', 'share'].includes(f.name);
  return html`<${Box} tone="field">
    <${Fields} cols=${2}>
      <${TextField} label=${p('party.display')} value=${f.display} onInput=${(v) => set({ display: v, ...(f.nameTouched ? {} : { name: v.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) }) })} />
      <${TextField} label=${p('party.name')} hint=${p('party.nameHint')} code value=${f.name} onInput=${(v) => set({ name: v, nameTouched: true })} />
      <${Choice} label=${p('party.kindLabel')} value=${f.kind} onChange=${(v) => set({ kind: v })} options=${KINDS.map((k) => [k, p('party.kind.' + k)])} />
      <${TextField} label=${p('party.contact')} hint=${p('party.contactHint')} value=${f.contact} onInput=${(v) => set({ contact: v })} />
    <//>
    <${Actions}>
      <${Action} small disabled=${!ok || pt.busy} onClick=${pt.create}>${p('party.add')}<//>
      <${Action} small soft onClick=${() => pt.setForm(null)}>${p('share.cancel')}<//>
    <//>
  <//>`;
}

export function secParties(ctx, num2) {
  const pt = ctx.parties;
  const list = pt.list;
  const doors = html`<${Action} small onClick=${() => pt.setForm({ display: '', name: '', kind: 'program', contact: '' })}>${p('party.add')}<//>`;
  return html`<${Section} id="dw-parties" num=${num2} title=${p('party.title')} count=${list ? p('party.count', { n: list.length }) : ''} doors=${doors}>
    <${Note} kind="lead">${p('party.intro')}<//>
    ${pt.form ? addForm(pt) : null}
    ${list === null ? html`<${Note} kind="loading" />` : html`<${List} cols="name-desc-since-doors" keepCols
      head=${[p('party.colName'), p('party.colShares'), p('party.colKey'), '']} empty=${p('party.none')} rows=${list} render=${(party) => {
        const open = pt.openName === party.name;
        const live = (party.shares || []).filter((s) => s.status === 'active').length;
        return html`<${Row} key=${party.uid} open=${open} faded=${party.status !== 'active'}>
          <${Name} onOpen=${() => pt.toggle(party.name)} tag=${html`<${Mark}>${p('party.kind.' + party.kind)}<//>`}
            meta=${party.status !== 'active' ? p('party.status.' + party.status) : undefined}>${party.display_name}<//>
          <${Desc}>${p('party.sharesN', { n: live })}<//>
          <${When}>${keyUsed(party)}<//>
          <${Doors}><${Action} small row onClick=${() => pt.toggle(party.name)}>${open ? p('party.close') : p('party.open')}<//><//>
          ${open ? partyPanel(pt, party) : null}
        <//>`;
      }} />`}
  <//>`;
}
