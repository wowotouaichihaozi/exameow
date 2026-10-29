<script setup lang="ts">
import { computed } from 'vue'
import type { FeedbackLevel } from '@/stores/feedback'

const props = defineProps<{
  modelValue: FeedbackLevel
  label: string
  levels: { value: FeedbackLevel; label: string }[]
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: FeedbackLevel): void
}>()

const activeIndex = computed(() => Math.max(
  props.levels.findIndex(level => level.value === props.modelValue), 0,
))
const progress = computed(() => `${activeIndex.value / Math.max(props.levels.length - 1, 1) * 100}%`)

function handleInput(event: Event) {
  const index = (event.target as HTMLInputElement).valueAsNumber
  const level = props.levels[index]
  if (level && level.value !== props.modelValue) emit('update:modelValue', level.value)
}
</script>

<template>
  <div class="feedback-slider select-none">
    <input
      class="feedback-slider__input"
      type="range"
      min="0"
      :max="levels.length - 1"
      step="1"
      :value="activeIndex"
      :aria-label="label"
      :aria-valuetext="levels[activeIndex]?.label"
      :style="{ '--slider-progress': progress }"
      data-haptic="none"
      @input="handleInput"
    />
    <div class="feedback-slider__labels" aria-hidden="true">
      <span
        v-for="(level, index) in levels"
        :key="level.value"
        class="feedback-slider__label"
        :class="{ 'feedback-slider__label--active': activeIndex === index }"
      >
        {{ level.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.feedback-slider {
  --slider-thumb-size: 24px;
}

.feedback-slider__input {
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

.feedback-slider__input::-webkit-slider-runnable-track {
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(to right,
    rgb(var(--md-primary)) 0% var(--slider-progress),
    rgb(var(--md-surface-container-highest)) var(--slider-progress) 100%);
}

.feedback-slider__input::-moz-range-track {
  height: 8px;
  border-radius: 999px;
  background: rgb(var(--md-surface-container-highest));
}

.feedback-slider__input::-moz-range-progress {
  height: 8px;
  border-radius: 999px;
  background: rgb(var(--md-primary));
}

.feedback-slider__input::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: var(--slider-thumb-size);
  height: var(--slider-thumb-size);
  margin-top: -8px;
  border: 3px solid rgb(var(--md-surface));
  border-radius: 50%;
  background: rgb(var(--md-primary));
  box-shadow: 0 1px 5px rgb(var(--md-primary) / 0.3);
}

.feedback-slider__input::-moz-range-thumb {
  box-sizing: border-box;
  width: var(--slider-thumb-size);
  height: var(--slider-thumb-size);
  border: 3px solid rgb(var(--md-surface));
  border-radius: 50%;
  background: rgb(var(--md-primary));
  box-shadow: 0 1px 5px rgb(var(--md-primary) / 0.3);
}

.feedback-slider__input:focus-visible {
  outline: 2px solid rgb(var(--md-primary));
  outline-offset: 2px;
  border-radius: 12px;
}

.feedback-slider__labels {
  display: flex;
  justify-content: space-between;
  margin: 0 calc(var(--slider-thumb-size) / 2);
  padding-bottom: 2px;
}

.feedback-slider__label {
  width: 0;
  display: flex;
  justify-content: center;
  font-size: 12px;
  white-space: nowrap;
  color: rgb(var(--md-on-surface-variant));
}

.feedback-slider__label--active {
  color: rgb(var(--md-primary));
  font-weight: 700;
}
</style>
