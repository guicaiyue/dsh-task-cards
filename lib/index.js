// dsh-task-cards —— 宿主侧。
//
// 两件事：
//   ① 会话观察者：某个会话的一个回合结束后，另开一个「没有工具」的会话，
//      把最后那段回复总结成卡（lib/observer.mjs）。原会话不被写入任何东西。
//   ② 面板后端：卡的读写、观察者设置、调用记录、可用模型。
//
// 客户端半边走 package.json 的 dsh.client + exports["./client"]，由宿主自己加载。

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Observer, OBSERVER_PRESET_ID, isObserverSession, messageText, observerWorkspace } from './observer.mjs'
import { DEFAULT_POLICY, POLICY_FILE, readPolicy, writePolicy } from './policy.mjs'
import { Scanner } from './scanner.mjs'
import { RecordStore, SETTINGS_FILE, SettingsStore, Store, StoreError } from './store.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const API_CARDS = '/dsh-task-cards/api/cards'
const API_ACTION = '/dsh-task-cards/api/action'
const API_SETTINGS = '/dsh-task-cards/api/settings'
const API_MODELS = '/dsh-task-cards/api/models'
const API_INSPECT = '/dsh-task-cards/api/inspect'
const API_POLICY = '/dsh-task-cards/api/policy'
const API_WORKSPACES = '/dsh-task-cards/api/workspaces'
const API_TIMELINE = '/dsh-task-cards/api/timeline'
const API_TITLES = '/dsh-task-cards/api/titles'
const MAX_BODY = 256 * 1024

