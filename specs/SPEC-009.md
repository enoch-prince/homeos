# SPEC-009 — Module: Family Calendar

**Version:** 0.1.0 | **Status:** Draft | **Depends on:** SPEC-001, SPEC-007

---

## Roles
| Action | admin | adult | child | guest |
|--------|-------|-------|-------|-------|
| View calendar | ✅ | ✅ | ✅ | ✅ |
| Create event | ✅ | ✅ | ❌ | ❌ |
| Edit own event | ✅ | ✅ | ❌ | ❌ |
| Edit others' events | ✅ | ❌ | ❌ | ❌ |
| Delete event | ✅ | Own only | ❌ | ❌ |

## Auto-Validator Rules
1. **Date ordering:** `endAt` must be ≥ `startAt` if both are provided. → `CALENDAR_INVALID_DATE_RANGE`.
2. **All-day consistency:** If `isAllDay: true`, `startAt` must have time component `00:00:00Z` and `endAt` must be undefined or also `00:00:00Z`. → `CALENDAR_ALLDAY_TIME_MISMATCH`.
3. **Attendee guard:** All UUIDs in `attendees[]` must resolve to active `HouseholdMember` records. → `CALENDAR_INVALID_ATTENDEE`.
4. **Linked entity cascade:** If `linkedChoreId` is set and the referenced `ChoreTask` is soft-deleted → soft-delete this `CalendarEvent` too.
5. **Recurrence:** `recurrenceRule` is stored as an iCal RRULE string. The validator only validates the string is non-empty when set; RRULE expansion is handled by the UI layer, not the validator. Expanded instances are **not** stored — they are computed at read time.

## Orphan Prevention
- `CalendarEvent` with `linkedChoreId` → chore deletion cascades to event (handled in SPEC-007).
- `CalendarEvent` with `linkedMaintenanceTaskId` → task deletion cascades to event.
- Standalone events may always be soft-deleted.

## Cross-Module Side Effects
- `ChoreTask` with `frequencyDays` completion → sibling `CalendarEvent` created for next due date
- `MaintenanceTask` rescheduled → corresponding `CalendarEvent` `startAt` updated

## Voice Intent Mappings
- `ADD_CALENDAR` → creates `CalendarEvent`

## Morning Briefing Contribution
- Calendar has no direct Morning Briefing contribution in v1. Events surface via linked chores (SPEC-007) and maintenance tasks (SPEC-008).

## Error Codes
```
CALENDAR_INVALID_DATE_RANGE    — endAt before startAt
CALENDAR_ALLDAY_TIME_MISMATCH  — isAllDay true but times not midnight
CALENDAR_INVALID_ATTENDEE      — attendee UUID not found or inactive
```

## Out of Scope (v1)
- External calendar sync (iCal/CalDAV), sharing events with non-members, reminders/notifications per event (Morning Briefing covers this in aggregate), recurring event exception handling (EXDATE).
