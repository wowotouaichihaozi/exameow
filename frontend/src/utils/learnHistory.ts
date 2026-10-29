import type { Question, QuestionBank, ReasoningEffort } from '@exameow/shared'
import type { LearnMessage } from '@/stores/learn'

export interface LearnConversation {
  id: string
  kind: 'learn' | 'summary' | 'chat'
  title: string
  bankId: string
  bankName: string
  updatedAt: number
  questions: Question[]
  currentIndex: number
  threads: Record<string, LearnMessage[]>
  messages: LearnMessage[]
  awaitingAnswer: boolean
  summaryPrompt: string
  thinking: ReasoningEffort | null
  deepThinking: boolean
  search: boolean
}

export type ConversationInfo = Pick<LearnConversation, 'id' | 'kind' | 'title' | 'bankName' | 'updatedAt'>

let database: Promise<IDBDatabase> | undefined
function openDatabase(): Promise<IDBDatabase> {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('exameow-ai-conversations', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('conversations', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).catch(error => { database = undefined; throw error })
  }
  return database
}

export function settledMessages(messages: LearnMessage[]): LearnMessage[] {
  return messages
    .filter(m => m.content.trim() || m.reasoning?.trim())
    .map(m => ({
      ...m,
      streaming: false,
      ...(m.searchStatus === 'searching' ? { searchStatus: 'error' as const } : {}),
      ...(m.toolStatus === 'running' ? { toolStatus: 'error' as const } : {}),
    }))
}

export async function saveConversation(conversation: LearnConversation): Promise<void> {
  // Detach Vue proxies before handing data to IndexedDB's structured clone.
  const snapshot = JSON.parse(JSON.stringify(conversation)) as LearnConversation
  snapshot.messages = settledMessages(snapshot.messages)
  for (const key of Object.keys(snapshot.threads)) {
    snapshot.threads[key] = settledMessages(snapshot.threads[key]!)
  }
  const db = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('conversations', 'readwrite')
    transaction.objectStore('conversations').put(snapshot)
    transaction.oncomplete = () => resolve()
    transaction.onabort = transaction.onerror = () => reject(transaction.error)
  })
}

export async function loadConversation(id: string): Promise<LearnConversation | null> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction('conversations').objectStore('conversations').get(id)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
  })
}

export async function listConversations(): Promise<ConversationInfo[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const result: ConversationInfo[] = []
    const request = db.transaction('conversations').objectStore('conversations').openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { resolve(result.sort((a, b) => b.updatedAt - a.updatedAt)); return }
      const { id, kind, title, bankName, updatedAt } = cursor.value as LearnConversation
      result.push({ id, kind, title, bankName, updatedAt })
      cursor.continue()
    }
    request.onerror = () => reject(request.error)
  })
}

/** Import only earlier learning chats and summaries; question AI explanations stay separate. */
export async function migrateLegacyConversations(banks: QuestionBank[]): Promise<void> {
  if (localStorage.getItem('exameow-ai-history-migrated') === '1') return
  const existing = new Set((await listConversations()).map(item => item.id))
  let cache: Record<string, { stem: string; messages: LearnMessage[]; updatedAt: number }> = {}
  try { cache = JSON.parse(localStorage.getItem('exameow-learn-cache') || '{}') ?? {} } catch {}
  for (const bank of banks) {
    const base = {
      bankId: bank.id, bankName: bank.name, currentIndex: 0,
      thinking: null, deepThinking: false, search: false,
    }
    for (const [key, entry] of Object.entries(cache)) {
      if (!key.startsWith(`${bank.id}::`) || !entry || !Array.isArray(entry.messages)) continue
      const id = `legacy-learn:${key}`
      if (existing.has(id)) continue
      const question = bank.questions.find(q => q.stem === entry.stem)
      if (!question) continue
      const messages = settledMessages(entry.messages.filter(m => m && typeof m.content === 'string'))
      if (!messages.length) continue
      await saveConversation({
        ...base, id, kind: 'learn', title: question.stem.slice(0, 60),
        updatedAt: entry.updatedAt || Date.now(), questions: [question], threads: {},
        messages, awaitingAnswer: messages.at(-1)?.kind === 'question', summaryPrompt: '',
      })
    }
    const summary = localStorage.getItem(`exameow-wrong-ai-summary:${bank.id}`)
    const id = `legacy-summary:${bank.id}`
    if (summary?.trim() && !existing.has(id)) {
      await saveConversation({
        ...base, id, kind: 'summary', title: '历史错题归纳总结', updatedAt: Date.now(),
        questions: [], threads: {}, messages: [{ id: `${id}:reply`, role: 'assistant', content: summary }],
        awaitingAnswer: false, summaryPrompt: '这是升级前保存的归纳总结。原始错题选择未保留，请围绕已有总结回答；需要逐题核对时请让学生补充题目。',
      })
    }
  }
  localStorage.setItem('exameow-ai-history-migrated', '1')
}