export default {
  name: 'dsh-task-cards',

  apply(root) {
    const cards = new Store()
    const settings = new SettingsStore()
    const records = new RecordStore()
    const log = (line) => console.log(`[dsh-task-cards] ${line}`)

    // Cordis 的注入规则：先声明，再取属性。拿不到服务时这里保持 null，观察者会记一条
    // 「宿主缺少依赖」的异常记录，而不是让插件挂掉。
    let runtime = null
    let disposeQuestionHook = () => {}
    root.inject(['agents', 'sessionController', 'agentDefaultModel', 'agentPresets', 'workspaceRegistry', 'userQuestions', 'sessionQuery'], (ctx) => {
      runtime = ctx
      // 提问建卡挂在这里：runtime 就绪，且 apply 主体无论如何都会跑到。
      try {
        disposeQuestionHook = installQuestionHook(
          ctx,
          log,
          (request) => recordQuestionCard(cards, log, request, ctx),
          (request, answer) => recordChatAnswer(cards, request, answer),
        )
        log(`提问建卡已安装：ask=${typeof ctx.userQuestions.ask}`)
      } catch (err) {
        log(`提问建卡安装失败：${(err && err.message) || err}`)
      }
    })
    root.effect(() => () => disposeQuestionHook(), 'dsh-task-cards: question hook')

    const observer = new Observer({ getCtx: () => runtime, settings, cards, records, log })
    const scanner = new Scanner({ getCtx: () => runtime, cards, log })
    scanner.start()
    root.effect(() => () => scanner.stop(), 'dsh-task-cards: scanner')
    observeTurns(root, observer, log, cards)
    let presetCtx = null
    root.inject(['agentPresets'], (ctx) => {
      presetCtx = ctx
      registerObserverPreset(ctx, log)
    })
    root.inject(['webServer'], (ctx) => {
      const rejection = makeFence(ctx)
      const disposers = []

      // 清理必须早于任何注册：注册中途抛错时，已注册的路由也要能卸掉。
      ctx.effect(
        () => () => {
          for (const dispose of disposers) {
            try {
              dispose()
            } catch (err) {}
          }
        },
        'dsh-task-cards: routes',
      )

      function route(spec) {
        try {
          return routeInner(spec)
        } catch (err) {
          log(`路由注册失败 ${spec.path}: ${(err && err.message) || err}`)
          return () => {}
        }
      }

      function routeInner(spec) {
        const { methods: allow, ...rest } = spec
        const inner = rest.handler
        const dispose = ctx.webServer.register({
          ...rest,
          handler: async (req, res) => {
            const denied = rejection(req)
            if (denied) return fail(res, denied, 'FORBIDDEN', '拒绝访问')
            if (allow && !allow.includes(req.method)) {
              try {
                res.setHeader('Allow', allow.join(', '))
              } catch (err) {}
              return fail(res, 405, 'METHOD_NOT_ALLOWED', `只支持 ${allow.join('/')} 请求`)
            }
            try {
              await inner(req, res)
            } catch (err) {
              if (err instanceof StoreError) return fail(res, 400, err.code, err.message)
              if (res.headersSent || res.writableEnded) {
                try {
                  res.destroy()
                } catch (e) {}
                return
              }
              return fail(res, 500, 'INTERNAL_ERROR', '请求处理失败，请重试', err)
            }
          },
        })
        disposers.push(dispose)
        return dispose
      }

      route({ kind: 'exact', path: API_CARDS, methods: ['GET', 'POST'], handler: handleCards })
      route({ kind: 'exact', path: API_ACTION, methods: ['POST'], handler: handleAction })
      route({ kind: 'exact', path: API_SETTINGS, methods: ['GET', 'POST'], handler: handleSettings })
      route({ kind: 'exact', path: API_MODELS, methods: ['GET'], handler: handleModels })
      route({ kind: 'exact', path: API_INSPECT, methods: ['GET'], handler: handleInspect })
      route({ kind: 'exact', path: API_POLICY, methods: ['GET'], handler: handlePolicyGet })
      route({ kind: 'exact', path: API_POLICY, methods: ['POST'], handler: handlePolicyPost })
      route({ kind: 'exact', path: API_WORKSPACES, methods: ['GET'], handler: handleWorkspaces })
      route({ kind: 'exact', path: API_TIMELINE, methods: ['GET'], handler: handleTimeline })
      route({ kind: 'exact', path: API_TITLES, methods: ['GET'], handler: handleTitles })

      function handleCards(req, res) {
        if (req.method === 'GET') {
          return sendJson(res, 200, { ok: true, cards: cards.list(), warning: cards.warning })
        }
        return readJson(req).then(async (body) => {
          const card = await cards.create(body && body.title, {
            detail: body && body.detail,
            kind: body && body.kind,
            severity: body && body.severity,
            // 手工也能造自动卡（调试和外部调用方都用得上）
            action:
              body && body.action && typeof body.action.input === 'string'
                ? {
                    type: body.action.type === 'prompt' ? 'prompt' : 'prompt',
                    delayMs: Number.isFinite(Number(body.action.delayMs)) ? Math.max(0, Number(body.action.delayMs)) : 0,
                    input: String(body.action.input).slice(0, 2000),
                    ...(typeof body.action.sessionId === 'string' ? { sessionId: body.action.sessionId } : {}),
                  }
                : null,
          })
          return sendJson(res, 200, { ok: true, card })
        })
      }

      async function handleAction(req, res) {
        const body = await readJson(req)
        const id = body && typeof body.id === 'string' ? body.id : ''
        const name = body && typeof body.action === 'string' ? body.action : ''
        if (!id) throw new StoreError('MISSING_ID', '缺少卡片 id')
        const card = cards.find(id)
        if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
        if (name === 'delete') return sendJson(res, 200, { ok: true, ...(await cards.remove(id)) })
        if (name === 'complete') return sendJson(res, 200, { ok: true, card: await cards.patch(id, { status: 'done' }, 'completed') })
        if (name === 'acknowledge') return sendJson(res, 200, { ok: true, card: await cards.patch(id, { status: 'acknowledged' }, 'acknowledged') })
        if (name === 'dismiss') return sendJson(res, 200, { ok: true, card: await cards.patch(id, { status: 'dismissed' }, 'dismissed') })
        if (name === 'reopen') return sendJson(res, 200, { ok: true, card: await cards.patch(id, { status: 'open' }, 'reopened') })
        if (name === 'run-now') {
          const result = await scanner.execute(card)
          return sendJson(res, 200, { ok: true, result, card: cards.find(id) })
        }
        if (name === 'answer') {
          const text = String((body && body.option) || (body && body.text) || '').trim()
          if (!text) throw new StoreError('MISSING_ANSWER', '缺少要回答的内容')
          const question = card.question || {}
          const sessionId = question.sessionId || (card.origin && card.origin.sessionId)
          const items = Array.isArray(question.items) ? question.items : []
          const answers = items.length
            ? items.map((item) => ({ id: item.id, selected: [text] }))
            : [{ id: question.id || 'q', selected: [text] }]
          // 首选：卡片作答直接回填这次挂起的提问（模型拿到的是原生提问结果）
          const native = sessionId ? answerPendingQuestion(sessionId, answers) : false
          const result = native
            ? { via: 'question', answered: true }
            : await answerQuestion(card, text, runtime)
          await cards.patch(id, { status: 'done', answer: text, answeredAt: Date.now(), answeredVia: 'card' }, 'answered')
          return sendJson(res, 200, { ok: true, result, card: cards.find(id) })
        }
        throw new StoreError('BAD_ACTION', '未知操作')
      }

      async function handleSettings(req, res) {
        if (req.method === 'GET') {
          return sendJson(res, 200, { ok: true, settings: settings.get(), file: settings.file })
        }
        const body = await readJson(req)
        const next = await settings.set(body && body.settings ? body.settings : body)
        // 系统提示词是在 preset 挂载时读进 section 的：改完必须重挂一次才生效。
        if (presetCtx) {
          await registerObserverPreset(presetCtx, log).catch((err) => log(`提示词重挂失败：${(err && err.message) || err}`))
        }
        return sendJson(res, 200, { ok: true, settings: next })
      }

      async function handleAction(req, res) {
        const body = await readJson(req)
        const id = body && typeof body.id === 'string' ? body.id : ''
        const name = body && typeof body.action === 'string' ? body.action : ''
        if (!id) throw new StoreError('MISSING_ID', '缺少卡片 id')
        const card = cards.find(id)
        if (!card) throw new StoreError('NOT_FOUND', '这张卡不存在（可能已被删除）')
        if (name === 'delete') return sendJson(res, 200, { ok: true, ...(await cards.remove(id)) })
        if (name === 'complete') return sendJson(res, 200, { ok: true, card: await cards.patch(id, { status: 'done' }, 'completed') })
        if (name === 'acknowledge') return sendJson(res, 200, { ok: true, card: await cards.patch(id, { status: 'acknowledged' }, 'acknowledged') })
        if (name === 'dismiss') return sendJson(res, 200, { ok: true, card: await cards.patch(id, { status: 'dismissed' }, 'dismissed') })
        if (name === 'reopen') return sendJson(res, 200, { ok: true, card: await cards.patch(id, { status: 'open' }, 'reopened') })
        if (name === 'run-now') {
          const result = await scanner.execute(card)
          return sendJson(res, 200, { ok: true, result, card: cards.find(id) })
        }
        if (name === 'answer') {
          const text = String((body && body.option) || (body && body.text) || '').trim()
          if (!text) throw new StoreError('MISSING_ANSWER', '缺少要回答的内容')
          const question = card.question || {}
          const sessionId = question.sessionId || (card.origin && card.origin.sessionId)
          const items = Array.isArray(question.items) ? question.items : []
          const answers = items.length
            ? items.map((item) => ({ id: item.id, selected: [text] }))
            : [{ id: question.id || 'q', selected: [text] }]
          // 首选：卡片作答直接回填这次挂起的提问（模型拿到的是原生提问结果）
          const native = sessionId ? answerPendingQuestion(sessionId, answers) : false
          const result = native
            ? { via: 'question', answered: true }
            : await answerQuestion(card, text, runtime)
          await cards.patch(id, { status: 'done', answer: text, answeredAt: Date.now(), answeredVia: 'card' }, 'answered')
          return sendJson(res, 200, { ok: true, result, card: cards.find(id) })
        }
        throw new StoreError('BAD_ACTION', '未知操作')
      }

      async function handleSettings(req, res) {
        if (req.method === 'GET') {
          return sendJson(res, 200, { ok: true, settings: settings.get(), file: settings.file })
        }
        const body = await readJson(req)
        const next = await settings.set(body && body.settings ? body.settings : body)
        // 系统提示词是在 preset 挂载时读进 section 的：改完必须重挂一次才生效。
        if (presetCtx) {
          await registerObserverPreset(presetCtx, log).catch((err) => log(`提示词重挂失败：${(err && err.message) || err}`))
        }
        return sendJson(res, 200, { ok: true, settings: next })
      }

      // 树的外层要显示会话标题：只读 header，不读全文。
      async function handleTitles(req, res) {
        const url = new URL(req.url, 'http://x')
        const ids = (url.searchParams.get('ids') || '').split(',').map((item) => item.trim()).filter(Boolean)
        const query = runtime && runtime.sessionQuery
        if (!query) throw new StoreError('NO_QUERY', '宿主没有 sessionQuery')
        const titles = {}
        for (const id of ids.slice(0, 50)) {
          try {
            const snapshot = await query.readSession(id)
            let title = ''
            for (const event of snapshot.events || []) {
              if (event.type === 'session/title' && event.data && typeof event.data.title === 'string') title = event.data.title
            }
            titles[id] = title
          } catch (err) {
            titles[id] = ''
          }
        }
        return sendJson(res, 200, { ok: true, titles })
      }

      // 详情弹窗用：一个会话里「用户输入 + 模型最终输出」，中间过程全略。
      async function handleTimeline(req, res) {
        const url = new URL(req.url, 'http://x')
        const id = url.searchParams.get('id') || ''
        const query = runtime && runtime.sessionQuery
        if (!query) throw new StoreError('NO_QUERY', '宿主没有 sessionQuery')
        if (!id) throw new StoreError('MISSING_ID', '缺少会话 id')
        const snapshot = await query.readSession(id)
        const pairs = []
        let current = null
        for (const event of snapshot.events || []) {
          if (event.type === 'user/message') {
            // 只要人真正说的那句：system-reminder / runtime-context / skill-catalog
            // 这些注入内容也是 user/message，但它们的 source.kind 不是 user。
            const kind = event.data && event.data.source ? event.data.source.kind : undefined
            if (kind !== undefined && kind !== 'user') continue
            const text = messageText(event.data && event.data.message) || messageText(event.data) || ''
            if (!text) continue
            current = { user: text, assistant: '', at: event.time || null }
            pairs.push(current)
          } else if (event.type === 'assistant/message') {
            const text = messageText(event.data && event.data.message) || ''
            if (!text) continue
            // 中间步骤的 assistant 文本不单独成轮：挂到最近一轮用户输入下，
            // 最后一轮会覆盖前面的中间输出，弹窗里只留模型最终那段。
            if (!current) {
              current = { user: '', assistant: '', at: event.time || null }
              pairs.push(current)
            }
            current.assistant = text
            current.at = event.time || current.at
          }
        }
        let title = ''
        for (const event of snapshot.events || []) {
          if (event.type === 'session/title' && event.data && typeof event.data.title === 'string') title = event.data.title
        }
        return sendJson(res, 200, {
          ok: true,
          sessionId: id,
          title,
          turns: pairs.slice(-12),
        })
      }

      // 诊断：工作区里到底挂了哪些会话（用来确认侧栏能不能看到）。
      async function handleWorkspaces(req, res) {
        const registry = runtime && runtime.workspaceRegistry
        if (!registry || typeof registry.list !== 'function') throw new StoreError('NO_REGISTRY', '宿主没有 workspaceRegistry')
        const list = registry.list().map((workspace) => ({
          id: workspace.id,
          title: workspace.title,
          path: workspace.path,
          sessionIds: Array.isArray(workspace.sessionIds) ? [...workspace.sessionIds] : [],
        }))
        return sendJson(res, 200, { ok: true, workspaces: list })
      }

      // 工具 / 技能白名单：读改写 policy.json，观察者下一次装配就按新策略来。
      async function handlePolicyGet(req, res) {
        return sendJson(res, 200, { ok: true, policy: readPolicy(POLICY_FILE), defaults: DEFAULT_POLICY })
      }

      async function handlePolicyPost(req, res) {
        const body = await readJson(req)
        const policy = body && body.policy
        if (!policy || typeof policy !== 'object') throw new StoreError('BAD_POLICY', '缺少 policy')
        const saved = writePolicy(policy, POLICY_FILE)
        // 策略变了，重挂一次 preset，让工具限制立刻生效。
        if (presetCtx) await registerObserverPreset(presetCtx, log).catch((err) => log(`策略生效重挂失败：${(err && err.message) || err}`))
        return sendJson(res, 200, { ok: true, policy: saved })
      }

      // 诊断：读一次观察者会话的请求头，看看实际发出去的工具有哪些。
      async function handleInspect(req, res) {
        const url = new URL(req.url, 'http://x')
        const id = url.searchParams.get('id') || ''
        const query = runtime && runtime.sessionQuery
        if (!query) throw new StoreError('NO_QUERY', '宿主没有 sessionQuery')
        const snapshot = await query.readSession(id)
        let header = null
        let userText = ''
        const userMessages = []
        for (const event of snapshot.events || []) {
          if (event.type === 'request/header') header = event.data && event.data.header
          if (event.type === 'user/message') {
            const data = event.data || {}
            const text =
              messageText(data.message) ||
              messageText(data) ||
              (typeof data.text === 'string' ? data.text : '') ||
              JSON.stringify(data).slice(0, 800)
            if (text) userMessages.push(text)
            userText = text || userText
          }
        }
        if (url.searchParams.get('events') === '1') {
          const recent = (snapshot.events || []).slice(-40).map((event) => ({
            type: event.type,
            keys: event.data && typeof event.data === 'object' ? Object.keys(event.data) : [],
            name: event.data && event.data.name,
            callId: event.data && event.data.callId,
            args: event.data && event.data.arguments ? JSON.stringify(event.data.arguments).slice(0, 200) : undefined,
          }))
          return sendJson(res, 200, { ok: true, sessionId: id, events: recent })
        }
        return sendJson(res, 200, {
          ok: true,
          sessionId: id,
          model: header && header.config ? header.config.model : null,
          provider: header && header.config ? header.config.provider : null,
          tools: (header && header.tools ? header.tools : []).map((tool) => tool.name),
          toolCount: header && header.tools ? header.tools.length : 0,
          userMessages: userMessages.map((item) => item.slice(0, 2000)),
          eventTypes: [...new Set((snapshot.events || []).map((event) => event.type))],
        })
      }

      async function handleModels(req, res) {
        const groups = []
        let fallback = null
        try {
          const controller = runtime && runtime.sessionController
          const catalog = controller && controller.modelCatalog ? await controller.modelCatalog() : null
          if (catalog) {
            fallback = catalog.default || null
            for (const group of catalog.groups || []) {
              groups.push({
                provider: group.id || group.name,
                models: (group.models || []).map((model) => ({ id: model.id, name: model.name || model.id })),
              })
            }
          }
        } catch (err) {
          log(`读模型目录失败：${(err && err.message) || err}`)
        }
        return sendJson(res, 200, { ok: true, groups, default: fallback })
      }
    })
  },
}

