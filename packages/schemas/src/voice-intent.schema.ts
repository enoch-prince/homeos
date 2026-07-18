/**
 * @file voice-intent.schema.ts
 * @description HomeOS — Voice Intent Schema
 * SPEC Reference: SPEC-003
 *
 * This schema is the contract between the voice pipeline (Tier 0–3) and the
 * validator middleware. Every parsed voice command must produce at least one
 * VoiceIntent that passes safeParse() before any DB write is attempted.
 *
 * Import UOMSchema and LocationSchema from pantry.schema.ts to stay DRY —
 * voice intents use the same unit and location enums as pantry entities.
 */

import { z } from 'zod';
import { UOMSchema, LocationSchema } from './pantry.schema.js';
import { UTCDateTimeSchema } from './core.schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// VOICE INTENT — Discriminated Union
// Each arm of the union maps to one or more validator pipeline actions.
// SPEC-003 §3 defines the LLM prompt that produces these shapes.
// ─────────────────────────────────────────────────────────────────────────────

export const VoiceIntentSchema = z.discriminatedUnion('action', [

  // ── Pantry: consume or restock ────────────────────────────────────────────
  z.object({
    action: z.literal('UPDATE_PANTRY'),
    payload: z.object({
      itemName: z.string().min(1).max(100),
      quantity: z.number().positive(),
      unit: UOMSchema,
      actionType: z.enum(['add', 'subtract']),
      location: LocationSchema.optional(),
    }),
  }),

  // ── Shopping: add to list ─────────────────────────────────────────────────
  z.object({
    action: z.literal('ADD_TO_SHOPPING'),
    payload: z.object({
      itemName: z.string().min(1).max(100),
      quantity: z.number().positive().default(1),
      unit: UOMSchema.default('pcs'),
      store: z.string().max(50).optional(),
    }),
  }),

  // ── Finance: log expense ──────────────────────────────────────────────────
  z.object({
    action: z.literal('LOG_EXPENSE'),
    payload: z.object({
      amount: z.number().positive(),
      categoryGuess: z.string().min(1).max(50)
        .describe('Free string from LLM. Resolved to BudgetCategory._id via SPEC-003 §4.2.'),
      note: z.string().max(200).optional(),
      linkedItem: z.string().max(100).optional()
        .describe('Free string hint e.g. "for the new dishwasher". Resolved to asset/pantry ID by voice processor.'),
    }),
  }),

  // ── Maintenance: log completion ───────────────────────────────────────────
  z.object({
    action: z.literal('LOG_MAINTENANCE'),
    payload: z.object({
      assetName: z.string().min(1).max(100)
        .describe('Free string. Resolved to Asset._id via SPEC-003 §4.3.'),
      taskTitle: z.string().min(1).max(150),
      completed: z.boolean().default(true),
      cost: z.number().positive().optional()
        .describe('If provided, voice processor auto-creates a LOG_EXPENSE intent.'),
    }),
  }),

  // ── Chores: mark complete ─────────────────────────────────────────────────
  z.object({
    action: z.literal('COMPLETE_CHORE'),
    payload: z.object({
      choreTitle: z.string().min(1).max(100)
        .describe('Free string. Resolved to ChoreTask._id via SPEC-003 §4.4.'),
    }),
  }),

  // ── Calendar: add event ───────────────────────────────────────────────────
  z.object({
    action: z.literal('ADD_CALENDAR'),
    payload: z.object({
      title: z.string().min(1).max(150),
      startAt: UTCDateTimeSchema
        .describe('The voice processor must parse relative dates ("tomorrow at 3pm") to UTC ISO strings before this schema is applied.'),
      endAt: UTCDateTimeSchema.optional(),
      isAllDay: z.boolean().default(false),
      attendees: z.array(z.string()).default([])
        .describe('Member names as strings; voice processor resolves to HouseholdMember._id[]'),
      location: z.string().max(100).optional(),
    }),
  }),

]);

export type VoiceIntent = z.infer<typeof VoiceIntentSchema>;
export type VoiceAction = VoiceIntent['action'];

// ─────────────────────────────────────────────────────────────────────────────
// PARSED VOICE COMMAND
// The full output of the voice pipeline before validator execution.
// Wraps one or more VoiceIntents with their provenance metadata.
// ─────────────────────────────────────────────────────────────────────────────

import { VoiceIntentMetadataSchema } from './core.schema.js';

export const ParsedVoiceCommandSchema = z.object({
  intents: z.array(VoiceIntentSchema).min(1)
    .describe('Ordered per SPEC-003 §5 multi-intent ordering rules.'),
  metadata: VoiceIntentMetadataSchema,
  memberId: z.string().uuid()
    .describe('Active HouseholdMember._id at time of utterance. Required before validator runs.'),
});

export type ParsedVoiceCommand = z.infer<typeof ParsedVoiceCommandSchema>;
