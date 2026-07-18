# decisions.md — Architecture Decision Records

Decisions are numbered sequentially. Never delete an entry — mark superseded ones.

---

## ADR-001: Use Groq (not Anthropic) as the cloud inference fallback

**Date:** 2026-06-14  
**Status:** Accepted

**Context:** The voice pipeline needs a cloud LLM for Tier 2 (devices without on-device SLM support, or as quality upgrade). Options considered: Anthropic API, OpenAI, Groq, Google AI Studio.

**Decision:** Use Groq with `llama-3.3-70b-versatile` as primary; Google AI Studio (Gemini Flash) as secondary fallback.

**Rationale:** Groq's LPU hardware delivers 300–1000 tokens/second — 3–10x faster than GPU-based providers. For a ~300 token intent-parsing round-trip, this means <200ms latency vs 600–1200ms for alternatives. Free tier (30 RPM, 1000 RPD) covers household-scale usage with no payment required. Open-source models only, which aligns with local-first privacy values. Claude/Anthropic API would be higher quality but costs money and ties the product to a single commercial provider.

**Trade-off:** Open-source models (Llama 3.3 70B) are slightly less accurate than frontier models on complex multi-intent parsing. Mitigated by Tier 0 handling the common 70% of commands.

---

## ADR-002: DeferredVoiceCommand does not extend BaseEntitySchema

**Date:** 2026-06-14  
**Status:** Accepted

**Context:** When voice fails Tier 0–2 offline, we need to store the raw transcript. The question is whether this storage record should use the full `BaseEntitySchema` with syncflow-db sync semantics.

**Decision:** `DeferredVoiceCommandSchema` is a standalone schema with minimal fields: no `vectorClock`, no `conflictResolutionStrategy`, no `syncedAt`.

**Rationale:** Deferred commands are transient pipeline state, not household data. They should never be synced to the server (they represent uncertainty — syncing uncertainty across devices is harmful). They are created and resolved on a single device within a short time window. Adding full sync machinery would create false conflicts (two devices both deferring a command that was actually spoken once) and pollute the sync queue.

**Trade-off:** Deferred commands are device-local and lost if the app is uninstalled. Acceptable — they expire on resolution or dismissal.

---

## ADR-003: Asset.lifetimeCost is incremented by Finance validator, not Assets validator

**Date:** 2026-06-14  
**Status:** Accepted

**Context:** When a `Transaction` with `linkedAssetId` is written, `Asset.lifetimeCost` must be incremented. The question is which module's validator owns this write.

**Decision:** The Finance validator owns the `lifetimeCost` increment as a cross-module side effect.

**Rationale:** The trigger is a Finance event (a transaction write). The Finance validator already has the `amount` in scope. If the Assets validator owned this, it would need to subscribe to Finance writes — creating a dependency inversion that makes the Assets module aware of Finance internals. The dependency graph flows Finance → Assets, not the reverse.

**Trade-off:** The Finance validator must import from `assets_register` collection. Documented in SPEC-013 cross-module dependency order.

---

## ADR-004: RRULE strings stored verbatim; expansion is a UI concern

**Date:** 2026-06-14  
**Status:** Accepted

**Context:** Recurring calendar events could be stored as individual expanded instances OR as a single record with an RRULE recurrence rule.

**Decision:** Store as a single record with `recurrenceRule: string` (iCal RRULE format). Expansion to individual dates is computed at read time by the UI layer. Expanded instances are never written to the DB.

**Rationale:** Storing expanded instances would produce unbounded record growth for long-running recurring events (e.g. a weekly chore generates 52 records/year). RRULE is a stable, well-documented standard. Local SQLite can expand rules client-side without any network call. Syncflow-db sync of a single record is trivially cheaper than syncing hundreds of instances.

**Trade-off:** Exception handling (skipping a specific occurrence) requires either EXDATE support (deferred to v2) or deleting and recreating the rule. Acceptable for v1 scope.

---

## ADR-005: ConflictResolutionStrategy is per-entity, not global

**Date:** 2026-06-14  
**Status:** Accepted

**Context:** syncflow-db supports a single global conflict strategy. HomeOS needs different strategies for different entity types (financial records need `manual`; pantry quantities are fine with `last-write-wins`).

**Decision:** Store `conflictResolutionStrategy` as a field on every entity in `BaseEntitySchema`. The sync middleware reads this field and routes to the appropriate handler.