// ------------------------------------------------------------------ 卡片作答

const pendingQuestions = new Map()

/** 把一次提问挂进待答表：卡片作答时按问题 id 找到它。 */
function registerPendingQuestion(request) {
  const items = (request.questions || []).map((item) => ({ id: item.id, question: item.question, multiSelect: !!item.multiSelect }))
  const agent = request.agent || {}
  const sessionId = agent.sessionId || (agent.session && agent.session.id) || agent.id || undefined
  const key = items.map((item) => item.id).join(',')
  let resolveFn
  let rejectFn
  const promise = new Promise((resolve, reject) => {
    resolveFn = resolve
    rejectFn = reject
  })
  promise.catch(() => {})
  const entry = { key, items, sessionId, request, promise, resolve: resolveFn, reject: rejectFn }
  pendingQuestions.set(key, entry)
  const signal = request.signal
  if (signal) {
    const onAbort = () => {
      if (pendingQuestions.get(key) === entry) pendingQuestions.delete(key)
      entry.reject(Object.assign(new Error('question aborted'), { code: 'ASK_ABORTED' }))
    }
    if (signal.aborted) onAbort()
    else {
      signal.addEventListener('abort', onAbort, { once: true })
      entry.cleanup = () => signal.removeEventListener('abort', onAbort)
    }
  }
  return entry
}

