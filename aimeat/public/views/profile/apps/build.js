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
 *   2026-09-22 -- The two file pickers are the shared file field.
 *   2026-09-22 -- Composed from the shared component set: KeyValue for agents and skills, Chips
 *     for the pairs, Field for the editor and the form, Actions for the doors; no own CSS. The two
 *     file inputs stay native inputs until the set's Field takes a file (reported).
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.0.0 — 2026-09-02 — Initial. The crew-definition editor and its prompt moved here from
 *     apps-tab.js v1.8.0, where they sat on every card.
 */
import { h } from 'preact';
import htm from 'htm';
import { useState, useRef } from 'preact/hooks';
const html = htm.bind(h);
import { Section, Stack, Columns, KeyValue, Field, Action, CopyAction, Chip, Text, Surface } from '/components/poster-parts.js';
import { a, nameOf, appRef, goTab } from './frame.js';

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
    <${Section} id="ap-agents" title=${a('secAgents')}>
      <${Stack}>
        <div>
          <${KeyValue} label=${a('agentsLabel')}>
            <${Stack} density="compact">
              <span>${withAgents.length ? a('agentsSome', { n: withAgents.length }) : a('agentsNone')}</span>
              <${Text} kind="caption" tone="muted">${a('agentsNote')}<//>
              ${withAgents.length ? html`<${Stack} direction="wrap" density="compact">${withAgents.map((x) => html`<${Chip} key=${appRef(x)}>${nameOf(x)} · ${x.manifest.cortex.agents.length}<//>`)}<//>` : null}
            <//>
          <//>
          <${KeyValue} label=${a('skillsLabel')}>
            <${Stack} density="compact">
              <span>${pairs.length ? a('skillsCount', { apps: withSkill, skills: pairs.length }) : a('skillsNone')}</span>
              <${Text} kind="caption" tone="muted">${a('skillsNote', { n: apps.length - withSkill })}<//>
              ${pairs.length ? html`<${Stack} direction="wrap" density="compact">${pairs.slice(0, 8).map((p) => html`<${Chip} key=${p.skill}>${p.skill} → ${p.app}<//>`)}${pairs.length > 8 ? html`<${Chip} tone="muted">${a('more', { n: pairs.length - 8 })}<//>` : null}<//>` : null}
            <//>
          <//>
        </div>
        <${Stack} direction="wrap">
          <${Action} onClick=${() => goTab('skills')}>${a('skillsDoor')}<//>
          <${CopyAction} text=${skillPrompt(apps)} label=${a('skillPromptDoor')} copiedLabel=${a('promptCopied')} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))} />
          <${Action} expanded=${!!ctx.agentEditorOpen} onClick=${() => ctx.setAgentEditorOpen(!ctx.agentEditorOpen)}>${ctx.agentEditorOpen ? a('agentEditClose') : a('agentEditOpen')}<//>
        <//>
        ${ctx.agentEditorOpen ? html`
          <${Surface} kind="aside">
            <${Stack}>
              <${Text}>${a('agentEditHint')}<//>
              <${Field} type="select" label=${a('agentEditPick')} value=${ctx.agentPick} onChange=${(e) => ctx.pickAgentApp(e.target.value)}
                options=${[{ value: '', label: '–' }, ...apps.map((x) => ({ value: x.filename, label: `${nameOf(x)}${x.manifest?.cortex?.agents?.length ? ` · ${x.manifest.cortex.agents.length}` : ''}` }))]} />
              ${picked ? html`
                <${Field} type="textarea" rows=${12} spellCheck=${false} value=${ctx.agentJson} onInput=${(e) => ctx.setAgentJson(e.target.value)} />
                <${Stack} direction="wrap">
                  <${Action} disabled=${ctx.busy === 'agents'} onClick=${() => ctx.saveAgents(picked)}>${a('agentEditSave')}<//>
                  <${CopyAction} text=${ctx.agentPromptFor(picked)} label=${a('agentEditCopy')} copiedLabel=${a('promptCopied')} onCopied=${() => ctx.showToast?.(a('agentEditCopied'))} />
                <//>
                <${Text} kind="caption" tone="muted">${a('agentClearHint')}<//>` : null}
            <//>
          <//>` : null}
      <//>
    <//>`;
}

/* ── 05 · Build a new one ─────────────────────────────────────────────────────────────────────── */

export function secBuild(ctx, { formOnly }) {
  return html`
    <${Section} id="ap-build" title=${formOnly ? a('uploadLabel') : a('secBuild')} count=${formOnly ? null : a('secBuildSub')}>
      <${Stack}>
        ${formOnly ? null : html`
          <${Stack} direction="wrap">
            <${CopyAction} text=${ctx.buildPrompt} label=${a('promptDoor')} copiedLabel=${a('promptCopied')} disabled=${!ctx.buildPrompt} onCopied=${() => ctx.showToast?.(a('promptCopiedToast'))} />
            <${Action} href="/v1/aimeat-os" target="_blank">${a('guideDoor')}<//>
          <//>
          <${Action} kind="text" onClick=${() => goTab('appdev')}>${a('appdevDoor')}<//>
          <${Text} kind="caption" tone="muted">${a('buildHint')}<//>
          <${Text} kind="label">${a('uploadLabel')}<//>`}
        <${UploadForm} onUpload=${ctx.upload} busy=${ctx.busy === 'upload'} />
        <${Text} kind="caption" tone="muted">${a('uploadHint')}<//>
      <//>
    <//>`;
}

/**
 * The form for a finished file. Its four fields are its own until "Publish the file" sends them:
 * a re-render of the page above must not empty a half-filled form.
 * The file pickers are native inputs: the set's Field has no file type yet (reported as a missing part).
 */
function UploadForm({ onUpload, busy }) {
  const fileRef = useRef(null);
  const shotRef = useRef(null);
  const [desc, setDesc] = useState('');
  const [code, setCode] = useState('');
  const [roadmap, setRoadmap] = useState('');
  return html`
    <${Stack}>
      <${Columns} collapse=${640}>
        <${Field} type="file" label=${a('fileLabel')} inputRef=${fileRef} accept=".html,.htm" />
        <${Field} type="file" label=${a('shotLabel')} inputRef=${shotRef} accept="image/*" />
      <//>
      <${Field} type="textarea" label=${a('descLabel')} rows=${2} maxLength=${2000} placeholder=${a('descPlaceholder')} value=${desc} onInput=${(e) => setDesc(e.target.value)} />
      <${Field} label=${a('codeLabel')} placeholder=${a('codePlaceholder')} value=${code} onInput=${(e) => setCode(e.target.value)} />
      <${Field} type="textarea" label=${a('roadPublishLabel')} rows=${2} maxLength=${600} value=${roadmap} onInput=${(e) => setRoadmap(e.target.value)} />
      <${Text} kind="caption" tone="muted">${a('roadPublishHint')}<//>
      <${Stack} direction="horizontal" align="center">
        <${Action} disabled=${busy} onClick=${async () => {
          const ok = await onUpload({ file: fileRef.current?.files?.[0], description: desc, screenshot: shotRef.current?.files?.[0], accessCode: code, roadmap });
          if (ok) { setDesc(''); setCode(''); setRoadmap(''); if (fileRef.current) fileRef.current.value = ''; if (shotRef.current) shotRef.current.value = ''; }
        }}>${a('publishFile')}<//>
      <//>
    <//>`;
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
