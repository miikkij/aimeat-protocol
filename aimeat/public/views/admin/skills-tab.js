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
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: the numeral band, the toolbar
 *     with its five filters, skills as list rows, facts as key-value rows, the trail as shared
 *     crumbs, warnings as asides and who-may-read as boxed radio choices. The page's sheet is gone.
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
import { h } from 'preact';
import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { num, Spinner, useToast, Toast } from './shared.js';
import { Markdown } from '/components/Markdown.js';
import { splitSkillMd, bindingFile } from '/views/profile/skills/frame.js';
import { useConfirm } from '/components/Modal.js';
import { Section, Columns, Stack, ListRow, KeyValue, Toolbar, Field, NumeralBand, Crumbs, Chip, Action, Surface, Text } from '/components/poster-parts.js';
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
    return html`<${Stack}>${toast}
      <${Write} editing=${editing} setEditing=${setEditing} skills=${skills}
        onPublish=${publish} busy=${busy} />
      <${ConfirmUI} /><//>`;
  }

  if (open) {
    return html`<${Stack}>${toast}
      <${Open} skill=${open} onBack=${() => setOpen(null)} onEdit=${() => startEdit(open)}
        onDownload=${() => download(open)} onDelete=${() => remove(open)}
        onVisibility=${(v) => setVisibility(open, v)} busy=${busy} />
      <${ConfirmUI} /><//>`;
  }

  const chip = (key, label) => ({ id: key, label, selected: filter === key, onClick: () => setFilter(key) });

  return html`<${Stack}>
    ${toast}

    <${NumeralBand} tone="plain" items=${[
      { label: S('cntAll'), value: num(m.total), note: S('cntAllSub') },
      { label: S('cntHere'), value: num(m.here), note: S('cntHereSub') },
      { label: S('cntBuild'), value: num(m.fromBuild), note: S('cntBuildSub') },
      { label: S('cntOpen'), value: num(m.open), note: S('cntOpenSub') },
    ]} />

    <${Section} title=${S('title')} count="01"
      actions=${html`<${Action} kind="primary" onClick=${startNew}>${S('write')}<//>`}>
      <${Stack}>
        <${Columns} collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="label">${S('heroLabel')}<//>
            <${Text} kind="number">${S('hero', { n: num(m.open), total: num(m.total) })}<//>
            <${Text} kind="caption" tone="muted">${S('heroSub', { total: num(m.total) })}<//>
          <//>
          <${Text} kind="lead">${m.here === 0
            ? S('leadAllBuild', { build: num(m.fromBuild) })
            : S('lead', { build: num(m.fromBuild), here: num(m.here) })}<//>
        <//>

        ${loading ? html`<${Spinner} />` : skills.length === 0
          ? html`<${Text} tone="muted">${S('empty')}<//>`
          : html`
            <${Toolbar}
              search=${{ ariaLabel: S('findPlaceholder'), placeholder: S('findPlaceholder'), value: find, onInput: e => setFind(e.target.value) }}
              filters=${[
                chip('all', S('chipAll', { n: num(m.total) })),
                chip('here', S('chipHere', { n: num(m.here) })),
                chip('build', S('chipBuild', { n: num(m.fromBuild) })),
                chip('open', S('chipOpen', { n: num(m.open) })),
                chip('stale', S('chipStale', { n: num(m.stale), days: STALE_DAYS })),
              ]} />

            <div>
              ${shown.map(s => html`<${ListRow} key=${s.ref} name=${s.name} onOpen=${() => openSkill(s)}
                detail=${s.description} preview=${true}
                value=${html`<${Stack} direction="wrap" align="end" density="compact">
                  <${Text} kind="mono" tone="muted">v${s.version} · ${day(s.updatedAt)}<//>
                  <${Chip} tone="muted">${s.builtin ? S('markBuild') : S('markHere')}<//>
                  ${s.visibility === 'public' && html`<${Chip} tone="sun">${S('markPublic')}<//>`}
                  ${bindingFile(s) && html`<${Chip}>${S('markTeaches', { app: bindingFile(s).replace(/\.html$/, '') })}<//>`}
                  ${s.supersededBy && html`<${Chip} tone="coral">${S('markRetired')}<//>`}
                <//>`}
                actions=${html`
                  <${Action} onClick=${() => openSkill(s)}>${S('openIt')}<//>
                  <${Action} onClick=${() => startEdit(s)}>${S('edit')}<//>
                  <${Action} tone="danger" onClick=${() => remove(s)}>${S('delete')}<//>`} />`)}
            </div>

            <${Stack} direction="wrap" align="between">
              <${Text} kind="mono" tone="muted">${S('shown', { n: num(shown.length), total: num(m.total) })}<//>
              ${m.stale > 0 && html`<${Text} kind="caption" tone="muted">${S('staleNote', { n: num(m.stale), days: STALE_DAYS })}<//>`}
            <//>
          `}
      <//>
    <//>

    <${ConfirmUI} />
  <//>`;
}

/** One fact about a skill: the label, the value, and a quiet line under it. */
const fact = (label, value, note) => html`<${KeyValue} label=${label}><${Stack} density="compact">
  <span>${value}</span>${note && html`<${Text} kind="caption" tone="muted">${note}<//>`}<//><//>`;

/* ── One skill open ──────────────────────────────────────────────────────────────────────────── */

function Open({ skill, onBack, onEdit, onDownload, onDelete, onVisibility, busy }) {
  const { body } = splitSkillMd(skill.fileContents?.['SKILL.md']);
  const app = bindingFile(skill);
  const files = fileNames(skill);
  const isPublic = skill.visibility === 'public';

  return html`<${Stack}>
    <${Crumbs} items=${[{ label: S('title'), onClick: onBack }, { label: skill.name }]} />

    <${Stack} direction="wrap" align="between">
      <${Stack} density="compact">
        <${Text} kind="heading">${skill.name}<//>
        <${Text} kind="mono" tone="muted">v${skill.version} · ${skill.ref}<//>
      <//>
      <${Stack} direction="wrap">
        <${Action} onClick=${onEdit}>${S('edit')}<//>
        <${Action} onClick=${onDownload}>${S('download')}<//>
        <${Action} tone="danger" onClick=${onDelete}>${S('delete')}<//>
      <//>
    <//>

    <${Columns} layout="leading" collapse=${900}>
      <${Stack}>
        <${Text} kind="lead">${skill.description}<//>
        <${Text} kind="label">${S('whatItReads')}<//>
        <${Surface} kind="box"><${Markdown} text=${body} /><//>
      <//>

      <${Stack}>
        <div>
          ${fact(S('factFrom'), skill.builtin ? S('markBuild') : S('markHere'), skill.builtin ? S('factFromBuildWhy') : S('factFromHereWhy'))}
          ${fact(S('factWhoReads'), html`<${Stack} direction="wrap" align="center" density="compact">
            <strong>${isPublic ? S('visPublic') : S('visMembers')}</strong>
            <${Action} kind="text" disabled=${busy} onClick=${() => onVisibility(isPublic ? 'members' : 'public')}>
              ${isPublic ? S('makeMembers') : S('makePublic')}<//>
          <//>`, S('factWhoReadsWhy'))}
          ${fact(S('factChanged'), fullDay(skill.updatedAt), sinceWords(skill.updatedAt))}
          ${fact(S('factTeaches'), app ? app : S('factTeachesNothing'), app ? S('factTeachesWhy') : S('factTeachesNothingWhy'))}
          ${fact(S('factFiles'), html`<${Text} kind="mono">${files.join(', ')}<//>`, files.length === 1 ? S('factFilesOneWhy') : '')}
          ${skill.license && fact(S('factLicence'), skill.license)}
        </div>
        <${Text} kind="caption" tone="muted">${S('editNote')}<//>
      <//>
    <//>
  <//>`;
}

/* ── Writing one ─────────────────────────────────────────────────────────────────────────────── */

function Write({ editing, setEditing, skills, onPublish, busy }) {
  const fm = frontmatterOf(editing.md);
  const existing = skills.find(s => s.name === fm.name);
  const replaces = editing.was && editing.was.name === fm.name;
  const forks = editing.was && editing.was.name !== fm.name;
  const warn = (title, text) => html`<${Surface} kind="aside"><${Stack} density="compact">
    <${Text} kind="label">${title}<//><${Text}>${text}<//>
  <//><//>`;

  return html`<${Section} title=${editing.was ? S('editTitle', { name: editing.was.name }) : S('writeTitle')} count="02"
    description=${S('writeLead')} actions=${html`<${Action} onClick=${() => setEditing(null)}>${t('common.cancel')}<//>`}>
    <${Columns} layout="leading" collapse=${900}>
      <${Stack}>
        <${Field} type="textarea" rows=${22} label=${S('theFile')} value=${editing.md} spellCheck=${false}
          onInput=${e => setEditing({ ...editing, md: e.target.value })} />
        <${Stack} direction="wrap" align="center">
          <${Action} kind="primary" disabled=${busy || !fm.name} onClick=${onPublish}>
            ${busy ? t('common.loading') : S('publishIt')}<//>
          <${Text} kind="caption" tone="muted">${S('publishHint')}<//>
        <//>
      <//>

      <${Stack}>
        <${Surface} kind="box"><${Stack} density="compact">
          <${Text} kind="label">${S('saysItIs')}<//>
          <div>
            <${KeyValue} label=${S('prevName')}><strong>${fm.name || S('prevNoName')}</strong><//>
            <${KeyValue} label=${S('prevVersion')}><span><strong>v${nextVersion(existing?.version)}</strong>${existing ? ' · ' + S('prevWas', { v: existing.version }) : ' · ' + S('prevFirst')}</span><//>
            <${KeyValue} label=${S('factTeaches')} value=${fm.binding ? fm.binding.split('/').pop() : S('factTeachesNothing')} />
            <${KeyValue} label=${S('prevBody')} value=${S('prevBodyIs', { headings: num(fm.headings), words: num(fm.words) })} />
          </div>
        <//><//>

        ${!fm.name && warn(S('warnNoNameTitle'), S('warnNoName'))}
        ${replaces && warn(S('warnReplaceTitle'), S('warnReplace', { name: fm.name }))}
        ${forks && warn(S('warnForkTitle'), S('warnFork', { was: editing.was.name, now: fm.name }))}
        ${!editing.was && fm.name && existing && warn(S('warnTakenTitle'), S('warnTaken', { name: fm.name }))}

        <${Stack} density="compact">
          <${Text} kind="label">${S('whoMayRead')}<//>
          <${Stack} role="radiogroup" label=${S('whoMayRead')} density="compact">
            <${Action} kind="choice" semantics="radio" selected=${editing.visibility === 'members'} title=${S('visMembers')}
              onClick=${() => setEditing({ ...editing, visibility: 'members' })}>${S('visMembersWhy')}<//>
            <${Action} kind="choice" semantics="radio" selected=${editing.visibility === 'public'} title=${S('visPublic')}
              onClick=${() => setEditing({ ...editing, visibility: 'public' })}>${S('visPublicWhy')}<//>
          <//>
        <//>
      <//>
    <//>
  <//>`;
}
