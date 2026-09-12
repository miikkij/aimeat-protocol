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
import { useViewCSS } from '/components/useViewCSS.js';
import { num, Spinner, useToast, Toast } from './shared.js';
import { Markdown } from '/components/Markdown.js';
import { splitSkillMd, bindingFile } from '/views/profile/skills/frame.js';
import { useConfirm } from '/components/Modal.js';
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
  useViewCSS('/css/views/admin-skills.css');
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
    return html`<div class="og adm-sk">${toast}
      <${Write} editing=${editing} setEditing=${setEditing} skills=${skills}
        onPublish=${publish} busy=${busy} />
      <${ConfirmUI} /></div>`;
  }

  if (open) {
    return html`<div class="og adm-sk">${toast}
      <${Open} skill=${open} onBack=${() => setOpen(null)} onEdit=${() => startEdit(open)}
        onDownload=${() => download(open)} onDelete=${() => remove(open)}
        onVisibility=${(v) => setVisibility(open, v)} busy=${busy} />
      <${ConfirmUI} /></div>`;
  }

  const chip = (key, label) => html`
    <button type="button" class="adm-sk-chip ${filter === key ? 'on' : ''}"
      onClick=${() => setFilter(key)}>${label}</button>`;

  return html`
    <div class="og adm-sk">
      ${toast}

      <div class="og-strip">
        <div><b>${num(m.total)}</b><span>${S('cntAll')}</span><small>${S('cntAllSub')}</small></div>
        <div><b>${num(m.here)}</b><span>${S('cntHere')}</span><small>${S('cntHereSub')}</small></div>
        <div><b>${num(m.fromBuild)}</b><span>${S('cntBuild')}</span><small>${S('cntBuildSub')}</small></div>
        <div><b>${num(m.open)}</b><span>${S('cntOpen')}</span><small>${S('cntOpenSub')}</small></div>
      </div>

      <section class="og-sec og-sec--first">
        <div class="og-sec-h">
          <h2>${S('title')}<small>01</small></h2>
          <button type="button" class="adm-btn" onClick=${startNew}>${S('write')}</button>
        </div>

        <div class="adm-sk-top">
          <div>
            <div class="adm-sk-lbl">${S('heroLabel')}</div>
            <div class="adm-sk-hero">${S('hero', { n: num(m.open), total: num(m.total) })}</div>
            <p class="adm-sk-hero-sub">${S('heroSub', { total: num(m.total) })}</p>
          </div>
          <div><p class="adm-sk-lead">${m.here === 0
    ? S('leadAllBuild', { build: num(m.fromBuild) })
    : S('lead', { build: num(m.fromBuild), here: num(m.here) })}</p></div>
        </div>

        ${loading ? html`<${Spinner} />` : skills.length === 0
    ? html`<p class="adm-sk-note">${S('empty')}</p>`
    : html`
          <div class="adm-sk-tools">
            <div class="adm-sk-find">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="M16 16 L21 21"></path></svg>
              <input type="text" value=${find} onInput=${e => setFind(e.target.value)} placeholder=${S('findPlaceholder')} />
            </div>
            <div class="adm-sk-chips">
              ${chip('all', S('chipAll', { n: num(m.total) }))}
              ${chip('here', S('chipHere', { n: num(m.here) }))}
              ${chip('build', S('chipBuild', { n: num(m.fromBuild) }))}
              ${chip('open', S('chipOpen', { n: num(m.open) }))}
              ${chip('stale', S('chipStale', { n: num(m.stale), days: STALE_DAYS }))}
            </div>
          </div>

          <div class="adm-sk-rows">
            ${shown.map(s => html`
              <div class="adm-sk-row" key=${s.ref}>
                <div class="adm-sk-rtop">
                  <span class="adm-sk-name">${s.name}<i>v${s.version}</i></span>
                  <span class="adm-sk-marks">
                    <span class="adm-sk-mark">${s.builtin ? S('markBuild') : S('markHere')}</span>
                    ${s.visibility === 'public' && html`<span class="adm-sk-mark is-open">${S('markPublic')}</span>`}
                    ${bindingFile(s) && html`<span class="adm-sk-mark is-app">${S('markTeaches', { app: bindingFile(s).replace(/\.html$/, '') })}</span>`}
                    ${s.supersededBy && html`<span class="adm-sk-mark is-open">${S('markRetired')}</span>`}
                  </span>
                  <span class="adm-sk-when">${day(s.updatedAt)}</span>
                  <span class="adm-sk-doors">
                    <button type="button" class="adm-sk-door" onClick=${() => openSkill(s)}>${S('openIt')}</button>
                    <button type="button" class="adm-sk-door" onClick=${() => startEdit(s)}>${S('edit')}</button>
                    <button type="button" class="adm-sk-door is-quiet" onClick=${() => remove(s)}>${S('delete')}</button>
                  </span>
                </div>
                <p class="adm-sk-desc">${s.description}</p>
              </div>`)}
          </div>

          <div class="adm-sk-foot">
            <span>${S('shown', { n: num(shown.length), total: num(m.total) })}</span>
            ${m.stale > 0 && html`<span>${S('staleNote', { n: num(m.stale), days: STALE_DAYS })}</span>`}
          </div>
        `}
      </section>

      <${ConfirmUI} />
    </div>`;
}

