import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * Controls app-shell chrome that must temporarily yield to focused workflows.
 */
export const useUiStore = defineStore('ui', () => {
  const immersive = ref(false)

  function setImmersive(value: boolean) {
    immersive.value = value
  }

  return {
    immersive,
    setImmersive,
  }
})
