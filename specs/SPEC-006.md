# SPEC-006 — Module: Pantry & Shopping

**Version:** 0.1.0 | **Status:** Draft | **Depends on:** SPEC-001

---

## Roles
| Action | admin | adult | child | guest |
|--------|-------|-------|-------|-------|
| View pantry | ✅ | ✅ | ✅ | ✅ |
| Update quantity | ✅ | ✅ | ✅ | ❌ |
| Add/edit item | ✅ | ✅ | ✅ | ❌ |
| Delete item | ✅ | ✅ | ❌ | ❌ |
| View shopping list | ✅ | ✅ | ✅ | ✅ |
| Mark purchased | ✅ | ✅ | ✅ | ❌ |

## Auto-Validator Rules
1. **Negative quantity guard:** If `quantity` would go below 0, clamp to 0 and throw `PANTRY_NEGATIVE_QUANTITY`. UI/voice: "[item] is now at 0. Added to your shopping list."
2. **Par level trigger:** After any quantity update, if `quantity <= parLevel` AND no `ShoppingListItem` with `status: 'needed'` exists for this item → auto-create `ShoppingListItem` with `createdBy: SYSTEM_MEMBER_ID`, `sourcePantryItemId` set.
3. **Expiry watch:** If `expiryDate` is set and within 48 hours of now → add to Morning Briefing queue (checked at briefing generation time, not on write).
4. **Purchase feedback loop:** When a `ShoppingListItem` is marked `purchased` → if `sourcePantryItemId` is set, increment `PantryItem.quantity` by `ShoppingListItem.quantity`. Speak: "[item] restocked to [new qty] [unit]."
5. **Unit consistency:** Cannot change `unit` on an existing `PantryItem` without resetting `quantity` to 0. → `PANTRY_UNIT_CHANGE_RESETS_QTY` warning (not error; proceeds with reset).

## Orphan Prevention
- Cannot soft-delete a `PantryItem` if a `finance_transactions` record has `linkedPantryItemId` pointing to it. → `PANTRY_LINKED_TRANSACTION`.

## Cross-Module Side Effects
- `quantity <= parLevel` → auto-creates `ShoppingListItem` (pantry internal)
- `expiryDate` within 48h → Morning Briefing
- `ShoppingListItem.purchased` → restocks `PantryItem.quantity`

## Voice Intent Mappings
- `UPDATE_PANTRY` (subtract) → decrements `PantryItem.quantity`
- `UPDATE_PANTRY` (add) → increments `PantryItem.quantity`
- `ADD_TO_SHOPPING` → creates `ShoppingListItem` with `status: 'needed'`

## Morning Briefing Contribution
- Expiring items within 48h (priority 🔴)
- Items at or below `parLevel` not yet on shopping list (priority 🟠)

## Error Codes
```
PANTRY_NEGATIVE_QUANTITY      — quantity would go below 0
PANTRY_UNIT_CHANGE_RESETS_QTY — unit changed, quantity reset to 0
PANTRY_LINKED_TRANSACTION     — delete blocked by linked transaction
```

## Out of Scope (v1)
- Barcode database lookup (barcode stored but not looked up externally), recipe ingredient linking (v2), nutrition tracking.
