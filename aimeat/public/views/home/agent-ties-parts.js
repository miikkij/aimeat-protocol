/**
 * @file public/views/home/agent-ties-parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The parts of the home's agent page that are about what the agent's work is tied to:
 *   the offer to make an app of its work, the list of apps that show it, and the choice of where
 *   its finished work goes.
 *
 *   THE OFFER comes right after an agent is made and stays while the agent has no app (decision
 *   "From an agent to an app", Jouni, 2026-10-11). It asks one sentence and leads to the page that
 *   shows the app before anything is made (views/home/agent-app.js). "Not now" puts it away on
 *   this browser; the Apps section keeps the same way in.
 *
 *   THE APPS are the ones whose data map names this agent (GET /v1/home/agents `apps`). An app
 *   that already exists is tied here by one press, and untied the same way: both change one row of
 *   that app's map and nothing else.
 *
 *   WHERE THE WORK GOES is one choice: the agent's own memory, or one workspace of an organism the
 *   person is in. Nothing is moved: from the next finished task on, the result is shared with that
 *   workspace's members.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure AppOffer({ name, navigate }) · AgentApps({ name, owner, worker, navigate, onChanged }) ·
 *   WorkplaceChoice({ places, value, onChange }) · WorkplaceEditor({ name, current, onDone, onCancel }) ·
 *   placeWords(place)
 * @usage html`<${AgentApps} name=${name} owner=${owner} worker=${worker} navigate=${navigate} onChanged=${load} />`
 * @version-history
 *   v1.2.0 — 2026-10-14 — The offer opens the ideas dialog on its app tab ("Ideas: what an app could
 *     show"); an app idea chosen there is written into "What do you want to see?" (ideas-dialog.js,
 *     wish-esimerkit-agenteista-ja-sovelluksista-kotiruudulle-mielikuvi).
 *   v1.1.0 — 2026-10-11 — At production size: WorkplaceChoice, the one place that draws the choice of
 *     a workspace, is a grouped drop-down past eight workspaces (an account had 85), and the app to
 *     tie is found by typing past eight apps (the same account had 183). Workspace and organism names
 *     are decoded for display ("STT &amp; Voice" read as written in the registry).
 *   v1.0.0 — 2026-10-11 — Initial (wish-agentista-sovellukseen-sovelluksen-teko-agentin-j-lkeen-ja-a).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { Box } from '/components/Box.js';
import { SubHeading } from '/components/SubHeading.js';
import { Note } from '/components/Note.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Select } from '/components/Select.js';
import { PickField } from '/components/PickField.js';
import { decodeEntities } from '/js/utils.js';
import { Action, Loud } from '/components/Action.js';
import { LineList } from '/components/LineList.js';
import { PageSection } from '/components/PageSection.js';
import { Spinner } from '/components/Spinner.js';
import { Space } from '/components/Layout.js';
import { tieApp, untieApp, setWorkplace, clearWorkplace, readTieChoices } from '/js/services/agent-ties.js';
import { IdeasDialog } from './ideas-dialog.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const p = (key, fallback) => tr('home.agentTies.' + key, fallback);

const HOME = '/v1/home';
// With `say` (even empty) the page shows options at once; without it the page asks the sentence first.
const appPage = (name, say) => `${HOME}?agent=${encodeURIComponent(name)}&new-app=1${say === undefined ? '' : `&say=${encodeURIComponent(say)}`}`;

/** A workplace as the words a person reads: the workspace, and the organism it is in. */
export function placeWords(place) {
  return p('place', 'Workspace {workspace}, in the organism {organism}')
    .replace('{workspace}', decodeEntities(place.workspace_name)).replace('{organism}', decodeEntities(place.organism_name));
}

const OWN = 'own';
// Up to this many workspaces are shown as boxes side by side; past it they are one drop-down,
// grouped by organism. An account on production had 85 workspaces in 34 organisms (2026-10-11),
// and 85 boxes one under the other is a page nobody reads to its end.
const BOXES_UP_TO = 8;
const placeValue = (pl) => `${pl.organism_id}/${pl.workspace_id}`;

/**
 * The one choice of where an agent's finished work goes: its own memory, or one workspace.
 * `value` is 'own' or '<organism id>/<workspace id>'. Names are decoded for display, because the
 * workspace registry holds some of them with their entities written out ("STT &amp; Voice").
 */
