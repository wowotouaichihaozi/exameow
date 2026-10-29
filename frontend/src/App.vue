<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import { useConfigStore } from '@/stores/config'
import { useFeedbackStore } from '@/stores/feedback'
import AppShell from '@/components/layout/AppShell.vue'

const configStore = useConfigStore()
const feedbackStore = useFeedbackStore()

const childWindow = ref<string | null>(null)

// 先用 hash 同步检测（避免闪烁），再用 Tauri API 确认
function syncDetect(): string | null {
  const hash = window.location.hash
  if (hash === '#/src-windows/record-overlay') return 'record-overlay'
  if (hash === '#/src-windows/answer-float') return 'answer-float'
  return null
}

childWindow.value = syncDetect()

const childComponent = computed(() => {
  if (childWindow.value === 'record-overlay') {
    return defineAsyncComponent(() => import('@/components/search/RecordOverlay.vue'))
  }
  if (childWindow.value === 'answer-float') {
    return defineAsyncComponent(() => import('@/components/search/AnswerFloat.vue'))
  }
  return null
})

function handleGlobalButtonFeedback(event: MouseEvent) {
  const target = event.target
  if (!(target instanceof Element)) return
  const button = target.closest('button') as HTMLButtonElement | null
  if (!button || button.disabled || button.dataset.haptic === 'none') return
  feedbackStore.vibrate('button')
}

onMounted(async () => {
  document.addEventListener('click', handleGlobalButtonFeedback, true)
  // Tauri API 确认（覆盖 hash 检测结果）
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const label = getCurrentWindow().label
    if (label === 'record-overlay' || label === 'answer-float') {
      childWindow.value = label
    }
  } catch { /* not in Tauri */ }

  if (childWindow.value) {
    const { initChildTheme } = await import('@/utils/childTheme')
    await initChildTheme()
    return
  }
  await configStore.loadSaved()

  const { registerDefaultMcpTools, startMcpBridge } = await import('@/mcp')
  registerDefaultMcpTools()
  startMcpBridge()

  const { isTauri, isMobileDevice } = await import('@/utils/platform')
  if (isTauri() && isMobileDevice()) {
    try {
      const { tauriApi } = await import('@/api/bridge')
      await tauriApi.otaNotifyReady()
      tauriApi.otaDownload().catch(() => {})
    } catch { /* OTA unavailable */ }
  }
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalButtonFeedback, true)
})
</script>

<template>
  <AppShell v-if="!childWindow" />
  <component v-else :is="childComponent" />
</template>
