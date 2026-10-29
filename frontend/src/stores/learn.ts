import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { resolveAIOptions, type AIConfig, type ChatMessage, type Question, type ReasoningEffort } from '@exameow/shared'
import { api } from '@/api'
import { isCloudflare } from '@/utils/platform'
import { useConfigStore } from '@/stores/config'
import { useI18nStore, type Locale } from '@/stores/i18n'
import {
  buildTutorSystemPrompt,
  formatQuestionForDisplay,
  formatUserAnswerForDisplay,
} from '@/utils/learnPrompt'
import { buildSearchQuery, formatSearchContext, searchWithCache } from '@/utils/webSearch'
import { runToolLoop } from '@/utils/toolLoop'
import {
  clearLearnConversation,
  learnCacheKey,
  loadLearnConversation,
  saveLearnConversation,
} from '@/utils/learnCache'
import type { ChatStreamHandlers, ChatToolEvent } from '@/utils/chatStream'
import { listConversations, loadConversation, saveConversation, settledMessages, migrateLegacyConversations, type ConversationInfo } from '@/utils/learnHistory'

export type LearnEntry = 'explain' | 'answer'

export interface LearnMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  hidden?: boolean
  kind?: 'text' | 'question' | 'search' | 'tool'
  streaming?: boolean
  searchStatus?: 'searching' | 'done' | 'error'
  searchCount?: number
  toolId?: string
  toolName?: string
  toolStatus?: 'running' | 'done' | 'error'
  toolDetail?: string
  toolCount?: number
}

const LANGUAGE_NAMES: Record<Locale, string> = {
  zh: 'Chinese',
  'zh-TW': 'Traditional Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  ru: 'Russian',
  ar: 'Arabic',
}

let messageSeq = 0
function nextId(): string {
  messageSeq += 1
  return `learn-msg-${Date.now().toString(36)}-${messageSeq}`
}

export interface LearnStartPayload {
  bankId: string
  bankName: string
  questions: Question[]
  index: number
  entry: LearnEntry
  /** The student's existing answer, carried over when jumping in from a question. */
  userAnswer?: string | null
}

