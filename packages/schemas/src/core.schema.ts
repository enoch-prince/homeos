/**
 * @file core.schema.ts
 * @description HomeOS — Core Base Schema
 *
 * This is the single source of truth for all shared entity fields.
 * Every module schema MUST extend BaseEntitySchema. No exceptions.
 *
 * Architecture: Local-first via @syncflow-db/core
 *   - All writes go to local SQLite (wa-sqlite) first → instant UI
 *   - syncflow-db manages vector clocks + background sync to server
 *   - This schema makes the sync metadata explicit and validated
 *
 * SPEC-000 Reference: Section 2 (Voice Architecture), Section 3 (Data Architecture), Section 5 (Sync Strategy)
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: PRIMITIVE BUILDING BLOCKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A non-empty UUID string. Used for all relational ID references.
 * Using z.string().uuid() rather than a branded type for simplicity,
 * but all IDs are generated via `uuid` (as used by @syncflow-db/core).
 */
export const UUIDSchema = z.string().uuid();

/**
 * ISO 8601 datetime string. All timestamps MUST be stored in UTC.
 * The UI layer is responsible for local timezone display.
 *
 * ✅ "2025-09-01T14:30:00.000Z"
 * ❌ "2025-09-01T14:30:00+05:00"  ← reject non-UTC
 */
export const UTCDateTimeSchema = z
  .string()
  .datetime({ offset: false }) // offset: false enforces Z suffix (UTC only)
  .describe('ISO 8601 UTC datetime string');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: SYNC STATUS
// Tracks the lifecycle of every record through the local-first sync pipeline.
// syncflow-db sets these internally, but they are exposed here for:
//   (a) UI optimistic update indicators
//   (b) conflict resolution middleware
//   (c) audit queries ("show me everything that failed to sync")
// ─────────────────────────────────────────────────────────────────────────────

export const SyncStatusSchema = z.enum([
  'pending',   // Written locally, not yet pushed to server
  'synced',    // Confirmed by server, vector clocks agree
  'conflict',  // Server returned a conflicting version — needs resolution
  'failed',    // Sync attempted and failed (network, server error, etc.)
]);

export type SyncStatus = z.infer<typeof SyncStatusSchema>;

/**
 * Vector clock type — mirrors @syncflow-db/core's internal VectorClock.
 * Keys are clientId strings, values are logical timestamps (monotonic integers).
 *
 * Causal semantics (from syncflow-db):
 *   'happens-before' → safe to overwrite
 *   'happens-after'  → already superseded, discard
 *   'concurrent'     → CONFLICT — surface to ConflictResolutionStrategy
 */
export const VectorClockSchema = z
  .record(z.string(), z.number().int().nonnegative())
  .describe('Map of clientId → logical clock value');

export type VectorClock = z.infer<typeof VectorClockSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: CONFLICT RESOLUTION STRATEGY
// Declared per-entity at write time, not globally.
// This makes conflict behavior explicit in the spec rather than hidden in
// sync infrastructure. Validators must read this field when handling conflicts.
//
// Resolution behaviours:
//   last-write-wins  → Use the record with the higher timestamp. Fast, lossy.
//                      Safe for: pantry quantities, chore status.
//   manual           → Freeze both versions, surface UI conflict card.
//                      Required for: financial transactions, asset records.
//   merge-fields     → Field-level merge (non-overlapping fields reconciled).
//                      Used for: household member profiles, budget categories.
// ─────────────────────────────────────────────────────────────────────────────

export const ConflictResolutionStrategySchema = z.enum([
  'last-write-wins',
  'manual',
  'merge-fields',
]);

export type ConflictResolutionStrategy = z.infer<typeof ConflictResolutionStrategySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: HOUSEHOLD MEMBER
// The missing entity from Qwen's spec. Every action in HomeOS is attributable
// to a HouseholdMember, not just a device (clientId).
//
// HouseholdMember is the closest equivalent to a "user" in a traditional app,
// but without mandatory accounts — a child can be a member with no login.
// ─────────────────────────────────────────────────────────────────────────────

export const MemberRoleSchema = z.enum([
  'admin',   // Full access: can delete assets, manage budget limits, add members
  'adult',   // Standard access: can log expenses, complete tasks, edit pantry
  'child',   // Restricted: chores + pantry view only; no financial access
  'guest',   // Read-only: can view shared lists and calendar
]);

