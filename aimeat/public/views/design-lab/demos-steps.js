/**
 * @file public/views/design-lab/demos-steps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design lab's live demos for the parts of a setup path: each drawn by its real
 *   component with the catalogue entry's example data (`ex`), one render per variant or state. The
 *   parts no page draws today are drawn by the code that still holds them (StepMatDone,
 *   StepBranchB, the home AgentCard), and the stray wrapper of the agent step is drawn as it is and
 *   without the masthead's name class.
 * @structure STEP_DEMOS · EXTRA_DEMOS — { [id]: { variants: [{ name, render(ex) }], height?, flush? } }
 * @usage import { STEP_DEMOS } from './demos-steps.js';
 * @version-history
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 2, the library view).
 */
import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { StepCard, StepLede } from '/components/StepCard.js';
import { PromptCard } from '/components/PromptCard.js';
import { PasteBox } from '/components/PasteBox.js';
import { TextInput } from '/components/TextInput.js';
import { NamedValue } from '/components/NamedValue.js';
import { ModeTabs, ModeTab } from '/components/ModeTabs.js';
import { StepList } from '/components/StepList.js';
import { WaitingNote } from '/components/WaitingNote.js';
import { FrontDoor } from '/components/FrontDoor.js';
import { StepMatDone } from '/views/home/step-mat.js';
import { StepBranchB } from '/views/home/step-branch-b.js';
import { StepAgent, AgentCard } from '/views/home/step-agent.js';

const html = htm.bind(h);
const noop = () => {};

/** StepMatDone and StepBranchB read the home's state; this is the smallest one they accept. */
const MAT_STATE = { mat: { url: '/v1/portfolio/sandbox', standaloneUrl: 'https://sandbox.aimeat.io/' }, ai: { client: 'ChatGPT' } };

const agent = (state) => ({ name: 'claude', gaii: 'claude#sandbox@aimeat-local-001-dev', health: { state }, total: 1 });

/**
 * The agent step as the home draws it, and the same with the wrapper's class taken off in this
 * copy only. The component is not changed: the class is removed from the drawn element here.
 */
function WrapperPair({ without }) {
  const ref = useRef(/** @type {HTMLDivElement|null} */ (null));
  useEffect(() => {
    if (!without || !ref.current) return undefined;
    const strip = () => ref.current?.querySelectorAll('.poster-step .poster-masthead-name')
      .forEach((el) => el.classList.remove('poster-masthead-name'));
    strip();
    const mo = new MutationObserver(strip);
    mo.observe(ref.current, { subtree: true, childList: true });
    return () => mo.disconnect();
  }, [without]);
  return html`<div ref=${ref}><${StepAgent} onChanged=${noop} showToast=${noop} /></div>`;
}

export const STEP_DEMOS = {
  'step-card': { variants: [
    { name: 'open', render: (ex) => html`<${StepCard} num=${ex.num} title=${ex.title}><${StepLede}>${ex.children}<//><//>` },
    { name: 'done (StepMatDone, unused)', render: () => html`<${StepMatDone} state=${MAT_STATE} />` },
    { name: 'limit (StepBranchB, unused)', render: () => html`<${StepBranchB} state=${MAT_STATE} onChanged=${noop} />` },
  ] },
  'prompt-card': { variants: [
    { name: 'default', render: (ex) => html`<${PromptCard} label=${ex.label} prompt=${ex.prompt} className=${ex.className}
        copyLabel=${ex.copyLabel} copiedLabel=${ex.copiedLabel} />` },
    { name: 'secondary copy button', render: (ex) => html`<${PromptCard} label=${ex.label} prompt=${ex.prompt} className="btn-outline"
        copyLabel=${ex.copyLabel} copiedLabel=${ex.copiedLabel} />` },
  ] },
  'paste-box': { variants: [
    { name: 'empty', render: (ex) => html`<${PasteBox} id=${ex.id} label=${ex.label} placeholder=${ex.placeholder} value="" onInput=${noop} />` },
    { name: 'with text', render: (ex) => html`<${PasteBox} id=${ex.id} label=${ex.label} placeholder=${ex.placeholder}
        value=${'<!doctype html>\n<html><body><h1>Welcome</h1></body></html>'} onInput=${noop} />` },
  ] },
  'text-input': { variants: [
    { name: 'empty', render: (ex) => html`<${TextInput} id=${ex.id} maxLength=${ex.maxLength} placeholder=${ex.placeholder} value="" onInput=${noop} />` },
    { name: 'with text', render: (ex) => html`<${TextInput} id=${ex.id} maxLength=${ex.maxLength} placeholder=${ex.placeholder} value="helper" onInput=${noop} />` },
  ] },
  'named-value': { variants: [
    { name: 'default', render: (ex) => html`<${NamedValue} label=${ex.label} value=${ex.value} renameLabel=${ex.renameLabel} onRename=${noop} />` },
  ] },
  'mode-tabs': { variants: [
    { name: 'first chosen', render: (ex) => html`<${ModeTabs}>${ex.tabs.map((tab, i) => html`<${ModeTab} key=${i} on=${tab.on} onClick=${noop}>${tab.children}<//>`)}<//>` },
    { name: 'second chosen', render: (ex) => html`<${ModeTabs}>${ex.tabs.map((tab, i) => html`<${ModeTab} key=${i} on=${i === 1} onClick=${noop}>${tab.children}<//>`)}<//>` },
  ] },
  'step-list': { variants: [
    { name: 'default', render: (ex) => html`<${StepList} steps=${ex.steps} />` },
  ] },
  'waiting-note': { variants: [
    { name: 'default', render: (ex) => html`<${WaitingNote} title=${ex.title}>${ex.children}<//>` },
  ] },
  'agent-card': { variants: [
    { name: 'at home', render: () => html`<${AgentCard} agent=${agent('production')} />` },
    { name: 'idle', render: () => html`<${AgentCard} agent=${agent('idle')} />` },
    { name: 'new', render: () => html`<${AgentCard} agent=${agent('new')} />` },
    { name: 'onboarding', render: () => html`<${AgentCard} agent=${agent('onboarding')} />` },
    { name: 'problem', render: () => html`<${AgentCard} agent=${{ ...agent('problem'), total: 12, problems: 2 }} />` },
  ] },
  'link-row': { variants: [
    { name: 'in StepMatDone', render: () => html`<${StepMatDone} state=${MAT_STATE} />` },
  ] },
  'app-list': { variants: [
    { name: 'in StepBranchB', render: () => html`<${StepBranchB} state=${MAT_STATE} onChanged=${noop} />` },
  ] },
  'teach-note': { variants: [
    { name: 'in StepMatDone (shows until the corner menu was opened once)', render: () => html`<${StepMatDone} state=${MAT_STATE} />` },
  ] },
  'front-door': { emptyNote: 'Draws only for a visitor who is not signed in. Open the front page in a private window to see it.', variants: [
    { name: 'default', render: () => html`<${FrontDoor} onNavigate=${noop} />` },
  ] },
};

/** Not catalogue entries: the pair Jouni decides on. */
export const EXTRA_DEMOS = {
  'wrapper-as-is': { variants: [{ name: 'as it is', render: () => html`<${WrapperPair} without=${false} />` }] },
  'wrapper-without': { variants: [{ name: 'without the masthead name class', render: () => html`<${WrapperPair} without=${true} />` }] },
};
