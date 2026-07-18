<template>
  <nav class="bottom-nav" role="navigation" aria-label="Main navigation">
    <RouterLink
      v-for="tab in tabs"
      :key="tab.to"
      :to="tab.to"
      class="nav-tab"
      :aria-label="tab.label"
    >
      <span class="nav-icon" aria-hidden="true" v-html="tab.icon" />
      <!-- Badge for overdue assets on More tab -->
      <span v-if="tab.badge && tab.badge > 0" class="nav-badge">
        {{ tab.badge > 9 ? '9+' : tab.badge }}
      </span>
      <span class="nav-label">{{ tab.label }}</span>
    </RouterLink>

    <!-- Voice FAB slot — centred above nav -->
    <div class="nav-fab-slot">
      <slot name="fab" />
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

// Badge counts injected by parent (from stores)
const props = defineProps<{
  overdueCount?: number
}>()

const tabs = computed(() => [
  {
    to: '/',
    label: 'Home',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>`,
  },
  {
    to: '/pantry',
    label: 'Pantry',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>`,
  },
  {
    to: '/finance',
    label: 'Finance',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <line x1="2" y1="10" x2="22" y2="10"/>
    </svg>`,
  },
  {
    to: '/chores',
    label: 'Chores',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>`,
  },
  {
    to: '/more',
    label: 'More',
    badge: props.overdueCount,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="7" height="7"/>
      <rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/>
      <rect x="3" y="14" width="7" height="7"/>
    </svg>`,
  },
])
</script>

<style scoped>
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: calc(var(--bottom-nav-h) + var(--safe-bottom));
  padding-bottom: var(--safe-bottom);
  background: var(--surface-card);
  border-top: 1px solid var(--border-subtle);
  display: flex;
  align-items: flex-start;
  justify-content: space-around;
  z-index: 100;
  /* Blur effect for glass-morphism feel */
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* ── Tab items ─────────────────────────────────────────────────────────────── */
.nav-tab {
  flex: 1;
  min-height: var(--touch-target);    /* 48dp touch target */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  text-decoration: none;
  color: var(--text-muted);
  position: relative;
  transition: color var(--duration-fast);
  -webkit-tap-highlight-color: transparent;
}

.nav-tab.router-link-active,
.nav-tab.router-link-exact-active {
  color: var(--color-primary);
}

/* Centre slot: where the FAB floats above */
.nav-fab-slot {
  position: absolute;
  bottom: calc(var(--bottom-nav-h) + var(--safe-bottom) + 16px);
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none; /* FAB itself handles pointer events */
}
.nav-fab-slot > * { pointer-events: auto; }

/* ── Icons ─────────────────────────────────────────────────────────────────── */
.nav-icon {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.nav-icon :deep(svg) {
  width: 22px;
  height: 22px;
}

/* ── Labels ────────────────────────────────────────────────────────────────── */
.nav-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
}

/* ── Badge ─────────────────────────────────────────────────────────────────── */
.nav-badge {
  position: absolute;
  top: 4px;
  right: 12px;
  min-width: 16px;
  height: 16px;
  background: var(--color-error);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  border: 2px solid var(--surface-card);
}
</style>
