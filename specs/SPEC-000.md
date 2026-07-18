# SPEC-000 — HomeOS: Philosophy & Foundational Principles

**Version:** 0.1.0  
**Status:** Draft  
**Authors:** HomeOS Architecture Team  
**Last Updated:** 2026-06-13

---

## 0. Purpose of This Document

This is the constitution of HomeOS. Every technical decision, every UX pattern, and every data model choice in SPEC-001 through SPEC-013 must be traceable back to a principle stated here.

If two specs contradict each other, this document wins. If a feature request conflicts with a principle here, the principle wins unless this document is formally revised.

---

## 1. The Core Analogy

HomeOS is **Odoo for the household** — a modular, integrated operating system for domestic life. Like Odoo, its power comes not from any individual module but from the **shared backbone**: a single data model connecting people, assets, money, time, and inventory so that a single user action can propagate correctly across multiple modules.

The key distinction from a generic to-do app or budget tracker is **relational integrity**. Buying milk is simultaneously:
- A pantry update (inventory up)
- A shopping list completion (item purchased)
- A financial transaction (debit from Groceries budget)
- Optionally a meal plan unlock (recipe now executable)

No module is an island.

---

## 2. The Three Pillars

These are non-negotiable. Every design decision must satisfy all three.

### Pillar 1 — Local-First

> *"The network is an enhancement, not a requirement."*

**What it means:**
- Every write goes to local SQLite via `@syncflow-db/core` before any network call
- The app is fully functional with zero internet — offline is a first-class state, not an error state
- Sync is background, bidirectional, and invisible to the user when working correctly
- The device is the source of truth; the server is the backup

**What it rules out:**
- No loading spinners on write operations
- No "you must be online to do this" errors for any core feature
- No blocking network calls in the write path

**Sync Engine:** `@syncflow-db/core` v0.3.6+  
**Storage Backend:** `wa-sqlite` (WebAssembly SQLite) in browser; native SQLite in mobile  
**Conflict Model:** Vector clocks (see `core.schema.ts` Section 2). Conflict resolution strategy is declared per-entity type (see Section 5 of this document).

### Pillar 2 — Mobile-First

> *"Designed for a phone in one hand while stirring a pot with the other."*

**What it means:**
- All primary interactions are reachable with a single thumb
- No feature requires a keyboard — text input is always optional
- Information density is low: one task per screen, progressive disclosure for details
- Touch targets are minimum 48×48dp (Material Design / Apple HIG compliant)
- The app works well in bright kitchen light (high contrast) and dark rooms (dark mode default)

**What it rules out:**
- No tables with more than 3 columns on mobile
- No multi-step forms with more than 3 fields before a save point
- No hover-dependent interactions
- No pagination — use infinite scroll or grouped views

**Breakpoints:**

| Name | Width | Primary Use |
|------|-------|-------------|
| `xs` | < 390px | Older/small phones |
| `sm` | 390–767px | **Primary target — iPhone/Android** |
| `md` | 768–1023px | Tablets (secondary) |
| `lg` | 1024px+ | Desktop (tertiary — dashboard only) |

### Pillar 3 — Voice-First

> *"The best interface is no interface. The second best is your voice."*

**What it means:**
- Every core action has a voice equivalent
- Voice commands produce structured `VoiceIntent` objects (see `spec/voice-intent.schema.ts`)
- An intent parser translates natural speech to structured intents; the validator enforces contracts
- Text input is the **fallback**, not the default

**What it rules out:**
- No required text fields without a voice-fill alternative
- No action that requires precise text input (e.g. picking from a dropdown replaces typing a category name)

---

### Voice Architecture: The Offline Problem

This is the central tension of the voice pipeline: **intent parsing requires language understanding, but language understanding has traditionally required a network call.** A naive implementation breaks Pillar 1 the moment it breaks Pillar 3.

HomeOS is a **Vue 3 PWA** (ADR-007). This is a deliberate choice for single-repo maintainability, but it has one direct consequence for voice: the native on-device SLM APIs (Apple Foundation Models, Gemini Nano via ML Kit) are inaccessible from a browser context — they require a Swift or Kotlin native wrapper. The PWA trades Tier 1 for the benefits of a single web stack.

