/**
 * @file public/views/profile/skills/rows.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One skill's row on the Skills page and what opens under it. The row: the name with
 *   its version, visibility, file count, size and date; what it teaches; whom it serves (the app it
 *   is bound to, the agents holding its ref, everyone, a workspace, or nobody in particular); the
 *   doors. Opened: the ref and the version-locked ref, the versions kept, whom it serves with the
 *   attach and detach doors, visibility changed in place, the files, the install line, the SKILL.md
 *   rendered with a fold, and the doors an owner has on their own skill.
 * @structure skillRow · skillOpen · loadingRow
 * @usage import { skillRow } from './rows.js';
 * @version-history
 *   v1.16.0 -- 2026-09-26 -- "Pin to this version" is the Check line (css/components/check-line.css), a unification: Jouni's decision "Check line".
 *   v1.15.0 -- 2026-09-26 -- A framed box is the Object box (.poster-box), the one that stands out (an opened row, the way to take first) its raised tone; a page rule keeps only its place (a unification: Jouni's decision "Box").
 *   v1.14.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.13.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- Who may see a skill (owner, members, public) is a choice: the Tab (.poster-tab, the chosen one .is-on), a unification: Jouni's decision "Choice".
 *   v1.11.0 -- 2026-09-25 -- An opened skill's facts are the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.10.0 -- 2026-09-25 -- A skill's row and the file list are the Listing (listing-row and its name, words, who and doors cells, the open panel), a unification: the look most tabs use.
 *   v1.9.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.8.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.7.0 -- 2026-09-25 -- Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v1.6.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.5.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.4.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.3.0 -- 2026-09-25 -- A delete, revoke or reset link keeps its coral as the action link's danger
 *     tone, .poster-action--danger (Jouni's decision "Action link").
 *   v1.2.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.1.0 -- 2026-09-13 -- Compose catalogue detail frames from poster.css.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import { Markdown } from '/components/Markdown.js';
import { x, splitSkillMd, isOwn, whoOf, visibilityWord, sizeWord, dateWord, installLine, openTab } from './frame.js';

function subLine(s) {
  const parts = [visibilityWord(s.visibility)];
  if ((s.files || []).length > 1) parts.push(x('filesN', { n: s.files.length }));
  parts.push(sizeWord(s.files));
  const d = dateWord(s.updatedAt);
  if (d) parts.push(d);
  return parts.join(' · ');
}

export function skillRow(ctx, s) {
  const open = ctx.expanded === s.ref;
  const who = whoOf(s, ctx);
  return html`
    <div class=${`listing-row ${open ? 'is-open' : ''}`} key=${s.ref}>
      <div class="listing-name">${s.name}<span class="poster-chip">v${s.version}</span><small class=${s.supersededBy ? 'is-warn' : ''}>${s.supersededBy ? `${x('who.replaced').toLowerCase()} · ${subLine(s)}` : subLine(s)}</small></div>
      <div class="listing-desc">${s.description || ''}</div>
      <div class="listing-who">${who.kind === 'app' ? html`<button type="button" class="poster-action poster-action--more" onClick=${() => openTab('apps')}>${who.label}</button>` : who.label}<small>${who.sub}</small></div>
      <div class="listing-doors">
        <button type="button" class="poster-action poster-action--small poster-action--row" onClick=${() => ctx.toggle(s)}>${open ? x('close') : x('open')}</button>
        <${CopyButton} text=${s.ref} className="poster-action poster-action--small poster-action--row poster-action--lower" label=${x('copyRef')} copiedLabel=${x('copied')} />
      </div>
      ${open ? skillOpen(ctx, s, who) : null}
    </div>`;
}

function skillOpen(ctx, s, who) {
  const d = ctx.details[s.ref];
  const own = isOwn(s, ctx.ownerName);
  const versions = d?.versions || [];
  const pinned = `${s.ref}@${s.version}`;
  const md = d?.fileContents?.['SKILL.md'];
  const { body } = md ? splitSkillMd(md) : { body: '' };
  const full = !!ctx.fullText[s.ref];
  const picker = ctx.picker && ctx.picker.ref === s.ref ? ctx.picker : null;
  const publicIndex = s.scope === 'node' && s.visibility === 'public';
  return html`
    <div class="listing-open poster-box poster-box--raised">
      <p class="og-lead">${s.description || ''}</p>
      <div class="facts">
        <div class="facts-k poster-label">${x('ref')}</div><div class="facts-v"><code class="code-inline">${s.ref}</code> · <${CopyButton} text=${s.ref} className="og-crumb-link" label=${x('copy')} copiedLabel=${x('copied')} /><br /><code>${pinned}</code> · <${CopyButton} text=${pinned} className="og-crumb-link" label=${x('copyPinned')} copiedLabel=${x('copied')} /><small>${x('refSub')}</small></div>
        <div class="facts-k poster-label">${x('version')}</div><div class="facts-v">${x('versionLine', { v: s.version, date: dateWord(s.updatedAt) })}${versions.length ? ` · ${x('versionsKept', { n: versions.length, from: versions[0].version, to: versions[versions.length - 1].version })}` : ''}<small>${d?.metadata?.aimeat_ref ? x('installedFrom', { ref: d.metadata.aimeat_ref }) : x('versionSub')}</small></div>
        <div class="facts-k poster-label">${x('who.k')}</div><div class="facts-v">
          ${who.kind === 'app' ? html`${x('who.appLong')} <button type="button" class="poster-action poster-action--more" onClick=${() => openTab('apps')}>${ctx.apps?.[who.file] || who.file}</button>. ` : null}
          ${who.kind === 'replaced' ? html`${x('who.replacedLong', { by: s.supersededBy })} ` : null}
          ${who.kind === 'all' ? html`${x('who.allLong')} ` : null}
          ${who.kind === 'ws' ? html`${x('who.wsLong')} ` : null}
          ${who.kind === 'free' ? html`${x('who.freeLong')} ` : null}
          ${who.agents.length ? html`${who.agents.length === 1 ? x('who.agentLong') : x('who.agentsLong', { n: who.agents.length })}:${who.agents.map((a, i) => html`<span key=${a.agent}>${i ? ', ' : ''}<button type="button" class="poster-action poster-action--more" onClick=${() => openTab('agents')}>${a.agent}</button>${a.pin ? ` (@${a.pin})` : ''}${own || s.scope !== 'user' ? html` <button type="button" class="poster-action poster-action--text" onClick=${() => ctx.unlink(s, a.agent, a.agent && a.pin ? `${s.ref}@${a.pin}` : s.ref)}>${x('detach')}</button>` : null}</span>`)}` : x('who.noAgents')}
          <small>${x('who.attachSub')} <button type="button" class="poster-action poster-action--more" onClick=${() => ctx.openPicker(s)}>${picker ? x('close') : x('attach')}</button></small>
          ${picker ? html`<div class="sk-picker">
            <select class="select-field" value=${picker.selected} onChange=${(e) => ctx.pickAgent(e.target.value)}>
              <option value="">${x('pickAgent')}</option>
              ${picker.agents.map((a) => html`<option key=${a} value=${a}>${a}</option>`)}
            </select>
            <label class="sk-check check-line"><input type="checkbox" checked=${picker.pin} onChange=${(e) => ctx.pickPin(e.target.checked)} /> ${x('pinToVersion', { v: s.version })}</label>
            <button type="button" class="poster-action poster-action--small" disabled=${!picker.selected || ctx.busy} onClick=${() => ctx.link(s)}>${x('attachDo')}</button>
          </div>` : null}
        </div>
        <div class="facts-k poster-label">${x('vis.k')}</div><div class="facts-v">${visibilityWord(s.visibility)}${publicIndex ? ` · ${x('vis.inIndex')}` : ''}<small>${x('vis.' + (s.visibility === 'workspace' ? 'workspaceSub' : s.visibility + 'Sub'))}</small>
          ${own ? html`<div class="og-doors sk-vis">${['owner', 'members', 'public'].map((v) => html`<button type="button" key=${v} class=${`poster-tab ${s.visibility === v ? 'is-on' : ''}`} disabled=${ctx.busy || s.visibility === v} onClick=${() => ctx.setVisibility(s, v)}>${visibilityWord(v)}</button>`)}<span class="poster-hint">${x('vis.change')}</span></div>` : null}
        </div>
        <div class="facts-k poster-label">${x('files')}</div><div class="facts-v"><div class="listing listing--path-size sk-files">${(s.files || []).map((f) => html`<div class="listing-row" key=${f.path}><div><code class="code-inline">${f.path}</code></div><div class="sk-r">${sizeWord([f])}</div></div>`)}</div></div>
        <div class="facts-k poster-label">${x('install')}</div><div class="facts-v"><code class="code-inline">${installLine(pinned)}</code> · <${CopyButton} text=${installLine(pinned)} className="og-crumb-link" label=${x('copy')} copiedLabel=${x('copied')} /><small>${x('installSub')} <button type="button" class="poster-action poster-action--more" onClick=${() => ctx.download(s)}>${x('downloadZip')}</button></small></div>
      </div>
      <span class="poster-label sk-mdlabel">SKILL.md</span>
      ${!d ? html`<p class="poster-quiet sk-empty loading-mark">${t('common.loading')}</p>` : html`
        <div class=${`sk-md poster-box ${full ? 'is-full' : ''}`}>
          <${Markdown} text=${body} />
          ${!full ? html`<div class="sk-fade"><button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.showFull(s)}>${x('showFull')}</button></div>` : null}
        </div>`}
      <div class="og-doors listing-open-doors">
        <${CopyButton} text=${s.ref} className="poster-action poster-action--small" label=${x('copyRef')} copiedLabel=${x('copied')} />
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.download(s)}>${x('downloadZip')}</button>
        ${own ? html`<button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.edit(s)}>${x('edit')}</button>` : null}
        ${own ? html`<button type="button" class="poster-action poster-action--small poster-action--danger poster-action--lower" onClick=${() => ctx.remove(s)}>${x('remove')}</button>` : null}
        <button type="button" class="poster-action poster-action--small poster-action--lower" onClick=${() => ctx.toggle(s)}>${x('close')}</button>
      </div>
    </div>`;
}

export const loadingRow = () => html`<p class="poster-quiet sk-empty loading-mark">${t('common.loading')}</p>`;
