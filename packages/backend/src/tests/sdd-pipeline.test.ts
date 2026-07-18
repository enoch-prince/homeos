/**
 * @file sdd-pipeline.test.ts
 * @description HomeOS — SDD Pipeline Test Suite
 *
 * Five primary voice command scenarios from SPEC-013, each proving
 * that the validator correctly executes cross-module automations.
 * Plus targeted edge-case tests for every SpecViolationError code.
 *
 * Test philosophy:
 *   - No network. No filesystem. Pure in-memory.
 *   - Every test seeds exactly the state it needs (no shared mutable state).
 *   - Assertions target DB state after the call, not internal implementation.
 *   - Error tests assert the exact error code, not just the message.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryDb } from '../testing/mock-db.js';
import { IDs, MEMBERS, BUDGET_CATEGORIES, PANTRY_ITEMS, ASSETS, MAINTENANCE_TASKS, CHORES } from '../testing/fixtures.js';
import {
  Collections,
  type ValidatorContext,
  type NotificationAdapter,
  validateTransaction,
  validatePantryItemUpdate,
  validatePantryItemCreate,
  validateShoppingListItemStatus,
  validateMaintenanceTaskCompletion,
  validateAssetSoftDelete,
  validateChoreCompletion,
  validateCalendarEventCreate,
  generateMorningBriefing,
} from '../middleware/validator.js';
import type { PantryItem, ShoppingListItem, Asset, MaintenanceTask, ChoreTask, HouseholdMember } from '@homeos/schemas';

// ─────────────────────────────────────────────────────────────────────────────
// TEST SETUP
// ─────────────────────────────────────────────────────────────────────────────

function makeNotifications(): NotificationAdapter & { calls: Array<Parameters<NotificationAdapter['queueBriefingItem']>> } {
  const calls: Array<Parameters<NotificationAdapter['queueBriefingItem']>> = [];
  return {
    calls,
    queueBriefingItem: vi.fn((...args: Parameters<NotificationAdapter['queueBriefingItem']>) => {
      calls.push(args);
    }),
  };
}

function makeCtx(db: InMemoryDb, memberId: string = IDs.MEMBER_ADMIN): ValidatorContext & { notifications: ReturnType<typeof makeNotifications> } {
  const notifications = makeNotifications();
  return { memberId, clientId: IDs.CLIENT, db, notifications };
}

function seedAll(db: InMemoryDb): void {
  for (const m of MEMBERS) db.seed(Collections.MEMBERS, m);
  for (const c of BUDGET_CATEGORIES) db.seed(Collections.BUDGET_CATEGORIES, c);
  for (const p of PANTRY_ITEMS) db.seed(Collections.PANTRY_ITEMS, p);
  for (const a of ASSETS) db.seed(Collections.ASSETS, a);
  for (const t of MAINTENANCE_TASKS) db.seed(Collections.MAINTENANCE_TASKS, t);
  for (const ch of CHORES) db.seed(Collections.CHORES, ch);
}

let db: InMemoryDb;
beforeEach(() => {
  db = new InMemoryDb();
  db.reset();
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 1 — "Used 2 eggs"
// Voice: UPDATE_PANTRY (subtract)
// Expected:
//   ✓ Eggs quantity: 6 → 4
//   ✓ 4 <= parLevel(6) → ShoppingListItem auto-created by SYSTEM_MEMBER_ID
//   ✓ Shopping item has sourcePantryItemId = EGGS
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 1 — "Used 2 eggs" → par level triggers shopping list', () => {
  it('decrements egg quantity and auto-creates a shopping list item', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    await validatePantryItemUpdate(IDs.EGGS, -2, ctx);

    // Egg quantity updated
    const eggs = await db.findById<PantryItem>(Collections.PANTRY_ITEMS, IDs.EGGS);
    expect(eggs?.quantity).toBe(4);

    // par level is 6; 4 <= 6 → shopping item must exist
    const shoppingItems = db.all<ShoppingListItem>(Collections.SHOPPING_LIST);
    expect(shoppingItems).toHaveLength(1);

    const item = shoppingItems[0];
    expect(item.sourcePantryItemId).toBe(IDs.EGGS);
    expect(item.status).toBe('needed');
    expect(item.name).toBe('Eggs');
    expect(item.createdBy).toBe('00000000-0000-0000-0000-000000000001'); // SYSTEM_MEMBER_ID
  });

  it('does NOT create a duplicate shopping item if one already exists', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    // First subtract — creates shopping item
    await validatePantryItemUpdate(IDs.EGGS, -2, ctx);
    // Second subtract — should NOT create another
    await validatePantryItemUpdate(IDs.EGGS, -1, ctx);

    expect(db.count(Collections.SHOPPING_LIST)).toBe(1);
  });

  it('restocks pantry when shopping item is marked purchased', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    await validatePantryItemUpdate(IDs.EGGS, -2, ctx);

    const shoppingItem = db.all<ShoppingListItem>(Collections.SHOPPING_LIST)[0];
    await validateShoppingListItemStatus(shoppingItem._id, 'purchased', ctx);

    // Pantry should be restocked by shopping item quantity
    const eggs = await db.findById<PantryItem>(Collections.PANTRY_ITEMS, IDs.EGGS);
    // Started at 4 (after -2), restock by shoppingItem.quantity (= max(1, parLevel=6) = 6)
    expect(eggs?.quantity).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 2 — "Spent $45 on groceries"
// Voice: LOG_EXPENSE
// Expected:
//   ✓ Transaction created with type: debit, categoryId: CAT_GROCERIES
//   ✓ isOverBudget: false (45 < 500 limit)
//   ✓ No notification queued
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 2 — "Spent $45 on groceries" → transaction logged', () => {
  it('creates a debit transaction in the correct category', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    const tx = await validateTransaction({
      amount: 45,
      type: 'debit',
      categoryId: IDs.CAT_GROCERIES,
      date: new Date().toISOString(),
      note: 'weekly shop',
      isOverBudget: false,
    }, ctx);

    expect(tx.amount).toBe(45);
    expect(tx.type).toBe('debit');
    expect(tx.categoryId).toBe(IDs.CAT_GROCERIES);
    expect(tx.isOverBudget).toBe(false);
    expect(ctx.notifications.calls).toHaveLength(0);
  });

  it('sets isOverBudget:true and queues notification when limit is exceeded', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    // Pre-load $480 spend (just under $500 limit)
    await validateTransaction({
      amount: 480,
      type: 'debit',
      categoryId: IDs.CAT_GROCERIES,
      date: new Date().toISOString(),
      isOverBudget: false,
    }, ctx);

    // This $30 pushes to $510 — over $500 limit
    const ctx2 = makeCtx(db);
    const overTx = await validateTransaction({
      amount: 30,
      type: 'debit',
      categoryId: IDs.CAT_GROCERIES,
      date: new Date().toISOString(),
      isOverBudget: false,
    }, ctx2);

    expect(overTx.isOverBudget).toBe(true);
    expect(ctx2.notifications.calls).toHaveLength(1);
    expect(ctx2.notifications.calls[0][0]).toBe('amber');
    expect(ctx2.notifications.calls[0][1]).toContain('Groceries');
  });

  it('rejects a debit transaction into an income category (FINANCE_TYPE_MISMATCH)', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    await expect(
      validateTransaction({
        amount: 100,
        type: 'debit',
        categoryId: IDs.CAT_INCOME,        // income category!
        date: new Date().toISOString(),
        isOverBudget: false,
      }, ctx),
    ).rejects.toThrow(expect.objectContaining({
      code: 'FINANCE_TYPE_MISMATCH',
    }));
  });

  it('increments Asset.lifetimeCost when linkedAssetId is set (SPEC-005 Rule 3)', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    await validateTransaction({
      amount: 250,
      type: 'debit',
      categoryId: IDs.CAT_HOME_REPAIR,
      date: new Date().toISOString(),
      linkedAssetId: IDs.DISHWASHER,
      isOverBudget: false,
    }, ctx);

    const dishwasher = await db.findById<Asset>(Collections.ASSETS, IDs.DISHWASHER);
    // Was 800, now 800 + 250 = 1050
    expect(dishwasher?.lifetimeCost).toBe(1050);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 3 — "Changed the HVAC filter for $30"
// Voice: LOG_MAINTENANCE + LOG_EXPENSE (multi-intent, SPEC-013 §2)
// Expected:
//   ✓ HVAC_FILTER task marked completed
//   ✓ New recurring task created (frequencyDays: 90)
//   ✓ Transaction logged: $30 debit to Home Repair
//   ✓ HVAC.lifetimeCost += 30
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 3 — "Changed HVAC filter for $30" → maintenance + expense', () => {
  it('completes the task and generates the next recurrence', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    await validateMaintenanceTaskCompletion(IDs.HVAC_FILTER, 'Used Filtrete 1500 MPR', ctx);

    // Original task completed
    const original = await db.findById<MaintenanceTask>(Collections.MAINTENANCE_TASKS, IDs.HVAC_FILTER);
    expect(original?.status).toBe('completed');
    expect(original?.completionNote).toBe('Used Filtrete 1500 MPR');
    expect(original?.lastCompletedAt).toBeDefined();

    // Next recurrence created
    const allTasks = db.all<MaintenanceTask>(Collections.MAINTENANCE_TASKS);
    const nextTask = allTasks.find(t => t._id !== IDs.HVAC_FILTER);
    expect(nextTask).toBeDefined();
    expect(nextTask?.status).toBe('pending');
    expect(nextTask?.assetId).toBe(IDs.HVAC);
    expect(nextTask?.frequencyDays).toBe(90);
    expect(nextTask?.createdBy).toBe('00000000-0000-0000-0000-000000000001'); // SYSTEM_MEMBER_ID

    // Next due date is ~90 days from now
    const nextDue = new Date(nextTask!.nextDueAt!).getTime();
    const expected = Date.now() + 90 * 864e5;
    expect(Math.abs(nextDue - expected)).toBeLessThan(5000); // within 5s tolerance
  });

  it('links expense to asset and increments lifetimeCost', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    // Maintenance first (establishes asset context)
    await validateMaintenanceTaskCompletion(IDs.HVAC_FILTER, undefined, ctx);

    // Then expense linked to HVAC
    await validateTransaction({
      amount: 30,
      type: 'debit',
      categoryId: IDs.CAT_HOME_REPAIR,
      date: new Date().toISOString(),
      linkedAssetId: IDs.HVAC,
      isOverBudget: false,
    }, ctx);

    const hvac = await db.findById<Asset>(Collections.ASSETS, IDs.HVAC);
    // HVAC started at lifetimeCost: 0
    expect(hvac?.lifetimeCost).toBe(30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 4 — "Ran out of milk"
// Voice: UPDATE_PANTRY (subtract to 0, negative guard)
// Expected:
//   ✓ Milk clamped to 0 (not negative)
//   ✓ PANTRY_NEGATIVE_QUANTITY thrown
//   ✓ Notification queued for the clamp event
//   ✓ Shopping list item still created (par level check on clamped value)
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 4 — "Ran out of milk" → negative quantity guard', () => {
  it('clamps to 0 and throws PANTRY_NEGATIVE_QUANTITY when quantity goes negative', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    // Milk starts at quantity=2, subtract 5 → would be -3
    await expect(
      validatePantryItemUpdate(IDs.MILK, -5, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'PANTRY_NEGATIVE_QUANTITY' }),
    );

    // Notification was queued for the clamp
    expect(ctx.notifications.calls.some(c => c[1].includes('Milk'))).toBe(true);
  });

  it('queues expiry notification for items expiring within 48h', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    // Bread has expiryDate 24h from now — subtract 0 (touch the record)
    // We can't subtract 0 (no-op) so create a fresh item with expiry
    const expiringItem = db.seed<PantryItem>(Collections.PANTRY_ITEMS, {
      ...(PANTRY_ITEMS[0]),
      _id: 'expiring-item-id',
      name: 'Yoghurt',
      quantity: 3,
      parLevel: 0,
      expiryDate: new Date(Date.now() + 20 * 36e5).toISOString(), // 20 hours
    });

    await validatePantryItemUpdate(expiringItem._id, -1, ctx);

    const expiryNotifs = ctx.notifications.calls.filter(c => c[0] === 'red' && c[1].includes('Yoghurt'));
    expect(expiryNotifs).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIO 5 — "Finished the dishes"
// Voice: COMPLETE_CHORE
// Expected:
//   ✓ Dishes chore marked completed
//   ✓ completedAt set to now
//   ✓ Child member (Sam) awarded 3 points
//   ✓ No recurrence (no frequencyDays on DISHES)
// ─────────────────────────────────────────────────────────────────────────────

describe('Scenario 5 — "Finished the dishes" → chore completion + points', () => {
  it('marks chore completed and awards points to the assigned child', async () => {
    seedAll(db);
    // Complete as the child who owns the chore
    const ctx = makeCtx(db, IDs.MEMBER_CHILD);

    await validateChoreCompletion(IDs.DISHES, ctx);

    const chore = await db.findById<ChoreTask>(Collections.CHORES, IDs.DISHES);
    expect(chore?.status).toBe('completed');
    expect(chore?.completedAt).toBeDefined();

    // Child member gets 3 points
    const child = await db.findById<HouseholdMember & { totalPoints?: number }>(
      Collections.MEMBERS,
      IDs.MEMBER_CHILD,
    );
    expect(child?.totalPoints).toBe(3);
  });

  it('creates next recurrence for a recurring chore (vacuum, 7-day cycle)', async () => {
    seedAll(db);
    const ctx = makeCtx(db, IDs.MEMBER_ADULT);

    await validateChoreCompletion(IDs.VACUUM, ctx);

    // Original completed
    const original = await db.findById<ChoreTask>(Collections.CHORES, IDs.VACUUM);
    expect(original?.status).toBe('completed');

    // Next recurrence exists
    const allChores = db.all<ChoreTask>(Collections.CHORES);
    const next = allChores.find(c => c._id !== IDs.VACUUM && c.title === 'Vacuum living room');
    expect(next).toBeDefined();
    expect(next?.status).toBe('pending');
    expect(next?.frequencyDays).toBe(7);
    expect(next?.createdBy).toBe('00000000-0000-0000-0000-000000000001'); // SYSTEM_MEMBER_ID

    // Due date ~7 days from now
    const nextDue = new Date(next!.dueDate!).getTime();
    expect(Math.abs(nextDue - (Date.now() + 7 * 864e5))).toBeLessThan(5000);
  });

  it('blocks a child from completing another member\'s chore', async () => {
    seedAll(db);
    // Child tries to complete VACUUM which is assigned to MEMBER_ADULT
    const ctx = makeCtx(db, IDs.MEMBER_CHILD);

    await expect(
      validateChoreCompletion(IDs.VACUUM, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'CORE_PERMISSION_DENIED' }),
    );
  });

  it('throws CHORE_ALREADY_COMPLETED on duplicate completion', async () => {
    seedAll(db);
    const ctx = makeCtx(db, IDs.MEMBER_ADULT);

    await validateChoreCompletion(IDs.VACUUM, ctx);

    await expect(
      validateChoreCompletion(IDs.VACUUM, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'CHORE_ALREADY_COMPLETED' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ORPHAN PREVENTION TESTS (SPEC-008)
// ─────────────────────────────────────────────────────────────────────────────

describe('Orphan prevention — assets with active tasks', () => {
  it('blocks soft-delete of an asset with pending tasks', async () => {
    seedAll(db);
    const ctx = makeCtx(db); // admin

    await expect(
      validateAssetSoftDelete(IDs.HVAC, false, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'ASSETS_HAS_ACTIVE_TASKS' }),
    );

    // Asset still exists (not deleted)
    const hvac = await db.findById<Asset>(Collections.ASSETS, IDs.HVAC);
    expect(hvac?._deleted).toBe(false);
  });

  it('allows force-delete: cascades soft-delete to all tasks first', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    await validateAssetSoftDelete(IDs.HVAC, true, ctx);

    // Asset soft-deleted
    const hvac = await db.findById<Asset>(Collections.ASSETS, IDs.HVAC);
    expect(hvac?._deleted).toBe(true);

    // Task also soft-deleted
    const task = await db.findById<MaintenanceTask>(Collections.MAINTENANCE_TASKS, IDs.HVAC_FILTER);
    expect(task?._deleted).toBe(true);
  });

  it('blocks asset delete by non-admin roles', async () => {
    seedAll(db);
    const ctx = makeCtx(db, IDs.MEMBER_ADULT); // adult, not admin

    await expect(
      validateAssetSoftDelete(IDs.DISHWASHER, false, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'CORE_PERMISSION_DENIED' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR VALIDATION TESTS (SPEC-009)
// ─────────────────────────────────────────────────────────────────────────────

describe('Calendar event validation', () => {
  it('creates a valid calendar event', async () => {
    seedAll(db);
    const ctx = makeCtx(db);
    const start = '2026-09-01T09:00:00.000Z';
    const end = '2026-09-01T10:00:00.000Z';

    const event = await validateCalendarEventCreate({
      title: 'HVAC service appointment',
      startAt: start,
      endAt: end,
      isAllDay: false,
      attendees: [IDs.MEMBER_ADMIN],
    }, ctx);

    expect(event.title).toBe('HVAC service appointment');
    expect(event._id).toBeDefined();
  });

  it('rejects endAt before startAt (CALENDAR_INVALID_DATE_RANGE)', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    await expect(
      validateCalendarEventCreate({
        title: 'Bad event',
        startAt: '2026-09-01T10:00:00.000Z',
        endAt: '2026-09-01T09:00:00.000Z', // before start
        isAllDay: false,
        attendees: [],
      }, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'CALENDAR_INVALID_DATE_RANGE' }),
    );
  });

  it('rejects isAllDay with non-midnight startAt (CALENDAR_ALLDAY_TIME_MISMATCH)', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    await expect(
      validateCalendarEventCreate({
        title: 'All day event with bad time',
        startAt: '2026-09-01T09:00:00.000Z', // should be 00:00:00.000Z
        isAllDay: true,
        attendees: [],
      }, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'CALENDAR_ALLDAY_TIME_MISMATCH' }),
    );
  });

  it('rejects an invalid attendee UUID (CALENDAR_INVALID_ATTENDEE)', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    await expect(
      validateCalendarEventCreate({
        title: 'Event with ghost attendee',
        startAt: '2026-09-01T09:00:00.000Z',
        isAllDay: false,
        attendees: ['00000000-0000-0000-0000-999999999999'], // doesn't exist
      }, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'CALENDAR_INVALID_ATTENDEE' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MORNING BRIEFING (SPEC-013 §5)
// ─────────────────────────────────────────────────────────────────────────────

describe('Morning Briefing generation', () => {
  it('returns a priority-sorted briefing with all expected items', async () => {
    seedAll(db);

    const items = await generateMorningBriefing(db, IDs.MEMBER_ADMIN);

    // Should contain at least:
    //   🟡 Dishwasher warranty expiring in 20 days
    //   🟢 Vacuum chore due today (assigned to MEMBER_ADULT, not ADMIN — won't appear for admin)

    const warrantyItem = items.find(i => i.message.includes('Dishwasher'));
    expect(warrantyItem).toBeDefined();
    expect(warrantyItem?.priority).toBe('yellow');

    // Bread expires in 24h — should be red
    const breadItem = items.find(i => i.message.includes('Bread'));
    expect(breadItem).toBeDefined();
    expect(breadItem?.priority).toBe('red');

    // Red items come before yellow
    const redIdx = items.findIndex(i => i.priority === 'red');
    const yellowIdx = items.findIndex(i => i.priority === 'yellow');
    if (redIdx !== -1 && yellowIdx !== -1) {
      expect(redIdx).toBeLessThan(yellowIdx);
    }
  });

  it('returns chores due today for the requesting member', async () => {
    seedAll(db);

    // Request briefing as MEMBER_ADULT who has VACUUM due today
    const items = await generateMorningBriefing(db, IDs.MEMBER_ADULT);

    const choreItem = items.find(i => i.message.includes('Vacuum') && i.priority === 'green');
    expect(choreItem).toBeDefined();
  });

  it('returns empty array when no items require attention', async () => {
    // Seed only a healthy pantry item and no overdue tasks
    db.seed(Collections.MEMBERS, MEMBERS[1]); // just admin
    db.seed(Collections.PANTRY_ITEMS, {
      ...PANTRY_ITEMS[0], // Milk, qty=2, parLevel=1, no expiry
      _id: 'healthy-milk',
      expiryDate: undefined,
    });

    const items = await generateMorningBriefing(db, IDs.MEMBER_ADMIN);
    expect(items).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION SYSTEM (SPEC-000 §4.3)
// ─────────────────────────────────────────────────────────────────────────────

describe('Role-based access control', () => {
  it('blocks a guest from writing to the pantry', async () => {
    seedAll(db);
    // Seed a guest member
    db.seed(Collections.MEMBERS, {
      _id: 'guest-id-000',
      displayName: 'Guest',
      role: 'guest' as const,
      deviceIds: [],
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const ctx = makeCtx(db, 'guest-id-000');

    await expect(
      validatePantryItemUpdate(IDs.MILK, -1, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'CORE_PERMISSION_DENIED' }),
    );
  });

  it('blocks a child from logging a financial transaction', async () => {
    seedAll(db);
    const ctx = makeCtx(db, IDs.MEMBER_CHILD);

    await expect(
      validateTransaction({
        amount: 10,
        type: 'debit',
        categoryId: IDs.CAT_GROCERIES,
        date: new Date().toISOString(),
        isOverBudget: false,
      }, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'CORE_PERMISSION_DENIED' }),
    );
  });

  it('throws CORE_MISSING_MEMBER for an unknown memberId', async () => {
    seedAll(db);
    const ctx = makeCtx(db, '00000000-dead-beef-0000-000000000000');

    await expect(
      validatePantryItemUpdate(IDs.MILK, -1, ctx),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'CORE_MISSING_MEMBER' }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WRITE STAMP INTEGRITY
// Proves BaseEntity fields are always correctly populated (SPEC-000 §4.1 Stage 5)
// ─────────────────────────────────────────────────────────────────────────────

describe('Write stamp integrity', () => {
  it('new records have _id, syncStatus:pending, createdBy set correctly', async () => {
    seedAll(db);
    const ctx = makeCtx(db, IDs.MEMBER_ADULT);

    const item = await validatePantryItemCreate({
      name: 'Oat Milk',
      quantity: 2,
      unit: 'L',
      location: 'Fridge',
      parLevel: 1,
    }, ctx);

    expect(item._id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    ); // UUID v4
    expect(item.syncStatus).toBe('pending');
    expect(item.createdBy).toBe(IDs.MEMBER_ADULT);
    expect(item.updatedBy).toBe(IDs.MEMBER_ADULT);
    expect(item._rev).toBe(1);
    expect(item._deleted).toBe(false);
  });

  it('updates increment _rev and reset syncStatus to pending', async () => {
    seedAll(db);
    const ctx = makeCtx(db);

    // First update
    await validatePantryItemUpdate(IDs.MILK, -1, ctx);
    const after1 = await db.findById<PantryItem>(Collections.PANTRY_ITEMS, IDs.MILK);
    expect(after1?._rev).toBe(2);
    expect(after1?.syncStatus).toBe('pending');

    // Second update
    await validatePantryItemUpdate(IDs.MILK, -0, ctx);
    const after2 = await db.findById<PantryItem>(Collections.PANTRY_ITEMS, IDs.MILK);
    expect(after2?._rev).toBe(3);
  });
});
