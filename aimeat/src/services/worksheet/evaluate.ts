/**
 * @file src/services/worksheet/evaluate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A worksheet evaluated whole: the dependency graph read out of the formulas' own free
 *   symbols, a topological pass, and one answer per cell. This is the Mathematica-shaped part — move
 *   an input near the top and everything standing on it recomputes, and nothing else does — and it
 *   is reached without running any code, because a formula is MathJSON and a dependency is a name.
 *
 *   ONE IMPLEMENTATION, EVERY DOOR. The route, the MCP tool and the browser library all call
 *   evaluateSheet(); a second copy in the browser would be a second set of unit rules to keep in
 *   step, and the unit rules are the part that is easy to get quietly wrong.
 *
 *   A FAILING CELL DOES NOT FAIL THE SHEET. Each cell answers for itself: a typo in one formula
 *   leaves every other answer standing and says what is wrong on the cell that is wrong. A cell
 *   whose dependency failed says so rather than repeating the dependency's complaint, so a reader
 *   can see where the trouble starts.
 * @structure EvalErrorCode · EvalError · EvaluatedCell · EvaluatedSheet · evaluateSheet ·
 *   evaluateCell · resolve · convert · dependenciesOf · topologicalOrder · substitute
 * @usage
 *   import { evaluateSheet } from '../services/worksheet/evaluate.js';
 *   const answer = evaluateSheet(sheet, { values: live, locale: 'fi' });
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 1).
 */
import type { Worksheet, WorksheetCell } from '../../models/worksheet-schemas.js';
import {
  box, knownUnit, quantityOf, readResult, differenceUnit, isAffine, tidy, unitExpr, unitJson,
  formatQuantity, latexOf, symbolsOf, parseLatex, type MathJson, type Quantity,
} from './units.js';

/** Why a cell has no answer. Each one is a different thing for a surface to say. */
export type EvalErrorCode =
  | 'NO_VALUE'            // a quantity cell with nothing in it yet
  | 'UNKNOWN_UNIT'        // a unit no dimension answers to: a typo, most likely
  | 'UNKNOWN_SYMBOL'      // a formula standing on a name no cell carries
  | 'CYCLE'               // cells standing on each other
  | 'INCOMPATIBLE_UNITS'  // metres plus seconds
  | 'NOT_A_NUMBER'        // the expression resolved to something that is not a figure
  | 'NO_FORMULA'          // a formula cell with neither math nor latex
  | 'BAD_LATEX'           // typed maths that does not parse
  | 'UPSTREAM';           // a cell this one stands on has no answer

export interface EvalError {
  code: EvalErrorCode;
  /** What is wrong, in a sentence a surface can show without rewriting it. */
  message: string;
  /** The names behind the complaint: the unknown symbols, the cycle's members. */
  names?: string[];
}

export interface EvaluatedCell {
  id: string;
  kind: WorksheetCell['kind'];
  ok: boolean;
  value?: number;
  /** As it is written: `degC`, `W/(K·m²)`. */
  unit?: string | null;
  /** The same unit as the library's expression, so the next cell can go on computing with it. */
  unitJson?: MathJson;
  /** The answer as the reader's own number and unit. */
  formatted?: string;
  /** The expression as LaTeX, for a surface that sets it. */
  latex?: string;
  /** The expression with its dependencies filled in, when the cell asked to show its work. */
  workLatex?: string;
  error?: EvalError;
  /** The cell ids this one stands on, in the order the formula names them. */
  dependsOn: string[];
}

export interface EvaluatedSheet {
  cells: EvaluatedCell[];
  /** The order the cells were evaluated in; a surface can show a chain in the order it resolves. */
  order: string[];
  /** How many cells have no answer. Zero means the sheet stands. */
  errors: number;
}

/** How deep a formula may nest before it is refused. Far past any expression a person writes. */
const MAX_DEPTH = 64;

