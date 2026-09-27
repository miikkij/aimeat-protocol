/**
 * @file public/views/design-lab/demos-fields.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Live demos of the field family of Settings & Controls: the field (Field), the text field (TextField) and the choice (Choice), each drawn by calling the real component with sample data, in
 *   the page's scope root (.pf) as Settings & Controls draws it.
 * @structure FIELD_DEMOS — { [id]: { variants: [{ name, render() }] } }
 * @usage import { FIELD_DEMOS } from './demos-fields.js';
 * @version-history
 *   v1.2.0 — 2026-09-27 — The script editor (TextArea indent and onSave), in the operator's frame.
 *   v1.1.0 — 2026-09-27 — The demos of field, text-field and choice; select-field, check-line, tag-input,
 *     model-picker, file-drop, form-fields and field-row moved in from demos-settings.js, drawn by calling
 *     Select, Check, TagInput, ModelList and ModelPicker, FileDrop, Fields and TextField (the catalogue pass).
 *   v1.0.0 — 2026-09-27 — Initial (Settings & Controls on components, the catalogue pass).
 */
import { h } from 'preact';
import htm from 'htm';
import { SettingsRoot } from '/components/SettingsFrame.js';
import { Field, Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Choice } from '/components/Choice.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { TagInput } from '/components/TagInput.js';
import { ModelList, ModelPicker } from '/components/ModelPicker.js';
import { FileDrop } from '/components/FileDrop.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { OperatorFrame } from '/components/OperatorFrame.js';

const html = htm.bind(h);
const noop = () => {};
const root = (children) => html`<${SettingsRoot}>${children}<//>`;

const LONG_HINT = 'Shown to everyone you invite to Harbour Studio, and to the agents that act for them, so a name that says what the studio does helps them find it again.';
const LIFETIMES = [['72', '3 days'], ['168', '7 days'], ['720', '30 days'], ['never', 'Never']];
const SHAPES = [
  { value: 'assistant', label: 'Assistant', hint: 'Answers when you ask, in your chat.' },
  { value: 'worker', label: 'Worker', hint: 'Takes tasks from a queue and reports back.' },
  { value: 'watcher', label: 'Watcher', hint: 'Looks at one thing on a schedule and tells you when it changes.' },
  { value: 'crew', label: 'Crew', hint: 'Several agents that hand work to each other.' },
];
const ROLES = [['member', 'Member'], ['editor', 'Editor'], ['owner', 'Owner']];

// Models as the OpenRouter catalogue gives them (pricing per token, context in tokens).
const MODELS = [
  { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', pricing: { prompt: '0.000003', completion: '0.000015' }, context_length: 200000 },
  { id: 'mistralai/mistral-small-3.2', name: 'Mistral Small 3.2', pricing: { prompt: '0.0000001', completion: '0.0000003' }, context_length: 128000 },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', pricing: { prompt: '0.0000003', completion: '0.0000025' }, context_length: 1000000 },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta Llama 3.3 70B Instruct, the free variant with a long name', pricing: { prompt: '0', completion: '0' }, context_length: 131072 },
];
const ROW_WORDS = {
  'anthropic/claude-sonnet-4.5': { trait: 'reads images', price: '$3 / $15 per M', context: '200k' },
  'mistralai/mistral-small-3.2': { trait: 'cheap', price: '$0.1 / $0.3 per M', context: '128k' },
  'google/gemini-2.5-flash': { trait: 'long context', price: '$0.3 / $2.5 per M', context: '1M' },
  'meta-llama/llama-3.3-70b-instruct:free': { trait: 'free', price: 'free', context: '131k' },
};
const describe = (m) => ({ name: m.name, ...ROW_WORDS[m.id] });
const describeTaken = (m) => ({ name: m.name, note: m.id === 'google/gemini-2.5-flash' ? 'already added' : '', price: ROW_WORDS[m.id].price, context: ROW_WORDS[m.id].context });

