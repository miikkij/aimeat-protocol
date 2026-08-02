/**
 * @file fs-merge.ts
 * @description Read-modify-write helpers shared by the client adapters. Every adapter edits a file
 *   the user already owns and that usually holds OTHER servers, so the rules here are the same for
 *   all of them: parse what is there, replace only our own key, back the file up first, and never
 *   drop a key we did not put there.
 * @structure
 *   - readJsonFile / writeJsonFile — tolerant JSON round-trip (missing file = {}).
 *   - readYamlFile / writeYamlFile — same for YAML (Goose).
 *   - backup — timestamp-free `.aimeat-bak` copy, taken once per run before the first write.
 *   - ensureDirFor — mkdir -p for a file path.
 * @usage Imported by clients/goose.ts, cursor.ts, vscode.ts, claude-desktop.ts.
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial creation: one-command client connect.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/** mkdir -p for the directory holding `file`. */
export function ensureDirFor(file: string): void {
    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Copy `file` to `<file>.aimeat-bak` before we touch it. Returns the backup path, or null when
 * there was nothing to back up (first-time config). A single fixed suffix keeps the user's config
 * directory from filling with copies on every re-run.
 */
export function backup(file: string): string | null {
    if (!existsSync(file)) return null;
    const bak = `${file}.aimeat-bak`;
    copyFileSync(file, bak);
    return bak;
}

/**
 * Parse a JSON config. A missing file yields `{}`. A file that exists but does not parse THROWS —
 * silently starting from `{}` there would delete every server the user had configured.
 */
export function readJsonFile(file: string): Record<string, unknown> {
    if (!existsSync(file)) return {};
    const raw = readFileSync(file, 'utf8').trim();
    if (!raw) return {};
    try {
        const parsed: unknown = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch (e) {
        throw new Error(`${file} is not valid JSON. Fix or move it, then re-run — refusing to overwrite it.`, { cause: e });
    }
}

export function writeJsonFile(file: string, data: Record<string, unknown>): void {
    ensureDirFor(file);
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** Same contract as readJsonFile, for YAML. */
export function readYamlFile(file: string): Record<string, unknown> {
    if (!existsSync(file)) return {};
    const raw = readFileSync(file, 'utf8').trim();
    if (!raw) return {};
    try {
        const parsed: unknown = parseYaml(raw);
        return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    } catch (e) {
        throw new Error(`${file} is not valid YAML. Fix or move it, then re-run — refusing to overwrite it.`, { cause: e });
    }
}

export function writeYamlFile(file: string, data: Record<string, unknown>): void {
    ensureDirFor(file);
    writeFileSync(file, stringifyYaml(data), 'utf8');
}

/** Fetch (or create) a nested object property without discarding what is already inside it. */
export function objectAt(root: Record<string, unknown>, key: string): Record<string, unknown> {
    const cur = root[key];
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) return cur as Record<string, unknown>;
    const fresh: Record<string, unknown> = {};
    root[key] = fresh;
    return fresh;
}
