/**
 * @file instruction-block.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The copyable instruction block for one organism, in the three formats people
 *   actually paste into: CLAUDE.md, AGENTS.md, and the AI chat's own instructions field. Each
 *   format says where it goes, because "copy this" without "put it here" is where these die.
 *
 *   The block is GENERATED from the organism's real structure on the server (its id, its actual
 *   workspaces and their spaces), never from a template. That is the difference between an AI
 *   that knows where things live and one that asks or guesses.
 *
 *   Reused by the Hello MCP panel (step 5 of onboarding) and by the button on every organism, so
 *   the wording and the generation path cannot diverge between the two.
 * @structure InstructionBlock({ orgId }) — format tabs + block + copy + placement line
 * @usage import { InstructionBlock } from '/views/profile/instruction-block.js';
 * @version-history
 *   2026-09-13: Shared choices, text and prompt surface own instruction presentation.
 *   v1.0.0 — 2026-07-31 — Initial.
 *   v1.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale } from '/js/i18n.js';
import { PromptCard } from '/components/PromptCard.js';
import { Stack, Text, Action } from '/components/poster-parts.js';
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

  if (failed) return html`<${Text} tone="muted">${tr('instrBlock.failed', 'Could not read this organism’s structure just now. Try again shortly.')}<//>`;
  if (!data) return html`<${Text} tone="muted">${tr('instrBlock.loading', 'Reading the structure…')}<//>`;

  const text = (data.blocks && data.blocks[fmt]) || '';
  const active = FORMATS.find(f => f.id === fmt) || FORMATS[0];
  const placement = (data.placement && data.placement[active.place]) || '';

  return html`<${Stack}>
    <${Stack} direction="wrap">${FORMATS.map(f => html`<${Action} key=${f.id} kind="tab" selected=${f.id === fmt}
      onClick=${() => setFmt(f.id)}>${tr(f.labelKey,f.labelFallback)}<//>`)}<//>
    <${Text}>${placement}<//>
    <${PromptCard} prompt=${text} copyLabel=${tr('instrBlock.copy','Copy the block')} copiedLabel=${tr('common.copied','Copied')} />
    <${Text} kind="caption">${tr('instrBlock.from','Generated from')} ${data.organism_name || data.organism_id}${
      Array.isArray(data.workspaces) && data.workspaces.length ? ', '+data.workspaces.length+' '+tr('instrBlock.workspaces','workspaces') : ''}<//>
  <//>`;
}

export default InstructionBlock;