The result is a **three-tier cascade** that is honest about this constraint:

#### Tier 0 — Structured Pattern Matching (always available, zero latency)

Before reaching any model, a deterministic rule engine handles the highest-frequency commands. These cover roughly 70% of real household voice interactions and need no inference at all.

```
"used 2 eggs"        → UPDATE_PANTRY  { item: "eggs", delta: -2, unit: "pcs" }
"add milk to list"   → ADD_TO_SHOPPING { item: "milk" }
"changed HVAC filter"→ LOG_MAINTENANCE { asset: "HVAC", task: "filter change" }
"spent $45 on food"  → LOG_EXPENSE    { amount: 45, categoryGuess: "food" }
```

Rules are defined in `spec/voice-patterns.yaml`, versioned in the repo, and compiled to a fast finite-state matcher at build time. No model, no network, no latency beyond string matching (<5ms). This is the **offline baseline** — HomeOS remains voice-functional with zero connectivity using this layer alone.

Pattern library starts with ~40 rules covering the v1 module actions and grows via user corrections over time.

#### Tier 1 — Cloud Inference via Groq (online only, free tier)

When a command doesn't match a Tier 0 pattern and the device is online, the system calls **Groq's inference API**:

- **Why Groq:** Groq runs open-source models (Llama 3.3 70B, Qwen3, etc.) on custom LPU hardware at 300–1000 tokens/second. For a short intent-parsing prompt (~200 tokens in, ~100 out), this yields sub-200ms cloud round-trip — fast enough to feel responsive in a home context.
- **Free tier:** 30 RPM / 1,000 RPD / 14,400 req/day at the organisation level, no credit card required. Sufficient for a household (HomeOS generates at most a few dozen voice commands per day).
- **Recommended model:** `llama-3.3-70b-versatile` — strong instruction following, reliable JSON output
- **Fallback model:** `llama-3.1-8b-instant` — faster, lower quality, used if rate-limited
- **Cost if outgrown:** ~$0.59–$0.79 per 1M tokens at paid tier — essentially free at household scale

> **Alternative free options considered:**
> - **Google AI Studio (Gemini Flash):** 1,500 RPD free, 1M TPM — more generous on volume, valid fallback if Groq limits are hit.
> - **OpenRouter free tier:** Aggregates multiple free models but rate limits are fragmented. Not recommended as primary.
> - **Self-hosted (Ollama + home server):** Architecturally ideal for local-first but requires always-on hardware most households don't have. Supported as optional advanced config, not the default.

#### Tier 2 — Graceful Degradation (offline, no pattern match)

When offline AND the command didn't match a Tier 0 pattern:

1. The transcribed text is stored locally with `parseStatus: 'deferred'`
2. The UI surfaces a **manual intent picker**: a Reka UI bottom sheet showing the 4–6 most likely action types with pre-filled fields extracted from keywords (no model needed)
3. The user confirms or corrects, then submits
4. When connectivity returns, the deferred text is optionally re-parsed via Tier 1 to improve the pattern library

This is the honest answer to the offline gap: T0 handles the common 70% offline; T2 catches everything else without leaving the user stranded.

---

**Voice Pipeline (full cascade):**

```
User speaks
    ↓
Speech-to-Text (Web Speech API)
  Chrome/Edge:  SpeechRecognition — reliable, works offline on Android
  Safari/iOS:   SpeechRecognition — requires user gesture each session;
                no persistent offline recognition
    ↓
[TIER 0] Pattern Matcher (voice-patterns.yaml compiled rules)
  Hit  → VoiceIntent[] (< 5ms, always works offline)
  Miss ↓
[TIER 1] Groq Cloud API (if online)
  Model: llama-3.3-70b-versatile
  Hit  → VoiceIntent[] (~150–400ms round-trip)
  Offline / rate-limited ↓
[TIER 2] Manual Intent Picker (always available)
  Reka UI bottom sheet, pre-filled from keyword extraction
    ↓
VoiceIntentSchema.safeParse() — structural validation
    ↓
Module Validator(s) — business logic validation
    ↓
Local DB Write(s) via @syncflow-db/core
    ↓
UI update (instant, optimistic)
    ↓
[background] syncflow-db sync to server
```

