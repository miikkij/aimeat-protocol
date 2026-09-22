/**
 * @file ai-setup-guide.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two surfaces built on the per-tool setup table: McpSetupGuide (how to attach
 *   this node to a given AI tool) and InstructionsDialog (the instruction block plus, for the
 *   tool the reader actually uses, the exact place to paste it).
 *
 *   Both are tool-pickers rather than one generic set of steps, because the generic version is
 *   where people fall off: "add a custom connector" is not actionable if your tool calls it
 *   something else or keeps it behind a switch you have not turned on. Every tool carries a link
 *   to its vendor's own documentation, so a reader who does not believe the steps can check them
 *   rather than take our word.
 * @structure McpSetupGuide() · InstructionsDialog({ open, onClose })
 * @usage import { McpSetupGuide, InstructionsDialog } from '/views/profile/ai-setup-guide.js';
 * @version-history
 *   2026-09-22 -- Composed from the shared set; the tool tabs are the shared tab part, so the
 *     tabClass / activeClass props main added on 2026-09-14 are no longer needed and are ignored.
 *   2026-09-13: Instructions dialog composes shared fields, sections and prompt content.
 *   2026-09-13: Shared parts compose the complete connection guide.
 *   2026-09-13 -- Pass the caller's shared install-row shape to McpInstallRow.
 *   v2.2.0 — 2026-08-27 — The short way in (McpInstallRow) renders above the steps for the three
 *     clients that have one, and the module-level table cache moved to ai-tool-setup.js so the
 *     install shortcuts elsewhere on the page share this read instead of opening a second.
 *   v2.0.0 — 2026-07-31 — Table fetched from GET /v1/ai-tools instead of an in-SPA copy, so
 *     the Experience Center reads the same one.
 *   v1.0.0 — 2026-07-31 — Initial.
 *   v2.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { PromptCard } from '/components/PromptCard.js';
import { Dialog, Section, Field, Stack, Surface, Text, Action, KeyValue, CopyAction, Steps } from '/components/poster-parts.js';
import { useAiTools } from '/views/profile/ai-tool-setup.js';
import { InstructionBlock } from '/views/profile/instruction-block.js';
import { McpInstallRow } from '/components/McpInstall.js';
import { getOrganismsTab } from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const LAST_TOOL_KEY = 'aimeat.setup.tool';
const rememberedTool = () => {
  // eslint-disable-next-line aimeat/no-silent-catch -- blocked storage means "no remembered choice", which is the same answer as an empty slot; the caller falls back to the first tool either way
  try { return localStorage.getItem(LAST_TOOL_KEY) || ''; } catch { return ''; }
};

const pickTool = (tools, id) => tools.find(x => x.id === id) || tools[0];

function ToolPicker({ tools, value, onPick }) {
  return html`<${Stack} direction="wrap" role="tablist" label=${tr('setup.pickTool','Which AI tool are you connecting? The steps differ enough that the general version is not usable.')}>
    ${tools.map(tool => html`<${Action} key=${tool.id} kind="tab" semantics="tab" selected=${tool.id === value}
      onClick=${() => onPick(tool.id)}>${tool.label}${tool.recommended
        ? html` <${Text} kind="caption">${tr('setup.recommendedBadge','recommended')}<//>` : null}<//>`)}
  <//>`;
}

/** Every field requested by the selected tool, including deliberately empty values. */
function Params({ params }) {
  if (!params?.length) return null;
  // One key-value row per field: the field's name, then the value in mono with its copy word, and
  // the note under it. A field left empty says so in words rather than showing an empty box.
  return html`<${Stack} density="compact">
    <${Text} kind="label">${tr('setup.paramsTitle','What to put in each field')}<//>
    <div>${params.map((prm,i) => html`<${KeyValue} key=${i} label=${prm.label}>
      <${Stack} density="compact">
        ${prm.value ? html`<${Stack} direction="wrap" align="center" density="compact">
            <${Text} kind="mono">${prm.value}<//>
            <${CopyAction} text=${prm.value} label=${tr('common.copy','Copy')} copiedLabel=${tr('common.copied','Copied')} />
          <//>`
          : html`<${Text} tone="muted">${tr('setup.leaveEmpty','leave empty')}<//>`}
        ${prm.note && html`<${Text} kind="caption" tone="muted">${prm.note}<//>`}
      <//>
    <//>`)}</div>
  <//>`;
}

/**
 * How to attach this node to one AI tool: the steps as things to click or type, every field value,
 * and the vendor's own page.
 */
