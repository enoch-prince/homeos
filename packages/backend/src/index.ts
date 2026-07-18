/**
 * @file index.ts
 * @description HomeOS Backend — Public API barrel.
 *
 * Re-exports the validator middleware and voice-processor service so the app
 * (and any other consumer) can import from '@homeos/backend' without reaching
 * into internal module paths. Subpath exports (`./middleware/validator`,
 * `./services/voice-processor`, `./testing/*`) remain available for fine-grained
 * imports used by the app's Vite aliases.
 */

// ── Validator middleware ──────────────────────────────────────────────────────
export {
  Collections,
  type DbRecord,
  type DbAdapter,
  type NotificationAdapter,
  type ValidatorContext,
  type BriefingItem,
  validateTransaction,
  validatePantryItemUpdate,
  validatePantryItemCreate,
  validatePantryItemEdit,
  validatePantryItemDelete,
  type PantryItemPatch,
  validateShoppingListItemCreate,
  validateShoppingListItemStatus,
  validateMaintenanceTaskCompletion,
  validateAssetSoftDelete,
  validateChoreCompletion,
  validateCalendarEventCreate,
  seedDatabase,
  generateMorningBriefing,
} from './middleware/validator';

// ── Voice processor service ───────────────────────────────────────────────────
export {
  makeGroqClient,
  runTier0,
  parseGroqResponse,
  resolveItemName,
  resolveCategoryGuess,
  resolveAssetName,
  resolveChoreTitle,
  executeIntent,
  errorToSpokenResponse,
  extractKeywords,
  processTranscript,
  type SpokenLine,
  type VoiceProcessorResult,
  type GroqClient,
  type ProcessTranscriptOptions,
} from './services/voice-processor';
