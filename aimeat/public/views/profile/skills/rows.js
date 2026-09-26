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
 *   v1.18.0 -- 2026-09-26 -- On the component kit (page group G7): the opened panel's facts are the Facts (the copies and the links inside a value are the Action's link tone, main's coral crumb link), the agent picker is the Select, the Check and the Action, who may see it the Tabs, the SKILL.md the Box's folded tone with its "show all", the loading lines the Note and the List. The file writes no class.
 *   v1.17.0 -- 2026-09-26 -- A skill's row, its opened panel with the doors at its foot, and the file list are the List component (components/List.js: Row, Name, Desc, Who, Doors, Panel, List); the doors are the Action, the copy door its copy (component plan C1).
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
import { Markdown } from '/components/Markdown.js';
import { Action } from '/components/Action.js';
import { Code, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Facts } from '/components/Facts.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Tabs } from '/components/Tabs.js';
import { List, Row, Name, Desc, Who, Num, Cell, Doors, Panel } from '/components/List.js';
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
    <${Row} key=${s.ref} open=${open}>
      <${Name} tag=${'v' + s.version} warn=${!!s.supersededBy} meta=${s.supersededBy ? `${x('who.replaced').toLowerCase()} · ${subLine(s)}` : subLine(s)}>${s.name}<//>
      <${Desc}>${s.description || ''}<//>
      <${Who} sub=${who.sub}>${who.kind === 'app' ? html`<${Action} tone="more" onClick=${() => openTab('apps')}>${who.label}<//>` : who.label}<//>
      <${Doors}>
        <${Action} small row onClick=${() => ctx.toggle(s)}>${open ? x('close') : x('open')}<//>
        <${Action} small row soft copy=${s.ref} copiedLabel=${x('copied')}>${x('copyRef')}<//>
      <//>
      ${open ? skillOpen(ctx, s, who) : null}
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
  const doors = html`
    <${Action} small copy=${s.ref} copiedLabel=${x('copied')}>${x('copyRef')}<//>
    <${Action} small soft onClick=${() => ctx.download(s)}>${x('downloadZip')}<//>
    ${own ? html`<${Action} small soft onClick=${() => ctx.edit(s)}>${x('edit')}<//>` : null}
    ${own ? html`<${Action} small soft tone="danger" onClick=${() => ctx.remove(s)}>${x('remove')}<//>` : null}
    <${Action} small soft onClick=${() => ctx.toggle(s)}>${x('close')}<//>`;
  const detach = (a) => () => ctx.unlink(s, a.agent, a.agent && a.pin ? `${s.ref}@${a.pin}` : s.ref);
  const copyLink = (text, label) => html`<${Action} tone="link" copy=${text} copiedLabel=${x('copied')}>${label}<//>`;
  const whoValue = html`
    ${who.kind === 'app' ? html`${x('who.appLong')} <${Action} tone="link" onClick=${() => openTab('apps')}>${ctx.apps?.[who.file] || who.file}<//>. ` : null}
    ${who.kind === 'replaced' ? html`${x('who.replacedLong', { by: s.supersededBy })} ` : null}
    ${who.kind === 'all' ? html`${x('who.allLong')} ` : null}
    ${who.kind === 'ws' ? html`${x('who.wsLong')} ` : null}
    ${who.kind === 'free' ? html`${x('who.freeLong')} ` : null}
    ${who.agents.length ? html`${who.agents.length === 1 ? x('who.agentLong') : x('who.agentsLong', { n: who.agents.length })}:${who.agents.map((a, i) => html`<span key=${a.agent}>${i ? ', ' : ''}<${Action} tone="link" onClick=${() => openTab('agents')}>${a.agent}<//>${a.pin ? ` (@${a.pin})` : ''}${own || s.scope !== 'user' ? html` <${Action} tone="text" onClick=${detach(a)}>${x('detach')}<//>` : null}</span>`)}` : x('who.noAgents')}`;
  const pickerDoors = picker ? html`
    <${Select} fit value=${picker.selected} onChange=${(v) => ctx.pickAgent(v)} ariaLabel=${x('pickAgent')}
      placeholder=${x('pickAgent')} options=${picker.agents.map((a) => [a, a])} />
    <${Check} inline checked=${picker.pin} onChange=${(on) => ctx.pickPin(on)}>${x('pinToVersion', { v: s.version })}<//>
    <${Action} small disabled=${!picker.selected || ctx.busy} onClick=${() => ctx.link(s)}>${x('attachDo')}<//>` : null;
  const visDoors = own ? html`
    <${Tabs} label=${x('vis.k')} value=${s.visibility} disabled=${ctx.busy} onSelect=${(v) => ctx.setVisibility(s, v)}
      items=${['owner', 'members', 'public'].map((v) => ({ value: v, label: visibilityWord(v), disabled: s.visibility === v }))} />
    <${Note} inline>${x('vis.change')}<//>` : null;
  return html`
    <${Panel} doors=${doors}>
      <${Note} kind="lead">${s.description || ''}<//>
      <${Facts} rows=${[
        { k: x('ref'), v: html`<${Code}>${s.ref}<//> · ${copyLink(s.ref, x('copy'))}<br /><${Code}>${pinned}<//> · ${copyLink(pinned, x('copyPinned'))}`, sub: x('refSub') },
        { k: x('version'), v: `${x('versionLine', { v: s.version, date: dateWord(s.updatedAt) })}${versions.length ? ` · ${x('versionsKept', { n: versions.length, from: versions[0].version, to: versions[versions.length - 1].version })}` : ''}`,
          sub: d?.metadata?.aimeat_ref ? x('installedFrom', { ref: d.metadata.aimeat_ref }) : x('versionSub') },
        { k: x('who.k'), v: whoValue, sub: html`${x('who.attachSub')} <${Action} tone="link" onClick=${() => ctx.openPicker(s)}>${picker ? x('close') : x('attach')}<//>`, actions: pickerDoors },
        { k: x('vis.k'), v: `${visibilityWord(s.visibility)}${publicIndex ? ` · ${x('vis.inIndex')}` : ''}`, sub: x('vis.' + (s.visibility === 'workspace' ? 'workspaceSub' : s.visibility + 'Sub')), actions: visDoors },
        { k: x('files'), v: html`<${List} cols="path-size" keepCols dense>${(s.files || []).map((f) => html`<${Row} key=${f.path}><${Cell}><${Code}>${f.path}<//><//><${Num} dim>${sizeWord([f])}<//><//>`)}<//>` },
        { k: x('install'), v: html`<${Code}>${installLine(pinned)}<//> · ${copyLink(installLine(pinned), x('copy'))}`, sub: html`${x('installSub')} <${Action} tone="link" onClick=${() => ctx.download(s)}>${x('downloadZip')}<//>` },
      ]} />
      <${Label} block>SKILL.md<//>
      ${!d ? html`<${Note} kind="loading">${t('common.loading')}<//>` : html`
        <${Box} folded=${!full} unfoldLabel=${x('showFull')} onUnfold=${() => ctx.showFull(s)}>
          <${Markdown} text=${body} />
        <//>`}
    <//>`;
}

export const loadingRow = () => html`<${List} loading=${t('common.loading')} />`;
