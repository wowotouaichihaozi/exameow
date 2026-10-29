import { defineStore } from 'pinia'
import { reactive, watch } from 'vue'

export type FeedbackLevel = 'off' | 'low' | 'medium' | 'high'
export type FeedbackKind = 'button' | 'correct' | 'wrong'

export interface FeedbackSettings {
  button: FeedbackLevel
  correct: FeedbackLevel
  wrong: FeedbackLevel
  screenShake: FeedbackLevel
}

const STORAGE_KEY = 'exameow-feedback'
const DEFAULTS: FeedbackSettings = {
  button: 'low',
  correct: 'medium',
  wrong: 'high',
  screenShake: 'medium',
}

function loadSettings(): FeedbackSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    const valid = (value: unknown): value is FeedbackLevel =>
      value === 'off' || value === 'low' || value === 'medium' || value === 'high'
    return {
      button: valid(parsed.button) ? parsed.button : DEFAULTS.button,
      correct: valid(parsed.correct) ? parsed.correct : DEFAULTS.correct,
      wrong: valid(parsed.wrong) ? parsed.wrong : DEFAULTS.wrong,
      screenShake: valid(parsed.screenShake) ? parsed.screenShake : DEFAULTS.screenShake,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

function vibrationPattern(kind: FeedbackKind, level: FeedbackLevel): number | number[] | null {
  if (level === 'off') return null
  const duration = level === 'low' ? 10 : level === 'medium' ? 18 : 28
  if (kind === 'button') return duration
  if (kind === 'correct') {
    const tap = level === 'low' ? 8 : level === 'medium' ? 12 : 18
    return [tap, 32, tap]
  }
  const pulse = level === 'low' ? 18 : level === 'medium' ? 28 : 42
  return [pulse, 45, pulse]
}

export const useFeedbackStore = defineStore('feedback', () => {
  const settings = reactive<FeedbackSettings>(loadSettings())

  watch(settings, () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {}
  }, { deep: true })

  function vibrate(kind: FeedbackKind) {
    const pattern = vibrationPattern(kind, settings[kind])
    if (!pattern || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
    try {
      navigator.vibrate(pattern)
    } catch {}
  }

  function setLevel(key: keyof FeedbackSettings, value: FeedbackLevel) {
    settings[key] = value
  }

  function preview(kind: FeedbackKind) {
    vibrate(kind)
  }

  return {
    settings,
    setLevel,
    vibrate,
    preview,
  }
})
