# Homeos

**An Enterprise-grade management for your household** — a modular, local-first, voice-first home management PWA built with Vue 3.

   > _The house manager that lives in your pocket._

Homeos...
   > _Run your home like it means business._

## Architecture

HomeOS is a pnpm monorepo with three packages:

| Package | Purpose |
|---------|---------|
| `@homeos/app` | Vue 3 PWA (Vite, Pinia, vue-router, Reka UI, Tailwind, PWA) |
| `@homeos/backend` | Node.js service layer (validators, voice processor, mock DB, tests) |
| `@homeos/schemas` | Shared Zod schemas (pantry, finance, chores, calendar, assets, voice intents, core) |

## The Three Pillars

1. **Local-First** — Writes go to local SQLite (`@syncflow-db/core`) before any network call. Offline is a first-class state.
2. **Mobile-First** — Thumb-reachable, single-hand design. Minimum 48×48dp touch targets, progressive disclosure, dark-mode default.
3. **Voice-First** — Every core action has a voice equivalent. A three-tier cascade handles intent parsing:
   - **Tier 0:** Deterministic pattern matching (~70% of commands, <5ms, always offline)
   - **Tier 1:** Groq cloud inference (~150–400ms, online only)
   - **Tier 2:** Manual intent picker bottom sheet (offline fallback)

## Modules

| ID | Module | Status |
|----|--------|--------|
| `pantry` | Pantry & Shopping | v1 |
| `assets` | Maintenance & Assets | v1 |
| `finance` | Finance & Budgeting | v1 |
| `chores` | Chores & Tasks | v1 |
| `calendar` | Family Calendar | v1 |
| `meals` | Meal Planning | v2 |
| `docs` | Documents Vault | v2 |
| `health` | Health & Care | v2 |
| `energy` | Energy & Utilities | v3 |
| `projects` | Home Projects | v3 |

## Data Model

All data flows through a **validator middleware contract** — the only path to the database. The pipeline enforces schema validation, member authorization, business rules, cross-module side effects, and write stamps before any DB write. See `specs/SPEC-000.md` for the full architecture.

## Prerequisites

- Node.js >= 18
- pnpm 11.x

## Getting Started

```bash
# Install dependencies
pnpm install

# Run the app in dev mode
pnpm dev

# Build the app
pnpm build

# Run backend tests
pnpm test

# Typecheck all packages
pnpm typecheck
```

## Specs

Detailed specifications live in `specs/`:

- `SPEC-000.md` — Philosophy & Foundational Principles
- `SPEC-001.md` — System Architecture
- `SPEC-002.md` — Voice Pipeline
- `SPEC-003.md` — Sync Strategy
- `SPEC-004.md` — UI/UX Design System
- `SPEC-005.md` — Pantry & Shopping
- `SPEC-006.md` — Maintenance & Assets
- `SPEC-007.md` — Finance & Budgeting
- `SPEC-008.md` — Chores & Tasks
- `SPEC-009.md` — Family Calendar
- `SPEC-013.md` — Validator Middleware

## License

Private — HomeOS Architecture Team
