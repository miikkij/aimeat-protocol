/**
 * @file public/views/profile/organisms/team-sections.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sections a team's page has before the organism's own (team setup T14 and T15):
 *   what waits for you in this team, the team context and the team skill every member's AI gets, and
 *   "You in this team": your own AI, what it may do here, and what the others see of you. A lead and a
 *   member see the same page; what waits differs because it is read for the reader. The page shows
 *   the state; changes are made in the person's own AI ("the AI chat is the primary interface").
 *   Reads GET /v1/teams/status?organism_id= and GET /v1/teams/waiting, and reads again on a live
 *   update of organisms or memory.
 *   Under what waits, the way for an AI that cannot connect over MCP (T9): the team's ready prompt to
 *   copy, and the answer pasted back, shown as what would be written before it is.
 * @structure useTeam · PromptPath · TeamSections
 * @usage const team = useTeam(org); … ${team ? html`<${TeamSections} team=${team} me=${owner} num=${num} />` : null}
 * @version-history
 *   v1.2.0 — 2026-11-27 — TeamSections takes `first`: the shared place's page draws the three sections
 *     after its workspaces, so the first of them has a rule over it there; additive.
 *   v1.1.0 — 2026-11-15 — "You in this team" says whether you went through the team's AI onboarding (T11).
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T14, T15).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t, tOr } from '/js/i18n.js';
import { apiGet, apiPost } from '/js/api.js';
import { TextArea } from '/components/TextField.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { Section } from '/components/Section.js';
import { LineList } from '/components/LineList.js';
import { Note } from '/components/Note.js';

const html = htm.bind(h);
const x = (key, vars) => t(`organisms.team.${key}`, vars);
const TEAM_TYPES = ['team', 'virtual team'];

/** The team status and what waits for the reader, or null when the organism is not a team. */
export function useTeam(org) {
  const isTeam = TEAM_TYPES.includes(org?.type);
  const [team, setTeam] = useState(null);
  useEffect(() => {
    if (!isTeam) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const id = encodeURIComponent(org.id);
        const [st, w] = await Promise.all([apiGet(`/v1/teams/status?organism_id=${id}`), apiGet('/v1/teams/waiting')]);
        if (cancelled) return;
        const status = st?.data?.teams?.[0] ?? null;
        const waiting = w?.data ?? {};
        setTeam(status ? {
          status,
          items: (waiting.items ?? []).filter((i) => i.organism_id === org.id),
          approvals: (waiting.approvals ?? []).filter((a) => a.organism_id === org.id),
        } : null);
      } catch (err) { swallowed('team-sections: load', err); }
    };
    load();
    const off = onLiveUpdate(['organisms', 'memory'], load);
    return () => { cancelled = true; off(); };
  }, [org?.id, isTeam]);
  return team;
}

/**
 * For an AI that cannot connect over MCP (team setup T9): copy the team's ready prompt into your own
 * chat, paste its answer back, see what would be written, and write it. GET /v1/teams/:id/prompt and
 * POST /v1/teams/:id/paste (a dry run first, as the route defaults to).
 */
function PromptPath({ orgId }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [text, setText] = useState('');
  const [plan, setPlan] = useState(null);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  const base = `/v1/teams/${encodeURIComponent(orgId)}`;
  useEffect(() => {
    if (!open || prompt) return;
    apiGet(`${base}/prompt`).then((r) => setPrompt(r?.data?.prompt ?? ''))
      .catch((err) => { swallowed('team-sections: prompt', err); setError(err?.message || x('failed')); });
  }, [open, prompt, base]);
  const paste = async (dryRun) => {
    setError('');
    try {
      const r = await apiPost(`${base}/paste`, { text, dry_run: dryRun });
      if (dryRun) setPlan(r?.data?.entries ?? []);
      else { setDone(r?.data?.written ?? 0); setPlan(null); setText(''); }
    } catch (err) { swallowed('team-sections: paste', err); setError(err?.message || x('failed')); }
  };
  return html`
    <${Section} fold id="og-team-prompt" num="" title=${x('promptTitle')} sub=${x('promptSub')} open=${open} onToggle=${() => setOpen((o) => !o)}>
      ${prompt ? html`<${Actions}><${Action} small copy=${prompt} copiedLabel=${x('copied')}>${x('copyPrompt')}<//><//>` : null}
      <${TextArea} label=${x('pasteLabel')} rows=${6} value=${text} onInput=${(v) => { setText(v); setPlan(null); setDone(null); }} />
      <${Actions}><${Action} small disabled=${!text.trim()} onClick=${() => paste(true)}>${x('check')}<//><//>
      ${plan ? html`
        ${plan.length ? html`<${LineList} rows=${plan.map((e, i) => ({ id: String(i), name: e.title, text: x(`tag.${e.tag}`), href: `/v1/profile?tab=organisms&org=${encodeURIComponent(orgId)}` }))} />
          <${Actions}><${Loud} control onClick=${() => paste(false)}>${x('write', { n: plan.length })}<//><//>`
          : html`<${Note}>${x('nothingFound')}<//>`}` : null}
      ${done !== null ? html`<${Note} kind="message">${x('written', { n: done })}<//>` : null}
      ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
    <//>`;
}