/* ── One skill open ──────────────────────────────────────────────────────────────────────────── */

function Open({ skill, onBack, onEdit, onDownload, onDelete, onVisibility, busy }) {
  const { body } = splitSkillMd(skill.fileContents?.['SKILL.md']);
  const app = bindingFile(skill);
  const files = fileNames(skill);
  const isPublic = skill.visibility === 'public';

  return html`
    <div class="adm-sk-page">
      <div class="adm-sk-crumb">
        <button type="button" onClick=${onBack}>${S('title')}</button> · ${skill.name}
      </div>

      <div class="adm-sk-head">
        <h2>${skill.name}<i>v${skill.version} · ${skill.ref}</i></h2>
        <div class="adm-sk-doors">
          <button type="button" class="adm-sk-door" onClick=${onEdit}>${S('edit')}</button>
          <button type="button" class="adm-sk-door" onClick=${onDownload}>${S('download')}</button>
          <button type="button" class="adm-sk-door is-quiet" onClick=${onDelete}>${S('delete')}</button>
        </div>
      </div>

      <div class="adm-sk-two">
        <div>
          <p class="adm-sk-what">${skill.description}</p>
          <div class="adm-sk-bodyhead">${S('whatItReads')}</div>
          <div class="adm-sk-md"><${Markdown} text=${body} /></div>
        </div>

        <div>
          <dl class="adm-sk-facts">
            <div class="adm-sk-fact">
              <dt>${S('factFrom')}</dt>
              <dd>${skill.builtin ? S('markBuild') : S('markHere')}
                <em>${skill.builtin ? S('factFromBuildWhy') : S('factFromHereWhy')}</em></dd>
            </div>
            <div class="adm-sk-fact">
              <dt>${S('factWhoReads')}</dt>
              <dd>
                <span class="adm-sk-vis">
                  <span class="adm-sk-visnow">${isPublic ? S('visPublic') : S('visMembers')}</span>
                  <button type="button" class="adm-sk-visgo" disabled=${busy}
                    onClick=${() => onVisibility(isPublic ? 'members' : 'public')}>
                    ${isPublic ? S('makeMembers') : S('makePublic')}
                  </button>
                </span>
                <em>${S('factWhoReadsWhy')}</em></dd>
            </div>
            <div class="adm-sk-fact">
              <dt>${S('factChanged')}</dt>
              <dd>${fullDay(skill.updatedAt)}<em>${sinceWords(skill.updatedAt)}</em></dd>
            </div>
            <div class="adm-sk-fact">
              <dt>${S('factTeaches')}</dt>
              <dd>${app ? app : S('factTeachesNothing')}
                <em>${app ? S('factTeachesWhy') : S('factTeachesNothingWhy')}</em></dd>
            </div>
            <div class="adm-sk-fact">
              <dt>${S('factFiles')}</dt>
              <dd><code>${files.join(', ')}</code>
                ${files.length === 1 && html`<em>${S('factFilesOneWhy')}</em>`}</dd>
            </div>
            ${skill.license && html`
              <div class="adm-sk-fact"><dt>${S('factLicence')}</dt><dd>${skill.license}</dd></div>`}
          </dl>
          <p class="adm-sk-note">${S('editNote')}</p>
        </div>
      </div>
    </div>`;
}

