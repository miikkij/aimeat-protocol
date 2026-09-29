/**
 * @file services/package-skill-component.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A package's `skill` component: the operating guide of one app in the package, carried
 *   as its SKILL.md pack and published in the installer's own skill registry, bound to the installer's
 *   copy of that app.
 *
 *   WHY IT TRAVELS. An app's skill is how anyone's AI learns to operate the app rather than guess at
 *   it (docs/skills-registry.md, app-bound skills). A package carried the apps and left the skills
 *   behind, because a binding names `app:{owner}/{filename}` and the installed copy has another owner
 *   and another filename. So a customer node got the apps it was sold with and an AI that had no
 *   guide for any of them. The binding is rewritten at install time instead, to the name this install
 *   gave the app, which is known before anything registers.
 *
 *   ONLY THE COMPOSER'S OWN SKILLS. Compose copies the caller's user-scope skills bound to the app,
 *   and nothing the caller merely can read: packaging somebody else's guide is a copy of their work
 *   under the composer's name. Node skills are the node's own library and are not copied either.
 *
 *   THE INSTALLER'S OWN SKILL WINS. A skill name is unique in one registry. When the installer already
 *   has a skill of that name that this package did not publish, the component is skipped and named in
 *   the install's warnings, and the install succeeds: overwriting it would destroy the owner's work.
 *   The skill a package publishes carries `fromPackage` (the package group and the installed copy), and
 *   an update replaces, and an uninstall removes, only a skill carrying that copy's tag.
 *
 *   Content: JSON `{ files: { "SKILL.md": "...", "references/x.md": "..." } }` with the paths in a
 *   stable order, so the package's content hash does not change between two composes of one skill.
 *   The component depends on its app and says which one in `meta.skill.bindsTo`.
 * @structure skillComponentId · skillComponentContent · skillFilesOf · skillComponentName ·
 *   rebindSkillMd · boundSkillComponents · registerSkillComponent · deleteSkillComponent ·
 *   fetchSkillComponentContent · skillFileTargets
 * @usage
 *   const comps = await boundSkillComponents(storage, ownerGhii, `app:${owner}/${filename}`, filename);
 *   const out = await registerSkillComponent(storage, { config, owner, ownerGaii, ... });
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial (wish-a-package-carries-the-skills-bound-to-its-apps).
 */
import YAML from 'yaml';
import type { AimeatConfig } from '../config.js';
import type { Storage, ContentLabelTarget } from '../storage/interface.js';
import { validateSkillFiles, SkillValidationError, parseSkillMd } from './skill-md.js';
import { manifestKey, fileKey, MANIFEST_KEY_RE } from './skill-refs.js';
import { publishSkill, deleteSkill, SkillAccessError, type SkillManifestValue, type SkillPackageTag } from './skills.js';
import { localAccountName } from '../utils/gaii.js';
import { memoryTarget } from './classification/labels.js';

/** A skill component's id in its package. The name is unique in the composer's registry. */
export const skillComponentId = (name: string): string => `skill-${name}`;

/** The component content, paths in code-point order so the same files always hash the same. */
export function skillComponentContent(files: Record<string, string>): string {
    const sorted: Record<string, string> = {};
    for (const path of Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) sorted[path] = files[path];
    return JSON.stringify({ files: sorted });
}

/** The files a skill component carries, or null when the content is not that shape. */
export function skillFilesOf(content: string): Record<string, string> | null {
    let parsed: unknown;
    try { parsed = JSON.parse(content); }
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
    catch { return null; }
    const files = (parsed as { files?: unknown } | null)?.files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
    const out: Record<string, string> = {};
    for (const [path, text] of Object.entries(files as Record<string, unknown>)) {
        if (typeof text !== 'string') return null;
        out[path] = text;
    }
    return typeof out['SKILL.md'] === 'string' ? out : null;
}

/** The skill's own name from its SKILL.md frontmatter, which is also its registered name. */
export function skillComponentName(content: string): string | null {
    const files = skillFilesOf(content);
    if (!files) return null;
    try { return parseSkillMd(files['SKILL.md']).frontmatter.name; }
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: not a valid SKILL.md, and registration says why
    catch { return null; }
}

/**
 * SKILL.md with `metadata.binding` set to `binding`, everything else in the frontmatter as written.
 * The binding travels in the file (skills.ts copies it to the manifest), so the file is what changes.
 */
export function rebindSkillMd(skillMd: string, binding: string): string {
    const text = skillMd.charCodeAt(0) === 0xfeff ? skillMd.slice(1) : skillMd;
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return skillMd;
    const doc = YAML.parseDocument(m[1]);
    if (YAML.isMap(doc.get('metadata'))) doc.setIn(['metadata', 'binding'], binding);
    else doc.set('metadata', { binding });
    // lineWidth 0: a long description stays on the line its author wrote it on.
    return `---\n${doc.toString({ lineWidth: 0 }).replace(/\n+$/, '')}\n---\n${m[2]}`;
}

/** One skill as it goes into a package, before createPackageGroup computes its hash. */
export interface SkillComponentDraft {
    id: string; type: 'skill'; label: string; content: string; dependencies: string[];
    meta: { skill: { bindsTo: string } };
}

/**
 * The caller's OWN user-scope skills bound exactly to `binding`, as components that depend on the
 * app component `appComponentId`. Read from the caller's own records by key, so a skill somebody
 * else published, or the node's library, is never among them. A skill whose SKILL.md record is
 * missing is left out and named in `unreadable`.
 */