**Latency budget by tier:**

| Tier | Path | Target | Hard Limit | Offline? |
|------|------|--------|-----------|----------|
| T0 | Pattern match | < 5ms | 20ms | ✅ Always |
| T1 | Groq cloud | < 500ms | 1200ms | ❌ Online only |
| T2 | Manual picker | User-driven | — | ✅ Always |
| **STT + T0** | **Best case** | **< 350ms** | **900ms** | **✅** |
| **STT + T1** | **Typical online** | **< 850ms** | **1.8s** | **❌** |

**PWA / WebGPU note:**
WebGPU reached mobile browsers in early 2026 (iOS Safari 18.2, Android Chrome), making in-browser LLM inference technically possible via WebLLM. It remains excluded from HomeOS for three reasons specific to the PWA context: model downloads are 1–4GB (catastrophic first-run UX for a PWA install), browser inference is 3–10× slower than native on the same hardware, and battery drain from sustained GPU usage is significant. Monitor WebNN (the W3C API routing inference to device NPUs) for v3+ — it may close the performance gap without the download penalty.

---

## 3. Data Architecture

### 3.1 Module Registry

HomeOS is composed of independent but interconnected modules. This is the canonical module list. Modules not listed here are out of scope for v1.

| ID | Module | ERP Analogy | Status |
|----|--------|-------------|--------|
| `pantry` | Pantry & Shopping | Inventory + Procurement | **v1** |
| `assets` | Maintenance & Assets | Equipment + Preventive Maintenance | **v1** |
| `finance` | Finance & Budgeting | General Ledger + Accounts Payable | **v1** |
| `chores` | Chores & Tasks | Project Management | **v1** |
| `calendar` | Family Calendar | Resource Scheduling | **v1** |
| `meals` | Meal Planning | Manufacturing BOM | v2 |
| `docs` | Documents Vault | Document Management | v2 |
| `health` | Health & Care | HR / Personnel | v2 |
| `energy` | Energy & Utilities | Facilities Management | v3 |
| `projects` | Home Projects | Project Accounting | v3 |

### 3.2 Shared Backbone Entities

These entities are owned by `core` and referenced by all modules. No module may define its own version.

| Entity | Key Fields | Referenced By |
|--------|-----------|---------------|
| `HouseholdMember` | `_id`, `role`, `deviceIds` | All modules (createdBy, updatedBy, assignedTo) |
| `BudgetCategory` | `_id`, `type`, `monthlyBudgetLimit` | finance, pantry (shopping costs), assets (repair costs) |
| `Asset` | `_id`, `category`, `location` | assets, finance (linkedAssetId) |
| `PantryItem` | `_id`, `quantity`, `parLevel` | pantry, meals (ingredients), finance (linkedPantryItemId) |

### 3.3 Cross-Module Reference Rules

1. **Reference by UUID only.** Modules must never embed a copy of another module's entity. Store the `_id`, resolve at read time.
2. **Soft deletes must propagate.** If entity A is soft-deleted and entity B holds a reference to A's `_id`, the validator must flag B's reference as stale — not silently nullify it.
3. **Orphan prevention.** You cannot soft-delete an entity that has active dependents (e.g. cannot delete an `Asset` with `pending` `MaintenanceTask`s). See `CoreErrorCodes.ORPHAN_DELETE`.
4. **No circular references.** Module dependency graph must be a DAG.

### 3.4 Collection Naming Convention

All syncflow-db collections use `snake_case` and a module prefix:

```
pantry_items
pantry_shopping_list
assets_register
assets_maintenance_tasks
finance_budget_categories
finance_transactions
chores_tasks
core_household_members
```

---

## 4. The Validator Middleware Contract

The validator middleware is the enforcement layer between intent and storage. It must be the **only** path to the database — no module may call `db.insert()` / `db.update()` directly.

### 4.1 Pipeline Stages

