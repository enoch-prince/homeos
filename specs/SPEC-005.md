# SPEC-005 — Module: Finance & Budgeting

**Version:** 0.1.0 | **Status:** Draft | **Depends on:** SPEC-001

---

## Roles
| Action | admin | adult | child | guest |
|--------|-------|-------|-------|-------|
| View transactions | ✅ | ✅ | ❌ | ❌ |
| Log transaction | ✅ | ✅ | ❌ | ❌ |
| Edit transaction | ✅ | Own only | ❌ | ❌ |
| Delete transaction | ✅ | ❌ | ❌ | ❌ |
| Manage categories | ✅ | ✅ | ❌ | ❌ |
| View budgets | ✅ | ✅ | ❌ | ❌ |

## Auto-Validator Rules
1. **Type matching:** `Transaction.type` must equal `BudgetCategory.type`. Credit into expense category → `FINANCE_TYPE_MISMATCH`.
2. **Budget variance:** After each debit write, sum all debits in `categoryId` for current calendar month. If total > `monthlyBudgetLimit` → set `isOverBudget: true`, dispatch Morning Briefing entry.
3. **Asset capitalization:** If `linkedAssetId` is set → increment `Asset.lifetimeCost` by `amount`. Do not modify `Asset.purchaseDate`.
4. **Pantry cost tracking:** If `linkedPantryItemId` is set → update `PantryItem.lastPurchasedAt = transaction.date`; recalculate `averageCost = (old_avg * n + amount) / (n + 1)`.
5. **No hard deletes:** Transactions may only be soft-deleted. `CORE_SOFT_DELETE_ONLY` on any hard delete attempt.

## Orphan Prevention
- Cannot soft-delete a `BudgetCategory` with any non-deleted transactions referencing it.
- System categories (`isSystem: true`) cannot be deleted at all. → `FINANCE_SYSTEM_CATEGORY_PROTECTED`.

## Cross-Module Side Effects
- Debit over budget → Morning Briefing (notification module)
- `linkedAssetId` → `assets_register.lifetimeCost` increment
- `linkedPantryItemId` → `pantry_items.averageCost` + `lastPurchasedAt` update

## Voice Intent Mappings
- `LOG_EXPENSE` → creates `Transaction` with `type: 'debit'`
- `LOG_INCOME` (future) → creates `Transaction` with `type: 'credit'`

## Morning Briefing Contribution
- Budget categories > 90% of `monthlyBudgetLimit` (priority 🟠)

## Error Codes
```
FINANCE_TYPE_MISMATCH           — credit/debit into wrong category type
FINANCE_UNKNOWN_CATEGORY        — categoryGuess could not be resolved
FINANCE_SYSTEM_CATEGORY_PROTECTED — attempted delete of system category
FINANCE_ORPHANED_CATEGORY       — attempted delete of category with transactions
```

## Out of Scope (v1)
- Recurring transactions, bank sync, multi-currency, split transactions, reports/exports.
