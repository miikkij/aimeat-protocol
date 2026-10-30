/**
 * @file public/views/admin/file-stores-tab.named.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The server's named stores on the admin page "File storage" (file-stores-tab.js). Beside
 *   the store the environment names, an operator adds S3 buckets and Azure Blob containers under a name,
 *   with their keys typed here (kept encrypted with the node key, never shown again, no restart). One
 *   of them can be the default, which takes every new file whose writer names no store and whose owner
 *   has no own store taking files; with none, the environment's setting decides. A store open to
 *   everyone is one every person may choose for a file; an operator may choose any. NamedSection lists
 *   each store in a box (where, folder, files, last test, added, the Default, Open to everyone and
 *   Unreachable marks) with Test, Make default or Stop being the default, Open to everyone or Only
 *   operators, and Remove (refused while files are in it, so the button waits until the files are moved
 *   with the move section). AddStoreSection is the form that adds one, or gives one new keys under the
 *   same name: name, kind and address (store-fields.js, with the Azure address for an emulator such as
 *   Azurite), folder, open to everyone, make default. Every write is tested by the server first, and
 *   the page re-reads on the `file-store` change. Every part is a library component; the page passes
 *   data and writes no class.
 * @structure NamedSection({ number, view, onDone }) (StoreBox) · AddStoreSection({ number, view, onDone })
 * @usage html`<${NamedSection} number="02" view=${view} onDone=${reload} />`
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { date, dateTime, num } from '/js/format.js';
import { Section } from '/components/Section.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { Note } from '/components/Note.js';
import { Mark, Marks } from '/components/Mark.js';
import { Action } from '/components/Action.js';
import { TextField } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { Check } from '/components/Check.js';
import { Stack, Space } from '/components/Layout.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import { fileSize, setNodeStore, removeNodeStore, testNodeFileStore } from '/js/services/file-store.js';
import { TestSteps, placeWords, STORE_NAME } from '../profile/storage/connect-form.js';
import { EMPTY_STORE, withoutSecrets, lackingOf, storeBody, StoreFields } from '../profile/storage/store-fields.js';
import { refusalWords, RefusalNote } from '../profile/storage/store-words.js';
import { F } from './file-stores-tab.parts.js';

const html = htm.bind(h);
/** The names another store id already uses: the environment's store and the database. */
const RESERVED = new Set(['s3', 'azure', 'database']);

/** The last connection test in one line. */
function checkWords(c) {
  if (!c) return F('named.notChecked');
  return c.ok ? F('named.checkOk', { when: dateTime(c.at) }) : F('named.checkFailed', { when: dateTime(c.at), message: c.message || '' });
}

/** One named store: its facts and marks, and its actions, each with the result under the box. */
function StoreBox({ s, onDone, confirm }) {
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const full = s.files.count > 0;

  /** One write, then the page re-reads; a refusal stays under the box. */
  const run = async (what, call, okWords) => {
    setBusy(true);
    setRefusal(null);
    try {
      await call();
      await onDone(okWords);
    } catch (e) {
      swallowed('file-stores-tab: ' + what, e);
      setRefusal(refusalWords(e));
    } finally {
      setBusy(false);
    }
  };
  const runTest = async () => {
    setBusy(true);
    setTesting(true);
    setTest(null);
    setRefusal(null);
    try {
      setTest((await testNodeFileStore(s.name)).data);
    } catch (e) {
      swallowed('file-stores-tab: test a named store', e);
      setRefusal(refusalWords(e));
    } finally {
      setBusy(false);
      setTesting(false);
    }
  };
  const remove = () => confirm(F('named.removeAsk', { name: s.name }),
    () => run('remove', () => removeNodeStore(s.name), F('named.removed', { name: s.name })),
    { danger: true, title: F('named.remove'), confirmLabel: F('named.remove') });

  const tested = placeWords(s.place, s.where);
  return html`
    <${Box} name=${s.name}
      marks=${html`<${Marks}>
        ${s.default ? html`<${Mark} kind="status" tone="fine">${F('named.default')}<//>` : null}
        ${s.selectable ? html`<${Mark}>${F('named.open')}<//>` : null}
        ${s.reachable ? null : html`<${Mark} kind="status" tone="danger">${F('named.unreachable')}<//>`}
      <//>`}
      doors=${html`
        <${Action} small control disabled=${busy || !s.reachable} onClick=${runTest}>${testing ? F('place.testing') : F('place.test')}<//>
        <${Action} small control disabled=${busy} onClick=${() => run('default', () => setNodeStore(s.name, { make_default: !s.default }),
          s.default ? F('named.defaultOff', { name: s.name }) : F('named.defaultOn', { name: s.name }))}>
          ${s.default ? F('named.stopDefault') : F('named.makeDefault')}
        <//>
        <${Action} small control disabled=${busy} onClick=${() => run('selectable', () => setNodeStore(s.name, { selectable: !s.selectable }),
          s.selectable ? F('named.closedDone', { name: s.name }) : F('named.openDone', { name: s.name }))}>
          ${s.selectable ? F('named.close') : F('named.openUp')}
        <//>
        <${Action} small control tone="danger" disabled=${busy || full} onClick=${remove}>${F('named.remove')}<//>`}>
      <${Facts} rows=${[
        { key: 'where', k: F('place.where'), v: placeWords(s.place, s.where) },
        s.prefix && { key: 'folder', k: F('place.folder'), v: s.prefix, mono: true },
        { key: 'files', k: F('named.files'), v: F('named.filesN', { n: num(s.files.count), size: fileSize(s.files.bytes) }) },
        { key: 'check', k: F('named.check'), v: checkWords(s.last_check), warn: !!(s.last_check && !s.last_check.ok) },
        { key: 'who', k: F('named.choose'), v: s.selectable ? F('named.chooseAll') : F('named.chooseOperators') },
        { key: 'added', k: F('named.added'), v: date(s.added_at), sub: s.added_by || undefined },
      ]} />
      ${s.reachable ? null : html`<${Note} kind="message" error>${F('named.unreachableWhy', { name: s.name })}<//>`}
      <${Note} kind="hint">${full ? F('named.removeFirst', { n: num(s.files.count) }) : F('named.removeHint')}<//>
      <${RefusalNote} refusal=${refusal} />
      ${test && test.steps ? html`
        <${Space} above="medium">
          <${Stack} gap="small">
            <${Note} kind="message" error=${!test.ok}>${test.ok ? F('place.testOk', { where: tested }) : F('place.testFailed', { where: tested })}<//>
            <${TestSteps} steps=${test.steps} />
          <//>
        <//>` : null}
    <//>`;
}

