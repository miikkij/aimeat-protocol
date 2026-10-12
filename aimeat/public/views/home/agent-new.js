/**
 * @file public/views/home/agent-new.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "This is how it would work": the page between a person's sentence and an agent at
 *   work. It shows the agent before anything exists, and the person changes what they want and
 *   presses once.
 *
 *   THREE WAYS IN, ONE PAGE. From the home's field with a sentence (`say`), which the person's own
 *   model here turns into a draft; from a proposal that waits for them (`proposal`), written by
 *   their AI or an app; or with nothing, where the page asks for the sentence or offers the three
 *   ready definitions. All three end in the same four choices and the same press.
 *
 *   THE FOUR CHOICES are what the person decides: what it is called and does, when it works, how
 *   far it reaches, and on which machine. A machine is asked only when the person has more than
 *   one. "Always on" can be chosen only for a machine that says it keeps agents running.
 *
 *   WITHOUT A MODEL HERE the sentence is not lost: the page gives the same request as a text to
 *   copy into the person's own AI, which proposes the agent, and the proposal arrives on the home.
 *
 *   Composed from library components only; it has no sheet of its own.
 * @structure default AgentNewView({ navigate })
 * @usage routed at /v1/home?new-agent=1 by spa.html (optional say=<sentence>, proposal=<id>)
 * @version-history
 *   v1.4.0 — 2026-10-12 — A fifth answer to "When it works": when something new arrives in a
 *     workspace. The person chooses the workspace and the spaces in it (agent-watch-parts.js); the
 *     definition then names them in `record_spaces` and listens for records, and the agent is
 *     stated on that workspace when it is approved. Offered only when a connected agent on the
 *     chosen computer says its agent program does this (`features` of GET /crew/menu). A stored
 *     proposal whose definition names such spaces shows them and is stated on its workspaces the
 *     same way (wish-sopimuspohjainen-agentti-kodista-luonnos-ehdottaa-sit-ja-koh).
 *   v1.3.0 — 2026-10-12 — Before the person approves, two rows say which of their apps' tools the
 *     agent uses and which of their workspaces it reads or writes: the ones the definition names,
 *     by a tool's sku and a workspace's id (services/agent-draft-known.js). The draft is written
 *     with the person's apps, their tools and their workspaces given to the model. The row "What
 *     it reaches" lists the permissions the agent is proposed with (scopesFor)
 *     (wish-kodin-agenttiluonnos-tuntee-ty-kalujen-kuvaukset-omistajan-s).
 *   v1.2.1 — 2026-10-11 — "Where does its work go?" is WorkplaceChoice (agent-ties-parts.js): a
 *     grouped drop-down on an account with many workspaces, and names decoded for display.
 *   v1.2.0 — 2026-10-11 — The row "What it offers": the offer the agent's definition carries, which
 *     shows on the Offerings page once the agent has started.
 *   v1.1.0 — 2026-10-11 — One choice about the agent's results, "Where does its work go?": its own
 *     memory, or a workspace of an organism the person is in. Shown only when there is a workspace.
 *   2026-10-11 — The word a person reads for a connector is "computer" (laptop, server, cloud, AIMEAT instance), never "machine" (Jouni, 2026-10-11).
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { useSession } from '/js/use-session.js';
import { swallowed } from '/js/swallowed.js';
import { areaLine } from '/js/consent-vocab.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageIntro } from '/components/PageIntro.js';
import { BackLink } from '/components/BackLink.js';
import { Spinner } from '/components/Spinner.js';
import { Note } from '/components/Note.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Facts, FactLine } from '/components/Facts.js';
import { Action, Loud } from '/components/Action.js';
import { PromptCard } from '/components/PromptCard.js';
import { Stack } from '/components/Layout.js';
import { SubHeading } from '/components/SubHeading.js';
import { CREW_TEMPLATES } from '/views/profile/agents/crew-templates.js';
import { timeOfCron } from '/views/profile/scheduler/cron-words.js';
import {
  draftAgent, templateDraft, ownAiRequest, cronFor, startAgent, approveProposal, runtimeMenu, readHomeAgents, offerShown, scopesFor,
} from '/js/services/agent-draft.js';
import { namedIn, recordSpacesOf, RECORDS_FEATURE } from '/js/services/agent-draft-known.js';
import { decodeEntities } from '/js/utils.js';
import { readTieChoices, setWorkplace } from '/js/services/agent-ties.js';
import { activateEngagement } from '/js/services/organisms.js';
import { WorkplaceChoice } from '/views/home/agent-ties-parts.js';
import { WatchChoice, WatchedFacts } from '/views/home/agent-watch-parts.js';
import { machineName } from '/views/home/agents-band.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const n = (key, fallback) => tr('home.agentNew.' + key, fallback);

const NAME_SHAPE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const HOME = '/v1/home';

/** When a stored proposal's agent would work, read from what it carries. A schedule is not part of one. */
function whenOfProposal(p) {
  if (p?.run_mode === 'resident') return 'always';
  if (recordSpacesOf(p?.crew_def).length > 0) return 'records';
  const hears = p?.crew_def?.listen_for;
  return Array.isArray(hears) && hears.some((x) => x === 'messages' || x === 'dms') ? 'talk' : 'ask';
}

