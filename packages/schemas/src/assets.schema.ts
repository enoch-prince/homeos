/**
 * @file assets.schema.ts
 * @description HomeOS — Maintenance & Assets Module Schemas
 * SPEC Reference: SPEC-001 §4.5–4.6, SPEC-008
 */

import { z } from 'zod';
import { BaseEntitySchema, UUIDSchema, UTCDateTimeSchema } from './core.schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// ASSET
// conflictResolutionStrategy: manual
// Asset records are long-lived and high-value. Silent overwrites are unacceptable.
// ─────────────────────────────────────────────────────────────────────────────

export const AssetCategorySchema = z.enum([
  'Appliance', 'HVAC', 'Vehicle', 'Structure', 'Electronics', 'Plumbing', 'Other',
]);
export type AssetCategory = z.infer<typeof AssetCategorySchema>;

export const AssetSchema = BaseEntitySchema.extend({
  name: z.string().min(1).max(100)
    .describe('Human-readable label e.g. "Dishwasher", "Roof", "Honda Civic 2021"'),
  category: AssetCategorySchema,
  location: z.string().max(50).optional()
    .describe('Room or area e.g. "Kitchen", "Garage", "Attic"'),
  purchaseDate: UTCDateTimeSchema.optional()
    .describe('Original acquisition date. NOT updated on repairs — use lifetimeCost for that.'),
  purchaseCost: z.number().min(0).optional()
    .describe('Original acquisition cost. Set once; not updated by repair transactions.'),
  lifetimeCost: z.number().min(0).default(0)
    .describe('Running total of all linked Transaction amounts. Incremented by Finance validator (SPEC-005 Rule 3, ADR-003). Never user-edited directly.'),
  warrantyExpiryDate: UTCDateTimeSchema.optional(),
  expectedLifespanYears: z.number().positive().optional(),
  notes: z.string().max(500).optional()
    .describe('Freeform: model number, serial number, manual URL, contractor contacts.'),
  photoUri: z.string().optional()
    .describe('Local device file URI. Remote URLs not permitted in v1.'),
  conflictResolutionStrategy: z.literal('manual').default('manual'),
});

export type Asset = z.infer<typeof AssetSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE TASK
// conflictResolutionStrategy: last-write-wins
// Completing a task twice is harmless; the second completion just resets the schedule.
// ─────────────────────────────────────────────────────────────────────────────

export const MaintenanceStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'overdue',
]);
export type MaintenanceStatus = z.infer<typeof MaintenanceStatusSchema>;

export const MaintenanceTaskSchema = BaseEntitySchema.extend({
  assetId: UUIDSchema
    .describe('References assets_register._id. Must point to a non-deleted Asset. SPEC-008 Rule 5.'),
  title: z.string().min(1).max(150)
    .describe('e.g. "Replace HVAC filter", "Oil change", "Clean gutters"'),
  instructions: z.string().max(1000).optional(),
  frequencyDays: z.number().int().positive().optional()
    .describe('Recurrence interval in days. undefined = one-off task. SPEC-008 Rule 1.'),
  lastCompletedAt: UTCDateTimeSchema.optional()
    .describe('Set by validator on completion. Do not set manually.'),
  nextDueAt: UTCDateTimeSchema.optional()
    .describe('Computed by validator: lastCompletedAt + frequencyDays. Never user-set. SPEC-008 Rule 1.'),
  status: MaintenanceStatusSchema.default('pending'),
  assignedTo: UUIDSchema.optional()
    .describe('References core_household_members._id. Optional.'),
  completionNote: z.string().max(200).optional()
    .describe('Written at completion time e.g. "Used Filtrete 1500 MPR filter"'),
  conflictResolutionStrategy: z.literal('last-write-wins').default('last-write-wins'),
});

export type MaintenanceTask = z.infer<typeof MaintenanceTaskSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CODES (SPEC-008)
// ─────────────────────────────────────────────────────────────────────────────

export const AssetsErrorCodes = {
  HAS_ACTIVE_TASKS:    'ASSETS_HAS_ACTIVE_TASKS',
  INVALID_ASSET_REF:   'ASSETS_INVALID_ASSET_REF',
  ORPHAN_TASK:         'ASSETS_ORPHAN_TASK',
} as const;
