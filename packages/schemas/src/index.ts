/**
 * @file index.ts
 * @description HomeOS Schemas — Single import point
 *
 * All application code imports from '@/schemas', never from individual schema files.
 * This enables internal file reorganisation without breaking imports.
 *
 * Usage:
 *   import { PantryItemSchema, TransactionSchema, VoiceIntentSchema } from '@/schemas';
 */

// Core (always first — all others depend on it)
export * from './core.schema.js';

// Module schemas
export * from './finance.schema.js';
export * from './pantry.schema.js';
export * from './assets.schema.js';
export * from './chores.schema.js';
export * from './calendar.schema.js';

// Voice pipeline
export * from './voice-intent.schema.js';
