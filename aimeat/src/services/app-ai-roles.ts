/**
 * @file app-ai-roles.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI roles an app declares in its aimeat-ai meta (wish-tekoalyn-roolit): what each
 *   role is for and what it needs, never which model. The owner binds each one to a role of theirs
 *   (services/ai/roles.ts), and until then the role does not run.
 *
 *     <meta name="aimeat-ai" content="generates=text,image; role.summarizer=text;
 *       role.summarizer.purpose=Short summaries of a recipe; role.summarizer.temperature=0.2;
 *       role.illustrator=text+image; role.illustrator.local=no">
 *
 *   `role.<name>=` is the capabilities joined with `+`. The fields after it: `purpose` (free text
 *   without `;`), `local=yes` (this machine only), `context=<tokens>` (the least context the role
 *   needs), and the fine-tuning the app wants for that role: `temperature`, `top_p`, `max_tokens`,
 *   `reasoning` (off, low, medium, high). The fine-tuning is the app's (Jouni, 2026-09-28): it
 *   overrides a default set on the provider, and an empty one leaves the model's own.
 *
 *   Pure: no storage, so the publish path (storage/types/apps.ts → app-ai-posture) closes no cycle.
 * @structure AppAiRole · parseAppAiRoles · APP_ROLE_NAME_RE
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial.
 */
import type { AiCapability } from './ai/types.js';

export const APP_ROLE_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CAPS: readonly AiCapability[] = ['text', 'vision', 'files', 'image', 'speech', 'transcription', 'embed'];
const MAX_ROLES = 20;

export interface AppAiRoleParams {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  reasoning?: 'off' | 'low' | 'medium' | 'high';
}

export interface AppAiRole {
  name: string;
  capabilities: AiCapability[];
  purpose?: string;
  local?: boolean;
  /** The least context, in tokens, the role needs. */
  context?: number;
  params?: AppAiRoleParams;
}

const num = (v: string | undefined, min: number, max: number): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

/**
 * The roles in a meta's key=value pairs (keys lower-cased, values as written). A role whose
 * capabilities do not read is left out, never fatal: a malformed declaration must not stop a publish.
 */
export function parseAppAiRoles(raw: ReadonlyMap<string, string>): { roles: AppAiRole[]; invalid: string[] } {
  const roles: AppAiRole[] = [];
  const invalid: string[] = [];
  for (const [key, value] of raw) {
    const m = /^role\.([^.]+)$/.exec(key);
    if (!m) continue;
    const name = m[1];
    const caps = value.toLowerCase().split('+').map((s) => s.trim()).filter(Boolean);
    if (!APP_ROLE_NAME_RE.test(name) || !caps.length || caps.some((c) => !(CAPS as readonly string[]).includes(c))) { invalid.push(`role.${name}`); continue; }
    const field = (f: string) => raw.get(`role.${name}.${f}`);
    const reasoning = field('reasoning')?.toLowerCase();
    const params: AppAiRoleParams = {
      ...(num(field('temperature'), 0, 2) !== undefined ? { temperature: num(field('temperature'), 0, 2) } : {}),
      ...(num(field('top_p'), 0, 1) !== undefined ? { top_p: num(field('top_p'), 0, 1) } : {}),
      ...(num(field('max_tokens'), 1, 1_000_000) !== undefined ? { max_tokens: Math.round(num(field('max_tokens'), 1, 1_000_000)!) } : {}),
      ...(reasoning === 'off' || reasoning === 'low' || reasoning === 'medium' || reasoning === 'high' ? { reasoning } : {}),
    };
    const purpose = field('purpose')?.trim();
    const context = num(field('context'), 1, 10_000_000);
    const local = field('local')?.toLowerCase();
    roles.push({
      name,
      capabilities: [...new Set(caps)] as AiCapability[],
      ...(purpose ? { purpose: purpose.slice(0, 300) } : {}),
      ...(local === 'yes' || local === 'true' ? { local: true } : {}),
      ...(context ? { context: Math.round(context) } : {}),
      ...(Object.keys(params).length ? { params } : {}),
    });
    if (roles.length >= MAX_ROLES) break;
  }
  return { roles, invalid };
}