export function WorkplaceChoice({ places, value, onChange }) {
  const label = p('placeLabel', 'Where does its work go?');
  const own = { value: OWN, label: p('placeOwn', 'The agent\'s own memory'), hint: p('placeOwnHint', 'Only you see it.') };
  const hintFor = (pl) => p('placeHint', 'Organism {organism}. Its members see the finished work.')
    .replace('{organism}', decodeEntities(pl.organism_name));
  if (places.length <= BOXES_UP_TO) {
    return html`<${Choice} boxed cols=${2} label=${label} value=${value} onChange=${onChange}
      options=${[own, ...places.map((pl) => ({ value: placeValue(pl), label: decodeEntities(pl.workspace_name), hint: hintFor(pl) }))]} />`;
  }
  const groups = [];
  for (const pl of places) {
    const name = decodeEntities(pl.organism_name);
    let group = groups.find((g) => g.group === name);
    if (!group) { group = { group: name, options: [] }; groups.push(group); }
    group.options.push({ value: placeValue(pl), label: decodeEntities(pl.workspace_name) });
  }
  const chosen = places.find((pl) => placeValue(pl) === value);
  return html`<${Select} label=${label} value=${value} onChange=${onChange}
    hint=${chosen ? hintFor(chosen) : own.hint}
    options=${[{ value: OWN, label: own.label }, ...groups]} />`;
}

const laterKey = (name) => `aimeat.home.appOffer.${name}`;
function putAway(name) { try { localStorage.setItem(laterKey(name), 'later'); } catch (err) { swallowed('app offer: put away', err); } }
function isPutAway(name) { try { return localStorage.getItem(laterKey(name)) === 'later'; } catch (err) { swallowed('app offer: read', err); return false; } }

/** The offer to make an app of this agent's work. `fresh`: the agent was just made, so it shows again. */
export function AppOffer({ name, fresh, navigate }) {
  const [say, setSay] = useState('');
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [hidden, setHidden] = useState(() => !fresh && isPutAway(name));
  if (hidden) return null;
  const go = (e) => { e?.preventDefault?.(); navigate(appPage(name, say.trim())); };
  // The air under the box keeps its shadow clear of the facts that follow it.
  return html`
    <${Space} above="small" below="part">
    <${Box} tone="raised">
      <${SubHeading} level=${2}>${p('offerTitle', 'Make an app of its work')}<//>
      <${Note} kind="lead">${p('offerLead', 'The agent does the work. An app shows it to you, to your group or to everyone, without anyone opening the agent\'s page.')}<//>
      <${Fields}>
        <${TextArea} label=${p('offerLabel', 'What do you want to see?')} rows=${2} value=${say} onInput=${setSay} onSend=${go}
          placeholder=${p('offerPlaceholder', 'Say it in one sentence. You see the app before anything is made.')} />
        <${FormActions}>
          <${Loud} control onClick=${go}>${say.trim() ? p('offerShow', 'Show the options') : p('offerSuggest', 'Suggest some to me')}<//>
          <${Action} onClick=${() => { putAway(name); setHidden(true); }}>${p('offerLater', 'Not now')}<//>
          <${Action} onClick=${() => setIdeasOpen(true)}>${tr('home.ideas.offerIdeas', 'Ideas: what an app could show')} →<//>
        <//>
      <//>
      <${IdeasDialog} open=${ideasOpen} onClose=${() => setIdeasOpen(false)}
        onPickApp=${(idea) => setSay(idea.name + '. ' + idea.app_shows)} />
      <${Note} kind="quiet">${p('offerAfter', 'You can do this later from Apps on this page, or by saying the same to your own AI.')}<//>
    <//>
    <//>`;
}

