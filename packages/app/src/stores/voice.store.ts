/**
 * @file stores/voice.store.ts
 * @description Voice FAB state machine and pipeline orchestration.
 *
 * FAB states (SPEC-004 §2):
 *   idle → listening → processing → success | error
 *   idle → offline (when !isOnline)
 *
 * The store owns the Web Speech API lifecycle and calls processTranscript()
 * from the voice-processor service. The FAB component is a pure visual
 * consumer of this store's state.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useAppStore } from './app.store'
import type { VoiceProcessorResult } from '@homeos/backend/services/voice-processor'

export type FabState = 'idle' | 'listening' | 'processing' | 'success' | 'error' | 'offline'
export type InferenceTierLabel = 'T0' | 'T1' | 'T2'

export const useVoiceStore = defineStore('voice', () => {
  const appStore = useAppStore()

  // ── State ──────────────────────────────────────────────────────────────────
  const fabState   = ref<FabState>('idle')
  const transcript = ref('')
  const tierLabel  = ref<InferenceTierLabel | null>(null)
  const lastResult = ref<VoiceProcessorResult | null>(null)
  const lastError  = ref<string | null>(null)
  const latencyMs  = ref<number | null>(null)

  // Speech recognition instance (Web Speech API)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recognition: any = null

  // ── Computed ───────────────────────────────────────────────────────────────
  const isListening  = computed(() => fabState.value === 'listening')
  const isProcessing = computed(() => fabState.value === 'processing')
  const currentState = computed(() => {
    if (!appStore.isOnline && fabState.value === 'idle') return 'offline' as FabState
    return fabState.value
  })

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Start voice capture */
  async function startListening() {
    if (fabState.value !== 'idle') return
    if (!appStore.isOnline) {
      // Tier 0 still works offline — proceed
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SpeechRecognition = w.SpeechRecognition ?? w.webkitSpeechRecognition

    if (!SpeechRecognition) {
      lastError.value = 'Speech recognition is not supported in this browser.'
      fabState.value = 'error'
      _autoReset()
      return
    }

    recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    fabState.value = 'listening'
    transcript.value = ''

    recognition.onresult = (event: { results: { 0: { transcript: string } }[] }) => {
      transcript.value = event.results[0][0].transcript
    }

    recognition.onend = () => {
      if (fabState.value === 'listening') {
        _processTranscript(transcript.value)
      }
    }

    recognition.onerror = (event: { error?: string }) => {
      lastError.value = event.error ?? 'Speech recognition failed'
      fabState.value = 'error'
      _autoReset()
    }

    recognition.start()
  }

  /** Stop recording and immediately process */
  function stopListening() {
    if (fabState.value !== 'listening') return
    recognition?.stop()
    // onend handler will fire and call _processTranscript
  }

  /** Cancel and return to idle */
  function cancel() {
    recognition?.abort()
    recognition = null
    fabState.value = 'idle'
    transcript.value = ''
    tierLabel.value = null
    lastError.value = null
  }

  /** Called from the detail sheet after a deferred command is manually resolved */
  function reportManualResolution(result: VoiceProcessorResult) {
    lastResult.value = result
    fabState.value = 'success'
    _autoReset()
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  async function _processTranscript(text: string) {
    if (!text.trim()) {
      fabState.value = 'idle'
      return
    }

    fabState.value = 'processing'
    tierLabel.value = null

    try {
      // Dynamic import keeps the Groq client lazy — not loaded until first use
      const { processTranscript, makeGroqClient } = await import('@homeos/backend/services/voice-processor')
      const { useDbStore } = await import('./db.store')
      const dbStore = useDbStore()

      const groqApiKey = import.meta.env.VITE_GROQ_API_KEY ?? ''
      const groq = makeGroqClient(groqApiKey)

      const result = await processTranscript({
        transcript: text,
        ctx: {
          memberId: appStore.activeMember!._id,
          clientId: dbStore.clientId,
          db: dbStore.adapter,
          notifications: dbStore.notifications,
        },
        groq,
        forceOffline: !appStore.isOnline,
      })

      lastResult.value = result
      latencyMs.value = result.latencyMs

      // Map internal tier → SPEC-000 display label (T0 pattern / T1 cloud / T2 manual).
      // The backend's `t1_on_device` value is the Groq cloud call (no on-device SLM in a PWA);
      // `deferred` is the manual Tier 2 path.
      tierLabel.value =
        result.tier === 't0_pattern' ? 'T0' :
        result.tier === 't1_on_device' ? 'T1' :
        result.tier === 'deferred' ? 'T2' : null

      if (result.errors.length > 0 && result.successes.length === 0) {
        lastError.value = result.spokenResponse
        fabState.value = 'error'
      } else {
        fabState.value = 'success'
      }
    } catch (err) {
      lastError.value = (err as Error).message
      fabState.value = 'error'
    }

    _autoReset()
  }

  function _autoReset(delayMs = 2200) {
    setTimeout(() => {
      if (fabState.value === 'success' || fabState.value === 'error') {
        fabState.value = 'idle'
        lastError.value = null
        tierLabel.value = null
      }
    }, delayMs)
  }

  return {
    fabState, transcript, tierLabel, lastResult, lastError, latencyMs,
    isListening, isProcessing, currentState,
    startListening, stopListening, cancel, reportManualResolution,
  }
})
