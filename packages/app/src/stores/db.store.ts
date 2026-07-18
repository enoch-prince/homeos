/**
 * @file stores/db.store.ts
 * @description Database adapter store.
 *
 * Wraps the DbAdapter interface so the rest of the app gets a single
 * reactive reference to the database. In v1 this uses InMemoryDb for
 * development; swap for the real @syncflow-db/core adapter in production.
 *
 * Also exposes a notification queue that the validator writes to and
 * the Morning Briefing view reads from.
 */

import { defineStore } from 'pinia'
import { ref, shallowRef } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import type { DbAdapter, NotificationAdapter } from '@homeos/backend/middleware/validator'
import type { BriefingItem } from '@homeos/backend/middleware/validator'

// Development: in-memory adapter (swap for syncflow-db in production)
import { InMemoryDb } from '@homeos/backend/testing/mock-db'

export const useDbStore = defineStore('db', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const clientId = uuidv4()                         // stable per app session
  const _db = new InMemoryDb()
  const adapter = shallowRef<DbAdapter>(_db as DbAdapter)        // swap for syncflow adapter here
  const briefingQueue = ref<BriefingItem[]>([])
  const isSeeded = ref(false)

  // ── Notification adapter ───────────────────────────────────────────────────
  const notifications: NotificationAdapter = {
    queueBriefingItem(priority, message, entityId, collection) {
      // Deduplicate by entityId
      const existing = briefingQueue.value.findIndex(i => i.entityId === entityId)
      const item: BriefingItem = { priority, message, entityId, collection }
      if (existing >= 0) {
        briefingQueue.value[existing] = item
      } else {
        briefingQueue.value.push(item)
      }
    },
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function seed(adminMemberId: string, adminName: string) {
    if (isSeeded.value) return

    const { seedDatabase } = await import('@homeos/backend/middleware/validator')
    await seedDatabase(adapter.value, clientId)

    // Seed the admin member who set up the app
    const { Collections } = await import('@homeos/backend/middleware/validator')
    const now = new Date().toISOString()
    await adapter.value.insert(Collections.MEMBERS, {
      _id: adminMemberId,
      displayName: adminName,
      role: 'admin',
      deviceIds: [clientId],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    } as Parameters<typeof adapter.value.insert>[1])

    isSeeded.value = true
  }

  function clearBriefingItem(entityId: string) {
    briefingQueue.value = briefingQueue.value.filter(i => i.entityId !== entityId)
  }

  function clearBriefingQueue() {
    briefingQueue.value = []
  }

  return {
    clientId, adapter, notifications, briefingQueue, isSeeded,
    seed, clearBriefingItem, clearBriefingQueue,
  }
})
