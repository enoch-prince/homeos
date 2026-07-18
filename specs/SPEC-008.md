# SPEC-008 — Module: Maintenance & Assets

**Version:** 0.1.0 | **Status:** Draft | **Depends on:** SPEC-001

---

## Roles
| Action | admin | adult | child | guest |
|--------|-------|-------|-------|-------|
| View assets | ✅ | ✅ | ❌ | ❌ |
| Create asset | ✅ | ✅ | ❌ | ❌ |
| Edit asset | ✅ | ✅ | ❌ | ❌ |
| Delete asset | ✅ | ❌ | ❌ | ❌ |
| View maintenance tasks | ✅ | ✅ | ❌ | ❌ |
| Create/complete task | ✅ | ✅ | ❌ | ❌ |

## Auto-Validator Rules
1. **Scheduling:** When a `MaintenanceTask` is completed (`status → completed`) AND `frequencyDays` is set → compute `nextDueAt = lastCompletedAt + frequencyDays`. Reset `status` to `pending`. If `lastCompletedAt` is null at creation, `nextDueAt = createdAt + frequencyDays`.
2. **Overdue detection:** A background job (run at briefing generation time) checks all `MaintenanceTask` records where `nextDueAt < now()` AND `status !== 'completed'` → sets `status: 'overdue'`.
3. **Warranty alert:** Checked at briefing generation time: if `Asset.warrantyExpiryDate` is within 30 days → add to Morning Briefing queue.
4. **Orphan guard:** Cannot soft-delete an `Asset` if any `MaintenanceTask` with `status` in `['pending', 'in_progress', 'overdue']` references it. → `ASSETS_HAS_ACTIVE_TASKS`. Admin can override with explicit `forceDelete: true` flag, which cascades the task soft-deletes.
5. **Asset reference integrity:** `MaintenanceTask.assetId` must point to a non-deleted `Asset`. → `ASSETS_INVALID_ASSET_REF`.
6. **lifetimeCost update:** Handled by SPEC-005 Finance validator, not assets. Assets validator must not double-count.

## Orphan Prevention
- `Asset` with active `MaintenanceTask`s → `ASSETS_HAS_ACTIVE_TASKS` blocks delete.
- `MaintenanceTask` may always be soft-deleted (no dependents).

## Cross-Module Side Effects
- `MaintenanceTask` completion → reschedules itself (assets internal)
- `Transaction.linkedAssetId` write (from finance) → increments `Asset.lifetimeCost`

## Voice Intent Mappings
- `LOG_MAINTENANCE` → completes a `MaintenanceTask` (or creates + immediately completes a one-off task)

## Morning Briefing Contribution
- Overdue `MaintenanceTask`s (priority 🔴)
- Tasks due within 7 days (priority 🟡)
- Warranties expiring within 30 days (priority 🟡)

## Error Codes
```
ASSETS_HAS_ACTIVE_TASKS      — delete blocked by pending/overdue tasks
ASSETS_INVALID_ASSET_REF     — MaintenanceTask.assetId points to deleted asset
ASSETS_ORPHAN_TASK           — voice: asset not found, offer to create
```

## Out of Scope (v1)
- Depreciation calculation, photo documentation of repairs, contractor contact linking (v2), QR code asset tagging.