export type MemberRole = z.infer<typeof MemberRoleSchema>;

export const HouseholdMemberSchema = z.object({
  _id: UUIDSchema,
  displayName: z.string().min(1).max(50),
  role: MemberRoleSchema.default('adult'),
  avatarColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional()
    .describe('Hex color for avatar placeholder, e.g. #4A90D9'),
  deviceIds: z
    .array(z.string())
    .default([])
    .describe('List of clientIds bound to this member — one member can use multiple devices'),
  isActive: z.boolean().default(true),
  createdAt: UTCDateTimeSchema,
  updatedAt: UTCDateTimeSchema,
});

export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: BASE ENTITY SCHEMA
// The foundation. Every module schema calls BaseEntitySchema.extend({...}).
// Fields are ordered from infrastructure → authorship → business data.
//
// Field annotations explain WHY each field exists, not just what it is.
// ─────────────────────────────────────────────────────────────────────────────

export const BaseEntitySchema = z.object({

  // ── Identity ──────────────────────────────────────────────────────────────
  _id: UUIDSchema.describe(
    'Stable entity identifier. Generated client-side via uuid v4 at creation time. ' +
    'Never reassigned, even after sync.'
  ),

  // ── Revision tracking (mirrors syncflow-db Document._rev) ─────────────────
  _rev: z
    .number()
    .int()
    .nonnegative()
    .default(1)
    .describe(
      'Monotonic revision counter. Incremented by syncflow-db on every update. ' +
      'Used to detect stale writes: if local _rev < server _rev, a conflict may exist.'
    ),

  // ── Soft delete (mirrors syncflow-db soft-delete behavior) ────────────────
  _deleted: z
    .boolean()
    .default(false)
    .describe(
      'Soft delete flag. db.delete() sets this to true; the record is preserved ' +
      'for sync history and audit. Hard deletes are not permitted.'
    ),

  // ── Sync infrastructure ───────────────────────────────────────────────────
  syncStatus: SyncStatusSchema.default('pending').describe(
    'Current sync lifecycle state. Set to pending on every local write. ' +
    'The UI must reflect this: show optimistic state immediately, ' +
    'but visually indicate unsynced records (e.g. subtle dot indicator).'
  ),

  vectorClock: VectorClockSchema.default({}).describe(
    'Causal metadata managed by syncflow-db. The validator MUST NOT modify ' +
    'this field — it is owned exclusively by the sync engine. ' +
    'Exposed here for type-safety in conflict resolution middleware.'
  ),

  clientId: z
    .string()
    .min(1)
    .describe(
      'The device/client that created this record. Injected automatically ' +
      'by syncflow-db. Not editable by application code.'
    ),

  conflictResolutionStrategy: ConflictResolutionStrategySchema
    .default('last-write-wins')
    .describe(
      'How to resolve concurrent edits to this entity. ' +
      'Each module schema overrides this default as appropriate.'
    ),

  // ── Authorship (the missing piece from Qwen's spec) ───────────────────────
  createdBy: UUIDSchema.describe(
    'HouseholdMember._id of the member who created this record. ' +
    'Required on all entities. The voice processor must resolve the ' +
    'active member before writing any record.'
  ),

  updatedBy: UUIDSchema.describe(
    'HouseholdMember._id of the member who last modified this record. ' +
    'Updated on every write, including sync-originated writes (use system member ID).'
  ),

  // ── Timestamps ────────────────────────────────────────────────────────────
  createdAt: UTCDateTimeSchema.describe(
    'Record creation time in UTC. Set once at creation; never modified.'
  ),

  updatedAt: UTCDateTimeSchema.describe(
    'Last modification time in UTC. Updated on every write by the validator middleware.'
  ),

  syncedAt: UTCDateTimeSchema.optional().describe(
    'UTC timestamp of the last successful server sync. ' +
    'Null/undefined means the record has never left this device. ' +
    'Used to calculate "last synced X minutes ago" in the UI.'
  ),
});

export type BaseEntity = z.infer<typeof BaseEntitySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: SYSTEM CONSTANTS
// Well-known IDs for non-human actors in the system.
// These must be seeded into the local DB on first launch.
// ─────────────────────────────────────────────────────────────────────────────

