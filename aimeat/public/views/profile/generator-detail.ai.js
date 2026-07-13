/**
 * @file views/profile/generator-detail.ai.js
 * @description OpenRouter autopilot AI-call utilities plus the backend prompt loader for the
 *   service generator. Extracted from generator-detail.js to satisfy max-file-lines.
 * @structure
 *   - stripCodeblock: strip markdown codeblock wrappers from an AI response
 *   - runWithAi: POST a prompt to /v1/openrouter/complete (30-min timeout, cancellable)
 *   - cancelAiRequest: abort the active AI request
 *   - loadPromptFromBackend: load a component prompt (code|spec|test) from the DB via API
 * @usage
 *   import { runWithAi, stripCodeblock, cancelAiRequest, loadPromptFromBackend } from './generator-detail.ai.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-detail.js (max-file-lines)
 */

/* ── OpenRouter Autopilot Helpers (shared) ───────────── */

// Active AbortController for current AI request — allows instant cancel
let _activeAiController = null;

/** Strip markdown codeblock wrapper if AI wrapped the response in ``` */
export function stripCodeblock(text) {
  if (!text) return text;
  const trimmed = text.trim();
  // Count how many ``` fences exist
  const fenceCount = (trimmed.match(/^```/gm) || []).length;
  if (fenceCount === 2) {
    // Single code block wrapper: ```lang\n...\n``` — strip the outer fences
    const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)```\s*$/);
    if (match) return match[1].trim();
  }
  if (fenceCount > 2) {
    // Multiple code blocks inside (e.g., cortex: ```yaml + ```javascript, or extension: ```yaml + ```js per action)
    // Check if the ENTIRE response is wrapped in an OUTER fence (AI sometimes does this)
    const outerMatch = trimmed.match(/^```\s*\n([\s\S]*)\n```\s*$/);
    if (outerMatch) return outerMatch[1].trim();

    // Extension multi-block pattern: ```yaml\n...\n``` followed by one or more ```javascript\n...\n```
    // Combine into single text: YAML content + JS content separated by // actions/... markers
    const blocks = [];
    const blockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = blockRegex.exec(trimmed)) !== null) {
      blocks.push({ lang: match[1], content: match[2].trim() });
    }
    if (blocks.length >= 2) {
      const yamlBlock = blocks.find(b => b.lang === 'yaml' || b.lang === 'yml');
      const jsBlocks = blocks.filter(b => b.lang === 'javascript' || b.lang === 'js' || b.lang === '');
      if (yamlBlock && jsBlocks.length > 0) {
        // Check if JS blocks already have // actions/ markers — if so, combine cleanly
        const hasActionMarkers = jsBlocks.some(b => /^\/\/\s*actions\//m.test(b.content));
        if (hasActionMarkers) {
          // Extension format: YAML manifest + action files with // actions/ markers
          return yamlBlock.content + '\n' + jsBlocks.map(b => b.content).join('\n');
        }
      }
      // Generic multi-block: combine all blocks
      return blocks.map(b => b.content).join('\n\n');
    }

    // Fallback: return with fences — the validator can handle them
    return trimmed;
  }
  // No fences or unparseable — return as-is
  return trimmed;
}

export async function runWithAi(projectId, prompt, systemPrompt = null) {
  const body = { projectId, prompt };
  if (systemPrompt) body.systemPrompt = systemPrompt;
  // Use direct fetch with 10-minute timeout (apiPost has 30s limit)
  const controller = new AbortController();
  _activeAiController = controller;
  const timeoutId = setTimeout(() => controller.abort(), 1_800_000); // 30 min
  const headers = { 'Content-Type': 'application/json' };
  const session = window.AIMEAT?.auth?.getSession?.();
  if (session?.jwt) headers['Authorization'] = 'Bearer ' + session.jwt;
  try {
    const raw = await fetch('/v1/openrouter/complete', {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    });
    if (!raw.ok) {
      // Try to parse error body, fall back to status text
      let msg = `HTTP ${raw.status}`;
      try { const e = await raw.json(); msg = e.error?.message || msg; } catch { /* ignore */ }
      throw new Error(msg);
    }
    const resp = await raw.json();
    if (resp.ok === false) throw new Error(resp.error?.message || 'OpenRouter error');
    return resp.data.content;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Cancelled', { cause: e });
    if (e.name === 'TypeError') throw new Error('Network error — connection lost', { cause: e });
    throw e;
  } finally {
    clearTimeout(timeoutId);
    _activeAiController = null;
  }
}

/** Abort the active AI request immediately */
export function cancelAiRequest() {
  if (_activeAiController) _activeAiController.abort();
}

/* ── Prompt Loading (from database via API — single source of truth) ── */

/**
 * Load a component prompt from the database via the backend API.
 * Replaces the old browser-side buildComponentPrompt() which used local JS templates.
 * @param {string} projectId
 * @param {string} componentId
 * @param {'code'|'spec'|'test'} type - prompt type
 * @returns {Promise<string>} the prompt text
 */
export async function loadPromptFromBackend(projectId, componentId, type = 'code') {
  const s = window.AIMEAT?.auth?.getSession?.();
  if (!s) throw new Error('Not authenticated');
  const resp = await s.fetch(`/v1/generator/${projectId}/prompts/${componentId}?type=${type}`);
  if (!resp.ok) throw new Error(resp.error?.message || 'Failed to load prompt');
  return resp.data?.prompt || '';
}