/**
 * Evaluate the whole sheet. `values` carries what the surface has read for the cells that follow a
 * memory key, so this function stays pure: it reads no storage and reaches no network.
 */
export function evaluateSheet(
  sheet: Worksheet,
  opts: { values?: Record<string, number>; locale?: string } = {},
): EvaluatedSheet {
  const locale = opts.locale ?? sheet.locale ?? 'en';
  const live = opts.values ?? {};
  const byId = new Map<string, WorksheetCell>();
  const duplicates = new Set<string>();
  for (const cell of sheet.cells ?? []) {
    if (byId.has(cell.id)) duplicates.add(cell.id);
    else byId.set(cell.id, cell);
  }

  const deps = new Map<string, string[]>();
  const unknownSymbols = new Map<string, string[]>();
  for (const cell of byId.values()) {
    const { on, unknown } = dependenciesOf(cell, byId);
    deps.set(cell.id, on);
    if (unknown.length) unknownSymbols.set(cell.id, unknown);
  }

  const { order, cyclic } = topologicalOrder(byId, deps);
  const answers = new Map<string, Quantity>();
  const results = new Map<string, EvaluatedCell>();

  for (const id of order) {
    const cell = byId.get(id)!;
    const on = deps.get(id) ?? [];
    const base: EvaluatedCell = { id, kind: cell.kind, ok: false, dependsOn: on };

    if (duplicates.has(id)) {
      results.set(id, { ...base, error: { code: 'UNKNOWN_SYMBOL', message: `The id ${id} is used by more than one cell, so a formula naming it cannot say which.`, names: [id] } });
      continue;
    }
    const missing = on.filter(dep => !answers.has(dep));
    if (missing.length) {
      results.set(id, { ...base, error: { code: 'UPSTREAM', message: `Waiting on ${missing.join(', ')}, which ${missing.length === 1 ? 'has' : 'have'} no answer.`, names: missing } });
      continue;
    }

    const evaluated = evaluateCell(cell, { answers, live, unknown: unknownSymbols.get(id) ?? [], locale });
    if (evaluated.value !== undefined) answers.set(id, { value: evaluated.value, unit: evaluated.unit ?? null, unitJson: evaluated.unitJson });
    results.set(id, { ...base, ...evaluated });
  }

  for (const id of cyclic) {
    const cell = byId.get(id)!;
    results.set(id, {
      id, kind: cell.kind, ok: false, dependsOn: deps.get(id) ?? [],
      error: { code: 'CYCLE', message: `${id} stands on itself through ${(deps.get(id) ?? []).join(', ') || 'another cell'}, so nothing can be worked out first.`, names: cyclic },
    });
  }

  const cells = (sheet.cells ?? []).map(c => results.get(c.id) ?? { id: c.id, kind: c.kind, ok: false, dependsOn: [], error: { code: 'UPSTREAM' as const, message: 'Not evaluated.' } });
  return { cells, order, errors: cells.filter(c => !c.ok).length };
}

/* ── One cell ─────────────────────────────────────────────────────────────────────────────────── */