/** The apps that show this agent's work, with the two ways to add one and the way to untie one. */
export function AgentApps({ name, owner, worker, navigate, onChanged }) {
  const apps = worker.apps ?? [];
  const [mode, setMode] = useState(null);
  const [choices, setChoices] = useState(null);
  const [picked, setPicked] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState(null);

  const open = async (next) => {
    setMode(next);
    setSaid(null);
    setPicked('');
    if (next === 'tie' && !choices) {
      try { setChoices(await readTieChoices()); }
      catch (err) { setSaid({ ok: false, text: err?.message || String(err) }); }
    }
  };
  const tied = new Set(apps.map((a) => a.filename));
  const free = (choices?.apps ?? []).filter((a) => !tied.has(a.filename));

  const act = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setSaid(null);
    try {
      if (mode === 'tie') await tieApp(owner, picked, name, { madeFor: false });
      else await untieApp(owner, picked, name);
      setSaid({ ok: true, text: mode === 'tie' ? p('tied', 'Tied. The app is on this list now.') : p('untied', 'Untied. The app and the agent are as they were.') });
      setMode(null);
      await onChanged?.();
    } catch (err) { setSaid({ ok: false, text: err?.message || String(err) }); }
    finally { setBusy(false); }
  };

  return html`
    <${PageSection} group ends title=${p('appsTitle', 'Apps')}>
      ${apps.length === 0
        ? html`<${Note} kind="quiet">${p('appsNone', 'No app shows this agent\'s work yet.')}<//>`
        : html`
          <${Note} kind="quiet">${p('appsLead', 'The apps that show this agent\'s work.')}<//>
          <${LineList} rows=${apps.map((app) => ({
            id: app.filename,
            name: app.name,
            text: app.made_for ? p('madeFor', 'made for this agent') : p('uses', 'uses its work'),
            href: app.url || `/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.filename)}?mode=inline`,
          }))} />`}

      ${said && html`<${Note} kind="message" error=${!said.ok}>${said.text}<//>`}

      ${mode === null && html`
        <${FormActions}>
          <${Action} href=${appPage(name)} onClick=${(e) => { e.preventDefault(); navigate(appPage(name)); }}>${p('appsNew', 'Make a new app of its work →')}<//>
          <${Action} onClick=${() => open('tie')}>${p('appsTie', 'Tie an app that already exists')}<//>
          ${apps.length > 0 && html`<${Action} onClick=${() => open('untie')}>${p('appsUntie', 'Untie an app')}<//>`}
        <//>`}

      ${mode === 'tie' && !choices && !said && html`<${Spinner} />`}
      ${mode === 'tie' && choices && free.length === 0 && html`
        <${Note} kind="quiet">${p('tieNone', 'Every app of yours is already on this list, or you have no app yet.')}<//>
        <${FormActions}><${Action} onClick=${() => setMode(null)}>${tr('home.agentNew.cancel', 'Cancel')}<//><//>`}
      ${mode === 'tie' && choices && free.length > 0 && html`
        <${Fields}>
          ${free.length <= BOXES_UP_TO
            ? html`<${Choice} boxed cols=${2} label=${p('tieLabel', 'Which app shows its work?')} value=${picked} onChange=${setPicked}
                options=${free.map((a) => ({ value: a.filename, label: a.name, hint: a.filename }))} />`
            // An account with many apps (183 on production, 2026-10-11) types a few letters instead.
            : html`<${PickField} keep label=${p('tieLabel', 'Which app shows its work?')}
                items=${free.map((a) => ({ id: a.filename, name: a.name, sub: a.filename }))}
                placeholder=${p('tiePick', 'Type a part of the app\'s name')}
                onPick=${(item) => setPicked(item?.id ?? '')} onType=${() => setPicked('')}
                noMatchLabel=${p('tieNoMatch', 'No app of yours has that in its name.')} />`}
          <${Note} kind="quiet">${p('tieNote', 'The tie is a statement on the app\'s data map. It gives the app no new permission.')}<//>
          <${FormActions}>
            <${Loud} control disabled=${busy || !picked} onClick=${act}>${p('tieDo', 'Tie the app')}<//>
            <${Action} disabled=${busy} onClick=${() => setMode(null)}>${tr('home.agentNew.cancel', 'Cancel')}<//>
          <//>
        <//>`}
      ${mode === 'untie' && html`
        <${Fields}>
          <${Choice} boxed cols=${2} label=${p('untieLabel', 'Which app no longer shows its work?')} value=${picked} onChange=${setPicked}
            options=${apps.map((a) => ({ value: a.filename, label: a.name, hint: a.filename }))} />
          <${Note} kind="quiet">${p('untieNote', 'Nothing is deleted: the app, the agent and its work stay.')}<//>
          <${FormActions}>
            <${Loud} control disabled=${busy || !picked} onClick=${act}>${p('untieDo', 'Untie the app')}<//>
            <${Action} disabled=${busy} onClick=${() => setMode(null)}>${tr('home.agentNew.cancel', 'Cancel')}<//>
          <//>
        <//>`}
    <//>`;
}

/** The one choice of where an agent's finished work goes. `current` is the worker's `work_goes_to`. */
export function WorkplaceEditor({ name, current, onDone, onCancel }) {
  const [places, setPlaces] = useState(null);
  const [value, setValue] = useState(current ? `${current.organism_id}/${current.workspace_id}` : OWN);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    let live = true;
    readTieChoices()
      .then((c) => { if (live) setPlaces(c.places ?? []); })
      .catch((err) => { if (live) { setPlaces([]); setProblem(err?.message || String(err)); } });
    return () => { live = false; };
  }, []);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      if (value === OWN) await clearWorkplace(name);
      else {
        const slash = value.indexOf('/');
        await setWorkplace(name, value.slice(0, slash), value.slice(slash + 1));
      }
      await onDone?.(value === OWN);
    } catch (err) { setProblem(err?.message || String(err)); }
    finally { setBusy(false); }
  };

  if (!places) return html`<${Spinner} />`;
  return html`
    <${Fields}>
      <${WorkplaceChoice} places=${places} value=${value} onChange=${setValue} />
      ${places.length === 0 && html`<${Note} kind="quiet">${p('placeNone', 'You are not in an organism that has a workspace yet, so the agent\'s own memory is the one place.')}<//>`}
      <${Note} kind="quiet">${p('placeNote', 'Nothing is moved. From the next finished task on, the result is shared with that workspace. Work that is already finished stays where it is.')}<//>
      ${problem && html`<${Note} kind="message" error>${problem}<//>`}
      <${FormActions}>
        <${Loud} control disabled=${busy} onClick=${save}>${busy ? p('placeSaving', 'Saving…') : p('placeSave', 'Save')}<//>
        <${Action} disabled=${busy} onClick=${onCancel}>${tr('home.agentNew.cancel', 'Cancel')}<//>
      <//>
    <//>`;
}