function when(iso) {
  return iso ? String(iso).slice(0, 10) : '';
}

/**
 * The three sections, numbered from `num(1)`. `first` (default true): the first of them opens the
 * page, with no rule over it; the shared place's page draws them after its workspaces and passes false.
 * @param {{ team: any, me: string, num: (i: number) => string, first?: boolean }} p
 */
export function TeamSections({ team, me, num, first = true }) {
  const { status, items, approvals } = team;
  const orgHref = (ws) => `/v1/profile?tab=organisms&org=${encodeURIComponent(status.organism_id)}${ws ? `&ws=${encodeURIComponent(ws)}` : ''}`;
  const waitingRows = [
    ...items.map((i) => ({ id: `i-${i.id}`, name: i.title, text: [tOr(`organisms.team.kind.${i.kind}`, i.kind), i.by ? x('by', { name: i.by }) : '', i.detail].filter(Boolean).join(' · '), href: orgHref(i.workspace) })),
    ...approvals.map((a) => ({ id: `a-${a.id}`, name: a.prompt || a.action, text: x('approval'), href: a.decide_url })),
  ];
  const mine = (status.members ?? []).find((m) => m.account === me);
  const agent = mine?.ai?.agents?.[0];
  const ctx = status.context;
  const ws = status.workspaces ?? {};
  return html`
    <${Section} id="og-team-waiting" num=${num(1)} first=${first} title=${x('waitingTitle')} count=${waitingRows.length}>
      ${waitingRows.length
        ? html`<${LineList} rows=${waitingRows} />`
        : html`<${Note}>${x('waitingNone')}<//>`}
      <${Note} kind="quiet">${x('waitingChat')}<//>
      <${PromptPath} orgId=${status.organism_id} />
    <//>
    <${Section} id="og-team-brain" num=${num(2)} title=${x('brainTitle')}>
      <${LineList} rows=${[
        { id: 'context', name: x('contextName'), text: ctx ? `${ctx.summary || ctx.core.slice(0, 160)}${ctx.updated_at ? ` · ${x('updated', { date: when(ctx.updated_at) })}` : ''}` : x('contextNone'), href: orgHref(ws.shared) },
        { id: 'skill', name: x('skillName'), text: status.skill ? x('skillText') : x('skillNone'), href: '/v1/profile?tab=skills' },
      ]} />
      <${Note} kind="quiet">${status.you_lead ? x('brainLead') : x('brainMember')}<//>
    <//>
    <${Section} id="og-team-you" num=${num(3)} title=${x('youTitle')}>
      <${LineList} rows=${[
        { id: 'ai', name: agent ? agent.name : x('aiNone'), text: agent ? x('aiText', { date: when(agent.last_seen) }) : x('aiNoneText'), href: '/v1/profile?tab=agents' },
        { id: 'access', name: x('accessName'), text: x('accessText'), href: orgHref(ws.shared) },
        { id: 'onboard', name: x('onboardName'), text: status.ai_onboarding?.you ? x('onboardDone', { date: when(status.ai_onboarding.you) }) : x('onboardTodo'), href: '/v1/profile?tab=skills' },
      ]} />
      <${Note}>${x('seenText')}<//>
      <${Note}>${x('unseenText')}<//>
    <//>`;
}