function evaluateCell(
  cell: WorksheetCell,
  ctx: { answers: Map<string, Quantity>; live: Record<string, number>; unknown: string[]; locale: string },
): Partial<EvaluatedCell> {
  if (cell.kind === 'text') return { ok: true };

  if (cell.kind === 'view') {
    // A view draws; it has no answer of its own. It stands when what it draws stands.
    return { ok: true };
  }

  if (cell.kind === 'quantity' || cell.kind === 'input') {
    if (cell.unit && !knownUnit(cell.unit)) {
      return { error: { code: 'UNKNOWN_UNIT', message: `No unit is spelled ${cell.unit}.`, names: [cell.unit] } };
    }
    const value = cell.kind === 'input' ? cell.value : (ctx.live[cell.id] ?? cell.value);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { error: { code: 'NO_VALUE', message: cell.kind === 'quantity' && cell.live ? `Waiting for a reading from ${cell.live}.` : 'No value yet.' } };
    }
    const q: Quantity = { value: tidy(value), unit: cell.unit ? unitJson(unitExpr(cell.unit)) : null, unitJson: cell.unit ? unitExpr(cell.unit) ?? undefined : undefined };
    return { ok: true, value: q.value, unit: q.unit, unitJson: q.unitJson, formatted: formatQuantity(q, ctx.locale) };
  }

  // A formula.
  if (ctx.unknown.length) {
    return { error: { code: 'UNKNOWN_SYMBOL', message: `No cell is named ${ctx.unknown.join(' or ')}.`, names: ctx.unknown } };
  }
  // The schema accepts any JSON for `math` on purpose — the grammar is the library's, not ours — so
  // this is where that JSON is named as MathJSON.
  let math: MathJson | undefined = cell.math as MathJson | undefined;
  if (math === undefined && cell.latex) {
    const parsed = parseLatex(cell.latex);
    if (parsed === null) return { error: { code: 'BAD_LATEX', message: 'That expression could not be read as maths.' } };
    math = parsed;
  }
  if (math === undefined) return { error: { code: 'NO_FORMULA', message: 'This cell has no expression yet.' } };
  if (cell.unit && !knownUnit(cell.unit)) {
    return { error: { code: 'UNKNOWN_UNIT', message: `No unit is spelled ${cell.unit}.`, names: [cell.unit] } };
  }

  const filled = substitute(math, ctx.answers);
  let answer = resolve(filled);
  if (!answer) {
    const units = quantityUnitsIn(filled);
    const mixed = new Set(units.filter(Boolean)).size > 1;
    return {
      latex: latexOf(math),
      error: mixed
        ? { code: 'INCOMPATIBLE_UNITS', message: `These do not measure the same thing: ${[...new Set(units)].join(' and ')}.`, names: [...new Set(units)] as string[] }
        : { code: 'NOT_A_NUMBER', message: 'This expression does not work out to a figure.' },
    };
  }

  // A difference of two readings on an affine scale is a span, not a reading. See units.ts.
  if (isDifferenceOfAffine(filled)) {
    const span = differenceUnit(answer.unit);
    answer = { value: answer.value, unit: span, unitJson: span ?? undefined };
  }

  // The cell may ask for its answer in a unit of its own.
  if (cell.unit && answer.unit && cell.unit !== answer.unit) {
    const converted = convert(answer, cell.unit);
    if (!converted) {
      return {
        latex: latexOf(math),
        error: { code: 'INCOMPATIBLE_UNITS', message: `The answer is in ${answer.unit}, which cannot be read as ${cell.unit}.`, names: [answer.unit, cell.unit] },
      };
    }
    answer = converted;
  }

  const out: Partial<EvaluatedCell> = {
    ok: true,
    value: tidy(answer.value),
    unit: answer.unit,
    unitJson: answer.unitJson,
    formatted: formatQuantity(answer, ctx.locale),
    latex: latexOf(math),
  };
  if (cell.showWork) out.workLatex = latexOf(filled);
  return out;
}

/** What an expression works out to, or null when it works out to nothing we can use. */
function resolve(filled: MathJson): Quantity | null {
  try {
    return readResult(box(filled).evaluate().N() as never);
  } catch {
    // A throw and an unresolved expression are the same event here: this formula has no answer. The
    // caller decides WHICH kind of no it is and says that on the cell.
    // eslint-disable-next-line aimeat/no-silent-catch -- null here means "no answer", named by the caller
    return null;
  }
}

/** The same magnitude on another scale, or null when the two do not measure the same thing. */
function convert(q: Quantity, unit: string): Quantity | null {
  if (!q.unit) return null;
  const target = unitExpr(unit);
  if (target === null) return null;
  try {
    const converted = box(['UnitConvert', quantityOf(q.value, q.unit, q.unitJson), target]).evaluate().N();
    const read = readResult(converted as never);
    return read && read.unit ? read : null;
  } catch {
    // A conversion that will not go through means the two do not measure the same thing, and the
    // caller turns this null into INCOMPATIBLE_UNITS with both units named.
    // eslint-disable-next-line aimeat/no-silent-catch -- null here means "these do not convert"
    return null;
  }
}

