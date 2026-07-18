/**
 * @file chores.schema.ts
 * @description HomeOS — Chores & Tasks Module Schema
 * SPEC Reference: SPEC-001 §4.7, SPEC-007
 */

import { z } from 'zod';
import { BaseEntitySchema, UUIDSchema, UTCDateTimeSchema } from './core.schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// CHORE TASK
// conflictResolutionStrategy: last-write-wins
// Completing a chore twice is harmless. Recurrence generates a new record.
// ─────────────────────────────────────────────────────────────────────────────

export const ChoreStatusSchema = z.enum(['pending', 'completed', 'skipped']);
export type ChoreStatus = z.infer<typeof ChoreStatusSchema>;

export const ChoreTaskSchema = BaseEntitySchema.extend({
  title: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  assignedTo: UUIDSchema.optional()
    .describe('References core_household_members._id. undefined = unassigned. SPEC-007 Rule 4.'),
  frequencyDays: z.number().int().positive().optional()
    .describe('Recurrence interval. On completion, validator creates the next ChoreTask. SPEC-007 Rule 2.'),
  dueDate: UTCDateTimeSchema.optional(),
  completedAt: UTCDateTimeSchema.optional()
    .describe('Set by validator on status → completed. SPEC-007 Rule 1.'),
  status: ChoreStatusSchema.default('pending'),
  pointValue: z.number().int().min(0).default(1)
    .describe('Points awarded to assignedTo member on completion. SPEC-007 Rule 3.'),
  linkedCalendarEventId: UUIDSchema.optional()
    .describe('Soft-deleting this ChoreTask cascades to the linked CalendarEvent. SPEC-007 orphan rule.'),
  conflictResolutionStrategy: z.literal('last-write-wins').default('last-write-wins'),
});

export type ChoreTask = z.infer<typeof ChoreTaskSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CODES (SPEC-007)
// ─────────────────────────────────────────────────────────────────────────────

export const ChoresErrorCodes = {
  ALREADY_COMPLETED:  'CHORE_ALREADY_COMPLETED',
  INVALID_ASSIGNEE:   'CHORE_INVALID_ASSIGNEE',
  DUE_DATE_IN_PAST:   'CHORE_DUE_DATE_IN_PAST',
} as const;