/** 提问结束后把挂起项摘掉（不管谁答的）。 */
function forgetPendingQuestion(entry) {
  if (!entry) return
  if (pendingQuestions.get(entry.key) === entry) pendingQuestions.delete(entry.key)
  try {
    entry.cleanup?.()
  } catch (err) {}
}

/** 用卡片上的选择回答一次挂起的提问。 */
function answerPendingQuestion(sessionId, answers) {
  for (const [key, entry] of pendingQuestions) {
    const idsMatch = entry.items.every((item) => answers.some((answer) => answer.id === item.id))
    if (!idsMatch) continue
    // 会话对得上，或至少有一边没记到会话 id 时才认：避免答到别的会话的同名问题上。
    if (entry.sessionId && sessionId && entry.sessionId !== sessionId) continue
    pendingQuestions.delete(key)
    try {
      entry.cleanup?.()
    } catch (err) {}
    entry.resolve({ answers })
    return true
  }
  return false
}

// ------------------------------------------------------------------ 提问建卡

/** 聊天里答完提问后，把选择写回卡片（两边都能答，谁先谁生效）。 */
async function recordChatAnswer(cards, request, answer) {
  try {
    const items = (request && request.questions) || []
    const ids = new Set((items || []).map((item) => item.id))
    const answers = (answer && answer.answers) || []
    if (!ids.size || !answers.length) return
    const text = answers
      .map((item) => (Array.isArray(item.selected) ? item.selected.join(' / ') : ''))
      .filter(Boolean)
      .join('；')
    for (const card of cards.list()) {
      const question = card.question || {}
      const cardItems = Array.isArray(question.items) ? question.items : []
      if (card.status === 'done' || !cardItems.length) continue
      if (!cardItems.every((item) => ids.has(item.id))) continue
      await cards.patch(card.id, { status: 'done', answer: text, answeredAt: Date.now(), answeredVia: 'chat' }, 'answered')
    }
  } catch (err) {
    /* 回写失败不影响回答 */
  }
}

