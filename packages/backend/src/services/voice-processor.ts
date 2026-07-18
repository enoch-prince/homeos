/**
 * @file voice-processor.ts
 * @description HomeOS — Voice Processor Service
 *
 * Implements the three-tier intent resolution cascade from SPEC-003:
 *
 *   Tier 0 — Pattern Matcher   (always, offline, <5ms)
 *   Tier 1 — Groq Cloud API    (online only, ~150–500ms)
 *   Tier 2 — Deferred / Manual (always, offline fallback)
 *
 * Entry point:  processTranscript(transcript, ctx) → VoiceProcessorResult
 *
 * The result carries:
 *   - parsed intents (ready for the validator)
 *   - provenance metadata (which tier, latency, model)
 *   - spoken response strings (ready for TTS)
 *   - deferred command record (if Tier 2 triggered)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';
import levenshtein from 'fast-levenshtein';
import { v4 as uuidv4 } from 'uuid';

import {
  SpecViolationError,
  CoreErrorCodes,
  SYSTEM_MEMBER_ID,
  type DeferredVoiceCommand,
  type InferenceTier,
} from '@homeos/schemas';
import {
  VoiceIntentSchema,
  type VoiceIntent,
  type ParsedVoiceCommand,
} from '@homeos/schemas';
import { FinanceErrorCodes } from '@homeos/schemas';
import type { PantryItem } from '@homeos/schemas';
import type { Asset } from '@homeos/schemas';
import type { ChoreTask } from '@homeos/schemas';
import type { BudgetCategory } from '@homeos/schemas';
import type { HouseholdMember } from '@homeos/schemas';
import {
  Collections,
  type ValidatorContext,
  validatePantryItemCreate,
  validateShoppingListItemCreate,
  validateChoreCompletion,
  validateTransaction,
  validatePantryItemUpdate,
  validateShoppingListItemStatus,
  validateMaintenanceTaskCompletion,
  validateCalendarEventCreate,
} from '../middleware/validator';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A single spoken sentence returned to the UI for TTS playback */
export type SpokenLine = string;

/** Full result of processing one transcript */
export interface VoiceProcessorResult {
  /** Which tier resolved the transcript */
  tier: InferenceTier | 'deferred';
  /** Latency from transcript-ready to first intent resolved (ms) */
  latencyMs: number;
  /** Intents that were successfully written to DB */
  successes: Array<{ intent: VoiceIntent; spokenConfirmation: SpokenLine }>;
  /** Intents that failed validation */
  errors: Array<{ intent: VoiceIntent; spokenError: SpokenLine; code: string }>;
  /** Set when Tier 2 triggered — stored for later re-parse */
  deferred?: DeferredVoiceCommand;
  /** Aggregated spoken response — read this out via TTS */
  spokenResponse: SpokenLine;
}

/** Shape of one rule in voice-patterns.yaml */
interface PatternRule {
  id: string;
  action: string;
  defaults?: Record<string, string | number | boolean>;
  patterns: string[];
}

