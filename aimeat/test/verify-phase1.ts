/**
 * @file verify-phase1.ts
 * @description Phase 1 verification: CSM + Memory + Translation.
 *   Uses REAL LLM output from prj-mngecz0s-lu5f1 to verify the full pipeline.
 *   Run: npx tsx test/verify-phase1.ts
 */

import { readFileSync, existsSync } from 'node:fs';
import { stripCodeblock } from '../src/services/generator-prompts/strip.js';
import { validateComponent } from '../src/services/generator-prompts/validate.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); }
}

const artifactDir = 'data/debug/generator/prj-mngecz0s-lu5f1/components';

function readArtifact(component: string, file: string): string | null {
  const path = `${artifactDir}/${component}/${file}`;
  if (!existsSync(path)) { console.log(`  ⚠️  Artifact not found: ${path}`); return null; }
  return readFileSync(path, 'utf8');
}

// ═══ CSM ═══
console.log('\n═══ Phase 1a: CSM ═══');
const csmRaw = readArtifact('csm-1', 'ai-raw-response.txt');
if (csmRaw) {
  const csmStripped = stripCodeblock(csmRaw);
  assert(!csmStripped.startsWith('```'), 'CSM: stripCodeblock removes fences');
  const csmVr = validateComponent('csm', csmStripped, null as any);
  assert(csmVr.valid, 'CSM: validates correctly', csmVr.errors?.[0]);
}

// ═══ MEMORY ═══
console.log('\n═══ Phase 1b: Memory ═══');
const memRaw = readArtifact('memory-1', 'ai-raw-response.txt');
if (memRaw) {
  assert(memRaw.includes('```'), 'Memory: raw response has code fences');
  assert(memRaw.includes('Explanation'), 'Memory: raw response has explanation text after fences');

  const memStripped = stripCodeblock(memRaw);
  assert(!memStripped.includes('```'), 'Memory: stripCodeblock removes fences');
  assert(!memStripped.includes('Explanation'), 'Memory: stripCodeblock removes explanation text');

  try {
    const memParsed = JSON.parse(memStripped);
    assert(typeof memParsed === 'object' && memParsed !== null, 'Memory: JSON parses to object');
    assert(!Array.isArray(memParsed), 'Memory: JSON is object not array');
    const keys = Object.keys(memParsed);
    assert(keys.length > 0, `Memory: has ${keys.length} keys`);
    console.log(`    Keys: ${keys.join(', ')}`);
  } catch (e) {
    assert(false, 'Memory: JSON.parse succeeds', (e as Error).message);
  }

  const memVr = validateComponent('memory', memStripped, null as any);
  assert(memVr.valid, 'Memory: validates correctly', memVr.errors?.[0]);
}

// ═══ TRANSLATION FI ═══
console.log('\n═══ Phase 1c: Translation FI ═══');
const transFiRaw = readArtifact('translation-1', 'ai-raw-response.txt');
if (transFiRaw) {
  const transFiStripped = stripCodeblock(transFiRaw);
  assert(!transFiStripped.includes('```'), 'Translation FI: stripCodeblock removes fences');

  try {
    const transFiParsed = JSON.parse(transFiStripped);
    const locales = Object.keys(transFiParsed);
    assert(locales.length === 1, `Translation FI: exactly 1 locale (got ${locales.join(', ')})`);
    const locale = locales[0];
    assert(locale === 'fi', `Translation FI: locale is "fi" (got "${locale}")`);
    const keys = Object.keys(transFiParsed[locale!] || {});
    assert(keys.length > 5, `Translation FI: has ${keys.length} keys (need >5)`);
  } catch (e) {
    assert(false, 'Translation FI: JSON.parse succeeds', (e as Error).message);
  }

  const transVr = validateComponent('translation', transFiStripped, null as any);
  assert(transVr.valid, 'Translation FI: validates correctly', transVr.errors?.[0]);
}

// ═══ TRANSLATION EN ═══
console.log('\n═══ Phase 1d: Translation EN ═══');
const transEnRaw = readArtifact('translation-2', 'ai-raw-response.txt');
if (transEnRaw) {
  const transEnStripped = stripCodeblock(transEnRaw);
  assert(!transEnStripped.includes('```'), 'Translation EN: stripCodeblock removes fences');

  try {
    const transEnParsed = JSON.parse(transEnStripped);
    const locales = Object.keys(transEnParsed);
    assert(locales.length === 1, `Translation EN: exactly 1 locale (got ${locales.join(', ')})`);
    const locale = locales[0];
    assert(locale === 'en', `Translation EN: locale is "en" (got "${locale}")`);
  } catch (e) {
    assert(false, 'Translation EN: JSON.parse succeeds', (e as Error).message);
  }

  const transVr = validateComponent('translation', transEnStripped, null as any);
  assert(transVr.valid, 'Translation EN: validates correctly', transVr.errors?.[0]);
}

// ═══ EXTENSION REGISTRATION (Phase 2 preview — just the regex fix) ═══
console.log('\n═══ Phase 2 preview: Extension script extraction ═══');
const extGenerated = readArtifact('ext-1', 'generated.txt');
if (extGenerated) {
  // Simulate the fixed unfenced block extraction from generator-registration.ts
  const actionMarkerRegex = /^\/\/\s*actions\/([\w-]+\.js)\s*$/gm;
  const markers: Array<{ name: string; index: number }> = [];
  let um: RegExpExecArray | null;
  while ((um = actionMarkerRegex.exec(extGenerated)) !== null) {
    markers.push({ name: um[1]!, index: um.index + um[0].length });
  }
  assert(markers.length >= 5, `Extension: found ${markers.length} action markers (need ≥5)`);

  for (let i = 0; i < markers.length; i++) {
    const start = markers[i]!.index;
    const end = i + 1 < markers.length
      ? extGenerated.lastIndexOf('\n', extGenerated.indexOf(`// actions/${markers[i + 1]!.name}`, start))
      : extGenerated.length;
    const code = extGenerated.slice(start, end).trim();
    const lines = code.split('\n').length;
    assert(lines > 5, `Extension ${markers[i]!.name}: ${lines} lines (need >5)`);
  }
}

// ═══ SUMMARY ═══
console.log(`\n${'═'.repeat(50)}`);
console.log(`  PASSED: ${passed}  FAILED: ${failed}`);
console.log(`${'═'.repeat(50)}\n`);
process.exit(failed > 0 ? 1 : 0);
