/**
 * @file fixtures.ts
 * @description Shared test fixtures — stable UUIDs and seed records for all tests.
 *
 * Stable UUIDs prevent "works in isolation but not in suite" ordering bugs.
 * Every fixture is typed against its schema so TypeScript catches drift.
 */

import type { HouseholdMember } from '@homeos/schemas';
import { SYSTEM_MEMBER_ID } from '@homeos/schemas';
import type { BudgetCategory } from '@homeos/schemas';
import type { PantryItem } from '@homeos/schemas';
import type { Asset, MaintenanceTask } from '@homeos/schemas';
import type { ChoreTask } from '@homeos/schemas';

// ── Stable IDs ───────────────────────────────────────────────────────────────

export const IDs = {
  // Members
  MEMBER_ADMIN:    'a0000000-0000-0000-0000-000000000001',
  MEMBER_ADULT:    'a0000000-0000-0000-0000-000000000002',
  MEMBER_CHILD:    'a0000000-0000-0000-0000-000000000003',

  // Budget categories
  CAT_GROCERIES:   'b0000000-0000-0000-0000-000000000001',
  CAT_HOME_REPAIR: 'b0000000-0000-0000-0000-000000000002',
  CAT_INCOME:      'b0000000-0000-0000-0000-000000000003',

  // Pantry items
  MILK:            'c0000000-0000-0000-0000-000000000001',
  EGGS:            'c0000000-0000-0000-0000-000000000002',
  BREAD:           'c0000000-0000-0000-0000-000000000003',

  // Assets
  HVAC:            'd0000000-0000-0000-0000-000000000001',
  DISHWASHER:      'd0000000-0000-0000-0000-000000000002',

  // Maintenance tasks
  HVAC_FILTER:     'e0000000-0000-0000-0000-000000000001',

  // Chores
  VACUUM:          'f0000000-0000-0000-0000-000000000001',
  DISHES:          'f0000000-0000-0000-0000-000000000002',

  CLIENT:          'test-client-01',
} as const;

// ── Base entity defaults (minimal syncflow-db fields) ─────────────────────────

const BASE = {
  _rev: 1,
  _deleted: false as const,
  syncStatus: 'pending' as const,
  vectorClock: {},
  clientId: IDs.CLIENT,
  conflictResolutionStrategy: 'last-write-wins' as const,
  createdBy: IDs.MEMBER_ADMIN,
  updatedBy: IDs.MEMBER_ADMIN,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ── Members ──────────────────────────────────────────────────────────────────

export const MEMBERS: HouseholdMember[] = [
  {
    _id: SYSTEM_MEMBER_ID,
    displayName: 'System',
    role: 'admin',
    deviceIds: [],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    _id: IDs.MEMBER_ADMIN,
    displayName: 'Alex (Admin)',
    role: 'admin',
    deviceIds: [IDs.CLIENT],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    _id: IDs.MEMBER_ADULT,
    displayName: 'Jordan (Adult)',
    role: 'adult',
    deviceIds: [],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    _id: IDs.MEMBER_CHILD,
    displayName: 'Sam (Child)',
    role: 'child',
    deviceIds: [],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

// ── Budget categories ─────────────────────────────────────────────────────────

export const BUDGET_CATEGORIES: BudgetCategory[] = [
  {
    ...BASE,
    _id: IDs.CAT_GROCERIES,
    name: 'Groceries',
    type: 'expense',
    monthlyBudgetLimit: 500,
    aliases: ['food', 'supermarket'],
    isSystem: true,
    conflictResolutionStrategy: 'merge-fields' as const,
  },
  {
    ...BASE,
    _id: IDs.CAT_HOME_REPAIR,
    name: 'Home Repair',
    type: 'expense',
    monthlyBudgetLimit: 200,
    aliases: ['repair', 'maintenance'],
    isSystem: true,
    conflictResolutionStrategy: 'merge-fields' as const,
  },
  {
    ...BASE,
    _id: IDs.CAT_INCOME,
    name: 'Household Income',
    type: 'income',
    aliases: ['salary', 'income'],
    isSystem: true,
    conflictResolutionStrategy: 'merge-fields' as const,
  },
];

// ── Pantry items ─────────────────────────────────────────────────────────────

export const PANTRY_ITEMS: PantryItem[] = [
  {
    ...BASE,
    _id: IDs.MILK,
    name: 'Milk',
    quantity: 2,
    unit: 'L',
    location: 'Fridge',
    parLevel: 1,           // triggers shopping list when quantity <= 1
  },
  {
    ...BASE,
    _id: IDs.EGGS,
    name: 'Eggs',
    quantity: 6,
    unit: 'pcs',
    location: 'Fridge',
    parLevel: 6,           // triggers when quantity <= 6
  },
  {
    ...BASE,
    _id: IDs.BREAD,
    name: 'Bread',
    quantity: 1,
    unit: 'bag',
    location: 'Pantry',
    parLevel: 1,
    expiryDate: new Date(Date.now() + 24 * 36e5).toISOString(), // expires in 24h
  },
];

// ── Assets ───────────────────────────────────────────────────────────────────

export const ASSETS: Asset[] = [
  {
    ...BASE,
    _id: IDs.HVAC,
    name: 'HVAC System',
    category: 'HVAC',
    location: 'Attic',
    lifetimeCost: 0,
    conflictResolutionStrategy: 'manual',
  },
  {
    ...BASE,
    _id: IDs.DISHWASHER,
    name: 'Dishwasher',
    category: 'Appliance',
    location: 'Kitchen',
    lifetimeCost: 800,
    warrantyExpiryDate: new Date(Date.now() + 20 * 864e5).toISOString(), // 20 days
    conflictResolutionStrategy: 'manual',
  },
];

// ── Maintenance tasks ─────────────────────────────────────────────────────────

export const MAINTENANCE_TASKS: MaintenanceTask[] = [
  {
    ...BASE,
    _id: IDs.HVAC_FILTER,
    assetId: IDs.HVAC,
    title: 'Replace HVAC filter',
    frequencyDays: 90,
    status: 'pending',
    nextDueAt: new Date(Date.now() - 1 * 864e5).toISOString(), // 1 day overdue
  },
];

// ── Chores ────────────────────────────────────────────────────────────────────

export const CHORES: ChoreTask[] = [
  {
    ...BASE,
    _id: IDs.VACUUM,
    title: 'Vacuum living room',
    assignedTo: IDs.MEMBER_ADULT,
    frequencyDays: 7,
    dueDate: new Date().toISOString(),
    status: 'pending',
    pointValue: 5,
  },
  {
    ...BASE,
    _id: IDs.DISHES,
    title: 'Do the dishes',
    assignedTo: IDs.MEMBER_CHILD,
    status: 'pending',
    pointValue: 3,
  },
];
