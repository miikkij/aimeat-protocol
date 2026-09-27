/**
 * @file public/views/design-lab/demos-steps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The design lab's live demos for the parts of a setup path: each drawn by its real
 *   component with the catalogue entry's example data (`ex`), one render per variant or state.
 *   WrapperPair draws the agent step as it is and without the masthead's name class, for the
 *   decision about that wrapper (decision-samples.js).
 * @structure STEP_DEMOS — { [id]: { variants: [{ name, render(ex) }], height?, flush? } } · WrapperPair({ without })
 * @usage import { STEP_DEMOS } from './demos-steps.js';
 * @version-history
 *   v1.3.0 — 2026-09-27 — PromptCard's loud and quiet.
 *   v1.2.0 — 2026-09-23 — The wrapper pair is a decision now, not an extra of the library.
 *   v1.1.0 — 2026-09-23 — The demos of the deleted parts go with them (Jouni's decision).
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
import { StepAgent } from '/views/home/step-agent.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Label, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Stack, Row } from '/components/Layout.js';
import { Field } from '/components/Field.js';
import { Choice } from '/components/Choice.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { TextField, TextArea } from '/components/TextField.js';

const html = htm.bind(h);
const noop = () => {};

/**
 * The agent step as the home draws it, and the same with the wrapper's class taken off in this
 * copy only. The component is not changed: the class is removed from the drawn element here.
 */
export function WrapperPair({ without }) {
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
    { name: 'rule: a guide\'s steps in a dialog', render: () => html`
      <${StepCard} rule num="2" title="Copy the prompt"><${Note} kind="hint">Paste it into your own AI chat.<//><//>
      <${StepCard} rule num="3" title="Bring the app back"><${Note} kind="hint">Paste the page your AI wrote.<//><${Action} onClick=${noop}>Add the app<//><//>` },
    { name: 'rule: the prompt builder\'s parts', render: () => html`<${StepCard} rule num="1" title="Describe your app">
      <${Stack} gap="medium">
        <${Choice} boxed cols=${2} ariaLabel="How to build it" value="page" onChange=${noop} options=${[
          { value: 'page', label: 'One page', hint: 'A single file your AI writes in one go.' },
          { value: 'atelier', label: html`Atelier <${Mark} tone="coral">new<//>`, hint: 'Built from parts, step by step.' }]} />
        <${TextArea} rows=${2} ariaLabel="Describe your app" value="A daily order sheet for Lumo Bakery" onInput=${noop} />
        <${Select} label="Start from a template" value="orders" options=${[{ value: 'orders', label: 'Order form' }, { value: 'menu', label: 'Menu board' }]} onChange=${noop} />
        <${Field} label="Capability packs" group>
          <${Note} kind="hint">Pick what the app may use.<//>
          <${Row} gap="small" wrap>
            <${Check} pill checked=${true} onChange=${noop}><span>Memory</span> <${Mark}>small<//><//>
            <${Check} pill checked=${false} onChange=${noop}><span>Image generation</span> <${Mark} tone="coral">frontier<//><//><//><//>
        <${Label} ruled>The prompt<//>
        <${Code} block scroll>Build a single-file web app for Lumo Bakery: a daily order sheet the staff fill in before 6 am.<//>
        <div><${Loud} control onClick=${noop}>Copy the prompt<//></div><//><//>` },
    { name: 'question: a numbered question of a form', render: () => html`
      <${StepCard} question num="1" title="What does the tool sell?"><${StepLede}>Say it in the words a buyer would search for.<//>
        <${TextField} ariaLabel="What the tool sells" value="Harbour timetables for Nordic Ferries" onInput=${noop} /><//>
      <${StepCard} question num="2" title="What does one use cost?"><${StepLede}>A buyer pays this each time their agent calls the tool.<//>
        <${TextField} ariaLabel="Price per use" value="0.20" onInput=${noop} /><//>` },
    { name: 'long title', render: () => html`<${StepCard} question num="3" title="Which of Nordic Ferries' seasonal timetables and harbour contracts may a buyer's agent read?"><${StepLede}>A long title wraps beside its number.<//><//>` },
  ] },
  'prompt-card': { variants: [
    { name: 'loud: the copy is the next move', render: (ex) => html`<${PromptCard} label=${ex.label} prompt=${ex.prompt} loud
        copyLabel=${ex.copyLabel} copiedLabel=${ex.copiedLabel} />` },
    { name: 'quiet: already copied, or one way among others', render: (ex) => html`<${PromptCard} label=${ex.label} prompt=${ex.prompt} quiet
        copyLabel=${ex.copyLabel} copiedLabel=${ex.copiedLabel} />` },
    { name: 'secondary copy button (an older caller\'s class)', render: (ex) => html`<${PromptCard} label=${ex.label} prompt=${ex.prompt} className="btn-outline"
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
  'front-door': { emptyNote: 'Draws only for a visitor who is not signed in. Open the front page in a private window to see it.', variants: [
    { name: 'default', render: () => html`<${FrontDoor} onNavigate=${noop} />` },
  ] },
};
