/**
 * @file stores/app.store.ts
 * @description Global app state — active member, online/offline, sync status.
 * All other stores import from this one to get the active member context.
 */

import { defineStore } from 'pinia'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { HouseholdMember } from '@homeos/schemas'

export const useAppStore = defineStore('app', () => {
  // ── State ──────────────────────────────────────────────────────────────────
  const activeMember = ref<HouseholdMember | null>(null)
  const isOnline = ref(navigator.onLine)
  const isSyncing = ref(false)
  const pendingCount = ref(0)   // records with syncStatus: 'pending'
  const conflictCount = ref(0)  // records with syncStatus: 'conflict'

  // ── Getters ────────────────────────────────────────────────────────────────
  const isAdmin = computed(() => activeMember.value?.role === 'admin')
  const isChild = computed(() => activeMember.value?.role === 'child')
  const memberInitial = computed(() =>
    activeMember.value?.displayName.charAt(0).toUpperCase() ?? '?'
  )
  const syncBadge = computed(() => {
    if (conflictCount.value > 0) return 'conflict'
    if (!isOnline.value) return 'offline'
    if (isSyncing.value) return 'syncing'
    if (pendingCount.value > 0) return 'pending'
    return 'synced'
  })

  // ── Actions ────────────────────────────────────────────────────────────────
  function setActiveMember(member: HouseholdMember) {
    activeMember.value = member
  }

  function setSyncing(syncing: boolean) {
    isSyncing.value = syncing
  }

  function updateSyncCounts(pending: number, conflicts: number) {
    pendingCount.value = pending
    conflictCount.value = conflicts
  }

  // ── Network listeners ──────────────────────────────────────────────────────
  function handleOnline()  { isOnline.value = true }
  function handleOffline() { isOnline.value = false }

  onMounted(() => {
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
  })
  onUnmounted(() => {
    window.removeEventListener('online',  handleOnline)
    window.removeEventListener('offline', handleOffline)
  })

  return {
    activeMember, isOnline, isSyncing, pendingCount, conflictCount,
    isAdmin, isChild, memberInitial, syncBadge,
    setActiveMember, setSyncing, updateSyncCounts,
  }
})
