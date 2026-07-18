# SPEC-001 — Data Model & Collections

**Version:** 0.1.0  
**Status:** Draft  
**Depends on:** SPEC-000  
**Last Updated:** 2026-06-14

---

## 1. Purpose

This spec is the single source of truth for the HomeOS entity graph. It defines every collection name, every entity's fields, and every cross-module relationship for v1. Module specs (SPEC-005 through SPEC-009) reference this document — they do not redefine entities.

---

## 2. Entity Dependency Graph (DAG)

Reading direction: an arrow means "depends on / references".

```
core_household_members
        ↑
        │ (createdBy, updatedBy, assignedTo)
        │
  ┌─────┴──────────────────────────────┐
  │                                    │
pantry_items ←──────── finance_transactions
  │                          │
  │ (triggers)               │ (linkedAssetId)
  ↓                          ↓
pantry_shopping_list    assets_register
                             │
                             │ (assetId)
                             ↓
                    assets_maintenance_tasks
                             │
                             │ (triggers)
                             ↓
                       chores_tasks ← calendar_events
```

No circular references. `core_household_members` is the only root node.

---

## 3. Collection Registry

All collection names are canonical. No module may use an alias.

| Collection | Owner Module | Entity Type | Conflict Strategy |
|------------|-------------|-------------|-------------------|
| `core_household_members` | core | `HouseholdMember` | `merge-fields` |
| `core_deferred_voice_commands` | core | `DeferredVoiceCommand` | n/a (not synced until resolved) |
| `finance_budget_categories` | finance | `BudgetCategory` | `merge-fields` |
| `finance_transactions` | finance | `Transaction` | `manual` |
| `pantry_items` | pantry | `PantryItem` | `last-write-wins` |
| `pantry_shopping_list` | pantry | `ShoppingListItem` | `last-write-wins` |
| `assets_register` | assets | `Asset` | `manual` |
| `assets_maintenance_tasks` | assets | `MaintenanceTask` | `last-write-wins` |
| `chores_tasks` | chores | `ChoreTask` | `last-write-wins` |
| `calendar_events` | calendar | `CalendarEvent` | `last-write-wins` |

---

## 4. Entity Field Definitions

All entities extend `BaseEntitySchema` from `schemas/core.schema.ts` unless noted.

### 4.1 `BudgetCategory` (`finance_budget_categories`)

Seed data required: system provides 8 default categories on first launch.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string 1–50 | ✅ | User-facing label e.g. "Groceries" |
| `type` | `income` \| `expense` | ✅ | Governs which transaction types are valid |
| `monthlyBudgetLimit` | number ≥ 0 | ❌ | `undefined` = no limit enforced |
| `aliases` | string[] | ❌ | Fuzzy-match synonyms e.g. `["food","supermarket"]` |
| `iconColor` | hex string | ❌ | For mobile chip UI e.g. `#4A90D9` |
| `isSystem` | boolean | ✅ | `true` = seeded by system, cannot be deleted |

**Default seed categories:**

| Name | Type | Default Limit |
|------|------|---------------|
| Groceries | expense | — |
| Home Repair | expense | — |
| Utilities | expense | — |
| Transport | expense | — |
| Healthcare | expense | — |
| Entertainment | expense | — |
| Household Income | income | — |
| Other | expense | — |

### 4.2 `Transaction` (`finance_transactions`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `amount` | number > 0 | ✅ | Always positive; `type` field encodes direction |
| `type` | `credit` \| `debit` | ✅ | Must match `BudgetCategory.type` |
| `categoryId` | UUID → `BudgetCategory` | ✅ | |
| `date` | UTCDateTime | ✅ | User-supplied transaction date (not `createdAt`) |
| `note` | string ≤ 200 | ❌ | |
| `receiptImageUri` | string | ❌ | Local file URI; never a remote URL in v1 |
| `linkedAssetId` | UUID → `Asset` | ❌ | For repair/purchase transactions |
| `linkedPantryItemId` | UUID → `PantryItem` | ❌ | For grocery cost tracking |
| `isOverBudget` | boolean | ✅ default `false` | Set by validator; not user-editable |

### 4.3 `PantryItem` (`pantry_items`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string 1–100 | ✅ | |
| `quantity` | number ≥ 0 | ✅ | Clamped to 0 by validator; never negative |
| `unit` | `UOMEnum` | ✅ | See §4.3.1 |
| `location` | `LocationEnum` | ✅ | default `Pantry` |
| `parLevel` | number ≥ 0 | ✅ | default `1`; the reorder trigger point |
| `expiryDate` | UTCDateTime | ❌ | |
| `barcode` | string | ❌ | EAN-13 / UPC-A |
| `lastPurchasedAt` | UTCDateTime | ❌ | Updated when a linked Transaction is logged |
| `averageCost` | number ≥ 0 | ❌ | Running average from linked Transactions |

**4.3.1 Unit of Measure enum (`UOMEnum`):**
`pcs` | `kg` | `g` | `L` | `ml` | `lbs` | `oz` | `box` | `bag`

**4.3.2 Location enum (`LocationEnum`):**
`Fridge` | `Freezer` | `Pantry` | `Garage` | `Other`

### 4.4 `ShoppingListItem` (`pantry_shopping_list`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string 1–100 | ✅ | May differ from PantryItem.name (e.g. brand) |
| `quantity` | number > 0 | ✅ | |
| `unit` | `UOMEnum` | ✅ | |
| `sourcePantryItemId` | UUID → `PantryItem` | ❌ | Set when auto-generated by parLevel trigger |
| `status` | `needed` \| `purchased` \| `discarded` | ✅ | default `needed` |
| `store` | string ≤ 50 | ❌ | Optional store preference e.g. "Costco" |
| `estimatedCost` | number ≥ 0 | ❌ | |