export async function boundSkillComponents(
    storage: Storage, ownerGhii: string, binding: string, appComponentId: string,
): Promise<{ components: SkillComponentDraft[]; unreadable: string[] }> {
    const records = await storage.listMemory(ownerGhii, { prefix: 'skills.', tags: ['skill'] });
    const manifests = records
        .filter(r => MANIFEST_KEY_RE.test(r.key))
        .map(r => r.value as SkillManifestValue)
        .filter(v => v?.binding === binding)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const components: SkillComponentDraft[] = [];
    const unreadable: string[] = [];
    for (const manifest of manifests) {
        const files: Record<string, string> = {};
        for (const f of manifest.files ?? []) {
            const rec = await storage.getMemory(ownerGhii, fileKey(manifest.name, f.path));
            if (rec) files[f.path] = String(rec.value);
        }
        if (typeof files['SKILL.md'] !== 'string') { unreadable.push(manifest.name); continue; }
        components.push({
            id: skillComponentId(manifest.name),
            type: 'skill',
            label: manifest.name,
            content: skillComponentContent(files),
            dependencies: [appComponentId],
            meta: { skill: { bindsTo: appComponentId } },
        });
    }
    return { components, unreadable };
}

export interface SkillComponentInput {
    config: AimeatConfig;
    owner: string;
    ownerGaii: string;
    publisher: string;
    content: string;
    meta?: Record<string, unknown>;
    /** The install this skill belongs to, and app component id -> the filename this install gave it. */
    packageContext?: { groupId: string; instanceId: string; appNames: Map<string, string> };
    dryRun?: boolean;
}

/**
 * Publish one skill component in the installer's registry, bound to their copy of its app.
 *
 * `skipped` is the sentence for the install's warnings when the installer already has a skill of
 * that name this package did not publish: that skill is left exactly as it is.
 */
export async function registerSkillComponent(
    storage: Storage, input: SkillComponentInput,
): Promise<{ ok: true; skipped?: string } | { ok: false; error: string }> {
    const ctx = input.packageContext;
    if (!ctx) return { ok: false, error: 'SKILL_NEEDS_PACKAGE: a skill component installs only as part of a package install' };
    const files = skillFilesOf(input.content);
    if (!files) return { ok: false, error: 'INVALID_SKILL: the content must be { "files": { "SKILL.md": "...", ... } }' };
    const bindsTo = (input.meta?.skill as { bindsTo?: unknown } | undefined)?.bindsTo;
    const appFilename = typeof bindsTo === 'string' ? ctx.appNames.get(bindsTo) : undefined;
    if (!appFilename) {
        return { ok: false, error: `SKILL_UNBOUND: the skill binds to "${String(bindsTo)}", which is not an app this package installs` };
    }

    const binding = `app:${input.owner}/${appFilename}`;
    const fileMap = new Map(Object.entries({ ...files, 'SKILL.md': rebindSkillMd(files['SKILL.md'], binding) }));
    let name: string;
    try { name = validateSkillFiles(fileMap).parsed.frontmatter.name; }
    catch (err) { return { ok: false, error: `${(err as SkillValidationError).code ?? 'INVALID_SKILL'}: ${(err as Error).message}` }; }

    const existing = await storage.getMemory(input.ownerGaii, manifestKey(name));
    const tag = (existing?.value as SkillManifestValue | undefined)?.fromPackage;
    if (existing && tag?.groupId !== ctx.groupId) {
        return {
            ok: true,
            skipped: `You already have a skill named "${name}" of your own, so the package's skill of that name was not installed and yours is unchanged.`,
        };
    }
    if (input.dryRun) return { ok: true };

    try {
        await publishSkill(storage, input.config, {
            scope: 'user', owner: input.owner, publisher: input.publisher, files: fileMap,
            // A new skill is the owner's alone; an update keeps whatever visibility the owner gave it.
            ...(existing ? {} : { visibility: 'owner' as const }),
            fromPackage: { groupId: ctx.groupId, instanceId: ctx.instanceId },
        });
    } catch (err) {
        if (err instanceof SkillValidationError || err instanceof SkillAccessError) return { ok: false, error: `${err.code}: ${err.message}` };
        throw err;
    }
    return { ok: true };
}

/** Remove the skill `name` only when this package install published it. False otherwise. */
export async function deleteSkillComponent(
    storage: Storage, config: AimeatConfig, name: string, ownerGaii: string, tag: SkillPackageTag,
): Promise<boolean> {
    const existing = await storage.getMemory(ownerGaii, manifestKey(name));
    const own = (existing?.value as SkillManifestValue | undefined)?.fromPackage;
    if (!own || own.groupId !== tag.groupId || own.instanceId !== tag.instanceId) return false;
    return deleteSkill(storage, config, 'user', name, { owner: localAccountName(ownerGaii) });
}

/** The installed skill as a component's content, for the hash that tells an owner's edit apart. */
export async function fetchSkillComponentContent(storage: Storage, name: string, ownerGaii: string): Promise<string | null> {
    const manifest = await storage.getMemory(ownerGaii, manifestKey(name));
    if (!manifest) return null;
    const files: Record<string, string> = {};
    for (const f of (manifest.value as SkillManifestValue).files ?? []) {
        const rec = await storage.getMemory(ownerGaii, fileKey(name, f.path));
        if (rec) files[f.path] = String(rec.value);
    }
    return skillComponentContent(files);
}

/** The label addresses of the records an installed skill is made of: its manifest and its files. */
export async function skillFileTargets(storage: Storage, name: string, ownerGaii: string): Promise<ContentLabelTarget[]> {
    const manifest = await storage.getMemory(ownerGaii, manifestKey(name));
    if (!manifest) return [];
    return [manifestKey(name), ...((manifest.value as SkillManifestValue).files ?? []).map(f => fileKey(name, f.path))]
        .map(k => memoryTarget(ownerGaii, k));
}
