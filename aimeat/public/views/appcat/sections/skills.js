/**
 * @file public/views/appcat/sections/skills.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The detail section "Skills for this app" (features F318, routes F213–F215): the skills
 *   bound to this app (GET /v1/apps/{owner}/{file}/skills), each with its ref, version and
 *   description. On the person's own published app a user-scope skill has the × that detaches it, and
 *   "+ Attach skill" opens a picker of the person's own skills not yet bound here. A binding lives in
 *   the SKILL's frontmatter (metadata.binding: app:{owner}/{filename}); attaching and detaching
 *   rewrite it and republish the skill with its files (js/services/skills.js setSkillBinding, the same
 *   rewrite the old catalogue carried a copy of). Shown for any published app. The shell draws the
 *   chapter line and the headline from `meta`; this is the body.
 * @structure meta · SkillsSection({ d }) · Attach({ d, bound, onDone })
 * @usage const mod = await import('./sections/skills.js'); html`<${mod.default} d=${d} />`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Parity pass (sections-b): the skills as the old .dtl-skill rows (List tone
 *     "entries": ref, version and the faint × on one line, the words under), the small quiet lines, the
 *     picker's door row 8px apart with the old underlined choice (Select line), its status line in the
 *     old colours; every press redraws the picker with an empty status line; a change to the bound
 *     list reads the person's skills again (the old page left "…" standing until pressed twice).
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's detailLoadSkills and the attach picker
 *     (js/detail.js) on components (appcat detail builder B).
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { Action, Actions, Loud, Icon } from '/components/Action.js';
import { List, Row, Name } from '/components/List.js';
import { Note } from '/components/Note.js';
import { Mark } from '/components/Mark.js';
import { Select } from '/components/Select.js';
import { Space } from '/components/Layout.js';
import { listAppSkills, listScope, setSkillBinding } from '/js/services/skills.js';
import { x } from '/views/appcat/i18n.js';
import { errorText, noticeKind } from '/views/appcat/sections/app-write.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

export const meta = { id: 'skills', title: 'detail.skills', show: (d) => !!(d && d.app) };

/** The picker of the person's own skills not yet bound to this app, and the act that binds one. */
function Attach({ d, bound, onDone }) {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState(null);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  const readMine = () => listScope('user')
    .then((all) => { const list = all.filter((s) => !bound.includes(s.ref)); setMine(list); setPick(list[0] ? list[0].name : ''); })
    // As on the old page, an unread list is said as "no unbound skills".
    .catch((err) => { swallowed('appcat: skills picker', err); setMine([]); });
  // The bound list changed (a skill attached or detached): the picker reads the person's skills again.
  const boundKey = bound.join('\n');
  useEffect(() => { setMine(null); if (open) readMine(); }, [boundKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = () => {
    const next = !open;
    setOpen(next);
    // Every press draws the picker afresh, its status line empty (the old refreshSkillAttach).
    setStatus(null);
    if (next && mine === null) readMine();
  };
  const attach = async () => {
    if (!pick || busy) return;
    setBusy(true);
    setStatus({ text: x('detail.skillAttaching'), tone: 'busy' });
    try {
      await setSkillBinding(pick, `app:${d.owner}/${d.filename}`);
      setBusy(false); setOpen(false); setMine(null); setStatus(null);
      const done = x('detail.skillAttached');
      d.notice(done, noticeKind(done));
      onDone();
    } catch (err) {
      setBusy(false);
      setStatus({ text: '✘ ' + x('detail.skillAttachError') + ': ' + errorText(err), tone: 'refused' });
    }
  };

  // The detail's own word (.dtl-btn at .78rem: Action tone "quiet").
  const door = html`<${Action} tone="quiet" onClick=${toggle} expanded=${open}>+ ${x('detail.skillAttach')}<//>`;
  // Closed, the door stands alone in a line of its own, as the old page drew it; opened, it leads a row
  // of the picker and a status line that keeps its room.
  if (!open) return html`<${Space} above="small">${door}<//>`;
  let picker;
  if (mine === null) picker = html`<${Note} kind="quiet" size="small" inline>…<//>`;
  else if (!mine.length) picker = html`<${Note} kind="quiet" size="small" inline>${x('detail.skillNoneToAttach')}<//>`;
  else {
    picker = html`
      <${Select} line value=${pick} onChange=${setPick} ariaLabel=${x('detail.skillAttach')}
        options=${mine.map((s) => ({ value: s.name, label: s.name + (s.description ? ' — ' + s.description.slice(0, 50) : '') }))} />
      <${Loud} control disabled=${busy} onClick=${attach}>${x('detail.skillAttachConfirm')}<//>`;
  }
  return html`<${Space} above="small">
    <${Actions} chapter tight>${door}${picker}<//>
    <${Note} kind="report" chapter keep tone=${status ? status.tone : undefined}>${status ? status.text : ''}<//>
  <//>`;
}

export default function SkillsSection({ d }) {
  const [skills, setSkills] = useState(null);
  const [busy, setBusy] = useState(false);
  const [round, setRound] = useState(0);
  const ownPub = !!d.isOwnPublished;

  useEffect(() => {
    let live = true;
    setSkills(null);
    listAppSkills(d.owner, d.filename)
      .then((list) => { if (live) setSkills(list || []); })
      // eslint-disable-next-line aimeat/no-silent-catch -- as on the old page, an unread list is said as "no skills bound"
      .catch(() => { if (live) setSkills([]); });
    return () => { live = false; };
  }, [d.owner, d.filename, round]);

  const reload = () => { setRound((n) => n + 1); d.reload?.(); };
  const detach = async (name) => {
    if (busy) return;
    setBusy(true);
    try {
      await setSkillBinding(name, null);
      // The kinds the old page read from the words (its showNotice without a kind).
      const done = x('detail.skillDetached');
      d.notice(done, noticeKind(done));
      reload();
    } catch (err) {
      const why = x('detail.skillAttachError') + ': ' + errorText(err);
      d.notice(why, noticeKind(why));
    }
    setBusy(false);
  };

  let list;
  if (skills === null) list = html`<${Note} kind="quiet" size="small">…<//>`;
  else if (!skills.length) list = html`<${Note} kind="quiet" size="small">${x('detail.noSkills')}<//>`;
  else {
    // Each skill as the old .dtl-skill: its ref, its version and the faint × on one line, its words under.
    // The version and the × follow the ref with a space each, as the old head's words did.
    list = html`<${List} tone="entries">${skills.map((s) => html`<${Row} key=${s.ref || s.name}>
      <${Name} code desc=${s.description || ''} after=${html` <${Mark}>${'v' + String(s.version || '')}<//>${ownPub && s.scope === 'user'
        ? html` <${Icon} label=${x('detail.skillDetach')} onClick=${() => detach(s.name)}>×<//>` : null}`}>${s.ref || s.name}<//>
    <//>`)}<//>`;
  }
  return html`${list}${ownPub ? html`<${Attach} d=${d} bound=${(skills || []).map((s) => s.ref)} onDone=${reload} />` : null}`;
}
