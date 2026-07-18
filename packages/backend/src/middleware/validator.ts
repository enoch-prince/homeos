/**
 * @file validator.ts
 * @description HomeOS — Validator Middleware
 *
 * The ONLY permitted path to the database. No module may call db.insert() or
 * db.update() directly. Every write flows through validate(), which runs the
 * 7-stage pipeline defined in SPEC-000 §4.1.
 *
 * Pipeline stages:
 *   1. Schema Validation      — Zod safeParse on the raw input shape
 *   2. Member Authorization   — role permission check for this action
 *   3. Business Logic Rules   — module-specific validators
 *   4. Cross-Module Effects   — side-effect writes (shopping items, schedules, etc.)
 *   5. Write Stamp            — inject _id (new), updatedAt, updatedBy, syncStatus
 *   6. DB Write               — db.insert() / db.update() via syncflow-db
 *   7. Notification Dispatch  — Morning Briefing queue for threshold events
 */

import { v4 as uuidv4 } from 'uuid';
import {
  type BaseEntity,
  type HouseholdMember,
  type MemberRole,
  SpecViolationError,
  CoreErrorCodes,
  SYSTEM_MEMBER_ID,
  UNKNOWN_MEMBER_ID,
  createEntityDefaults,
  createUpdateStamp,
} from '@homeos/schemas';
import {
  type BudgetCategory,
  type Transaction,
  FinanceErrorCodes,
} from '@homeos/schemas';
import {
  type PantryItem,
  type ShoppingListItem,
  PantryErrorCodes,
} from '@homeos/schemas';
import {
  type Asset,
  type MaintenanceTask,
  AssetsErrorCodes,
} from '@homeos/schemas';
import {
  type ChoreTask,
  ChoresErrorCodes,
} from '@homeos/schemas';
import {
  type CalendarEvent,
  CalendarErrorCodes,
} from '@homeos/schemas';

// ─────────────────────────────────────────────────────────────────────────────
// DB ADAPTER INTERFACE
// The validator depends on this interface, not on syncflow-db directly.
// This makes the validator fully testable with an in-memory mock (see tests/).
// ─────────────────────────────────────────────────────────────────────────────

// Minimal identity constraint — allows both BaseEntity records and HouseholdMember
// (which has its own schema not extending BaseEntity).
export type DbRecord = { _id: string };