export function McpSetupGuide() {
  const tools = useAiTools();
  const [toolId, setToolId] = useState(rememberedTool);
  const pick = (id) => {
    setToolId(id);
    // eslint-disable-next-line aimeat/no-silent-catch -- storage blocked only costs the remembered choice
    try { localStorage.setItem(LAST_TOOL_KEY, id); } catch { /* the choice just does not persist */ }
  };
  if (!tools) return html`<${Text} tone="muted">${tr('setup.loadingTools', 'Reading the setup instructions from this node…')}<//>`;
  if (!tools.length) return html`<${Text} tone="muted">${tr('setup.toolsFailed', 'Could not read the setup instructions just now. The connect page has the same steps.')}<//>`;
  const tool = pickTool(tools, toolId);
  const cmd = tool.mcp.command || null;

  return html`<${Stack}>
    <${Text} tone="muted">${tr('setup.pickTool','Which AI tool are you connecting? The steps differ enough that the general version is not usable.')}<//>
    <${ToolPicker} tools=${tools} value=${tool.id} onPick=${pick} />
    <${McpInstallRow} tool=${tool} />
    ${tool.mcp.plans && html`<${Text} tone="muted">${tool.mcp.plans}<//>`}
    ${tool.mcp.warn && html`<${Surface} kind="aside"><${Text}>${tool.mcp.warn}<//><//>`}
    <${Steps} items=${tool.mcp.steps} />
    ${cmd && html`<${PromptCard} prompt=${cmd} copyLabel=${tr('setup.copyCmd','Copy the command')} copiedLabel=${tr('common.copied','Copied')} />`}
    <${Params} params=${tool.mcp.params} />
    ${tool.mcp.note && html`<${Text} tone="muted">${tool.mcp.note}<//>`}
    <${Action} kind="text" href=${tool.mcp.docs} target="_blank">
      ${tr('setup.officialDocs','Official instructions from')} ${tool.label} →<//>
  <//>`;
}

/**
 * The instruction block plus where to paste it. Opened from the profile card, so it answers the
 * two questions that arrive together: what do I paste, and where does it go in MY tool.
 */
export function InstructionsDialog({ open, onClose }) {
  const tools = useAiTools();
  const [toolId, setToolId] = useState(rememberedTool);
  const [orgs, setOrgs] = useState(null);
  const [orgId, setOrgId] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    getOrganismsTab()
      .then(tab => {
        if (cancelled) return;
        const arr = (tab && tab.mine) || [];
        setOrgs(arr);
        setOrgId(prev => prev || (arr[0] ? arr[0].id : ''));
      })
      .catch(err => { swallowed('ai-setup-guide: organisms', err); if (!cancelled) setOrgs([]); });
    return () => { cancelled = true; };
  }, [open]);

  const pick = (id) => {
    setToolId(id);
    // eslint-disable-next-line aimeat/no-silent-catch -- storage blocked only costs the remembered choice
    try { localStorage.setItem(LAST_TOOL_KEY, id); } catch { /* the choice just does not persist */ }
  };
  const tool = tools && tools.length ? pickTool(tools, toolId) : null;

  return html`<${Dialog} open=${open} onClose=${onClose} title=${tr('setup.instrTitle','AI chat instructions')}><${Stack}>
    <${Text} kind="lead">${tr('setup.instrLead','Paste this into your AI’s instructions and every conversation starts already knowing your structure. You stop re-explaining it, the AI stops guessing where things go, your agents write into the same places so they can build on each other’s work, and the same context stops being re-sent as tokens in every chat.')}<//>
    ${orgs === null ? html`<${Text} tone="muted">${tr('setup.loadingOrgs','Reading your organisms…')}<//>`
      : orgs.length === 0 ? html`<${Text} tone="muted">${tr('setup.noOrgs','You have no organism yet, and the block is generated from one. Create it first: the Hello MCP step on the MCP tab has a ready prompt for it.')}<//>`
      : html`${orgs.length > 1 && html`<${Field} type="select" label=${tr('setup.whichOrg','Which organism?')} value=${orgId}
          onChange=${e => setOrgId(e.target.value)} options=${orgs.map(o => ({value:o.id,label:o.name || o.id}))} />`}
        <${InstructionBlock} orgId=${orgId} />`}
    ${tool && html`<${Section} size="small" title=${tr('setup.whereTitle','Where it goes in your tool')}><${Stack}>
      <${ToolPicker} tools=${tools} value=${tool.id} onPick=${pick} />
      <${Text}>${tool.instructions.where}<//>
      ${tool.instructions.docs && html`<${Action} kind="text" href=${tool.instructions.docs} target="_blank">
        ${tr('setup.officialDocs','Official instructions from')} ${tool.label} →<//>`}
    <//><//>`}
  <//><//>`;}