/** 把一次提问记成卡：卡上的选项就是用户在面板里的回复入口。 */
async function recordQuestionCard(cards, log, request, runtime) {
  try {
    const questions = (request && request.questions) || []
    const agent = request && request.agent
    if (!agent || !questions.length) return
    const sessionId = agent.sessionId || (agent.session && agent.session.id) || agent.id
    const items = questions.map((item) => ({
      id: item.id,
      question: item.question,
      multiSelect: !!item.multiSelect,
      options: (item.options || []).map((option) => option.label),
    }))
    const first = items[0]
    // callId 是回答时走宿主提问通道的凭据：当场能从请求里拿到就用，
    // 拿不到就立刻去会话日志里找这次工具调用的 id，别等回答时再猜。
    let callId = (request && request.wait && request.wait.callId) || null
    if (!callId && runtime && runtime.sessionQuery && sessionId) {
      try {
        const snapshot = await runtime.sessionQuery.readSession(sessionId)
        for (const event of snapshot.events || []) {
          if (event.type === 'tool/call' && event.data && event.data.name === 'ask_user_question') {
            callId = event.data.callId || event.data.id || callId
          }
        }
      } catch (err) {}
    }
    const title = String(first.question || '等你回答').slice(0, 200)
    const detail = items
      .map((item) => (item.options.length ? `${item.question}（${item.options.join(' / ')}）` : item.question))
      .join('\n')
      .slice(0, 1000)
    await cards.create(title, {
      detail,
      kind: 'decision',
      severity: 'high',
      source: 'agent',
      interaction: 'question',
      question: { sessionId, callId, items },
      origin: { sessionId },
    })
    log(`问题卡：${title}`)
  } catch (err) {
    log(`问题卡写入失败：${(err && err.message) || err}`)
  }
}

const QUESTION_PATCH = Symbol.for('dsh-task-cards.userQuestions.patch')

/**
 * 包一层 userQuestions.ask / askTimed：每个提问先记一张卡，再照常走原逻辑。
 * 用服务方法而不是事件，是因为 waterfall 事件按 agent scope 过滤分发，
 * 插件注册的监听收不到；而提问一定要在会话里发生，跟页面开没开无关。
 */
function installQuestionHook(runtime, log, handler, answeredHandler) {
  try {
    return installQuestionHookInner(runtime, log, handler, answeredHandler)
  } catch (err) {
    log(`提问建卡安装失败：${(err && err.message) || err}`)
    return () => {}
  }
}

