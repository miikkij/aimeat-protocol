/**
 * @file public/views/surface/home-state.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one read of GET /v1/home/state, named. Four blocks want it — the nameplate, the
 *   mat line, the fleet line and the playbooks — and it is one endpoint, so it is one read.
 *
 *   A thin naming of shared-read.js rather than a second mechanism beside it: one way to share a
 *   read on these pages, not two that drift.
 * @structure useHomeState
 * @usage const { state, playbooks, ready } = useHomeState();
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import { useShared } from '/views/surface/shared-read.js';

/** Domains that can change what /v1/home/state says. */
const DOMAINS = ['home', 'agents', 'portfolio', 'agent-onboarding', 'ghii'];

export function useHomeState() {
  const { data, ready } = useShared('home-state', '/v1/home/state', DOMAINS, (d) => ({
    state: d?.state ?? null,
    playbooks: Array.isArray(d?.playbooks) ? d.playbooks : [],
    steps: Array.isArray(d?.steps) ? d.steps : [],
    question: d?.question ?? null,
    clientOptions: d?.client_options ?? null,
  }));
  return {
    state: data?.state ?? null,
    playbooks: data?.playbooks ?? [],
    steps: data?.steps ?? [],
    question: data?.question ?? null,
    clientOptions: data?.clientOptions ?? null,
    ready,
  };
}
