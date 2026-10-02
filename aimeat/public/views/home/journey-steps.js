/**
 * @file public/views/home/journey-steps.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person's next steps, read from GET /v1/home/state `journey` (services/journey-state.ts),
 *   in one place for every page that shows a first step: the settings overview, the help page and the
 *   chat's starters. Each stage has one name, one line under it and one place where it is done, so the
 *   pages cannot drift into six different first steps again (survey 2026-10-02, gap 1).
 *
 *   The order is the server's: `journey.next` first, then the open stages after it. A visitor has no
 *   journey, so VISITOR_STEPS is the order a newcomer meets, as plain text.
 * @structure
 *   - STEP — stage id → its locale key part and where it is done
 *   - VISITOR_STEPS — the steps shown to someone who is not signed in
 *   - openSteps(journey) — the open stages from `next` onward, or null without a journey
 *   - stepTitle(id), stepLine(id), stepHref(id)
 *   - useJourney() — the shared /v1/home/state read, empty for a visitor
 * @usage import { openSteps, stepTitle, useJourney } from './home/journey-steps.js';
 * @version-history
 *   v1.0.0 — 2026-10-03 — Initial: one first step everywhere a person meets one (guidance A2).
 */
import { t } from '/js/i18n.js';
import { hasSession } from '/js/services/auth.js';
import { useShared } from '/views/surface/shared-read.js';

/** Stage id → the part of its locale keys (homeJourney.step<Part>, …Desc) and where it is done. */
export const STEP = {
  'first-result': { part: 'FirstResult', href: '/v1/home#home-journey-title' },
  ai: { part: 'Ai', href: '/v1/home#home-roads' },
  connect: { part: 'Connect', tab: 'mcp' },
  organise: { part: 'Organise', tab: 'organisms' },
  apps: { part: 'Apps', href: '/v1/appcat' },
  agents: { part: 'Agents', tab: 'agents' },
  share: { part: 'Share', tab: 'organisms' },
};

/** What a visitor reads: make your profile with your AI, connect it, a shared place, apps, agents. */
export const VISITOR_STEPS = ['first-result', 'connect', 'organise', 'apps', 'agents'];

/**
 * The stages still open, `journey.next` first and the open ones after it in the server's order.
 * An empty list means the path is walked; null means there is no journey to read.
 */
export function openSteps(journey) {
  if (!journey || !Array.isArray(journey.stages)) return null;
  if (!journey.next) return [];
  const from = journey.stages.findIndex((s) => s.id === journey.next);
  return journey.stages.slice(Math.max(from, 0))
    .filter((s) => !s.done && !s.declined && STEP[s.id])
    .map((s) => s.id);
}

export const stepTitle = (id) => t('homeJourney.step' + STEP[id].part);
export const stepLine = (id) => t('homeJourney.step' + STEP[id].part + 'Desc');
export const stepHref = (id) => STEP[id].href ?? '/v1/profile?tab=' + STEP[id].tab;

/** The same domains as useHomeState (views/surface/home-state.js), since it is the same read. */
const DOMAINS = ['home', 'agents', 'portfolio', 'agent-onboarding', 'ghii'];

/**
 * The journey from the one shared read of /v1/home/state. A visitor asks for nothing, so `ready`
 * stays false and `journey` null for them.
 */
export function useJourney() {
  const { data, ready } = useShared('home-state', hasSession() ? '/v1/home/state' : '', DOMAINS,
    (d) => d?.journey ?? null);
  return { journey: data, ready };
}