function installQuestionHookInner(runtime, log, handler, answeredHandler) {
  const service = runtime && runtime.userQuestions
  if (!service || typeof service.ask !== 'function') {
    log('提问建卡：宿主没有 userQuestions.ask，跳过')
    return () => {}
  }
  let slot = service[QUESTION_PATCH]
  if (!slot) {
    const original = {
      ask: service.ask,
      askTimed: typeof service.askTimed === 'function' ? service.askTimed : null,
    }
    slot = { handlers: new Set(), answeredHandlers: new Set(), original }
    service[QUESTION_PATCH] = slot
    const wrap = (name) =>
      async function patched(request, ...rest) {
        for (const handler of slot.handlers) {
          try {
            handler(request)
          } catch (err) {
            /* 建卡失败不能挡住提问本身 */
          }
        }
        if (name !== 'ask' || !request || !Array.isArray(request.questions) || !request.questions.length) {
          return slot.original[name].apply(this, [request, ...rest])
        }
        // 两条路并行：聊天里的提问 UI 照常出现，卡片也能作答，谁先答谁生效。
        const original = slot.original[name].apply(this, [request, ...rest])
        // 卡片先答时原提问会一直挂着：把它的失败吞掉，别冒未处理的拒绝。
        original.catch(() => {})
        const entry = registerPendingQuestion(request)
        try {
          const winner = await Promise.race([
            original.then((answer) => ({ from: 'chat', answer })),
            entry.promise.then((answer) => ({ from: 'card', answer })),
          ])
          if (winner.from === 'chat') {
            for (const onAnswered of slot.answeredHandlers) {
              try {
                onAnswered(request, winner.answer)
              } catch (err) {
                /* 回写失败不影响回答本身 */
              }
            }
          }
          return winner.answer
        } finally {
          forgetPendingQuestion(entry)
        }
      }
    service.ask = wrap('ask')
    if (slot.original.askTimed) service.askTimed = wrap('askTimed')
  }
  slot.handlers.add(handler)
  if (typeof answeredHandler === 'function') slot.answeredHandlers.add(answeredHandler)
  return () => {
    slot.handlers.delete(handler)
    if (typeof answeredHandler === 'function') slot.answeredHandlers.delete(answeredHandler)
    if (slot.handlers.size === 0) {
      // 插件卸载：把服务还原，别留一个包了两层的壳
      service.ask = slot.original.ask
      if (slot.original.askTimed) service.askTimed = slot.original.askTimed
      delete service[QUESTION_PATCH]
    }
  }
}

// ------------------------------------------------------------------ 问题卡回答

/**
 * 两种交互里的一种：模型提问把对话卡住时生成的卡。
 * 会话还活着就用宿主的问题通道作答；会话没了就把选项当用户输入发回去。
 */
