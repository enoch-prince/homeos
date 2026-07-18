# SPEC-013 — Cross-Module Workflows

**Version:** 0.1.0 | **Status:** Draft | **Depends on:** SPEC-005 through SPEC-009

---

## 1. Purpose

This spec documents the complete cross-module automation chains — the "Odoo magic" that makes HomeOS more than a collection of individual apps. Each workflow is a sequence of validator side effects that span multiple collections.

---

## 2. Workflow: Grocery Run

**Trigger:** `ShoppingListItem.status` transitions to `purchased`

```
ShoppingListItem.purchased
    ↓
[pantry] If sourcePantryItemId set:
    PantryItem.quantity += ShoppingListItem.quantity
    PantryItem.lastPurchasedAt = now()
    ↓
[finance] If user logs expense in same session:
    Transaction created with linkedPantryItemId
    PantryItem.averageCost recalculated
    BudgetCategory.monthlySpend checked against limit
```

**Voice path:** *"Bought milk for $4"*
→ `UPDATE_PANTRY (add)` + `LOG_EXPENSE`
→ 2 writes, 3 side effects, 1 voice confirmation

---

## 3. Workflow: Maintenance Completion

**Trigger:** `LOG_MAINTENANCE` voice intent or manual completion

```
MaintenanceTask.status → completed
    ↓
[assets] lastCompletedAt = now()
         If frequencyDays set: nextDueAt = now() + frequencyDays
         status reset to 'pending' (new record for next cycle)
    ↓
[calendar] If linkedCalendarEventId set:
    CalendarEvent updated with new startAt = nextDueAt
    ↓
[finance] If user adds expense:
    Transaction.linkedAssetId set
    Asset.lifetimeCost += amount
```

---

## 4. Workflow: Stock Depletion Alert

**Trigger:** `PantryItem.quantity` drops to or below `parLevel`

```
PantryItem.quantity <= parLevel
    ↓
[pantry validator] Check: ShoppingListItem with status:'needed'
                          AND same item name exists?
    ├─ YES → no action (already on list)
    └─ NO  → create ShoppingListItem:
               name: PantryItem.name
               quantity: max(1, parLevel)
               unit: PantryItem.unit
               sourcePantryItemId: PantryItem._id
               status: 'needed'
               createdBy: SYSTEM_MEMBER_ID
    ↓
Morning Briefing: "[item] is running low — added to shopping list"
```

---

## 5. Workflow: Morning Briefing Generation

**Trigger:** Daily at user-configured time (default 07:00 local). Generated locally from SQLite — no network required.

```
Query 1: MaintenanceTask WHERE status = 'overdue'             → 🔴 priority
Query 2: PantryItem WHERE expiryDate < now() + 48h            → 🔴 priority
Query 3: PantryItem WHERE quantity <= parLevel
          AND no 'needed' ShoppingListItem exists              → 🟠 priority
Query 4: BudgetCategory WHERE monthlySpend > 0.9 * limit      → 🟠 priority
Query 5: MaintenanceTask WHERE nextDueAt < now() + 7d         → 🟡 priority
Query 6: Asset WHERE warrantyExpiryDate < now() + 30d         → 🟡 priority
Query 7: ChoreTask WHERE assignedTo = currentMember
          AND dueDate = today                                  → 🟢 priority
    ↓
Assemble TTS string (≤ 150 words)
Dispatch push notification with summary
Deep-link map: each item links to its entity in its module
```

---

## 6. Workflow: Chore Recurrence

**Trigger:** `ChoreTask.status` transitions to `completed` AND `frequencyDays` is set

```
ChoreTask completed
    ↓
[chores] Create new ChoreTask:
    title, description, assignedTo, frequencyDays, pointValue — copied
    dueDate = completedAt + frequencyDays
    status = 'pending'
    createdBy = SYSTEM_MEMBER_ID
    ↓
[calendar] If original had linkedCalendarEventId:
    Create new CalendarEvent with startAt = new dueDate
    Link to new ChoreTask
```

---

## 7. Workflow: New Household Member Onboarding

**Trigger:** Admin creates a new `HouseholdMember`

```
HouseholdMember created
    ↓
[core] Seed member's device binding (deviceIds: [])
       totalPoints: 0
    ↓
[chores] Query unassigned recurring ChoreTask records
         Surface to admin: "Assign chores to [name]?"
    ↓
[calendar] Add member to all-household events (attendees[])
           where attendees currently contains all active adults
```

---

## 8. Inter-Module Dependency Guard

The validator enforces this dependency order for any single request that touches multiple modules. If a later step fails, earlier steps are **not** rolled back (syncflow-db has no multi-collection transactions — see SPEC-002 §5.3). The validator logs the partial failure as `CORE_SIDE_EFFECT_FAILED` and retries the failed step on next app launch.

```
Priority order (lower = runs first):
  1. core        (member lookup, auth)
  2. pantry      (item state)
  3. assets      (asset state)
  4. finance     (transactions — always last; depends on asset/pantry IDs)
  5. chores      (independent)
  6. calendar    (independent; links to chores/assets)
```
