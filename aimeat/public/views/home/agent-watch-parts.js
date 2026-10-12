/**
 * @file public/views/home/agent-watch-parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The part of the home's "new agent" page for an agent that works when something new
 *   arrives in a workspace: the choice of the workspace, and of the spaces in it the agent watches.
 *
 *   WHAT WAKES IT. A record published in a watched space gives the agent one task. The page offers
 *   the record spaces only (GET /v1/home/agents/choices/spaces): a row appended to a row space and
 *   a document page wake nobody.
 *
 *   NOT "WHERE DOES ITS WORK GO". That choice (agent-ties-parts.js WorkplaceChoice) says who reads
 *   the agent's finished work and wakes nobody. This one says what gives the agent work. The two
 *   can name the same workspace or different ones.
 *
 *   ONE SPACE IS TICKED FOR THE PERSON, SEVERAL ARE NOT. Each record in a watched space is a task
 *   and a model run, so with more than one space the person says which.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure WatchChoice({ places, place, onPlace, watched, onWatched, onSpaces, canBackfill, backfill, onBackfill }) ·
 *   WatchedFacts({ spaces, places })
 * @usage html`<${WatchChoice} places=${places} place=${watchPlace} onPlace=${setWatchPlace} watched=${watched} onWatched=${setWatched} />`
 * @version-history
 *   v1.1.1 — 2026-10-12 — `onSpaces`: the chosen workspace's record spaces are handed to the page,
 *     which writes their names into the agent's tasks.
 *   v1.1.0 — 2026-10-12 — The tick "Also work on the records that are already there", with how
 *     many published records the ticked spaces hold now, offered when the computer's agent program
 *     can do it (Jouni, 2026-10-12: "haluan myös valinnan käsittele myös vanhat"). A proposal's
 *     space that asks for them says so.
 *   v1.0.0 — 2026-10-12 — Initial (wish-sopimuspohjainen-agentti-kodista-luonnos-ehdottaa-sit-ja-koh).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { decodeEntities } from '/js/utils.js';
import { Field } from '/components/Field.js';
import { Choice } from '/components/Choice.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { Note } from '/components/Note.js';
import { Spinner } from '/components/Spinner.js';
import { Facts, FactLine } from '/components/Facts.js';
import { readWatchableSpaces } from '/js/services/agent-ties.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const w = (key, fallback) => tr('home.agentWatch.' + key, fallback);

// The same limit as WorkplaceChoice: boxes side by side up to this many, one grouped drop-down past it.
const BOXES_UP_TO = 8;
const placeValue = (pl) => `${pl.organism_id}/${pl.workspace_id}`;
const inOrganism = (pl) => w('inOrganism', 'In the organism {organism}').replace('{organism}', decodeEntities(pl.organism_name));

/**
 * The workspace an agent watches and the spaces in it. `place` is '' or '<organism id>/<workspace
 * id>'; `watched` is the namespaces the person ticked. Choosing a workspace reads its record
 * spaces and calls onWatched with the one space when there is exactly one, else with none.
 *
 * With `canBackfill` (the computer's agent program can work on the records that are already in a
 * space) one more tick is offered, `backfill` / `onBackfill`, and the spaces are read with how
 * many published records each holds now: the person reads that number before they tick, because
 * each of those records becomes a task and a run of their model. The tick is offered here, when
 * the agent is made, and nowhere later: the agent program reads it the first time it looks at a
 * space and never again.
 */