async function answerQuestion(card, text, ctx) {
  const question = card.question || {}
  const sessionId = question.sessionId || (card.origin && card.origin.sessionId)
  let callId = question.callId
  // 建卡时拿不到 callId（提问走的 ask 不带它）：答的时候从会话日志里找最近一次
  // ask_user_question 的工具调用，那是宿主认的 callId。
  if (!callId && ctx && ctx.sessionQuery && sessionId) {
    try {
      const snapshot = await ctx.sessionQuery.readSession(sessionId)
      for (const event of snapshot.events || []) {
        if (event.type === 'tool/call' && event.data && event.data.name === 'ask_user_question') {
          callId = event.data.callId || event.data.id || callId
        }
      }
    } catch (err) {
      /* 读不到就退回模拟用户输入 */
    }
  }
  if (ctx && ctx.agents && callId) {
    try {
      const agent = (ctx.agents.list() || []).find((item) => item.sessionId === sessionId)
      if (agent && ctx.userQuestions && typeof ctx.userQuestions.answer === 'function') {
        const items = Array.isArray(question.items) ? question.items : []
        const answers = items.length
          ? items.map((item) => ({ id: item.id, selected: [text] }))
          : [{ id: question.id || 'q', selected: [text] }]
        const accepted = await ctx.userQuestions.answer(agent, callId, { answers })
        if (accepted) return { via: 'question', answered: true }
      }
    } catch (err) {
      // 会话已经结束 / 问题已超时：退回模拟用户输入
    }
  }
  if (!ctx || !ctx.sessionController) throw new StoreError('NO_RUNTIME', '宿主缺少 sessionController')
  if (!sessionId) throw new StoreError('NO_SESSION', '这张卡没有可回访的会话')
  const controller = new AbortController()
  try {
    await ctx.sessionController.prompt(
      {
        requestId: `card-answer-${Date.now().toString(36)}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      },
      controller.signal,
    )
  } finally {
    try {
      controller.abort()
    } catch (err) {}
  }
  return { via: 'prompt', answered: true }
}

/**
 * 模型提问会阻塞对话（ask_user_question）。这种时刻也记一张卡：
 * 卡上的选项就是回复入口，会话还活着走宿主的提问通道，没了就模拟用户输入。
 */
async function captureQuestion(sessionId, data, header) {
  const args = data.arguments || data.args || {}
  let questions = Array.isArray(args.questions) ? args.questions : []
  if (!questions.length && typeof args.question === 'string') questions = [args]
  if (!questions.length) return
  const items = questions.map((item, index) => ({
    id: String(item.id || `q${index + 1}`),
    question: String(item.question || ''),
    multiSelect: !!item.multiSelect,
    options: (Array.isArray(item.options) ? item.options : []).map((option) =>
      typeof option === 'string' ? option : String((option && (option.label || option.value)) || ''),
    ).filter(Boolean),
  }))
  const first = items[0]
  if (!first.question) return
  const title = first.question.slice(0, 200)
  const detail = items
    .map((item) => (item.options.length ? `${item.question}（${item.options.join(' / ')}）` : item.question))
    .join('\n')
    .slice(0, 1000)
  await cards.create(title, {
    detail,
    kind: 'decision',
    severity: 'high',
    source: 'agent',
    interaction: 'question',
    question: {
      sessionId,
      callId: data.callId || (data.id ? String(data.id) : null),
      items,
    },
    origin: { sessionId, ...(header && header.cwd ? {} : {}) },
  })
  log(`问题卡：${title}`)
}

/** user/message 的形状不止一种，挨个兜底取文本。 */
function textOf(data) {
  if (!data) return ''
  return (
    messageText(data.message) ||
    messageText(data) ||
    (typeof data.text === 'string' ? data.text : '') ||
    ''
  )
}

// ------------------------------------------------------------------ 观察者接线
//
// 触发点：agent/status 变 idle（一个回合真的结束了）。
// 素材：本轮最后一条 assistant/message 的文本与 usage；本轮有没有用户输入。
// 观察者自己的会话必须跳过，否则它也会触发观察者。

function observeTurns(root, observer, log, cards) {
  const tracker = new Map()

  function stateOf(sessionId) {
    let state = tracker.get(sessionId)
    if (!state) {
      state = { hasUserInput: false, lastReply: '', usage: null, toolCalls: 0, turn: 0, cwd: '', turns: [] }
      tracker.set(sessionId, state)
      // 简单封顶，避免长跑宿主里无限长
      if (tracker.size > 500) tracker.delete(tracker.keys().next().value)
    }
    return state
  }

  root.on('session/event', (session, event) => {
    try {
      const sessionId = session?.id
      if (!sessionId) return
      if (isObserverSession(sessionId)) {
        observer.waiter.acceptEvent(sessionId, event)
        return
      }
      // 只认「人发起的顶层会话」：子代理是模型的内部动作，不是用户的一轮。
      // 需要时可以在设置里打开 includeSubagents。
      const header = session.header || {}
      const isChild = !!header.parentSession || (header.delegationDepth || 0) > 0
      if (isChild && !(settings && settings.includeSubagents)) return
      // 观察者自己的工作区里跑的东西，一律不观察（按 cwd 再兜一层）。
      if (header.cwd && header.cwd === observerWorkspace()) return

      const state = stateOf(sessionId)
      if (event.type === 'user/message') {
        state.hasUserInput = true
        state.lastReply = ''
        state.usage = null
        state.toolCalls = 0
        // 观察者需要「最近三轮的用户输入 + 模型最终输出」，不是只有最后一句。
        state.turns.push({ user: textOf(event.data), assistant: '' })
        if (state.turns.length > 3) state.turns.shift()
        if (header.cwd) state.cwd = header.cwd
      } else if (event.type === 'assistant/message') {
        const text = messageText(event.data?.message)
        if (text) {
          state.lastReply = text
          const latest = state.turns[state.turns.length - 1]
          if (latest) latest.assistant = text
        }
        if (event.data?.usage) state.usage = event.data.usage
        if (typeof event.data?.turn === 'number') state.turn = event.data.turn
      } else if (event.type === 'tool/call') {
        state.toolCalls += 1
        if (event.data && event.data.name === 'ask_user_question') {
          captureQuestion(sessionId, event.data, header).catch((err) => log(`问题卡写入失败：${(err && err.message) || err}`))
        }
      }
    } catch (err) {
      log(`session/event 处理失败：${(err && err.message) || err}`)
    }
  })

  root.on('agent/error', (payload) => {
    try {
      const sessionId = payload?.agent?.sessionId
      const detail = String((payload && payload.error && (payload.error.message || payload.error)) || '')
      // 观察者会话报错时立刻失败，不要白等一整个超时；非观察者的报错不记（宿主自己会记）。
      if (sessionId && isObserverSession(sessionId)) observer.waiter.cancel(sessionId, `观察者会话报错：${detail}`)
    } catch (err) {}
  })

  root.on('agent/status', (payload) => {
    try {
      const sessionId = payload?.agent?.id || payload?.agent?.sessionId
      if (!sessionId) return
      if (isObserverSession(sessionId)) {
        if (payload.status === 'idle') observer.waiter.finish(sessionId)
        return
      }
      if (payload.status !== 'idle') return
      const state = tracker.get(sessionId)
      if (!state) return
      if (!state.hasUserInput || !state.lastReply) return
      const input = {
        originSessionId: sessionId,
        turn: state.turn,
        replyText: state.lastReply,
        turns: state.turns.slice(),
        cwd: state.cwd,
      }
      // 本轮已消费：清掉，避免重复触发
      tracker.delete(sessionId)
      observer.enqueue(() => observer.run(input)).catch((err) => log(`观察者运行失败：${(err && err.message) || err}`))
    } catch (err) {
      log(`agent/status 处理失败：${(err && err.message) || err}`)
    }
  })
}

// ------------------------------------------------------------------ 观察者 preset
//
// 只挂一个提示词插件：没有 tool、没有 skill。preset 声明的 plugins 会按
// 声明方的 baseUrl 解析，所以这里给绝对文件 URL，避免依赖包名解析。

async function registerObserverPreset(ctx, log) {
  const PRESET_SLOT = Symbol.for('dsh-task-cards.observer-preset')
  if (!ctx.agentPresets || typeof ctx.agentPresets.register !== 'function') {
    log('宿主没有 agentPresets 服务：观察者会话会退回默认 preset（带工具）')
    return
  }

  const definition = () => ({
    id: OBSERVER_PRESET_ID,
    name: '任务卡观察者',
    description: '只有系统提示词、没有工具的观察者会话',
    order: 90,
    // 带 ?v= 的 URL：每次重挂都当作新模块加载。否则宿主 loader 会命中模块缓存，
    // 改了 observer-prompt.js 也只有重启才生效。
    plugins: [
      {
        id: 'task-cards-observer-prompt',
        name: `${pathToFileURL(path.join(HERE, 'observer-prompt.js')).href}?v=${Date.now()}`,
        config: { settingsFile: SETTINGS_FILE, policyFile: POLICY_FILE },
      },
    ],
  })

  // 热重载会在同一个进程里再跑一次 apply：先撤掉上一轮，否则 duplicate。
  if (typeof globalThis[PRESET_SLOT] === 'function') {
    try {
      await globalThis[PRESET_SLOT]()
    } catch (err) {
      /* 撤不掉就走下面的兜底 */
    }
    globalThis[PRESET_SLOT] = null
  }

  let dispose = null
  try {
    dispose = await ctx.agentPresets.register(definition())
  } catch (err) {
    const message = (err && err.message) || String(err)
    if (!message.includes('Duplicate agent preset')) {
      log(`观察者 preset 注册失败：${message}`)
      return
    }
    // 上一轮（还没存下 disposer 的旧版本）遗留的注册：清掉再注册一次。
    // definitions 是注册表的普通字段，不是私有槽；这里只动我们自己那个 id。
    log('发现上一轮遗留的观察者 preset，先撤掉再注册')
    try {
      const registry = ctx.agentPresets
      const record = registry.definitions && registry.definitions.get(OBSERVER_PRESET_ID)
      if (record && record.generation) {
        try {
          record.generation.tree && record.generation.tree.root && record.generation.tree.root.stop()
        } catch (e) {}
        record.generation.retired = true
      }
      if (registry.definitions) registry.definitions.delete(OBSERVER_PRESET_ID)
      dispose = await ctx.agentPresets.register(definition())
    } catch (err2) {
      log(`观察者 preset 重注册失败：${(err2 && err2.message) || err2}`)
      return
    }
  }

  globalThis[PRESET_SLOT] = dispose
  ctx.effect(() => () => {
    if (typeof globalThis[PRESET_SLOT] === 'function') {
      try {
        return globalThis[PRESET_SLOT]()
      } catch (err) {
        return undefined
      }
    }
    return undefined
  }, 'dsh-task-cards: observer preset')
  log(`观察者 preset 已注册：${OBSERVER_PRESET_ID}`)
}

// ------------------------------------------------------------------ 出入库

function clampInt(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

async function readJson(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new StoreError('BODY_TOO_LARGE', '请求体过大')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (err) {
    throw new StoreError('BAD_JSON', '请求体不是合法 JSON')
  }
}

function sendJson(res, code, payload) {
  if (!res || res.headersSent || res.writableEnded) return false
  try {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(payload))
    return true
  } catch (err) {
    try {
      res.destroy()
    } catch (e) {}
    return false
  }
}

/** 对外只回稳定 code + 一句人话；原始 message 只进日志（它常带绝对路径）。 */
function fail(res, code, errorCode, message, err) {
  if (err !== undefined) {
    try {
      console.warn(`[dsh-task-cards] ${errorCode}: ${(err && err.message) || String(err)}`)
    } catch (e) {}
  }
  return sendJson(res, code, {
    ok: false,
    code: errorCode,
    error: message,
    // 500 时带上真实原因，面板上能直接看到（本机插件，不涉及泄漏）
    ...(err !== undefined ? { detail: (err && err.message) || String(err) } : {}),
  })
}

// ------------------------------------------------------------------ 信任栅栏
//
// 与 dsh-word-learn 同款思路：跨站拒绝 → 宿主栅栏（有就用）→ 无栅栏时只认回环/白名单。

function makeFence(ctx) {
  const trusted = String(process.env.DSH_TASK_CARDS_TRUSTED_HOSTS || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)

  function isLoopbackHostname(hostname) {
    const name = String(hostname || '')
      .toLowerCase()
      .replace(/^\[/, '')
      .replace(/\]$/, '')
    if (!name) return false
    if (name === 'localhost' || name.endsWith('.localhost') || name === '::1') return true
    const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(name)
    if (!parts || Number(parts[1]) !== 127) return false
    return [parts[2], parts[3], parts[4]].every((n) => Number(n) <= 255)
  }

  function hostFence() {
    try {
      const conn = ctx.get('connection') || ctx.connection
      return conn && typeof conn.requestRejection === 'function' ? conn : null
    } catch (err) {
      return null
    }
  }

  return function rejection(req) {
    try {
      const headers = (req && req.headers) || {}
      if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return 403

      let hostUrl = null
      try {
        hostUrl = new URL(`http://${String(headers.host || '')}`)
      } catch (err) {
        return 403
      }
      const authority = hostUrl.host.toLowerCase()

      const origin = headers.origin
      if (typeof origin === 'string' && origin && origin !== 'null') {
        let originUrl = null
        try {
          originUrl = new URL(origin)
        } catch (err) {
          return 403
        }
        if (originUrl.host.toLowerCase() !== authority) return 403
      }

      const conn = hostFence()
      if (!conn) {
        if (!isLoopbackHostname(hostUrl.hostname)) {
          const ok = trusted.some((entry) =>
            entry.includes(':') ? entry === authority : entry === hostUrl.hostname.toLowerCase(),
          )
          if (!ok) return 403
        }
        return 0
      }
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return 0
      return typeof code === 'number' ? code : 403
    } catch (err) {
      return 403
    }
  }
}
