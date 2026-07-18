<template>
  <div class="pantry-view">
    <ModuleHeader title="Pantry" :subtitle="viewLabel" @avatar-tap="() => {}">
    </ModuleHeader>

    <!-- View toggle -->
    <div class="view-toggle">
      <button
        v-for="v in views"
        :key="v.id"
        class="toggle-btn"
        :class="{ 'toggle-btn--active': activeView === v.id }"
        @click="activeView = v.id"
      >
        {{ v.label }}
      </button>
    </div>

    <main class="pantry-content">
      <!-- ── PANTRY VIEW ─────────────────────────────────────────────────── -->
      <template v-if="activeView === 'pantry'">
        <template v-for="location in locations" :key="location">
          <template v-if="byLocation[location]?.length">
            <div class="section-header">{{ location }}</div>

            <EntityCard
              v-for="item in byLocation[location]"
              :key="item._id"
              :primary="item.name"
              :secondary="`${item.quantity} ${item.unit}`"
              :status="itemStatus(item)"
              :low-stock="item.quantity <= item.parLevel"
              left-action-label="Remove"
              @tap="selectedItem = item"
              @swipe-left="subtractOne(item)"
            >
              <!-- Inline quantity control -->
              <template #quantity>
                <div class="qty-control" @click.stop>
                  <button class="qty-btn" :aria-label="`Remove 1 ${item.name}`" @click="subtractOne(item)">−</button>
                  <span class="qty-value">{{ item.quantity }}</span>
                  <button class="qty-btn" :aria-label="`Add 1 ${item.name}`"    @click="addOne(item)">+</button>
                </div>
              </template>
            </EntityCard>
          </template>
        </template>
      </template>

      <!-- ── SHOPPING LIST VIEW ─────────────────────────────────────────── -->
      <template v-else>
        <template v-for="status in ['needed', 'purchased', 'discarded']" :key="status">
          <template v-if="byStatus[status]?.length">
            <div class="section-header section-header--capitalize">{{ status }}</div>
            <EntityCard
              v-for="item in byStatus[status]"
              :key="item._id"
              :primary="item.name"
              :secondary="`${item.quantity} ${item.unit}`"
              :status="status"
              left-action-label="Bought"
              @tap="selectedShoppingItem = item"
              @swipe-left="markPurchased(item)"
            />
          </template>
        </template>

        <div v-if="shoppingItems.length === 0" class="empty-state">
          <p>🛒 Your shopping list is empty</p>
        </div>
      </template>
    </main>

    <!-- TODO: Detail bottom sheet for selectedItem (Reka UI Dialog as sheet) -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import ModuleHeader from '@/components/layout/ModuleHeader.vue'
import EntityCard from '@/components/ui/EntityCard.vue'
import { useDbStore } from '@/stores/db.store'
import { useAppStore } from '@/stores/app.store'
import { Collections, validatePantryItemUpdate, validateShoppingListItemStatus } from '@homeos/backend/middleware/validator'
import type { PantryItem } from '@homeos/schemas'
import type { ShoppingListItem } from '@homeos/schemas'

const dbStore  = useDbStore()
const appStore = useAppStore()

const activeView = ref<'pantry' | 'shopping'>('pantry')
const views = [
  { id: 'pantry' as const,   label: 'Pantry' },
  { id: 'shopping' as const, label: 'Shopping' },
]
const viewLabel = computed(() => activeView.value === 'pantry' ? 'By location' : 'Shopping list')

const pantryItems   = ref<PantryItem[]>([])
const shoppingItems = ref<ShoppingListItem[]>([])
const selectedItem  = ref<PantryItem | null>(null)
const selectedShoppingItem = ref<ShoppingListItem | null>(null)

const locations = ['Fridge', 'Freezer', 'Pantry', 'Garage', 'Other'] as const

