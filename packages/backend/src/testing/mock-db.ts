/**
 * @file mock-db.ts
 * @description In-memory DbAdapter implementation for Vitest.
 *
 * Stores every collection as a Map<id, record>. All operations are
 * synchronous internally but return Promises to satisfy the DbAdapter
 * interface. No external dependencies — fully self-contained.
 *
 * Design rules:
 *   - findOne / findMany perform shallow key-value matching against query
 *   - update merges the patch into the existing record (like Object.assign)
 *   - softDelete sets _deleted: true and _updated fields
 *   - sumField sums a numeric field across matching records
 *   - All methods throw if called on an unknown collection (opt-in strict mode)
 */

import type { DbAdapter, DbRecord } from '../middleware/validator.js';

export class InMemoryDb implements DbAdapter {
  // Map<collectionName, Map<id, record>>
  private store = new Map<string, Map<string, DbRecord>>();

  private getCollection(name: string): Map<string, DbRecord> {
    if (!this.store.has(name)) {
      this.store.set(name, new Map());
    }
    return this.store.get(name)!;
  }

  async insert<T extends DbRecord>(collection: string, record: T): Promise<T> {
    const col = this.getCollection(collection);
    if (col.has(record._id)) {
      throw new Error(`[mock-db] Duplicate _id '${record._id}' in '${collection}'`);
    }
    // Store a deep copy to prevent mutation through reference
    const stored = structuredClone(record);
    col.set(record._id, stored);
    return structuredClone(stored) as T;
  }

  async update<T extends DbRecord>(collection: string, id: string, patch: Partial<T>): Promise<T> {
    const col = this.getCollection(collection);
    const existing = col.get(id);
    if (!existing) {
      throw new Error(`[mock-db] Record '${id}' not found in '${collection}'`);
    }
    const updated = { ...existing, ...patch };
    col.set(id, updated);
    return structuredClone(updated) as T;
  }

  async softDelete(collection: string, id: string, updatedBy: string): Promise<void> {
    const col = this.getCollection(collection);
    const existing = col.get(id);
    if (!existing) {
      throw new Error(`[mock-db] Record '${id}' not found in '${collection}'`);
    }
    col.set(id, {
      ...existing,
      _deleted: true,
      updatedAt: new Date().toISOString(),
      updatedBy,
    } as DbRecord);
  }

  async findById<T extends DbRecord>(collection: string, id: string): Promise<T | null> {
    const col = this.getCollection(collection);
    const record = col.get(id);
    return record ? (structuredClone(record) as T) : null;
  }

  async findOne<T extends DbRecord>(collection: string, query: Record<string, unknown>): Promise<T | null> {
    const col = this.getCollection(collection);
    for (const record of col.values()) {
      if (matchesQuery(record, query)) {
        return structuredClone(record) as T;
      }
    }
    return null;
  }

  async findMany<T extends DbRecord>(collection: string, query: Record<string, unknown>): Promise<T[]> {
    const col = this.getCollection(collection);
    const results: T[] = [];
    for (const record of col.values()) {
      if (matchesQuery(record, query)) {
        results.push(structuredClone(record) as T);
      }
    }
    return results;
  }

  async sumField(
    collection: string,
    field: string,
    query: Record<string, unknown>,
  ): Promise<number> {
    const col = this.getCollection(collection);
    let total = 0;
    for (const record of col.values()) {
      if (matchesQuery(record, query)) {
        const value = (record as Record<string, unknown>)[field];
        if (typeof value === 'number') total += value;
      }
    }
    return total;
  }

  // ── Test helpers ────────────────────────────────────────────────────────────

  /** Seed a record directly without going through the validator */
  seed<T extends DbRecord>(collection: string, record: T): T {
    const col = this.getCollection(collection);
    const stored = structuredClone(record);
    col.set(record._id, stored);
    return structuredClone(stored) as T;
  }

  /** Count records in a collection (optionally filtered) */
  count(collection: string, query?: Record<string, unknown>): number {
    const col = this.getCollection(collection);
    if (!query) return col.size;
    let n = 0;
    for (const r of col.values()) {
      if (matchesQuery(r, query)) n++;
    }
    return n;
  }

  /** Get all records in a collection as an array */
  all<T extends DbRecord>(collection: string): T[] {
    const col = this.getCollection(collection);
    return Array.from(col.values()).map(r => structuredClone(r) as T);
  }

  /** Reset all collections — call in beforeEach */
  reset(): void {
    this.store.clear();
  }
}

// Shallow key-value matcher — undefined query values are ignored
function matchesQuery(record: DbRecord, query: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if ((record as Record<string, unknown>)[key] !== value) return false;
  }
  return true;
}
