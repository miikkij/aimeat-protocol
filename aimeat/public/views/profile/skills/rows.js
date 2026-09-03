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
    <div class=${`sk-p ${open ? 'is-open' : ''}`} key=${s.ref}>
      <div class="sk-nm">${s.name}<span class="sk-tag">v${s.version}</span><small class=${s.supersededBy ? 'is-warn' : ''}>${s.supersededBy ? `${x('who.replaced').toLowerCase()} · ${subLine(s)}` : subLine(s)}</small></div>
      <div class="sk-ds">${s.description || ''}</div>
      <div class="sk-me">${who.kind === 'app' ? html`<button type="button" class="og-crumb-link sk-linkbtn" onClick=${() => openTab('apps')}>${who.label}</button>` : who.label}<small>${who.sub}</small></div>
      <div class="sk-go">
        <button type="button" class="og-door" onClick=${() => ctx.toggle(s)}>${open ? x('close') : x('open')}</button>
        <${CopyButton} text=${s.ref} className="og-door og-door--quiet" label=${x('copyRef')} copiedLabel=${x('copied')} />
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
    <div class="sk-open">
      <p class="sk-lead">${s.description || ''}</p>
      <div class="sk-kv">
        <div class="sk-k">${x('ref')}</div><div class="sk-v"><code>${s.ref}</code> · <${CopyButton} text=${s.ref} className="og-crumb-link" label=${x('copy')} copiedLabel=${x('copied')} /><br /><code>${pinned}</code> · <${CopyButton} text=${pinned} className="og-crumb-link" label=${x('copyPinned')} copiedLabel=${x('copied')} /><small>${x('refSub')}</small></div>
        <div class="sk-k">${x('version')}</div><div class="sk-v">${x('versionLine', { v: s.version, date: dateWord(s.updatedAt) })}${versions.length ? ` · ${x('versionsKept', { n: versions.length, from: versions[0].version, to: versions[versions.length - 1].version })}` : ''}<small>${d?.metadata?.aimeat_ref ? x('installedFrom', { ref: d.metadata.aimeat_ref }) : x('versionSub')}</small></div>
        <div class="sk-k">${x('who.k')}</div><div class="sk-v">
          ${who.kind === 'app' ? html`${x('who.appLong')} <button type="button" class="og-crumb-link sk-linkbtn" onClick=${() => openTab('apps')}>${ctx.apps?.[who.file] || who.file}</button>. ` : null}
          ${who.kind === 'replaced' ? html`${x('who.replacedLong', { by: s.supersededBy })} ` : null}
          ${who.kind === 'all' ? html`${x('who.allLong')} ` : null}
          ${who.kind === 'ws' ? html`${x('who.wsLong')} ` : null}
          ${who.kind === 'free' ? html`${x('who.freeLong')} ` : null}
          ${who.agents.length ? html`${who.agents.length === 1 ? x('who.agentLong') : x('who.agentsLong', { n: who.agents.length })}:${who.agents.map((a, i) => html`<span key=${a.agent}>${i ? ', ' : ''}<button type="button" class="og-crumb-link sk-linkbtn" onClick=${() => openTab('agents')}>${a.agent}</button>${a.pin ? ` (@${a.pin})` : ''}${own || s.scope !== 'user' ? html` <button type="button" class="og-crumb-link sk-linkbtn sk-dim" onClick=${() => ctx.unlink(s, a.agent, a.agent && a.pin ? `${s.ref}@${a.pin}` : s.ref)}>${x('detach')}</button>` : null}</span>`)}` : x('who.noAgents')}
          <small>${x('who.attachSub')} <button type="button" class="og-crumb-link sk-linkbtn" onClick=${() => ctx.openPicker(s)}>${picker ? x('close') : x('attach')}</button></small>
          ${picker ? html`<div class="sk-picker">
            <select class="og-input" value=${picker.selected} onChange=${(e) => ctx.pickAgent(e.target.value)}>
              <option value="">${x('pickAgent')}</option>
              ${picker.agents.map((a) => html`<option key=${a} value=${a}>${a}</option>`)}
            </select>
            <label class="sk-check"><input type="checkbox" checked=${picker.pin} onChange=${(e) => ctx.pickPin(e.target.checked)} /> ${x('pinToVersion', { v: s.version })}</label>
            <button type="button" class="og-door" disabled=${!picker.selected || ctx.busy} onClick=${() => ctx.link(s)}>${x('attachDo')}</button>
          </div>` : null}
        </div>
        <div class="sk-k">${x('vis.k')}</div><div class="sk-v">${visibilityWord(s.visibility)}${publicIndex ? ` · ${x('vis.inIndex')}` : ''}<small>${x('vis.' + (s.visibility === 'workspace' ? 'workspaceSub' : s.visibility + 'Sub'))}</small>
          ${own ? html`<div class="og-doors sk-vis">${['owner', 'members', 'public'].map((v) => html`<button type="button" key=${v} class=${`og-door og-door--quiet ${s.visibility === v ? 'is-on' : ''}`} disabled=${ctx.busy || s.visibility === v} onClick=${() => ctx.setVisibility(s, v)}>${visibilityWord(v)}</button>`)}<span class="sk-hint">${x('vis.change')}</span></div>` : null}
        </div>
        <div class="sk-k">${x('files')}</div><div class="sk-v"><div class="sk-files">${(s.files || []).map((f) => html`<div key=${f.path}><code>${f.path}</code></div><div key=${'s' + f.path} class="sk-r">${sizeWord([f])}</div>`)}</div></div>
        <div class="sk-k">${x('install')}</div><div class="sk-v"><code>${installLine(pinned)}</code> · <${CopyButton} text=${installLine(pinned)} className="og-crumb-link" label=${x('copy')} copiedLabel=${x('copied')} /><small>${x('installSub')} <button type="button" class="og-crumb-link sk-linkbtn" onClick=${() => ctx.download(s)}>${x('downloadZip')}</button></small></div>
      </div>
      <span class="og-label sk-mdlabel">SKILL.md</span>
      ${!d ? html`<p class="sk-empty">${t('common.loading')}</p>` : html`
        <div class=${`sk-md ${full ? 'is-full' : ''}`}>
          <${Markdown} text=${body} />
          ${!full ? html`<div class="sk-fade"><button type="button" class="og-door og-door--quiet" onClick=${() => ctx.showFull(s)}>${x('showFull')}</button></div>` : null}
        </div>`}
      <div class="og-doors sk-open-doors">
        <${CopyButton} text=${s.ref} className="og-door" label=${x('copyRef')} copiedLabel=${x('copied')} />
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.download(s)}>${x('downloadZip')}</button>
        ${own ? html`<button type="button" class="og-door og-door--quiet" onClick=${() => ctx.edit(s)}>${x('edit')}</button>` : null}
        ${own ? html`<button type="button" class="og-door og-door--quiet sk-danger" onClick=${() => ctx.remove(s)}>${x('remove')}</button>` : null}
        <button type="button" class="og-door og-door--quiet" onClick=${() => ctx.toggle(s)}>${x('close')}</button>
      </div>
    </div>`;
}

export const loadingRow = () => html`<p class="sk-empty">${t('common.loading')}</p>`;
