/**
 * @file src/services/team/prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The team for an AI that cannot connect (team setup T9): a prompt that carries the team's
 *   context, its latest decisions, what is open and what waits for the person as TEXT, for Copilot, a
 *   Gemini app outside the United States or any chat without MCP. The person pastes it into their AI,
 *   works there, and brings the result back in one paste: the AI ends its answer with lines tagged
 *   DECISION:, OPEN: and WAITING:, which importTeamPaste() reads. The import shows what it would write
 *   first (a dry run) and writes drafts into the team's workspaces through writeWorkspaceDraftsOp, the
 *   one write path every surface takes, so the person's rights, the schemas and the provenance hold.
 *
 *   The prompt's frame is in the person's language; the team's own words stay as they were written.
 * @structure buildTeamPrompt · parsePaste · importTeamPaste
 * @usage
 *   const p = await buildTeamPrompt(deps, caller, orgId);
 *   const out = await importTeamPaste(deps, caller, orgId, text, dryRun);
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n, T9).
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { CallerContext } from '../caller-context.js';
import { readerFor } from '../classification/reader.js';
import { loadWorkspaceContent } from '../workspace/content.js';
import { writeWorkspaceDraftsOp } from '../workspace/tool-ops.js';
import { workspaceCallerOf } from '../workspace/ops-caller.js';
import { teamLang, type TeamLang } from '../../data/team-kit.js';
import { teamStatusFor } from './status.js';
import { teamWaitingFor } from './waiting.js';

type Deps = { storage: Storage; config: AimeatConfig };
export type TeamDoorFailure = { ok: false; status: number; code: string; message: string };

const FRAME: Record<TeamLang, { intro: (team: string) => string; context: string; decisions: string; open: string; waiting: string; none: string; back: string }> = {
    fi: {
        intro: team => `Autat minua tiimissä "${team}". Alla on tiimin tilanne. Käytä sitä, kun vastaat ja kirjoitat. Lähettämistä, maksamista ja poistamista et tee itse: kirjoita luonnos.`,
        context: 'Tiimin konteksti', decisions: 'Viimeisimmät päätökset', open: 'Avoimet asiat', waiting: 'Odottaa minua', none: '(ei mitään)',
        back: 'Kun olemme valmiita, lopeta vastauksesi riveillä, jotka tuon takaisin tiimille. Yksi asia rivillä, ja rivin alkuun aina englanninkielinen merkki:\nDECISION: päätös | perustelu\nOPEN: avoin asia\nWAITING: asia, joka odottaa ihmistä',
    },
    en: {
        intro: team => `You help me in the team "${team}". Below is where the team stands. Use it when you answer and write. Do not send, pay or delete yourself: write a draft.`,
        context: 'Team context', decisions: 'Latest decisions', open: 'Open matters', waiting: 'Waiting for me', none: '(nothing)',
        back: 'When we are done, end your answer with lines I bring back to the team. One matter per line, each starting with its tag:\nDECISION: the decision | why\nOPEN: an open matter\nWAITING: something that waits for a person',
    },
    es: {
        intro: team => `Me ayudas en el equipo "${team}". Abajo está la situación del equipo. Úsala cuando respondas y escribas. No envíes, pagues ni borres por tu cuenta: escribe un borrador.`,
        context: 'Contexto del equipo', decisions: 'Últimas decisiones', open: 'Asuntos abiertos', waiting: 'Pendiente de mí', none: '(nada)',
        back: 'Cuando terminemos, acaba tu respuesta con líneas que llevo de vuelta al equipo. Un asunto por línea, cada una con su etiqueta en inglés:\nDECISION: la decisión | por qué\nOPEN: un asunto abierto\nWAITING: algo que espera a una persona',
    },
};

/** The newest value of each record under `prefix` (`.latest` over `.draft` over the bare key), newest first. */
function latestRecords(rows: MemoryRecord[], prefix: string): Record<string, unknown>[] {
    const rank = (key: string) => key.endsWith('.latest') ? 3 : key.endsWith('.draft') ? 2 : 1;
    const best = new Map<string, { rank: number; at: string; value: Record<string, unknown> }>();
    for (const r of rows) {
        if (!r.key.startsWith(prefix) || !r.value || typeof r.value !== 'object') continue;
        const id = r.key.slice(prefix.length).replace(/\.(latest|draft)$/, '');
        if (!id || id.includes('.')) continue;
        const k = rank(r.key);
        if ((best.get(id)?.rank ?? 0) < k) best.set(id, { rank: k, at: r.updatedAt ?? '', value: r.value as Record<string, unknown> });
    }
    return [...best.values()].sort((a, b) => b.at.localeCompare(a.at)).map(v => v.value);
}

