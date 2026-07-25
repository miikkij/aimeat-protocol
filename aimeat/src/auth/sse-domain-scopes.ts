/**
 * @file sse-domain-scopes.ts
 * @description Authorization for the SSE live-update stream: which change DOMAINS a given
 *   principal may be told about. The stream carries no payload (only domain names), but a
 *   domain name plus its timing is still metadata: an app granted `memory:read` must not
 *   learn that the owner's messages, wallet or agent tasks just changed. H-2 app-origin
 *   isolation fences an app's DATA access; this fences its CHANGE-NOTIFICATION access the
 *   same way, using the very same scope vocabulary the owner approved at sign-in.
 *
 *   Owner sessions (a human on the apex portal) see everything — the whole keyspace is
 *   theirs. Every other principal (app grant, agent, ecosystem app, anonymous) is RESTRICTED:
 *   a domain is forwarded only when the principal holds the scope that domain maps to, and a
 *   domain absent from the map is DENIED. Deny-by-default is deliberate: a new domain added
 *   elsewhere in the node must not silently start leaking to sandboxed apps. Adding the
 *   mapping is a one-line, reviewable decision.
 * @structure DOMAIN_SCOPE (domain → required scope) · isOwnerPrincipal · allowedDomains ·
 *   filterDomains
 * @usage
 *   const restricted = !isOwnerPrincipal(req.auth!);
 *   const allow = allowedDomains(req.auth!.scopes);        // Set<string> | null (null = all)
 *   const visible = filterDomains(['memory', 'wallet'], allow);
 * @version-history
 *   v1.0.0 — 2026-07-25 — Initial: scope-gated SSE domains (an app-grant stream no longer
 *     sees every domain in the owner's keyspace).
 */

/**
 * Change domain → the scope a RESTRICTED principal must hold to be told about it.
 * Keys are the domain strings passed to `emitChange(domain, …)`. Anything not listed here
 * is invisible to restricted principals (operator/infra domains: config, features, admin-*,
 * federation, disputes, appeals, verification, totp, ghii, owners, consent, flags, feedback,
 * instances, extensions, cortex, skills, portfolio, ecosystem-apps, presence, realtime).
 */
export const DOMAIN_SCOPE: Readonly<Record<string, string>> = Object.freeze({
  // Owner data the app already reads
  memory: 'memory:read',
  personal: 'memory:read',
  files: 'storage:read',

  // Structured spaces
  organisms: 'organism:read',
  schemas: 'organism:read',
  templates: 'organism:read',
  csm: 'organism:read',
  msm: 'organism:read',

  // Public discovery surfaces
  catalogue: 'catalogue:read',
  apps: 'catalogue:read',
  'app-store': 'catalogue:read',
  site: 'catalogue:read',

  // Social
  boards: 'social:read',
  groups: 'social:read',
  matches: 'social:read',

  // Conversations
  messages: 'messages:read',
  'agent-messages': 'messages:read',
  chat: 'messages:read',

  // Economy
  wallet: 'wallet:read',

  // Knowledge
  knowledge: 'knowledge:read',
  packages: 'knowledge:read',

  // The owner's fleet
  'agent-tasks': 'task:read',
  agents: 'task:read',
  work: 'task:read',
  actions: 'task:read',
  'agent-usage': 'task:read',
  'agent-capabilities': 'task:read',
  'agent-directives': 'task:read',
  'agent-onboarding': 'task:read',

  // Automation
  workflows: 'workflow:read',
  scheduler: 'workflow:read',

  // Nudges
  notifications: 'notifications:send',
  push: 'notifications:send',
});

/**
 * True for a human owner session on the apex portal — the principal whose keyspace this is.
 * An app grant carries roles ['app'] (never 'owner'), so it is restricted even though it acts
 * on the owner's behalf; agents and ecosystem apps are restricted for the same reason.
 */
export function isOwnerPrincipal(auth: { roles?: string[] }): boolean {
  const roles = auth.roles ?? [];
  if (roles.includes('app') || roles.includes('agent') || roles.includes('ecosystem')) return false;
  return roles.includes('owner');
}

/**
 * The domains a restricted principal holding `scopes` may be told about, or `null` when no
 * filtering applies (owner sessions). A wildcard scope ('*') also disables filtering — the
 * node's own dev/default-scope escape hatch, unchanged in meaning here.
 */
export function allowedDomains(scopes: string[] | undefined): Set<string> | null {
  const held = new Set(scopes ?? []);
  if (held.has('*')) return null;
  const out = new Set<string>();
  for (const [domain, needed] of Object.entries(DOMAIN_SCOPE)) {
    if (held.has(needed)) out.add(domain);
  }
  return out;
}

/** Keep only the domains this principal may see. `allow === null` passes everything through. */
export function filterDomains(domains: string[], allow: Set<string> | null): string[] {
  if (!allow) return domains;
  return domains.filter(d => allow.has(d));
}
