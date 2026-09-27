/**
 * @file skills-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Skills page in the poster face (design canvas "AIMEAT Admin Skills"): the
 *   node-wide library every agent here can load. Three views under one crumb — the list with its
 *   search and five filters, one skill open with the facts an operator decides on, and the writing
 *   view that reads a file's frontmatter back before anything is published.
 *
 * @structure
 *   - SkillsAdminTab (default): the model, the three views, the writes
 *   - List: the strip, the headline, search and chips, one row per skill
 *   - Open: what the agent reads, beside where the skill came from and who may read it
 *   - Write: the file, what it says it is, and who may read it
 *   - frontmatterOf / bumpPatch: reading a name and a version out of the text being edited
 * @usage registered in views/admin.js NAV_GROUPS
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only (Jouni, 2026-09-22: "all admin pages onto the
 *     shared set"): the strip FigureStrip, the section Section, the headline a Label, a Figure and a
 *     hint in Columns, the search SearchLine, the five chips a filter Tabs row, the skills a List
 *     (their tags Marks: public and retired coral, the app ink; the description under the row, kept
 *     to two lines), the foot More; the opened skill a Crumb, a PageHead and Beside with its Facts
 *     (who reads it: the sun tag with the action beside it); the writing view a code TextArea, a
 *     Box of Facts for what the file says, the warnings aside Notes and who may read a boxed Choice.
 *     admin-skills.css goes.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.2.0 -- 2026-09-13 -- Compose remaining section headings and record rules from poster.css.
 *   v2.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v2.0.0 — 2026-09-12 — The poster face, and five things the page held and never showed.
 *     `builtin` is computed by listSkills and was dropped, so nothing said which skills came with
 *     the build; `updatedAt` was dropped too, so a skill untouched since July looked current.
 *     Visibility was a badge although setSkillVisibility and PATCH /v1/skills/:name were both
 *     already there. Edit opened a nameless textarea while publish keys the skill on the name line
 *     inside the file, so changing it published a second skill and left the first. And Delete asked
 *     with window.confirm. The description stays, clamped to two lines: it is the field that says
 *     when to load a skill, and at a median of 371 characters it was the whole page.
 *   v1.0.0 -- 2026-07-05 -- Initial creation (Skills feature Phase 2b)
 */
import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { num, Spinner, useToast, Toast } from './shared.js';
import { Markdown } from '/components/Markdown.js';
import { splitSkillMd, bindingFile } from '/views/profile/skills/frame.js';
import { useConfirm } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { PageHead } from '/components/PageHead.js';
import { Crumb } from '/components/Crumb.js';
import { Note } from '/components/Note.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Figure } from '/components/Figure.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Facts } from '/components/Facts.js';
import { Box } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { Choice } from '/components/Choice.js';
import { SubHeading } from '/components/SubHeading.js';
import { TextArea } from '/components/TextField.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { List, Row, Name, Desc, Cell, When, Doors, SearchLine, More } from '/components/List.js';
import { Stack, Space, Beside, Columns } from '/components/Layout.js';
import * as skillsService from '/js/services/skills.js';

const html = htm.bind(h);

const S = (key, params) => t('admin.sk.' + key, params);

/** A skill untouched for this long is old enough to be worth a look. */
const STALE_DAYS = 60;

const NODE_SKILL_TEMPLATE = `---
name: node-skill
description: What this skill teaches an agent and when to use it.
---

# Node skill

Expertise available to every agent on this installation.
`;

/**
 * The `name:` and `description:` of a file's frontmatter, as the registry will read them.
 *
 * Read line by line rather than with one regular expression: a description runs over as many
 * indented continuation lines as its author wanted, and that is the shape the pattern kept getting
 * wrong. Not a YAML parser, and it does not need to be — these two keys decide what is published.
 */
