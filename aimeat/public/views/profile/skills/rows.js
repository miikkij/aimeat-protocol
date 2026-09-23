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
 *   2026-09-22 -- The row is the shared ListRow and the opened skill a shared record of key-value
 *     rows, fields and actions, so it follows the one component set; no page classes remain.
 *   v1.1.0 -- 2026-09-13 -- Compose catalogue detail frames from poster.css.
 *   v1.0.0 — 2026-09-03 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { ListRow, KeyValue, Stack, Surface, Field, Text, Action, CopyAction } from '/components/poster-parts.js';
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
  const line = `v${s.version} · ${s.supersededBy ? `${x('who.replaced').toLowerCase()} · ${subLine(s)}` : subLine(s)}`;
  return html`
    <${ListRow} key=${s.ref} name=${s.name} detailKind="text" detail=${s.description || undefined}
      actions=${html`<${Action} expanded=${open} onClick=${() => ctx.toggle(s)}>${open ? x('close') : x('open')}<//>
        <${CopyAction} text=${s.ref} label=${x('copyRef')} copiedLabel=${x('copied')} />`}>
      <${Stack}>
        <${Stack} direction="wrap" align="between" density="compact">
          <${Text} kind="mono" tone=${s.supersededBy ? 'coral' : 'muted'}>${line}<//>
          <${Stack} direction="wrap" align="center" density="compact">
            ${who.kind === 'app' ? html`<${Action} kind="text" onClick=${() => openTab('apps')}>${who.label}<//>` : html`<strong>${who.label}</strong>`}
            <${Text} kind="caption" tone="muted">${who.sub}<//>
          <//>
        <//>
        ${open ? skillOpen(ctx, s, who) : null}
      <//>
    <//>`;
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
  const copyLine = (text, label) => html`<${Stack} direction="wrap" align="center" density="compact"><${Text} kind="mono">${text}<//><${CopyAction} text=${text} label=${label} copiedLabel=${x('copied')} /><//>`;
  const sub = (words) => html`<${Text} kind="caption" tone="muted">${words}<//>`;
  return html`
    <${Surface} kind="record">
      <${Stack}>
      <${Text} kind="lead">${s.description || ''}<//>
      <div>
        <${KeyValue} label=${x('ref')}><${Stack} density="compact">${copyLine(s.ref, x('copy'))}${copyLine(pinned, x('copyPinned'))}${sub(x('refSub'))}<//><//>
        <${KeyValue} label=${x('version')}><${Stack} density="compact">
          <span>${x('versionLine', { v: s.version, date: dateWord(s.updatedAt) })}${versions.length ? ` · ${x('versionsKept', { n: versions.length, from: versions[0].version, to: versions[versions.length - 1].version })}` : ''}</span>
          ${sub(d?.metadata?.aimeat_ref ? x('installedFrom', { ref: d.metadata.aimeat_ref }) : x('versionSub'))}
        <//><//>
        <${KeyValue} label=${x('who.k')}><${Stack} density="compact">
          <span>
            ${who.kind === 'app' ? html`${x('who.appLong')} <${Action} kind="text" onClick=${() => openTab('apps')}>${ctx.apps?.[who.file] || who.file}<//>. ` : null}
            ${who.kind === 'replaced' ? html`${x('who.replacedLong', { by: s.supersededBy })} ` : null}
            ${who.kind === 'all' ? html`${x('who.allLong')} ` : null}
            ${who.kind === 'ws' ? html`${x('who.wsLong')} ` : null}
            ${who.kind === 'free' ? html`${x('who.freeLong')} ` : null}
            ${who.agents.length ? html`${who.agents.length === 1 ? x('who.agentLong') : x('who.agentsLong', { n: who.agents.length })}:${who.agents.map((a, i) => html`<span key=${a.agent}>${i ? ', ' : ' '}<${Action} kind="text" onClick=${() => openTab('agents')}>${a.agent}<//>${a.pin ? ` (@${a.pin})` : ''}${own || s.scope !== 'user' ? html` <${Action} kind="text" tone="danger" onClick=${() => ctx.unlink(s, a.agent, a.agent && a.pin ? `${s.ref}@${a.pin}` : s.ref)}>${x('detach')}<//>` : null}</span>`)}` : x('who.noAgents')}
          </span>
          <${Text} kind="caption" tone="muted">${x('who.attachSub')}<//>
          <div><${Action} expanded=${!!picker} onClick=${() => ctx.openPicker(s)}>${picker ? x('close') : x('attach')}<//></div>
          ${picker ? html`<${Stack} direction="wrap" align="end">
            <${Field} type="select" width="narrow" ariaLabel=${x('pickAgent')} value=${picker.selected} onChange=${(e) => ctx.pickAgent(e.target.value)}
              options=${[{ value: '', label: x('pickAgent') }, ...picker.agents.map((a) => ({ value: a, label: a }))]} />
            <${Action} kind="choice" semantics="switch" title=${x('pinToVersion', { v: s.version })} selected=${!!picker.pin} onClick=${() => ctx.pickPin(!picker.pin)} />
            <${Action} disabled=${!picker.selected || ctx.busy} onClick=${() => ctx.link(s)}>${x('attachDo')}<//>
          <//>` : null}
        <//><//>
        <${KeyValue} label=${x('vis.k')}><${Stack} density="compact">
          <span>${visibilityWord(s.visibility)}${publicIndex ? ` · ${x('vis.inIndex')}` : ''}</span>
          ${sub(x('vis.' + (s.visibility === 'workspace' ? 'workspaceSub' : s.visibility + 'Sub')))}
          ${own ? html`<${Stack} direction="wrap" align="center">${['owner', 'members', 'public'].map((v) => html`<${Action} key=${v} kind="tab" selected=${s.visibility === v} disabled=${ctx.busy || s.visibility === v} onClick=${() => ctx.setVisibility(s, v)}>${visibilityWord(v)}<//>`)}${sub(x('vis.change'))}<//>` : null}
        <//><//>
        <${KeyValue} label=${x('files')}><${Stack} density="compact">${(s.files || []).map((f) => html`<${Stack} key=${f.path} direction="horizontal" align="between"><${Text} kind="mono">${f.path}<//><${Text} kind="mono" tone="muted">${sizeWord([f])}<//><//>`)}<//><//>
        <${KeyValue} label=${x('install')}><${Stack} density="compact">${copyLine(installLine(pinned), x('copy'))}
          <${Text} kind="caption" tone="muted">${x('installSub')}<//>
          <div><${Action} onClick=${() => ctx.download(s)}>${x('downloadZip')}<//></div>
        <//><//>
      </div>
      <${Text} kind="label">SKILL.md<//>
      ${!d ? html`<${Text} tone="muted">${t('common.loading')}<//>` : html`
        <${Surface} kind="plain" density="flush" height=${full ? 'auto' : 'scroll'}><${Markdown} text=${body} /><//>
        ${!full ? html`<div><${Action} onClick=${() => ctx.showFull(s)}>${x('showFull')}<//></div>` : null}`}
      <${Stack} direction="wrap" align="center">
        <${CopyAction} text=${s.ref} label=${x('copyRef')} copiedLabel=${x('copied')} />
        <${Action} onClick=${() => ctx.download(s)}>${x('downloadZip')}<//>
        ${own ? html`<${Action} onClick=${() => ctx.edit(s)}>${x('edit')}<//>` : null}
        ${own ? html`<${Action} tone="danger" onClick=${() => ctx.remove(s)}>${x('remove')}<//>` : null}
        <${Action} onClick=${() => ctx.toggle(s)}>${x('close')}<//>
      <//>
      <//>
    <//>`;
}

export const loadingRow = () => html`<${Text} tone="muted">${t('common.loading')}<//>`;