/** "The server's stores": a box per named store, or a line saying there is none yet. */
export function NamedSection({ number, view, onDone }) {
  const { confirm, ConfirmUI } = useConfirm();
  const stores = view.stores || [];
  return html`
    <${Section} id="adm-fs-named" num=${number} title=${F('named.title')} count=${stores.length ? num(stores.length) : undefined}>
      <${Note} kind="lead">${F('named.lead')}<//>
      ${stores.length === 0
        ? html`<${Note} kind="quiet">${F('named.none')}<//>`
        : html`<${Stack} gap="medium">${stores.map((s) => html`<${StoreBox} key=${s.name} s=${s} onDone=${onDone} confirm=${confirm} />`)}<//>`}
      <${ConfirmUI} />
    <//>`;
}

const EMPTY = { ...EMPTY_STORE, name: '', prefix: '' };

/** "Add a store": the form that adds a named store, or gives one new keys under its name. */
export function AddStoreSection({ number, view, onDone }) {
  const [kind, setKind] = useState('s3');
  const [f, setF] = useState(EMPTY);
  const [selectable, setSelectable] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (name) => (v) => setF((cur) => ({ ...cur, [name]: v }));
  const names = (view.stores || []).map((s) => s.name);

  const name = f.name.trim();
  const nameBad = !!name && (!STORE_NAME.test(name) || RESERVED.has(name));
  const replacing = !!name && names.includes(name);
  const lacking = [!name && F('add.name'), ...lackingOf(kind, f)].filter(Boolean);

  const send = async () => {
    if (lacking.length || nameBad || busy) return;
    const body = {
      ...storeBody(kind, f, { azureEndpoint: true }), ...(f.prefix.trim() ? { prefix: f.prefix.trim() } : {}),
      selectable, ...(makeDefault ? { make_default: true } : {}),
    };
    setBusy(true);
    setResult(null);
    try {
      const r = await setNodeStore(name, body);
      setResult({ outcome: r.data.outcome, steps: r.data.test?.steps || [], name });
      // The keys leave the page once the server has them.
      setF({ ...EMPTY });
      setSelectable(false);
      setMakeDefault(false);
      await onDone(null);
    } catch (e) {
      swallowed('file-stores-tab: add a named store', e);
      setF(withoutSecrets);
      setResult({ refusal: refusalWords(e) });
    } finally {
      setBusy(false);
    }
  };

  return html`
    <${Section} id="adm-fs-add" num=${number} title=${F('add.title')}>
      <${Stack} gap="medium">
        <${Note} kind="lead">${F('add.lead')}<//>
        <${Fields} cols=${2}>
          <${TextField} label=${F('add.name')} hint=${replacing ? F('add.nameReplaces', { name }) : F('add.nameHint')} value=${f.name}
            code size="medium" maxLength=${40} onInput=${(v) => set('name')(v.toLowerCase())}
            invalid=${nameBad} message=${nameBad ? { text: RESERVED.has(name) ? F('add.nameReserved', { name }) : F('add.nameBad'), error: true } : undefined} />
        <//>
        <${StoreFields} kind=${kind} onKind=${(v) => { setKind(v); setResult(null); }} f=${f} set=${set} onEnter=${send}
          kindLabel=${F('add.kind')} azureEndpoint />
        <${Fields}>
          <${TextField} label=${F('add.folder')} hint=${F('add.folderHint')} value=${f.prefix} code maxLength=${200} onInput=${set('prefix')} />
        <//>
        <${Check} checked=${selectable} onChange=${setSelectable} hint=${F('add.openHint')}>${F('add.open')}<//>
        <${Check} checked=${makeDefault} onChange=${setMakeDefault} hint=${F('add.defaultHint')}>${F('add.makeDefault')}<//>
        <${Space} above="small">
          <${FormActions} apart>
            <${Action} small control disabled=${busy || lacking.length > 0 || nameBad} onClick=${send}>
              ${busy ? F('place.testing') : replacing ? F('add.replace') : F('add.add')}
            <//>
            <${Note} kind="hint" inline>
              ${lacking.length ? F('add.fillFirst', { fields: lacking.join(', ') }) : F('add.testFirst')}
            <//>
          <//>
        <//>
        ${result && result.refusal ? html`<${RefusalNote} refusal=${result.refusal} />` : null}
        ${result && !result.refusal ? html`
          <${Note} kind="message">${result.outcome === 'added' ? F('add.added', { name: result.name }) : F('add.updated', { name: result.name })}<//>
          <${TestSteps} steps=${result.steps} />` : null}
      <//>
    <//>`;
}