/* ── Writing one ─────────────────────────────────────────────────────────────────────────────── */

function Write({ editing, setEditing, skills, onPublish, busy }) {
  const fm = frontmatterOf(editing.md);
  const existing = skills.find(s => s.name === fm.name);
  const replaces = editing.was && editing.was.name === fm.name;
  const forks = editing.was && editing.was.name !== fm.name;

  return html`
    <div class="adm-sk-page">
      <div class="adm-sk-head">
        <h2>${editing.was ? S('editTitle', { name: editing.was.name }) : S('writeTitle')}<small>02</small></h2>
        <button type="button" class="adm-sk-door" onClick=${() => setEditing(null)}>${t('common.cancel')}</button>
      </div>
      <p class="adm-sk-lead">${S('writeLead')}</p>

      <div class="adm-sk-two adm-sk-two--write">
        <div>
          <div class="adm-sk-lbl">${S('theFile')}</div>
          <textarea class="adm-sk-editor" rows="22" value=${editing.md}
            onInput=${e => setEditing({ ...editing, md: e.target.value })}></textarea>
          <div class="adm-sk-act">
            <button class="adm-btn" disabled=${busy || !fm.name} onClick=${onPublish}>
              ${busy ? t('common.loading') : S('publishIt')}
            </button>
            <span class="adm-sk-hint">${S('publishHint')}</span>
          </div>
        </div>

        <div>
          <div class="adm-sk-prev">
            <div class="adm-sk-prev-l">${S('saysItIs')}</div>
            <dl>
              <div class="adm-sk-prow"><dt>${S('prevName')}</dt>
                <dd><b>${fm.name || S('prevNoName')}</b></dd></div>
              <div class="adm-sk-prow"><dt>${S('prevVersion')}</dt>
                <dd><b>v${nextVersion(existing?.version)}</b>${existing ? ' · ' + S('prevWas', { v: existing.version }) : ' · ' + S('prevFirst')}</dd></div>
              <div class="adm-sk-prow"><dt>${S('factTeaches')}</dt>
                <dd>${fm.binding ? fm.binding.split('/').pop() : S('factTeachesNothing')}</dd></div>
              <div class="adm-sk-prow"><dt>${S('prevBody')}</dt>
                <dd>${S('prevBodyIs', { headings: num(fm.headings), words: num(fm.words) })}</dd></div>
            </dl>
          </div>

          ${!fm.name && html`<div class="adm-sk-warn"><b>${S('warnNoNameTitle')}</b>${S('warnNoName')}</div>`}
          ${replaces && html`<div class="adm-sk-warn"><b>${S('warnReplaceTitle')}</b>${S('warnReplace', { name: fm.name })}</div>`}
          ${forks && html`<div class="adm-sk-warn"><b>${S('warnForkTitle')}</b>${S('warnFork', { was: editing.was.name, now: fm.name })}</div>`}
          ${!editing.was && fm.name && existing && html`<div class="adm-sk-warn"><b>${S('warnTakenTitle')}</b>${S('warnTaken', { name: fm.name })}</div>`}

          <div class="adm-sk-field">
            <div class="adm-sk-lbl">${S('whoMayRead')}</div>
            <div class="adm-sk-choice">
              <button type="button" class="adm-sk-opt ${editing.visibility === 'members' ? 'on' : ''}"
                onClick=${() => setEditing({ ...editing, visibility: 'members' })}>
                <b>${S('visMembers')}</b>${S('visMembersWhy')}</button>
              <button type="button" class="adm-sk-opt ${editing.visibility === 'public' ? 'on' : ''}"
                onClick=${() => setEditing({ ...editing, visibility: 'public' })}>
                <b>${S('visPublic')}</b>${S('visPublicWhy')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}
