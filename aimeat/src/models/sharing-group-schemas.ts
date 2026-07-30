/**
 * @file sharing-group-schemas.ts
 * @description Zod validation schemas for sharing group CRUD operations
 * @version-history
 *   Text limits raised — 2026-07-30 — group descriptions to 10 000.
 *   v1.0.0 -- 2026-05-21 -- Initial creation for Agent Dashboard Phase 1
 */

import { z } from 'zod';

export const SharingGroupCreateSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(10_000).optional(),
  members: z.array(z.object({
    identifier: z.string().min(1).max(256),
    identifier_type: z.enum(['gaii', 'ghii']),
    permissions: z.object({
      read: z.boolean(),
      write: z.boolean(),
    }).optional(),
  })).max(100).optional().default([]),
  default_permissions: z.object({
    read: z.boolean(),
    write: z.boolean(),
  }).optional().default({ read: true, write: false }),
});

export const SharingGroupUpdateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(10_000).optional(),
  default_permissions: z.object({
    read: z.boolean(),
    write: z.boolean(),
  }).optional(),
});

export const SharingGroupAddMemberSchema = z.object({
  identifier: z.string().min(1).max(256),
  identifier_type: z.enum(['gaii', 'ghii']),
  permissions: z.object({
    read: z.boolean(),
    write: z.boolean(),
  }).optional(),
});

export const SharingGroupUpdateMemberSchema = z.object({
  permissions: z.object({
    read: z.boolean(),
    write: z.boolean(),
  }),
});
