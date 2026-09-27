/**
 * @file public/views/appcat/dialogs/share-prompt.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Share an app as a prompt (features F148): "Recreate this HTML app exactly as provided.",
 *   the app's name and tags, "Return the COMPLETE HTML file…", then the source. Opening it copies the
 *   prompt and says "Share prompt copied! Paste it into any AI chat to recreate this app."; nothing
 *   stays open. When the browser refuses the copy, the prompt shows read-only in the source dialog,
 *   titled "Share Prompt: {name}", to copy by hand. An app with no bytes says "Only local HTML apps can
 *   be shared as prompts." The prompt's own words are English on purpose: they speak to an AI.
 * @structure default SharePromptDialog({ name, tags, html }) · buildSharePrompt({ name, tags, html })
 * @usage openDialog('share-prompt', { name, tags, html })  — props: name, tags (array), html (the
 *   app's source as text).
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial (appcat, dialogs builder 2), from the old render.js generateSharePrompt.
 */
import { h } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { notice } from '/views/appcat/store.js';
import { x } from '/views/appcat/i18n.js';
import SourceDialog from '/views/appcat/dialogs/source.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/** The share prompt, word for word as the old page built it. */
export function buildSharePrompt({ name, tags, html: source }) {
  let p = 'Recreate this HTML app exactly as provided.\n\n';
  p += 'App name: ' + (name || 'Untitled') + '\n';
  if (tags && tags.length) p += 'Tags: ' + tags.join(', ') + '\n';
  p += '\nReturn the COMPLETE HTML file below without modifications.\n';
  p += 'If the user asks for changes, apply them to this source.\n\n';
  p += '--- Source Code ---\n' + source;
  return p;
}

export default function SharePromptDialog({ name, tags, html: source, close }) {
  const [fallback, setFallback] = useState(null);

  useEffect(() => {
    if (typeof source !== 'string') { notice(x('share.onlyLocal'), 'error'); close?.(); return; }
    const prompt = buildSharePrompt({ name, tags, html: source });
    const write = navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(prompt)
      : Promise.reject(new Error('no clipboard'));
    write.then(() => { notice(x('share.copied'), 'success'); close?.(); })
      // A refused clipboard is answered by showing the prompt to copy by hand, as the old page did.
      .catch((err) => { swallowed('appcat: share prompt clipboard', err); setFallback(prompt); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the copy is the act of opening, so it runs once
  }, []);

  if (fallback === null) return null;
  return html`<${SourceDialog} title=${x('share.titleFor', { name: name || 'App' })} text=${fallback} readOnly close=${close} />`;
}
