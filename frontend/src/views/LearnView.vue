<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18nStore } from '@/stores/i18n'
import { useConfigStore } from '@/stores/config'
import { usePracticeStore } from '@/stores/practice'
import { useLearnStore } from '@/stores/learn'
import { useUiStore } from '@/stores/ui'
import ChatBubble from '@/components/learn/ChatBubble.vue'
import ChatComposer from '@/components/learn/ChatComposer.vue'
import QuestionImages from '@/components/practice/QuestionImages.vue'
import { mediaIds } from '@/utils/questionMedia'
import { ArrowLeftIcon, ArrowPathIcon, ChevronLeftIcon, ChevronRightIcon, GlobeAltIcon, QueueListIcon, SparklesIcon, ClockIcon, PlusIcon, XMarkIcon } from '@heroicons/vue/24/outline'

const router = useRouter()
const route = useRoute()
const i18n = useI18nStore()
const configStore = useConfigStore()
const practiceStore = usePracticeStore()
const learn = useLearnStore()
const uiStore = useUiStore()

const listEl = ref<HTMLElement | null>(null)
const showLlmDialog = ref(false)
const showSearchDialog = ref(false)
const showHistory = ref(false)
const historyQuery = ref('')
const historyOpening = ref(false)
const isAiModule = computed(() => route.path === '/ai')
const isLearning = computed(() => learn.conversationKind === 'learn')
const filteredHistory = computed(() => learn.history.filter(item => `${item.title} ${item.bankName}`.toLowerCase().includes(historyQuery.value.trim().toLowerCase())))
const SEARCH_TIP_KEY = 'exameow-learn-search-tip-dismissed'

const visibleMessages = computed(() => learn.messages.filter((m) => !m.hidden))
const notConfigured = computed(() => !configStore.configured)
const diagramAnswerReady = computed(
  () =>
    !!learn.currentQuestion &&
    learn.currentQuestion.type === 'short_answer' &&
    learn.currentQuestion.stem.startsWith('【画图简答·') &&
    !learn.awaitingAnswer &&
    learn.messages.some(
      (m) => m.role === 'assistant' && m.content.includes('参考答案'),
    ),
)
const errorMessage = computed(() =>
  learn.error && learn.error !== 'not-configured' ? learn.error : '',
)
const progressText = computed(() =>
  i18n.t('practiceProgress', { c: learn.progress.current, t: learn.progress.total }),
)

