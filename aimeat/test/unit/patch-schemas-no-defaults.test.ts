/**
 * @file test/unit/patch-schemas-no-defaults.test.ts
 * @description A partial update schema parses `{}` to `{}`: it fills in no default, so a PATCH that
 *   leaves a field out leaves the stored field as it is.
 *
 *   Under zod 4 a `.default()` inside an update schema runs during the parse, and the merge onto the
 *   stored record then resets the field the caller did not send. The answer is 200 and a test that
 *   reads back only the field it sent stays green. check:partial-defaults refuses `.partial()`; this
 *   test covers the schemas written by hand, which that check cannot see.
 *
 *   WHICH SCHEMAS. Every exported zod schema whose name says Patch or Update, and every schema a
 *   PATCH route handler parses (`validateBody(X)`, `X.safeParse(...)`, `X.parse(...)` in the handler's
 *   text). An exported one is parsed with `{}`; a refusal is fine (it fills nothing in), a success must
 *   hold no key. A schema the handler defines in its own file and does not export is read as source:
 *   its definition holds no `.default(`.
 *
 *   Seen red first: with a `.default('x')` added to one field of PartyUpdateSchema the first case
 *   names it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/patch-schemas-no-defaults.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall analysis 2026-11-21, §127).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Update schemas that are not partial by design, each with the reason. A PUT replaces the record.
 */
const FULL_REPLACE: Record<string, string> = {
  AgentCapabilitiesUpdateSchema: 'PUT /v1/agents/:name/capabilities: a capability report replaces the two lists it names, so an absent list is an empty one',
};

const files = globSync('src/**/*.ts', { cwd: AIMEAT })
  .map((f) => f.split('\\').join('/'))
  .filter((f) => !/^src\/(static|generated|data)\//.test(f));
const sources = new Map(files.map((f) => [f, readFileSync(join(AIMEAT, f), 'utf8')]));

/** Names a PATCH handler parses, read from the text between `.patch(` and the next registration. */
function patchHandlerSchemas(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [file, src] of sources) {
    if (!src.includes('.patch(')) continue;
    for (const part of src.split(/\.patch\(/).slice(1)) {
      const block = part.split(/\n\s*(?:router|app)\.(?:get|post|put|delete|patch|use)\(/)[0];
      for (const m of block.matchAll(/validateBody\(\s*([A-Z]\w+)|\b([A-Z]\w+)\.(?:safeParse|parse)\(/g)) {
        const name = m[1] ?? m[2];
        if (name !== 'JSON') out.set(name, file);
      }
    }
  }
  return out;
}

const usedByPatch = patchHandlerSchemas();
const exported = new Map<string, string>();
for (const [file, src] of sources) {
  for (const m of src.matchAll(/export const (\w+)\s*=/g)) {
    if (/Patch|Update/.test(m[1]) || usedByPatch.has(m[1])) exported.set(m[1], file);
  }
}

describe('a partial update fills in no default', () => {
  it('every exported update schema parses {} to {} or refuses it', async () => {
    const filled: string[] = [];
    let checked = 0;
    for (const [name, file] of exported) {
      const mod = await import(pathToFileURL(join(AIMEAT, file)).href) as Record<string, { safeParse?: (v: unknown) => { success: boolean; data?: unknown } }>;
      const schema = mod[name];
      if (!schema || typeof schema.safeParse !== 'function') continue;
      checked++;
      if (FULL_REPLACE[name]) continue;
      const r = schema.safeParse({});
      if (r.success && r.data && typeof r.data === 'object' && Object.keys(r.data).length > 0) {
        filled.push(`${name} (${file}) filled in ${JSON.stringify(r.data)}`);
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(filled, 'a field left out of a PATCH is reset to this default; drop the .default() or build the schema with patchOf()').toEqual([]);
  });

  it('a schema a PATCH handler defines in its own file holds no .default(', () => {
    const local = [...usedByPatch].filter(([name]) => !exported.has(name));
    const offenders: string[] = [];
    for (const [name, file] of local) {
      const src = sources.get(file)!;
      const at = src.search(new RegExp(`\\bconst ${name}\\s*=`));
      if (at < 0) continue;
      const rest = src.slice(at);
      const end = rest.slice(1).search(/\n(?:const|function|export|async function|router\.)/);
      const def = end < 0 ? rest : rest.slice(0, end + 1);
      if (/\.default\(/.test(def)) offenders.push(`${name} (${file})`);
    }
    expect(offenders).toEqual([]);
  });

  it('a full-replace exception names a schema that exists and fills in defaults', async () => {
    for (const [name, why] of Object.entries(FULL_REPLACE)) {
      const file = exported.get(name);
      expect(file, `${name}: ${why}`).toBeDefined();
      const mod = await import(pathToFileURL(join(AIMEAT, file!)).href) as Record<string, { safeParse: (v: unknown) => { success: boolean; data?: object } }>;
      const r = mod[name].safeParse({});
      expect(r.success && Object.keys(r.data ?? {}).length > 0, `${name} no longer fills defaults: remove its exception`).toBe(true);
    }
  });
});
