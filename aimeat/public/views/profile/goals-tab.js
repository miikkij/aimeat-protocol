/**
 * @file public/views/profile/goals-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Settings & Controls › Goals: the machine room of the agents' goals. Every goal with its
 *   state; and an opened goal's rules, which the home's goal page does not show: how its work is shared
 *   and who takes part, its coordinator and what that coordinator may do without asking, the
 *   reactions that start the next work, its rounds, its limits, and the whole chain work by work (the
 *   link, the back-and-forth, who took it, its task, its cost). Every change goes through PATCH
 *   /v1/goals/{id}, the call the person's own AI makes with aimeat_goal_set; a change that would end
 *   running work is shown first (preview) and asked about.
 *
 *   The words a person may not know carry their question mark (explain.concept.*). The list starts
 *   with PageStart "goals" under the head, beside the title's question mark concept.goal
 *   (.claude/rules/page-guidance.md). Composed from library components only; it has no sheet of its own.
 * @structure GoalsTab (default) · GoalRules({ goal, agents, onSaved, confirm, showToast }) · goalSections(goal)
 * @usage Registered in profile.js TABS as { id: 'goals', component: GoalsTab }.
 * @version-history
 *   v1.5.0 — 2026-11-26 — The page is the SettingsPage and leads with where things stand. The list has
 *     a figure strip (how many goals run, how many wait for the person, how many are done, what they
 *     spent), the full crumb and the contents rail; every goal is read once and the filter is applied
 *     in the page. An opened goal has its own figures (state, works done, spent against its limit,
 *     when it ends) and its rules as numbered sections with the rail, whose first row leads back.
 *   v1.4.0 — 2026-11-09 — PageStart gets the page's title and concept, for "Explain this page to me".
 *   v1.3.0 — 2026-11-08 — The Rounds save sends the cron (and the condition) even when emptied, so the
 *     server refuses an empty cron on a clock round instead of keeping the old one; the server now keeps
 *     the time zone and the works per round this page does not show (group k3-goalrounds).
 *   v1.2.0 — 2026-11-08 — The settings a label cannot explain carry their question mark: the way the
 *     work is shared (goals.mode), when the coordinator is away (goals.substitute), the round time
 *     (goals.roundCron), works started per day (goals.perDay) and the minutes before a taken work
 *     returns to open work (goals.claimMinutes) (.claude/rules/page-guidance.md).
 *   v1.1.0 — 2026-11-08 — PageStart under the list's head: what goals are for, the prompt that asks
 *     one's own AI to propose a goal, and what follows; folded once a goal is listed
 *     (.claude/rules/page-guidance.md).
 *   v1.0.0 — 2026-10-25 — Initial (session cc-jouni-goals).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { ago, date, money } from '/js/format.js';
import { useConfirm } from '/components/Modal.js';
import { useOpenItem } from '/js/open-item.js';
import { listAgents } from '/js/services/agents.js';
import { SettingsPage } from '/components/SettingsPage.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { PageStart } from '/components/PageStart.js';
import { PageSection } from '/components/PageSection.js';
import { Fields } from '/components/Field.js';
import { DataTable } from '/components/DataTable.js';
import { Choice } from '/components/Choice.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { TextField } from '/components/TextField.js';
import { Action, Loud, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Spinner } from '/components/Spinner.js';
import { ErrorNote } from '/components/ErrorNote.js';
import { LineList } from '/components/LineList.js';
import { HelpLabel } from '/components/HelpTip.js';
import { listGoals, getGoal, updateGoal, previewGoal } from '/js/services/goals.js';
import { goalStatusWords } from '/views/home/goal.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const g = (key, fallback) => tr('profile.goals.' + key, fallback);
const csv = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

const PERMISSIONS = [
  ['subgoals', 'pSubgoals', 'Make subgoals within the spending limit'],
  ['assign', 'pAssign', 'Give work to your agents and as open work'],
  ['own_ai', 'pOwnAi', 'Give work to your own AI (Claude Code, Codex, Cursor)'],
  ['workflows', 'pWorkflows', 'Start your workflows'],
  ['app_tools', 'pAppTools', 'Use your apps\' free tools'],
  ['propose_agent', 'pPropose', 'Propose a new agent (you still approve the agent)'],
  ['raise_limits', 'pRaise', 'Raise the spending limit or move the end date'],
  ['change_done_when', 'pDoneWhen', 'Change when the goal is done'],
];
const permKey = { subgoals: 'subgoals', assign: 'assign', own_ai: 'ownAi', workflows: 'workflows', app_tools: 'appTools', propose_agent: 'proposeAgent', raise_limits: 'raiseLimits', change_done_when: 'changeDoneWhen' };

/** The rules of one goal, each part saved on its own. */
function GoalRules({ goal, agents, onSaved, confirm, showToast }) {
  const [mode, setMode] = useState(goal.mode);
  const [coordinator, setCoordinator] = useState(goal.coordinator ?? '');
  const [substitute, setSubstitute] = useState(typeof goal.substitute === 'string' ? goal.substitute : 'agent');
  const [subAgent, setSubAgent] = useState(typeof goal.substitute === 'object' ? goal.substitute.agent : '');
  const [anyAgent, setAnyAgent] = useState(goal.participants.anyAgent);
  const [names, setNames] = useState(goal.participants.agents.join(', '));
  const [skills, setSkills] = useState(goal.participants.skills.join(', '));
  const [perms, setPerms] = useState(Object.fromEntries(PERMISSIONS.map(([k]) => [k, !!goal.permissions[permKey[k]]])));
  const [usd, setUsd] = useState(goal.limits.usd === null ? '' : String(goal.limits.usd));
  const [hops, setHops] = useState(String(goal.limits.hops));
  const [perDay, setPerDay] = useState(String(goal.limits.tasksPerDay));
  const [fixRounds, setFixRounds] = useState(String(goal.limits.fixRounds));
  const [claimMin, setClaimMin] = useState(String(goal.limits.claimMinutes));
  const [trigger, setTrigger] = useState(goal.rounds?.trigger ?? 'none');
  const [cron, setCron] = useState(goal.rounds?.cron ?? '');
  const [condition, setCondition] = useState(goal.rounds?.condition ?? '');
  const [rWhen, setRWhen] = useState('');
  const [rTitle, setRTitle] = useState('');
  const [rAgent, setRAgent] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const apply = async (patch) => {
    try {
      await updateGoal(goal.id, { ...patch, reason: g('reasonSettings', 'changed in Settings & Controls') });
      showToast?.(g('saved', 'Saved'));
      onSaved();
    } catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(''); }
  };
  // A change that would end running work is shown first and asked about (PATCH with preview).
  const save = async (part, patch) => {
    setBusy(part); setErr('');
    try {
      const pv = await previewGoal(goal.id, patch);
      const ends = pv?.data?.preview?.ends ?? [];
      if (!ends.length) { await apply(patch); return; }
      setBusy('');
      confirm(
        ends.map((e) => `${e.title} (${e.agent ?? ''}, ${money(e.costUsd)})`).join(' · ') + '. ' + g('endsNote', 'What they did so far stays as material.'),
        () => { setBusy(part); apply(patch); },
        { title: g('endsTitle', 'This change ends running work'), confirmLabel: g('endsOk', 'Change it') },
      );
    } catch (e) { setErr(e?.message || String(e)); setBusy(''); }
  };

  const agentOptions = [['', g('pick', 'Pick an agent')], ...agents.map((a) => [a, a])];
  const label = (term, words) => html`<${HelpLabel} term=${term} label=${words}>${words}<//>`;
  // Each section's number, from the list the contents rail reads (goalSections).
  const num = Object.fromEntries(goalSections(goal).map((s) => [s.id, s.num]));

  return html`
    ${err && html`<${ErrorNote} text=${err} />`}

    <${PageSection} id="gl-share" num=${num['gl-share']} title=${label('concept.coordinator', g('shareTitle', 'How the work is shared, and who takes part'))}>
      <${Fields}>
      <${Choice} label=${g('mode', 'Way')} help="goals.mode" value=${mode} onChange=${setMode} options=${[
        ['single', g('modeSingle', 'One agent takes the whole goal')], ['coordinator', g('modeCoordinator', 'A coordinator leads')], ['plan', g('modePlan', 'A fixed plan')]]} />
      ${mode === 'coordinator' && html`
        <${Select} label=${g('coordinator', 'Coordinator')} value=${coordinator} onChange=${setCoordinator} options=${agentOptions} />
        <${Choice} label=${g('substitute', 'When the coordinator is away')} help="goals.substitute" value=${substitute} onChange=${setSubstitute} options=${[
          ['node', g('subNode', 'AIMEAT continues the work by its rules')], ['agent', g('subAgent', 'Another agent')], ['wait', g('subWait', 'Wait for the coordinator')]]} />
        ${substitute === 'agent' && html`<${Select} label=${g('substituteAgent', 'Substitute')} value=${subAgent} onChange=${setSubAgent} options=${agentOptions} />`}`}
      <${Check} checked=${anyAgent} onChange=${setAnyAgent}>${g('anyAgent', 'Any of my agents may take part')}<//>
      ${!anyAgent && html`
        <${TextField} label=${g('agents', 'Agents, separated by commas')} value=${names} onInput=${setNames} />
        <${TextField} label=${g('skills', 'Or agents that know these skills, separated by commas')} value=${skills} onInput=${setSkills} help="concept.open_work" />`}
      <${Actions}><${Loud} control disabled=${!!busy} onClick=${() => save('share', {
        mode, coordinator: mode === 'coordinator' ? (coordinator || null) : null,
        substitute: substitute === 'agent' ? { agent: subAgent } : substitute,
        any_agent: anyAgent, agents: csv(names), skills: csv(skills),
      })}>${g('save', 'Save')}<//><//>
      <//>
    <//>

    ${goal.mode === 'coordinator' && html`<${PageSection} id="gl-perms" num=${num['gl-perms']} title=${label('concept.coordinator', g('permsTitle', 'What the coordinator may do without asking'))}>
      ${PERMISSIONS.map(([k, key, fallback]) => html`
        <${Check} key=${k} ruled checked=${perms[k]} onChange=${(on) => setPerms((p) => ({ ...p, [k]: on }))}>${g(key, fallback)}<//>`)}
      <${Note} kind="quiet">${g('floor', 'Purchases, mail or posts in your name, and deleting always wait for you. A goal cannot change that.')}<//>
      <${Actions}><${Loud} control disabled=${!!busy} onClick=${() => save('perms', { permissions: perms })}>${g('save', 'Save')}<//><//>
    <//>`}

    <${PageSection} id="gl-reactions" num=${num['gl-reactions']} title=${label('concept.follow_up', g('reactionsTitle', 'Reactions: when this is done, who continues'))}>
      ${goal.reactions.length === 0 && html`<${Note} kind="quiet">${g('noReactions', 'No reactions. Agents give the next work to each other themselves.')}<//>`}
      <${LineList} rows=${goal.reactions.map((r) => ({
        id: r.id,
        name: r.when.wants ? g('whenWants', 'When every "{s}" work is done').replace('{s}', r.when.wants) : g('whenWorks', 'When {n} named works are done').replace('{n}', String(r.when.works?.length ?? 0)),
        text: `${r.then.title} · ${r.then.agent ?? (r.then.wants ?? []).join(', ') ?? ''}${r.firedRounds.length ? ' · ' + g('fired', 'started {n} times').replace('{n}', String(r.firedRounds.length)) : ''}`,
      }))} />
      <${Fields}>
      <${TextField} label=${g('rWhen', 'When every work for this skill is done')} value=${rWhen} onInput=${setRWhen} />
      <${TextField} label=${g('rTitle', 'Then this work starts')} value=${rTitle} onInput=${setRTitle} />
      <${Select} label=${g('rAgent', 'For this agent')} value=${rAgent} onChange=${setRAgent} options=${agentOptions} />
      <${Actions}><${Loud} control disabled=${!!busy || !rWhen.trim() || !rTitle.trim()} onClick=${() => save('reactions', {
        reactions: [...goal.reactions.map((r) => ({ when: r.when, then: { title: r.then.title, ...(r.then.agent ? { agent: r.then.agent } : {}), ...(r.then.wants ? { wants: r.then.wants } : {}) } })),
          { when: { wants: rWhen.trim() }, then: { title: rTitle.trim(), ...(rAgent ? { agent: rAgent } : {}) } }],
      })}>${g('addReaction', 'Add the reaction')}<//><//>
      <//>
    <//>

    <${PageSection} id="gl-rounds" num=${num['gl-rounds']} title=${label('concept.round', g('roundsTitle', 'Rounds'))}>
      <${Fields}>
      <${Choice} label=${g('trigger', 'A round starts')} value=${trigger} onChange=${setTrigger} options=${[
        ['none', g('tNone', 'No rounds: the goal ends')], ['manual', g('tManual', 'When I start it')], ['clock', g('tClock', 'On a schedule')], ['condition', g('tCondition', 'On a schedule, only when a condition holds (a watch)')]]} />
      ${(trigger === 'clock' || trigger === 'condition') && html`
        <${TextField} label=${g('cron', 'When (cron, for example 0 7 * * 1-5)')} value=${cron} onInput=${setCron} code help="goals.roundCron" />`}
      ${trigger === 'condition' && html`<${TextField} label=${g('condition', 'Act only when')} value=${condition} onInput=${setCondition} help="concept.watch" />`}
      ${/* The save names only the fields on this page. The server keeps what it leaves out (the time
            zone, the works per round), and an emptied field is sent empty, so an empty cron on a clock
            round is refused and an emptied condition is cleared. */''}
      <${Actions}><${Loud} control disabled=${!!busy} onClick=${() => save('rounds', {
        rounds: trigger === 'none' ? null : {
          trigger,
          ...(trigger === 'clock' || trigger === 'condition' ? { cron: cron.trim() } : {}),
          ...(trigger === 'condition' ? { condition: condition.trim() } : {}),
        },
      })}>${g('save', 'Save')}<//><//>
      <//>
    <//>

    <${PageSection} id="gl-limits" num=${num['gl-limits']} title=${g('limitsTitle', 'Limits')}>
      <${Fields}>
      <${TextField} label=${g('usd', 'Spending limit for the whole goal ($, empty = none)')} value=${usd} onInput=${setUsd} inputMode="decimal" help="concept.spending" />
      <${TextField} label=${g('hops', 'Chain length')} value=${hops} onInput=${setHops} inputMode="numeric" help="concept.chain_length" />
      <${TextField} label=${g('fixRounds', 'Back-and-forth rounds')} value=${fixRounds} onInput=${setFixRounds} inputMode="numeric" help="concept.fix_round" />
      <${TextField} label=${g('perDay', 'Works started per day')} value=${perDay} onInput=${setPerDay} inputMode="numeric" help="goals.perDay" />
      <${TextField} label=${g('claimMin', 'A taken work returns to open work after this many minutes without progress')} value=${claimMin} onInput=${setClaimMin} inputMode="numeric" help="goals.claimMinutes" />
      <${Actions}><${Loud} control disabled=${!!busy} onClick=${() => save('limits', { limits: {
        usd: usd.trim() === '' ? null : Number(usd), hops: Number(hops), tasks_per_day: Number(perDay), fix_rounds: Number(fixRounds), claim_minutes: Number(claimMin) } })}>${g('save', 'Save')}<//><//>
      <//>
    <//>

    <${PageSection} id="gl-chain" num=${num['gl-chain']} title=${g('chainTitle', 'The whole chain, work by work')} count=${goal.works.length}>
      <${DataTable} scroll headers=${[g('hWork', 'Work'), g('hLink', 'Link'), g('hLoop', 'Back and forth'), g('hWho', 'Who'), g('hState', 'State'), g('hCost', 'Cost')]}
        rows=${goal.works.map((w) => [
          w.title, String(w.hop), String(w.loop),
          w.runner === 'model' ? g('modelName', 'AIMEAT\'s model') : w.claimed_by ?? w.agent ?? (w.kind === 'human' ? g('you', 'you') : (w.wants ?? []).join(', ')),
          w.status + (w.settled_at ? ` · ${ago(w.settled_at)}` : ''), w.cost_usd ? money(w.cost_usd) : '–',
        ])} />
      <${Actions}>
        <${Action} small copy=${JSON.stringify(goal, null, 2)} copiedLabel=${g('copied', 'Copied')}>${g('copyJson', 'Copy the whole goal as JSON')}<//>
        <${Action} tone="more" href=${`/v1/home?goal=${encodeURIComponent(goal.id)}`}>${g('openHome', 'Open it on the home →')}<//>
      <//>
    <//>`;
}