export const SYSTEM_MEMBER_ID = '00000000-0000-0000-0000-000000000001' as const;
// Used as createdBy/updatedBy for:
//   - Auto-generated shopping list items (triggered by parLevel rule)
//   - Auto-scheduled maintenance tasks (triggered by frequencyDays rule)
//   - System notifications

export const UNKNOWN_MEMBER_ID = '00000000-0000-0000-0000-000000000002' as const;
// Fallback for records imported from external sources
// (receipt scans, bank imports) where authorship is ambiguous.

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: VOICE PIPELINE TYPES
// Infrastructure types for the 4-tier intent resolution cascade defined in
// SPEC-000 Section 2 (Pillar 3 — Voice-First).
//
// These are NOT business entities — they are pipeline metadata records.
// They live in core because no single module owns them; they span all modules.
// Collection name: core_deferred_voice_commands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Which tier of the voice pipeline produced a given VoiceIntent.
 * Stored alongside every intent write for debugging and pattern improvement.
 *
 *   t0_pattern  → Matched a Tier 0 deterministic rule (fastest, always offline)
 *   t1_on_device → Resolved by Apple Foundation Models or Gemini Nano
 *   t2_groq      → Resolved by Groq cloud API (llama-3.3-70b-versatile)
 *   t3_manual    → User manually confirmed via the intent picker bottom sheet
 */
export const InferenceTierSchema = z.enum([
  't0_pattern',
  't1_on_device',
  't2_groq',
  't3_manual',
]);

export type InferenceTier = z.infer<typeof InferenceTierSchema>;

/**
 * Provenance metadata attached to every parsed VoiceIntent.
 * Written to the DB alongside the resulting entity write so the audit trail
 * includes *how* the intent was understood, not just what it produced.
 *
 * The voice processor attaches this; module validators read it for logging.
 * Module schemas do NOT extend this — it's carried as a standalone record.
 */
export const VoiceIntentMetadataSchema = z.object({
  rawTranscript: z.string().describe(
    'The raw speech-to-text output before any parsing. ' +
    'Preserved verbatim for debugging and pattern library improvement.'
  ),
  inferenceTier: InferenceTierSchema,
  inferenceLatencyMs: z.number().int().nonnegative().describe(
    'Wall-clock time from transcript ready → VoiceIntent[] output, in milliseconds. ' +
    'Used to verify latency budget compliance per tier.'
  ),
  modelId: z.string().optional().describe(
    'Identifier of the model/rule that produced this intent. ' +
    'T0: rule ID (e.g. "rule_update_pantry_v3"). ' +
    'T1: platform model name (e.g. "apple-foundation-3b", "gemini-nano"). ' +
    'T2: Groq model string (e.g. "llama-3.3-70b-versatile"). ' +
    'T3: undefined (user-driven, no model).'
  ),
  resolvedAt: UTCDateTimeSchema.describe(
    'When the intent was successfully resolved to a VoiceIntent[]. ' +
    'For deferred commands, this is the resolution time, not the capture time.'
  ),
});

export type VoiceIntentMetadata = z.infer<typeof VoiceIntentMetadataSchema>;

/**
 * A voice command that failed Tier 0 pattern matching AND could not reach
 * Tier 1/2 (offline, unsupported hardware, or rate-limited).
 *
 * Stored locally with parseStatus: 'deferred' until:
 *   (a) The user resolves it manually via the intent picker (→ parseStatus: 'resolved')
 *   (b) Connectivity returns and Tier 2 re-parses it (→ parseStatus: 'resolved')
 *   (c) The user explicitly dismisses it (→ parseStatus: 'dismissed')
 *
 * Resolved commands with inferenceTier: 't3_manual' are candidates for
 * promoting to Tier 0 pattern rules (if the same transcript recurs).
 *
 * DOES NOT extend BaseEntitySchema — this is pipeline infrastructure,
 * not a household data entity. No syncStatus, no vectorClock.
 * It syncs only after resolution, as part of the resulting entity write.
 */
