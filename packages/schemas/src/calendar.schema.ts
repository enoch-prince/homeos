/**
 * @file calendar.schema.ts
 * @description HomeOS — Family Calendar Module Schema
 * SPEC Reference: SPEC-001 §4.8, SPEC-009
 */

import { z } from 'zod';
import { BaseEntitySchema, UUIDSchema, UTCDateTimeSchema } from './core.schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR EVENT
// conflictResolutionStrategy: last-write-wins
// Two members editing the same event concurrently is rare; LWW is acceptable.
//
// Recurrence: stored as iCal RRULE string. Instances are computed at read time
// by the UI layer. Expanded instances are never written to the DB. ADR-004.
// ─────────────────────────────────────────────────────────────────────────────

export const CalendarEventSchema = BaseEntitySchema.extend({
  title: z.string().min(1).max(150),
  startAt: UTCDateTimeSchema,
  endAt: UTCDateTimeSchema.optional()
    .describe('undefined = all-day event or point-in-time. Must be >= startAt when set. SPEC-009 Rule 1.'),
  isAllDay: z.boolean().default(false)
    .describe('If true, startAt must have time 00:00:00Z. SPEC-009 Rule 2.'),
  recurrenceRule: z.string().optional()
    .describe('iCal RRULE string e.g. "FREQ=WEEKLY;BYDAY=MO,WE,FR". ADR-004.'),
  attendees: z.array(UUIDSchema).default([])
    .describe('References core_household_members._id[]. All must be active. SPEC-009 Rule 3.'),

  // ── Cross-module links ────────────────────────────────────────────────────
  linkedChoreId: UUIDSchema.optional()
    .describe('ChoreTask soft-delete cascades to this event. SPEC-009 Rule 4.'),
  linkedMaintenanceTaskId: UUIDSchema.optional()
    .describe('MaintenanceTask reschedule updates this event startAt. SPEC-013.'),

  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional()
    .describe('Calendar chip colour for UI display.'),
  location: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  conflictResolutionStrategy: z.literal('last-write-wins').default('last-write-wins'),
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CODES (SPEC-009)
// ─────────────────────────────────────────────────────────────────────────────

export const CalendarErrorCodes = {
  INVALID_DATE_RANGE:    'CALENDAR_INVALID_DATE_RANGE',
  ALLDAY_TIME_MISMATCH:  'CALENDAR_ALLDAY_TIME_MISMATCH',
  INVALID_ATTENDEE:      'CALENDAR_INVALID_ATTENDEE',
} as const;
