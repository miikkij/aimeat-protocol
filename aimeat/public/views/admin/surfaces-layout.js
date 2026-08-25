/**
 * @file public/views/admin/surfaces-layout.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The block editor: which parts one of this node's pages shows, in what order, and the
 *   operator's own words between them.
 *
 *   THE FORM DRAWS ITSELF FROM THE NODE. The block list, what each one is, and the settings each
 *   takes all come from GET /v1/site/blocks, which is generated from the same registry the validator
 *   reads. A hand-built form here would be a second description of the same blocks, drifting from
 *   the first the day one is added — and the operator would meet the difference as a refusal.
 *
 *   THIS IS THE MACHINE ROOM, NOT THE ROAD IN. An operator whose AI is connected says "take the shop
 *   off our home page" and it happens. This screen is where they see what happened and change it by
 *   hand, and it carries the copy-prompt for the operators whose AI cannot reach this node.
 *
 *   NOTHING IS SAVED UNTIL SAVE. Reordering, hiding and editing work on a local copy, so an operator
 *   can put a page together and look at it before any of it is live.
 * @structure SurfaceLayoutEditor
 * @usage html`<${SurfaceLayoutEditor} surface="home" onChanged=${bumpPreview} />`
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { copyToClipboard } from '/js/utils.js';
import { useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import {
  getSurfaceLayout, saveSurfaceLayout, revertSurfaceLayout, resetSurfaceLayout,
  listLayoutVersions, restoreLayout, getSurfaceBlocks, getLayoutPrompt, importSurfaceLayout,
} from '/js/services/admin.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** A block's own name within the page. The id unless that is taken, and then id-2, id-3… */
function freeKey(blocks, id) {
  const used = new Set(blocks.map(b => b.key));
  if (!used.has(id)) return id;
  for (let n = 2; n < 100; n++) if (!used.has(`${id}-${n}`)) return `${id}-${n}`;
  return `${id}-${Date.now()}`;
}

/** One setting, drawn from what the block declared it to be. */
function SettingField({ name, def, value, onChange }) {
  const label = html`<span class="adm-elabel">${name}</span>`;
  const help = html`<p class="adm-text-dim adm-text-base">${def.description}</p>`;

  if (def.type === 'boolean') {
    return html`<div class="adm-mb-sm">
      <label class="adm-flex-center">
        <input type="checkbox" checked=${value === undefined ? def.default === true : !!value}
          onChange=${(e) => onChange(e.target.checked)} />
        ${label}
      </label>${help}</div>`;
  }
  if (def.type === 'enum') {
    return html`<div class="adm-mb-sm">${label}
      <select class="adm-input" value=${value ?? def.default ?? ''} onChange=${(e) => onChange(e.target.value)}>
        ${def.values.map(v => html`<option value=${v} key=${v}>${v}</option>`)}
      </select>${help}</div>`;
  }
  if (def.type === 'number') {
    return html`<div class="adm-mb-sm">${label}
      <input class="adm-input" type="number" min=${def.min} max=${def.max}
        value=${value ?? def.default ?? ''}
        onInput=${(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
      ${help}</div>`;
  }
  if (def.type === 'string[]') {
    // A closed list is a set of checkboxes, because the order and the membership are the whole
    // setting and a free-text field would only let the operator get it wrong.
    const current = Array.isArray(value) ? value : [...(def.default ?? [])];
    if (def.values) {
      return html`<div class="adm-mb-sm">${label}
        <div class="adm-flex adm-flex-wrap">
          ${def.values.map(v => html`
            <label class="adm-flex-center" key=${v}>
              <input type="checkbox" checked=${current.includes(v)}
                onChange=${(e) => onChange(e.target.checked
                  ? [...current, v]
                  : current.filter(x => x !== v))} />
              <span>${v}</span>
            </label>`)}
        </div>${help}</div>`;
    }
    return html`<div class="adm-mb-sm">${label}
      <input class="adm-input" value=${current.join(', ')}
        onInput=${(e) => onChange(e.target.value.split(',').map(s => s.trim()).filter(Boolean))} />
      ${help}</div>`;
  }
  return html`<div class="adm-mb-sm">${label}
    <input class="adm-input" value=${value ?? def.default ?? ''} maxLength=${def.maxLength}
      onInput=${(e) => onChange(e.target.value || undefined)} />
    ${help}</div>`;
}

