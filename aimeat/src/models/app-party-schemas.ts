/**
 * @file src/models/app-party-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The zod shapes of the app party request bodies (routes/app-parties.ts; plan
 *   doc-mvwxcas3dom3, D4): validateBody bounds every field before the handler runs, and
 *   services/app-parties/ checks what each means.
 * @structure AppPartySignupSchema · AppPartySigninSchema · AppPartyVerifySchema · AppPartyRegistrationSchema ·
 *   AppPartyDataSchema · AppPartyDecisionSchema · EmptyBodySchema
 * @usage router.post('/v1/apps/:owner/:filename/parties/signup', validateBody(AppPartySignupSchema, config.nodeId), handler)
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4.2, D4.3).
 */
import { z } from 'zod';

const email = z.string().max(320);
const lang = z.string().max(8);

export const AppPartySignupSchema = z.object({ email, display_name: z.string().max(120).optional(), lang: lang.optional() });
export const AppPartySigninSchema = z.object({ email, lang: lang.optional() });
export const AppPartyVerifySchema = z.object({ token: z.string().max(200) });
export const AppPartyRegistrationSchema = z.object({ open: z.boolean(), role: z.string().max(40).optional() });
/** A collection's value: any JSON, bounded by the service to 64 kB. */
export const AppPartyDataSchema = z.object({ value: z.unknown() });
export const AppPartyDecisionSchema = z.object({ decision: z.string().max(10), reason: z.string().max(500).optional() });
export const EmptyBodySchema = z.object({}).optional();
