<template>
  <DrawerProvider>
    <DrawerRoot :open="open" @update:open="emit('update:open', $event)">
      <DrawerPortal>
        <DrawerOverlay class="sheet-overlay" />
        <DrawerContent class="sheet" aria-describedby="pantry-sheet-desc">
          <DrawerHandle class="sheet-handle" />
          <DrawerTitle class="sheet-title">
            {{ isEdit ? 'Edit item' : 'Add item' }}
          </DrawerTitle>
          <p id="pantry-sheet-desc" class="sheet-desc">
            {{ isEdit ? 'Update this pantry item\'s details.' : 'Add a new item to your pantry.' }}
          </p>

          <form class="sheet-form" @submit.prevent="save">
            <!-- Name -->
            <label class="field">
              <span class="field-label">Name</span>
              <input
                v-model="form.name"
                class="field-input"
                type="text"
                required
                minlength="1"
                maxlength="100"
                placeholder="e.g. Milk"
              />
            </label>

            <!-- Unit -->
            <label class="field">
              <span class="field-label">Unit</span>
              <select v-model="form.unit" class="field-input">
                <option v-for="u in units" :key="u" :value="u">{{ u }}</option>
              </select>
            </label>

            <!-- Location -->
            <label class="field">
              <span class="field-label">Location</span>
              <select v-model="form.location" class="field-input">
                <option v-for="l in locations" :key="l" :value="l">{{ l }}</option>
              </select>
            </label>

            <!-- Par level -->
            <label class="field">
              <span class="field-label">Par level</span>
              <input
                v-model.number="form.parLevel"
                class="field-input"
                type="number"
                min="0"
                step="1"
              />
            </label>

            <!-- Expiry (optional) -->
            <label class="field">
              <span class="field-label">Expiry date <em class="field-optional">(optional)</em></span>
              <input v-model="form.expiryDate" class="field-input" type="date" />
            </label>

            <!-- Read-only quantity (edited via +/- on the card) -->
            <div v-if="isEdit" class="field field--readonly">
              <span class="field-label">Quantity</span>
              <span class="readonly-value">{{ item?.quantity ?? 0 }} {{ item?.unit }}</span>
            </div>

            <div class="sheet-actions">
              <button type="button" class="btn btn--ghost" @click="close">Cancel</button>
              <button type="submit" class="btn btn--primary" :disabled="saving">
                {{ saving ? 'Saving…' : (isEdit ? 'Save' : 'Add') }}
              </button>
            </div>
          </form>

          <!-- Delete (edit mode only) -->
          <AlertDialogRoot :open="confirmDelete" @update:open="confirmDelete = $event">
            <AlertDialogPortal>
              <AlertDialogOverlay class="sheet-overlay" />
              <AlertDialogContent class="confirm">
                <AlertDialogTitle class="confirm-title">Remove this item?</AlertDialogTitle>
                <AlertDialogDescription class="confirm-desc">
                  This will remove "{{ item?.name }}" from your pantry. This cannot be undone.
                </AlertDialogDescription>
                <div class="confirm-actions">
                  <AlertDialogCancel class="btn btn--ghost">Cancel</AlertDialogCancel>
                  <button type="button" class="btn btn--danger" @click="confirmRemove">Remove</button>
                </div>
              </AlertDialogContent>
            </AlertDialogPortal>
          </AlertDialogRoot>

          <button
            v-if="isEdit"
            type="button"
            class="btn btn--danger btn--block"
            @click="confirmDelete = true"
          >
            Remove item
          </button>
        </DrawerContent>
      </DrawerPortal>
    </DrawerRoot>
  </DrawerProvider>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import {
  DrawerProvider,
  DrawerRoot,
  DrawerPortal,
  DrawerOverlay,
  DrawerContent,
  DrawerHandle,
  DrawerTitle,
  AlertDialogRoot,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from 'reka-ui'
import { useDbStore } from '@/stores/db.store'
import { useAppStore } from '@/stores/app.store'
import {
  validatePantryItemCreate,
  validatePantryItemEdit,
  validatePantryItemDelete,
  type PantryItemPatch,
} from '@homeos/backend/middleware/validator'
import type { PantryItem, UOM, Location } from '@homeos/schemas'

const props = defineProps<{
  open: boolean
  item: PantryItem | null
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  saved: []
  deleted: []
}>()

const dbStore = useDbStore()
const appStore = useAppStore()

const units: UOM[] = ['pcs', 'kg', 'g', 'L', 'ml', 'lbs', 'oz', 'box', 'bag']
const locations: Location[] = ['Fridge', 'Freezer', 'Pantry', 'Garage', 'Other']

const isEdit = computed(() => props.item !== null)
const saving = ref(false)
const confirmDelete = ref(false)

const form = ref({
  name: '',
  unit: 'pcs' as UOM,
  location: 'Pantry' as Location,
  parLevel: 1,
  expiryDate: '' as string,
})

// Reset / hydrate the form whenever the sheet opens or the item changes.
watch(
  () => [props.open, props.item],
  () => {
    if (!props.open) return
    confirmDelete.value = false
    if (props.item) {
      form.value = {
        name: props.item.name,
        unit: props.item.unit,
        location: props.item.location,
        parLevel: props.item.parLevel,
        expiryDate: props.item.expiryDate
          ? props.item.expiryDate.slice(0, 10)
          : '',
      }
    } else {
      form.value = { name: '', unit: 'pcs', location: 'Pantry', parLevel: 1, expiryDate: '' }
    }
  },
  { immediate: true },
)

function close() {
  emit('update:open', false)
}

function ctx() {
  return {
    memberId: appStore.activeMember?._id ?? '',
    clientId: dbStore.clientId,
    db: dbStore.adapter,
    notifications: dbStore.notifications,
  }
}

async function save() {
  if (!appStore.activeMember || saving.value) return
  saving.value = true
  try {
    if (props.item) {
      const patch: PantryItemPatch = {
        name: form.value.name.trim(),
        unit: form.value.unit,
        location: form.value.location,
        parLevel: Math.max(0, form.value.parLevel),
        expiryDate: form.value.expiryDate
          ? new Date(form.value.expiryDate + 'T00:00:00.000Z').toISOString()
          : undefined,
      }
      await validatePantryItemEdit(props.item._id, patch, ctx())
    } else {
      await validatePantryItemCreate(
        {
          name: form.value.name.trim(),
          quantity: Math.max(1, form.value.parLevel),
          unit: form.value.unit,
          location: form.value.location,
          parLevel: Math.max(0, form.value.parLevel),
          expiryDate: form.value.expiryDate
            ? new Date(form.value.expiryDate + 'T00:00:00.000Z').toISOString()
            : undefined,
        },
        ctx(),
      )
    }
    close()
    emit('saved')
  } finally {
    saving.value = false
  }
}

async function confirmRemove() {
  if (!props.item || !appStore.activeMember) return
  confirmDelete.value = false
  await validatePantryItemDelete(props.item._id, ctx())
  close()
  emit('deleted')
}
</script>

<style scoped>
.sheet-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 50;
}

