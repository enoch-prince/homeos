# SPEC-007 — Module: Chores & Tasks

**Version:** 0.1.0 | **Status:** Draft | **Depends on:** SPEC-001

---

## Roles
| Action | admin | adult | child | guest |
|--------|-------|-------|-------|-------|
| View all chores | ✅ | ✅ | Own + unassigned | ❌ |
| Create chore | ✅ | ✅ | ❌ | ❌ |
| Assign chore | ✅ | ✅ | ❌ | ❌ |
| Complete chore | ✅ | ✅ | Own only | ❌ |
| Skip chore | ✅ | ✅ | ❌ | ❌ |
| Delete chore | ✅ | ❌ | ❌ | ❌ |

## Auto-Validator Rules
1. **Completion stamp:** When `status` transitions to `completed` → set `completedAt: now()`. If `completedAt` is already set, throw `CHORE_ALREADY_COMPLETED`.
2. **Recurrence generation:** If `frequencyDays` is set and `status` transitions to `completed` → create a new `ChoreTask` record with:
   - Same `title`, `description`, `assignedTo`, `frequencyDays`, `pointValue`
   - `dueDate: completedAt + frequencyDays`
   - `status: 'pending'`
   - `createdBy: SYSTEM_MEMBER_ID`
3. **Points award:** On completion → the `HouseholdMember` record is updated with a running `totalPoints` tally. (Field added to `HouseholdMemberSchema` as `totalPoints: z.number().int().nonneg().default(0)`.)
4. **Assignment guard:** `assignedTo` must be an active `HouseholdMember` (`isActive: true`). → `CHORE_INVALID_ASSIGNEE`.
5. **Due date ordering:** `dueDate` must be ≥ `createdAt`. → `CHORE_DUE_DATE_IN_PAST` (warning, not error — allows backdating completed chores).

## Orphan Prevention
- No orphan concern: chores have no dependents. Soft-delete is always permitted.
- If a chore has a `linkedCalendarEventId`, soft-deleting the chore must also soft-delete the calendar event. → cascade.

## Cross-Module Side Effects
- Chore completion with `frequencyDays` → creates next `ChoreTask` recurrence
- `linkedCalendarEventId` set → creates/updates corresponding `CalendarEvent`
- Chore deleted → cascades to `linked CalendarEvent` soft-delete

## Voice Intent Mappings
- `COMPLETE_CHORE` → transitions `ChoreTask.status` to `completed`

## Morning Briefing Contribution
- Chores assigned to the requesting member due today (priority 🟢)
- Overdue chores (priority included in assets overdue — treat separately) — surfaced as 🟠

## Error Codes
```
CHORE_ALREADY_COMPLETED    — status is already completed
CHORE_INVALID_ASSIGNEE     — assignedTo member is inactive or not found
CHORE_DUE_DATE_IN_PAST     — dueDate is before createdAt (warning only)
```

## Out of Scope (v1)
- Chore point redemption/rewards system, photo proof of completion, household leaderboard UI (points tallied but leaderboard is v2).
