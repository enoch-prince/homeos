<template>
  <div
    class="card-wrapper"
    :style="{ transform: `translateX(${swipeX}px)` }"
    @touchstart.passive="onTouchStart"
    @touchmove.passive="onTouchMove"
    @touchend="onTouchEnd"
    @click="emit('tap')"
  >
    <!-- Swipe left reveal (quick action) -->
    <div class="swipe-action swipe-action--left" :style="{ opacity: swipeLeftOpacity }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>{{ leftActionLabel }}</span>
    </div>

    <!-- Card body -->
    <div class="card" :class="{ 'card--low-stock': lowStock, 'card--conflict': isConflict }">
      <!-- Left icon slot -->
      <div class="card-icon" v-if="$slots.icon">
        <slot name="icon" />
      </div>

      <!-- Content -->
      <div class="card-content">
        <span class="card-primary">{{ primary }}</span>
        <span v-if="secondary" class="card-secondary">{{ secondary }}</span>
      </div>

      <!-- Right: status chip + actions -->
      <div class="card-right">
        <span v-if="status" class="chip" :class="`chip--${status}`">
          {{ statusLabel }}
        </span>
        <!-- Inline quantity controls (pantry only) -->
        <slot name="quantity" />
      </div>
    </div>

    <!-- Swipe right reveal (secondary action) -->
    <div class="swipe-action swipe-action--right" :style="{ opacity: swipeRightOpacity }">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      <span>Edit</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  primary: string
  secondary?: string
  status?: string
  lowStock?: boolean
  isConflict?: boolean
  leftActionLabel?: string
}>()

const emit = defineEmits<{
  'tap': []
  'swipe-left': []
  'swipe-right': []
}>()

// ── Swipe gesture handler ────────────────────────────────────────────────────
const swipeX     = ref(0)
const startX     = ref(0)
const THRESHOLD  = 72    // px before action fires
const SNAP_BACK  = 300   // ms

let touchActive = false

function onTouchStart(e: TouchEvent) {
  startX.value = e.touches[0].clientX
  touchActive = true
}

function onTouchMove(e: TouchEvent) {
  if (!touchActive) return
  swipeX.value = e.touches[0].clientX - startX.value
}

function onTouchEnd() {
  touchActive = false
  if (swipeX.value < -THRESHOLD) {
    emit('swipe-left')
  } else if (swipeX.value > THRESHOLD) {
    emit('swipe-right')
  }
  // Snap back
  const start = swipeX.value
  const startTime = performance.now()
  function animate(now: number) {
    const t = Math.min((now - startTime) / SNAP_BACK, 1)
    swipeX.value = start * (1 - t)
    if (t < 1) requestAnimationFrame(animate)
    else swipeX.value = 0
  }
  requestAnimationFrame(animate)
}

// ── Computed ─────────────────────────────────────────────────────────────────
const swipeLeftOpacity  = computed(() => Math.min(Math.max(-swipeX.value / THRESHOLD, 0), 1))
const swipeRightOpacity = computed(() => Math.min(Math.max(swipeX.value  / THRESHOLD, 0), 1))

const statusLabel = computed(() => {
  const labels: Record<string, string> = {
    needed:    'Needed',
    overdue:   'Overdue',
    pending:   'Pending',
    completed: 'Done',
    conflict:  'Conflict',
    failed:    'Sync failed',
    'low stock': 'Low',
    expiring:  'Expiring',
  }
  return props.status ? (labels[props.status] ?? props.status) : ''
})
</script>

<style scoped>
.card-wrapper {
  position: relative;
  will-change: transform;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ── Card ──────────────────────────────────────────────────────────────────── */
.card {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;           /* SPEC-004 §3.1 */
  padding: 10px 16px;
  background: var(--surface-card);
  border-bottom: 1px solid var(--border-subtle);
  transition: background var(--duration-fast);
}

.card:active { background: var(--surface-elevated); }

/* Low-stock: amber left border accent (SPEC-004 §4.1) */
.card--low-stock {
  border-left: 3px solid var(--color-warning);
  padding-left: 13px;
}
.card--conflict {
  border-left: 3px solid var(--color-warning);
  padding-left: 13px;
}

/* ── Icon slot ─────────────────────────────────────────────────────────────── */
.card-icon {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--text-muted);
}

/* ── Content ───────────────────────────────────────────────────────────────── */
.card-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.card-primary {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-secondary {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Right side ────────────────────────────────────────────────────────────── */
.card-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* ── Swipe reveal layers ───────────────────────────────────────────────────── */
.swipe-action {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  pointer-events: none;
  transition: opacity var(--duration-fast);
}
.swipe-action svg { width: 20px; height: 20px; }

.swipe-action--left {
  right: 0;
  color: var(--color-success);
}
.swipe-action--right {
  left: 0;
  color: var(--color-info);
}
</style>
