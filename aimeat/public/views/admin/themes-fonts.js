/**
 * @file public/views/admin/themes-fonts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Themes & Styles → Fonts: the font manager (services/themes/fonts.ts). Every face this
 *   node serves, in four parts: the base faces it ships with, each with a sample line, its weights,
 *   licence, source and the themes that use it; the faces the operator added, the same plus who
 *   added them and when, the licence status (unknown is a warning) and remove (off, with the reason,
 *   while a style uses the face); the fonts owners keep in their own storage, as an inventory only;
 *   and the dialog that adds or changes a face: its name, its woff2 files with the weight and style
 *   of each, and what is known of its licence.
 *
 *   An added face is always marked as added, never as base setup (Jouni, 2026-10-03). The sample
 *   line is an SVG text whose font-family is the face's own stack, as a style's colour marks are SVG
 *   fills: the face is the data being shown. Built only from library parts, with no class of its own.
 * @structure FontsTab (default) · FaceSample · FaceRow · AddedRow · OwnersBand · FaceDialog · guessFile · relinkSheet
 * @usage html`<${FontsTab} />`  (themes-tab.js, the Fonts tab)
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial (font manager).
 */
import { h } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut, apiDelete } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';
import { Band } from '/components/Band.js';
import { NamedRow } from '/components/NamedRow.js';
import { Hint } from '/components/Hint.js';
import { QuietNote } from '/components/QuietNote.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { Modal, useConfirm } from '/components/Modal.js';
import { Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { FileDrop } from '/components/FileDrop.js';
import { ActionRow } from '/components/ActionRow.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Collapsible } from '/components/Collapsible.js';
import { versionLabel } from './themes-bits.js';

const html = htm.bind(h);
const KINDS = ['sans-serif', 'serif', 'monospace', 'cursive'];

/** One line set in the face, drawn as SVG text so the face is the data and no style is written. */
function FaceSample({ stack, label }) {
  return html`<svg width="100%" height="34" viewBox="0 0 520 34" preserveAspectRatio="xMinYMid meet" role="img" aria-label=${label}>
    <text x="0" y="25" font-family=${stack} font-size="24" fill="currentColor">${t('themes.fonts.sample')}</text>
  </svg>`;
}

/** Which styles use a face, in words. */
const usedWords = (usedBy) => (usedBy && usedBy.length
  ? t('themes.fonts.usedBy', { list: usedBy.map((u) => `${u.themeName} / ${u.styleName}`).join(', ') })
  : t('themes.fonts.unused'));

/** The weights a face has, as one short line: a variable range as 100–900, and italic when it has one. */
const weightWords = (weights, styles = []) => (weights.length
  ? t('themes.fonts.weights', { list: weights.map((w) => String(w).replace(' ', '–')).join(', ') }) + (styles.includes('italic') ? ` · ${t('themes.fonts.styleItalic')}` : '')
  : t('themes.fonts.noFiles'));

/** A base face: the sample, its weights, licence, copyright, source, and who uses it. */
function FaceRow({ face }) {
  const facts = [t('themes.fonts.base'), weightWords(face.weights, face.styles), face.licence || t('themes.fonts.licenceMissing')].join(' · ');
  return html`
    <${NamedRow} label=${face.family}><div>
      <${FaceSample} stack=${face.stack} label=${t('themes.fonts.sampleOf', { name: face.family })} />
      <${Note} kind="meta">${facts}<//>
      ${face.copyright && html`<${Note} kind="meta">${face.copyright}<//>`}
      <${Note} kind="meta">${usedWords(face.usedBy)}<//>
      ${face.source && html`<${ActionRow}><${Action} small href=${face.source} newTab>${t('themes.fonts.source')}<//><//>`}
    </div><//>`;
}

/** An added face: as a base face, plus who added it, its licence status, change and remove. */
function AddedRow({ face, onChange, onRemove }) {
  const inUse = face.usedBy.length > 0;
  // A missing licence is said once, by the state line above; the facts carry only what is known.
  const facts = [t('themes.fonts.added'), weightWords(face.weights, face.styles), face.licence].filter(Boolean).join(' · ');
  const waiting = face.files.filter((f) => !f.uploaded).length;
  return html`
    <${NamedRow} label=${face.family}><div>
      ${face.servable ? html`<${FaceSample} stack=${face.stack} label=${t('themes.fonts.sampleOf', { name: face.family })} />`
        : html`<${Note} kind="state" tone="attention" size="small">${t('themes.fonts.notServed')}<//>`}
      <${Note} kind="state" tone=${face.licenceStatus === 'unknown' ? 'attention' : 'fine'} size="small">
        ${face.licenceStatus === 'unknown' ? t('themes.fonts.licenceUnknown') : t('themes.fonts.licenceStated')}<//>
      <${Note} kind="meta">${facts}<//>
      ${face.copyright && html`<${Note} kind="meta">${face.copyright}<//>`}
      <${Note} kind="meta">${t('themes.fonts.addedBy', { who: face.addedBy, date: versionLabel(face.addedAt) })}<//>
      ${waiting > 0 && html`<${Note} kind="meta">${t('themes.fonts.waiting', { n: waiting })}<//>`}
      <${Note} kind="meta">${usedWords(face.usedBy)}<//>
      <${ActionRow}>
        <${Action} onClick=${onChange}>${t('themes.fonts.change')}<//>
        <${Action} disabled=${inUse} title=${inUse ? t('themes.fonts.inUse') : undefined} onClick=${onRemove}>${t('themes.fonts.remove')}<//>
        ${face.source && html`<${Action} small href=${face.source} newTab>${t('themes.fonts.source')}<//>`}
      <//>
      ${inUse && html`<${Hint}>${t('themes.fonts.inUse')}<//>`}
    </div><//>`;
}

/** The fonts owners keep in their own storage: an inventory only, theirs to answer for. */
function OwnersBand({ owners }) {
  const size = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);
  return html`
    <${Band} title=${t('themes.fonts.ownersTitle')}>
      <${Hint}>${t('themes.fonts.ownersHint')}<//>
      ${owners.files.length === 0 ? html`<${QuietNote}>${t('themes.fonts.ownersNone')}<//>` : owners.files.map((f) => html`
        <${NamedRow} key=${f.owner + f.key} label=${f.owner}><div>
          <${Note} kind="meta" mono>${f.key}<//>
          <${Note} kind="meta">${t('themes.fonts.ownerFacts', { size: size(f.size), date: versionLabel(f.createdAt) })}<//>
        </div><//>`)}
      ${owners.total > owners.shown && html`<${Note} kind="meta">${t('themes.fonts.ownersShown', { shown: owners.shown, total: owners.total })}<//>`}
    <//>`;
}