/* ── The graph ────────────────────────────────────────────────────────────────────────────────── */

/** What a cell stands on, and which of the names it uses belong to no cell. */
export function dependenciesOf(cell: WorksheetCell, byId: Map<string, WorksheetCell>): { on: string[]; unknown: string[] } {
  if (cell.kind === 'view') {
    return { on: cell.of && byId.has(cell.of) ? [cell.of] : [], unknown: cell.of && !byId.has(cell.of) ? [cell.of] : [] };
  }
  if (cell.kind !== 'formula') return { on: [], unknown: [] };
  // The schema accepts any JSON for `math` on purpose — the grammar is the library's, not ours — so
  // this is where that JSON is named as MathJSON.
  let math: MathJson | undefined = cell.math as MathJson | undefined;
  if (math === undefined && cell.latex) math = parseLatex(cell.latex) ?? undefined;
  if (math === undefined) return { on: [], unknown: [] };
  const on: string[] = [];
  const unknown: string[] = [];
  for (const name of symbolsOf(math)) {
    if (name === cell.id) unknown.push(name);
    else if (byId.has(name)) on.push(name);
    else unknown.push(name);
  }
  return { on, unknown };
}

/** Kahn's order. What is left over stands in a cycle, and every member of it is named. */
export function topologicalOrder(byId: Map<string, WorksheetCell>, deps: Map<string, string[]>): { order: string[]; cyclic: string[] } {
  const remaining = new Set(byId.keys());
  const order: string[] = [];
  let moved = true;
  while (moved) {
    moved = false;
    for (const id of [...remaining]) {
      const on = deps.get(id) ?? [];
      if (on.every(dep => !remaining.has(dep))) {
        order.push(id);
        remaining.delete(id);
        moved = true;
      }
    }
  }
  return { order, cyclic: [...remaining] };
}

/**
 * Every cell name in the expression replaced by that cell's answer. A MathJSON array's first entry
 * is the operator, so only the operands are substituted; a cell called Add would otherwise eat the
 * addition it sits inside.
 */
export function substitute(math: MathJson, answers: Map<string, Quantity>, depth = 0): MathJson {
  if (depth > MAX_DEPTH) return math;
  if (typeof math === 'string') {
    const a = answers.get(math);
    return a ? quantityOf(a.value, a.unit, a.unitJson) : math;
  }
  if (Array.isArray(math)) {
    return math.map((part, i) => (i === 0 ? part : substitute(part, answers, depth + 1)));
  }
  return math;
}

/** The units of every quantity written into an expression, for saying what did not agree. */
function quantityUnitsIn(math: MathJson, depth = 0, out: string[] = []): string[] {
  if (depth > MAX_DEPTH || !Array.isArray(math)) return out;
  if (math[0] === 'Quantity' && math.length >= 3) {
    const written = unitJson(math[2]);
    if (written) out.push(written);
  }
  for (const part of math.slice(1)) quantityUnitsIn(part, depth + 1, out);
  return out;
}

/** The unit a quantity in an expression carries, as it is written. */
function unitOfQuantity(part: unknown): string | null {
  return Array.isArray(part) && part[0] === 'Quantity' && part.length >= 3 ? unitJson(part[2]) : null;
}

/** Is this a subtraction of two readings on the same affine scale? Then the answer is a span. */
function isDifferenceOfAffine(math: MathJson): boolean {
  if (!Array.isArray(math) || math[0] !== 'Subtract' || math.length !== 3) return false;
  const a = unitOfQuantity(math[1]);
  const b = unitOfQuantity(math[2]);
  return !!a && a === b && isAffine(a);
}