**Rationale:** A global `last-write-wins` would silently overwrite financial transactions — unacceptable. A global `manual` would surface conflict cards for every pantry quantity change — annoying. Per-entity strategy gives the right behaviour for each data type without requiring custom collection-level sync configuration.

**Trade-off:** Each entity carries 1 extra field (~20 bytes). Negligible storage impact. The middleware is slightly more complex (must read the field before resolving). Justified.

---

## ADR-006: Browser-based LLM (WebLLM) excluded from v1

**Date:** 2026-06-14  
**Status:** Superseded by ADR-007 (PWA decision makes this moot — native SLMs are also excluded)

**Context:** WebGPU reached mobile browsers (iOS Safari 18.2, Android Chrome) in early 2026, making in-browser LLM inference technically possible via WebLLM.

**Decision:** WebLLM remains excluded from v1.

**Rationale (updated):** HomeOS is a PWA (ADR-007), so both WebLLM and native SLMs are unavailable. WebLLM's specific exclusion reasons remain valid regardless: 1–4GB model download is catastrophic for a PWA install experience, browser inference is 3–10× slower than native on the same hardware, and battery drain is significant. WebNN (W3C API routing to device NPUs) may close the performance gap for v3+ without the download penalty.

**Trade-off:** The PWA constraint means offline voice is limited to Tier 0 pattern matching. This covers ~70% of real commands; the remaining 30% requires network for Tier 1 (Groq) or manual entry via Tier 2.

---

## ADR-007: Vue 3 PWA over React Native / Capacitor

**Date:** 2026-06-14  
**Status:** Accepted

**Context:** HomeOS needs to run on iOS and Android. Three options were considered: React Native (cross-platform native), Capacitor (web-in-native wrapper), and a Vue 3 PWA (pure browser, installable).

**Decision:** Vue 3 PWA using Vite + `vite-plugin-pwa`, styled with Tailwind CSS + Reka UI.

**Rationale:**
- Single repo, single language, single build pipeline — no native bridge maintenance, no Xcode/Android Studio knowledge required
- `@syncflow-db/core` uses `wa-sqlite` (WebAssembly SQLite) — runs natively in the browser's Origin Private File System (OPFS), so the local-first data layer is fully intact
- Web Speech API covers STT on both platforms (Chrome reliable; Safari requires gesture per session — acceptable)
- Tailwind + Reka UI provides all the mobile UI primitives from SPEC-004 (bottom sheets, dialogs, comboboxes, swipe gestures via `@vueuse/gesture`) without a native component library
- `vite-plugin-pwa` handles service worker, offline shell caching, and home screen installability
- PWA install on iOS (Safari Share → Add to Home Screen) and Android (Chrome install prompt) is sufficient for household use — no App Store distribution required

**What this trades away:**
- Tier 1 (Apple Foundation Models / Gemini Nano) — native-only APIs, inaccessible from PWA. Offline voice falls back to Tier 0 (pattern matching) only. Tier 1 remains documented in decisions.md as a future upgrade path if a native shell is ever added.
- Web Speech API on iOS Safari requires a user gesture per session and has no persistent offline recognition mode. Users on iOS see a "tap to speak" prompt rather than continuous listening.
- Push notifications on iOS require iOS 16.4+ and the PWA must be installed to home screen. Notifications work from launch on Android.

**Why not Capacitor?** Capacitor wraps the PWA in a native shell, which would re-introduce native build tooling and two-platform maintenance — the exact problem we're avoiding — without enabling the native SLM APIs (those require deeper native module integration than Capacitor's web bridge supports cleanly).

**Why not React Native?** The user explicitly prefers not to use React and not to maintain two separate stacks. Vue 3 is the preferred framework. React Native would also require separate Swift/Kotlin native modules for SLMs, which adds native development overhead.

**Stack summary:**
```
Vue 3 + TypeScript         — framework
Vite + vite-plugin-pwa     — build + PWA shell
Tailwind CSS v4            — utility styling
Reka UI v2                 — headless behaviour primitives
@vueuse/core               — composables (useSwipe, useStorage, etc.)
@vueuse/gesture            — touch gesture handling
Pinia                      — state management
Vue Router                 — navigation
@syncflow-db/core          — local-first SQLite sync
Zod                        — schema validation
Vitest                     — test runner
```
