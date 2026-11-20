/**
 * @file views/goal-start.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The new entry (/v1/goal-start): the person says, in their own words, what they want
 *   their AIMEAT to do, and gets one message for their own AI. The AI then names the capabilities it
 *   needs, the person changes that list, and the AI builds it (skill node:aimeat-goal-recipes).
 *
 *   WHY (Jouni, 2026-11-16 and 2026-11-20). The basics are learned while building something bigger,
 *   and nobody is pigeonholed into a menu of ready solutions: the page shows no capability list. A
 *   person alone may want to sell; a team wants its repeated and manual work gone, so the switch
 *   changes the headline, the four helper questions and what the message asks. The helper questions
 *   show only when the person has no profile yet: with one, their AI already knows what they repeat
 *   (decision-uusi-sis-ntulo-kysymykset-profiilista-ja-koulutus-omana-orga). A team link
 *   (`?mode=team` or `?org=<organism id>`) opens the team side.
 * @structure MODES · composeMessage(mode, dream, org, hasProfile) · default export GoalStart()
 * @usage routed at /v1/goal-start by spa.html; listed in src/data/spa-page-paths.ts
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-uusi-sis-ntulo-perusteet-opitaan-isoa-tavoitetta-rakentaessa).
 */
import { h } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import { organismNames } from '/js/organism-names.js';
import { swallowed } from '/js/swallowed.js';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { PageFrame } from '/components/PageFrame.js';
import { PageHead } from '/components/PageHead.js';
import { ModeTabs, ModeTab } from '/components/ModeTabs.js';
import { TextArea } from '/components/TextField.js';
import { Note } from '/components/Note.js';
import { PromptCard } from '/components/PromptCard.js';
import { Section } from '/components/Section.js';
import { Action, Actions } from '/components/Action.js';
import { useJourney } from '/views/home/journey-steps.js';

const MODES = {
  solo: { questions: ['q1', 'q2', 'q3', 'q4'] },
  team: { questions: ['q1', 'q2', 'q3', 'q4'] },
};

/** `?mode=team` or a team's organism in `?org=` open the team side; anything else is the person alone. */
function fromUrl() {
  const q = new URLSearchParams(location.search);
  const org = (q.get('org') || '').trim();
  return { mode: q.get('mode') === 'team' || org ? 'team' : 'solo', org };
}

/**
 * The message the person pastes into their own AI, in the page's language. The team's organism is
 * named on the team side only, by its name and its id (the AI needs the id for its tools).
 */
export function composeMessage(mode, dream, org, hasProfile, orgName) {
  const k = (key, vars) => t(`goalStart.${mode}.${key}`, vars);
  const lines = [
    k('intro'),
    dream.trim() || t('goalStart.dreamEmpty'),
    '',
    t('goalStart.msgRead'),
    hasProfile ? t('goalStart.msgProfile') : '',
    t('goalStart.msgCapabilities'),
    mode === 'team' ? t('goalStart.team.msgReplaces') : '',
    t('goalStart.msgPlain'),
    mode === 'team' && org ? t('goalStart.team.msgOrg', { org: orgName ? `${orgName} (${org})` : org }) : '',
  ].filter((line, i) => i < 3 || line);
  return lines.join('\n');
}

export default function GoalStart() {
  const initial = useMemo(fromUrl, []);
  const [mode, setModeRaw] = useState(initial.mode);
  const [dream, setDream] = useState('');
  const [hint, setHint] = useState('');
  const [orgName, setOrgName] = useState('');
  const { journey } = useJourney();
  const profile = journey?.profile ?? null;
  const hasProfile = !!profile && Object.values(profile).some((v) => typeof v === 'string' && v.trim());
  const m = (key, vars) => t(`goalStart.${mode}.${key}`, vars);
  // A question picked on one side is that side's: switching clears it from the box.
  const setMode = (next) => { setModeRaw(next); setHint(''); };
  const message = composeMessage(mode, dream, initial.org, hasProfile, orgName);

  useEffect(() => { document.title = `${t('goalStart.label')} — AIMEAT`; }, []);
  // The team's name for the message, when the person belongs to it; an organism they are not in stays an id.
  useEffect(() => {
    if (!initial.org) return;
    organismNames().then((names) => setOrgName(names.get(initial.org) || '')).catch((err) => swallowed('goal-start: organism name', err));
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- once, from the address

  return html`
    <${PageFrame} width="narrow">
      <${PageHead} label=${t('goalStart.label')} title=${m('title')} desc=${m('lede')} />
      <${ModeTabs}>
        <${ModeTab} on=${mode === 'solo'} onClick=${() => setMode('solo')}>${t('goalStart.modeSolo')}<//>
        <${ModeTab} on=${mode === 'team'} onClick=${() => setMode('team')}>${t('goalStart.modeTeam')}<//>
      <//>

      <${Section} id="goal-dream" title=${m('fieldLabel')} first>
        <${TextArea} ariaLabel=${m('fieldLabel')} rows=${5} grow value=${dream}
          placeholder=${hint || m('placeholder')} onInput=${setDream} />
        ${hasProfile
          ? html`<${Note} kind="hint">${t('goalStart.profileKnown')}<//>`
          : html`
            <${Note} kind="hint">${t('goalStart.questionsLead')}<//>
            <${Actions} apart>
              ${MODES[mode].questions.map((q) => html`
                <${Action} key=${q} tone="inline" small onClick=${() => setHint(m(q))}>${m(q)}<//>`)}
            <//>`}
      <//>

      <${Section} id="goal-message" title=${t('goalStart.messageTitle')}>
        <${Note} kind="lead">${m('paste')}<//>
        <${PromptCard} loud label=${t('goalStart.messageLabel')} prompt=${message} copyLabel=${t('goalStart.copy')} copiedLabel=${t('goalStart.copied')} />
        <${Note} kind="hint">${t('goalStart.after')}<//>
      <//>
    <//>`;
}
