<script setup lang="ts">
import { computed } from 'vue'
import type { ReasoningEffort } from '@exameow/shared'

const props = defineProps<{ modelValue: ReasoningEffort | null; disabled?: boolean }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: ReasoningEffort | null): void }>()
const levels: { value: ReasoningEffort | null; label: string }[] = [
  { value: null, label: '默认' },
  { value: 'none', label: '关闭' },
  { value: 'minimal', label: '极低' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
  { value: 'max', label: '最大' },
]
const activeIndex = computed(() => Math.max(0, levels.findIndex(level => level.value === props.modelValue)))
const progress = computed(() => `${activeIndex.value / (levels.length - 1) * 100}%`)
function handleInput(event: Event) {
  const level = levels[(event.target as HTMLInputElement).valueAsNumber]
  if (level && level.value !== props.modelValue) emit('update:modelValue', level.value)
}
</script>

<template>
  <div class="thinking-slider select-none" :class="{ 'opacity-50': disabled }">
    <div class="flex items-center justify-between text-xs gap-2">
      <span>思考强度</span>
      <strong style="color: rgb(var(--md-primary))">{{ levels[activeIndex]?.label }}</strong>
    </div>
    <input
      class="thinking-slider__input"
      type="range"
      min="0"
      :max="levels.length - 1"
      step="1"
      :value="activeIndex"
      :disabled="disabled"
      aria-label="深度思考强度"
      :aria-valuetext="levels[activeIndex]?.label"
      :style="{ '--slider-progress': progress }"
      data-haptic="none"
      @input="handleInput"
    />
    <div class="thinking-slider__labels" aria-hidden="true">
      <span v-for="(level, index) in levels" :key="level.value ?? 'default'" :class="{ 'is-active': activeIndex === index }">{{ level.label }}</span>
    </div>
    <p class="text-[11px] opacity-60 mt-3">默认沿用模型设置；可用档位取决于模型。更改后用于下一条消息。</p>
  </div>
</template>

<style scoped>
.thinking-slider__input {
  display: block;
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 44px;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  touch-action: pan-y;
  -webkit-tap-highlight-color: transparent;
}
.thinking-slider__input::-webkit-slider-runnable-track {
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(to right, rgb(var(--md-primary)) 0% var(--slider-progress), rgb(var(--md-surface-container-highest)) var(--slider-progress) 100%);
}
.thinking-slider__input::-moz-range-track {
  height: 8px;
  border-radius: 999px;
  background: rgb(var(--md-surface-container-highest));
}
.thinking-slider__input::-moz-range-progress {
  height: 8px;
  border-radius: 999px;
  background: rgb(var(--md-primary));
}
.thinking-slider__input::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 24px;
  height: 24px;
  margin-top: -8px;
  border: 3px solid rgb(var(--md-surface));
  border-radius: 50%;
  background: rgb(var(--md-primary));
  box-shadow: 0 1px 5px rgb(var(--md-primary) / 0.3);
}
.thinking-slider__input::-moz-range-thumb {
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  border: 3px solid rgb(var(--md-surface));
  border-radius: 50%;
  background: rgb(var(--md-primary));
}
.thinking-slider__input:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
  border-radius: 12px;
}
.thinking-slider__labels {
  display: flex;
  justify-content: space-between;
  margin: 0 12px;
  font-size: 11px;
  color: rgb(var(--md-on-surface-variant));
}
.thinking-slider__labels span { width: 0; display: flex; justify-content: center; white-space: nowrap; }
.thinking-slider__labels .is-active { color: rgb(var(--md-primary)); font-weight: 700; }
</style>