```
VoiceIntent (or direct UI action)
    ↓
[Stage 1] Schema Validation      — Zod safeParse() on the input shape
    ↓
[Stage 2] Member Authorization   — Does createdBy have role permission for this action?
    ↓
[Stage 3] Business Logic Rules   — Module-specific validators (parLevel, budget limits, etc.)
    ↓
[Stage 4] Cross-Module Side Effects — Auto-generated records (shopping items, maintenance schedules)
    ↓
[Stage 5] Write Stamp            — Inject _id (if new), updatedAt, updatedBy, syncStatus: 'pending'
    ↓
[Stage 6] DB Write               — db.insert() or db.update() via syncflow-db
    ↓
[Stage 7] Notification Dispatch  — Trigger push notifications for threshold violations
```

### 4.2 Error Contract

All validation failures throw `SpecViolationError` (defined in `core.schema.ts`):

```typescript
throw new SpecViolationError(
  'PANTRY_NEGATIVE_QUANTITY',  // error code
  'pantry',                    // module
  'Quantity cannot go below 0. Attempted: -2', // human-readable message
  { itemId: '...', attempted: -2 } // structured context for logging
);
```

The voice processor catches `SpecViolationError` and converts it to a user-facing voice response: *"I couldn't do that — milk quantity would go negative. Should I set it to zero instead?"*

### 4.3 Role-Based Action Matrix

| Action | admin | adult | child | guest |
|--------|-------|-------|-------|-------|
| Read all modules | ✅ | ✅ | Pantry + Chores | Pantry + Chores |
| Log expense | ✅ | ✅ | ❌ | ❌ |
| Update pantry | ✅ | ✅ | ✅ | ❌ |
| Complete chore | ✅ | ✅ | ✅ | ❌ |
| Delete asset | ✅ | ❌ | ❌ | ❌ |
| Manage members | ✅ | ❌ | ❌ | ❌ |
| Set budget limits | ✅ | ✅ | ❌ | ❌ |
| View transactions | ✅ | ✅ | ❌ | ❌ |

---

## 5. Sync Strategy

### 5.1 Conflict Resolution by Entity Type

| Entity | Default Strategy | Rationale |
|--------|-----------------|-----------|
| `PantryItem` (quantity) | `last-write-wins` | Stale quantity is self-correcting at next use |
| `ShoppingListItem` (status) | `last-write-wins` | If two people buy the same item, no harm done |
| `MaintenanceTask` (status) | `last-write-wins` | Completing a task twice is harmless |
| `Transaction` | `manual` | Financial records must never be silently overwritten |
| `Asset` | `manual` | Asset records are long-lived and high-value |
| `BudgetCategory` | `merge-fields` | Name/color changes and limit changes can be reconciled field-by-field |
| `HouseholdMember` | `merge-fields` | Profile edits rarely conflict; role changes need manual review |

### 5.2 Negative Quantity Guard

A known failure mode of `last-write-wins` with pantry quantities: two household members consume the last unit simultaneously, producing quantity = -1.

**Required guard in the pantry validator:**
```
if (updatedQuantity < 0) → clamp to 0, emit SpecViolationError with code PANTRY_NEGATIVE_QUANTITY
```

The UI shows: *"[Item] is now at 0. Added to shopping list."*

### 5.3 Sync Frequency

| Condition | Sync Behavior |
|-----------|---------------|
| App in foreground, online | Continuous sync (syncflow-db `syncInterval: 30000`) |
| App backgrounded, online | Push-triggered sync on server change; local writes queue |
| App offline | All writes queue as `syncStatus: 'pending'`; sync on reconnect |
| Conflict detected | Pause sync for affected record; surface conflict card in UI |

---

## 6. Voice Intent Resolution

### 6.1 Category Fuzzy Matching (Fixing Qwen's Gap)

The `categoryGuess` field in `VoiceIntentSchema` is a free string from the LLM. The validator must resolve it to a `BudgetCategory._id` via this pipeline:

```
Step 1 — Exact match (case-insensitive)
    "Groceries" → BudgetCategory where name.toLowerCase() === "groceries"

Step 2 — Alias lookup
    "Food", "Supermarket", "Produce" → mapped to "Groceries" via a seeded alias table
    (aliases are user-editable; system provides defaults)

Step 3 — Embedding similarity (future / v2)
    If Steps 1–2 fail, use vector similarity against category names

Step 4 — Fallback: prompt user
    If no match found → throw SpecViolationError(FINANCE_UNKNOWN_CATEGORY)
    Voice response: "I'm not sure which budget category that is. 
                    Did you mean Groceries, Home Repair, or something else?"
```