export default function GoalsTab({ showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [goals, setGoals] = useState(null);
  const [filter, setFilter] = useState('running');
  const [openId, setOpenId] = useState(null);
  const [open, setOpen] = useState(null);
  const [agents, setAgents] = useState([]);
  const [err, setErr] = useState('');

  // One read of every goal, whatever the filter: the node filters the same list in memory, and the
  // figures need them all.
  const load = useCallback(async () => {
    try { setGoals((await listGoals())?.data?.goals ?? []); setErr(''); }
    catch (e) { setErr(e?.message || String(e)); setGoals([]); }
  }, []);
  const loadOpen = useCallback(async (id) => {
    if (!id) { setOpen(null); return; }
    try { setOpen((await getGoal(id))?.data?.goal ?? null); }
    catch (e) { swallowed('goals tab: open', e); setOpen(null); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { listAgents().then((list) => setAgents((list ?? []).map((a) => a.name))).catch((e) => swallowed('goals tab: agents', e)); }, []);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('goal');
    if (id) setOpenId(id);
  }, []);
  useEffect(() => { loadOpen(openId); }, [openId, loadOpen]);
  useOpenItem('goals', (id) => setOpenId(id), goals !== null);
  const liveRef = useRef(null);
  liveRef.current = () => { load(); if (openId) loadOpen(openId); };
  useEffect(() => onLiveUpdate(['goals'], () => liveRef.current()), []);

  const trail = [t('nav.profile'), t('profile.landing.menuAutomation')];
  const toList = (e) => { e?.preventDefault?.(); setOpenId(null); };

  // An opened goal takes the place of the list: where it stands as figures, then its rules as
  // numbered sections beside the contents rail, whose first row is the way back to the list.
  if (openId && open) {
    const rules = toRuleShape(open);
    const state = goalStatusWords(open.status).word;
    return html`
      <${SettingsPage} name="goal" page
        crumb=${[...trail, { label: g('title', 'Goals'), href: '/v1/profile?tab=goals', onClick: toList }, { label: open.title, here: true }]}
        title=${open.title} desc=${open.statement !== open.title ? open.statement : undefined}
        strip=${html`<${FigureStrip} wrap items=${[
          { key: 'state', n: state, tone: 'word', label: g('hState', 'State') },
          { key: 'done', n: open.progress.done, of: `/${open.progress.total}`, label: g('stripWorksDone', 'works done'),
            sub: open.progress.waiting_for_you ? g('stripAsksYou', 'wait for you: {n}').replace('{n}', String(open.progress.waiting_for_you)) : undefined },
          { key: 'spent', n: money(open.spent.usd), label: g('stripSpent', 'spent'),
            sub: open.limits.usd !== null && open.limits.usd !== undefined ? g('stripLimit', 'limit {m}').replace('{m}', money(open.limits.usd)) : g('stripNoLimit', 'no spending limit') },
          { key: 'ends', n: open.ends_at ? date(open.ends_at) : '·', tone: open.ends_at ? 'word' : 'dim', label: g('hEnds', 'Ends'),
            sub: !open.ends_at && open.renew_by ? g('renewBy', 'renew by {d}').replace('{d}', date(open.renew_by)) : undefined },
        ]} />`}
        railTitle=${t('profile.landing.railTitle')} back=${{ label: g('back', 'All goals'), href: '/v1/profile?tab=goals', onClick: toList }}
        sections=${goalSections(rules)}
        after=${html`<${ConfirmUI} />`}>
        <${GoalRules} key=${open.id + open.updated_at} goal=${rules} agents=${agents} onSaved=${() => loadOpen(open.id)} confirm=${confirm} showToast=${showToast} />
      <//>`;
  }

  // The list. Every goal is read once and the filter is applied here, so the figures can say how
  // many run, how many wait for the person and how many are done whatever the filter shows.
  const all = goals ?? [];
  const running = all.filter((x) => !SETTLED.has(x.status));
  const asks = all.filter((x) => x.status === 'proposed').length + running.reduce((n, x) => n + (x.progress?.waiting_for_you ?? 0), 0);
  const doneCount = all.filter((x) => x.status === 'done').length;
  const spent = all.reduce((n, x) => n + (x.spent?.usd ?? 0), 0);
  const shown = filter === 'all' ? all : filter === 'running' ? running : all.filter((x) => x.status === filter);
  const strip = goals === null ? html`<${FigureStrip} loading=${4} />` : html`<${FigureStrip} wrap items=${[
    { key: 'running', n: running.length, label: g('stripRunning', 'running'), onClick: () => setFilter('running'),
      sub: g('stripWorking', 'works in progress: {n}').replace('{n}', String(running.reduce((n, x) => n + (x.working_now?.length ?? 0), 0))) },
    { key: 'asks', n: asks, tone: asks ? 'notice' : undefined, label: g('stripAsks', 'wait for you'), sub: g('stripAsksSub', 'proposals and questions') },
    { key: 'done', n: doneCount, label: g('stripDone', 'done'), onClick: () => setFilter('done') },
    { key: 'spent', n: money(spent), label: g('stripSpent', 'spent'), sub: g('stripSpentSub', 'by every goal together') },
  ]} />`;

  return html`
    <${SettingsPage} name="goals" crumb=${[...trail, g('title', 'Goals')]}
      title=${g('title', 'Goals')} help="concept.goal"
      desc=${g('desc', 'Every goal you or your AI gave your agents. Here are the rules the work moves by: who takes part, what the coordinator may do, the reactions, the rounds, the limits and the whole chain.')}
      strip=${strip}
      start=${/* A goal is given on the home or by one's own AI, so the start has no button here. */
        html`<${PageStart} id="goals" done=${goals === null ? null : all.length > 0} title=${g('title', 'Goals')} concept="concept.goal" />`}
      railTitle=${t('profile.landing.railTitle')}
      sections=${[{ id: 'gl-list', num: '01', label: g('title', 'Goals'), count: goals === null ? undefined : shown.length }]}
      pagesLabel=${t('profile.landing.railPages')}
      pages=${[{ href: '/v1/home', label: t('nav.home'), key: 'home' }, { tab: 'fleet', label: t('profile.tabs.fleet'), key: 'fleet' }, { tab: 'agents', label: t('profile.tabs.agents'), key: 'agents' }]}
      after=${html`<${ConfirmUI} />`}>
      <${PageSection} id="gl-list" num="01" title=${g('title', 'Goals')} count=${goals === null ? undefined : shown.length}
        doors=${html`<${Choice} tone="filter" ariaLabel=${g('show', 'Show')} value=${filter} onChange=${setFilter} options=${[
          ['running', g('fRunning', 'Running')], ['done', g('fDone', 'Done')], ['stopped', g('fStopped', 'Stopped')], ['expired', g('fExpired', 'Ended')], ['all', g('fAll', 'All')]]} />`}>
        ${err && html`<${ErrorNote} text=${err} />`}
        ${goals === null ? html`<${Spinner} />` : shown.length === 0
          ? html`<${Note} kind="quiet">${all.length === 0 ? g('none', 'No goals here. Give one on your home, or say it to your own AI.') : g('noneShown', 'No goal is in this state.')}<//>`
          : html`<${DataTable} scroll headers=${[g('hGoal', 'Goal'), g('hState', 'State'), g('hProgress', 'Done'), g('hSpent', 'Spent'), g('hEnds', 'Ends'), g('hCarrier', 'Carried by')]}
              rows=${shown.map((x) => [
                html`<${Action} tone="inline" onClick=${() => setOpenId(x.id)}>${x.title}<//>`,
                goalStatusWords(x.status).word,
                `${x.progress.done} / ${x.progress.total}`,
                x.limits.usd !== null ? `${money(x.spent.usd)} / ${money(x.limits.usd)}` : money(x.spent.usd),
                x.ends_at ? date(x.ends_at) : (x.renew_by ? g('renewBy', 'renew by {d}').replace('{d}', date(x.renew_by)) : '–'),
                x.mode === 'coordinator' ? x.coordinator : x.mode === 'plan' ? g('plan', 'plan') : g('single', 'one agent'),
              ])} />`}
      <//>
    <//>`;
}

