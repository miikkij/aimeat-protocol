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
 *   v1.0.0 — 2026-10-10 — Initial (wish-agentit-home-ruudusta-kuvaile-tilaa-ja-valitse-kone).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
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
import { SCOPE_TEMPLATES } from '/views/profile/agents/scope-model.js';
import { timeOfCron } from '/views/profile/scheduler/cron-words.js';
import {
  draftAgent, templateDraft, ownAiRequest, cronFor, startAgent, approveProposal, runtimeTools, readHomeAgents,
} from '/js/services/agent-draft.js';
import { machineName } from '/views/home/agents-band.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const n = (key, fallback) => tr('home.agentNew.' + key, fallback);

const NAME_SHAPE = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
const HOME = '/v1/home';

/** When a stored proposal's agent would work, read from what it carries. A schedule is not part of one. */
function whenOfProposal(p) {
  if (p?.run_mode === 'resident') return 'always';
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
  const [busy, setBusy] = useState(false);

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

  const takeDraft = useCallback((d) => {
    setDraft(d);
    setWhen(d.when || 'ask');
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
      const online = (home?.workers ?? []).filter((w) => w.has_key && w.connector?.online).map((w) => w.name);
      takeDraft(await draftAgent(wanted, { tools: await runtimeTools(online) }));
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
  }, [home, takeDraft]);

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
  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const start = async () => {
    if (!draft || busy) return;
    const name = String(draft.name || '').trim();
    if (!NAME_SHAPE.test(name)) { setProblem(n('badName', 'The short name is 3 to 40 lowercase letters, digits and hyphens, and starts with a letter.')); return; }
    if (String(draft.purpose || '').trim().length < 10) { setProblem(n('badPurpose', 'Say in one sentence what the agent is for.')); return; }
    const cron = when === 'clock' ? cronFor(days, clock) : '';
    if (when === 'clock' && !cron) { setProblem(n('badTime', 'Give the time as hours and minutes, for example 07:00.')); return; }
    setProblem('');
    setBusy(true);
    try {
      const choice = { when, cron, connector: machine || undefined };
      const made = { ...draft, name, purpose: draft.purpose.trim(), displayName: String(draft.displayName || '').trim() || name };
      const out = proposal
        ? await approveProposal(proposal.id, name, made, choice)
        : await startAgent(made, choice);
      const state = out?.attached ? 'running' : out?.waiting_for_connector ? 'waiting' : 'made';
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
  const scopes = proposal ? (proposal.scopes ?? []) : (SCOPE_TEMPLATES[draft.reach] ?? SCOPE_TEMPLATES.standard);
  const whenOptions = [
    { value: 'ask', label: tr('home.agents.when.ask', 'When I ask'), hint: n('whenAskHint', 'You give it a task when you need one. Otherwise it does nothing.') },
    { value: 'clock', label: tr('home.agents.when.clock', 'By the clock'), hint: n('whenClockHint', 'It gets the same task at the times you set.') },
    { value: 'talk', label: tr('home.agents.when.talk', 'When someone writes to it'), hint: n('whenTalkHint', 'It answers a message within seconds, at any hour.') },
    {
      value: 'always', label: tr('home.agents.when.always', 'Always on'), disabled: !residentHere,
      hint: residentHere
        ? n('whenAlwaysHint', 'It stays running the whole time. For an agent that follows something without a break.')
        : n('whenAlwaysOff', 'This machine starts an agent when work arrives and does not keep one running.'),
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

        ${proposal
          ? html`<${Facts} wide rows=${[{ k: n('reach', 'What it reaches'), v: areaLine(scopes, t) }]} />`
          : html`<${Choice} label=${n('reach', 'What it reaches')} hint=${areaLine(scopes, t)}
              value=${draft.reach} onChange=${set('reach')}
              options=${[['readonly', n('reachRead', 'Reads only')], ['standard', n('reachWrite', 'Reads and writes')]]} />`}

        ${machines.length > 1 && html`
          <${Choice} boxed cols=${2} label=${n('machine', 'On which machine')} value=${machine} onChange=${setMachine}
            options=${machines.map((c) => ({
              value: c.id, label: machineName(c),
              hint: c.online ? n('machineOn', 'Connected.') : n('machineOff', 'Not connected. The agent is made now and starts when this machine comes back.'),
            }))} />`}
        ${machines.length === 1 && html`
          <${Facts} wide rows=${[{
            k: n('machine', 'On which machine'), v: machineName(machines[0]),
            sub: machines[0].online ? n('machineOn', 'Connected.') : n('machineOff', 'Not connected. The agent is made now and starts when this machine comes back.'),
          }]} />`}
        ${machines.length === 0 && html`
          <${Note} kind="aside" size="small">
            <b>${tr('home.agents.noMachineTitle', 'An agent needs a machine to run on. You have no machine yet.')}</b>
            ${' '}${n('noMachine', 'You can start it now: it is made, and it begins working when a machine is connected.')}
            ${' '}<${Action} tone="more" href="/v1/home?machines=1">${tr('home.agents.noMachineDoor', 'Add a machine →')}<//>
          <//>`}

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
