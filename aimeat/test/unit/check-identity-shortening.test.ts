/**
 * @file test/unit/check-identity-shortening.test.ts
 * @description Proof that `pnpm check:identity-shortening` finds every shape a cut of an identity to an
 *   account name takes, and stays quiet for the helper's use, for comments and strings that talk about
 *   a cut, and for code that keeps the node beside the name. The findings function is pure, so every
 *   case is a source string in and a list out; the comparison with ALLOWED is pure too.
 * @usage cd aimeat && pnpm exec vitest run test/unit/check-identity-shortening.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial, with the gate (secaudit 2026-09, F-1 as a class).
 */
import { describe, it, expect } from 'vitest';
import { shorteningFindings, compareWithAllowed, type Finding } from '../../scripts/check-identity-shortening.js';

const shapes = (source: string): string[] => shorteningFindings('src/x.ts', source).map((f) => f.shape);

describe('check:identity-shortening findings', () => {
  it('finds every cut in the bad fixture, one finding per cut', () => {
    const bad = [
      "const a = caller.split('@')[0];",
      'const b = owner.includes("@") ? owner.split("@")[0] : owner;',
      "const c = email?.split('@', 1)[0];",
      "const [name, node] = id.split('@');",
      "const d = gaii.slice(0, gaii.indexOf('@'));",
      "const e = gaii.substring(0, gaii.lastIndexOf('@'));",
      "const f = ghii.replace(/@.*$/, '');",
      'const g = /#([^@]+)@/.exec(gaii);',
      'const h = parseGaiiLoose(gaii).owner;',
      'const i = parseGAII(principal)?.owner ?? principal;',
      'const { owner } = parseGaiiLoose(writer);',
      'const { agent: n, owner: o } = parseGAII(x);',
      'const parsed = parseGaiiLoose(recipient);',
      'if (parsed.owner !== me) deny();',
      'const p = parseGAII(sub);',
      'lookup(p?.owner);',
      "const at = ghii.indexOf('@');",
      'const name = ghii.slice(0, at);',
    ].join('\n');
    const found = shorteningFindings('src/services/bad.ts', bad);
    expect(found.map((f) => f.shape)).toEqual([
      'split-at', 'split-at', 'split-at', 'split-at-destructure', 'slice-to-at', 'slice-to-at',
      'replace-from-at', 'regex-before-at', 'parsed-owner', 'parsed-owner', 'parsed-owner',
      'parsed-owner', 'parsed-owner', 'parsed-owner', 'slice-to-at',
    ]);
    expect(found.find((f) => f.line === 18)?.text).toBe("ghii.slice(0, at) ← ghii.indexOf('@')");
    // A held parse names what it parsed, so ALLOWED can tell one `parsed.owner` from another.
    expect(found.find((f) => f.line === 14)?.text).toBe('parsed.owner ← parseGaiiLoose(recipient)');
    expect(found.find((f) => f.line === 16)?.text).toBe('p?.owner ← parseGAII(sub)');
  });

  it('stays quiet for the good fixture', () => {
    const good = [
      "import { localAccountName, localAccountOf } from '../utils/gaii.js';",
      '// the old code did owner.split(\'@\')[0] here, and parseGaiiLoose(x).owner there',
      '/* a block comment: caller.split(\'@\')[0] */',
      "const label = 'split the name with x.split(\"@\")[0]';",
      'const a = localAccountName(caller);',
      'const b = localAccountOf(writer);',
      "const agentName = gaii.split('#')[0];",
      "const host = url.split('@')[1];",
      "const ref = link.ref.replace(/@\\d+\\.\\d+\\.\\d+$/, '');",
      'const p = parseGaiiLoose(peer);',
      'if (p.node !== nodeId) return;',
      'const whole = `${p.owner}@${p.node}`;',
      'const same = a.owner === b.owner && a.node === b.node;',
      'const node = parseGaiiLoose(id).node;',
      'const agent = parseGAII(id)?.agent;',
      "const at = ghii.lastIndexOf('@');",
      'const nodePart = ghii.slice(at + 1);',
    ].join('\n');
    expect(shorteningFindings('src/services/good.ts', good)).toEqual([]);
  });

  it('reads only code: a cut inside a template literal\'s text is not a call', () => {
    expect(shapes("const help = `use localAccountName, not x.split('@')[0]`;")).toEqual([]);
    expect(shapes("const s = `${owner.split('@')[0]}/${file}`;")).toEqual(['split-at']);
  });
});

describe('the comparison with ALLOWED', () => {
  const at = (line: number, text: string): Finding => ({ line, shape: 'split-at', text });

  it('lets an allowed expression through, and fails a new one beside it', () => {
    const found = new Map([['src/a.ts', [at(3, "email?.split('@')[0]"), at(9, "owner.split('@')[0]")]]]);
    const v = compareWithAllowed(found, { 'src/a.ts': { "email?.split('@')[0]": 'An email, not an identity.' } });
    expect(v.allowedHits).toBe(1);
    expect(v.fresh.map((f) => f.finding.text)).toEqual(["owner.split('@')[0]"]);
    expect(v.stale).toEqual([]);
  });

  it('names an entry whose expression is gone, and one without a reason', () => {
    const v = compareWithAllowed(new Map(), { 'src/a.ts': { "gone.split('@')[0]": 'Why.', 'x.owner ← parseGAII(x)': ' ' } });
    expect(v.stale.map((s) => s.text)).toEqual(["gone.split('@')[0]", 'x.owner ← parseGAII(x)']);
    expect(v.empty.map((s) => s.text)).toEqual(['x.owner ← parseGAII(x)']);
  });

  it('applies a directory entry to every file under it', () => {
    const found = new Map([['src/cli/one.ts', [at(1, "o.split('@')[0]")]], ['src/cli/sub/two.ts', [at(2, "o.split('@')[0]")]]]);
    const v = compareWithAllowed(found, { 'src/cli/': { "o.split('@')[0]": 'Runs on the person\'s machine.' } });
    expect(v.allowedHits).toBe(2);
    expect(v.fresh).toEqual([]);
    expect(v.stale).toEqual([]);
  });
});