function frontmatterOf(md) {
  const { frontmatter, body } = splitSkillMd(md);
  let name = '';
  let binding = '';
  const desc = [];
  let inDesc = false;
  for (const line of frontmatter.split(/\r?\n/)) {
    const top = /^(\S[^:]*):\s*(.*)$/.exec(line);
    if (top) {
      inDesc = top[1] === 'description';
      if (inDesc) desc.push(top[2]);
      if (top[1] === 'name') name = top[2].trim();
      continue;
    }
    const nested = /^\s{2,}binding:\s*(.+?)\s*$/.exec(line);
    if (nested) { binding = nested[1]; inDesc = false; continue; }
    if (inDesc && /^\s+\S/.test(line)) desc.push(line.trim());
    else if (line.trim()) inDesc = false;
  }
  const headings = (body.match(/^#{1,6}\s/gm) || []).length;
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  return { name, description: desc.join(' ').replace(/\s+/g, ' ').trim(), binding, headings, words };
}

/** What the registry will call the next publish: it bumps the patch, or starts at 1.0.0. */
function nextVersion(current) {
  const m = String(current || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.0';
}

/** The day a skill last changed, short; the hour is noise in a column of forty-seven. */
function day(iso) {
  if (!iso) return '';
  try { return fmtDate(iso, { day: 'numeric', month: 'short' }); }
  catch { return String(iso).slice(0, 10); }
}

/** The same day written out, for the one place there is room for it. */
function fullDay(iso) {
  if (!iso) return '';
  try { return fmtDate(iso, { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return String(iso).slice(0, 10); }
}

function daysSince(iso) {
  if (!iso) return Infinity;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : Infinity;
}

/** How long ago, in words. "0 days ago" is not something a person says. */
function sinceWords(iso) {
  const n = daysSince(iso);
  if (!Number.isFinite(n)) return '';
  if (n < 1) return S('today');
  if (n === 1) return S('yesterday');
  return S('daysAgo', { n: num(n) });
}

/**
 * The file names a skill carries. The manifest gives them as `{ path, size }` entries; older
 * records and the fileContents map give bare strings, and both reach this page.
 */
function fileNames(skill) {
  const files = skill.files?.length ? skill.files : Object.keys(skill.fileContents || { 'SKILL.md': '' });
  return files.map(f => (typeof f === 'string' ? f : f?.path ?? f?.name ?? '')).filter(Boolean);
}

export default function SkillsAdminTab() {
  const [msg, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [find, setFind] = useState('');
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);           // the opened skill, resolved
  const [editing, setEditing] = useState(null);     // { md, visibility, was } while writing
  const [busy, setBusy] = useState(false);

  // useToast returns fresh function identities every render — keep them out of the deps or the
  // load effect re-fires forever.
  const showErrRef = useRef(showErr);
  showErrRef.current = showErr;
  const load = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      setSkills(await skillsService.listScope('node'));
    } catch (err) {
      showErrRef.current(S('loadFailed') + ': ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => onLiveUpdate(['skills'], () => loadRef.current({ showSpinner: false })), []);

  const m = useMemo(() => ({
    total: skills.length,
    here: skills.filter(s => !s.builtin).length,
    fromBuild: skills.filter(s => s.builtin).length,
    open: skills.filter(s => s.visibility === 'public').length,
    stale: skills.filter(s => daysSince(s.updatedAt) > STALE_DAYS).length,
  }), [skills]);

  const openSkill = async (skill) => {
    try {
      const full = await skillsService.getSkill(skill.name, { scope: 'node' });
      setOpen({ ...skill, ...full });
    } catch (err) { showErr(S('loadFailed') + ': ' + err.message); }
  };

  const startEdit = async (skill) => {
    try {
      const full = await skillsService.getSkill(skill.name, { scope: 'node' });
      setEditing({
        md: full?.fileContents?.['SKILL.md'] ?? NODE_SKILL_TEMPLATE,
        visibility: skill.visibility === 'public' ? 'public' : 'members',
        was: { name: skill.name, version: skill.version },
      });
      setOpen(null);
    } catch (err) { showErr(S('loadFailed') + ': ' + err.message); }
  };

  const startNew = () => {
    setOpen(null);
    setEditing({ md: NODE_SKILL_TEMPLATE, visibility: 'members', was: null });
  };

  const publish = async () => {
    setBusy(true);
    try {
      const skill = await skillsService.publishSkill({
        skillMd: editing.md, scope: 'node', visibility: editing.visibility,
      });
      showOk(S('publishOk', { name: skill?.name ?? '' }));
      setEditing(null);
      await load({ showSpinner: false });
    } catch (err) {
      showErr(S('publishFailed') + ': ' + err.message);
    } finally { setBusy(false); }
  };

  const setVisibility = async (skill, visibility) => {
    setBusy(true);
    try {
      await skillsService.setSkillVisibility(skill.name, 'node', visibility);
      if (open) setOpen({ ...open, visibility });
      await load({ showSpinner: false });
    } catch (err) {
      showErr(S('visibilityFailed') + ': ' + err.message);
    } finally { setBusy(false); }
  };

  const download = async (skill) => {
    try { await skillsService.downloadSkillZip(skill.name, { scope: 'node' }); }
    catch (err) { showErr(S('downloadFailed') + ': ' + err.message); }
  };

  const remove = (skill) => confirm(
    skill.builtin ? S('deleteAskBuiltin', { name: skill.name }) : S('deleteAsk', { name: skill.name }),
    async () => {
      try {
        await skillsService.deleteSkill(skill.name, 'node');
        showOk(S('deletedOk', { name: skill.name }));
        setOpen(null);
        await load({ showSpinner: false });
      } catch (err) { showErr(S('deleteFailed') + ': ' + err.message); }
    }, { danger: true });

  const shown = skills.filter(s => {
    if (filter === 'here' && s.builtin) return false;
    if (filter === 'build' && !s.builtin) return false;
    if (filter === 'open' && s.visibility !== 'public') return false;
    if (filter === 'stale' && daysSince(s.updatedAt) <= STALE_DAYS) return false;
    const q = find.trim().toLowerCase();
    if (!q) return true;
    return [s.name, s.description, s.binding].some(v => String(v || '').toLowerCase().includes(q));
  });

  const toast = msg && html`<${Toast} type=${msg.type} text=${msg.text} onDismiss=${clearToast} />`;

  if (editing) {
    return html`<${Fragment}>${toast}
      <${Write} editing=${editing} setEditing=${setEditing} skills=${skills}
        onPublish=${publish} busy=${busy} />
      <${ConfirmUI} /><//>`;
  }

  if (open) {
    return html`<${Fragment}>${toast}
      <${Open} skill=${open} onBack=${() => setOpen(null)} onEdit=${() => startEdit(open)}
        onDownload=${() => download(open)} onDelete=${() => remove(open)}
        onVisibility=${(v) => setVisibility(open, v)} busy=${busy} />
      <${ConfirmUI} /><//>`;
  }

  /** The skill's tags: where it came from, public, the app it teaches, retired. */
  const marksOf = (s) => html`
    <${Mark}>${s.builtin ? S('markBuild') : S('markHere')}<//>
    ${s.visibility === 'public' && html`<${Mark} tone="coral">${S('markPublic')}<//>`}
    ${bindingFile(s) && html`<${Mark} tone="ink">${S('markTeaches', { app: bindingFile(s).replace(/\.html$/, '') })}<//>`}
    ${s.supersededBy && html`<${Mark} tone="coral">${S('markRetired')}<//>`}`;

  return html`
    <${Fragment}>
      ${toast}

      <${FigureStrip} lead wrap items=${[
        { n: num(m.total), label: S('cntAll'), sub: S('cntAllSub') },
        { n: num(m.here), label: S('cntHere'), sub: S('cntHereSub') },
        { n: num(m.fromBuild), label: S('cntBuild'), sub: S('cntBuildSub') },
        { n: num(m.open), label: S('cntOpen'), sub: S('cntOpenSub') },
      ]} />

      <${Section} first num="01" title=${S('title')}
        doors=${html`<${Loud} control onClick=${startNew}>${S('write')}<//>`}>

        <${Columns}>
          <${Stack}>
            <${Label} block>${S('heroLabel')}<//>
            <${Figure} n=${S('hero', { n: num(m.open), total: num(m.total) })} />
            <${Note}>${S('heroSub', { total: num(m.total) })}<//>
          <//>
          <${Note} kind="lead">${m.here === 0
    ? S('leadAllBuild', { build: num(m.fromBuild) })
    : S('lead', { build: num(m.fromBuild), here: num(m.here) })}<//>
        <//>

        ${loading ? html`<${Spinner} />` : skills.length === 0
    ? html`<${Note} kind="quiet">${S('empty')}<//>`
    : html`
          <${Space} above="section">
            <${SearchLine} text value=${find} onInput=${e => setFind(e.target.value)} placeholder=${S('findPlaceholder')} />
            <${Tabs} tone="filter" value=${filter} onSelect=${setFilter} items=${[
              { value: 'all', label: S('chipAll', { n: num(m.total) }) },
              { value: 'here', label: S('chipHere', { n: num(m.here) }) },
              { value: 'build', label: S('chipBuild', { n: num(m.fromBuild) }) },
              { value: 'open', label: S('chipOpen', { n: num(m.open) }) },
              { value: 'stale', label: S('chipStale', { n: num(m.stale), days: STALE_DAYS }) },
            ]} />
          <//>

          <${List} cols="name-tags-when-doors">
            ${shown.map(s => html`
              <${Row} key=${s.ref} hover below=${html`<${Desc} lines=${2}>${s.description}<//>`}>
                <${Name} after=${html` <${Note} kind="meta" inline mono>v${s.version}<//>`}>${s.name}<//>
                <${Cell} line>${marksOf(s)}<//>
                <${When}>${day(s.updatedAt)}<//>
                <${Doors}>
                  <${Action} small onClick=${() => openSkill(s)}>${S('openIt')}<//>
                  <${Action} small onClick=${() => startEdit(s)}>${S('edit')}<//>
                  <${Action} small tone="quiet" onClick=${() => remove(s)}>${S('delete')}<//>
                <//>
              <//>`)}
          <//>

          <${More} note=${S('shown', { n: num(shown.length), total: num(m.total) })}>
            ${m.stale > 0 && html`<${Note} kind="meta" inline>${S('staleNote', { n: num(m.stale), days: STALE_DAYS })}<//>`}
          <//>
        `}
      <//>

      <${ConfirmUI} />
    <//>`;
}

/* ── One skill open ──────────────────────────────────────────────────────────────────────────── */

function Open({ skill, onBack, onEdit, onDownload, onDelete, onVisibility, busy }) {
  const { body } = splitSkillMd(skill.fileContents?.['SKILL.md']);
  const app = bindingFile(skill);
  const files = fileNames(skill);
  const isPublic = skill.visibility === 'public';

  const facts = html`<${Stack}>
    <${Facts} flush rows=${[
      { k: S('factFrom'), v: skill.builtin ? S('markBuild') : S('markHere'), sub: skill.builtin ? S('factFromBuildWhy') : S('factFromHereWhy') },
      { k: S('factWhoReads'), v: html`<${Mark} tone="sun">${isPublic ? S('visPublic') : S('visMembers')}<//>`,
        action: html`<${Action} small soft disabled=${busy} onClick=${() => onVisibility(isPublic ? 'members' : 'public')}>
          ${isPublic ? S('makeMembers') : S('makePublic')}<//>`, sub: S('factWhoReadsWhy') },
      { k: S('factChanged'), v: fullDay(skill.updatedAt), sub: sinceWords(skill.updatedAt) },
      { k: S('factTeaches'), v: app ? app : S('factTeachesNothing'), sub: app ? S('factTeachesWhy') : S('factTeachesNothingWhy') },
      { k: S('factFiles'), v: files.join(', '), mono: true, sub: files.length === 1 ? S('factFilesOneWhy') : undefined },
      skill.license && { k: S('factLicence'), v: skill.license },
    ]} />
    <${Note}>${S('editNote')}<//>
  <//>`;

  return html`
    <${Fragment}>
      <${Crumb} steps=${[{ label: S('title'), onClick: onBack }, skill.name]} />

      <${PageHead} title=${skill.name} sub=${`v${skill.version} · ${skill.ref}`} actions=${html`
        <${Actions}>
          <${Action} small onClick=${onEdit}>${S('edit')}<//>
          <${Action} small onClick=${onDownload}>${S('download')}<//>
          <${Action} small tone="quiet" onClick=${onDelete}>${S('delete')}<//>
        <//>`} />

      <${Beside} narrow side=${facts}>
        <${Note} kind="lead">${skill.description}<//>
        <${Label} block>${S('whatItReads')}<//>
        <${Markdown} text=${body} small />
      <//>
    <//>`;
}

/* ── Writing one ─────────────────────────────────────────────────────────────────────────────── */

function Write({ editing, setEditing, skills, onPublish, busy }) {
  const fm = frontmatterOf(editing.md);
  const existing = skills.find(s => s.name === fm.name);
  const replaces = editing.was && editing.was.name === fm.name;
  const forks = editing.was && editing.was.name !== fm.name;

  /** A warning said out loud: its title on a line of its own, then what it means. */
  const warn = (title, words) => html`<${Note} kind="aside"><${SubHeading}>${title}<//>${words}<//>`;

  const side = html`<${Stack} gap="large">
    <${Box} tone="dim">
      <${Label} block>${S('saysItIs')}<//>
      <${Facts} flush rows=${[
        { k: S('prevName'), v: fm.name || S('prevNoName'), mono: true },
        { k: S('prevVersion'), v: html`<${Code}>v${nextVersion(existing?.version)}<//>${existing ? ' · ' + S('prevWas', { v: existing.version }) : ' · ' + S('prevFirst')}` },
        { k: S('factTeaches'), v: fm.binding ? fm.binding.split('/').pop() : S('factTeachesNothing') },
        { k: S('prevBody'), v: S('prevBodyIs', { headings: num(fm.headings), words: num(fm.words) }) },
      ]} />
    <//>

    ${!fm.name && warn(S('warnNoNameTitle'), S('warnNoName'))}
    ${replaces && warn(S('warnReplaceTitle'), S('warnReplace', { name: fm.name }))}
    ${forks && warn(S('warnForkTitle'), S('warnFork', { was: editing.was.name, now: fm.name }))}
    ${!editing.was && fm.name && existing && warn(S('warnTakenTitle'), S('warnTaken', { name: fm.name }))}

    <${Choice} boxed cols=${2} label=${S('whoMayRead')} value=${editing.visibility}
      onChange=${(v) => setEditing({ ...editing, visibility: v })}
      options=${[
        { value: 'members', label: S('visMembers'), hint: S('visMembersWhy') },
        { value: 'public', label: S('visPublic'), hint: S('visPublicWhy') },
      ]} />
  <//>`;

  return html`
    <${Section} first num="02" title=${editing.was ? S('editTitle', { name: editing.was.name }) : S('writeTitle')}
      doors=${html`<${Action} small onClick=${() => setEditing(null)}>${t('common.cancel')}<//>`}>
      <${Note} kind="lead">${S('writeLead')}<//>

      <${Beside} wide side=${side}>
        <${TextArea} code rows=${22} label=${S('theFile')} value=${editing.md}
          onInput=${(v) => setEditing({ ...editing, md: v })} />
        <${Actions}>
          <${Loud} control disabled=${busy || !fm.name} onClick=${onPublish}>
            ${busy ? t('common.loading') : S('publishIt')}
          <//>
          <${Note} kind="hint" slab inline>${S('publishHint')}<//>
        <//>
      <//>
    <//>`;
}