/** The states a goal no longer moves in. */
const SETTLED = new Set(['done', 'stopped', 'expired']);

/**
 * The sections of an opened goal in page order, numbered. The contents rail and GoalRules read the
 * same list, so a section that a goal does not have (the coordinator's permissions) leaves no gap.
 */
function goalSections(goal) {
  return [
    ['gl-share', g('shareTitle', 'How the work is shared, and who takes part')],
    goal.mode === 'coordinator' ? ['gl-perms', g('permsTitle', 'What the coordinator may do without asking')] : null,
    ['gl-reactions', g('reactionsTitle', 'Reactions: when this is done, who continues'), goal.reactions.length || undefined],
    ['gl-rounds', g('roundsTitle', 'Rounds')],
    ['gl-limits', g('limitsTitle', 'Limits')],
    ['gl-chain', g('chainTitle', 'The whole chain, work by work'), goal.works.length],
  ].filter(Boolean).map(([id, label, count], i) => ({ id, num: String(i + 1).padStart(2, '0'), label, count }));
}

/** The goal view's snake_case fields in the shape GoalRules reads. */
function toRuleShape(v) {
  return {
    ...v,
    participants: { anyAgent: v.participants.anyAgent ?? v.participants.any_agent ?? true, agents: v.participants.agents ?? [], skills: v.participants.skills ?? [] },
    limits: { usd: v.limits.usd ?? null, hops: v.limits.hops, tasksPerDay: v.limits.tasksPerDay ?? v.limits.tasks_per_day, fixRounds: v.limits.fixRounds ?? v.limits.fix_rounds, claimMinutes: v.limits.claimMinutes ?? v.limits.claim_minutes },
  };
}
