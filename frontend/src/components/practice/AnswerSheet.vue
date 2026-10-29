<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { usePracticeStore } from '@/stores/practice'
import { useI18nStore } from '@/stores/i18n'
import { XMarkIcon, CheckIcon, MinusIcon } from '@heroicons/vue/24/outline'

const practiceStore = usePracticeStore()
const i18n = useI18nStore()
const numberList = ref<HTMLElement | null>(null)

async function scrollToCurrent() {
  await nextTick()
  const viewport = numberList.value
  const current = viewport?.querySelector<HTMLElement>('[aria-current="true"]')
  if (!viewport || !current) return
  // Only scroll the number list; the dialog header and the practice page stay put.
  viewport.scrollTop = current.offsetTop - (viewport.clientHeight - current.offsetHeight) / 2
}

onMounted(scrollToCurrent)
watch(() => practiceStore.session?.currentIndex, scrollToCurrent, { flush: 'post' })

const emit = defineEmits<{
  (e: 'close'): void
}>()

const questions = computed(() => {
  if (!practiceStore.session) return []
  return practiceStore.session.questions.map((q, i) => ({
    index: i,
    isCurrent: i === practiceStore.session!.currentIndex,
    submitted: q.submitted === true,
    isCorrect: q.isCorrect,
    answered: q.userAnswer !== null,
  }))
})

const stats = computed(() => {
  const qs = questions.value
  return {
    correct: qs.filter(q => q.isCorrect === true).length,
    wrong: qs.filter(q => q.isCorrect === false).length,
    answered: qs.filter(q => q.submitted).length,
    total: qs.length,
  }
})

function jumpTo(index: number) {
  practiceStore.goToQuestion(index)
  emit('close')
}
</script>

<template>
  <div class="scrim flex items-center justify-center p-4" @click.self="emit('close')">
    <div class="card-elevated flex flex-col w-full max-w-md max-h-[85vh] overflow-hidden p-5" role="dialog" aria-modal="true" :aria-label="i18n.t('practiceAnswerSheet')">
      <div class="flex shrink-0 items-center justify-between mb-4">
        <h3 class="text-title-sm" :style="{ color: 'rgb(var(--md-on-surface))' }">
           {{ i18n.t('practiceAnswerSheet') }}
          <span class="text-body-sm font-normal ml-1" :style="{ color: 'rgb(var(--md-on-surface-variant))' }">
            {{ stats.answered }}/{{ stats.total }}
          </span>
        </h3>
        <button class="btn-icon !w-8 !h-8" @click="emit('close')">
          <XMarkIcon class="w-5 h-5" />
        </button>
      </div>

      <!-- Stats row -->
      <div class="flex shrink-0 items-center gap-4 mb-4 text-sm">
        <div class="flex items-center gap-1.5">
          <div class="w-3 h-3 rounded-sm" :style="{ backgroundColor: 'rgb(var(--md-primary))' }" />
          <span :style="{ color: 'rgb(var(--md-on-surface-variant))' }">{{ i18n.t('practiceCorrect') }} {{ stats.correct }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="w-3 h-3 rounded-sm" :style="{ backgroundColor: 'rgb(var(--md-error))' }" />
          <span :style="{ color: 'rgb(var(--md-on-surface-variant))' }">{{ i18n.t('practiceIncorrect') }} {{ stats.wrong }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <div class="w-3 h-3 rounded-sm border" :style="{ borderColor: 'rgb(var(--md-outline-variant))' }" />
          <span :style="{ color: 'rgb(var(--md-on-surface-variant))' }">{{ i18n.t('practiceUnansweredShort', { n: stats.total - stats.answered }) }}</span>
        </div>
      </div>

      <!-- Number grid -->
      <div ref="numberList" class="min-h-0 overflow-y-auto overscroll-contain p-1 -m-1">
      <div class="relative grid grid-cols-5 sm:grid-cols-6 gap-2">
        <button
          v-for="q in questions"
          :key="q.index"
          :aria-current="q.isCurrent ? 'true' : undefined"
          class="w-full aspect-square rounded-xl flex flex-col items-center justify-center text-xs font-bold transition-all duration-150 border-2"
          :class="q.isCurrent ? 'ring-2 ring-offset-1' : ''"
          :style="{
            backgroundColor: q.isCorrect === true
              ? 'rgb(var(--md-primary-container))'
              : q.isCorrect === false
                ? 'rgb(var(--md-error-container))'
                : q.submitted
                  ? 'rgb(var(--md-surface-container-highest))'
                  : q.answered
                    ? 'rgb(var(--md-secondary-container))'
                    : 'transparent',
            borderColor: q.isCurrent
              ? 'rgb(var(--md-primary))'
              : q.isCorrect === true
                ? 'rgb(var(--md-primary))'
                : q.isCorrect === false
                  ? 'rgb(var(--md-error))'
                  : q.submitted
                    ? 'rgb(var(--md-outline-variant))'
                    : q.answered
                      ? 'rgb(var(--md-secondary))'
                      : 'rgb(var(--md-outline-variant))',
            color: q.isCorrect === true
              ? 'rgb(var(--md-on-primary-container))'
              : q.isCorrect === false
                ? 'rgb(var(--md-on-error-container))'
                : 'rgb(var(--md-on-surface-variant))',
          }"
          @click="jumpTo(q.index)"
        >
          <template v-if="q.isCorrect === true">
            <CheckIcon class="w-3.5 h-3.5 mb-0.5" />
          </template>
          <template v-else-if="q.isCorrect === false">
            <XMarkIcon class="w-3.5 h-3.5 mb-0.5" />
          </template>
          <template v-else-if="q.isCurrent">
            <MinusIcon class="w-3.5 h-3.5 mb-0.5" />
          </template>
          {{ q.index + 1 }}
        </button>
      </div>
      </div>
    </div>
  </div>
</template>
