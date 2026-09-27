/**
 * @file public/views/appcat/ai-calls.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description appcat's calls to the person's own AI, on their own OpenRouter key through the node
 *   (/v1/ai/complete with app_id 'app-catalog', as the old catalogue sent it): whether the person has
 *   a key at all, one completion, the translation of a short app text between English and Finnish,
 *   and the edit of a whole app (the fixed system prompt and the pulling of an HTML document out of
 *   the reply). Shared by the detail's Edit with AI and About, and open to Promote and ODPS.
 * @structure hasAiKey() · aiComplete({ prompt, systemPrompt }) · translateText(text, src, dst) ·
 *   EDIT_SYSTEM_PROMPT · editPrompt(change, html) · extractHtmlFromAi(content)
 * @usage import { translateText } from '/views/appcat/ai-calls.js'; const fi = await translateText(en, 'en', 'fi');
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the old catalogue's detailAiRun, detailTranslateDesc and
 *     detailCheckAiAvailability (src/static/app-catalog/js/detail.js), their prompts unchanged.
 */
import { api, apiGet } from '/js/api.js';
import { getSession } from '/js/services/auth.js';

/** An edit can take minutes on a slow model with a large app. */
const AI_TIMEOUT_MS = 10 * 60 * 1000;

/** Whether the signed-in person has an AI key the node can use for them. Signed out → false. */
export async function hasAiKey() {
  if (!getSession()) return false;
  try {
    const j = await apiGet('/v1/openrouter/settings');
    return !!(j && j.data && (j.data.hasApiKey || j.data.has_api_key));
  } catch (err) {
    void err;
    // eslint-disable-next-line aimeat/no-silent-catch -- as on the old page, no answer is no key: the panel says how to get one
    return false;
  }
}

/**
 * One completion. Resolves to { content, budget } (budget.spent_today_usd when the node says it);
 * rejects with the node's error (err.code, err.message).
 */
export async function aiComplete({ prompt, systemPrompt }) {
  const j = await api('/v1/ai/complete', {
    method: 'POST',
    body: JSON.stringify({ prompt, systemPrompt, app_id: 'app-catalog' }),
    timeoutMs: AI_TIMEOUT_MS,
  });
  const data = (j && j.data) || {};
  return { content: typeof data.content === 'string' ? data.content : '', budget: data.budget || null };
}

const LANG_NAME = { en: 'English', fi: 'Finnish' };

/** Translate short app-store copy; resolves to the translation, '' when the model said nothing. */
export async function translateText(text, srcLang, dstLang) {
  const systemPrompt = 'You are a professional translator for short app-store copy. '
    + 'Translate the text from ' + (LANG_NAME[srcLang] || srcLang) + ' to ' + (LANG_NAME[dstLang] || dstLang) + '. '
    + 'Return ONLY the translated text — no quotes, no notes, no explanation. Keep it concise and natural.';
  const { content } = await aiComplete({ prompt: text, systemPrompt });
  return content.trim();
}

/** The system prompt of an edit: keep the node's integrations, one file, both themes. */
export const EDIT_SYSTEM_PROMPT = 'You are editing a single-file HTML web app that runs on the AIMEAT platform. '
  + 'You will be given the current full HTML source and a change request. '
  + 'Return the COMPLETE updated HTML document and NOTHING else — no explanations, no commentary, no markdown code fences. '
  + 'Preserve every existing AIMEAT integration (script tags loading /v1/libs/*, AIMEAT.* API calls, cortex extension scripts) unless the change specifically requires altering them. '
  + 'Keep the result a single self-contained file that supports both light and dark themes.';

/** The user prompt of an edit: the change, then the WHOLE source (a cut tail lost apps their end). */
export function editPrompt(change, html) {
  return 'Change request:\n' + change + '\n\nCurrent HTML source:\n' + html;
}

/**
 * A whole HTML document out of a model's reply: a markdown fence and prose around it go; a reply
 * with no document marker counts only when it looks like markup. null when there is none.
 */
export function extractHtmlFromAi(content) {
  if (!content) return null;
  let text = String(content).trim();
  const fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) text = fence[1].trim();
  const lower = text.toLowerCase();
  const startDoc = lower.indexOf('<!doctype');
  const start = startDoc !== -1 ? startDoc : lower.indexOf('<html');
  if (start === -1) return text.indexOf('<') !== -1 && text.indexOf('>') !== -1 && text.length > 30 ? text : null;
  return text.slice(start);
}
