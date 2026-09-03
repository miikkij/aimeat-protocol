/**
 * @file pricing.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pure pricing + ranking helpers for the AI provider model pickers. No Preact, no DOM,
 *   no network — everything here is a function of the model list the provider returned, which is what
 *   makes it the one place the pricing rules can be read and checked.
 *
 *   THE RULE THAT MATTERS: chat models are priced per token and can be shown as $/M. Audio models
 *   cannot. Measured 2026-08-01, `openai/whisper-large-v3` reports pricing.prompt 0.0015 on Together
 *   and 0.111 on Groq — per minute and per hour respectively, with nothing in the API distinguishing
 *   them. So audioPriceLabel() shows the reported number WITHOUT inventing a unit, and the settings
 *   page pairs it with a real measured cost from a test transcription. A derived "$/min" here would be
 *   confidently wrong for whole providers.
 * @structure perMillion / fmtUsdPerMillion / chatPriceLabel / audioPriceLabel / isFree /
 *   acceptsImages / modelPageUrl / rankModels
 * @usage import { chatPriceLabel, rankModels } from './pricing.js';
 * @version-history
 *   v1.1.0 — 2026-09-03 — Two things the catalogue taught since August. A price of -1 is
 *     OpenRouter's "varies" (the auto routers), and multiplying it by a million printed
 *     "$-1000000.000 / M" on eight recommended rows; chatPriceLabel now says "price varies". And a
 *     model that does not produce TEXT (Lyria 3 makes music) sat at the top of the chat
 *     recommendations because it has the largest context in its price band; answersInText() keeps
 *     the chat, reasoning, execution and vision lists to models that can answer a chat turn, and
 *     producesImages() is the pool for the image role.
 *   v1.0.0 — 2026-08-01 — Extracted from the settings panel as part of the OpenRouter settings rework.
 */

/** A per-token price as dollars per million tokens, or null when the provider gave no number. */
export function perMillion(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n * 1e6 : null;
}

