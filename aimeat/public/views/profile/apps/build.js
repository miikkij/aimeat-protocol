/**
 * @file public/views/profile/apps/build.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two sections of the Apps page about making: the agents an app ships and the
 *   skills that teach agents an app (with the crew-definition editor the launcher does not have,
 *   and the prompt that writes one), and building a new app (the build prompt, the guide, the
 *   AppDev page, and the form for a finished file). Pure render over the ctx bag, except the form,
 *   which keeps its own fields until they are sent.
 * @structure secAgents · secBuild · UploadForm · buildAgentAuthoringPrompt · skillPrompt
 * @usage import { secAgents, secBuild } from './build.js';
 * @version-history
 *   v2.0.0 -- 2026-09-26 -- Every part is a component call that gets data (page group G6): Section,
 *     the agents and skills Facts (wide) with their Marks, the actions Action (the copies with
 *     `copy`), the crew editor the aside Note with a Select and a TextArea, the upload label a
 *     Label, the hints Note. The page writes no class.
 *   v1.17.0 -- 2026-09-26 -- The upload form is the Field family's components (Fields, FileDrop plain,
 *     TextArea, TextField secret, FormActions): the page passes words and values; the eye that shows
 *     the access code is the TextField's own (component plan C5, the family's proof).
 *   2026-09-26 — The upload form's access code is typed hidden, with an eye inside the field that
 *     shows it.
 *   v1.16.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.15.0 -- 2026-09-25 -- The apps with agents and the skill-to-app pairs are the Tag (.poster-chip, plain, in .poster-chips), a unification: Jouni's decision "Tag".
 *   v1.14.0 -- 2026-09-25 -- Agents and skills is the Facts (facts, facts-k, facts-v), a unification: the look most tabs use.
 *   v1.13.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.12.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.11.0 -- 2026-09-25 -- A lead or a paragraph that opens or explains a section is the og-lead; a grey one that explains is the Hint (UI consolidation phase 5, a unification).
 *   v1.10.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.9.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.2.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-25 — The og- page kit is library components: PageSection and FoldSection in /components, the kit's rules in css/components (tab-page, crumb-trail, page-head, figure-strip, page-section, fold-row, setting-box, form-fields, space-table) and css/views/organism-controls.css (UI consolidation phase 5, a move).
 *   v1.0.0 — 2026-09-02 — Initial. The crew-definition editor and its prompt moved here from
 *     apps-tab.js v1.8.0, where they sat on every card.
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useRef } from 'preact/hooks';
const html = htm.bind(h);
import { Section } from '/components/Section.js';
import { a, nameOf, appRef, goTab } from './frame.js';
import { Note } from '/components/Note.js';
import { Facts } from '/components/Facts.js';
import { Mark, Marks, Label } from '/components/Mark.js';
import { Space } from '/components/Layout.js';
import { Fields, FormActions } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { FileDrop } from '/components/FileDrop.js';
import { Action, Actions } from '/components/Action.js';

/* ── 04 · Agents and skills ───────────────────────────────────────────────────────────────────── */

