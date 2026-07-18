# SPEC-004 — Mobile UI/UX Patterns

**Version:** 0.1.0  
**Status:** Draft  
**Depends on:** SPEC-000  
**Last Updated:** 2026-06-14

---

## 1. Core Layout Primitives

### 1.1 Shell

```
┌─────────────────────────────┐
│  Status bar (system)        │
├─────────────────────────────┤
│  Module header (56dp)       │  ← module name + sync indicator + avatar
├─────────────────────────────┤
│                             │
│  Content area               │  ← scrollable, full bleed
│  (flex: 1)                  │
│                             │
├─────────────────────────────┤
│  Bottom nav (64dp)          │  ← 5 tabs: Home · Pantry · Finance · Chores · More
└─────────────────────────────┘
```

- Safe area insets respected on all edges (notch, home bar, dynamic island)
- Content never scrolls under the bottom nav — nav uses `position: fixed` equivalent with padding compensation
- No hamburger menus. No drawers. No nested navigation beyond one level deep.

### 1.2 Bottom Navigation tabs (v1)

| Position | Tab | Module | Icon |
|----------|-----|--------|------|
| 1 | Home | Dashboard / Morning Briefing | house |
| 2 | Pantry | pantry + shopping | basket |
| 3 | Finance | finance | wallet |
| 4 | Chores | chores + calendar | check-circle |
| 5 | More | assets + settings | grid-3x3 |

### 1.3 Touch targets

- Minimum 48×48dp on all interactive elements
- Destructive actions (delete, mark-as-discarded) require a 48dp minimum AND a confirmation swipe or hold
- The voice button (FAB) is 64×64dp, always visible except when keyboard is open

---

## 2. The Voice FAB

The primary entry point for all actions. Floating action button, bottom-centre, 16dp above bottom nav.

**States:**

| State | Visual | Behaviour |
|-------|--------|-----------|
| Idle | Microphone icon, surface colour | Tap to begin recording |
| Listening | Pulsing amber ring, waveform | Speech captured in real-time |
| Processing | Spinner, tier indicator (T0/T1/T2) | Shows which tier is resolving |
| Success | Green checkmark, 600ms | Confirmed; auto-dismisses |
| Error | Red shake animation | Error; opens correction options |
| Offline | Microphone with slash badge | Tap shows "Offline — Tier 0 only" tooltip |

**Long-press** on the FAB opens a quick-action sheet with the 5 most recent action types for the current module (pre-fills the manual intent picker without speaking).

---

## 3. Card System

All entity records are displayed as cards. Cards are the only list item type — no table rows.

### 3.1 Anatomy

```
┌──────────────────────────────────────────┐
│ [icon]  Primary label         [status]   │  ← 56dp row
│         Secondary detail                 │  ← 12px muted
└──────────────────────────────────────────┘
```

- Primary label: 16px, weight 500
- Secondary detail: 12px, muted colour
- Status chip: right-aligned, coloured pill (see §3.2)
- Tap → opens detail sheet (bottom sheet, 90% height)
- Swipe left → quick action (context-dependent: complete / discard / delete)
- Swipe right → secondary action (edit / reschedule / share)

### 3.2 Status chip colours

| Status | Colour | Use |
|--------|--------|-----|
| `needed` | Amber | Shopping item, maintenance due |
| `overdue` | Red | Maintenance overdue, chore past due |
| `pending` | Neutral grey | Default / in-progress |
| `completed` | Green | Done |
| `conflict` | Amber | Sync conflict (from SPEC-002) |
| `failed` | Red | Sync failed (from SPEC-002) |
| `low stock` | Amber | Pantry item at or below parLevel |
| `expiring` | Red | Expiry within 48h |

---

## 4. Module-Specific Patterns

### 4.1 Pantry module

- Two views: **Pantry** (grouped by location) and **Shopping List** (grouped by status)
- Location groups use sticky headers: Fridge · Freezer · Pantry · Garage
- Quantity control: `−` / quantity chip / `+` inline on card (no detail sheet needed for quantity change)
- Barcode scan: camera icon in module header. Resolves to existing item or creates new one
- Low-stock items float to the top of their location group with an amber left-border accent

### 4.2 Finance module

- Two views: **Transactions** (chronological) and **Budgets** (category cards with progress bars)
- Budget cards show: category name, spent / limit, colour-coded progress bar (green → amber → red)
- Transaction entry: amount field is numeric-keypad-first; category is a chip selector (not a text field)
- Receipt photo: camera icon on transaction detail sheet; stored as local file URI

### 4.3 Chores module

- Default view: **Today** (due today or overdue, assigned to current member first)
- Secondary view: **All** (full list, filterable by assignee)
- Completing a chore: single swipe-right gesture; no confirmation required (undo available for 5s)
- Points tally shown on member avatar chip in module header
- Child members see only their assigned chores in the default view

### 4.4 Assets module (under "More")

- Two views: **Assets** (category-grouped register) and **Maintenance** (timeline of upcoming tasks)
- Maintenance timeline: horizontal scroll, one card per task, ordered by `nextDueAt`
- Asset detail sheet shows: photo, specs, `lifetimeCost`, warranty status, full maintenance history
- Overdue maintenance tasks surface in the Morning Briefing and as a badge on the "More" tab

### 4.5 Calendar (within Chores tab)

- Week strip at top of Chores view (7-day horizontal scroll, today centred)
- Tapping a day filters the chore list to that day
- All-day events shown as colour chips in the week strip
- Timed events shown as pill chips in a simplified day column below the strip

---

## 5. Morning Briefing Screen

- Accessed via the Home tab
- Full-screen card with TTS playback button at top
- Priority-ordered list of items (SPEC-000 §7)
- Each item is tappable → deep-links to the relevant entity in its module
- A "Dismiss all" button marks all low-priority items as acknowledged for the day
- If there are zero items: shows a green "All clear" state with today's date

---

## 6. Conflict Resolution Card

Appears inline in the relevant module view when `syncStatus === 'conflict'`.

```
┌──────────────────────────────────────────────┐
│ ⚠ Conflict on "Milk"                         │
│                                              │
│ Your version (2 mins ago)   Server version   │
│ Quantity: 0                 Quantity: 2       │
│ By: You                     By: Partner       │
│                                              │
│ [Keep mine]  [Keep theirs]  [Edit manually]  │
└──────────────────────────────────────────────┘
```

---

## 7. Offline Banner

A persistent non-blocking banner shown at the top of the content area (below the module header) when the device has been offline for > 30 seconds.

```
┌──────────────────────────────────────────────┐
│ 📴  Offline — changes will sync when back    │
└──────────────────────────────────────────────┘
```

- Amber background, 32dp height
- Dismissible with swipe up (reappears if still offline after 60s)
- Never blocks interaction
- Voice FAB shows the offline badge state (§2) simultaneously
