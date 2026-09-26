/**
 * @file public/components/InstructionBlock.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The copyable instruction block for one organism, in the three formats people
 *   actually paste into: CLAUDE.md, AGENTS.md, and the AI chat's own instructions field. Each
 *   format says where it goes, because "copy this" without "put it here" is where these die.
 *
 *   The block is GENERATED from the organism's real structure on the server (its id, its actual
 *   workspaces and their spaces), never from a template. That is the difference between an AI
 *   that knows where things live and one that asks or guesses. It is refetched when the language
 *   changes, because the server writes it in the reader's language.
 *
 *   Reused by the Hello MCP panel (step 5 of onboarding), the instructions dialog and the button on
 *   every organism, so the wording and the generation path cannot diverge between them. A page
 *   passes the organism's id; it never writes a class. The look is
 *   css/components/instruction-block.css (.instruction-block-*), with the library's tab row and
 *   action link inside it.
 * @structure InstructionBlock({ orgId }) — format tabs + block + copy + placement line
 * @usage import { InstructionBlock } from '/components/InstructionBlock.js';
 * @version-history
 *   v1.0.1 — 2026-09-27 — Draws its own class names (.ib-* → .instruction-block-*, .ib-block →
 *     .instruction-block-text), its sheet css/components/instruction-block.css, moved unchanged out
 *     of hello-mcp.css (a move, same look).
 *   v1.0.0 — 2026-09-26 — Moved out of views/profile/instruction-block.js (v1.2.0) with its markup and
 *     behaviour, so the page files write no class: the format tabs are the library's Tabs and the
 *     copy is the Action's copy (page group G1a). Its history continues here.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { Tabs } from '/components/Tabs.js';
import { Action } from '/components/Action.js';
import { fetchInstructionBlock } from '/js/services/hello-mcp.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const FORMATS = [
  { id: 'chat_instructions', labelKey: 'instrBlock.fmt.chat', labelFallback: 'AI chat instructions', place: 'chatInstructions' },
  { id: 'claude_md', labelKey: 'instrBlock.fmt.claude', labelFallback: 'CLAUDE.md', place: 'claudeMd' },
  { id: 'agents_md', labelKey: 'instrBlock.fmt.agents', labelFallback: 'AGENTS.md', place: 'agentsMd' },
];

/** @param {{ orgId: string }} props */
export function InstructionBlock({ orgId }) {
  const [data, setData] = useState(null);
  const [fmt, setFmt] = useState('chat_instructions');
  const [failed, setFailed] = useState(false);

  // The block is generated server-side in the caller's language, so a language switch has to
  // refetch it. Without this, switching the portal to English left a Finnish block on screen and
  // the placement lines around it in English.
  const [lang, setLang] = useState(getLocale());
  useEffect(() => {
    const onLang = () => setLang(getLocale());
    window.addEventListener('lang-change', onLang);
    return () => window.removeEventListener('lang-change', onLang);
  }, []);

  useEffect(() => {
    if (!orgId) { setData(null); return undefined; }
    let cancelled = false;
    setData(null); setFailed(false);
    fetchInstructionBlock(orgId)
      .then(d => { if (!cancelled) setData(d); })
      .catch(err => { swallowed('instruction-block: fetch', err); if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [orgId, lang]);

  if (failed) return html`<p class="instruction-block-note">${tr('instrBlock.failed', 'Could not read this organism’s structure just now. Try again shortly.')}</p>`;
  if (!data) return html`<p class="instruction-block-note">${tr('instrBlock.loading', 'Reading the structure…')}</p>`;

  const text = (data.blocks && data.blocks[fmt]) || '';
  const active = FORMATS.find(f => f.id === fmt) || FORMATS[0];
  const placement = (data.placement && data.placement[active.place]) || '';

  return html`
    <div class="instruction-block">
      <div class="instruction-block-tabs">
        <${Tabs} kind="view" value=${fmt} onSelect=${setFmt}
          items=${FORMATS.map(f => ({ value: f.id, key: f.id, label: tr(f.labelKey, f.labelFallback) }))} />
      </div>
      <p class="instruction-block-place">${placement}</p>
      <pre class="instruction-block-text">${text}</pre>
      <div class="instruction-block-actions">
        <${Action} small copy=${text} copiedLabel=${tr('common.copied', 'Copied')}>${tr('instrBlock.copy', 'Copy the block')}<//>
        <span class="instruction-block-meta">${tr('instrBlock.from', 'Generated from')} ${data.organism_name || data.organism_id}${
          Array.isArray(data.workspaces) && data.workspaces.length
            ? `, ${data.workspaces.length} ${tr('instrBlock.workspaces', 'workspaces')}` : ''}</span>
      </div>
    </div>`;
}

export default InstructionBlock;