export const DeferredVoiceCommandSchema = z.object({
  _id: UUIDSchema,
  capturedAt: UTCDateTimeSchema.describe(
    'When the speech was captured. Always set immediately on STT completion.'
  ),
  rawTranscript: z.string().min(1).describe(
    'The raw STT output. May contain errors from speech recognition.'
  ),
  keywordHints: z.array(z.string()).default([]).describe(
    'Keywords extracted from the transcript without a model. ' +
    'Used to pre-fill the manual intent picker (Tier 3) fields. ' +
    'Example: ["milk", "4", "dollars"] from "I bought milk for 4 dollars".'
  ),
  parseStatus: z.enum(['deferred', 'resolved', 'dismissed']).default('deferred'),
  resolvedIntentType: z.string().optional().describe(
    'The VoiceIntent action string if resolved (e.g. "LOG_EXPENSE"). ' +
    'Set when parseStatus transitions to "resolved".'
  ),
  resolvedAt: UTCDateTimeSchema.optional(),
  capturedBy: UUIDSchema.describe('HouseholdMember._id who spoke the command.'),
  clientId: z.string().min(1).describe('Device that captured the command.'),
});

export type DeferredVoiceCommand = z.infer<typeof DeferredVoiceCommandSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: VALIDATION HELPERS
// Shared utilities used by module validators and the voice processor.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a new entity stub with all required BaseEntity fields pre-filled.
 * Module services call this before extending with their own fields.
 *
 * @param clientId  - The current device's syncflow-db clientId
 * @param memberId  - The active HouseholdMember._id
 */
export function createEntityDefaults(
  clientId: string,
  memberId: string
): Omit<BaseEntity, '_id'> {
  const now = new Date().toISOString();
  return {
    _rev: 1,
    _deleted: false,
    syncStatus: 'pending',
    vectorClock: {},
    clientId,
    conflictResolutionStrategy: 'last-write-wins',
    createdBy: memberId,
    updatedBy: memberId,
    createdAt: now,
    updatedAt: now,
    syncedAt: undefined,
  };
}

/**
 * Produces the fields to stamp onto any entity update.
 * Increments _rev, refreshes updatedAt and updatedBy, resets syncStatus.
 */
export function createUpdateStamp(
  currentRev: number,
  memberId: string
): Pick<BaseEntity, '_rev' | 'updatedAt' | 'updatedBy' | 'syncStatus'> {
  return {
    _rev: currentRev + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: memberId,
    syncStatus: 'pending', // Always reset to pending on any write
  };
}

/**
 * Type guard: returns true if an entity has an unresolved conflict.
 * Use in UI to show conflict resolution cards.
 */
export function isConflicted(entity: BaseEntity): boolean {
  return entity.syncStatus === 'conflict';
}

/**
 * Type guard: returns true if an entity has never been synced to server.
 * Use in UI to show "offline only" indicators.
 */
export function isLocalOnly(entity: BaseEntity): boolean {
  return entity.syncedAt === undefined && entity.syncStatus !== 'synced';
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: SPEC VIOLATION ERROR
// Standardized error type thrown by the validator middleware.
// All module validators must throw this — never raw Error or ZodError.
// The voice processor catches SpecViolationError to build user-facing messages.
// ─────────────────────────────────────────────────────────────────────────────

export class SpecViolationError extends Error {
  constructor(
    public readonly code: string,
    public readonly module: string,
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(`[${module}:${code}] ${message}`);
    this.name = 'SpecViolationError';
  }
}

/**
 * Canonical error codes. Module validators extend this with their own.
 *
 * Pattern: CORE_* for base schema violations
 *          <MODULE>_* for module-specific violations (e.g. PANTRY_BELOW_PAR)
 */
export const CoreErrorCodes = {
  INVALID_UUID:            'CORE_INVALID_UUID',
  INVALID_DATETIME:        'CORE_INVALID_DATETIME',
  MISSING_MEMBER:          'CORE_MISSING_MEMBER',
  STALE_REVISION:          'CORE_STALE_REVISION',
  ORPHAN_DELETE:           'CORE_ORPHAN_DELETE',
  SOFT_DELETE_ONLY:        'CORE_SOFT_DELETE_ONLY',
  CREDIT_EXPENSE_MISMATCH: 'CORE_CREDIT_EXPENSE_MISMATCH', // Shared by Finance
  // Voice pipeline errors (SPEC-000 §2 Pillar 3)
  VOICE_PARSE_DEFERRED:    'CORE_VOICE_PARSE_DEFERRED',    // Command queued; show manual intent picker
  VOICE_TIER_EXHAUSTED:    'CORE_VOICE_TIER_EXHAUSTED',    // All tiers failed; should not occur if T3 is implemented
} as const;