/** Format a per-million figure. Sub-dollar prices need three decimals to say anything at all. */
export function fmtUsdPerMillion(n) {
  if (n === null || !Number.isFinite(n)) return null;
  if (n === 0) return '0';
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

/** true when the model costs nothing to prompt (17 of the 336 catalogue models at time of writing). */
export function isFree(model) {
  return Number(model?.pricing?.prompt) === 0 && Number(model?.pricing?.completion || 0) === 0;
}

/** Whether the model reads images. Read from what it declares, never guessed from its name. */
export function acceptsImages(model) {
  return Array.isArray(model?.input_modalities) && model.input_modalities.includes('image');
}

/** Whether the model reads audio directly in a chat turn (a different thing from an STT model). */
export function acceptsAudio(model) {
  return Array.isArray(model?.input_modalities) && model.input_modalities.includes('audio');
}

/**
 * Whether the model can answer a chat turn at all. A provider that does not describe its outputs is
 * taken at its word; one that does and leaves text out (a music or image model) is not a chat model
 * however large its context.
 */
export function answersInText(model) {
  const out = model?.output_modalities;
  return !Array.isArray(out) || out.includes('text');
}

/**
 * Whether the model is a chat model and nothing else. Lyria 3 declares text AND audio out and is a
 * music model with a 1 M context and a price of zero, which put it at the top of the free band; a
 * recommendation for a chat turn wants models that only answer in text (or text and images).
 */
export function answersOnlyInText(model) {
  const out = model?.output_modalities;
  return !Array.isArray(out) || (out.includes('text') && out.every((o) => o === 'text' || o === 'image'));
}

/** Whether the model produces images: the pool for the image-generation role. */
export function producesImages(model) {
  return Array.isArray(model?.output_modalities) && model.output_modalities.includes('image');
}

/** OpenRouter reports -1 for a router whose price depends on the model it picks. */
export function priceVaries(model) {
  return Number(model?.pricing?.prompt) < 0;
}

/**
 * "$5.00 / M in · $25.00 / M out" for a chat model, or null when the provider reported no pricing
 * (LM Studio and self-hosted endpoints do not).
 */
export function chatPriceLabel(model, t) {
  const inUsd = fmtUsdPerMillion(perMillion(model?.pricing?.prompt));
  if (inUsd === null) return null;
  if (priceVaries(model)) return t('profile.openrouter.price.varies');
  if (isFree(model)) return t('profile.openrouter.price.free');
  const outUsd = fmtUsdPerMillion(perMillion(model?.pricing?.completion));
  const inPart = t('profile.openrouter.price.perMillionIn', { usd: inUsd });
  return outUsd === null ? inPart : `${inPart} · ${t('profile.openrouter.price.perMillionOut', { usd: outUsd })}`;
}

/**
 * The reported price of an audio model, stated as a bare number.
 *
 * Deliberately unitless: see the file header. The caller shows this next to a link to the model page,
 * where the unit is written out, and next to the measured cost of a real transcription.
 */
export function audioPriceLabel(model, t) {
  const raw = model?.pricing?.prompt;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return t('profile.openrouter.price.free');
  // Trailing zeros stripped: 0.00150 reads as a different number from 0.0015 to a human eye.
  return t('profile.openrouter.price.audioReported', { value: String(Number(n.toPrecision(6))) });
}

/** The model's page on OpenRouter. Only meaningful for OpenRouter itself. */
export function modelPageUrl(modelId) {
  return `https://openrouter.ai/${modelId}`;
}

/** Context length as "200 k", or null. */
export function contextLabel(model) {
  const n = Number(model?.context_length);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n >= 1000 ? `${Math.round(n / 1000)} k` : String(n);
}

/**
 * The short "recommended" group shown above the full list.
 *
 * Derived from the live catalogue by rule, never a hardcoded list of slugs: the catalogue changes
 * weekly, and a pinned list would rot silently into recommending models that no longer exist.
 *
 *  - transcription: the whole list is small (13 models), so it is simply ordered by reported price.
 *  - vision: image-capable models, cheapest input first.
 *  - chat: the largest context in each of three price bands (free / under $1 per M / above), which
 *    surfaces one sensible default per budget rather than 336 undifferentiated rows.
 */
export function rankModels(models, modality) {
  const all = Array.isArray(models) ? models.slice() : [];
  // A price of -1 means "varies": it is not the cheapest of anything, so it sorts last.
  const priceOf = (m) => {
    const n = Number(m?.pricing?.prompt);
    return Number.isFinite(n) && n >= 0 ? n : Number.POSITIVE_INFINITY;
  };

  if (modality === 'transcription' || modality === 'speech') {
    return all.sort((a, b) => priceOf(a) - priceOf(b));
  }
  if (modality === 'image') {
    return all.filter(producesImages).sort((a, b) => priceOf(a) - priceOf(b));
  }

  // Everything below recommends a model for a CHAT turn, so a model that also makes music or video
  // is out before any ranking, whatever its context length.
  const list = all.filter(answersOnlyInText);
  if (modality === 'vision') {
    return list.filter(acceptsImages).sort((a, b) => priceOf(a) - priceOf(b));
  }

  const byContext = (a, b) => (Number(b.context_length) || 0) - (Number(a.context_length) || 0);
  const paid = (m) => !isFree(m) && !priceVaries(m) && perMillion(m?.pricing?.prompt) !== null;
  const bands = [
    list.filter((m) => isFree(m)),
    list.filter((m) => paid(m) && perMillion(m.pricing.prompt) < 1),
    list.filter((m) => paid(m) && perMillion(m.pricing.prompt) >= 1),
  ];
  const picked = [];
  const seen = new Set();
  for (const band of bands) {
    for (const m of band.sort(byContext).slice(0, 2)) {
      if (!seen.has(m.id)) { seen.add(m.id); picked.push(m); }
    }
  }
  // The free router is a genuine default (no vendor pinned), so it leads the list whenever the
  // catalogue has it, whether or not the banding above surfaced it.
  const free = list.find((m) => m.id === 'openrouter/free');
  if (!free) return picked;
  return [free, ...picked.filter((m) => m.id !== free.id)];
}

/** Case-insensitive match over id and display name. */
export function matchesQuery(model, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return String(model.id).toLowerCase().includes(q) || String(model.name || '').toLowerCase().includes(q);
}