export function secAgents(ctx) {
  const apps = ctx.apps || [];
  const withAgents = apps.filter((x) => x.manifest?.cortex?.agents?.length);
  const bound = ctx.bound || {};
  const pairs = [];
  for (const app of apps) for (const s of bound[appRef(app)] || []) pairs.push({ skill: s.name, app: nameOf(app) });
  const withSkill = apps.filter((x) => (bound[appRef(x)] || []).length).length;
  const picked = apps.find((x) => x.filename === ctx.agentPick) || null;
  return html`
    <${Section} id="ap-agents" num="04" title=${a('secAgents')} count=${null}>
      <${Facts} wide flush rows=${[
        {
          k: a('agentsLabel'),
          v: withAgents.length ? a('agentsSome', { n: withAgents.length }) : a('agentsNone'),
          sub: a('agentsNote'),
          actions: withAgents.length ? html`<${Marks}>${withAgents.map((x) => html`<${Mark} key=${appRef(x)}>${nameOf(x)} · ${x.manifest.cortex.agents.length}<//>`)}<//>` : null,
        },
        {
          k: a('skillsLabel'),
          v: pairs.length ? a('skillsCount', { apps: withSkill, skills: pairs.length }) : a('skillsNone'),
          sub: a('skillsNote', { n: apps.length - withSkill }),
          actions: pairs.length ? html`<${Marks}>${pairs.slice(0, 8).map((p) => html`<${Mark} key=${p.skill}>${p.skill} → ${p.app}<//>`)}${pairs.length > 8 ? html`<${Mark}>${a('more', { n: pairs.length - 8 })}<//>` : null}<//>` : null,
        },
      ]} />
      <${Space} above="medium">
        <${Actions}>
          <${Action} small soft onClick=${() => goTab('skills')}>${a('skillsDoor')}<//>
          <${Action} small soft copy=${skillPrompt(apps)} copiedLabel=${a('promptCopied')} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))}>${a('skillPromptDoor')}<//>
          <${Action} small soft onClick=${() => ctx.setAgentEditorOpen(!ctx.agentEditorOpen)}>${ctx.agentEditorOpen ? a('agentEditClose') : a('agentEditOpen')}<//>
        <//>
      <//>
      ${ctx.agentEditorOpen ? html`
        <${Space} above="small">
          <${Note} kind="aside">
            <${Note} kind="lead">${a('agentEditHint')}<//>
            <${Select} label=${a('agentEditPick')} value=${ctx.agentPick} onChange=${(v) => ctx.pickAgentApp(v)} placeholder="–"
              options=${apps.map((x) => [x.filename, `${nameOf(x)}${x.manifest?.cortex?.agents?.length ? ` · ${x.manifest.cortex.agents.length}` : ''}`])} />
            ${picked ? html`
              <${Space} above="medium"><${TextArea} rows=${12} spellCheck=${false} value=${ctx.agentJson} onInput=${(v) => ctx.setAgentJson(v)} /><//>
              <${Space} above="medium">
                <${Actions}>
                  <${Action} small disabled=${ctx.busy === 'agents'} onClick=${() => ctx.saveAgents(picked)}>${a('agentEditSave')}<//>
                  <${Action} small soft copy=${ctx.agentPromptFor(picked)} copiedLabel=${a('promptCopied')} onCopied=${() => ctx.showToast?.(a('agentEditCopied'))}>${a('agentEditCopy')}<//>
                <//>
              <//>
              <${Note}>${a('agentClearHint')}<//>` : null}
          <//>
        <//>` : null}
    <//>`;
}

/* ── 05 · Build a new one ─────────────────────────────────────────────────────────────────────── */

export function secBuild(ctx, { formOnly, num }) {
  return html`
    <${Section} id="ap-build" num=${num} title=${formOnly ? a('uploadLabel') : a('secBuild')} count=${formOnly ? null : a('secBuildSub')}>
      ${formOnly ? null : html`
        <${Actions}>
          <${Action} small copy=${ctx.buildPrompt} copiedLabel=${a('promptCopied')} disabled=${!ctx.buildPrompt} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))}>${a('promptDoor')}<//>
          <${Action} small href="/v1/aimeat-os" newTab>${a('guideDoor')}<//>
          <${Action} small soft onClick=${() => goTab('appdev')}>${a('appdevDoor')}<//>
        <//>
        <${Note}>${a('buildHint')}<//>
        <${Space} above="section" below="medium"><${Label} block>${a('uploadLabel')}<//><//>`}
      <${UploadForm} onUpload=${ctx.upload} busy=${ctx.busy === 'upload'} />
      <${Note}>${a('uploadHint')}<//>
    <//>`;
}

/**
 * The form for a finished file. Its four fields are its own until "Publish the file" sends them:
 * a re-render of the page above must not empty a half-filled form.
 */
