/**
 * @file test/unit/living-curl-windows-shells.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The living document's inward dialog offers a line for a Windows shell too, and a live
 *   value cannot break out of it in Command Prompt (cmd.exe) or in PowerShell.
 *
 *   THE CASE. Round 14 quoted the curl lines' JSON body for POSIX shells: single quotes, each single
 *   quote in the value written as '\''. The dialog named no shell, so a Windows owner could paste the
 *   line into cmd.exe, where single quotes mean nothing and a double quote in the value toggles the
 *   quoting, or into PowerShell, where '\'' closes the string. The value is the node's live reading,
 *   which another account's public key or a third-party address can set.
 *
 *   THE FIX KEEPS THE POSIX LINE BYTE FOR BYTE (living-curl-quoting.test.ts holds that) and adds, for
 *   each road, a Windows line that carries no live data at all: the JSON body is its own block, saved
 *   as value.json, and `curl.exe ... --data-binary "@value.json"` reads it. Each Windows line is split
 *   here with a small model of cmd.exe and of PowerShell written in this file; no shell runs.
 *
 *   FIRST FAIL: against hooks-shapes.js v0.7.1 the only line offered is the POSIX one, and both models
 *   find a command separator of the value outside any quote.
 * @usage cd aimeat && pnpm exec vitest run test/unit/living-curl-windows-shells.test.ts
 * @version-history
 *   2026-11-08 -- Initial (secaudit2026nov08b round 15, living-inward-curl-posix-only-quoting-windows-shells).
 */
import { describe, it, expect } from 'vitest';

(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { getAttribute: () => null },
  querySelector: () => null,
};
(globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };

const { inwardShape } = await import('../../src/static/sdk-libs/living/hooks-shapes.js');
const { WORDS } = await import('../../src/static/sdk-libs/living/hooks-words.js');

/**
 * The characters cmd.exe acts on outside double quotes: `&`, `|`, `<`, `>` (a caret escapes the next
 * character there). A double quote toggles the quoting, whatever precedes it. `%` expands inside
 * quotes as well, so it is reported wherever it stands.
 */
function cmdOperators(line: string): string[] {
  const found: string[] = [];
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '%') { found.push('%'); continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    if (c === '^') { i += 1; continue; }
    if ('&|<>'.includes(c)) found.push(c);
  }
  return found;
}

/**
 * What PowerShell acts on outside quotes (`;`, `|`, `&`) and what it expands (`$`, and a backtick
 * escape) outside single quotes. A single-quoted string ends at a lone quote; '' inside it is one
 * quote. A double-quoted string ends at a quote that is not doubled or escaped with a backtick.
 */
function powershellOperators(line: string): string[] {
  const found: string[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === "'") {
      i += 1;
      while (i < line.length) {
        if (line[i] === "'" && line[i + 1] === "'") { i += 2; continue; }
        if (line[i] === "'") break;
        i += 1;
      }
      i += 1;
    } else if (c === '"') {
      i += 1;
      while (i < line.length) {
        if (line[i] === '`') { found.push('`'); i += 2; continue; }
        if (line[i] === '"' && line[i + 1] === '"') { i += 2; continue; }
        if (line[i] === '"') break;
        if (line[i] === '$') found.push('$');
        i += 1;
      }
      i += 1;
    } else {
      if (';|&$`'.includes(c)) found.push(c);
      i += 1;
    }
  }
  return found;
}

/** An inward shape for a value node whose live reading is `value`. */
function shapeFor(value: unknown) {
  const doc = {
    v: 1, key: 'living.notes', title: { en: 'Notes' }, lang: 'en',
    model: { nodes: { note: { type: 'value', label: { en: 'Note' } } } },
  };
  const graph = { valueOf: () => value };
  return inwardShape({
    id: 'note', node: doc.model.nodes.note, doc, graph, langs: () => ['en'], base: 'https://node.example',
  });
}

type Road = { curl: string; windows?: { curl: string; body: string; file: string } };

/** The line the dialog offers a Windows owner on a road: its Windows line, or the only one there is. */
function windowsLine(road: Road): string {
  return road.windows ? road.windows.curl : road.curl;
}

const forCmd = 'a" & calc & "b %USERPROFILE%';
const forPowerShell = "x'; calc; 'y $env:USERNAME";

describe('the inward dialog offers a Windows line a live value cannot break out of', () => {
  for (const which of ['write', 'receiver'] as const) {
    it(`the ${which} road's Windows line holds no cmd.exe operator of the value`, () => {
      const road = shapeFor(forCmd)[which] as Road;
      expect(cmdOperators(windowsLine(road))).toEqual([]);
    });

    it(`the ${which} road's Windows line holds no PowerShell operator of the value`, () => {
      const road = shapeFor(forPowerShell)[which] as Road;
      expect(powershellOperators(windowsLine(road))).toEqual([]);
    });
  }

  it('the Windows lines carry no live data: the body is its own block, read from value.json', () => {
    const shape = shapeFor(forCmd);
    for (const road of [shape.write, shape.receiver] as Road[]) {
      expect(road.windows).toBeDefined();
      const w = road.windows!;
      expect(w.file).toBe('value.json');
      expect(w.curl).not.toContain('calc');
      expect(w.curl.startsWith('curl.exe -X POST "https://node.example/v1/')).toBe(true);
      expect(w.curl.endsWith(' --data-binary "@value.json"')).toBe(true);
    }
    expect(JSON.parse(shape.write.windows!.body)).toEqual({ key: 'living.notes.in.note', value: { value: forCmd } });
    expect(JSON.parse(shape.receiver.windows!.body)).toEqual({ value: forCmd });
  });

  it('the Windows lines send the same request as the POSIX lines', () => {
    const shape = shapeFor(4.2);
    expect(shape.write.windows!.curl).toBe(
      'curl.exe -X POST "https://node.example/v1/memory"'
      + ' -H "Content-Type: application/json" -H "Authorization: Bearer <your token>"'
      + ' --data-binary "@value.json"',
    );
    expect(shape.receiver.windows!.curl).toBe(
      'curl.exe -X POST "https://node.example/v1/receive/<owner>/' + shape.receiver.name + '"'
      + ' -H "Content-Type: application/json" -H "Authorization: Bearer <the receiver key>"'
      + ' --data-binary "@value.json"',
    );
    expect(shape.write.windows!.body).toBe(JSON.stringify(shape.write.request.body));
  });

  it('the dialog names the shell of each line in both languages', () => {
    for (const key of ['shell.posix', 'shell.windows', 'shell.windowsFile', 'shell.windowsRun']) {
      for (const lang of ['en', 'fi'] as const) {
        expect((WORDS[lang] as Record<string, string>)[key], `${lang} ${key}`).toBeTruthy();
      }
    }
    expect(WORDS.en['shell.windowsFile']).toContain('{file}');
    expect(WORDS.fi['shell.windowsFile']).toContain('{file}');
  });
});