/** A picked file's weight, style and subset, read from its name where the name says them. */
export function guessFile(name) {
  const n = String(name).toLowerCase();
  const range = /(\d{3})[-_ ](\d{3,4})/.exec(n);
  const one = /(?:^|[^0-9])([1-9]00)(?:[^0-9]|$)/.exec(n);
  const subset = /latin-ext|latin|cyrillic-ext|cyrillic|greek-ext|greek|vietnamese/.exec(n);
  return {
    weight: range ? `${range[1]} ${range[2]}` : one ? one[1] : /bold/.test(n) ? '700' : '400',
    style: /italic/.test(n) ? 'italic' : 'normal',
    subset: subset ? subset[0] : '',
    unicodeRange: '',
  };
}

/** Add a face, or change one (`face`): its name, kind, files and licence trail; then the uploads. */
function FaceDialog({ face, onClose, onSaved }) {
  const [family, setFamily] = useState(face?.family || '');
  const [kind, setKind] = useState(face?.kind || 'sans-serif');
  const [kept, setKept] = useState(() => (face?.files || []).map((f) => ({ weight: f.weight, style: f.style, subset: f.subset || '', unicodeRange: f.unicodeRange || '', file: f.file })));
  const [picked, setPicked] = useState(/** @type {Array<{file: File, weight: string, style: string, subset: string, unicodeRange: string}>} */ ([]));
  const [licence, setLicence] = useState(face?.licence || '');
  const [copyright, setCopyright] = useState(face?.copyright || '');
  const [source, setSource] = useState(face?.source || '');
  const [state, setState] = useState({ busy: false, error: '', note: '' });

  const edit = (list, setList, i, patch) => setList(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const fileFields = (row, i, list, setList) => html`
    <${Fields} cols=${4}>
      <${TextField} label=${t('themes.fonts.weight')} help="themes.font_weight" value=${row.weight} onInput=${(v) => edit(list, setList, i, { weight: v })} />
      <${Select} label=${t('themes.fonts.style')} value=${row.style} onChange=${(v) => edit(list, setList, i, { style: v })}
        options=${[['normal', t('themes.fonts.styleNormal')], ['italic', t('themes.fonts.styleItalic')]]} />
      <${TextField} label=${t('themes.fonts.subset')} value=${row.subset} onInput=${(v) => edit(list, setList, i, { subset: v })} />
      <${TextField} label=${t('themes.fonts.range')} code value=${row.unicodeRange} onInput=${(v) => edit(list, setList, i, { unicodeRange: v })} />
    <//>`;

  const save = async () => {
    setState({ busy: true, error: '', note: '' });
    const spec = (r) => ({ weight: r.weight.trim(), style: r.style, ...(r.subset.trim() ? { subset: r.subset.trim() } : {}), ...(r.unicodeRange.trim() ? { unicodeRange: r.unicodeRange.trim() } : {}) });
    try {
      const body = {
        family: family.trim(), kind, files: [...kept.map(spec), ...picked.map(spec)],
        licence: licence.trim() || null, copyright: copyright.trim() || null, source: source.trim() || null,
      };
      const r = await apiPut(`/v1/themes/fonts/${encodeURIComponent(face?.slug || family.trim())}`, body);
      // The uploads come back in the order the files were sent: the picked files are after the kept ones.
      const uploads = r.data.uploads.slice(kept.length);
      for (let i = 0; i < picked.length; i++) {
        setState({ busy: true, error: '', note: t('themes.fonts.uploading', { n: i + 1, total: picked.length }) });
        const res = await fetch(uploads[i].upload_url, { method: 'PUT', headers: { 'Content-Type': 'font/woff2' }, body: picked[i].file });
        if (!res.ok) {
          // A refusal says why in JSON; anything else (a proxy's page) leaves only the status to show.
          const why = await res.json().catch((e) => { swallowed('fonts: upload answer', e); return {}; });
          throw new Error(why.error === 'NOT_WOFF2' ? t('themes.fonts.notWoff2', { name: picked[i].file.name }) : (why.message || `${res.status}`));
        }
      }
      onSaved();
    } catch (e) {
      setState({ busy: false, error: e.message || String(e), note: '' });
    }
  };

  const ready = !!family.trim() && (kept.length + picked.length) > 0;
  const footer = html`
    <${Action} onClick=${onClose}>${t('themes.cancel')}<//>
    <${Loud} control disabled=${state.busy || !ready} onClick=${save}>${face ? t('themes.fonts.saveChange') : t('themes.fonts.addIt')}<//>`;
  // One column of blocks with the form's own gap between them, so a hint stays with its field.
  return html`<${Modal} open=${true} onClose=${onClose} size="lg" title=${face ? t('themes.fonts.changeTitle', { name: face.family }) : t('themes.fonts.addTitle')} footer=${footer}>
    <${Fields}>
      <${Hint}>${face ? t('themes.fonts.changeHint') : t('themes.fonts.dialogHint')}<//>
      <${Fields} cols=${2}>
        ${!face && html`<${TextField} label=${t('themes.fonts.family')} hint=${t('themes.fonts.familyHint')} value=${family} maxLength="60" onInput=${setFamily} />`}
        <${Select} label=${t('themes.fonts.kind')} hint=${t('themes.fonts.kindHint')} value=${kind} onChange=${setKind}
          options=${KINDS.map((k) => [k, t(`themes.fonts.kinds.${k}`)])} />
      <//>
      ${kept.map((row, i) => html`<${Box} key=${row.file} tone="part" name=${row.file}
          doors=${html`<${Action} small onClick=${() => setKept(kept.filter((_, j) => j !== i))}>${t('themes.fonts.dropFile')}<//>`}>
        ${fileFields(row, i, kept, setKept)}
      <//>`)}
      <${FileDrop} ink multiple accept=".woff2" label=${t('themes.fonts.files')} hint=${t('themes.fonts.filesHint')}
        items=${picked.map((p) => ({ file: p.file }))}
        onFiles=${(files) => setPicked([...picked, ...files.map((file) => ({ file, ...guessFile(file.name) }))])}
        onRemove=${(i) => setPicked(picked.filter((_, j) => j !== i))} />
      ${picked.map((row, i) => html`<${Box} key=${row.file.name + i} tone="part" name=${row.file.name}>
        ${fileFields(row, i, picked, setPicked)}
      <//>`)}
      <${Fields} cols=${2}>
        <${TextField} label=${t('themes.fonts.licence')} help="themes.font_licence" hint=${t('themes.fonts.licenceHint')} value=${licence} maxLength="200" onInput=${setLicence} />
        <${TextField} label=${t('themes.fonts.copyright')} hint=${t('themes.fonts.copyrightHint')} value=${copyright} maxLength="500" onInput=${setCopyright} />
        <${TextField} label=${t('themes.fonts.sourceField')} hint=${t('themes.fonts.sourceHint')} value=${source} maxLength="500" onInput=${setSource} />
      <//>
      ${!licence.trim() || !copyright.trim() ? html`<${Note} kind="state" tone="attention" size="small">${t('themes.fonts.willBeUnknown')}<//>` : null}
      ${!ready && html`<${Note} kind="meta">${t('themes.fonts.needs')}<//>`}
      ${state.note && html`<${Note} kind="report" tone="busy">${state.note}<//>`}
      ${state.error && html`<${ErrorNote} text=${state.error} />`}
    <//>
  <//>`;
}

/**
 * The page links the faces sheet as it was when the page loaded (routes/portal-spa.ts). After a face
 * is added, changed or removed here, the sheet is linked again, so its sample line shows at once.
 */
function relinkSheet() {
  const href = `/v1/themes/fonts.css?v=${Date.now().toString(36)}`;
  const old = document.querySelector('link[rel="stylesheet"][href^="/v1/themes/fonts.css"]');
  if (old) { old.setAttribute('href', href); return; }
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

export default function FontsTab() {
  const [data, setData] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(/** @type {null | { face: any }} */ (null));
  const [baseOpen, setBaseOpen] = useState(false);
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/themes/fonts');
      setData(r.data);
      setError('');
    } catch (e) {
      setError(e.message || String(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('aimeat-live-update', load);
    return () => window.removeEventListener('aimeat-live-update', load);
  }, [load]);

  const remove = (face) => confirm(t('themes.fonts.removeConfirm', { name: face.family }), async () => {
    try { await apiDelete(`/v1/themes/fonts/${encodeURIComponent(face.slug)}`); relinkSheet(); await load(); } catch (e) { setError(e.message || String(e)); }
  }, { title: t('themes.fonts.removeTitle'), confirmLabel: t('themes.fonts.remove'), danger: true });

  if (error && !data) return html`<${ErrorNote} text=${error} />`;
  if (!data) return html`<${QuietNote}>${t('themes.loading')}<//>`;
  return html`
    <${Hint}>${t('themes.fonts.intro')}<//>
    ${error && html`<${ErrorNote} text=${error} />`}
    <${Band} title=${t('themes.fonts.addedTitle', { n: data.added.length })}>
      <${Hint}>${t('themes.fonts.addedHint')}<//>
      <${Actions}><${Loud} control onClick=${() => setDialog({ face: null })}>${t('themes.fonts.add')}<//><//>
      ${data.unknownLicences.length > 0 && html`<${Note} kind="state" tone="attention">${t(data.unknownLicences.length === 1 ? 'themes.fonts.unknownCountOne' : 'themes.fonts.unknownCount', { n: data.unknownLicences.length, list: data.unknownLicences.join(', ') })}<//>`}
      ${data.added.length === 0 ? html`<${QuietNote}>${t('themes.fonts.noneAdded')}<//>` : data.added.map((f) => html`
        <${AddedRow} key=${f.slug} face=${f} onChange=${() => setDialog({ face: f })} onRemove=${() => remove(f)} />`)}
    <//>
    <${Band} title=${t('themes.fonts.baseTitle', { n: data.base.length })}>
      <${Hint}>${t('themes.fonts.baseHint')}<//>
      ${/* Nothing is done to a base face here, so its rows stay folded until asked for. */''}
      <${Collapsible} title=${t('themes.fonts.showBase', { n: data.base.length })} open=${baseOpen} onToggle=${() => setBaseOpen(!baseOpen)}>
        ${data.base.map((f) => html`<${FaceRow} key=${f.family} face=${f} />`)}
      <//>
    <//>
    ${data.owners && html`<${OwnersBand} owners=${data.owners} />`}
    ${dialog && html`<${FaceDialog} face=${dialog.face} onClose=${() => setDialog(null)}
      onSaved=${() => { setDialog(null); relinkSheet(); load(); }} />`}
    <${ConfirmUI} />`;
}