function UploadForm({ onUpload, busy }) {
  const fileRef = useRef(null);
  const shotRef = useRef(null);
  const [desc, setDesc] = useState('');
  // The access code is typed hidden; the eye inside the field shows it (Jouni, 2026-09-26). The
  // TextField's `secret` owns the eye, and hides the code again once the form empties it.
  const [code, setCode] = useState('');
  const [roadmap, setRoadmap] = useState('');
  const send = async () => {
    const ok = await onUpload({ file: fileRef.current?.files?.[0], description: desc, screenshot: shotRef.current?.files?.[0], accessCode: code, roadmap });
    if (ok) { setDesc(''); setCode(''); setRoadmap(''); if (fileRef.current) fileRef.current.value = ''; if (shotRef.current) shotRef.current.value = ''; }
  };
  return html`
    <${Fields} cols=${2}>
      <${FileDrop} plain label=${a('fileLabel')} accept=".html,.htm" inputRef=${fileRef} />
      <${FileDrop} plain label=${a('shotLabel')} accept="image/*" inputRef=${shotRef} />
      <${TextArea} wide label=${a('descLabel')} rows=${2} maxLength="2000" placeholder=${a('descPlaceholder')} value=${desc} onInput=${setDesc} />
      <${TextField} secret label=${a('codeLabel')} placeholder=${a('codePlaceholder')} value=${code} onInput=${setCode}
        showLabel=${a('codeShow')} hideLabel=${a('codeHide')} />
      <${TextArea} wide label=${a('roadPublishLabel')} hint=${a('roadPublishHint')} rows=${2} maxLength="600" value=${roadmap} onInput=${setRoadmap} />
    <//>
    <${FormActions} end><${Action} small disabled=${busy} onClick=${send}>${a('publishFile')}<//><//>`;
}

/**
 * The ready-made prompt for authoring crew-defs in the person's own AI chat (the prompt-driven
 * pattern): embeds the app context + current defs + the schema rules the node enforces at save,
 * and asks for ONLY the JSON array back, to paste into the editor.
 */
export function buildAgentAuthoringPrompt(app, currentAgents) {
  return `You are writing the "bundled agents" for an AIMEAT app — declarative crew definitions (crewaimeat crew_def JSON) that the app's users can deploy onto their own agent fleet. Output ONLY a JSON array of crew-def objects (no prose, no markdown fences).

APP CONTEXT
- Name: ${app.manifest?.name || app.filename}
- Description: ${app.manifest?.description || '(none)'}

CURRENT CREW-DEFS (edit these, or design new ones):
${JSON.stringify(currentAgents ?? [], null, 2)}

SCHEMA RULES (the node rejects anything that violates these):
- Array of 1-5 crew-def objects. Each: { "agent_name", "agents", "tasks", optional "readme_md", "llm_profile" ("content"|"coding"|"content-free"), "temperature" (0-2), "tags", "skills", "process" ("sequential"|"hierarchical") }.
- "agent_name": 3-32 chars, lowercase alphanumeric + hyphens, unique across the array.
- "agents": 1-10 crew members: { "role", "goal", optional "backstory", "tools" (names from the vetted set: web, memory, schedule, delegate, image, app_build), "skills", "allow_delegation" (boolean) }. Use several members + "process": "hierarchical" when the work needs an orchestrator over specialists.
- "tasks": 1-20 items: { "id", "description", "expected_output", "agent" (must equal a declared role), optional "context" (ids of EARLIER tasks whose output feeds this one), "async" }.
- At least one task description MUST contain the literal placeholder {{ctx.prompt}} — that is where the user's request is injected at runtime.
- The crew-def is pure data. Never include code.

Design the crew to genuinely serve this app's users, then output the JSON array.`;
}

/** The prompt that has the person's AI write a skill for one of their apps, through MCP. */
export function skillPrompt(apps) {
  const names = apps.slice(0, 12).map((x) => `${x.manifest?.name || x.filename} (${x.owner}/${x.filename})`).join('\n- ');
  return `Write a skill that teaches an agent how to use one of my AIMEAT apps, and publish it bound to that app.

MY APPS (pick the one I name, or ask which):
- ${names || '(none yet)'}

STEPS
1. Read the app with aimeat_app_get (owner/filename above) and its data map with aimeat_datamap_get, so the skill describes what the app really does and where its data lives.
2. Write SKILL.md: name, a one-paragraph description of when an agent should use this app, the operating steps in the app's own words, the records it reads and writes, and the mistakes to avoid.
3. Publish it with aimeat_skill_publish at scope "user", then bind it to the app with aimeat_skill_link using metadata.binding "app:<owner>/<filename>".
4. Tell me the skill's name and the app it is bound to.`;
}
