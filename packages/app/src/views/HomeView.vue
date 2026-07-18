<template>
  <div class="home-view">
    <ModuleHeader title="HomeOS" :subtitle="todayLabel" />

    <!-- Offline banner -->
    <Transition name="slide-down">
      <div v-if="!isOnline" class="offline-banner" role="alert">
        <span>📴</span>
        <span>Offline — changes will sync when back</span>
      </div>
    </Transition>

    <main class="home-content">
      <!-- TTS playback button -->
      <div class="briefing-header">
        <h2 class="briefing-title">Morning Briefing</h2>
        <button
          v-if="briefingItems.length > 0"
          class="tts-btn"
          :aria-label="isSpeaking ? 'Stop reading' : 'Read briefing aloud'"
          @click="toggleTTS"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon v-if="!isSpeaking" points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path v-if="!isSpeaking" d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            <path v-if="!isSpeaking" d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <!-- Stop icon when speaking -->
            <rect v-if="isSpeaking" x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
          {{ isSpeaking ? 'Stop' : 'Read aloud' }}
        </button>
      </div>

      <!-- All clear state -->
      <div v-if="briefingItems.length === 0" class="all-clear">
        <div class="all-clear-icon">✅</div>
        <p class="all-clear-text">All clear for today</p>
        <p class="all-clear-date">{{ todayLabel }}</p>
      </div>

      <!-- Briefing items -->
      <ul v-else class="briefing-list" role="list">
        <li
          v-for="item in briefingItems"
          :key="item.entityId"
          class="briefing-item"
          :class="`briefing-item--${item.priority}`"
          @click="navigateTo(item)"
        >
          <span class="briefing-priority" aria-hidden="true">{{ priorityEmoji(item.priority) }}</span>
          <span class="briefing-message">{{ item.message }}</span>
          <svg class="briefing-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </li>
      </ul>

      <!-- Dismiss all -->
      <button
        v-if="briefingItems.some(i => i.priority === 'yellow' || i.priority === 'green')"
        class="dismiss-btn"
        @click="dismissLowPriority"
      >
        Dismiss low-priority items
      </button>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import ModuleHeader from '@/components/layout/ModuleHeader.vue'
import { useAppStore } from '@/stores/app.store'
import { useDbStore } from '@/stores/db.store'
import { generateMorningBriefing, type BriefingItem } from '@homeos/backend/middleware/validator'

const router   = useRouter()
const appStore = useAppStore()
const dbStore  = useDbStore()

const isOnline     = computed(() => appStore.isOnline)
const briefingItems = ref<BriefingItem[]>([])
const isSpeaking   = ref(false)
let utterance: SpeechSynthesisUtterance | null = null

const todayLabel = computed(() =>
  new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
)

onMounted(async () => {
  if (appStore.activeMember) {
    briefingItems.value = await generateMorningBriefing(
      dbStore.adapter,
      appStore.activeMember._id,
    )
  }
})

function priorityEmoji(p: BriefingItem['priority']) {
  return { red: '🔴', amber: '🟠', yellow: '🟡', green: '🟢' }[p]
}

function navigateTo(item: BriefingItem) {
  const routeMap: Record<string, string> = {
    pantry_items:            '/pantry',
    pantry_shopping_list:    '/pantry',
    finance_transactions:    '/finance',
    finance_budget_categories: '/finance',
    assets_register:         '/more',
    assets_maintenance_tasks:'/more',
    chores_tasks:            '/chores',
  }
  const route = routeMap[item.collection]
  if (route) router.push(route)
}

function dismissLowPriority() {
  briefingItems.value = briefingItems.value.filter(
    i => i.priority === 'red' || i.priority === 'amber'
  )
}

function toggleTTS() {
  if (isSpeaking.value) {
    speechSynthesis.cancel()
    isSpeaking.value = false
    return
  }

  const text = briefingItems.value.map(i => i.message).join('. ')
  utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 0.95
  utterance.onend = () => { isSpeaking.value = false }
  speechSynthesis.speak(utterance)
  isSpeaking.value = true
}
</script>

<style scoped>
.home-view {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.home-content {
  flex: 1;
  overflow-y: auto;
  padding: 0 0 calc(var(--bottom-nav-h) + var(--fab-size) + 32px + var(--safe-bottom));
}

/* ── Briefing header ────────────────────────────────────────────────────────── */
.briefing-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 12px;
}

.briefing-title {
  font-size: 20px;
  font-weight: 700;
  margin: 0;
  color: var(--text-primary);
}

.tts-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: 999px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  min-height: var(--touch-target);
  -webkit-tap-highlight-color: transparent;
}
.tts-btn svg { width: 16px; height: 16px; }

/* ── All clear ──────────────────────────────────────────────────────────────── */
.all-clear {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  gap: 8px;
  animation: fade-up var(--duration-base) var(--ease-out);
}

.all-clear-icon { font-size: 48px; }
.all-clear-text { font-size: 18px; font-weight: 600; color: var(--color-success); margin: 0; }
.all-clear-date { font-size: 13px; color: var(--text-muted); margin: 0; }

/* ── Briefing list ──────────────────────────────────────────────────────────── */
.briefing-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.briefing-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-subtle);
  cursor: pointer;
  min-height: var(--touch-target);
  transition: background var(--duration-fast);
  animation: fade-up var(--duration-base) var(--ease-out);
  -webkit-tap-highlight-color: transparent;
}
.briefing-item:active { background: var(--surface-elevated); }

.briefing-priority { font-size: 16px; flex-shrink: 0; }
.briefing-message  { flex: 1; font-size: 14px; color: var(--text-primary); line-height: 1.4; }
.briefing-chevron  { width: 16px; height: 16px; color: var(--text-muted); flex-shrink: 0; }

/* ── Dismiss button ─────────────────────────────────────────────────────────── */
.dismiss-btn {
  width: calc(100% - 32px);
  margin: 16px;
  padding: 14px;
  background: var(--surface-elevated);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

/* ── Offline banner transition ──────────────────────────────────────────────── */
.slide-down-enter-active, .slide-down-leave-active { transition: all var(--duration-base); }
.slide-down-enter-from, .slide-down-leave-to       { transform: translateY(-100%); opacity: 0; }
</style>