### 6.2 Item Fuzzy Matching (Pantry)

Same pattern for `itemName` → `PantryItem._id`:

```
Step 1 — Exact match on name field
Step 2 — Levenshtein distance ≤ 2 on name field  ("mlk" → "Milk")
Step 3 — Substring match                          ("whole milk" → "Milk")
Step 4 — Fallback: create new item with parLevel: 1, prompt for location
```

---

## 7. Morning Briefing (The Daily Digest)

The "Morning Briefing" is HomeOS's primary proactive output — a daily push notification delivered at a user-configured time (default 7:00 AM local) summarizing everything that requires attention.

The briefing must be **generated locally** (no server required) from the local DB state.

**Content priority order:**
1. 🔴 Overdue maintenance tasks
2. 🔴 Expiring pantry items (within 48 hours)
3. 🟠 Items below par level not yet on shopping list
4. 🟠 Budget categories over 90% of monthly limit
5. 🟡 Maintenance tasks due within 7 days
6. 🟡 Warranties expiring within 30 days
7. 🟢 Chores assigned for today

**Format:** Voice-readable summary (TTS-compatible), no markdown, no bullet characters in the text string.

---

## 8. What Is Explicitly Out of Scope (v1)

Documenting non-scope prevents scope creep and premature generalization.

| Feature | Reason Deferred |
|---------|----------------|
| Multi-household support | Single household assumed; data model doesn't prevent future extension |
| External bank sync (Plaid, etc.) | Manual entry + receipt scan first; bank sync is v2 |
| Smart home integration (IoT) | Voice + manual input first; IoT is v3 |
| Social / sharing with non-members | Privacy model is household-only for v1 |
| Recurring transaction auto-import | Out of scope until bank sync lands |
| AI meal suggestions | Meal planning module is v2 |
| Encryption at rest | Planned in @syncflow-db/core v0.4.0+; adopt when available |
| Native desktop app | Mobile + PWA first |
| Browser-based LLM (WebLLM) | Model download 1–4GB, inference 3–10× slower than native, significant battery drain; revisit when WebNN matures (v3+) |
| Native on-device SLM (Apple Foundation Models / Gemini Nano) | Requires native app wrapper; excluded by PWA decision (ADR-007). Revisit if a native shell is ever added |
| Self-hosted LLM (Ollama) | Optional advanced config; not the default — requires always-on home hardware |
| Custom intent model fine-tuning | Tier 0 pattern matching + Tier 1 (Groq) sufficient for v1; fine-tuned model is a v3 quality upgrade |
| React Native / native app | Single Vue 3 PWA repo preferred for maintainability (ADR-007) |

---

## 9. Module Spec Checklist

Every module spec (SPEC-005 through SPEC-013) must include:

- [ ] Schema file extending `BaseEntitySchema` with correct `conflictResolutionStrategy` override
- [ ] Explicit list of Auto-Validator Rules (business logic)
- [ ] Role-based access restrictions (which roles can CRUD this module)
- [ ] Cross-module side effects declared (what other modules does a write trigger)
- [ ] Orphan prevention rules (what blocks deletion)
- [ ] Voice intent mappings (which `VoiceIntent` actions affect this module)
- [ ] Morning Briefing contribution (what does this module add to the daily digest)
- [ ] Error codes (following `MODULE_SCREAMING_SNAKE` convention)
- [ ] Out-of-scope items specific to this module

---

## 10. Versioning & Change Control

| Version | Meaning |
|---------|---------|
| `0.x.x` | Pre-release spec; breaking changes allowed with notice |
| `1.0.0` | Locked spec; breaking changes require a new major version and migration plan |

**Breaking change definition:** Any change to `BaseEntitySchema`, `VoiceIntentSchema`, or a module's collection name. Adding new optional fields is non-breaking. Removing or renaming fields is always breaking.

Spec changes must be reviewed against all downstream module specs before merging.

---

*End of SPEC-000*
