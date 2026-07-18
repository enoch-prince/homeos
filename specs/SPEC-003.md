# SPEC-003 — Voice Grammar & Intent Pipeline

**Version:** 0.1.0  
**Status:** Draft  
**Depends on:** SPEC-000, SPEC-001  
**Last Updated:** 2026-06-14

---

## 1. Purpose

This spec defines the complete contract between spoken language and `VoiceIntent` objects. It covers the Tier 0 pattern grammar, the LLM prompt contract for Tier 1/2, the fuzzy resolution pipelines, and the error-to-speech mapping.

---

## 2. Tier 0 — Pattern Grammar

Patterns live in `spec/voice-patterns.yaml`. Each pattern has:
- `id` — stable identifier for ADR references and pattern library analytics
- `action` — the `VoiceIntent` action it maps to
- `patterns` — array of regex strings (case-insensitive, whitespace-normalised)
- `extract` — named capture groups that map to payload fields

### 2.1 Grammar conventions

- Numbers: `(?<qty>\\d+(?:\\.\\d+)?)` — matches integers and decimals
- Units: `(?<unit>kg|g|lbs?|oz|litres?|liters?|L|ml|pcs?|pieces?|box(?:es)?|bags?)`
- Currency: `(?<amount>\\$?\\d+(?:\\.\\d+)?)` — optional dollar sign
- Item names: `(?<item>[a-z][a-z\\s]{0,30})` — 1–31 chars, letters and spaces
- Verbs for consumption: `used?|ate|consumed|finished|ran out of|opened`
- Verbs for addition: `bought|purchased|got|picked up|added`

### 2.2 Pattern examples (canonical subset)

```yaml
- id: rule_pantry_consume_v1
  action: UPDATE_PANTRY
  patterns:
    - "(?:i\\s+)?(?:used?|ate|consumed|finished)\\s+(?<qty>[\\d.]+)\\s*(?<unit>kg|g|lbs?|L|ml|pcs?)?\\s+(?:of\\s+)?(?<item>[a-z][a-z\\s]{0,30})"
    - "(?:we\\s+)?ran out of\\s+(?<item>[a-z][a-z\\s]{0,30})"
  extract:
    actionType: subtract
    qty: "1"         # default when not captured
    unit: "pcs"      # default when not captured

- id: rule_shopping_add_v1
  action: ADD_TO_SHOPPING
  patterns:
    - "add\\s+(?<item>[a-z][a-z\\s]{0,30})\\s+to\\s+(?:the\\s+)?(?:shopping\\s+)?list"
    - "(?:we\\s+)?need\\s+(?:more\\s+)?(?<item>[a-z][a-z\\s]{0,30})"
    - "(?:get|buy|pick up)\\s+(?<item>[a-z][a-z\\s]{0,30})"

- id: rule_expense_log_v1
  action: LOG_EXPENSE
  patterns:
    - "(?:i\\s+)?(?:spent|paid)\\s+(?<amount>\\$?[\\d.]+)\\s+(?:on|for)\\s+(?<note>[a-z][a-z\\s,]{0,50})"
    - "(?:log|record|add)\\s+(?:an?\\s+)?expense\\s+(?:of\\s+)?(?<amount>\\$?[\\d.]+)"

- id: rule_maintenance_done_v1
  action: LOG_MAINTENANCE
  patterns:
    - "(?:i\\s+)?(?:changed|replaced|fixed|serviced|cleaned)\\s+(?:the\\s+)?(?<asset>[a-z][a-z\\s]{0,30})(?:\\s+(?<task>[a-z][a-z\\s]{0,50}))?"
    - "(?:maintenance|service)\\s+done\\s+(?:on\\s+)?(?:the\\s+)?(?<asset>[a-z][a-z\\s]{0,30})"

- id: rule_chore_done_v1
  action: COMPLETE_CHORE
  patterns:
    - "(?:i\\s+)?(?:did|finished|completed|done)\\s+(?:the\\s+)?(?<chore>[a-z][a-z\\s]{0,50})"
    - "(?<chore>[a-z][a-z\\s]{0,50})\\s+(?:is\\s+)?done"
```

---

## 3. Tier 1/2 — LLM Prompt Contract

When Tier 0 misses, the transcript is sent to the on-device SLM (Tier 1) or Groq (Tier 2) with this system prompt:

```
You are a home management assistant. Parse the user's voice command into one or more structured intents.

Return ONLY a JSON array. No preamble, no markdown fences.

Available actions and their required payload fields:

UPDATE_PANTRY    → { itemName: string, quantity: number, unit: UOM, actionType: "add"|"subtract", location?: Location }
ADD_TO_SHOPPING  → { itemName: string, quantity?: number, unit?: UOM }
LOG_EXPENSE      → { amount: number, categoryGuess: string, note?: string, linkedItem?: string }
LOG_MAINTENANCE  → { assetName: string, taskTitle: string, completed: boolean }
COMPLETE_CHORE   → { choreTitle: string }
ADD_CALENDAR     → { title: string, startAt: ISO8601, endAt?: ISO8601, isAllDay?: boolean, attendees?: string[] }

UOM values:  pcs | kg | g | L | ml | lbs | oz | box | bag
Location values: Fridge | Freezer | Pantry | Garage | Other

Rules:
- One command may produce multiple intents (e.g. "bought milk for $4" → UPDATE_PANTRY + LOG_EXPENSE)
- If you cannot confidently parse a field, omit it (do not guess quantities or amounts)
- Return [] if the command has no actionable home management intent
- All strings in English regardless of input language

Examples:
Input: "I used 2 eggs this morning"
Output: [{"action":"UPDATE_PANTRY","payload":{"itemName":"eggs","quantity":2,"unit":"pcs","actionType":"subtract"}}]

Input: "Spent forty dollars at the pharmacy for cold medicine"
Output: [{"action":"LOG_EXPENSE","payload":{"amount":40,"categoryGuess":"Healthcare","note":"cold medicine"}}]

Input: "Changed the HVAC filter and it cost me sixty bucks"
Output: [{"action":"LOG_MAINTENANCE","payload":{"assetName":"HVAC","taskTitle":"filter replacement","completed":true}},{"action":"LOG_EXPENSE","payload":{"amount":60,"categoryGuess":"Home Repair","note":"HVAC filter"}}]
```