function scrollToBottom() {
  nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(
  () => learn.messages.map((m) => `${m.content.length}:${m.reasoning?.length ?? 0}`).join(','),
  () => {
    const el = listEl.value
    if (!el || el.scrollHeight - el.scrollTop - el.clientHeight < 160) scrollToBottom()
  },
)
watch(() => learn.conversationId, scrollToBottom)

async function openHistory() {
  showHistory.value = true
  await learn.refreshHistory()
}

async function selectConversation(id: string) {
  if (historyOpening.value) return
  historyOpening.value = true
  try {
    if (await learn.openConversation(id)) {
      showHistory.value = false
      scrollToBottom()
    }
  } finally { historyOpening.value = false }
}

function newChat() {
  learn.startChat()
  showHistory.value = false
}

onMounted(async () => {
  uiStore.setImmersive(!isAiModule.value)
  if (!configStore.configured) await configStore.loadSaved()
  if (!learn.hasSession) await learn.restoreLast()
  if (!learn.hasSession) {
    learn.startChat()
  }
  if (route.query.history === '1') void openHistory()
  scrollToBottom()
})

onUnmounted(() => {
  learn.stop()
  uiStore.setImmersive(false)
})

async function handleSend(text: string) {
  if (!learn.awaitingAnswer) {
    if (!configStore.configured) await configStore.loadSaved()
    if (!configStore.configured) {
      showLlmDialog.value = true
      return
    }
  }
  await learn.send(text)
}

function toggleSearch() {
  if (!configStore.searchConfigured) {
    showSearchDialog.value = true
    return
  }
  learn.webSearchEnabled = !learn.webSearchEnabled
}

function goBack() {
  router.push('/practice')
}

/** Switch to normal practice, positioned on the question currently being studied. */
function backToPractice() {
  const bankId = learn.bankId
  const target = learn.currentQuestion
  if (!bankId || !target) {
    router.push('/practice')
    return
  }
  const existing = practiceStore.session
  const aligned =
    existing !== null &&
    existing.bankId === bankId &&
    existing.questions[learn.currentIndex]?.question.stem === target.stem
  if (aligned) {
    practiceStore.goToQuestion(learn.currentIndex)
  } else {
    const started = practiceStore.startSession(
      bankId,
      'sequential',
      undefined,
      learn.questions.slice(),
      undefined,
    )
    if (!started) {
      router.push('/practice')
      return
    }
    practiceStore.goToQuestion(learn.currentIndex)
  }
  router.push({ path: '/practice', query: { resume: '1' } })
}

function goConfig() {
  showLlmDialog.value = false
  showSearchDialog.value = false
  router.push('/mine/config')
}

function goSearchConfig() {
  showSearchDialog.value = false
  localStorage.setItem(SEARCH_TIP_KEY, '1')
  router.push({ path: '/mine/config', query: { section: 'search' } })
}

function dismissSearchTip() {
  showSearchDialog.value = false
  localStorage.setItem(SEARCH_TIP_KEY, '1')
}
</script>

<template>
  <div class="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-3 pt-3 sm:px-6">
    <!-- Header -->
    <div class="shrink-0 flex items-center gap-2 mb-3" :class="{ 'safe-top': !isAiModule }">
      <button class="btn-icon" @click="goBack">
        <ArrowLeftIcon class="w-5 h-5 rtl:rotate-180" />
      </button>
      <div class="flex-1 min-w-0">
        <div class="text-title-md truncate" :style="{ color: 'rgb(var(--md-on-surface))' }">
          {{ learn.conversationKind === 'summary' ? '错题归纳总结' : isLearning ? i18n.t('learnTitle') : 'AI 对话' }}
        </div>
        <div class="text-body-sm truncate" :style="{ color: 'rgb(var(--md-on-surface-variant))' }">
          {{ isLearning ? `${learn.bankName} · ${progressText}` : learn.conversationTitle }}
        </div>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button class="btn-icon" title="历史会话" aria-label="历史会话" @click="openHistory"><ClockIcon class="w-5 h-5" /></button>
        <button class="btn-icon" title="新对话" aria-label="新对话" @click="newChat"><PlusIcon class="w-5 h-5" /></button>
        <button
          v-if="isLearning"
          class="btn-icon"
          :title="i18n.t('learnRestart')"
          :aria-label="i18n.t('learnRestart')"
          @click="learn.restart()"
        >
          <ArrowPathIcon class="w-4 h-4" />
        </button>
        <button
          v-if="isLearning"
          class="btn-outlined !h-9 !px-3 shrink-0"
          :title="i18n.t('practiceModeSequential')"
          @click="backToPractice"
        >
          <QueueListIcon class="w-4 h-4" />
          <span class="hidden lg:inline">{{ i18n.t('practiceModeSequential') }}</span>
        </button>
        <button v-if="isLearning" class="btn-tonal !h-9 !px-3" :disabled="learn.isFirst" @click="learn.prev()">
          <ChevronLeftIcon class="w-4 h-4 rtl:rotate-180" />
          <span class="hidden sm:inline">{{ i18n.t('practicePrevBtn') }}</span>
        </button>
        <button v-if="isLearning" class="btn-tonal !h-9 !px-3" :disabled="learn.isLast" @click="learn.next()">
          <span class="hidden sm:inline">{{ i18n.t('practiceNextBtn') }}</span>
          <ChevronRightIcon class="w-4 h-4 rtl:rotate-180" />
        </button>
      </div>
    </div>

    <!-- Messages -->
    <div ref="listEl" class="flex-1 overflow-y-auto space-y-4 py-1 pr-1">
      <div v-if="!visibleMessages.length" class="h-full flex flex-col items-center justify-center text-center px-5 gap-3">
        <SparklesIcon class="w-10 h-10 opacity-60" />
        <h1 class="text-title-lg">今天想聊些什么？</h1>
        <p class="text-body-sm opacity-70">可以直接提问，也可以从历史会话继续学习或复习错题。</p>
        <button class="btn-tonal" @click="openHistory">选择历史会话</button>
      </div>
      <ChatBubble
        v-for="m in visibleMessages"
        :key="m.id"
        :message="m"
        :question="m.kind === 'question' ? learn.currentQuestion : null"
        :disabled="learn.streaming || (m.kind === 'question' && !learn.awaitingAnswer)"
        @answer="handleSend"
      />
      <div
        v-if="diagramAnswerReady"
        class="card-elevated p-3"
      >
        <div class="text-label-sm">参考答案图</div>
        <QuestionImages :ids="mediaIds(learn.currentQuestion?.media, 'stem')" />
      </div>
    </div>

    <!-- Error -->
    <p v-if="learn.storageError" class="text-sm py-2" style="color: rgb(var(--md-error))">{{ learn.storageError }}</p>
    <div
      v-if="errorMessage"
      class="shrink-0 mt-2 p-3 rounded-xl text-sm flex items-center justify-between gap-2"
      :style="{ backgroundColor: 'rgba(var(--md-error), 0.08)', color: 'rgb(var(--md-error))' }"
    >
      <span class="min-w-0 break-words">{{ errorMessage }}</span>
      <button class="btn-tonal !h-7 !px-3 text-xs shrink-0" @click="learn.retry()">
        {{ i18n.t('searchRetry') }}
      </button>
    </div>

    <!-- Not configured -->
    <div v-if="notConfigured" class="shrink-0 mt-2 text-center">
      <button class="text-sm underline" :style="{ color: 'rgb(var(--md-error))' }" @click="goConfig">
        {{ i18n.t('searchNotConfigured') }}
      </button>
    </div>

    <!-- Composer -->
    <div class="shrink-0 pt-3 pb-3" :class="{ 'safe-bottom': !isAiModule }">
      <ChatComposer
        :key="learn.conversationId"
        :streaming="learn.streaming"
        :awaiting-answer="learn.awaitingAnswer"
        :disabled="false"
        :search-enabled="learn.webSearchEnabled"
        v-model:thinking-level="learn.thinkingLevel"
        @send="handleSend"
        @stop="learn.stop()"
        @toggle-search="toggleSearch"
      />
    </div>

    <Teleport to="body">
      <div v-if="showHistory" class="scrim flex items-center justify-center p-3 sm:p-6" @click.self="showHistory = false" @keydown.esc="showHistory = false">
        <section role="dialog" aria-modal="true" aria-label="AI 历史会话" class="card-elevated flex flex-col w-full max-w-lg max-h-[80dvh] p-5">
          <div class="flex items-center justify-between gap-2 mb-2">
            <h2 class="text-title-md">历史会话</h2>
            <button class="btn-icon" aria-label="关闭历史会话" @click="showHistory = false"><XMarkIcon class="w-5 h-5" /></button>
          </div>
          <p class="text-body-sm opacity-70 mb-3">AI 对话、和 AI 一起学、错题归纳共用记录</p>
          <input v-model="historyQuery" class="rounded-xl border bg-transparent p-3 mb-3 text-sm" placeholder="搜索会话或题库" aria-label="搜索历史会话" />
          <div class="min-h-0 overflow-y-auto space-y-2">
            <p v-if="!filteredHistory.length" class="text-sm opacity-60 py-6 text-center">{{ historyQuery ? '没有匹配的会话' : '暂无历史会话' }}</p>
            <button v-for="item in filteredHistory" :key="item.id" class="w-full rounded-2xl p-3 text-left border" :disabled="historyOpening" :style="{ borderColor: item.id === learn.conversationId ? 'rgb(var(--md-primary))' : 'rgb(var(--md-outline-variant) / 0.4)', backgroundColor: 'rgb(var(--md-surface-container-low))' }" @click="selectConversation(item.id)">
              <div class="flex gap-2 items-center mb-1 text-xs opacity-70"><span>{{ item.kind === 'summary' ? '错题归纳' : item.kind === 'learn' ? '和 AI 一起学' : 'AI 对话' }}</span><span class="ml-auto">{{ new Date(item.updatedAt).toLocaleString() }}</span></div>
              <div class="text-sm font-semibold truncate">{{ item.title }}</div>
              <div v-if="item.bankName" class="text-xs opacity-60 truncate mt-1">{{ item.bankName }}</div>
            </button>
          </div>
          <button class="btn-tonal mt-4 shrink-0" @click="newChat"><PlusIcon class="w-4 h-4" />新对话</button>
        </section>
      </div>
    </Teleport>

    <Transition name="scale">
      <div v-if="showLlmDialog" class="scrim flex items-center justify-center p-4">
        <div class="card-elevated w-full max-w-sm p-6 text-center">
          <div
            class="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            :style="{ backgroundColor: 'rgb(var(--md-primary-container))' }"
          >
            <SparklesIcon class="w-6 h-6" :style="{ color: 'rgb(var(--md-on-primary-container))' }" />
          </div>
          <div class="text-title-md mb-2" :style="{ color: 'rgb(var(--md-on-surface))' }">
            {{ i18n.t('learnNeedLlmTitle') }}
          </div>
          <p class="text-body-sm mb-5" :style="{ color: 'rgb(var(--md-on-surface-variant))' }">
            {{ i18n.t('learnNeedLlmDesc') }}
          </p>
          <div class="flex gap-3">
            <button class="btn-outlined flex-1" @click="goBack">{{ i18n.t('btnBack') }}</button>
            <button class="btn-filled flex-1" @click="goConfig">{{ i18n.t('learnNeedLlmCta') }}</button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="scale">
      <div
        v-if="showSearchDialog"
        class="scrim flex items-center justify-center p-4"
        @click.self="dismissSearchTip"
      >
        <div class="card-elevated w-full max-w-sm p-6 text-center">
          <div
            class="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            :style="{ backgroundColor: 'rgb(var(--md-secondary-container))' }"
          >
            <GlobeAltIcon class="w-6 h-6" :style="{ color: 'rgb(var(--md-on-secondary-container))' }" />
          </div>
          <div class="text-title-md mb-2" :style="{ color: 'rgb(var(--md-on-surface))' }">
            {{ i18n.t('learnSearchTipTitle') }}
          </div>
          <p class="text-body-sm mb-5" :style="{ color: 'rgb(var(--md-on-surface-variant))' }">
            {{ i18n.t('learnSearchTipDesc') }}
          </p>
          <div class="flex gap-3">
            <button class="btn-outlined flex-1" @click="dismissSearchTip">
              {{ i18n.t('learnSearchTipDismiss') }}
            </button>
            <button class="btn-filled flex-1" @click="goSearchConfig">
              {{ i18n.t('learnSearchTipCta') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
