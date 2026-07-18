/**
 * @file finance.schema.ts
 * @description HomeOS — Finance & Budgeting Module Schemas
 * SPEC Reference: SPEC-001 §4.1–4.2, SPEC-005
 */

import { z } from 'zod';
import { BaseEntitySchema, UUIDSchema, UTCDateTimeSchema } from './core.schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET CATEGORY
// conflictResolutionStrategy: merge-fields
// Fields that can change independently: name, aliases, iconColor, monthlyBudgetLimit
// ─────────────────────────────────────────────────────────────────────────────

export const BudgetCategorySchema = BaseEntitySchema.extend({
  name: z.string().min(1).max(50),
  type: z.enum(['income', 'expense']),
  monthlyBudgetLimit: z.number().min(0).optional()
    .describe('undefined = no limit enforced'),
  aliases: z.array(z.string().min(1).max(30)).default([])
    .describe('Fuzzy-match synonyms resolved in SPEC-003 §4.2. e.g. ["food","supermarket"]'),
  iconColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  isSystem: z.boolean().default(false)
    .describe('true = seeded by system; cannot be deleted'),
  conflictResolutionStrategy: z.literal('merge-fields').default('merge-fields'),
});

export type BudgetCategory = z.infer<typeof BudgetCategorySchema>;

// ── Seed data ──────────────────────────────────────────────────────────────

export const DEFAULT_BUDGET_CATEGORIES: Array<Pick<BudgetCategory,
  'name' | 'type' | 'aliases' | 'isSystem'
>> = [
  { name: 'Groceries',         type: 'expense', aliases: ['food', 'supermarket', 'produce', 'grocery'], isSystem: true },
  { name: 'Home Repair',       type: 'expense', aliases: ['repair', 'maintenance', 'renovation', 'fix'], isSystem: true },
  { name: 'Utilities',         type: 'expense', aliases: ['bills', 'electric', 'gas', 'water', 'internet', 'phone'], isSystem: true },
  { name: 'Transport',         type: 'expense', aliases: ['gas', 'fuel', 'uber', 'transit', 'car', 'petrol'], isSystem: true },
  { name: 'Healthcare',        type: 'expense', aliases: ['medical', 'pharmacy', 'doctor', 'dentist', 'medicine'], isSystem: true },
  { name: 'Entertainment',     type: 'expense', aliases: ['fun', 'dining', 'restaurant', 'movies', 'subscriptions'], isSystem: true },
  { name: 'Household Income',  type: 'income',  aliases: ['salary', 'pay', 'wages', 'income'], isSystem: true },
  { name: 'Other',             type: 'expense', aliases: ['misc', 'miscellaneous', 'other'], isSystem: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTION
// conflictResolutionStrategy: manual (financial records must never be silently overwritten)
// ─────────────────────────────────────────────────────────────────────────────

export const TransactionSchema = BaseEntitySchema.extend({
  amount: z.number().positive()
    .describe('Always positive. Direction is determined by type field.'),
  type: z.enum(['credit', 'debit'])
    .describe('Must match the linked BudgetCategory.type. Validated by SPEC-005 Rule 1.'),
  categoryId: UUIDSchema
    .describe('References finance_budget_categories._id. Required; must exist.'),
  date: UTCDateTimeSchema
    .describe('User-supplied transaction date; may differ from createdAt for past entries.'),
  note: z.string().max(200).optional(),
  receiptImageUri: z.string().optional()
    .describe('Local device file URI only. Remote URLs not permitted in v1.'),

  // ── Cross-module links (SPEC-001 §4.2, SPEC-013) ──────────────────────────
  linkedAssetId: UUIDSchema.optional()
    .describe('If set, Finance validator increments Asset.lifetimeCost by amount.'),
  linkedPantryItemId: UUIDSchema.optional()
    .describe('If set, Finance validator updates PantryItem.lastPurchasedAt and averageCost.'),

  // ── Computed field (set by validator, not user) ────────────────────────────
  isOverBudget: z.boolean().default(false)
    .describe('Set true by validator when this debit causes category monthly total to exceed limit. Never user-editable.'),

  conflictResolutionStrategy: z.literal('manual').default('manual'),
});

export type Transaction = z.infer<typeof TransactionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CODES (SPEC-005)
// ─────────────────────────────────────────────────────────────────────────────

export const FinanceErrorCodes = {
  TYPE_MISMATCH:              'FINANCE_TYPE_MISMATCH',
  UNKNOWN_CATEGORY:           'FINANCE_UNKNOWN_CATEGORY',
  SYSTEM_CATEGORY_PROTECTED:  'FINANCE_SYSTEM_CATEGORY_PROTECTED',
  ORPHANED_CATEGORY:          'FINANCE_ORPHANED_CATEGORY',
} as const;