### 3.1 Response validation

The voice processor must:
1. Parse the JSON array response
2. Run `VoiceIntentSchema.safeParse()` on each element
3. Discard any element that fails parsing (log to console, do not throw)
4. If the array is empty after validation → escalate to Tier 3

---

## 4. Entity Resolution Pipeline

After parsing, free-string fields must be resolved to entity IDs before the validator can write.

### 4.1 `itemName` → `PantryItem._id`

```
Step 1 — Exact match (case-insensitive) on PantryItem.name
Step 2 — Levenshtein distance ≤ 2  ("mlk" → "Milk")
Step 3 — Substring match            ("whole milk" → "Milk")
Step 4 — No match → create new PantryItem with:
            name: itemName (title-cased)
            quantity: (from intent, or 1)
            unit: (from intent, or 'pcs')
            parLevel: 1
            location: 'Pantry'
          Speak: "I added [item] to your pantry for the first time."
```

### 4.2 `categoryGuess` → `BudgetCategory._id`

```
Step 1 — Exact match (case-insensitive) on BudgetCategory.name
Step 2 — Match against BudgetCategory.aliases array
Step 3 — No match → throw SpecViolationError(FINANCE_UNKNOWN_CATEGORY)
          Speak: "I'm not sure which budget category that is.
                  Did you mean [top 3 category names]?"
```

### 4.3 `assetName` → `Asset._id`

```
Step 1 — Exact match (case-insensitive) on Asset.name
Step 2 — Substring match ("HVAC" matches "HVAC System")
Step 3 — No match → prompt user:
          Speak: "I don't have [assetName] in your asset register.
                  Should I add it as a new asset?"
          If yes → create Asset with category: 'Other', note instructions for completion
```

### 4.4 `choreTitle` → `ChoreTask._id`

```
Step 1 — Exact match on ChoreTask.title (pending tasks only)
Step 2 — Levenshtein distance ≤ 3
Step 3 — No match → create new one-off ChoreTask with status: 'completed',
                    completedAt: now()
```

---

## 5. Multi-Intent Ordering

When a voice command produces multiple intents, they must be processed in dependency order:

1. `UPDATE_PANTRY` — always first (establishes item ID for other intents)
2. `ADD_TO_SHOPPING` — after pantry (can reference the pantry item)
3. `LOG_MAINTENANCE` — before expense (establishes asset ID)
4. `LOG_EXPENSE` — last (can reference item or asset IDs from above)
5. `COMPLETE_CHORE` — independent; can run in any position
6. `ADD_CALENDAR` — independent; can run in any position

If any intent in the sequence throws a `SpecViolationError`, processing continues for independent intents but stops for dependents. The voice processor collects all errors and reads them out at the end.

---

## 6. Voice Response Contract

The voice processor must synthesize a spoken confirmation for every successful write and a spoken error for every `SpecViolationError`. Responses must be:

- Under 25 words
- Free of markdown, bullet characters, and technical jargon
- Present-tense and affirmative ("Done." / "Added." / "I couldn't do that because...")

### 6.1 Success templates

| Action | Template |
|--------|----------|
| `UPDATE_PANTRY` (subtract) | "Got it. [qty] [unit] of [item] removed. [X] remaining." |
| `UPDATE_PANTRY` (add) | "[item] updated to [qty] [unit]." |
| `ADD_TO_SHOPPING` | "[item] added to your shopping list." |
| `LOG_EXPENSE` | "[amount] logged to [category]." |
| `LOG_MAINTENANCE` | "[task] on [asset] marked complete." |
| `COMPLETE_CHORE` | "[chore] done! [member] earned [points] points." |
| `ADD_CALENDAR` | "[title] added to the calendar for [date]." |

### 6.2 Error templates

| Error code | Spoken response |
|------------|----------------|
| `PANTRY_NEGATIVE_QUANTITY` | "[item] would go to zero. I've set it to zero and added it to your list." |
| `FINANCE_UNKNOWN_CATEGORY` | "Which budget category? [opt1], [opt2], or something else?" |
| `CORE_MISSING_MEMBER` | "I'm not sure who's speaking. Which household member are you?" |
| `ASSETS_ORPHAN_TASK` | "That asset has open tasks. Complete them first, or say 'force delete'." |
| `CORE_VOICE_PARSE_DEFERRED` | "I didn't quite get that. Here are some options — tap the one you meant." |