export interface DbAdapter {
  insert<T extends DbRecord>(collection: string, record: T): Promise<T>;
  update<T extends DbRecord>(collection: string, id: string, patch: Partial<T>): Promise<T>;
  softDelete(collection: string, id: string, updatedBy: string): Promise<void>;
  findById<T extends DbRecord>(collection: string, id: string): Promise<T | null>;
  findOne<T extends DbRecord>(collection: string, query: Record<string, unknown>): Promise<T | null>;
  findMany<T extends DbRecord>(collection: string, query: Record<string, unknown>): Promise<T[]>;
  sumField(collection: string, field: string, query: Record<string, unknown>): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION ADAPTER INTERFACE
// Decoupled from the validator — swapped for PWA push in production,
// in-memory event emitter in tests.
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationAdapter {
  queueBriefingItem(priority: 'red' | 'amber' | 'yellow' | 'green', message: string, entityId: string, collection: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATOR CONTEXT
// Carries the active member and device through all pipeline stages.
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidatorContext {
  memberId: string;
  clientId: string;
  db: DbAdapter;
  notifications: NotificationAdapter;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTION NAMES (canonical — SPEC-001 §3)
// ─────────────────────────────────────────────────────────────────────────────

export const Collections = {
  MEMBERS:           'core_household_members',
  DEFERRED_VOICE:    'core_deferred_voice_commands',
  BUDGET_CATEGORIES: 'finance_budget_categories',
  TRANSACTIONS:      'finance_transactions',
  PANTRY_ITEMS:      'pantry_items',
  SHOPPING_LIST:     'pantry_shopping_list',
  ASSETS:            'assets_register',
  MAINTENANCE_TASKS: 'assets_maintenance_tasks',
  CHORES:            'chores_tasks',
  CALENDAR:          'calendar_events',
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// ROLE PERMISSION MATRIX (SPEC-000 §4.3)
// ─────────────────────────────────────────────────────────────────────────────

type Action =
  | 'read:finance'
  | 'write:transaction'
  | 'write:budget_category'
  | 'write:pantry'
  | 'write:shopping'
  | 'delete:pantry'
  | 'write:chore'
  | 'complete:chore'
  | 'delete:chore'
  | 'write:asset'
  | 'delete:asset'
  | 'write:maintenance'
  | 'write:calendar'
  | 'delete:calendar'
  | 'manage:members';

const ROLE_PERMISSIONS: Record<MemberRole, Set<Action>> = {
  admin: new Set<Action>([
    'read:finance', 'write:transaction', 'write:budget_category',
    'write:pantry', 'write:shopping', 'delete:pantry',
    'write:chore', 'complete:chore', 'delete:chore',
    'write:asset', 'delete:asset', 'write:maintenance',
    'write:calendar', 'delete:calendar',
    'manage:members',
  ]),
  adult: new Set<Action>([
    'read:finance', 'write:transaction', 'write:budget_category',
    'write:pantry', 'write:shopping', 'delete:pantry',
    'write:chore', 'complete:chore',
    'write:asset', 'write:maintenance',
    'write:calendar', 'delete:calendar',
  ]),
  child: new Set<Action>([
    'write:pantry', 'write:shopping', 'complete:chore',
  ]),
  guest: new Set<Action>([]),
};

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 + 2 HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function resolveActiveMember(ctx: ValidatorContext): Promise<HouseholdMember> {
  const member = await ctx.db.findById<HouseholdMember>(Collections.MEMBERS, ctx.memberId);
  if (!member || !member.isActive) {
    throw new SpecViolationError(
      CoreErrorCodes.MISSING_MEMBER,
      'core',
      `Active member not found for id: ${ctx.memberId}`,
      { memberId: ctx.memberId },
    );
  }
  return member;
}

function assertPermission(member: HouseholdMember, action: Action): void {
  if (!ROLE_PERMISSIONS[member.role].has(action)) {
    throw new SpecViolationError(
      'CORE_PERMISSION_DENIED',
      'core',
      `Role '${member.role}' cannot perform '${action}'`,
      { role: member.role, action },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 5 HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function stampNew<T extends BaseEntity>(
  data: Omit<T, keyof BaseEntity | '_id'>,
  ctx: ValidatorContext,
  overrides: Partial<BaseEntity> = {},
): T {
  const id = uuidv4();
  const defaults = createEntityDefaults(ctx.clientId, ctx.memberId);
  return { _id: id, ...defaults, ...data, ...overrides } as T;
}

function stampUpdate<T extends BaseEntity>(
  existing: T,
  patch: Partial<T>,
  ctx: ValidatorContext,
): Partial<T> {
  return { ...patch, ...createUpdateStamp(existing._rev, ctx.memberId) };
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE VALIDATORS
// Each function runs Stages 3–4 for its module. Returns the final records
// to write. The caller (validate()) handles Stages 5–7.
// ─────────────────────────────────────────────────────────────────────────────

// ── FINANCE ──────────────────────────────────────────────────────────────────

export async function validateTransaction(
  input: Omit<Transaction, keyof BaseEntity | '_id'>,
  ctx: ValidatorContext,
): Promise<Transaction> {
  const member = await resolveActiveMember(ctx);
  assertPermission(member, 'write:transaction');

  // Stage 3 — Rule 1: type must match category type (SPEC-005)
  const category = await ctx.db.findById<BudgetCategory>(
    Collections.BUDGET_CATEGORIES,
    input.categoryId,
  );
  if (!category) {
    throw new SpecViolationError(
      FinanceErrorCodes.UNKNOWN_CATEGORY,
      'finance',
      `BudgetCategory not found: ${input.categoryId}`,
      { categoryId: input.categoryId },
    );
  }
  // credit → income category; debit → expense category (SPEC-005 Rule 1)
  const expectedCategoryType = input.type === 'credit' ? 'income' : 'expense';
  if (category.type !== expectedCategoryType) {
    throw new SpecViolationError(
      FinanceErrorCodes.TYPE_MISMATCH,
      'finance',
      `Transaction type '${input.type}' requires an '${expectedCategoryType}' category, but '${category.name}' is '${category.type}'`,
      { transactionType: input.type, categoryType: category.type, expectedCategoryType },
    );
  }

  // Stage 3 — Rule 2: budget variance check (SPEC-005)
  let isOverBudget = false;
  if (input.type === 'debit' && category.monthlyBudgetLimit !== undefined) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthSpend = await ctx.db.sumField(
      Collections.TRANSACTIONS,
      'amount',
      { categoryId: input.categoryId, type: 'debit', _deleted: false },
    );
    if (monthSpend + input.amount > category.monthlyBudgetLimit) {
      isOverBudget = true;
    }
  }

  // Stage 5 — stamp
  const record = stampNew<Transaction>({ ...input, isOverBudget }, ctx);

  // Stage 6 — write
  const saved = await ctx.db.insert(Collections.TRANSACTIONS, record);

  // Stage 4 — asset lifetimeCost (SPEC-005 Rule 3, ADR-003)
  if (input.linkedAssetId) {
    const asset = await ctx.db.findById<Asset>(Collections.ASSETS, input.linkedAssetId);
    if (asset) {
      await ctx.db.update<Asset>(
        Collections.ASSETS,
        asset._id,
        stampUpdate(asset, { lifetimeCost: asset.lifetimeCost + input.amount }, ctx),
      );
    }
  }

  // Stage 4 — pantry cost tracking (SPEC-005 Rule 4)
  if (input.linkedPantryItemId) {
    const item = await ctx.db.findById<PantryItem>(Collections.PANTRY_ITEMS, input.linkedPantryItemId);
    if (item) {
      const n = item.averageCost !== undefined ? 1 : 0;
      const oldAvg = item.averageCost ?? input.amount;
      const newAvg = n === 0 ? input.amount : (oldAvg * n + input.amount) / (n + 1);
      await ctx.db.update<PantryItem>(
        Collections.PANTRY_ITEMS,
        item._id,
        stampUpdate(item, {
          lastPurchasedAt: input.date,
          averageCost: Math.round(newAvg * 100) / 100,
        }, ctx),
      );
    }
  }

  // Stage 7 — budget notification
  if (isOverBudget) {
    ctx.notifications.queueBriefingItem(
      'amber',
      `${category.name} budget exceeded`,
      saved._id,
      Collections.TRANSACTIONS,
    );
  }

  return saved;
}

// ── PANTRY ───────────────────────────────────────────────────────────────────

export async function validatePantryItemUpdate(
  itemId: string,
  delta: number,
  ctx: ValidatorContext,
): Promise<PantryItem> {
  const member = await resolveActiveMember(ctx);
  assertPermission(member, 'write:pantry');

  const item = await ctx.db.findById<PantryItem>(Collections.PANTRY_ITEMS, itemId);
  if (!item) {
    throw new SpecViolationError(
      'PANTRY_NOT_FOUND',
      'pantry',
      `PantryItem not found: ${itemId}`,
      { itemId },
    );
  }

  // Stage 3 — Rule 1: negative quantity guard (SPEC-006)
  let newQty = item.quantity + delta;
  if (newQty < 0) {
    newQty = 0;
    ctx.notifications.queueBriefingItem(
      'amber',
      `${item.name} quantity clamped to 0`,
      item._id,
      Collections.PANTRY_ITEMS,
    );
    throw new SpecViolationError(
      PantryErrorCodes.NEGATIVE_QUANTITY,
      'pantry',
      `${item.name} quantity would go negative. Clamped to 0.`,
      { itemId, attempted: item.quantity + delta },
    );
  }

  // Stage 5 — stamp
  const patch = stampUpdate(item, { quantity: newQty }, ctx);

  // Stage 6 — write
  const saved = await ctx.db.update<PantryItem>(Collections.PANTRY_ITEMS, itemId, patch);

  // Stage 4 — par level trigger (SPEC-006 Rule 2)
  if (newQty <= item.parLevel) {
    await _ensureShoppingListItem(item, ctx);
  }

  // Stage 7 — expiry notification (checked at write time as well as briefing generation)
  if (item.expiryDate) {
    const hoursUntilExpiry = (new Date(item.expiryDate).getTime() - Date.now()) / 36e5;
    if (hoursUntilExpiry <= 48 && hoursUntilExpiry > 0) {
      ctx.notifications.queueBriefingItem(
        'red',
        `${item.name} expires in ${Math.ceil(hoursUntilExpiry)} hours`,
        item._id,
        Collections.PANTRY_ITEMS,
      );
    }
  }

  return saved;
}

export async function validatePantryItemCreate(
  input: Omit<PantryItem, keyof BaseEntity | '_id'>,
  ctx: ValidatorContext,
): Promise<PantryItem> {
  const member = await resolveActiveMember(ctx);
  assertPermission(member, 'write:pantry');

  // Stage 3 — quantity floor
  const safeInput = { ...input, quantity: Math.max(0, input.quantity) };

  // Stage 5 + 6
  const record = stampNew<PantryItem>(safeInput, ctx);
  const saved = await ctx.db.insert(Collections.PANTRY_ITEMS, record);

  // Stage 4 — par level trigger on creation too
  if (saved.quantity <= saved.parLevel) {
    await _ensureShoppingListItem(saved, ctx);
  }

  return saved;
}

export async function validateShoppingListItemStatus(
  itemId: string,
  status: ShoppingListItem['status'],
  ctx: ValidatorContext,
): Promise<ShoppingListItem> {
  const member = await resolveActiveMember(ctx);
  assertPermission(member, 'write:shopping');

  const item = await ctx.db.findById<ShoppingListItem>(Collections.SHOPPING_LIST, itemId);
  if (!item) {
    throw new SpecViolationError('PANTRY_SHOPPING_NOT_FOUND', 'pantry', `ShoppingListItem not found: ${itemId}`, { itemId });
  }

  const patch = stampUpdate(item, { status }, ctx);
  const saved = await ctx.db.update<ShoppingListItem>(Collections.SHOPPING_LIST, itemId, patch);

  // Stage 4 — restock pantry when purchased (SPEC-006 Rule 4)
  if (status === 'purchased' && item.sourcePantryItemId) {
    const pantryItem = await ctx.db.findById<PantryItem>(
      Collections.PANTRY_ITEMS,
      item.sourcePantryItemId,
    );
    if (pantryItem) {
      const newQty = pantryItem.quantity + item.quantity;
      await ctx.db.update<PantryItem>(
        Collections.PANTRY_ITEMS,
        pantryItem._id,
        stampUpdate(pantryItem, { quantity: newQty }, ctx),
      );
    }
  }

  return saved;
}

export async function validateShoppingListItemCreate(
  input: Omit<ShoppingListItem, keyof BaseEntity | '_id'>,
  ctx: ValidatorContext,
): Promise<ShoppingListItem> {
  const member = await resolveActiveMember(ctx);
  assertPermission(member, 'write:shopping');

  const safeInput = {
    ...input,
    quantity: Math.max(1, input.quantity),
    status: input.status ?? ('needed' as const),
  };

  const record = stampNew<ShoppingListItem>(safeInput, ctx);
  return ctx.db.insert(Collections.SHOPPING_LIST, record);
}

// Internal helper — Stage 4 side effect for par level trigger
async function _ensureShoppingListItem(item: PantryItem, ctx: ValidatorContext): Promise<void> {
  const existing = await ctx.db.findOne<ShoppingListItem>(Collections.SHOPPING_LIST, {
    sourcePantryItemId: item._id,
    status: 'needed',
    _deleted: false,
  } as Partial<ShoppingListItem>);

  if (!existing) {
    const shoppingItem = stampNew<ShoppingListItem>(
      {
        name: item.name,
        quantity: Math.max(1, item.parLevel),
        unit: item.unit,
        sourcePantryItemId: item._id,
        status: 'needed',
      },
      { ...ctx, memberId: SYSTEM_MEMBER_ID },
    );
    await ctx.db.insert(Collections.SHOPPING_LIST, shoppingItem);
  }
}

// ── ASSETS ───────────────────────────────────────────────────────────────────

export async function validateMaintenanceTaskCompletion(
  taskId: string,
  completionNote: string | undefined,
  ctx: ValidatorContext,
): Promise<MaintenanceTask> {
  const member = await resolveActiveMember(ctx);
  assertPermission(member, 'write:maintenance');

  const task = await ctx.db.findById<MaintenanceTask>(Collections.MAINTENANCE_TASKS, taskId);
  if (!task) {
    throw new SpecViolationError(
      AssetsErrorCodes.INVALID_ASSET_REF,
      'assets',
      `MaintenanceTask not found: ${taskId}`,
      { taskId },
    );
  }

  // Stage 3 — verify asset still exists (SPEC-008 Rule 5)
  const asset = await ctx.db.findById<Asset>(Collections.ASSETS, task.assetId);
  if (!asset || asset._deleted) {
    throw new SpecViolationError(
      AssetsErrorCodes.INVALID_ASSET_REF,
      'assets',
      `Asset ${task.assetId} is deleted; cannot complete its maintenance task`,
      { taskId, assetId: task.assetId },
    );
  }

  const now = new Date().toISOString();
  const patch = stampUpdate(task, {
    status: 'completed',
    lastCompletedAt: now,
    completionNote,
  }, ctx);
  const saved = await ctx.db.update<MaintenanceTask>(Collections.MAINTENANCE_TASKS, taskId, patch);

  // Stage 4 — reschedule if recurring (SPEC-008 Rule 1)
  if (task.frequencyDays) {
    const nextDue = new Date(Date.now() + task.frequencyDays * 864e5).toISOString();
    const next = stampNew<MaintenanceTask>(
      {
        assetId: task.assetId,
        title: task.title,
        instructions: task.instructions,
        frequencyDays: task.frequencyDays,
        nextDueAt: nextDue,
        status: 'pending',
        assignedTo: task.assignedTo,
      },
      { ...ctx, memberId: SYSTEM_MEMBER_ID },
    );
    await ctx.db.insert(Collections.MAINTENANCE_TASKS, next);
  }

  return saved;
}

export async function validateAssetSoftDelete(
  assetId: string,
  force: boolean,
  ctx: ValidatorContext,
): Promise<void> {
  const member = await resolveActiveMember(ctx);
  assertPermission(member, 'delete:asset');

  // Stage 3 — orphan guard (SPEC-008 Rule 4)
  if (!force) {
    const activeTasks = await ctx.db.findMany<MaintenanceTask>(
      Collections.MAINTENANCE_TASKS,
      { assetId, _deleted: false } as Partial<MaintenanceTask>,
    );
    const hasActive = activeTasks.some(t =>
      t.status === 'pending' || t.status === 'in_progress' || t.status === 'overdue',
    );
    if (hasActive) {
      throw new SpecViolationError(
        AssetsErrorCodes.HAS_ACTIVE_TASKS,
        'assets',
        `Asset ${assetId} has active maintenance tasks. Complete them first or pass force=true.`,
        { assetId, activeCount: activeTasks.length },
      );
    }
  } else {
    // Force: cascade soft-delete all tasks (SPEC-008 Rule 4 admin override)
    const tasks = await ctx.db.findMany<MaintenanceTask>(
      Collections.MAINTENANCE_TASKS,
      { assetId, _deleted: false } as Partial<MaintenanceTask>,
    );
    for (const t of tasks) {
      await ctx.db.softDelete(Collections.MAINTENANCE_TASKS, t._id, ctx.memberId);
    }
  }

  await ctx.db.softDelete(Collections.ASSETS, assetId, ctx.memberId);
}

// ── CHORES ───────────────────────────────────────────────────────────────────

export async function validateChoreCompletion(
  choreId: string,
  ctx: ValidatorContext,
): Promise<ChoreTask> {
  const member = await resolveActiveMember(ctx);

  const chore = await ctx.db.findById<ChoreTask>(Collections.CHORES, choreId);
  if (!chore) {
    throw new SpecViolationError('CHORE_NOT_FOUND', 'chores', `ChoreTask not found: ${choreId}`, { choreId });
  }

  // Stage 3 — child members can only complete their own chores (SPEC-007)
  if (member.role === 'child' && chore.assignedTo !== ctx.memberId) {
    throw new SpecViolationError(
      'CORE_PERMISSION_DENIED',
      'chores',
      'Child members can only complete their own assigned chores',
      { memberId: ctx.memberId, assignedTo: chore.assignedTo },
    );
  }
  assertPermission(member, 'complete:chore');

  // Stage 3 — Rule 1: idempotency guard (SPEC-007)
  if (chore.status === 'completed') {
    throw new SpecViolationError(
      ChoresErrorCodes.ALREADY_COMPLETED,
      'chores',
      `ChoreTask ${choreId} is already completed`,
      { choreId },
    );
  }

  const now = new Date().toISOString();
  const patch = stampUpdate(chore, { status: 'completed', completedAt: now }, ctx);
  const saved = await ctx.db.update<ChoreTask>(Collections.CHORES, choreId, patch);

  // Stage 4 — points award to assignedTo member (SPEC-007 Rule 3)
  // HouseholdMember uses its own schema (not BaseEntity), so we patch directly.
  const targetMemberId = chore.assignedTo ?? ctx.memberId;
  const assignee = await ctx.db.findById<HouseholdMember>(Collections.MEMBERS, targetMemberId);
  if (assignee) {
    const currentPoints = (assignee as HouseholdMember & { totalPoints?: number }).totalPoints ?? 0;
    await ctx.db.update<HouseholdMember>(
      Collections.MEMBERS,
      targetMemberId,
      {
        updatedAt: new Date().toISOString(),
        totalPoints: currentPoints + chore.pointValue,
      } as Partial<HouseholdMember>,
    );
  }

  // Stage 4 — recurrence (SPEC-007 Rule 2)
  if (chore.frequencyDays) {
    const nextDue = new Date(Date.now() + chore.frequencyDays * 864e5).toISOString();
    const next = stampNew<ChoreTask>(
      {
        title: chore.title,
        description: chore.description,
        assignedTo: chore.assignedTo,
        frequencyDays: chore.frequencyDays,
        pointValue: chore.pointValue,
        dueDate: nextDue,
        status: 'pending',
      },
      { ...ctx, memberId: SYSTEM_MEMBER_ID },
    );
    await ctx.db.insert(Collections.CHORES, next);
  }

  // Stage 4 — cascade soft-delete linked calendar event (SPEC-007 orphan rule)
  if (chore.linkedCalendarEventId) {
    await ctx.db.softDelete(Collections.CALENDAR, chore.linkedCalendarEventId, ctx.memberId);
  }

  return saved;
}

// ── CALENDAR ─────────────────────────────────────────────────────────────────

export async function validateCalendarEventCreate(
  input: Omit<CalendarEvent, keyof BaseEntity | '_id'>,
  ctx: ValidatorContext,
): Promise<CalendarEvent> {
  const member = await resolveActiveMember(ctx);
  assertPermission(member, 'write:calendar');

  // Stage 3 — Rule 1: date ordering (SPEC-009)
  if (input.endAt && input.startAt > input.endAt) {
    throw new SpecViolationError(
      CalendarErrorCodes.INVALID_DATE_RANGE,
      'calendar',
      `endAt (${input.endAt}) must be >= startAt (${input.startAt})`,
      { startAt: input.startAt, endAt: input.endAt },
    );
  }

  // Stage 3 — Rule 2: all-day consistency (SPEC-009)
  if (input.isAllDay) {
    const startMidnight = input.startAt.endsWith('T00:00:00.000Z');
    if (!startMidnight) {
      throw new SpecViolationError(
        CalendarErrorCodes.ALLDAY_TIME_MISMATCH,
        'calendar',
        `isAllDay=true requires startAt time to be 00:00:00.000Z, got ${input.startAt}`,
        { startAt: input.startAt },
      );
    }
  }

  // Stage 3 — Rule 3: attendee validation (SPEC-009)
  for (const attendeeId of input.attendees ?? []) {
    const attendee = await ctx.db.findById<HouseholdMember>(Collections.MEMBERS, attendeeId);
    if (!attendee || !attendee.isActive) {
      throw new SpecViolationError(
        CalendarErrorCodes.INVALID_ATTENDEE,
        'calendar',
        `Attendee ${attendeeId} not found or inactive`,
        { attendeeId },
      );
    }
  }

  const record = stampNew<CalendarEvent>(input, ctx);
  return ctx.db.insert(Collections.CALENDAR, record);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED DATA (SPEC-001 §6)
// Must be called once on first launch before any user writes.
// Idempotent — safe to call multiple times.
// ─────────────────────────────────────────────────────────────────────────────

export async function seedDatabase(db: DbAdapter, clientId: string): Promise<void> {
  const systemCtx: ValidatorContext = {
    memberId: SYSTEM_MEMBER_ID,
    clientId,
    db,
    notifications: { queueBriefingItem: () => {} },
  };

  // Seed system members (bypass role check — seeding is privileged)
  const now = new Date().toISOString();
  for (const [memberId, displayName] of [
    [SYSTEM_MEMBER_ID, 'System'],
    [UNKNOWN_MEMBER_ID, 'Imported'],
  ] as const) {
    const exists = await db.findById<HouseholdMember>(Collections.MEMBERS, memberId);
    if (!exists) {
      // HouseholdMember has its own schema (not BaseEntity) — insert directly
      await db.insert<HouseholdMember>(Collections.MEMBERS, {
        _id: memberId,
        displayName,
        role: 'admin',
        deviceIds: [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      } as HouseholdMember);
    }
  }

  // Seed default budget categories (SPEC-001 §4.1)
  const { DEFAULT_BUDGET_CATEGORIES } = await import('@homeos/schemas');
  for (const cat of DEFAULT_BUDGET_CATEGORIES) {
    const existing = await db.findOne<BudgetCategory>(
      Collections.BUDGET_CATEGORIES,
      { name: cat.name } as Partial<BudgetCategory>,
    );
    if (!existing) {
      const record = stampNew<BudgetCategory>(
        { ...cat, iconColor: undefined, monthlyBudgetLimit: undefined },
        systemCtx,
      );
      await db.insert(Collections.BUDGET_CATEGORIES, record);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MORNING BRIEFING QUERY (SPEC-000 §7, SPEC-013 §5)
// Runs entirely from local SQLite — no network required.
// ─────────────────────────────────────────────────────────────────────────────

export interface BriefingItem {
  priority: 'red' | 'amber' | 'yellow' | 'green';
  message: string;
  entityId: string;
  collection: string;
}

export async function generateMorningBriefing(
  db: DbAdapter,
  memberId: string,
): Promise<BriefingItem[]> {
  const items: BriefingItem[] = [];
  const now = Date.now();
  const day7 = new Date(now + 7 * 864e5).toISOString();
  const day30 = new Date(now + 30 * 864e5).toISOString();
  const hour48 = new Date(now + 48 * 36e5).toISOString();
  const todayEnd = new Date(new Date().setHours(23, 59, 59, 999)).toISOString();

  // 🔴 Overdue maintenance tasks (SPEC-008)
  const overdueTasks = await db.findMany<MaintenanceTask>(
    Collections.MAINTENANCE_TASKS,
    { status: 'overdue', _deleted: false } as Partial<MaintenanceTask>,
  );
  for (const t of overdueTasks) {
    items.push({ priority: 'red', message: `${t.title} is overdue`, entityId: t._id, collection: Collections.MAINTENANCE_TASKS });
  }

  // 🔴 Expiring pantry items within 48h (SPEC-006)
  const allPantry = await db.findMany<PantryItem>(Collections.PANTRY_ITEMS, { _deleted: false } as Partial<PantryItem>);
  for (const p of allPantry) {
    if (p.expiryDate && p.expiryDate <= hour48) {
      const hoursLeft = Math.ceil((new Date(p.expiryDate).getTime() - now) / 36e5);
      items.push({ priority: 'red', message: `${p.name} expires in ${hoursLeft}h`, entityId: p._id, collection: Collections.PANTRY_ITEMS });
    }
  }

  // 🟠 Items below par level not yet on shopping list (SPEC-006)
  for (const p of allPantry) {
    if (p.quantity <= p.parLevel) {
      const onList = await db.findOne<ShoppingListItem>(
        Collections.SHOPPING_LIST,
        { sourcePantryItemId: p._id, status: 'needed', _deleted: false } as Partial<ShoppingListItem>,
      );
      if (!onList) {
        items.push({ priority: 'amber', message: `${p.name} is running low`, entityId: p._id, collection: Collections.PANTRY_ITEMS });
      }
    }
  }

  // 🟠 Budget categories over 90% (SPEC-005)
  const categories = await db.findMany<BudgetCategory>(Collections.BUDGET_CATEGORIES, { _deleted: false } as Partial<BudgetCategory>);
  for (const cat of categories) {
    if (cat.monthlyBudgetLimit) {
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
      const spent = await db.sumField(Collections.TRANSACTIONS, 'amount', {
        categoryId: cat._id, type: 'debit', _deleted: false,
      });
      if (spent / cat.monthlyBudgetLimit >= 0.9) {
        items.push({ priority: 'amber', message: `${cat.name} budget is at ${Math.round(spent / cat.monthlyBudgetLimit * 100)}%`, entityId: cat._id, collection: Collections.BUDGET_CATEGORIES });
      }
    }
  }

  // 🟡 Maintenance tasks due within 7 days (SPEC-008)
  const upcomingTasks = await db.findMany<MaintenanceTask>(
    Collections.MAINTENANCE_TASKS,
    { status: 'pending', _deleted: false } as Partial<MaintenanceTask>,
  );
  for (const t of upcomingTasks) {
    if (t.nextDueAt && t.nextDueAt <= day7) {
      items.push({ priority: 'yellow', message: `${t.title} due soon`, entityId: t._id, collection: Collections.MAINTENANCE_TASKS });
    }
  }

  // 🟡 Warranties expiring within 30 days (SPEC-008)
  const assets = await db.findMany<Asset>(Collections.ASSETS, { _deleted: false } as Partial<Asset>);
  for (const a of assets) {
    if (a.warrantyExpiryDate && a.warrantyExpiryDate <= day30) {
      items.push({ priority: 'yellow', message: `${a.name} warranty expires soon`, entityId: a._id, collection: Collections.ASSETS });
    }
  }

  // 🟢 Chores assigned to this member due today (SPEC-007)
  const chores = await db.findMany<ChoreTask>(Collections.CHORES, { _deleted: false } as Partial<ChoreTask>);
  for (const c of chores) {
    if (c.assignedTo === memberId && c.status === 'pending' && c.dueDate && c.dueDate <= todayEnd) {
      items.push({ priority: 'green', message: `${c.title} is due today`, entityId: c._id, collection: Collections.CHORES });
    }
  }

  // Sort: red → amber → yellow → green
  const order = { red: 0, amber: 1, yellow: 2, green: 3 };
  return items.sort((a, b) => order[a.priority] - order[b.priority]);
}
