/**
 * @file agent-capabilities-schemas.ts
 * @description Zod validation schemas for agent capability reporting endpoints
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial schemas for capabilities PUT
 */
import { z } from 'zod';

export const AgentCapabilitiesUpdateSchema = z.object({
  technical: z.array(z.object({
    name: z.string().min(1).max(256),
    type: z.enum(['mcp', 'skill', 'tool']),
  })).max(100).optional().default([]),
  domain: z.array(z.string().min(1).max(256)).max(50).optional().default([]),
  languages: z.array(z.string().min(1).max(10)).max(20).optional(),
});