export const useLearnStore = defineStore('learn', () => {
  const configStore = useConfigStore()

  const bankId = ref<string | null>(null)
  const bankName = ref('')
  const questions = ref<Question[]>([])
  const currentIndex = ref(0)
  const messages = ref<LearnMessage[]>([])
  const streaming = ref(false)
  const awaitingAnswer = ref(false)
  const error = ref<string | null>(null)
  const conversationId = ref('')
  const conversationKind = ref<'learn' | 'summary' | 'chat'>('learn')
  const conversationTitle = ref('')
  const history = ref<ConversationInfo[]>([])
  const storageError = ref('')
  const summaryPrompt = ref('')
  const thinkingLevel = ref<ReasoningEffort | null>(null)
  let threads: Record<string, LearnMessage[]> = {}
  let navigationToken = 0

  // Composer toggles kept for the app session. Search follows the saved config
  // until the user flips it, so an already-configured setup keeps working.
  const searchToggle = ref<boolean | null>(null)
  const webSearchEnabled = computed({
    get: () => searchToggle.value ?? configStore.searchConfigured,
    set: (value: boolean) => {
      searchToggle.value = value
    },
  })
  let abortController: AbortController | null = null

  const currentQuestion = computed(() => questions.value[currentIndex.value] ?? null)
  const total = computed(() => questions.value.length)
  const progress = computed(() => ({ current: currentIndex.value + 1, total: total.value }))
  const isFirst = computed(() => currentIndex.value === 0)
  const isLast = computed(() => currentIndex.value >= questions.value.length - 1)
  const hasSession = computed(() => !!conversationId.value && (conversationKind.value !== 'learn' || currentQuestion.value !== null))

  function languageName(): string {
    return LANGUAGE_NAMES[useI18nStore().locale] ?? 'English'
  }

  function buildApiMessages(searchContext?: string): ChatMessage[] {
    const question = currentQuestion.value
    if (!question && conversationKind.value === 'learn') return []
    const history: ChatMessage[] = messages.value
      .filter(
        (m) =>
          m.kind !== 'search' &&
          m.kind !== 'tool' &&
          m.content.trim().length > 0,
      )
      .map((m) => ({ role: m.role, content: m.content }))
    let system = conversationKind.value === 'summary'
      ? `你是学习助教。根据学生选中的错题归纳薄弱知识点、易混概念、复习优先级，并回答后续追问。区分事实、推断和建议。回复语言：${languageName()}。以下是本次会话选定的错题资料：\n\n${summaryPrompt.value}`
      : conversationKind.value === 'chat'
        ? `你是耐心、准确的学习助手，请回答用户问题，帮助理解知识和制定学习计划。回复语言：${languageName()}。`
        : buildTutorSystemPrompt(question!, languageName())
    if (searchContext) system += `\n\n${searchContext}`
    return [{ role: 'system', content: system }, ...history]
  }

  function currentCacheKey(): string | null {
    const question = currentQuestion.value
    if (!bankId.value || !question) return null
    return learnCacheKey(bankId.value, question.id)
  }

  function persistConversation() {
    const key = currentCacheKey()
    const question = currentQuestion.value
    if (conversationKind.value === 'learn' && key && question) {
      saveLearnConversation(key, question.stem, messages.value)
      threads[key] = settledMessages(messages.value)
    }
    if (!conversationId.value || !bankId.value || !messages.value.length) return
    const snapshot = {
      id: conversationId.value, kind: conversationKind.value,
      title: conversationTitle.value, bankId: bankId.value, bankName: bankName.value,
      updatedAt: Date.now(), questions: questions.value, currentIndex: currentIndex.value,
      threads, messages: messages.value, awaitingAnswer: awaitingAnswer.value,
      summaryPrompt: summaryPrompt.value, thinking: thinkingLevel.value,
      deepThinking: false, search: webSearchEnabled.value,
    }
    const info = { id: snapshot.id, kind: snapshot.kind, title: snapshot.title, bankName: snapshot.bankName, updatedAt: snapshot.updatedAt }
    history.value = [info, ...history.value.filter(item => item.id !== info.id)]
    void saveConversation(snapshot).then(() => { storageError.value = '' }).catch(() => {
      storageError.value = '会话保存失败，请检查设备存储空间。当前对话仍可继续。'
    })
  }

  function restoreConversation(): boolean {
    const key = currentCacheKey()
    const question = currentQuestion.value
    if (!key || !question) return false
    const cached = threads[key] ?? loadLearnConversation(key, question.stem)
    if (!cached) return false
    messages.value = cached
    const last = cached[cached.length - 1]
    awaitingAnswer.value = last?.kind === 'question'
    return true
  }

  function cancelStream() {
    abortController?.abort()
    abortController = null
    streaming.value = false
    for (const message of messages.value) message.streaming = false
  }

  /** User-initiated stop keeps the partial answer in the conversation cache. */
  function stop() {
    const wasStreaming = streaming.value
    cancelStream()
    if (wasStreaming) persistConversation()
  }

  /** Clear the whole conversation (per question) — the key to resetting model context. */
  function resetConversation() {
    cancelStream()
    messages.value = []
    error.value = null
    awaitingAnswer.value = false
  }

  function seed(entry: LearnEntry, userAnswer?: string | null) {
    const question = currentQuestion.value
    if (!question) return
    if (entry === 'explain') {
      // Keep the context the student already has: the original question, then
      // their own answer, then the locally available reference material.
      messages.value.push({
        id: nextId(),
        role: 'assistant',
        kind: 'question',
        content: formatQuestionForDisplay(question),
      })
      const answer = userAnswer?.trim()
      if (answer) {
        messages.value.push({
          id: nextId(),
          role: 'user',
          content: formatUserAnswerForDisplay(question, answer),
        })
      }
      // Entering Learn with AI must not contact a remote model. The user can
      // explicitly choose "Ask AI" after reviewing the offline material.
      messages.value.push({
        id: nextId(),
        role: 'assistant',
        kind: 'text',
        content: `**参考答案**：${question.answer}\n\n**解析**：${question.analysis || '本题暂无解析。'}\n\n*需要模型判定或追问时，请主动点击「问 AI」。*`,
      })
      awaitingAnswer.value = false
    } else {
      messages.value.push({
        id: nextId(),
        role: 'assistant',
        kind: 'question',
        content: formatQuestionForDisplay(question),
      })
      awaitingAnswer.value = true
    }
  }

  function start(payload: LearnStartPayload) {
    navigationToken++
    stop()
    persistConversation()
    conversationId.value = crypto.randomUUID()
    conversationKind.value = 'learn'
    conversationTitle.value = payload.questions[payload.index]?.stem.slice(0, 60) || '和 AI 一起学'
    summaryPrompt.value = ''
    thinkingLevel.value = null
    threads = {}
    bankId.value = payload.bankId
    bankName.value = payload.bankName
    questions.value = payload.questions
    const maxIndex = Math.max(payload.questions.length - 1, 0)
    currentIndex.value = Math.min(Math.max(payload.index, 0), maxIndex)
    resetConversation()
    if (!restoreConversation()) {
      seed(payload.entry, payload.userAnswer)
    }
    persistConversation()
  }

  function startSummary(payload: { bankId: string; bankName: string; prompt: string; count: number; thinking: ReasoningEffort; search: boolean }) {
    navigationToken++
    stop()
    persistConversation()
    resetConversation()
    conversationId.value = crypto.randomUUID()
    conversationKind.value = 'summary'
    conversationTitle.value = `${payload.count} 道错题归纳总结`
    bankId.value = payload.bankId
    bankName.value = payload.bankName
    questions.value = []
    currentIndex.value = 0
    threads = {}
    summaryPrompt.value = payload.prompt
    thinkingLevel.value = payload.thinking
    webSearchEnabled.value = payload.search
    messages.value = [{ id: nextId(), role: 'user', content: `请归纳分析所选的 ${payload.count} 道错题，找出薄弱知识点、易混概念，并给出复习建议。` }]
    persistConversation()
  }

  async function refreshHistory() {
    try {
      const { usePracticeStore } = await import('@/stores/practice')
      await migrateLegacyConversations(usePracticeStore().banks)
      history.value = await listConversations()
    }
    catch { storageError.value = '暂时无法读取本地会话记录。' }
  }

  function startChat() {
    navigationToken++
    stop()
    persistConversation()
    resetConversation()
    conversationId.value = crypto.randomUUID()
    conversationKind.value = 'chat'
    conversationTitle.value = '新对话'
    bankId.value = 'general'
    bankName.value = ''
    questions.value = []
    currentIndex.value = 0
    summaryPrompt.value = ''
    thinkingLevel.value = null
    threads = {}
  }

  async function openConversation(id: string): Promise<boolean> {
    stop()
    persistConversation()
    const token = ++navigationToken
    try {
      const saved = await loadConversation(id)
      if (!saved || token !== navigationToken) return false
      resetConversation()
      conversationId.value = saved.id
      conversationKind.value = saved.kind
      conversationTitle.value = saved.title
      bankId.value = saved.bankId
      bankName.value = saved.bankName
      questions.value = saved.questions
      currentIndex.value = saved.currentIndex
      threads = saved.threads
      messages.value = settledMessages(saved.messages)
      awaitingAnswer.value = saved.awaitingAnswer
      summaryPrompt.value = saved.summaryPrompt
      thinkingLevel.value = saved.deepThinking && !['high', 'xhigh', 'max'].includes(saved.thinking ?? '')
        ? 'high'
        : saved.thinking ?? null
      webSearchEnabled.value = saved.search
      return true
    } catch { storageError.value = '无法打开这条会话，请重试。'; return false }
  }

  async function restoreLast() {
    await refreshHistory()
    if (!hasSession.value && history.value[0]) await openConversation(history.value[0].id)
  }

  watch([webSearchEnabled, thinkingLevel], () => persistConversation())

  function goTo(index: number) {
    if (index < 0 || index >= questions.value.length) return
    stop()
    persistConversation()
    currentIndex.value = index
    resetConversation()
    if (!restoreConversation()) {
      seed('answer')
    }
    persistConversation()
  }

  function restart() {
    if (conversationKind.value === 'chat') { startChat(); return }
    stop()
    persistConversation()
    conversationId.value = crypto.randomUUID()
    threads = {}
    const key = currentCacheKey()
    if (key) clearLearnConversation(key)
    resetConversation()
    if (conversationKind.value === 'summary') {
      messages.value = [{ id: nextId(), role: 'user', content: '请重新归纳本次选中的错题，给出薄弱知识点和复习建议。' }]
    } else seed('answer')
    persistConversation()
  }

  function next() {
    if (!isLast.value) goTo(currentIndex.value + 1)
  }

  function prev() {
    if (!isFirst.value) goTo(currentIndex.value - 1)
  }

  // Conservative offline answer checking. Free-form prose cannot be graded
  // reliably, so short-answer questions are left for the learner to self-check.
  function checkLocally(q: Question, text: string): string {
    const strip = (s: string) =>
      s.normalize('NFKC').trim().toLowerCase().replace(/[\s，,。;；、]+/g, '')
    if (q.type === 'short_answer') {
      return strip(text) === strip(q.answer)
        ? '本地核对：与参考答案一致。'
        : '本地核对：简答/画图题无法仅凭文字准确自动评分；请对照答案和评分点自行核对。'
    }
    if (q.type === 'true_false') {
      const getTF = (s: string) => {
        const raw = s.trim().toUpperCase()
        if (/^(A|TRUE|T|Y|YES|1|√|对|正确)$/.test(raw)) return 'T'
        if (/^(B|FALSE|F|N|NO|0|×|错|错误)$/.test(raw)) return 'F'
        return raw.startsWith('A.') ? 'T' : raw.startsWith('B.') ? 'F' : '?'
      }
      return getTF(text) === getTF(q.answer) ? '本地核对：正确。' : '本地核对：不正确。'
    }
    if (q.type === 'single_choice' || q.type === 'multi_choice') {
      const parse = (s: string) => {
        const options = [...s.matchAll(/(?:^|\n)\s*([A-H])[.．、:：]/gi)]
        if (options.length) {
          return options.map((m) => m[1]!.toUpperCase()).sort().join('')
        }
        return s.trim().toUpperCase().replace(/[^A-H]/g, '').split('').sort().join('')
      }
      return parse(text) === parse(q.answer) ? '本地核对：正确。' : '本地核对：不正确。'
    }
    return strip(text) === strip(q.answer)
      ? '本地核对：正确。'
      : '本地核对：未匹配参考答案，请自行检查同义表达。'
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming.value) return
    const question = currentQuestion.value
    if (!question && conversationKind.value === 'learn') return
    if (conversationKind.value === 'chat' && conversationTitle.value === '新对话') conversationTitle.value = trimmed.slice(0, 60)
    messages.value.push({ id: nextId(), role: 'user', content: trimmed })
    if (awaitingAnswer.value && question) {
      messages.value.push({
        id: nextId(),
        role: 'assistant',
        kind: 'text',
        content: `**${checkLocally(question, trimmed)}**\n\n**参考答案**：${question.answer}\n\n**解析**：${question.analysis || '本题暂无解析。'}\n\n*如需模型进一步判定，请点击「问 AI」。*`,
      })
      awaitingAnswer.value = false
      persistConversation()
      return
    }
    persistConversation()
    await streamAssistant()
  }

  /** The only learn-mode action that sends a question to the configured model. */
  async function askAi() {
    if (!configStore.configured) {
      error.value = 'not-configured'
      return
    }
    if (streaming.value) return
    messages.value.push({
      id: nextId(),
      role: 'user',
      hidden: true,
      content:
        '请根据题库的参考答案、评分点和我已提交的回答，判断正确性或回答刚才的问题。请指出依据，并说明简答题的评分仅供参考。',
    })
    await streamAssistant()
  }

  async function retry() {
    if (streaming.value || !hasSession.value) return
    await streamAssistant()
  }

  function lastVisibleUserText(): string | undefined {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const message = messages.value[i]
      if (!message || message.role !== 'user' || message.hidden || message.kind === 'search') continue
      const text = message.content.trim()
      if (text) return text
    }
    return undefined
  }

  /** A conversation's selected level overrides the configured model default. */
  function requestConfig(): AIConfig {
    return { ...configStore.getConfig(), ...(thinkingLevel.value ? { reasoning_effort: thinkingLevel.value } : {}) }
  }

  async function streamAssistant() {
    const question = currentQuestion.value
    if (!question && conversationKind.value === 'learn') return
    if (!configStore.configured) { error.value = 'not-configured'; return }
    error.value = null
    streaming.value = true
    const controller = new AbortController()
    abortController = controller
    const signal = controller.signal

    const finish = () => {
      if (abortController === controller) {
        abortController = null
        streaming.value = false
      }
    }

    let searchContext = ''
    const searchConfig = webSearchEnabled.value ? configStore.getSearchConfig() : null
    if (searchConfig && !configStore.getToolOptions()) {
      const searchMessage: LearnMessage = {
        id: nextId(),
        role: 'assistant',
        kind: 'search',
        content: '',
        searchStatus: 'searching',
      }
      messages.value.push(searchMessage)
      const liveMessage = messages.value[messages.value.length - 1]!
      try {
        const query = question
          ? buildSearchQuery(question, lastVisibleUserText())
          : (lastVisibleUserText() || summaryPrompt.value.slice(0, 220)).slice(0, 220)
        const results = await searchWithCache(searchConfig, query, signal)
        liveMessage.searchStatus = 'done'
        liveMessage.searchCount = results.length
        liveMessage.content = query
        searchContext = formatSearchContext(results)
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') {
          messages.value = messages.value.filter((m) => m.id !== liveMessage.id)
          finish()
          return
        }
        liveMessage.searchStatus = 'error'
        liveMessage.content = ''
      }
    }

    if (signal.aborted) {
      finish()
      return
    }

    // Build the payload BEFORE appending the empty assistant placeholder.
    const apiMessages = buildApiMessages(searchContext)
    const toolOptions = webSearchEnabled.value ? configStore.getToolOptions() : null
    const toolSettings = configStore.getSearchSettings()
    const assistantId = nextId()
    messages.value.push({ id: assistantId, role: 'assistant', content: '', streaming: true })
    // Read the element back through the reactive array so mutations are tracked.
    const assistant = messages.value[messages.value.length - 1]!

    const handleTool = (event: ChatToolEvent) => {
      if (signal.aborted || abortController !== controller) return
      const existing = messages.value.find(
        (message) => message.kind === 'tool' && message.toolId === event.id,
      )
      if (event.phase === 'start') {
        const chip: LearnMessage = {
          id: nextId(),
          role: 'assistant',
          kind: 'tool',
          content: event.detail || event.name || 'tool',
          toolId: event.id,
          toolName: event.name,
          toolStatus: 'running',
          toolDetail: event.detail,
        }
        const index = messages.value.findIndex((message) => message.id === assistantId)
        if (index >= 0) messages.value.splice(index, 0, chip)
        else messages.value.push(chip)
        return
      }
      if (existing) {
        existing.toolStatus = event.ok === false ? 'error' : 'done'
        existing.toolCount = event.count
        return
      }
      if (event.name === 'fallback') {
        const chip: LearnMessage = {
          id: nextId(),
          role: 'assistant',
          kind: 'tool',
          content: 'fallback',
          toolId: event.id,
          toolName: 'fallback',
          toolStatus: 'error',
        }
        const index = messages.value.findIndex((message) => message.id === assistantId)
        if (index >= 0) messages.value.splice(index, 0, chip)
        else messages.value.push(chip)
      }
    }

    const handlers: ChatStreamHandlers = {
      onReasoning: (text) => {
        if (signal.aborted) return
        assistant.reasoning = (assistant.reasoning || '') + text
        scheduleSave()
      },
      onDelta: (text) => {
        if (signal.aborted) return
        assistant.content += text
        scheduleSave()
      },
      onDone: () => {
        assistant.streaming = false
        if (signal.aborted || abortController !== controller) return
        awaitingAnswer.value = false
        if (abortController === controller) persistConversation()
      },
      onError: (e) => {
        assistant.streaming = false
        if (signal.aborted || abortController !== controller) return
        if ((e as { name?: string })?.name === 'AbortError') return
        if (!assistant.content.trim() && !assistant.reasoning?.trim()) {
          messages.value = messages.value.filter((m) => m.id !== assistant.id)
        }
        error.value = e instanceof Error ? e.message : String(e)
        if (abortController === controller) persistConversation()
      },
      onTool: handleTool,
    }

    // Checkpoint partial output without writing once for every token.
    let saveTimer: ReturnType<typeof setTimeout> | undefined
    function scheduleSave() {
      if (saveTimer) return
      saveTimer = setTimeout(() => {
        saveTimer = undefined
        if (abortController === controller) persistConversation()
      }, 1200)
    }

    try {
      const config = requestConfig()
      if (isCloudflare() && configStore.aiProvider === 'custom') {
        const options = resolveAIOptions(config)
        if (toolOptions) {
          await runToolLoop({
            messages: apiMessages,
            config,
            options,
            searchConfig: toolSettings,
            toolOptions,
            handlers,
            signal,
          })
        } else {
          const { chatStreamDirect } = await import('@/utils/chatRequest')
          await chatStreamDirect(apiMessages, config, options, handlers, signal)
        }
      } else {
        await api.chatStream(apiMessages, config, handlers, signal, toolOptions)
      }
    } catch (e) {
      if (!signal.aborted && abortController === controller && (e as { name?: string })?.name !== 'AbortError') {
        assistant.streaming = false
        error.value = e instanceof Error ? e.message : String(e)
        if (abortController === controller) persistConversation()
      }
    } finally {
      clearTimeout(saveTimer)
      assistant.streaming = false
      if (abortController === controller) persistConversation()
      finish()
    }
  }

  return {
    bankId,
    bankName,
    questions,
    currentIndex,
    messages,
    streaming,
    awaitingAnswer,
    error,
    webSearchEnabled,
    currentQuestion,
    total,
    progress,
    isFirst,
    isLast,
    hasSession,
    conversationId,
    conversationKind,
    conversationTitle,
    history,
    storageError,
    thinkingLevel,
    startSummary,
    refreshHistory,
    openConversation,
    restoreLast,
    startChat,
    start,
    goTo,
    next,
    prev,
    send,
    askAi,
    retry,
    restart,
    stop,
  }
})