// Files as the browser gives them after a drop: the size is what the row shows.
const file = (name, kb, type = 'text/plain') => new File([new Uint8Array(kb * 1024)], name, { type });

export const FIELD_DEMOS = {
  field: { variants: [
    { name: 'a two-column form and its actions', render: () => root(html`<${Fields} cols=${2}>
      <${TextField} label="Name" value="Harbour Studio" hint="Shown to the people you invite." onInput=${noop} />
      <${Select} label="Who may join" value="invite" options=${[['invite', 'By invitation'], ['ask', 'Anyone may ask']]} onChange=${noop} />
      <${TextArea} label="Description" wide rows=${3} value="A small design studio by the harbour." onInput=${noop} />
    <//>
    <${FormActions}><${Loud} control onClick=${noop}>Save<//><${Action} small onClick=${noop}>Cancel<//><${Note} kind="message">Saved. Your agents see it at once.<//><//>`) },
    { name: 'a group of checks by hand', render: () => root(html`<${Field} label="Send me" hint="Each one is a mail of its own." group>
      <${Check} checked onChange=${noop}>A daily digest<//>
      <${Check} checked=${false} onChange=${noop}>Every new message<//>
    <//>`) },
    { name: 'label note', render: () => root(html`<${Field} id="dl-field-prompt" label="Prompt" labelNote="212 characters">
      <${TextArea} id="dl-field-prompt" rows=${3} value="Read every workspace I belong to and list the open questions first." onInput=${noop} />
    <//>`) },
    { name: 'invalid, with a message', render: () => root(html`<${Field} label="Company name" invalid message="A company needs a name." error>
      <${TextField} ariaLabel="Company name" value="" invalid onInput=${noop} />
    <//>`) },
    { name: 'three and four columns', render: () => root(html`<${Fields} cols=${3}>
      <${TextField} label="Temperature" type="number" size="short" value="0.7" onInput=${noop} />
      <${Select} label="Process" value="sequential" options=${[['sequential', 'One after another'], ['hierarchical', 'A manager hands out']]} onChange=${noop} />
      <${TextField} label="Max rounds" type="number" size="short" value="5" onInput=${noop} />
    <//>
    <${Fields} cols=${4}>
      <${Select} label="Visible to" value="public" options=${[['public', 'Everyone'], ['contacts', 'Contacts']]} onChange=${noop} />
      <${TextField} label="Morsels" type="number" value="20" onInput=${noop} />
      <${TextField} label="Money" type="number" value="4.50" onInput=${noop} />
      <${Select} label="Currency" value="eur" options=${[['eur', 'EUR'], ['usd', 'USD']]} onChange=${noop} />
    <//>`) },
    { name: 'actions apart and at the right', render: () => root(html`<${FormActions} apart><${Note}>Nothing is sent until you press Send.<//><${Loud} control onClick=${noop}>Send<//><//>
      <${FormActions} end><${Action} small onClick=${noop}>Cancel<//><${Loud} control onClick=${noop}>Save<//><//>`) },
    { name: 'long', render: () => root(html`<${TextField} label="The name your studio goes by with clients and partners" hint=${LONG_HINT} value="Harbour Studio for ferry timetables, seat maps and seasonal menus" onInput=${noop} />`) },
  ] },
  'text-field': { variants: [
    { name: 'empty', render: () => root(html`<${TextField} label="Name" placeholder="Harbour Studio" value="" onInput=${noop} />`) },
    { name: 'a value', render: () => root(html`<${TextField} label="Name" value="Lumo Bakery" hint="Shown to the people you invite." onInput=${noop} />`) },
    { name: 'invalid, with a message', render: () => root(html`<${TextField} label="Address" type="url" value="lumo bakery" message="An address starts with https://" error onInput=${noop} />`) },
    { name: 'disabled', render: () => root(html`<${TextField} label="Owner" value="sandbox" disabled />`) },
    { name: 'short and medium', render: () => root(html`<${Fields}>
      <${TextField} label="Runs at" type="time" size="short" value="06:00" onInput=${noop} />
      <${TextField} label="Tag" size="medium" value="ferries" onInput=${noop} />
    <//>`) },
    { name: 'code', render: () => root(html`<${TextField} label="Runs when" code value="0 7 * * 1-5" onInput=${noop} />`) },
    { name: 'secret, with the eye', render: () => root(html`<${TextField} label="Access code" secret value="harbour-2026" onInput=${noop} />`) },
    { name: 'key, no eye', render: () => root(html`<${TextField} label="OpenRouter key" unmanaged value="sk-or-v1-0000" onInput=${noop} />`) },
    { name: 'search with a count', render: () => root(html`<${TextField} search ariaLabel="Find a skill" placeholder="Find a skill" note="12 of 40" value="writ" onInput=${noop} />`) },
    { name: 'with its buttons', render: () => root(html`<${TextField} ariaLabel="Add a tag" value="invoices" onInput=${noop}
      actions=${html`<${Loud} control onClick=${noop}>Add<//>`} />`) },
    { name: 'dashed box', render: () => root(html`<${TextField} ariaLabel="Key" box unmanaged placeholder="sk-or-…" value="" onInput=${noop}
      actions=${html`<${Action} small onClick=${noop}>Save the key<//>`} />`) },
    { name: 'many lines', render: () => root(html`<${TextArea} label="What it sends" rows=${4} value="Read every workspace I belong to and list the open questions first." onInput=${noop} />`) },
    { name: 'many lines of code, refused', render: () => root(html`<${TextArea} label="Config" code rows=${4} value=${'{ "role": "worker",\n  "tools": [ }'} message="The JSON does not parse: line 2." error onInput=${noop} />`) },
    { name: 'growing', render: () => root(html`<${TextArea} ariaLabel="Message" grow=${132} placeholder="Write to invoice-drafter…" value="" onInput=${noop} onSend=${noop} />`) },
    { name: 'a script editor: Tab indents, Ctrl+S saves (an operator page)', render: () => html`<${OperatorFrame} title="Extensions"><${TextArea} label="Action: fetch the timetable" code indent rows=${6}
      value=${'export default async function (ctx) {\n  const res = await ctx.fetch("https://timetables.nordic-ferries.example/v2/routes");\n  return res.json();\n}'} onInput=${noop} onSave=${noop} /><//>` },
    { name: 'long', render: () => root(html`<${TextField} label="The address the Nordic Ferries booking agent reads its timetables from" hint=${LONG_HINT} value="https://timetables.nordic-ferries.example/v2/routes/helsinki-tallinn/winter-season" onInput=${noop} />`) },
  ] },
  choice: { variants: [
    { name: 'tabs, one chosen', render: () => root(html`<${Choice} label="Lifetime" value="168" options=${LIFETIMES} onChange=${noop} />`) },
    { name: 'empty, can be taken back', render: () => root(html`<${Choice} label="Relation" clearable value="" options=${[['client', 'Client'], ['partner', 'Partner'], ['friend', 'Friend']]} onChange=${noop} />`) },
    { name: 'attention', render: () => root(html`<${Choice} label="Lifetime" hint="A key that never expires keeps working until you revoke it." value="never"
      options=${LIFETIMES.map(([value, label]) => ({ value, label, attention: value === 'never' }))} onChange=${noop} />`) },
    { name: 'tile', render: () => root(html`<${Choice} label="Access" tone="tile" value="read" options=${[['read', 'Read'], ['write', 'Read and write'], ['admin', 'Admin']]} onChange=${noop} />`) },
    { name: 'filter', render: () => root(html`<${Choice} ariaLabel="Preset" tone="filter" value="0 7 * * *" options=${[['0 7 * * *', 'Every morning'], ['0 * * * *', 'Every hour'], ['0 7 * * 1', 'Mondays']]} onChange=${noop} />`) },
    { name: 'fold', render: () => root(html`<${Choice} ariaLabel="Order" tone="fold" value="new" options=${[['new', 'newest'], ['name', 'by name']]} onChange=${noop} />`) },
    { name: 'several', render: () => root(html`<${Choice} label="Break through quiet hours" multi value=${['family', 'work']} options=${[['family', 'Family'], ['work', 'Work'], ['agents', 'Agents']]} onChange=${noop} />`) },
    { name: 'with an answer of one\'s own', render: () => root(html`<${Choice} label="Retries" value="other" options=${[['0', 'None'], ['3', 'Three'], ['other', 'Other']]} onChange=${noop}>
      <${TextField} type="number" size="short" ariaLabel="Retries" value="7" onInput=${noop} /><//>`) },
    { name: 'boxed, four columns', render: () => root(html`<${Choice} boxed cols=${4} label="Shape" value="worker" options=${SHAPES} onChange=${noop} />`) },
    { name: 'boxed, three columns', render: () => root(html`<${Choice} boxed cols=${3} ariaLabel="Kind" value="agent" options=${[
      { value: 'agent', label: 'Agent task', hint: 'An agent does it.' }, { value: 'ai', label: 'AI prompt', hint: 'Your AI answers it.' }, { value: 'hook', label: 'Web hook', hint: 'An address is called.' }]} onChange=${noop} />`) },
    { name: 'boxed, two columns', render: () => root(html`<${Choice} boxed cols=${2} ariaLabel="Template" value=${null} options=${SHAPES.slice(0, 2)} onChange=${noop} />`) },
    { name: 'boxed with a dot', render: () => root(html`<${Choice} boxed dot cols=${3} name="dl-choice-dot" label="Runs" value="3" options=${[
      { value: '1', label: 'Once', hint: 'A quick look.' }, { value: '3', label: 'Three times', hint: 'Enough to see a spread.' }, { value: '5', label: 'Five times', hint: 'Slower, steadier.' }]} onChange=${noop} />`) },
    { name: 'invalid, with a message', render: () => root(html`<${Choice} label="Lifetime" value="" options=${LIFETIMES} message="Pick how long the key lives." error onChange=${noop} />`) },
    { name: 'disabled', render: () => root(html`<${Choice} label="Lifetime" value="168" disabled options=${LIFETIMES} onChange=${noop} />`) },
    { name: 'long', render: () => root(html`<${Choice} label="When an agent asks to write to shared memory" hint=${LONG_HINT} value="ask"
      options=${[['ask', 'Ask me every time before anything is written'], ['trusted', 'Let the agents I trust write on their own'], ['never', 'Never let an agent write there']]} onChange=${noop} />`) },
  ] },
  'select-field': { variants: [
    { name: 'a value', render: () => root(html`<${Select} label="Role" value="editor" options=${ROLES} onChange=${noop} />`) },
    { name: 'empty, with a placeholder', render: () => root(html`<${Select} label="Agent" value="" placeholder="Choose…" placeholderDisabled options=${[['bot', 'bot'], ['invoice-drafter', 'invoice-drafter']]} onChange=${noop} />`) },
    { name: 'invalid, with a message', render: () => root(html`<${Select} label="Agent" value="" placeholder="Choose…" options=${[['bot', 'bot']]} message="Pick the agent that runs it." error onChange=${noop} />`) },
    { name: 'disabled', render: () => root(html`<${Select} ariaLabel="Role" value="" placeholder="Pick an agent first" disabled options=${[]} />`) },
    { name: 'fit', render: () => root(html`<p>Visible to <${Select} fit ariaLabel="Visibility" value="private" options=${[['private', 'Only me'], ['public', 'Everyone']]} onChange=${noop} /></p>`) },
    { name: 'attention', render: () => root(html`<${Select} label="Audience" attention value="all" placeholder="Nobody yet" options=${[['all', 'Every user of this node'], ['admins', 'The operators']]} onChange=${noop} />`) },
    { name: 'groups', render: () => root(html`<${Select} label="Provider" value="openrouter" options=${[{ group: 'Hosted', options: [['openrouter', 'OpenRouter'], ['anthropic', 'Anthropic']] }, { group: 'On your machine', options: [['lmstudio', 'LM Studio']] }]} onChange=${noop} />`) },
    { name: 'long', render: () => root(html`<${Select} label="Which workspace the Nordic Ferries agent reads its timetables from" hint=${LONG_HINT} value="w1"
      options=${[['w1', 'Harbour Studio / Client briefs / Nordic Ferries winter season timetables'], ['w2', 'Lumo Bakery / Seasonal menu']]} onChange=${noop} />`) },
  ] },
  'check-line': { variants: [
    { name: 'on and off', render: () => root(html`<${Check} checked onChange=${noop}>Detect on capture<//><${Check} checked=${false} onChange=${noop}>Retry a failed run once<//>`) },
    { name: 'radio dots, inline', render: () => root(html`<${Field} label="Visible to" group>
      <${Check} radio inline name="dl-check-vis" checked onChange=${noop}>Private<//><${Check} radio inline name="dl-check-vis" checked=${false} onChange=${noop}>Public<//>
    <//>`) },
    { name: 'with a hint', render: () => root(html`<${Check} radio name="dl-check-hint" checked hint="The app's records are read on a schedule and sorted into your memory." onChange=${noop}>Run on a schedule<//>`) },
    { name: 'disabled', render: () => root(html`<${Check} checked disabled title="Your plan decides this">Keep a copy of every mail<//>`) },
    { name: 'long', render: () => root(html`<${Check} checked=${false} onChange=${noop}>Let invoice-drafter send the invoices it drafts to the clients of Harbour Studio without asking me first<//>`) },
  ] },
  'tag-input': { variants: [
    { name: 'two tags', render: () => root(html`<${TagInput} label="Interests" tags=${['design', 'ferries']} onChange=${noop} />`) },
    { name: 'empty', render: () => root(html`<${TagInput} label="Interests" tags=${[]} onChange=${noop} />`) },
    { name: 'with a + button, lowercase', render: () => root(html`<${TagInput} label="Tags" lowercase adder whole tags=${['invoices', 'q3']} onChange=${noop} />`) },
    { name: 'closed', render: () => root(html`<${TagInput} ariaLabel="Tags" addLabel="Add tag" tags=${['billing', 'nordic-ferries']} onAdd=${noop} onRemove=${noop} />`) },
    { name: 'invalid, with a message', render: () => root(html`<${TagInput} label="Interests" tags=${[]} message="Add at least one interest." error onChange=${noop} />`) },
    { name: 'disabled', render: () => root(html`<${TagInput} label="Interests" disabled tags=${['design']} onChange=${noop} />`) },
    { name: 'long', render: () => root(html`<${TagInput} label="Interests" hint=${LONG_HINT} tags=${['design', 'ferries', 'seat maps', 'seasonal menus', 'timetables', 'a tag long enough to wrap on a phone']} onChange=${noop} />`) },
  ] },
  'model-picker': { variants: [
    { name: 'recommended, one chosen, one taken', render: () => root(html`<${ModelList} models=${MODELS} value="anthropic/claude-sonnet-4.5"
      taken=${['google/gemini-2.5-flash']} describe=${describeTaken} onPick=${noop} facts="4 models answer in text" />`) },
    { name: 'with traits', render: () => root(html`<${ModelList} label="Writing" hint="The model that drafts your mails." models=${MODELS} value="mistralai/mistral-small-3.2" describe=${describe} onPick=${noop} />`) },
    { name: 'a search with no match', render: () => root(html`<${ModelList} models=${MODELS} query="gpt-9" onQuery=${noop} describe=${describe} onPick=${noop} noMatchLabel="No model matches." />`) },
    { name: 'classic picker, with a link', render: () => root(html`<${ModelPicker} label="Default model" value="anthropic/claude-sonnet-4.5" models=${MODELS} allowNone allowCustom onChange=${noop} />`) },
    { name: 'empty', render: () => root(html`<${ModelPicker} label="Vision model" value="" models=${MODELS} allowNone allowCustom onChange=${noop} />`) },
    { name: 'off', render: () => root(html`<${ModelPicker} label="Default model" hint="Save a key first." value="" models=${MODELS} allowCustom disabled onChange=${noop} />`) },
    { name: 'short list', render: () => root(html`<${ModelPicker} label="Default model" value="mistralai/mistral-small-3.2" models=${MODELS} allowNone onChange=${noop} />`) },
    { name: 'invalid, with a message', render: () => root(html`<${ModelPicker} label="Default model" value="acme/retired-model" models=${MODELS} allowCustom message="This model is no longer offered." error onChange=${noop} />`) },
  ] },
  'file-drop': { variants: [
    { name: 'empty', render: () => root(html`<${FileDrop} multiple onFiles=${noop} />`) },
    { name: 'two chosen', render: () => root(html`<${FileDrop} multiple onFiles=${noop} onRename=${noop} onRemove=${noop}
      items=${[{ file: file('notes.txt', 1), key: 'docs/notes.txt' }, { file: file('plan.md', 2), key: 'docs/plan.md' }]} />`) },
    { name: 'disabled', render: () => root(html`<${FileDrop} disabled onFiles=${noop} dropLabel="Uploads are paused" orLabel=${null} />`) },
    { name: 'plain, in a form', render: () => root(html`<${FileDrop} plain label="The app's file" hint="One HTML file." accept=".html,.htm" onFiles=${noop} />`) },
    { name: 'plain, invalid with a message', render: () => root(html`<${FileDrop} plain label="The app's file" accept=".html,.htm" message="Choose an HTML file." error onFiles=${noop} />`) },
    { name: 'button', render: () => root(html`<${FileDrop} button="+ Upload a skill" soft accept=".md,.json" onFiles=${noop} />`) },
    { name: 'long', render: () => root(html`<${FileDrop} label="Documents" hint=${LONG_HINT} multiple onFiles=${noop} onRemove=${noop}
      items=${[{ file: file('nordic-ferries-winter-season-timetables-helsinki-tallinn-2026.csv', 24, 'text/csv'), key: 'studio/clients/nordic-ferries/timetables/winter-season-helsinki-tallinn-2026.csv' }]} />`) },
  ] },
  'form-fields': { variants: [
    { name: 'two columns and actions', render: () => root(html`<${Fields} cols=${2}>
      <${TextField} label="Name" value="Harbour Studio" onInput=${noop} />
      <${TextField} label="Join" value="By invitation" onInput=${noop} />
    <//>
    <${Fields}><${TextArea} label="Description" rows=${3} value="A small design studio." onInput=${noop} /><//>
    <${FormActions}><${Loud} control onClick=${noop}>Save<//><${Note}>Saved changes show at once.<//><//>`) },
    { name: 'code', render: () => root(html`<${TextField} label="Runs when" code value="0 7 * * 1-5" onInput=${noop} />`) },
    { name: 'refused', render: () => root(html`<${TextField} label="Name" value="" invalid message="The name is taken." error onInput=${noop} />`) },
  ] },
  'field-row': { variants: [
    { name: 'empty', render: () => root(html`<${TextField} box unmanaged ariaLabel="Key" placeholder="sk-or-…" value="" onInput=${noop}
      actions=${html`<${Action} small onClick=${noop}>Save the key<//>`} />`) },
    { name: 'a value', render: () => root(html`<${TextField} box ariaLabel="Package name" value="harbour-briefs" onInput=${noop}
      actions=${html`<${Action} small onClick=${noop}>Install<//>`} />`) },
    { name: 'long', render: () => root(html`<${TextField} box ariaLabel="Base address" value="https://llm.harbour-studio.example/v1/openai-compatible/chat/completions" onInput=${noop}
      actions=${html`<${Action} small onClick=${noop}>Save the address<//>`} />`) },
  ] },
};