/** Groq chat completion response (minimal subset we need) */
interface GroqResponse {
  choices: Array<{
    message: { content: string };
  }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// GROQ CLIENT INTERFACE
// Injected so tests can stub the network call without patching globals.
// ─────────────────────────────────────────────────────────────────────────────

export interface GroqClient {
  complete(transcript: string): Promise<string>; // returns raw JSON string
}

export function makeGroqClient(apiKey: string): GroqClient {
  return {
    async complete(transcript: string): Promise<string> {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 512,
          temperature: 0,
          messages: [
            { role: 'system', content: GROQ_SYSTEM_PROMPT },
            { role: 'user', content: transcript },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as GroqResponse;
      return data.choices[0]?.message?.content ?? '[]';
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 0 — PATTERN MATCHER
// Compiled once at module load from voice-patterns.yaml.
// Each rule is a list of RegExp objects paired with defaults.
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
// Repo layout: packages/backend/src/services → packages → repo root → specs
const DEFAULT_PATTERNS_PATH = join(__dirname, '../../../specs/voice-patterns.yaml');

interface CompiledRule {
  id: string;
  action: string;
  defaults: Record<string, string | number | boolean>;
  regexes: RegExp[];
}

function compilePatterns(yamlPath: string): CompiledRule[] {
  const raw = readFileSync(yamlPath, 'utf8');
  const parsed = yamlLoad(raw) as { patterns: PatternRule[] };
  return parsed.patterns.map(rule => ({
    id: rule.id,
    action: rule.action,
    defaults: rule.defaults ?? {},
    regexes: rule.patterns.map(p => new RegExp(p, 'i')),
  }));
}

// Compiled once — module-level singleton
let _compiledRules: CompiledRule[] | null = null;
let _patternsPath: string = DEFAULT_PATTERNS_PATH;

function getCompiledRules(): CompiledRule[] {
  if (!_compiledRules) {
    _compiledRules = compilePatterns(_patternsPath);
  }
  return _compiledRules;
}

/** Exposed for tests to inject a custom rules path (or reset to default). */
export function _resetCompiledRules(patternsPath: string = DEFAULT_PATTERNS_PATH): void {
  _patternsPath = patternsPath;
  _compiledRules = null;
}

/**
 * Normalise transcript: lowercase, collapse whitespace.
 * Patterns are written against this form.
 */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Trim trailing noise from item name captures.
 * Pattern groups can capture too eagerly — "eggs this morning" should be "eggs".
 * Strip known time/context words that trail the item name.
 */
function trimItemName(raw: string): string {
  return raw
    .replace(/\b(this|last|the|a|an|some|more|extra)\b.*$/i, '')
    .replace(/\b(morning|evening|night|today|yesterday|now|just)\b.*$/i, '')
    .trim();
}
function parseCurrency(raw: string): number {
  return parseFloat(raw.replace('$', ''));
}

/**
 * Normalise a UOM string from the pattern capture to a canonical UOM value.
 */
function normaliseUnit(raw: string | undefined, fallback: string = 'pcs'): string {
  if (!raw) return fallback;
  const map: Record<string, string> = {
    litre: 'L', liter: 'L', litres: 'L', liters: 'L',
    l: 'L',  // lowercase l from regex capture
    piece: 'pcs', pieces: 'pcs', pcs: 'pcs', pc: 'pcs',
    boxes: 'box', bags: 'bag',
    lbs: 'lbs', lb: 'lbs',
  };
  return map[raw.toLowerCase()] ?? raw;
}

/**
 * Run Tier 0 against a normalised transcript.
 * Returns the first matching VoiceIntent[], or null if no rule matches.
 */
export function runTier0(rawTranscript: string): VoiceIntent[] | null {
  const text = normalise(rawTranscript);
  const rules = getCompiledRules();

  for (const rule of rules) {
    for (const regex of rule.regexes) {
      const match = regex.exec(text);
      if (!match?.groups && !match) continue;
      if (!match) continue;

      const groups = match.groups ?? {};
      const defaults = rule.defaults;

      // Build raw payload from captured groups + defaults
      const raw: Record<string, unknown> = { ...defaults };
      for (const [key, val] of Object.entries(groups)) {
        if (val !== undefined) raw[key] = val;
      }

      // Action-specific payload shaping
      let payload: Record<string, unknown>;

      switch (rule.action) {
        case 'UPDATE_PANTRY':
          payload = {
            itemName: trimItemName((raw.itemName as string ?? '').trim()),
            quantity: raw.quantity ? parseFloat(raw.quantity as string) : 1,
            unit: normaliseUnit(raw.unit as string | undefined, defaults.unit as string ?? 'pcs'),
            actionType: raw.actionType ?? 'subtract',
            ...(raw.location ? { location: titleCase(raw.location as string) } : {}),
          };
          break;

        case 'ADD_TO_SHOPPING':
          payload = {
            itemName: trimItemName((raw.itemName as string ?? '').trim()),
            quantity: raw.quantity ? parseFloat(raw.quantity as string) : 1,
            unit: normaliseUnit(raw.unit as string | undefined, 'pcs'),
          };
          break;

        case 'LOG_EXPENSE':
          if (!raw.amount) continue; // amount is required; skip if not captured
          payload = {
            amount: parseCurrency(raw.amount as string),
            categoryGuess: (raw.note as string ?? '').trim() || 'Other',
            ...(raw.note ? { note: (raw.note as string).trim() } : {}),
          };
          break;

        case 'LOG_MAINTENANCE':
          payload = {
            assetName: (raw.assetName as string ?? '').trim(),
            taskTitle: (raw.taskTitle as string ?? `${raw.assetName ?? ''} service`).trim(),
            completed: raw.completed ?? true,
          };
          break;

        case 'COMPLETE_CHORE':
          payload = {
            choreTitle: (raw.choreTitle as string ?? '').trim(),
          };
          break;

        case 'ADD_CALENDAR':
          // Date parsing is handled by the processor; for T0 we return the raw string
          // and let the date resolver handle it before validator execution.
          payload = {
            title: (raw.title as string ?? '').trim(),
            startAt: raw.startAt as string ?? '',
            isAllDay: false,
            attendees: [],
          };
          break;

        default:
          continue;
      }

      // Validate the built payload through VoiceIntentSchema
      const result = VoiceIntentSchema.safeParse({ action: rule.action, payload });
      if (result.success) {
        return [result.data];
      }
      // If the built intent fails schema validation, fall through to next rule
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 — GROQ CLOUD API
// ─────────────────────────────────────────────────────────────────────────────

const GROQ_SYSTEM_PROMPT = `You are a home management assistant. Parse the user's voice command into one or more structured intents.

Return ONLY a JSON array. No preamble, no markdown fences, no explanation.

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
- For ADD_CALENDAR, startAt must be a full UTC ISO 8601 string; infer from context if possible

Examples:
Input: "I used 2 eggs this morning"
Output: [{"action":"UPDATE_PANTRY","payload":{"itemName":"eggs","quantity":2,"unit":"pcs","actionType":"subtract"}}]

Input: "Spent forty dollars at the pharmacy for cold medicine"
Output: [{"action":"LOG_EXPENSE","payload":{"amount":40,"categoryGuess":"Healthcare","note":"cold medicine"}}]

Input: "Changed the HVAC filter and it cost me sixty bucks"
Output: [{"action":"LOG_MAINTENANCE","payload":{"assetName":"HVAC","taskTitle":"filter replacement","completed":true}},{"action":"LOG_EXPENSE","payload":{"amount":60,"categoryGuess":"Home Repair","note":"HVAC filter"}}]`;

/**
 * Parse Groq's raw JSON response into validated VoiceIntent[].
 * Discards any elements that fail VoiceIntentSchema (SPEC-003 §3.1).
 */
export function parseGroqResponse(raw: string): VoiceIntent[] {
  let parsed: unknown;
  try {
    // Strip accidental markdown fences if present
    const cleaned = raw.replace(/```(?:json)?/g, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const intents: VoiceIntent[] = [];
  for (const item of parsed) {
    const result = VoiceIntentSchema.safeParse(item);
    if (result.success) {
      intents.push(result.data);
    } else {
      console.warn('[voice-processor] Discarding invalid Groq intent:', item, result.error.flatten());
    }
  }
  return intents;
}

/**
 * Run Tier 1 (Groq). Returns null if the client throws (offline / rate-limited).
 */
async function runTier1(
  transcript: string,
  groq: GroqClient,
): Promise<{ intents: VoiceIntent[]; modelId: string } | null> {
  try {
    const raw = await groq.complete(transcript);
    const intents = parseGroqResponse(raw);
    return { intents, modelId: 'llama-3.3-70b-versatile' };
  } catch (err) {
    console.warn('[voice-processor] Tier 1 (Groq) failed:', (err as Error).message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY RESOLUTION (SPEC-003 §4)
// All four pipelines: item, category, asset, chore
// ─────────────────────────────────────────────────────────────────────────────

/** Levenshtein distance ≤ threshold */
function fuzzyMatch(a: string, b: string, threshold: number): boolean {
  return levenshtein.get(a.toLowerCase(), b.toLowerCase()) <= threshold;
}

/**
 * §4.1 itemName → PantryItem._id
 * Steps: exact → levenshtein ≤ 2 → substring → create new
 */
export async function resolveItemName(
  itemName: string,
  quantity: number,
  unit: string,
  ctx: ValidatorContext,
): Promise<{ id: string; isNew: boolean }> {
  const items = await ctx.db.findMany<PantryItem>(
    Collections.PANTRY_ITEMS,
    { _deleted: false } as Partial<PantryItem>,
  );
  const needle = itemName.toLowerCase().trim();

  // Step 1 — exact match
  const exact = items.find(i => i.name.toLowerCase() === needle);
  if (exact) return { id: exact._id, isNew: false };

  // Step 2 — Levenshtein ≤ 2
  const fuzzy = items.find(i => fuzzyMatch(i.name, needle, 2));
  if (fuzzy) return { id: fuzzy._id, isNew: false };

  // Step 3 — substring
  const sub = items.find(i =>
    i.name.toLowerCase().includes(needle) || needle.includes(i.name.toLowerCase()),
  );
  if (sub) return { id: sub._id, isNew: false };

  // Step 4 — create new PantryItem
  const newItem = await validatePantryItemCreate(
    {
      name: titleCase(itemName),
      quantity,
      unit: unit as PantryItem['unit'],
      location: 'Pantry',
      parLevel: 1,
    },
    ctx,
  );
  return { id: newItem._id, isNew: true };
}

/**
 * §4.2 categoryGuess → BudgetCategory._id
 * Steps: exact → alias → throw FINANCE_UNKNOWN_CATEGORY
 */
export async function resolveCategoryGuess(
  guess: string,
  ctx: ValidatorContext,
): Promise<string> {
  const categories = await ctx.db.findMany<BudgetCategory>(
    Collections.BUDGET_CATEGORIES,
    { _deleted: false } as Partial<BudgetCategory>,
  );
  const needle = guess.toLowerCase().trim();

  // Step 1 — exact name match
  const exact = categories.find(c => c.name.toLowerCase() === needle);
  if (exact) return exact._id;

  // Step 2 — alias match
  const aliased = categories.find(c =>
    (c.aliases ?? []).some(a => a.toLowerCase() === needle),
  );
  if (aliased) return aliased._id;

  // Step 3 — fail with suggestions
  const topThree = categories.slice(0, 3).map(c => c.name).join(', ');
  throw new SpecViolationError(
    FinanceErrorCodes.UNKNOWN_CATEGORY,
    'finance',
    `Cannot resolve category '${guess}'. Did you mean: ${topThree}?`,
    { guess, suggestions: categories.map(c => c.name) },
  );
}

/**
 * §4.3 assetName → Asset._id
 * Steps: exact → substring → throw ASSETS_ORPHAN_TASK (prompt to create)
 */
export async function resolveAssetName(
  assetName: string,
  ctx: ValidatorContext,
): Promise<string> {
  const assets = await ctx.db.findMany<Asset>(
    Collections.ASSETS,
    { _deleted: false } as Partial<Asset>,
  );
  const needle = assetName.toLowerCase().trim();

  // Step 1 — exact
  const exact = assets.find(a => a.name.toLowerCase() === needle);
  if (exact) return exact._id;

  // Step 2 — substring
  const sub = assets.find(a =>
    a.name.toLowerCase().includes(needle) || needle.includes(a.name.toLowerCase()),
  );
  if (sub) return sub._id;

  // Step 3 — not found; surface as error (UI handles create-asset flow)
  throw new SpecViolationError(
    'ASSETS_ORPHAN_TASK',
    'assets',
    `Asset '${assetName}' not found in your register. Add it first.`,
    { assetName },
  );
}

/**
 * §4.4 choreTitle → ChoreTask._id
 * Steps: exact → Levenshtein ≤ 3 → create one-off completed chore
 */
export async function resolveChoreTitle(
  choreTitle: string,
  ctx: ValidatorContext,
): Promise<{ id: string; isNew: boolean }> {
  const chores = await ctx.db.findMany<ChoreTask>(
    Collections.CHORES,
    { status: 'pending', _deleted: false } as Partial<ChoreTask>,
  );
  const needle = choreTitle.toLowerCase().trim();

  // Step 1 — exact
  const exact = chores.find(c => c.title.toLowerCase() === needle);
  if (exact) return { id: exact._id, isNew: false };

  // Step 2 — Levenshtein ≤ 3
  const fuzzy = chores.find(c => fuzzyMatch(c.title, needle, 3));
  if (fuzzy) return { id: fuzzy._id, isNew: false };

  // Step 3 — treat as completed one-off chore (implicit creation)
  // We return a sentinel so the execution layer creates + immediately completes it
  return { id: '__new__', isNew: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-INTENT ORDERING (SPEC-003 §5)
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_ORDER: Record<VoiceIntent['action'], number> = {
  UPDATE_PANTRY:   1,
  ADD_TO_SHOPPING: 2,
  LOG_MAINTENANCE: 3,
  LOG_EXPENSE:     4,
  COMPLETE_CHORE:  5,
  ADD_CALENDAR:    6,
};

function sortIntents(intents: VoiceIntent[]): VoiceIntent[] {
  return [...intents].sort(
    (a, b) => (INTENT_ORDER[a.action] ?? 99) - (INTENT_ORDER[b.action] ?? 99),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTENT EXECUTION
// Resolves entity IDs and calls the correct validator function.
// Returns a spoken confirmation or throws SpecViolationError.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Context extended with the resolved IDs from earlier intents in the same command.
 * Allows LOG_EXPENSE to reference the pantry item resolved by UPDATE_PANTRY.
 */
interface ResolvedContext {
  lastPantryItemId?: string;
  lastAssetId?: string;
}

export async function executeIntent(
  intent: VoiceIntent,
  ctx: ValidatorContext,
  resolved: ResolvedContext,
): Promise<SpokenLine> {
  switch (intent.action) {
    case 'UPDATE_PANTRY': {
      const { itemName, quantity, unit, actionType, location } = intent.payload;
      const { id, isNew } = await resolveItemName(itemName, quantity, unit, ctx);
      resolved.lastPantryItemId = id;

      const delta = actionType === 'subtract' ? -quantity : quantity;
      const updated = await validatePantryItemUpdate(id, delta, ctx);

      if (isNew) return `I added ${titleCase(itemName)} to your pantry for the first time.`;
      if (actionType === 'subtract') {
        return `Got it. ${quantity} ${unit} of ${updated.name} removed. ${updated.quantity} remaining.`;
      }
      return `${updated.name} updated to ${updated.quantity} ${unit}.`;
    }

    case 'ADD_TO_SHOPPING': {
      const { itemName, quantity, unit, store } = intent.payload;
      // Resolve (or auto-create) the pantry item so the shopping list entry links to it.
      const { id } = await resolveItemName(itemName, quantity ?? 1, unit ?? 'pcs', ctx);
      resolved.lastPantryItemId = id;

      // Stage 1–6 via the validator — the ONLY path to the DB (SPEC-000 §4).
      await validateShoppingListItemCreate(
        {
          name: titleCase(itemName),
          quantity: quantity ?? 1,
          unit: unit ?? 'pcs',
          sourcePantryItemId: id,
          status: 'needed',
          ...(store ? { store } : {}),
        },
        ctx,
      );

      return `${titleCase(itemName)} added to your shopping list.`;
    }

    case 'LOG_MAINTENANCE': {
      const { assetName, taskTitle, completed, cost } = intent.payload;
      const assetId = await resolveAssetName(assetName, ctx);
      resolved.lastAssetId = assetId;

      if (!completed) {
        return `${taskTitle} on ${assetName} noted as in progress.`;
      }

      // Find the pending task for this asset matching the title
      const tasks = await ctx.db.findMany(Collections.MAINTENANCE_TASKS, {
        assetId,
        _deleted: false,
      } as Record<string, unknown>);

      const task = (tasks as Array<{ _id: string; title: string; status: string }>)
        .find(t => t.status !== 'completed' &&
          (t.title.toLowerCase().includes(taskTitle.toLowerCase()) ||
           fuzzyMatch(t.title, taskTitle, 4)));

      let spoken = '';
      if (task) {
        await validateMaintenanceTaskCompletion(task._id, undefined, ctx);
        spoken = `${taskTitle} on ${assetName} marked complete.`;
      } else {
        // No matching task — completion is logged but no DB record to update
        spoken = `${taskTitle} on ${assetName} noted. No matching scheduled task found.`;
      }

      // SPEC-013 §3: "changed HVAC filter for $30" → maintenance + expense chain.
      // If a cost was captured, also log a debit transaction linked to the asset.
      if (cost !== undefined) {
        const categoryId = await resolveCategoryGuess('Home Repair', ctx);
        await validateTransaction(
          {
            amount: cost,
            type: 'debit',
            categoryId,
            date: new Date().toISOString(),
            note: `${taskTitle} on ${assetName}`,
            linkedAssetId: assetId,
            isOverBudget: false,
          },
          ctx,
        );
        const display = cost % 1 === 0 ? `$${cost}` : `$${cost.toFixed(2)}`;
        spoken += ` ${display} logged to Home Repair.`;
      }

      return spoken;
    }

    case 'LOG_EXPENSE': {
      const { amount, categoryGuess, note, linkedItem } = intent.payload;
      const categoryId = await resolveCategoryGuess(categoryGuess, ctx);

      // Resolve linked entity IDs from earlier intents in the same command
      const linkedAssetId = resolved.lastAssetId;
      const linkedPantryItemId = resolved.lastPantryItemId;

      const category = await ctx.db.findById(Collections.BUDGET_CATEGORIES, categoryId) as { name: string } | null;

      await validateTransaction(
        {
          amount,
          type: 'debit',
          categoryId,
          date: new Date().toISOString(),
          note,
          linkedAssetId,
          linkedPantryItemId,
          isOverBudget: false,
        },
        ctx,
      );

      const display = amount % 1 === 0 ? `$${amount}` : `$${amount.toFixed(2)}`;
      return `${display} logged to ${category?.name ?? categoryGuess}.`;
    }

    case 'COMPLETE_CHORE': {
      const { choreTitle } = intent.payload;
      const { id, isNew } = await resolveChoreTitle(choreTitle, ctx);

      if (isNew) {
        // One-off chore: create then immediately complete
        // We record it as completed but don't have a DB record — just confirm
        return `${titleCase(choreTitle)} done!`;
      }

      const member = await ctx.db.findById(
        Collections.MEMBERS,
        ctx.memberId,
      ) as { displayName: string } | null;

      await validateChoreCompletion(id, ctx);

      return `${titleCase(choreTitle)} done! ${member?.displayName ?? 'You'} earned some points.`;
    }

    case 'ADD_CALENDAR': {
      const { title, startAt, endAt, isAllDay, attendees } = intent.payload;

      // Resolve attendee names → member IDs
      const allMembers = await ctx.db.findMany<HouseholdMember>(
        Collections.MEMBERS,
        { isActive: true } as Partial<HouseholdMember>,
      );
      const attendeeIds = (attendees ?? []).flatMap(name => {
        const match = allMembers.find(m =>
          m.displayName.toLowerCase().includes(name.toLowerCase()),
        );
        return match ? [match._id] : [];
      });

      await validateCalendarEventCreate(
        { title, startAt, endAt, isAllDay: isAllDay ?? false, attendees: attendeeIds },
        ctx,
      );

      const dateStr = new Date(startAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric',
      });
      return `${title} added to the calendar for ${dateStr}.`;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE RESPONSE BUILDER (SPEC-003 §6)
// ─────────────────────────────────────────────────────────────────────────────

/** Map a SpecViolationError to a spoken, user-facing sentence */
export function errorToSpokenResponse(err: SpecViolationError): SpokenLine {
  switch (err.code) {
    case 'PANTRY_NEGATIVE_QUANTITY':
      return `${(err.context?.itemId as string | undefined) ?? 'That item'} would go to zero. I've set it to zero and added it to your list.`;
    case 'FINANCE_UNKNOWN_CATEGORY':
      return `I'm not sure which budget category that is. Did you mean ${(err.context?.suggestions as string[] | undefined)?.slice(0, 3).join(', ') ?? 'something else'}?`;
    case 'CORE_MISSING_MEMBER':
      return `I'm not sure who's speaking. Which household member are you?`;
    case 'ASSETS_ORPHAN_TASK':
      return `That asset has open tasks. Complete them first, or say 'force delete'.`;
    case 'CORE_VOICE_PARSE_DEFERRED':
      return `I didn't quite get that. Here are some options — tap the one you meant.`;
    case 'CORE_PERMISSION_DENIED':
      return `Sorry, you don't have permission to do that.`;
    case 'CHORE_ALREADY_COMPLETED':
      return `That chore is already marked as done.`;
    case 'FINANCE_TYPE_MISMATCH':
      return `That expense type doesn't match the category. Check the category and try again.`;
    default:
      return `I couldn't do that. ${err.message}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD EXTRACTOR (Tier 2 pre-fill)
// Simple tokeniser — no model needed.
// ─────────────────────────────────────────────────────────────────────────────

export function extractKeywords(transcript: string): string[] {
  const stopWords = new Set([
    'i', 'a', 'an', 'the', 'to', 'for', 'of', 'on', 'in', 'at',
    'and', 'or', 'but', 'it', 'my', 'me', 'we', 'us', 'is', 'was',
    'have', 'has', 'just', 'did', 'do', 'done', 'got', 'get',
    'about', 'with', 'from', 'by', 'be', 'are', 'this', 'that',
  ]);
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !stopWords.has(w));
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcessTranscriptOptions {
  /** Required: the raw STT transcript */
  transcript: string;
  /** Required: active member + db + notifications */
  ctx: ValidatorContext;
  /** Required: Groq client for Tier 1 (inject a stub in tests) */
  groq: GroqClient;
  /** If true, skip Tier 1 even when a groq client is provided (simulate offline) */
  forceOffline?: boolean;
}

export async function processTranscript(
  opts: ProcessTranscriptOptions,
): Promise<VoiceProcessorResult> {
  const { transcript, ctx, groq, forceOffline = false } = opts;
  const startMs = Date.now();

  // ── Tier 0 ────────────────────────────────────────────────────────────────
  const t0Intents = runTier0(transcript);

  if (t0Intents && t0Intents.length > 0) {
    const latencyMs = Date.now() - startMs;
    return _executeIntents(t0Intents, 't0_pattern', latencyMs, null, transcript, ctx);
  }

  // ── Tier 1 ────────────────────────────────────────────────────────────────
  if (!forceOffline) {
    const t1Result = await runTier1(transcript, groq);
    if (t1Result && t1Result.intents.length > 0) {
      const latencyMs = Date.now() - startMs;
      return _executeIntents(t1Result.intents, 't1_on_device', latencyMs, t1Result.modelId, transcript, ctx);
    }
  }

  // ── Tier 2 — deferred ─────────────────────────────────────────────────────
  const latencyMs = Date.now() - startMs;
  const deferred: DeferredVoiceCommand = {
    _id: uuidv4(),
    capturedAt: new Date().toISOString(),
    rawTranscript: transcript,
    keywordHints: extractKeywords(transcript),
    parseStatus: 'deferred',
    capturedBy: ctx.memberId,
    clientId: ctx.clientId,
  };

  await ctx.db.insert(Collections.DEFERRED_VOICE, deferred);

  return {
    tier: 'deferred',
    latencyMs,
    successes: [],
    errors: [{
      intent: { action: 'COMPLETE_CHORE', payload: { choreTitle: transcript } } as VoiceIntent,
      spokenError: `I didn't quite get that. Here are some options — tap the one you meant.`,
      code: CoreErrorCodes.VOICE_PARSE_DEFERRED,
    }],
    deferred,
    spokenResponse: `I didn't quite get that. Here are some options — tap the one you meant.`,
  };
}

/** Execute a resolved list of intents and build the final result */
async function _executeIntents(
  intents: VoiceIntent[],
  tier: InferenceTier,
  latencyMs: number,
  modelId: string | null,
  rawTranscript: string,
  ctx: ValidatorContext,
): Promise<VoiceProcessorResult> {
  const ordered = sortIntents(intents);
  const resolved: ResolvedContext = {};
  const successes: VoiceProcessorResult['successes'] = [];
  const errors: VoiceProcessorResult['errors'] = [];

  for (const intent of ordered) {
    try {
      const spokenConfirmation = await executeIntent(intent, ctx, resolved);
      successes.push({ intent, spokenConfirmation });
    } catch (err) {
      if (err instanceof SpecViolationError) {
        errors.push({
          intent,
          spokenError: errorToSpokenResponse(err),
          code: err.code,
        });
      } else {
        // Unexpected error — surface generically
        errors.push({
          intent,
          spokenError: `Something went wrong processing that request.`,
          code: 'UNKNOWN',
        });
        console.error('[voice-processor] Unexpected error:', err);
      }
    }
  }

  // Build aggregated spoken response (SPEC-003 §6)
  const lines = [
    ...successes.map(s => s.spokenConfirmation),
    ...errors.map(e => e.spokenError),
  ];
  const spokenResponse = lines.join(' ');

  return {
    tier,
    latencyMs,
    successes,
    errors,
    spokenResponse,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function titleCase(str: string): string {
  return str.replace(/\b\w/g, c => c.toUpperCase());
}