### 4.5 `Asset` (`assets_register`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string 1–100 | ✅ | e.g. "Dishwasher", "Roof", "Honda Civic" |
| `category` | `AssetCategoryEnum` | ✅ | See §4.5.1 |
| `location` | string ≤ 50 | ❌ | e.g. "Kitchen", "Garage" |
| `purchaseDate` | UTCDateTime | ❌ | |
| `purchaseCost` | number ≥ 0 | ❌ | Original acquisition cost |
| `lifetimeCost` | number ≥ 0 | ✅ default `0` | Accumulates all linked Transaction amounts |
| `warrantyExpiryDate` | UTCDateTime | ❌ | |
| `expectedLifespanYears` | number > 0 | ❌ | |
| `notes` | string ≤ 500 | ❌ | Manuals, model numbers, serial numbers |
| `photoUri` | string | ❌ | Local file URI |

> **Note:** `lifetimeCost` replaces Qwen's incorrect `purchaseDate` overwrite on large transactions.
> Validator increments `lifetimeCost` whenever a `Transaction` with `linkedAssetId` is written.

**4.5.1 Asset Category enum:**
`Appliance` | `HVAC` | `Vehicle` | `Structure` | `Electronics` | `Plumbing` | `Other`

### 4.6 `MaintenanceTask` (`assets_maintenance_tasks`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `assetId` | UUID → `Asset` | ✅ | Hard reference; asset must exist and not be deleted |
| `title` | string 1–150 | ✅ | e.g. "Replace HVAC filter" |
| `instructions` | string ≤ 1000 | ❌ | |
| `frequencyDays` | number int > 0 | ❌ | `undefined` = one-off task |
| `lastCompletedAt` | UTCDateTime | ❌ | |
| `nextDueAt` | UTCDateTime | ❌ | Computed by validator; never user-set directly |
| `status` | `StatusEnum` | ✅ | default `pending` |
| `assignedTo` | UUID → `HouseholdMember` | ❌ | |
| `completionNote` | string ≤ 200 | ❌ | Written at completion time |

**Status enum:** `pending` | `in_progress` | `completed` | `overdue`

### 4.7 `ChoreTask` (`chores_tasks`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string 1–100 | ✅ | e.g. "Vacuum living room" |
| `description` | string ≤ 300 | ❌ | |
| `assignedTo` | UUID → `HouseholdMember` | ❌ | `undefined` = unassigned |
| `frequencyDays` | number int > 0 | ❌ | `undefined` = one-off |
| `dueDate` | UTCDateTime | ❌ | |
| `completedAt` | UTCDateTime | ❌ | |
| `status` | `ChoreStatusEnum` | ✅ | default `pending` |
| `pointValue` | number int ≥ 0 | ✅ | default `1`; for gamification |
| `linkedCalendarEventId` | UUID → `CalendarEvent` | ❌ | |

**Chore status enum:** `pending` | `completed` | `skipped`

### 4.8 `CalendarEvent` (`calendar_events`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string 1–150 | ✅ | |
| `startAt` | UTCDateTime | ✅ | |
| `endAt` | UTCDateTime | ❌ | `undefined` = all-day event |
| `isAllDay` | boolean | ✅ | default `false` |
| `recurrenceRule` | string | ❌ | iCal RRULE string e.g. `FREQ=WEEKLY;BYDAY=MO` |
| `attendees` | UUID[] → `HouseholdMember` | ❌ | |
| `linkedChoreId` | UUID → `ChoreTask` | ❌ | |
| `linkedMaintenanceTaskId` | UUID → `MaintenanceTask` | ❌ | |
| `color` | hex string | ❌ | Calendar chip color |
| `location` | string ≤ 100 | ❌ | |
| `notes` | string ≤ 500 | ❌ | |

---

## 5. Cross-Module Side Effect Map

This table is the authoritative source for what the validator must do beyond the primary write.

| Trigger | Module | Condition | Side Effect | Target Collection |
|---------|--------|-----------|-------------|-------------------|
| `PantryItem` updated | pantry | `quantity <= parLevel` AND no `needed` item with same name exists | Auto-create `ShoppingListItem` with `status: 'needed'`, `createdBy: SYSTEM_MEMBER_ID` | `pantry_shopping_list` |
| `PantryItem` updated | pantry | `expiryDate` within 48h | Add to Morning Briefing queue | (notification only) |
| `MaintenanceTask` completed | assets | `frequencyDays` is set | Compute new `nextDueAt` = `lastCompletedAt + frequencyDays`; reset `status` to `pending` | `assets_maintenance_tasks` |
| `Transaction` written | finance | `linkedAssetId` is set | Increment `Asset.lifetimeCost` by `transaction.amount` | `assets_register` |
| `Transaction` written | finance | `debit` pushes category total > `monthlyBudgetLimit` | Set `isOverBudget: true`; add to Morning Briefing | `finance_transactions` |
| `Transaction` written | finance | `linkedPantryItemId` is set | Update `PantryItem.lastPurchasedAt`; recalculate `averageCost` | `pantry_items` |
| `Asset` warranty within 30d | assets | Checked daily by briefing generator | Add to Morning Briefing queue | (notification only) |
| `ChoreTask` with `frequencyDays` completed | chores | | Create next recurrence with new `dueDate` | `chores_tasks` |

---

## 6. Seed Data Requirements

On first launch, the validator middleware must seed the following before accepting any user writes:

1. `SYSTEM_MEMBER_ID` record in `core_household_members`
2. `UNKNOWN_MEMBER_ID` record in `core_household_members`
3. 8 default `BudgetCategory` records (§4.1 table)
4. Admin `HouseholdMember` record for the setup user

Seed writes bypass the role-authorization stage but still run schema validation.