// Low-stock items float to top within their location (SPEC-004 §4.1)
const byLocation = computed(() => {
  const map: Record<string, PantryItem[]> = {}
  for (const loc of locations) {
    map[loc] = pantryItems.value
      .filter(i => i.location === loc && !i._deleted)
      .sort((a, b) => {
        const aLow = a.quantity <= a.parLevel ? 0 : 1
        const bLow = b.quantity <= b.parLevel ? 0 : 1
        return aLow - bLow
      })
  }
  return map
})

const byStatus = computed(() => {
  const map: Record<string, ShoppingListItem[]> = {}
  for (const s of ['needed', 'purchased', 'discarded']) {
    map[s] = shoppingItems.value.filter(i => i.status === s && !i._deleted)
  }
  return map
})

function itemStatus(item: PantryItem): string | undefined {
  if (item.expiryDate) {
    const h = (new Date(item.expiryDate).getTime() - Date.now()) / 36e5
    if (h <= 48 && h > 0) return 'expiring'
  }
  if (item.quantity <= item.parLevel) return 'low stock'
  return undefined
}

async function refresh() {
  pantryItems.value   = await dbStore.adapter.findMany(Collections.PANTRY_ITEMS, { _deleted: false })
  shoppingItems.value = await dbStore.adapter.findMany(Collections.SHOPPING_LIST, { _deleted: false })
}

async function subtractOne(item: PantryItem) {
  if (!appStore.activeMember) return
  try {
    await validatePantryItemUpdate(item._id, -1, {
      memberId: appStore.activeMember._id,
      clientId: dbStore.clientId,
      db: dbStore.adapter,
      notifications: dbStore.notifications,
    })
    await refresh()
  } catch { /* SpecViolationError handled by voice store — ignore in UI */ }
}

async function addOne(item: PantryItem) {
  if (!appStore.activeMember) return
  await validatePantryItemUpdate(item._id, 1, {
    memberId: appStore.activeMember._id,
    clientId: dbStore.clientId,
    db: dbStore.adapter,
    notifications: dbStore.notifications,
  })
  await refresh()
}

async function markPurchased(item: ShoppingListItem) {
  if (!appStore.activeMember) return
  await validateShoppingListItemStatus(item._id, 'purchased', {
    memberId: appStore.activeMember._id,
    clientId: dbStore.clientId,
    db: dbStore.adapter,
    notifications: dbStore.notifications,
  })
  await refresh()
}

onMounted(refresh)
</script>

<style scoped>
.pantry-view { display: flex; flex-direction: column; height: 100%; }

.pantry-content {
  flex: 1;
  overflow-y: auto;
  padding-bottom: calc(var(--bottom-nav-h) + var(--fab-size) + 32px + var(--safe-bottom));
}

/* ── View toggle ────────────────────────────────────────────────────────────── */
.view-toggle {
  display: flex;
  padding: 10px 16px;
  gap: 8px;
  background: var(--surface-card);
  border-bottom: 1px solid var(--border-subtle);
}

.toggle-btn {
  flex: 1;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  min-height: var(--touch-target);
  transition: all var(--duration-fast);
  -webkit-tap-highlight-color: transparent;
}
.toggle-btn--active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

/* ── Section headers ────────────────────────────────────────────────────────── */
.section-header {
  padding: 8px 16px 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--surface-bg);
  position: sticky;
  top: 0;
  z-index: 1;
}
.section-header--capitalize { text-transform: capitalize; }

/* ── Inline quantity control (SPEC-004 §4.1) ───────────────────────────────── */
.qty-control {
  display: flex;
  align-items: center;
  gap: 0;
  border: 1px solid var(--border-default);
  border-radius: 8px;
  overflow: hidden;
}

.qty-btn {
  width: var(--touch-target);
  height: 32px;
  border: none;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 300;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}
.qty-btn:active { background: var(--border-default); }

.qty-value {
  min-width: 32px;
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

/* ── Empty state ────────────────────────────────────────────────────────────── */
.empty-state {
  padding: 60px 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 16px;
}
</style>