export function SurfaceLayoutEditor({ surface, onChanged }) {
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const [blocks, setBlocks] = useState(null);      // the working copy
  const [catalog, setCatalog] = useState([]);      // what this node can serve here
  const [passages, setPassages] = useState({});    // block key → words
  const [source, setSource] = useState('default');
  const [problems, setProblems] = useState([]);
  const [openBlock, setOpenBlock] = useState(null);
  const [versions, setVersions] = useState(null);
  const [pasted, setPasted] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    try {
      const [layoutRes, blocksRes] = await Promise.all([
        getSurfaceLayout(surface),
        getSurfaceBlocks(surface),
      ]);
      setBlocks(layoutRes.data?.layout?.blocks ?? []);
      setPassages(layoutRes.data?.freeform ?? {});
      setSource(layoutRes.data?.source ?? 'default');
      setProblems(layoutRes.data?.problems ?? []);
      setCatalog(blocksRes.data?.blocks ?? []);
      setDirty(false);
    } catch (err) {
      swallowed('surfaces-layout: load', err);
      showErr(err.message);
      setBlocks([]);
    }
    // showErr comes from useToast and is stable for the life of this component; listing it would
    // re-create the loader on every toast and re-fetch the page underneath the operator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);

  useEffect(() => { load(); }, [load]);

  const defOf = (id) => catalog.find(b => b.id === id);
  const edit = (fn) => { setBlocks(bs => fn(bs.slice())); setDirty(true); };

  const move = (idx, dir) => edit(bs => {
    const j = idx + dir;
    if (j < 0 || j >= bs.length) return bs;
    [bs[idx], bs[j]] = [bs[j], bs[idx]];
    return bs;
  });
  const toggleHidden = (idx) => edit(bs => { bs[idx] = { ...bs[idx], hidden: !bs[idx].hidden }; return bs; });
  const remove = (idx) => edit(bs => { bs.splice(idx, 1); return bs; });
  const setProp = (idx, name, value) => edit(bs => {
    const props = { ...(bs[idx].props ?? {}) };
    if (value === undefined) delete props[name]; else props[name] = value;
    bs[idx] = { ...bs[idx], ...(Object.keys(props).length ? { props } : { props: undefined }) };
    return bs;
  });
  const add = (id) => edit(bs => [...bs, { id, key: freeKey(bs, id) }]);

  async function save() {
    setSaving(true);
    try {
      // Passages travel inline on their block; the node splits them out to their own records.
      const payload = blocks.map(b => (b.id === 'common.freeform' && passages[b.key] !== undefined
        ? { ...b, body: passages[b.key] }
        : b));
      await saveSurfaceLayout(surface, { v: 1, blocks: payload });
      showOk(tr('dashboard.surfaceSaved', 'Saved. The page shows this now.'));
      setDirty(false);
      await load();
      onChanged?.();
    } catch (e) { showErr(e.message); }
    finally { setSaving(false); }
  }

  async function startFromBuiltIn() {
    if (!await confirm(tr('dashboard.surfaceResetAsk', 'Replace what you have here with the layout this node ships?'))) return;
    try { await resetSurfaceLayout(surface); await load(); onChanged?.(); showOk(tr('dashboard.surfaceReset', 'Started from the built-in layout.')); }
    catch (e) { showErr(e.message); }
  }

  async function revert() {
    if (!await confirm(tr('dashboard.surfaceRevertAsk', 'Go back to the built-in layout and forget this arrangement?'))) return;
    try { await revertSurfaceLayout(surface); await load(); onChanged?.(); showOk(tr('dashboard.surfaceReverted', 'Back to the built-in layout.')); }
    catch (e) { showErr(e.message); }
  }

  async function showVersions() {
    try { const r = await listLayoutVersions(surface); setVersions(r.data?.versions ?? []); }
    catch (e) { showErr(e.message); }
  }

  async function goBackTo(version) {
    if (!await confirm(tr('dashboard.surfaceRestoreAsk', 'Put this earlier arrangement back?'))) return;
    try { await restoreLayout(surface, version); await load(); onChanged?.(); showOk(tr('dashboard.surfaceRestored', 'Put back.')); }
    catch (e) { showErr(e.message); }
  }

  async function copyPrompt() {
    try {
      await copyToClipboard(await getLayoutPrompt(surface));
      showOk(tr('dashboard.surfacePromptCopied', 'Prompt copied. Paste it into your own AI chat.'));
    } catch (e) { showErr(e.message); }
  }

  async function applyPaste() {
    try {
      await importSurfaceLayout(JSON.parse(pasted));
      setPasted('');
      await load();
      onChanged?.();
      showOk(tr('dashboard.surfaceImported', 'Applied. The page shows this now.'));
    } catch (e) { showErr(e.message); }
  }

  if (blocks === null) return html`<div class="adm-text-dim">${t('dashboard.loading')}...</div>`;

  const unused = catalog.filter(c => !c.container
    && blocks.filter(b => b.id === c.id).length >= c.max_per_surface ? false : true);

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <${ConfirmUI} />

    <div class="adm-card">
      <h3>${tr('dashboard.surfaceBlocksTitle', 'What this page shows')}</h3>
      <div class="adm-erow">
        <span class="adm-elabel">${tr('dashboard.surfaceSource', 'Now showing')}</span>
        <span class="adm-eval">
          ${source === 'stored'
            ? html`<span class="adm-badge adm-badge-active">${tr('dashboard.surfaceYours', 'Your arrangement')}</span>`
            : html`<span class="adm-badge adm-badge-info">${tr('dashboard.surfaceBuiltIn', 'The built-in one')}</span>`}
        </span>
      </div>
      ${problems.length > 0 && html`
        <div class="adm-mb-sm">
          <p class="adm-text-error">${tr('dashboard.surfaceRepaired', 'Some of what was stored could not be used and was left out:')}</p>
          <ul>${problems.map((p, i) => html`<li key=${i} class="adm-text-dim">${p}</li>`)}</ul>
        </div>`}

      <table>
        <tbody>
          ${blocks.map((b, idx) => {
            const def = defOf(b.id);
            const settings = def ? Object.entries(def.settings ?? {}) : [];
            const isOpen = openBlock === b.key;
            return html`
              <tr key=${b.key}>
                <td>
                  <div><strong>${def ? t(def.label_key) !== def.label_key ? t(def.label_key) : b.id : b.id}</strong></div>
                  <div class="adm-text-dim adm-text-base">${def?.summary ?? tr('dashboard.surfaceUnknownBlock', 'This part is not available here any more.')}</div>
                  ${b.id === 'common.freeform' && isOpen && html`
                    <textarea class="adm-textarea adm-input-full" rows="6"
                      placeholder=${tr('dashboard.surfacePassagePh', 'Your own words, in Markdown.')}
                      value=${passages[b.key] ?? ''}
                      onInput=${(e) => { setPassages(p => ({ ...p, [b.key]: e.target.value })); setDirty(true); }}></textarea>`}
                  ${isOpen && settings.length > 0 && html`
                    <div class="adm-mt-sm">
                      ${settings.map(([name, sdef]) => html`
                        <${SettingField} key=${name} name=${name} def=${sdef}
                          value=${b.props?.[name]}
                          onChange=${(v) => setProp(idx, name, v)} />`)}
                    </div>`}
                </td>
                <td>
                  <button class="adm-btn-sm" disabled=${idx === 0} onClick=${() => move(idx, -1)} title=${tr('dashboard.surfaceUp', 'Move up')}>↑</button>
                  <button class="adm-btn-sm" disabled=${idx === blocks.length - 1} onClick=${() => move(idx, 1)} title=${tr('dashboard.surfaceDown', 'Move down')}>↓</button>
                  ${(settings.length > 0 || b.id === 'common.freeform') && html`
                    <button class="adm-btn-sm" onClick=${() => setOpenBlock(isOpen ? null : b.key)}>
                      ${isOpen ? tr('dashboard.surfaceClose', 'Close') : tr('dashboard.surfaceEdit', 'Edit')}
                    </button>`}
                  <button class="adm-btn-sm" onClick=${() => toggleHidden(idx)}>
                    ${b.hidden ? tr('dashboard.surfaceShow', 'Show') : tr('dashboard.surfaceHide', 'Hide')}
                  </button>
                  <button class="adm-btn-sm" onClick=${() => remove(idx)}>${tr('dashboard.surfaceRemove', 'Remove')}</button>
                </td>
              </tr>`;
          })}
        </tbody>
      </table>
      ${blocks.length === 0 && html`<p class="adm-text-dim">${tr('dashboard.surfaceEmpty', 'Nothing here yet. Add a part below, or start from the built-in layout.')}</p>`}

      <div class="adm-mt-sm">
        <span class="adm-elabel">${tr('dashboard.surfaceAdd', 'Add a part')}</span>
        <select class="adm-input" value="" onChange=${(e) => { if (e.target.value) { add(e.target.value); e.target.value = ''; } }}>
          <option value="">${tr('dashboard.surfaceAddPick', 'Choose one…')}</option>
          ${unused.map(c => html`<option value=${c.id} key=${c.id}>
            ${t(c.label_key) !== c.label_key ? t(c.label_key) : c.id} — ${c.summary}
          </option>`)}
        </select>
      </div>

      <div class="adm-flex adm-mt-sm">
        <button class="adm-btn-action" disabled=${saving || !dirty} onClick=${save}>
          ${dirty ? tr('dashboard.surfaceSave', 'Save this arrangement') : tr('dashboard.surfaceSaved2', 'Saved')}
        </button>
        <button class="adm-btn-sm" onClick=${startFromBuiltIn}>${tr('dashboard.surfaceStartBuiltIn', 'Start from the built-in one')}</button>
        ${source === 'stored' && html`<button class="adm-btn-sm" onClick=${revert}>${tr('dashboard.surfaceRevert', 'Go back to the built-in one')}</button>`}
        <button class="adm-btn-sm" onClick=${showVersions}>${tr('dashboard.surfaceHistory', 'Earlier arrangements')}</button>
      </div>

      ${versions !== null && html`
        <div class="adm-mt-sm">
          ${versions.length === 0
            ? html`<p class="adm-text-dim">${tr('dashboard.surfaceNoHistory', 'This page has not been changed yet.')}</p>`
            : html`<table><tbody>
                ${versions.map(v => html`<tr key=${v.version}>
                  <td class="adm-text-dim">${v.recorded_at}</td>
                  <td>${v.changed_by ?? ''}</td>
                  <td><button class="adm-btn-sm" onClick=${() => goBackTo(v.version)}>${tr('dashboard.surfaceGoBack', 'Put this back')}</button></td>
                </tr>`)}
              </tbody></table>`}
        </div>`}
    </div>

    <div class="adm-card">
      <h3>${tr('dashboard.surfaceAiTitle', 'Let your own AI arrange it')}</h3>
      <p class="adm-text-dim adm-text-base adm-mb-sm">
        ${tr('dashboard.surfaceAiExplain', 'If your AI is connected to this installation it can do this directly and you never come here. If it is not, copy the prompt, paste it into your own AI chat, and paste what it gives back into the box below. You see everything before it is applied.')}
      </p>
      <div class="adm-flex adm-mb-sm">
        <button class="adm-btn-action" onClick=${copyPrompt}>${tr('dashboard.surfaceCopyPrompt', 'Copy the prompt')}</button>
      </div>
      <textarea class="adm-textarea adm-input-full" rows="6"
        placeholder=${tr('dashboard.surfacePastePh', 'Paste what your AI gave back here.')}
        value=${pasted} onInput=${(e) => setPasted(e.target.value)}></textarea>
      <div class="adm-flex adm-mt-sm">
        <button class="adm-btn-action" disabled=${!pasted.trim()} onClick=${applyPaste}>
          ${tr('dashboard.surfaceApplyPaste', 'Apply it')}
        </button>
      </div>
    </div>
  `;
}

export default SurfaceLayoutEditor;