export function WatchChoice({ places, place, onPlace, watched, onWatched, onSpaces, canBackfill, backfill, onBackfill }) {
  // undefined: being read · null: the read failed · an array: the workspace's record spaces
  const [spaces, setSpaces] = useState(undefined);

  useEffect(() => {
    if (!place) { setSpaces(undefined); onSpaces?.([]); return undefined; }
    let live = true;
    setSpaces(undefined);
    const slash = place.indexOf('/');
    readWatchableSpaces(place.slice(0, slash), place.slice(slash + 1), { counts: !!canBackfill })
      .then((list) => {
        if (!live) return;
        setSpaces(list);
        // The page writes the spaces' names into the agent's definition (withSpaceNote).
        onSpaces?.(list);
        // Keep what is already ticked and still there (a draft opened again); else the one space.
        const kept = (watched ?? []).filter((ns) => list.some((s) => s.namespace === ns));
        onWatched(kept.length ? kept : list.length === 1 ? [list[0].namespace] : []);
      })
      .catch((err) => { swallowed('agent-watch: spaces', err); if (live) { setSpaces(null); onWatched([]); onSpaces?.([]); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the spaces are read once per workspace and per what the computer can do; a tick must not read them again
  }, [place, !!canBackfill]);

  const label = w('placeLabel', 'Which workspace does it watch?');
  // How many published records the ticked spaces hold now: what a backfill gives the agent as tasks.
  const there = (Array.isArray(spaces) ? spaces : []).filter((s) => (watched ?? []).includes(s.namespace)).reduce((sum, s) => sum + (Number(s.records) || 0), 0);
  // What happens to the records already there is said once: by the tick when the computer offers
  // it, and by the hint when it does not.
  const hint = [
    w('spacesHint', 'It gets one task for each record published there after it has started.'),
    !canBackfill && w('leftAsIs', 'Records that are already there are left as they are.'),
    w('retire', 'You can retire the agent from this workspace later: open its settings and the Contracts tab. It then stops working on this workspace.'),
  ].filter(Boolean).join(' ');
  const toggle = (namespace) => (on) => onWatched(on ? [...new Set([...(watched ?? []), namespace])] : (watched ?? []).filter((ns) => ns !== namespace));

  let chooser;
  if (places.length <= BOXES_UP_TO) {
    chooser = html`<${Choice} boxed cols=${2} label=${label} value=${place} onChange=${onPlace}
      options=${places.map((pl) => ({ value: placeValue(pl), label: decodeEntities(pl.workspace_name), hint: inOrganism(pl) }))} />`;
  } else {
    const groups = [];
    for (const pl of places) {
      const name = decodeEntities(pl.organism_name);
      let group = groups.find((g) => g.group === name);
      if (!group) { group = { group: name, options: [] }; groups.push(group); }
      group.options.push({ value: placeValue(pl), label: decodeEntities(pl.workspace_name) });
    }
    const chosen = places.find((pl) => placeValue(pl) === place);
    chooser = html`<${Select} label=${label} value=${place} onChange=${onPlace} hint=${chosen ? inOrganism(chosen) : undefined}
      placeholder=${w('placePick', 'Choose a workspace')} placeholderDisabled options=${groups} />`;
  }

  return html`
    ${chooser}
    ${place && spaces === undefined && html`<${Spinner} />`}
    ${place && spaces === null && html`
      <${Note} kind="message" error>${w('spacesFailed', 'The spaces of this workspace could not be read. Choose the workspace again.')}<//>`}
    ${place && Array.isArray(spaces) && spaces.length === 0 && html`
      <${Note} kind="aside" size="small">${w('spacesNone', 'This workspace has no space whose new records can start an agent. A published record starts one; a row and a document page do not.')}<//>`}
    ${place && Array.isArray(spaces) && spaces.length > 0 && html`
      <${Field} group label=${w('spacesLabel', 'Which spaces does it watch?')} hint=${hint}>
        ${spaces.map((s) => html`
          <${Check} key=${s.namespace} checked=${(watched ?? []).includes(s.namespace)} onChange=${toggle(s.namespace)}
            hint=${s.description || undefined}>${s.name}<//>`)}
      <//>
      ${canBackfill && html`
        <${Check} checked=${!!backfill} onChange=${onBackfill}
          hint=${(watched ?? []).length === 0 ? undefined : there > 0
            ? w('backfillHint', 'Records there now: {n}. Each becomes a task and a run of the model, worked ten at a time. Stopping the agent stops it.').replace('{n}', String(there))
            : w('backfillNone', 'The spaces you ticked hold no published record now.')}>
          ${w('backfill', 'Also work on the records that are already there')}
        <//>`}`}
  `;
}

/**
 * What a stored proposal's agent watches, as a row of facts: its definition names the spaces, and
 * the person approves it as written. `spaces` are { organism_id, ws, space }; `places` are the
 * person's workspaces, for the names.
 */
export function WatchedFacts({ spaces, places }) {
  const byPlace = new Map();
  for (const s of spaces) {
    const key = `${s.organism_id}/${s.ws}`;
    // A space whose item asks for the records already there says so beside its name.
    const name = s.backfill ? `${s.space} (${w('alsoOld', 'also the records already there')})` : s.space;
    byPlace.set(key, [...(byPlace.get(key) ?? []), name]);
  }
  const lines = [...byPlace].map(([key, names]) => {
    const pl = (places ?? []).find((x) => placeValue(x) === key);
    return html`<${FactLine} key=${key} sub=${names.join(', ')}>${pl ? `${decodeEntities(pl.workspace_name)} · ${inOrganism(pl)}` : key}<//>`;
  });
  return html`<${Facts} wide rows=${[{ k: w('watches', 'What it watches'), v: lines }]} />`;
}