/** A draft-shaped view of a stored proposal, so one form shows both. */
function draftOfProposal(p) {
  return { name: p.name, displayName: p.display_name || p.name, purpose: p.purpose || '', does: [], reach: null, crewDef: p.crew_def ?? null };
}

export default function AgentNewView({ navigate }) {
  const session = useSession();
  const query = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const proposalId = query.get('proposal') || '';
  const said = query.get('say') || '';

  const [home, setHome] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [draft, setDraft] = useState(null);
  const [sentence, setSentence] = useState(said);
  // ask: the sentence or a ready definition · drafting: the model writes · form: the choices ·
  // ownAi: no model here, the request to copy · gone: the proposal is not waiting any more
  const [phase, setPhase] = useState(proposalId ? 'loading' : said ? 'drafting' : 'ask');
  const [problem, setProblem] = useState('');
  const [when, setWhen] = useState('ask');
  const [days, setDays] = useState('weekdays');
  const [clock, setClock] = useState('07:00');
  const [machine, setMachine] = useState('');
  const [places, setPlaces] = useState([]);
  const [place, setPlace] = useState('own');
  const [busy, setBusy] = useState(false);
  // The person's apps with their tools, and their workspaces: given to the model that writes the
  // draft, and read against the definition for the two rows that name what the agent uses.
  const [known, setKnown] = useState({ apps: [], places: [] });
  const knownRead = useRef(null);
  // What the chosen computer's agent program offers: its tools, and what it says it honours beyond
  // them. Asked from a connected agent on that computer; nobody to ask means no feature.
  const [features, setFeatures] = useState([]);
  const menuRead = useRef(null);
  // For an agent that works when something new arrives in a workspace: the workspace it watches
  // ('<organism id>/<workspace id>') and the namespaces of the spaces the person ticked.
  const [watchPlace, setWatchPlace] = useState('');
  const [watched, setWatched] = useState([]);

  const goHome = useCallback((e) => { e?.preventDefault?.(); navigate(HOME); }, [navigate]);

  // The machines, and with them the default choice: the proposal's own, else the only one, else
  // the first that is connected.
  useEffect(() => {
    if (!session) return;
    readHomeAgents(20).then((data) => {
      setHome(data);
      const list = data?.connectors ?? [];
      setMachine((cur) => cur || (list.length === 1 ? list[0].id : (list.find((c) => c.online)?.id ?? '')));
    }).catch((err) => { swallowed('agent-new: machines', err); setHome({ connectors: [], workers: [] }); });
    // The workspaces the agent's work could be shared with, and the person's apps with their
    // tools. None read means the choice is not shown and the draft is written without them.
    knownRead.current = readTieChoices({ tools: true })
      .then((c) => { setPlaces(c.places ?? []); setKnown(c); return c; })
      .catch((err) => { swallowed('agent-new: places and apps', err); return { apps: [], places: [] }; });
  }, [session]);

  // A proposal that waits: read it whole, because the home's list carries only its name and purpose.
  useEffect(() => {
    if (!session || !proposalId) return;
    apiGet('/v1/agents/v2/agent-proposals').then((resp) => {
      const p = (resp?.data?.proposals ?? []).find((x) => x.id === proposalId && x.state === 'proposed');
      if (!p) { setPhase('gone'); return; }
      setProposal(p);
      setDraft(draftOfProposal(p));
      setWhen(whenOfProposal(p));
      if (p.install_id) setMachine(p.install_id);
      setPhase('form');
    }).catch((err) => { setProblem(err?.message || String(err)); setPhase('gone'); });
  }, [session, proposalId]);

  // The runtime's menu, read again when the person chooses another computer: an agent on the
  // chosen computer answers first, because that computer's agent program is the one that will run
  // the new agent. With no connected agent there, any connected agent of the person gives the tool
  // list, and no feature is taken from it.
  useEffect(() => {
    if (!home) return;
    const online = (home.workers ?? []).filter((x) => x.has_key && x.connector?.online);
    const here = online.filter((x) => x.connector?.id === machine).map((x) => x.name);
    const names = here.length ? here : online.map((x) => x.name);
    let live = true;
    menuRead.current = runtimeMenu(names).then((menu) => {
      const offered = here.length ? menu.features : [];
      if (live) setFeatures(offered);
      return { tools: menu.tools, features: offered };
    });
    return () => { live = false; };
  }, [home, machine]);

  const takeDraft = useCallback((d) => {
    setDraft(d);
    setWhen(d.when || 'ask');
    if (d.watch) setWatchPlace(`${d.watch.organism_id}/${d.watch.workspace_id}`);
    const at = timeOfCron(d.cron);
    if (at) setClock(at);
    if (d.cron) setDays(/\s1-5$/.test(d.cron) ? 'weekdays' : 'daily');
    setPhase('form');
  }, []);

  const write = useCallback(async (text) => {
    const wanted = String(text || '').trim();
    if (wanted.length < 10) { setProblem(n('tooShort', 'Say a little more: what should the agent do, and with what?')); return; }
    setProblem('');
    setPhase('drafting');
    try {
      const [menu, about] = await Promise.all([menuRead.current ?? runtimeMenu([]), knownRead.current ?? Promise.resolve(undefined)]);
      takeDraft(await draftAgent(wanted, { tools: menu.tools, known: about, features: menu.features }));
    } catch (err) {
      // The model answered with something that is not an agent: the person can say it another way.
      if (err?.code === 'NO_JSON' || err?.code === 'BAD_DRAFT') {
        setProblem(n('badDraft', 'The model did not return an agent that could run. Try again, say it another way, or start from a ready one.'));
        setPhase('ask');
      } else {
        // No model here, its budget is spent, or its provider did not answer: the person's own AI
        // can do the same from the request. A provider's error text says nothing a person can act on.
        swallowed('agent-new: draft', err);
        setPhase('ownAi');
      }
    }
  }, [takeDraft]);

  // Arriving with a sentence: write the draft once the machines are known (the tool list is read
  // from one of the person's connected agents).
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!said || started || !home || proposalId) return;
    setStarted(true);
    write(said);
  }, [said, started, home, proposalId, write]);

  const machines = home?.connectors ?? [];
  const chosen = machines.find((c) => c.id === machine) ?? null;
  const residentHere = !!chosen && (chosen.run_modes ?? []).includes('resident');
  // A workspace's records can start the new agent when the chosen computer's agent program says
  // so. A stored proposal is approved as written: it works on records when its definition names
  // the spaces, and the page cannot add them to it.
  const proposalWatches = recordSpacesOf(proposal?.crew_def);
  const canWatch = proposal ? proposalWatches.length > 0 : features.includes(RECORDS_FEATURE) && places.length > 0;
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const start = async () => {
    if (!draft || busy) return;
    const name = String(draft.name || '').trim();
    if (!NAME_SHAPE.test(name)) { setProblem(n('badName', 'The short name is 3 to 40 lowercase letters, digits and hyphens, and starts with a letter.')); return; }
    if (String(draft.purpose || '').trim().length < 10) { setProblem(n('badPurpose', 'Say in one sentence what the agent is for.')); return; }
    const cron = when === 'clock' ? cronFor(days, clock) : '';
    if (when === 'clock' && !cron) { setProblem(n('badTime', 'Give the time as hours and minutes, for example 07:00.')); return; }
    // What an agent that works on a workspace's records watches. A proposal names it in its own
    // definition; for a draft it is the workspace and the spaces the person chose here.
    const slashAt = watchPlace.indexOf('/');
    const watch = when === 'records' && !proposal
      ? { organism_id: watchPlace.slice(0, Math.max(slashAt, 0)), workspace_id: watchPlace.slice(slashAt + 1), spaces: watched }
      : null;
    if (watch && !canWatch) { setProblem(n('badWatchComputer', 'The computer you chose cannot start an agent from a workspace. Choose another computer, or another time for it to work.')); return; }
    if (watch && (!watch.organism_id || !watch.workspace_id)) { setProblem(n('badWatchPlace', 'Choose the workspace the agent watches.')); return; }
    if (watch && watch.spaces.length === 0) { setProblem(n('badWatchSpaces', 'Choose at least one space of the workspace for the agent to watch.')); return; }
    setProblem('');
    setBusy(true);
    try {
      const choice = { when, cron, connector: machine || undefined, watch };
      const made = { ...draft, name, purpose: draft.purpose.trim(), displayName: String(draft.displayName || '').trim() || name };
      const out = proposal
        ? await approveProposal(proposal.id, name, made, choice)
        : await startAgent(made, choice);
      const state = out?.attached ? 'running' : out?.waiting_for_connector ? 'waiting' : 'made';
      // Where its work goes, when the person named a workspace. The agent is made either way: a
      // place that could not be saved is logged, and the agent's page shows the place it has.
      if (place !== 'own') {
        const slash = place.indexOf('/');
        await setWorkplace(name, place.slice(0, slash), place.slice(slash + 1))
          .catch((err) => swallowed('agent-new: workplace', err));
      }
      // An agent that works on a workspace's records is stated on that workspace, once per
      // workspace: it then shows among the workspace's agents and on its own Contracts tab, where
      // it can be taken off. The agent is made either way, and its runtime works on a workspace
      // that has no such statement, so one that could not be saved is logged.
      if (when === 'records') {
        const spaces = watch
          ? [{ organism_id: watch.organism_id, ws: watch.workspace_id }]
          : recordSpacesOf(proposal?.crew_def);
        const seen = new Set();
        for (const s of spaces) {
          const key = `${s.organism_id}/${s.ws}`;
          if (seen.has(key)) continue;
          seen.add(key);
          await activateEngagement(s.organism_id, s.ws, name).catch((err) => swallowed('agent-new: engagement', err));
        }
      }
      navigate(`${HOME}?agent=${encodeURIComponent(name)}&started=${state}${out?.schedule_problem ? '&schedule=failed' : ''}`);
    } catch (err) {
      setProblem(err?.message || String(err));
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!proposal || busy) return;
    setBusy(true);
    try {
      await apiPost(`/v1/agents/v2/agent-proposals/${encodeURIComponent(proposal.id)}/decline`, {});
      navigate(HOME);
    } catch (err) { setProblem(err?.message || String(err)); setBusy(false); }
  };

  if (!session) {
    return html`
      <${PageFrame} width="narrow">
        <${PageIntro} title=${n('title', 'This is how it would work')} sub=${tr('home.signInDesc', 'Sign in to see where you left off.')} />
        <${FormActions}><${Loud} onClick=${() => navigate('/v1/portal')}>${tr('home.signIn', 'Sign in')}<//><//>
      <//>`;
  }

  const back = html`<${BackLink} href=${HOME} onClick=${goHome}>↩ ${tr('home.history.back', 'Back to your home')}<//>`;

  if (phase === 'loading' || (phase !== 'gone' && !home)) {
    return html`<${PageFrame} width="narrow" loading=${true}><${Spinner} /><//>`;
  }

  if (phase === 'gone') {
    return html`
      <${PageFrame} width="narrow">
        ${back}
        <${PageIntro} title=${n('goneTitle', 'This proposal is no longer waiting')}
          sub=${problem || n('goneSub', 'It was approved or declined already. Your agents are on your home.')} />
      <//>`;
  }

  if (phase === 'drafting') {
    return html`
      <${PageFrame} width="narrow">
        ${back}
        <${PageIntro} title=${n('title', 'This is how it would work')}
          sub=${n('asked', 'You asked: "{sentence}"').replace('{sentence}', sentence.trim())} />
        <${Note} kind="loading">${n('writing', 'Your AI model is writing the agent. This takes a moment.')}<//>
      <//>`;
  }

  if (phase === 'ownAi') {
    return html`
      <${PageFrame} width="narrow">
        ${back}
        <${PageIntro} title=${n('ownAiTitle', 'Ask your own AI to make it')}
          sub=${n('ownAiSub', 'No AI model answers on this AIMEAT right now, so the agent is written by the AI you already use. Copy this to it. Its proposal arrives on your home, and you approve it there.')} />
        <${PromptCard} label=${n('ownAiLabel', 'What to say to your AI')} prompt=${ownAiRequest(sentence.trim(), chosen && machines.length > 1 ? machineName(chosen) : '')}
          loud copyLabel=${tr('common.copyPrompt', 'Copy the prompt')} copiedLabel=${tr('common.copied', 'Copied')} />
        <${FormActions}>
          <${Action} onClick=${() => setPhase('ask')}>${n('startReady', 'Or start from a ready one')}<//>
        <//>
      <//>`;
  }

  if (phase === 'ask') {
    return html`
      <${PageFrame} width="narrow">
        ${back}
        <${PageIntro} title=${n('askTitle', 'A new agent')}
          sub=${n('askSub', 'Say in one sentence what you want it to do. You see the agent before anything is made.')} />
        <${Fields}>
          <${TextArea} label=${tr('home.agents.askLabel', 'What should the agent do?')} rows=${3}
            placeholder=${tr('home.agents.askPlaceholder', 'For example: gather the industry news every weekday morning and write a summary')}
            value=${sentence} onInput=${setSentence} onSend=${() => write(sentence)} />
          ${problem && html`<${Note} kind="message" error>${problem}<//>`}
          <${FormActions}>
            <${Loud} control onClick=${() => write(sentence)}>${n('show', 'Show the agent')}<//>
          <//>
        <//>
        <${SubHeading} level=${2} desc=${n('readyDesc', 'A ready definition that you name and give its job.')}>
          ${n('readyTitle', 'Or start from a ready one')}
        <//>
        <${Choice} boxed cols=${3} ariaLabel=${n('readyTitle', 'Or start from a ready one')} value=${''}
          onChange=${(id) => takeDraft(templateDraft(id))}
          options=${CREW_TEMPLATES.map((s) => ({ value: s.id, label: t(s.nameKey), hint: t(s.descKey) }))} />
      <//>`;
  }

  // ── The form: the agent, and the person's four choices ──
  const scopes = proposal ? (proposal.scopes ?? []) : scopesFor(draft, { when });
  // The offer in the definition: the draft's own, or the one the proposer wrote.
  const offered = offerShown(draft.crewDef ?? proposal?.crew_def);
  // The person's apps and workspaces the definition names, for a draft and a proposal alike.
  const definition = draft.crewDef ?? proposal?.crew_def;
  const named = namedIn(definition, known);
  const writes = (proposal ? scopes.some((s) => s === '*' || s === 'organism:write' || s === 'organism:*') : draft.reach !== 'readonly')
    && (definition?.agents ?? []).some((m) => Array.isArray(m?.tools) && m.tools.includes('workspace_write'));
  const whenOptions = [
    { value: 'ask', label: tr('home.agents.when.ask', 'When I ask'), hint: n('whenAskHint', 'You give it a task when you need one. Otherwise it does nothing.') },
    { value: 'clock', label: tr('home.agents.when.clock', 'By the clock'), hint: n('whenClockHint', 'It gets the same task at the times you set.') },
    { value: 'talk', label: tr('home.agents.when.talk', 'When someone writes to it'), hint: n('whenTalkHint', 'It answers a message within seconds, at any hour.') },
    {
      value: 'always', label: tr('home.agents.when.always', 'Always on'), disabled: !residentHere,
      hint: residentHere
        ? n('whenAlwaysHint', 'It stays running the whole time. For an agent that follows something without a break.')
        : n('whenAlwaysOff', 'This computer starts an agent when work arrives and does not keep one running.'),
    },
    {
      value: 'records', label: tr('home.agents.when.records', 'When something new arrives in a workspace'), disabled: !canWatch,
      hint: canWatch
        ? (proposal
          ? n('whenRecordsHintProposal', 'It gets a task each time a record is published in the workspace spaces that the proposal names.')
          : n('whenRecordsHint', 'It gets a task each time a record is published in the spaces of a workspace that you choose.'))
        : proposal
          ? n('whenRecordsOffProposal', 'This proposal names no workspace space to watch.')
          : places.length === 0
            ? n('whenRecordsOffPlaces', 'You are not in an organism that has a workspace yet.')
            : n('whenRecordsOff', 'The agent program on this computer does not do this yet, or no agent on this computer is connected to say that it does.'),
    },
  ];
  // A proposal's schedule is not part of the proposal, so its time cannot be read; every other
  // choice a stored proposal carries is shown as it was proposed.
  const fromSentence = !proposal && !draft.template;

  return html`
    <${PageFrame} width="narrow">
      ${back}
      <${PageIntro} title=${n('title', 'This is how it would work')}
        sub=${proposal
          ? n('fromProposal', 'Nothing has been made yet. Read the proposal, choose, and start it.')
          : n('fromDraft', 'Nothing has been made yet. Read it, change what you want, and start it.')} />

      ${fromSentence && sentence.trim() && html`
        <${Note} kind="lead">${n('asked', 'You asked: "{sentence}"').replace('{sentence}', sentence.trim())}<//>`}

      <${Fields}>
        <${TextField} label=${n('displayName', 'Name')} value=${draft.displayName} onInput=${set('displayName')}
          placeholder=${n('displayNamePlaceholder', 'Morning news')} disabled=${!!proposal} />
        <${TextField} code label=${n('name', 'Short name')} hint=${n('nameHint', 'Lowercase letters, digits and hyphens. It is the agent\'s address and cannot be changed later.')}
          value=${draft.name} onInput=${(v) => set('name')(String(v).toLowerCase())} placeholder="morning-news" disabled=${!!proposal} />
        <${TextArea} label=${n('purpose', 'What it is for')} rows=${3} value=${draft.purpose} onInput=${set('purpose')}
          placeholder=${n('purposePlaceholder', 'One sentence: what it does, and with what.')} disabled=${!!proposal} />

        ${(draft.does ?? []).length > 0 && html`
          <${Facts} wide rows=${[{ k: n('does', 'What it does'), v: draft.does.map((line, i) => html`<${FactLine} key=${i}>${line}<//>`) }]} />`}

        <${Choice} boxed cols=${2} label=${n('when', 'When it works')} value=${when} onChange=${setWhen} options=${whenOptions} />
        ${when === 'clock' && html`
          <${Choice} label=${n('days', 'Which days')} value=${days} onChange=${setDays}
            options=${[['weekdays', n('weekdays', 'Weekdays')], ['daily', n('daily', 'Every day')]]} />
          <${TextField} type="time" label=${n('time', 'At what time')} value=${clock} onInput=${setClock} />`}
        ${when === 'records' && !proposal && canWatch && html`
          <${WatchChoice} places=${places} place=${watchPlace} onPlace=${setWatchPlace} watched=${watched} onWatched=${setWatched} />`}
        ${when === 'records' && proposal && proposalWatches.length > 0 && html`
          <${WatchedFacts} spaces=${proposalWatches} places=${places} />`}

        ${proposal
          ? html`<${Facts} wide rows=${[{ k: n('reach', 'What it reaches'), v: areaLine(scopes, t) }]} />`
          : html`<${Choice} label=${n('reach', 'What it reaches')} hint=${areaLine(scopes, t)}
              value=${draft.reach} onChange=${set('reach')}
              options=${[['readonly', n('reachRead', 'Reads only')], ['standard', n('reachWrite', 'Reads and writes')]]} />`}

        ${/* What of the person's own the agent's instructions name: an app by the sku of a tool, a
             workspace by its id. Shown only when the definition names one. */''}
        ${(named.apps.length > 0 || named.places.length > 0) && html`
          <${Facts} wide rows=${[
            named.apps.length > 0 && {
              k: n('usesApps', 'Apps whose tools it uses'),
              v: named.apps.map((a) => html`<${FactLine} key=${a.filename} sub=${a.tools.map((x) => x.name).join(', ')}>${decodeEntities(a.name)}<//>`),
            },
            named.places.length > 0 && {
              k: writes ? n('writesPlaces', 'Workspaces it reads and writes') : n('readsPlaces', 'Workspaces it reads'),
              v: named.places.map((pl) => html`
                <${FactLine} key=${`${pl.organism_id}/${pl.workspace_id}`}
                  sub=${n('inOrganism', 'In the organism {organism}').replace('{organism}', decodeEntities(pl.organism_name))}>
                  ${decodeEntities(pl.workspace_name)}
                <//>`),
            },
          ]} />`}

        ${machines.length > 1 && html`
          <${Choice} boxed cols=${2} label=${n('machine', 'On which computer')} value=${machine} onChange=${setMachine}
            options=${machines.map((c) => ({
              value: c.id, label: machineName(c),
              hint: c.online ? n('machineOn', 'Connected.') : n('machineOff', 'Not connected. The agent is made now and starts when this computer comes back.'),
            }))} />`}
        ${machines.length === 1 && html`
          <${Facts} wide rows=${[{
            k: n('machine', 'On which computer'), v: machineName(machines[0]),
            sub: machines[0].online ? n('machineOn', 'Connected.') : n('machineOff', 'Not connected. The agent is made now and starts when this computer comes back.'),
          }]} />`}
        ${machines.length === 0 && html`
          <${Note} kind="aside" size="small">
            <b>${tr('home.agents.noMachineTitle', 'An agent needs a computer to run on. You have none yet.')}</b>
            ${' '}${n('noMachine', 'You can start it now: it is made, and it begins working when a computer is connected.')}
            ${' '}<${Action} tone="more" href="/v1/home?computers=1">${tr('home.agents.noMachineDoor', 'Add a computer →')}<//>
          <//>`}

        ${/* What the agent offers, as it will read on the Offerings page once the agent has started.
             The node writes one from the name and the purpose when the definition has none. */''}
        <${Facts} wide rows=${[{
          k: n('offer', 'What it offers'),
          v: offered?.title || String(draft.displayName || draft.name || ''),
          sub: `${offered?.ask || String(draft.purpose || '')} ${n('offerHint', 'This shows on your "Ask your agents" page once the agent has started. It has no price and is not on the Exchange.')}`.trim(),
        }]} />

        ${/* The one choice about the agent's results (Jouni, 2026-10-11): its own memory unless the
             person names a workspace. It is offered only when there is a workspace to name. */''}
        ${places.length > 0 && html`<${WorkplaceChoice} places=${places} value=${place} onChange=${setPlace} />`}

        ${problem && html`<${Note} kind="message" error>${problem}<//>`}

        <${FormActions}>
          <${Loud} control disabled=${busy} onClick=${start}>
            ${busy ? n('starting', 'Starting…') : n('start', 'Start the agent')}
          <//>
          ${proposal
            ? html`<${Action} tone="danger" disabled=${busy} onClick=${decline}>${n('decline', 'Decline')}<//>`
            : html`<${Action} disabled=${busy} onClick=${goHome}>${n('cancel', 'Cancel')}<//>`}
        <//>
        <${Stack} gap="tight">
          <${Note} kind="quiet">${n('after', 'You can change or remove the agent at any time.')}<//>
        <//>
      <//>
    <//>`;
}
