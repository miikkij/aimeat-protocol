/**
 * @file src/models/worksheet-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Worksheet record: a sheet of cells where a cell is DATA, never code. A quantity
 *   carries a number and a unit, an input is a quantity a person may move, a formula is MathJSON
 *   standing on other cells by name, a view says how another cell should be drawn, and text is text.
 *   Nothing here is evaluated by the browser, so a sheet an agent wrote is exactly as safe as a row
 *   it wrote into a table — which is the whole reason the shape is this and not a notebook's.
 *
 *   Self-describing per docs/coding-guidelines/memory-contracts.md: the record names its own `spec`,
 *   so a reader that meets one in a memory key knows what it is looking at.
 * @structure WORKSHEET_SPEC · MAX_CELLS · WorksheetCellSchema · WorksheetSchema · EvaluateRequestSchema
 *   · inferred types (WorksheetCell · Worksheet)
 * @usage
 *   const parsed = WorksheetSchema.safeParse(record.value);
 *   if (!parsed.success) return res.status(400).json(error(nodeId, 'INVALID_WORKSHEET', …));
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial (wish-tyokirja-tieteellinen-laskenta, stage 1).
 */
import { z } from 'zod';

/** What a reader meeting this record in a memory key sees first. */
export const WORKSHEET_SPEC = 'aimeat.worksheet/v1';

/**
 * A sheet is read whole and evaluated whole on every change, so its size is the cost of a keystroke.
 * Two hundred cells is far past any sheet a person keeps by hand and still evaluates in a few
 * milliseconds; a model that means to hold ten thousand readings wants a memory key and a view cell
 * pointed at it, not ten thousand cells.
 */
export const MAX_CELLS = 200;

/** A cell id is a name a formula can stand on, so it is spelled like one. */
const cellId = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/, 'A cell id starts with a letter and carries letters, digits and underscores');

const label = z.string().max(120).optional();
const note = z.string().max(600).optional();
const unit = z.string().max(60).optional();

/** MathJSON: whatever the Compute Engine accepts. Bounded by the record's own size limit. */
const mathJson: z.ZodType<unknown> = z.unknown();

/** A measured or given value: a number with a unit, optionally following a memory key. */
const QuantityCell = z.object({
  id: cellId,
  kind: z.literal('quantity'),
  value: z.number().finite().optional(),
  unit,
  label,
  note,
  /** A memory key this cell follows; the surface reads it and keeps the cell current. */
  live: z.string().max(256).optional(),
  /** Where in the record's value the number sits, when the key holds more than one figure. */
  path: z.string().max(120).optional(),
});

/** A value a person may move, and the bounds it moves between. */
const InputCell = z.object({
  id: cellId,
  kind: z.literal('input'),
  value: z.number().finite(),
  unit,
  label,
  note,
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  /** How it is offered: a slider by default, a field when the number wants typing. */
  as: z.enum(['slider', 'field', 'stepper']).optional(),
});

/** An expression standing on other cells by name. `latex` is what a person typed, when they typed. */
const FormulaCell = z.object({
  id: cellId,
  kind: z.literal('formula'),
  math: mathJson.optional(),
  latex: z.string().max(2000).optional(),
  unit,
  label,
  note,
  /** Show the substituted expression under the formula, not only its answer. */
  showWork: z.boolean().optional(),
});

/** How another cell, or a memory key, should be drawn. */
const ViewCell = z.object({
  id: cellId,
  kind: z.literal('view'),
  as: z.enum(['figure', 'chip', 'gauge', 'sparkline', 'thermometer', 'series', 'table']),
  /** The cell this view draws. */
  of: cellId.optional(),
  /** …or the memory key it draws, when the drawing is of a history rather than a cell. */
  source: z.string().max(256).optional(),
  label,
  note,
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  /** How far back a series reaches: 24h, 7d, 30d. */
  window: z.string().max(16).optional(),
  /** Bands that turn a meter's tone, in the gauge component's own shape. */
  bands: z.array(z.object({ upTo: z.number().finite(), tone: z.string().max(16) })).max(8).optional(),
});

/** Words between the workings. */
const TextCell = z.object({
  id: cellId,
  kind: z.literal('text'),
  text: z.string().max(4000),
});

export const WorksheetCellSchema = z.discriminatedUnion('kind', [
  QuantityCell, InputCell, FormulaCell, ViewCell, TextCell,
]);

export const WorksheetSchema = z.object({
  spec: z.literal(WORKSHEET_SPEC).optional(),
  title: z.string().min(1).max(160).optional(),
  summary: z.string().max(600).optional(),
  /** The reader's language for formatted answers; the sheet itself is language-free. */
  locale: z.enum(['en', 'fi', 'es']).optional(),
  cells: z.array(WorksheetCellSchema).max(MAX_CELLS),
});

/** The evaluate door's body: a sheet, and the live values the surface has read for it. */
export const EvaluateRequestSchema = z.object({
  sheet: WorksheetSchema,
  /** Cell id → the number a following cell currently reads, from its memory key. */
  values: z.record(z.string(), z.number().finite()).optional(),
  locale: z.enum(['en', 'fi', 'es']).optional(),
});

export type WorksheetCell = z.infer<typeof WorksheetCellSchema>;
export type Worksheet = z.infer<typeof WorksheetSchema>;
export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;
