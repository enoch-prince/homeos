<template>
  <header class="module-header">
    <!-- Left: title -->
    <div class="header-title">
      <h1 class="title-text">{{ title }}</h1>
      <span v-if="subtitle" class="title-sub">{{ subtitle }}</span>
    </div>

    <!-- Right: sync indicator + avatar -->
    <div class="header-actions">
      <slot name="actions" />

      <!-- Sync dot (SPEC-002 §7) -->
      <div
        class="sync-dot"
        :class="`sync-dot--${syncBadge}`"
        :title="syncTitle"
        aria-label="Sync status"
      />

      <!-- Member avatar -->
      <button
        class="avatar-chip"
        :aria-label="`Active member: ${memberName}`"
        @click="emit('avatar-tap')"
      >
        <span class="avatar-initial">{{ memberInitial }}</span>
        <span v-if="points !== undefined" class="avatar-points">{{ points }}pts</span>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore } from '@/stores/app.store'

const props = defineProps<{
  title: string
  subtitle?: string
  points?: number
}>()

const emit = defineEmits<{ 'avatar-tap': [] }>()

const appStore = useAppStore()
const memberInitial = computed(() => appStore.memberInitial)
const memberName    = computed(() => appStore.activeMember?.displayName ?? 'Unknown')
const syncBadge     = computed(() => appStore.syncBadge)

const syncTitle = computed(() => {
  const labels = {
    synced:   'All changes synced',
    pending:  'Changes pending sync',
    syncing:  'Syncing…',
    conflict: 'Sync conflict — tap to resolve',
    offline:  'Offline',
  }
  return labels[syncBadge.value as keyof typeof labels] ?? ''
})
</script>

<style scoped>
.module-header {
  height: calc(var(--header-h) + var(--safe-top));
  padding-top: var(--safe-top);
  padding-left: 16px;
  padding-right: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface-card);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  z-index: 10;
}

/* ── Title ─────────────────────────────────────────────────────────────────── */
.header-title { display: flex; flex-direction: column; gap: 1px; }

.title-text {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  line-height: 1.2;
}

.title-sub {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 400;
}

/* ── Actions ───────────────────────────────────────────────────────────────── */
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ── Sync dot (SPEC-002 §7) ────────────────────────────────────────────────── */
.sync-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: background var(--duration-base);
}
.sync-dot--synced   { background: transparent; }
.sync-dot--pending  { background: var(--text-muted); }
.sync-dot--syncing  { background: var(--color-info); animation: pulse-ring 1.2s ease infinite; }
.sync-dot--conflict { background: var(--color-warning); }
.sync-dot--offline  { background: var(--color-error); }

/* ── Avatar chip ───────────────────────────────────────────────────────────── */
.avatar-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: 999px;
  padding: 5px 10px 5px 5px;
  cursor: pointer;
  min-height: var(--touch-target);
  min-width: var(--touch-target);
  transition: background var(--duration-fast);
  -webkit-tap-highlight-color: transparent;
}
.avatar-chip:active { background: var(--border-default); }

.avatar-initial {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--color-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-points {
  font-size: 11px;
  font-weight: 600;
  color: var(--color-primary);
}
</style>
