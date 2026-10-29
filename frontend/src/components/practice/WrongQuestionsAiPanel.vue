<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Question, ReasoningEffort } from '@exameow/shared'
import { useLearnStore } from '@/stores/learn'
import { useConfigStore } from '@/stores/config'
import { usePracticeStore } from '@/stores/practice'
import { useWrongQuestionsStore } from '@/stores/wrongQuestions'
import { SparklesIcon } from '@heroicons/vue/24/outline'

const props = defineProps<{ bankId: string }>()

const router = useRouter()
const configStore = useConfigStore()
const practiceStore = usePracticeStore()
const wrongStore = useWrongQuestionsStore()
const learn = useLearnStore()

const ANALYSIS_SETTINGS_KEY = 'exameow-wrong-ai-settings'
const savedAnalysisSettings = (() => {
  try {
    return JSON.parse(localStorage.getItem(ANALYSIS_SETTINGS_KEY) || '{}')
  } catch {
    return {}
  }
})()
const thinkingLevel = ref<ReasoningEffort>(
  savedAnalysisSettings.thinking === 'low' || savedAnalysisSettings.thinking === 'high'
    ? savedAnalysisSettings.thinking
    : 'medium',
)
const webEnabled = ref(savedAnalysisSettings.web === true)
const showPicker = ref(false)
const selectedIds = ref<string[]>([])
const opening = ref(false)
const thinkingOptions: { value: ReasoningEffort; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

watch(
  [thinkingLevel, webEnabled],
  () => {
    try {
      localStorage.setItem(ANALYSIS_SETTINGS_KEY, JSON.stringify({
        thinking: thinkingLevel.value,
        web: webEnabled.value,
      }))
    } catch {}
  },
)

const wrongQuestions = computed(() =>
  wrongStore.getWrongQuestions(props.bankId, 'time-desc'),
)

const selectedQuestions = computed(() => {
  const selected = new Set(selectedIds.value)
  return wrongQuestions.value.filter(q => selected.has(q.id))
})

const allSelected = computed(() =>
  wrongQuestions.value.length > 0 && selectedIds.value.length === wrongQuestions.value.length,
)

watch(
  [() => props.bankId, wrongQuestions],
  () => {
    selectedIds.value = wrongQuestions.value.map(q => q.id)
  },
  { immediate: true },
)

function toggleQuestion(id: string) {
  const selected = new Set(selectedIds.value)
  if (selected.has(id)) selected.delete(id)
  else selected.add(id)
  selectedIds.value = [...selected]
}

function selectAll() {
  selectedIds.value = wrongQuestions.value.map(q => q.id)
}

function clearSelection() {
  selectedIds.value = []
}

function userAnswerText(question: Question): string {
  const progress = practiceStore.getQuestionProgress(props.bankId, question.id)
  if (!progress) return '未记录'
  if (progress.userAnswerText) return progress.userAnswerText.replaceAll('\u0001', ' / ')
  return progress.userAnswer || '未记录'
}

function buildPrompt(questions: Question[]): string {
  const items = questions.map((question, index) => {
    const entry = wrongStore.getWrongEntry(props.bankId, question.id)
    return [
      `错题 ${index + 1}${question.chapter ? `（${question.chapter}）` : ''}：${question.stem}`,
      question.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join('\n'),
      `正确答案：${question.answer}`,
      `我的答案：${userAnswerText(question)}`,
      `错误次数：${entry?.wrongCount ?? 1}`,
      `题库解析：${question.analysis || '无'}`,
    ].join('\n')
  })

  return [
    `请分析以下 ${questions.length} 道错题。`,
    '输出要求：',
    '1. 先按主题归纳错误类型和共同薄弱知识点。',
    '2. 列出最容易混淆的概念，并解释区别。',
    '3. 给出按优先级排列的复习清单。',
    '4. 最后提供一组精简的针对性练习建议。',
    '不要逐题重复题库原文，重点做归纳、关联和可执行建议。',
    '',
    items.join('\n\n'),
  ].join('\n')
}

async function toggleWeb() {
  if (!configStore.searchConfigured) {
    router.push({ path: '/mine/config', query: { section: 'search' } })
    return
  }
  webEnabled.value = !webEnabled.value
}

async function submitAnalysis() {
  if (selectedQuestions.value.length === 0 || opening.value) return
  if (!configStore.configured) await configStore.loadSaved()
  if (!configStore.configured) {
    router.push('/mine/config')
    return
  }

  opening.value = true
  try {
    learn.startSummary({
      bankId: props.bankId,
      bankName: practiceStore.getBank(props.bankId)?.name || '题库',
      prompt: buildPrompt(selectedQuestions.value),
      count: selectedQuestions.value.length,
      thinking: thinkingLevel.value,
      search: webEnabled.value,
    })
    await router.push('/ai')
    void learn.retry()
  } finally {
    opening.value = false
  }
}
</script>

<template>
  <section class="card-filled p-4 sm:p-5 mb-4 space-y-4">
    <div class="flex items-start gap-3">
      <div
        class="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
        :style="{ backgroundColor: 'rgb(var(--md-primary-container))', color: 'rgb(var(--md-on-primary-container))' }"
      >
        <SparklesIcon class="w-5 h-5" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="text-title-sm font-semibold">AI 错题归纳总结</h2>
          <span class="text-xs opacity-70">共 {{ wrongQuestions.length }} 道错题</span>
        </div>
        <p class="text-body-sm mt-1" :style="{ color: 'rgb(var(--md-on-surface-variant))' }">
          选择错题后，AI 会归纳薄弱知识点、易混概念和复习优先级。
        </p>
      </div>
    </div>

    <div v-if="wrongQuestions.length === 0" class="rounded-2xl px-4 py-5 text-center text-body-sm" :style="{ backgroundColor: 'rgb(var(--md-surface-container-low))', color: 'rgb(var(--md-on-surface-variant))' }">
      当前题库还没有错题。
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center gap-2">
        <button class="btn-tonal !h-9 !px-3 text-xs" @click="showPicker = !showPicker">
          选择错题 · {{ selectedQuestions.length }}/{{ wrongQuestions.length }}
        </button>
        <button class="btn-outlined !h-9 !px-3 text-xs" @click="allSelected ? clearSelection() : selectAll()">
          {{ allSelected ? '取消全选' : '一键全选错题' }}
        </button>
      </div>

      <div v-if="showPicker" class="max-h-72 overflow-y-auto rounded-2xl border" :style="{ borderColor: 'rgb(var(--md-outline-variant) / 0.45)' }">
        <label
          v-for="(question, index) in wrongQuestions"
          :key="question.id"
          class="flex items-start gap-3 px-3 py-2.5 cursor-pointer border-b last:border-b-0"
          :style="{ borderColor: 'rgb(var(--md-outline-variant) / 0.25)' }"
        >
          <input
            type="checkbox"
            class="mt-1"
            :style="{ accentColor: 'rgb(var(--md-primary))' }"
            :checked="selectedIds.includes(question.id)"
            @change="toggleQuestion(question.id)"
          />
          <span class="text-xs opacity-60 w-7 shrink-0">{{ index + 1 }}</span>
          <span class="text-sm min-w-0 flex-1">{{ question.stem }}</span>
        </label>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <div class="text-label-sm mb-2">思考强度</div>
          <div class="grid grid-cols-3 gap-1.5 p-1 rounded-2xl" :style="{ backgroundColor: 'rgb(var(--md-surface-container-high))' }">
            <button
              v-for="option in thinkingOptions"
              :key="option.value"
              class="h-8 rounded-xl text-xs"
              :style="{
                backgroundColor: thinkingLevel === option.value ? 'rgb(var(--md-primary-container))' : 'transparent',
                color: thinkingLevel === option.value ? 'rgb(var(--md-on-primary-container))' : 'rgb(var(--md-on-surface-variant))',
              }"
              @click="thinkingLevel = option.value"
            >
              {{ option.label }}
            </button>
          </div>
        </div>
        <div>
          <div class="text-label-sm mb-2">联网检索</div>
          <button
            class="w-full h-10 rounded-2xl border text-sm flex items-center justify-center"
            :style="{
              borderColor: webEnabled ? 'rgb(var(--md-primary))' : 'rgb(var(--md-outline-variant) / 0.45)',
              color: webEnabled ? 'rgb(var(--md-primary))' : 'rgb(var(--md-on-surface-variant))',
              backgroundColor: webEnabled ? 'rgb(var(--md-primary-container) / 0.35)' : 'transparent',
            }"
            @click="toggleWeb"
          >
            {{ configStore.searchConfigured ? (webEnabled ? '已开启（点击关闭）' : '已关闭（点击开启）') : '未配置联网搜索' }}
          </button>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          class="btn-filled flex-1 !h-10 text-sm"
          :disabled="selectedQuestions.length === 0 || opening"
          @click="submitAnalysis"
        >
          <SparklesIcon class="w-4 h-4" />
          {{ opening ? '打开对话…' : `分析所选 ${selectedQuestions.length} 道错题` }}
        </button>
        <button class="btn-outlined !h-10 !px-4 text-sm" @click="router.push({ path: '/ai', query: { history: '1' } })">
          历史会话
        </button>
      </div>

    </template>
  </section>
</template>
