/**
 * @file src/services/ai-client-families.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app names that cover TWO apps, one that connects over MCP and one that cannot
 *   (Gemini, Microsoft Copilot), the spellings people write them in, and the normalizer every
 *   claim about an app goes through. Data and one pure function; the decision that reads them is
 *   decideBranch in services/ai-tool-setup.ts, which is also where the rule they must keep is
 *   written: an app NAME never sends anyone to branch B.
 *
 *   Its own module because ai-tool-setup.ts reached the 800-line limit the day this was added.
 * @structure AiClientVariant · AiClientFamily · AI_CLIENT_FAMILIES · AI_FAMILY_ALIASES ·
 *   VARIANT_BY_ID · normalizeAiClientClaim()
 * @usage
 *   import { AI_CLIENT_FAMILIES, VARIANT_BY_ID, normalizeAiClientClaim } from './ai-client-families.js';
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial, extracted the day it was written.
 */

/**
 * A NAME THAT COVERS TWO DIFFERENT APPS, one that connects over MCP and one that cannot.
 *
 * "Gemini" is the consumer app (no connectors) and also Gemini CLI (MCP). "Microsoft Copilot" is
 * the consumer assistant (none) and also Copilot Studio (MCP). Until 2026-09-18 neither name was
 * known here at all, so such a person was asked "which app", picked "something else", was sent
 * down the MCP road, failed, and only then reached the prompt-driven road: one lost attempt, for
 * the two largest groups of people MCP cannot reach.
 *
 * The rule above still holds, and this is built to keep it: **the name sends nobody to branch B.**
 * It raises ONE question, the way a plan-dependent tool raises the tier question, and only the
 * person's own answer settles it. The answer travels in the same `client` field the "which app"
 * question uses, as one of the variant ids below, so nothing new is stored.
 */
export interface AiClientVariant { id: string; label: { en: string; fi: string }; mcp: boolean }
export interface AiClientFamily { id: string; label: string; variants: readonly AiClientVariant[] }

export const AI_CLIENT_FAMILIES: readonly AiClientFamily[] = [
    {
        id: 'gemini',
        label: 'Gemini',
        variants: [
            { id: 'gemini-app', mcp: false, label: { en: 'The Gemini app or gemini.google.com', fi: 'Gemini-sovellus tai gemini.google.com' } },
            { id: 'gemini-cli', mcp: true, label: { en: 'Gemini CLI, in a terminal', fi: 'Gemini CLI, päätteessä' } },
        ],
    },
    {
        id: 'microsoft-copilot',
        label: 'Microsoft Copilot',
        variants: [
            { id: 'microsoft-copilot-app', mcp: false, label: { en: 'The Copilot app, copilot.microsoft.com, or Copilot in Windows or Office', fi: 'Copilot-sovellus, copilot.microsoft.com tai Copilot Windowsissa tai Officessa' } },
            { id: 'copilot-studio', mcp: true, label: { en: 'Copilot Studio, where an agent is built', fi: 'Copilot Studio, jossa agentti rakennetaan' } },
        ],
    },
];

/** Normalized names for a family. `copilot` alone stays GitHub Copilot in VS Code, as above. */
export const AI_FAMILY_ALIASES: Readonly<Record<string, string>> = {
    gemini: 'gemini',
    googlegemini: 'gemini',
    geminigoogle: 'gemini',
    geminiadvanced: 'gemini',
    geminipro: 'gemini',
    bard: 'gemini',
    microsoftcopilot: 'microsoft-copilot',
    mscopilot: 'microsoft-copilot',
    copilotmicrosoft: 'microsoft-copilot',
    m365copilot: 'microsoft-copilot',
    microsoft365copilot: 'microsoft-copilot',
    bingcopilot: 'microsoft-copilot',
    bingchat: 'microsoft-copilot',
    windowscopilot: 'microsoft-copilot',
};

export const VARIANT_BY_ID = new Map(AI_CLIENT_FAMILIES.flatMap(f => f.variants.map(v => [normalizeAiClientClaim(v.id), { family: f, variant: v }] as const)));

/** Lowercase, drop everything that is not a letter or digit. "Claude Web" and "claude.ai" collapse. */
export function normalizeAiClientClaim(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}
