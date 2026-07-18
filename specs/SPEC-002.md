# SPEC-002 — Sync Architecture

**Version:** 0.1.0  
**Status:** Draft  
**Depends on:** SPEC-000, SPEC-001  
**Last Updated:** 2026-06-14

---

## 1. Purpose

This spec defines how data moves between devices and the server, how conflicts are detected and resolved, and what the sync layer guarantees to the rest of the application.

The rest of the application must treat sync as a **black box with a contract** — it does not reach into syncflow-db internals. This spec defines that contract.

---

## 2. Sync Engine Contract

**Engine:** `@syncflow-db/core` v0.3.6+  
**Local storage:** `wa-sqlite` (WebAssembly SQLite in browser); native SQLite on mobile  
**Server target:** `@syncflow-db/server` backed by Postgres  

### 2.1 Guarantees the engine provides

- Every local write is durable before the function returns
- Writes are queued as `syncStatus: 'pending'` and delivered to the server in order of `createdAt`
- Vector clocks are managed exclusively by the engine — application code never modifies them
- Soft deletes (`_deleted: true`) are synced and preserved on the server; hard deletes do not exist

### 2.2 Guarantees the application provides to the engine

- `_id` is always a UUID v4, generated client-side before the write
- `_rev` is always the previous `_rev + 1` (via `createUpdateStamp()`)
- `vectorClock` is never touched by application code
- `clientId` is injected by the engine; application code reads but never writes it

---

## 3. Sync Topology

```
Device A (Phone)          Device B (Tablet)
  wa-sqlite                 wa-sqlite
     │                         │
     │   @syncflow-db/core      │
     │                         │
     └──────────┬──────────────┘
                │  HTTPS / WSS
                ▼
        @syncflow-db/server
              Postgres
```

The server is a **sync hub**, not an authoritative source. Any device can operate indefinitely without it. The server's job is conflict detection and multi-device fan-out.

---

## 4. Conflict Detection & Resolution

### 4.1 Detection

When the server receives a write, it compares the incoming `vectorClock` against the stored clock using `compareVectorClocks()`:

| Result | Meaning | Action |
|--------|---------|--------|
| `happens-before` | Incoming is older than stored | Discard incoming (already superseded) |
| `happens-after` | Incoming is newer than stored | Apply — safe overwrite |
| `concurrent` | Neither is causally ahead | **Conflict** — apply resolution strategy |

### 4.2 Resolution by strategy

| Strategy | Behaviour on `concurrent` |
|----------|--------------------------|
| `last-write-wins` | Apply the record with the higher `updatedAt`. Set `syncStatus: 'synced'` on winner. |
| `merge-fields` | Apply non-overlapping field changes from both versions. Overlapping fields: higher `updatedAt` wins per-field. Set `syncStatus: 'synced'`. |
| `manual` | Freeze both versions. Set `syncStatus: 'conflict'` on both. Surface conflict card in UI. No data is lost. |

### 4.3 Manual conflict resolution UI contract

When `syncStatus === 'conflict'` on an entity, the UI must:

1. Surface a **conflict card** in the relevant module view
2. Show both versions side-by-side with member attribution and timestamps
3. Provide "Keep mine" / "Keep theirs" / "Merge manually" actions
4. On resolution: set `syncStatus: 'pending'`; the winner is re-synced

The voice processor must not read `conflict` entities until resolved — surface a spoken warning instead: *"There's a conflict on [entity name] that needs your review."*

---

## 5. Offline Queue Behaviour

### 5.1 Write path (offline)

```
App writes entity
    ↓
syncStatus = 'pending'
    ↓
UI updates immediately (optimistic)
    ↓
Write queued in local SQLite
    ↓
[network unavailable — queue holds]
    ↓
[network restored]
    ↓
Queue drains in createdAt order
    ↓
syncStatus = 'synced' | 'conflict' | 'failed'
```

### 5.2 Failed sync

If a sync write returns a server error (5xx, auth failure):
- `syncStatus` remains `'failed'`
- Retry with exponential backoff: 5s, 15s, 60s, 5min, 30min
- After 3 hours of failed retries: surface a persistent "Sync problem" banner in UI
- Failed records are never discarded — they stay in local SQLite indefinitely

### 5.3 Cross-module atomicity limitation

syncflow-db does not support multi-collection atomic writes. When a trigger produces side effects across collections (e.g. pantry update → shopping list item), each write is independent. If the second write fails locally (rare but possible under extreme memory pressure), the validator must log a `SpecViolationError` with `CORE_SIDE_EFFECT_FAILED` and retry on next app launch.

---

## 6. Sync Configuration

```typescript
// Applied at app initialisation
const db = new SyncFlowDB({
  syncInterval: 30_000,        // ms — foreground sync polling
  batchSize: 50,               // records per sync push
  conflictStrategy: 'per-entity', // read conflictResolutionStrategy from each record
  softDeleteOnly: true,        // hard deletes are a SpecViolationError
});
```

---

## 7. syncStatus UI Indicator Contract

The UI layer reads `syncStatus` and must render accordingly. This is the only place sync state is visible to users.

| syncStatus | UI treatment |
|------------|-------------|
| `pending` | Subtle unsynced dot (•) on record card — grey, 6px |
| `synced` | No indicator (default state, no noise) |
| `conflict` | Amber warning chip "Conflict" — tappable, opens conflict card |
| `failed` | Red warning chip "Sync failed" — tappable, shows retry option |

The indicator must never block interaction — records with `pending` or `failed` status are fully editable.
