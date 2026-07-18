<template>
  <RouterView v-slot="{ Component }">
    <KeepAlive>
      <component :is="Component" />
    </KeepAlive>
  </RouterView>

  <BottomNav :overdue-count="overdueCount">
    <template #fab>
      <VoiceFab @long-press="showQuickActions = true" />
    </template>
  </BottomNav>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import BottomNav from '@/components/layout/BottomNav.vue'
import VoiceFab from '@/components/voice/VoiceFab.vue'
import { useDbStore } from '@/stores/db.store'
import { useAppStore } from '@/stores/app.store'
import { v4 as uuidv4 } from 'uuid'
import { Collections } from '@homeos/backend/middleware/validator'
import type { MaintenanceTask } from '@homeos/schemas'

const dbStore  = useDbStore()
const appStore = useAppStore()
const showQuickActions = ref(false)

const overdueCount = ref(0)

onMounted(async () => {
  // Bootstrap: seed DB and set a default admin member
  const defaultMemberId = localStorage.getItem('homeos_member_id') ?? uuidv4()
  localStorage.setItem('homeos_member_id', defaultMemberId)

  await dbStore.seed(defaultMemberId, 'You')

  const member = await dbStore.adapter.findById(
    Collections.MEMBERS,
    defaultMemberId,
  ) as Parameters<typeof appStore.setActiveMember>[0] | null

  if (member) appStore.setActiveMember(member)

  // Count overdue tasks for badge
  const tasks = await dbStore.adapter.findMany<MaintenanceTask>(
    Collections.MAINTENANCE_TASKS,
    { status: 'overdue', _deleted: false } as Partial<MaintenanceTask>,
  )
  overdueCount.value = tasks.length
})
</script>