const line = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** The prompt for one team the caller is in, in the caller's language. */
export async function buildTeamPrompt(deps: Deps, caller: CallerContext, orgId: string): Promise<TeamDoorFailure | { ok: true; prompt: string; language: TeamLang }> {
    if (!caller.owner || caller.visitor) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Teams belong to an account of this node' };
    const { storage } = deps;
    const reader = readerFor(deps, caller.auth);
    const locale = (await storage.getGHIIByOwner(caller.owner))?.locale ?? null;
    const lang = teamLang(locale) ?? 'en';
    const [team] = (await teamStatusFor(storage, deps.config, reader, caller.owner, locale, orgId)) ?? [];
    if (!team) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No team with that organism_id that you are in' };
    const who = { sub: caller.principal, ownerName: caller.owner, accessorGaii: caller.ownerGhii };
    const decisionsWs = await loadWorkspaceContent(deps, reader, who, { organismId: orgId, ws: team.workspaces.decisions });
    const sharedWs = await loadWorkspaceContent(deps, reader, who, { organismId: orgId, ws: team.workspaces.shared });
    const decisions = decisionsWs.ok ? latestRecords(decisionsWs.items, `organism.${orgId}.w.${team.workspaces.decisions}.shared.decisions.`).slice(0, 10) : [];
    const open = sharedWs.ok ? latestRecords(sharedWs.items, `organism.${orgId}.w.${team.workspaces.shared}.shared.items.`).filter(v => (v.status ?? 'open') === 'open').slice(0, 15) : [];
    const waiting = (await teamWaitingFor(deps, caller)).items.filter(i => i.organism_id === orgId);
    const f = FRAME[lang];
    const list = (rows: string[]) => (rows.length ? rows.map(r => `- ${r}`).join('\n') : f.none);
    const prompt = [
        f.intro(team.name),
        `## ${f.context}\n${team.context?.core?.trim() || f.none}`,
        `## ${f.decisions}\n${list(decisions.map(d => [line(d.title), line(d.decision), line(d.why)].filter(Boolean).join(': ')))}`,
        `## ${f.open}\n${list(open.map(o => line(o.title)))}`,
        `## ${f.waiting}\n${list(waiting.map(w => `${w.title}${w.detail ? `: ${line(w.detail)}` : ''}`))}`,
        f.back,
    ].join('\n\n');
    return { ok: true, prompt, language: lang };
}

export interface PastedEntry { tag: 'DECISION' | 'OPEN' | 'WAITING'; title: string; why?: string }

/** The tagged lines of a pasted answer. Anything else in the text is left out. */
export function parsePaste(text: string): PastedEntry[] {
    const out: PastedEntry[] = [];
    for (const raw of String(text ?? '').split(/\r?\n/)) {
        const m = /^\s*[-*]?\s*(DECISION|OPEN|WAITING)\s*:\s*(.+)$/i.exec(raw);
        if (!m) continue;
        const tag = m[1].toUpperCase() as PastedEntry['tag'];
        const [title, why] = m[2].split('|').map(s => s.trim());
        if (!title) continue;
        out.push({ tag, title: title.slice(0, 500), ...(tag === 'DECISION' && why ? { why: why.slice(0, 2000) } : {}) });
        if (out.length >= 50) break;
    }
    return out;
}

/** Bring a pasted answer back into the team: a dry run unless `dryRun` is false. */
export async function importTeamPaste(deps: Deps, caller: CallerContext, orgId: string, text: unknown, dryRun: boolean): Promise<TeamDoorFailure | { ok: true; dry_run: boolean; entries: PastedEntry[]; written: number }> {
    if (!caller.owner || caller.visitor) return { ok: false, status: 403, code: 'FORBIDDEN', message: 'Teams belong to an account of this node' };
    if (typeof text !== 'string' || !text.trim()) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'text is the pasted answer' };
    if (text.length > 100_000) return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'the pasted answer is longer than 100 000 characters' };
    const reader = readerFor(deps, caller.auth);
    const [team] = (await teamStatusFor(deps.storage, deps.config, reader, caller.owner, null, orgId)) ?? [];
    if (!team) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'No team with that organism_id that you are in' };
    const entries = parsePaste(text);
    if (dryRun || !entries.length) return { ok: true, dry_run: dryRun, entries, written: 0 };
    const opsCaller = workspaceCallerOf({ principal: caller.principal, ownerName: caller.owner, roles: [...caller.roles], scopes: caller.scopes }, deps.config);
    const stamp = Date.now().toString(36);
    const today = new Date().toISOString().slice(0, 10);
    const byWs = new Map<string, { space: string; id: string; value: Record<string, unknown> }[]>();
    entries.forEach((e, i) => {
        const id = `pasted-${stamp}-${i + 1}`;
        if (e.tag === 'DECISION') {
            (byWs.get(team.workspaces.decisions) ?? byWs.set(team.workspaces.decisions, []).get(team.workspaces.decisions)!)
                .push({ space: 'decision', id, value: { id, title: e.title, decision: e.title, ...(e.why ? { why: e.why } : {}), date: today, by: caller.owner } });
        } else if (e.tag === 'OPEN') {
            (byWs.get(team.workspaces.shared) ?? byWs.set(team.workspaces.shared, []).get(team.workspaces.shared)!)
                .push({ space: 'item', id, value: { id, title: e.title, status: 'open', owner: caller.owner } });
        } else {
            (byWs.get(team.workspaces.waiting) ?? byWs.set(team.workspaces.waiting, []).get(team.workspaces.waiting)!)
                .push({ space: 'waiting', id, value: { id, title: e.title, kind: 'other', status: 'open', by: caller.owner } });
        }
    });
    let written = 0;
    for (const [ws, items] of byWs) {
        const r = await writeWorkspaceDraftsOp(deps, opsCaller, { organismId: orgId, ws, items, pipeline: 'team.paste' });
        if (!r.ok) return { ok: false, status: r.status ?? 400, code: r.code ?? 'REFUSED', message: r.message ?? 'The team refused the write' };
        written += items.length;
    }
    return { ok: true, dry_run: false, entries, written };
}
