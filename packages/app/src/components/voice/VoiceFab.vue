<template>
  <div class="voice-fab-wrapper">
    <!-- Tier indicator (shown during processing) -->
    <Transition name="tier">
      <span v-if="state === 'processing' && tierLabel" class="tier-badge">
        {{ tierLabel }}
      </span>
    </Transition>

    <!-- The FAB itself -->
    <button
      class="voice-fab"
      :class="fabClass"
      :aria-label="ariaLabel"
      :disabled="state === 'processing'"
      @click="handleTap"
      @pointerdown="startLongPress"
      @pointerup="cancelLongPress"
      @pointerleave="cancelLongPress"
    >
      <!-- Pulse ring (listening state) -->
      <span v-if="state === 'listening'" class="pulse-ring" />

      <!-- Icon -->
      <svg
        class="fab-icon"
        :class="{ 'spin': state === 'processing' }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <!-- Idle / Listening: microphone -->
        <template v-if="state === 'idle' || state === 'listening' || state === 'offline'">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="23"/>
          <line x1="8" y1="23" x2="16" y2="23"/>
        </template>

        <!-- Processing: spinner arc -->
        <template v-else-if="state === 'processing'">
          <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="8"/>
        </template>

        <!-- Success: checkmark -->
        <template v-else-if="state === 'success'">
          <polyline points="20 6 9 17 4 12"/>
        </template>

        <!-- Error: X -->
        <template v-else-if="state === 'error'">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </template>
      </svg>

      <!-- Offline slash badge -->
      <span v-if="state === 'offline'" class="offline-badge" aria-hidden="true">
        <svg viewBox="0 0 10 10" fill="currentColor">
          <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="2"/>
        </svg>
      </span>
    </button>

    <!-- Offline tooltip -->
    <Transition name="tooltip">
      <div v-if="showOfflineTooltip" class="offline-tooltip" role="tooltip">
        Offline — Tier 0 only
      </div>
    </Transition>

    <!-- Waveform bars (listening state) -->
    <div v-if="state === 'listening'" class="waveform" aria-hidden="true">
      <span v-for="i in 5" :key="i" class="waveform-bar" :style="{ animationDelay: `${i * 80}ms` }" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVoiceStore, type FabState } from '@/stores/voice.store'

const voiceStore = useVoiceStore()

const state  = computed(() => voiceStore.currentState as FabState)
const tierLabel = computed(() => voiceStore.tierLabel)

// Long-press detection (500ms threshold)
let longPressTimer: ReturnType<typeof setTimeout> | null = null
const showOfflineTooltip = ref(false)

const fabClass = computed(() => ({
  'fab--idle':       state.value === 'idle',
  'fab--listening':  state.value === 'listening',
  'fab--processing': state.value === 'processing',
  'fab--success':    state.value === 'success',
  'fab--error':      state.value === 'error',
  'fab--offline':    state.value === 'offline',
}))

const ariaLabel = computed(() => {
  const labels: Record<FabState, string> = {
    idle:       'Start voice command',
    listening:  'Listening — tap to stop',
    processing: 'Processing your command',
    success:    'Command completed',
    error:      'Command failed — tap to try again',
    offline:    'Offline — tap to use basic commands',
  }
  return labels[state.value]
})

function handleTap() {
  if (state.value === 'idle') {
    voiceStore.startListening()
  } else if (state.value === 'listening') {
    voiceStore.stopListening()
  } else if (state.value === 'offline') {
    showOfflineTooltip.value = true
    setTimeout(() => { showOfflineTooltip.value = false }, 2000)
    // Offline still supports T0 — proceed with listening
    voiceStore.startListening()
  } else if (state.value === 'error') {
    voiceStore.cancel()
  }
}

function startLongPress() {
  longPressTimer = setTimeout(() => {
    // Long-press: open quick-action sheet (emitted to parent)
    emit('long-press')
  }, 500)
}

function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

const emit = defineEmits<{ 'long-press': [] }>()
</script>

<style scoped>
.voice-fab-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

/* ── FAB button ─────────────────────────────────────────────────────────────── */
.voice-fab {
  position: relative;
  width: var(--fab-size);
  height: var(--fab-size);
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--duration-fast),
    transform var(--duration-fast),
    box-shadow var(--duration-base) var(--ease-out);
  -webkit-tap-highlight-color: transparent;
  touch-action: none;
}

.voice-fab:active { transform: scale(0.93); }
.voice-fab:disabled { cursor: not-allowed; }

/* State colours */
.fab--idle       { background: var(--color-primary); box-shadow: 0 4px 20px rgba(108,99,255,0.45); }
.fab--listening  { background: var(--color-warning);  box-shadow: 0 4px 20px rgba(245,158,11,0.45); }
.fab--processing { background: var(--surface-elevated); box-shadow: 0 4px 16px rgba(0,0,0,0.4); }
.fab--success    { background: var(--color-success);  box-shadow: 0 4px 20px rgba(34,197,94,0.45); animation: pop-in 250ms var(--ease-spring); }
.fab--error      { background: var(--color-error);    box-shadow: 0 4px 20px rgba(239,68,68,0.45); animation: shake 400ms ease; }
.fab--offline    { background: var(--surface-card);   box-shadow: 0 4px 12px rgba(0,0,0,0.3); }

/* ── Icon ────────────────────────────────────────────────────────────────────── */
.fab-icon {
  width: 28px;
  height: 28px;
  color: #fff;
  transition: opacity var(--duration-fast);
}
.fab-icon.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}

/* ── Pulse ring (listening) ──────────────────────────────────────────────────── */
.pulse-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  pointer-events: none;
  animation: pulse-ring 1.2s ease infinite;
}

/* ── Offline badge ───────────────────────────────────────────────────────────── */
.offline-badge {
  position: absolute;
  top: 0;
  right: 0;
  width: 18px;
  height: 18px;
  background: var(--color-error);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--surface-bg);
}
.offline-badge svg { width: 8px; height: 8px; color: #fff; }

/* ── Tier badge ───────────────────────────────────────────────────────────────── */
.tier-badge {
  position: absolute;
  top: -28px;
  background: var(--surface-elevated);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-default);
}

/* ── Offline tooltip ─────────────────────────────────────────────────────────── */
.offline-tooltip {
  position: absolute;
  bottom: calc(100% + 12px);
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-default);
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
}

/* ── Waveform ─────────────────────────────────────────────────────────────────── */
.waveform {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 20px;
}
.waveform-bar {
  width: 3px;
  background: var(--color-warning);
  border-radius: 2px;
  animation: wave 1s ease infinite;
}
@keyframes wave {
  0%, 100% { height: 4px; }
  50%       { height: 16px; }
}

/* ── Transitions ─────────────────────────────────────────────────────────────── */
.tier-enter-active, .tier-leave-active { transition: opacity var(--duration-fast), transform var(--duration-fast); }
.tier-enter-from, .tier-leave-to       { opacity: 0; transform: translateY(4px); }

.tooltip-enter-active, .tooltip-leave-active { transition: opacity var(--duration-fast); }
.tooltip-enter-from, .tooltip-leave-to       { opacity: 0; }
</style>
