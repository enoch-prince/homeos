<template>
  <div class="module-view">
    <ModuleHeader title="More" subtitle="Assets & settings" />
    <main class="module-content">
      <div class="empty-state">
        <p>⚙️ Assets & settings coming soon</p>
        <p class="empty-hint">The asset register, maintenance timeline, and app settings will live here.</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import ModuleHeader from '@/components/layout/ModuleHeader.vue'
</script>

<style scoped>
.module-view { display: flex; flex-direction: column; height: 100%; }
.module-content {
  flex: 1;
  overflow-y: auto;
  padding-bottom: calc(var(--bottom-nav-h) + var(--fab-size) + 32px + var(--safe-bottom));
}
.empty-state {
  padding: 80px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 16px;
}
.empty-hint { font-size: 13px; margin-top: 8px; color: var(--text-muted); }
</style>
