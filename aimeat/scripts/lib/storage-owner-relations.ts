/**
 * @file storage-owner-relations.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Classify identity relations the historical deletion-name gate cannot see.
 * @version-history 1.0.0 2026-09-27 AST inventory with explicit pending decisions, not exemptions.
 */
import ts from 'typescript';

export const ADDITIONAL_IDENTITY_COLUMNS = ['ownerGhii', 'publisher', 'createdBy', 'authorGhii'] as const;
export interface RelationReview {
  role: 'ownership' | 'authorship' | 'history' | 'relation';
  current: string;
  reason: string;
  evidence: string[];
  test: string;
  verification: 'behavior-tested' | 'source-reviewed';
  decision: 'existing-contract' | 'required';
}

/** Read actual table types referenced by DB; comments and unrelated interfaces do not count. */
export function identityRelations(source: string): string[] {
  const file = ts.createSourceFile('db-types.ts', source, ts.ScriptTarget.Latest, true);
  const interfaces = new Map(file.statements.filter(ts.isInterfaceDeclaration).map(n => [n.name.text, n]));
  const db = interfaces.get('DB');
  if (!db) throw new Error('Storage schema has no DB interface');
  const result: string[] = [];
  for (const table of db.members) {
    if (!ts.isPropertySignature(table) || !table.type || !ts.isTypeReferenceNode(table.type)) continue;
    const shape = interfaces.get(table.type.typeName.getText(file));
    if (!shape) throw new Error(`Unknown table shape: ${table.type.getText(file)}`);
    for (const column of shape.members) {
      if (!ts.isPropertySignature(column)) continue;
      const name = column.name.getText(file).replace(/^['"]|['"]$/g, '');
      if (ADDITIONAL_IDENTITY_COLUMNS.some(c => c === name)) {
        result.push(`${table.name.getText(file).replace(/^['"]|['"]$/g, '')}.${name}`);
      }
    }
  }
  return result.sort();
}

export function validateRelationReviews(relations: string[], reviews: Record<string, RelationReview>, exists: (path: string) => boolean): string[] {
  const errors: string[] = [];
  for (const key of relations) {
    const review = reviews[key];
    if (!review) { errors.push(`${key}: missing classification`); continue; }
    if (!['ownership', 'authorship', 'history', 'relation'].includes(review.role)) errors.push(`${key}: invalid role`);
    if (!review.current?.trim() || !review.reason?.trim()) errors.push(`${key}: current behavior and reason required`);
    if (!['existing-contract', 'required'].includes(review.decision)) errors.push(`${key}: decision status required`);
    if (!['behavior-tested', 'source-reviewed'].includes(review.verification)) errors.push(`${key}: verification status required`);
    if (!review.evidence?.length || review.evidence.some(path => !exists(path))) errors.push(`${key}: missing source evidence`);
    if (!review.test?.startsWith('test/') || !exists(review.test)) errors.push(`${key}: missing test`);
  }
  for (const key of Object.keys(reviews)) if (!relations.includes(key)) errors.push(`${key}: stale classification`);
  return errors;
}