.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 51;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 88vh;
  overflow-y: auto;
  padding: 8px 16px calc(16px + var(--safe-bottom));
  background: var(--surface-card);
  border-top-left-radius: 16px;
  border-top-right-radius: 16px;
  box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.3);
}

.sheet-handle {
  width: 40px;
  height: 4px;
  margin: 4px auto 8px;
  border-radius: 999px;
  background: var(--border-default);
}

.sheet-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.sheet-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin: 2px 0 12px;
}

.sheet-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
}

.field-optional {
  font-style: normal;
  font-weight: 400;
  color: var(--text-muted);
}

.field-input {
  height: var(--touch-target);
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--surface-elevated);
  color: var(--text-primary);
  font-size: 15px;
  -webkit-appearance: none;
  appearance: none;
}

.field--readonly {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.readonly-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.sheet-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.btn {
  flex: 1;
  height: var(--touch-target);
  border-radius: 10px;
  border: 1px solid var(--border-default);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background var(--duration-fast);
}

.btn--ghost {
  background: transparent;
  color: var(--text-secondary);
}

.btn--primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.btn--primary:disabled {
  opacity: 0.6;
  cursor: default;
}

.btn--danger {
  background: var(--color-error);
  border-color: var(--color-error);
  color: #fff;
}

.btn--block {
  margin-top: 16px;
  width: 100%;
}

/* Confirm dialog */
.confirm {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 60;
  width: calc(100% - 48px);
  max-width: 360px;
  padding: 20px;
  border-radius: 16px;
  background: var(--surface-card);
  border: 1px solid var(--border-subtle);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
}

.confirm-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 6px;
}

.confirm-desc {
  font-size: 14px;
  color: var(--text-muted);
  margin: 0 0 16px;
  line-height: 1.4;
}

.confirm-actions {
  display: flex;
  gap: 10px;
}
</style>
