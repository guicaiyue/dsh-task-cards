// 观察者：一个回合结束后，另开一个「没有工具」的会话，把最后那段回复总结成卡。
//
// 三条约束来自需求本身：
//   - 不碰原会话：只读事件，不往原会话里投任何东西；
//   - 不靠模型自觉：解析失败重试一次，再失败记异常并放弃这张卡；
//   - 可追溯：记录模型、输入输出、token、工具调用次数、耗时。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { coerceCards, extractJson } from './extract.mjs'

export const OBSERVER_PRESET_ID = 'task-cards-observer'
export const OBSERVER_SESSION_PREFIX = 'card-obs-'

/**
 * 观察者会话的工作目录：插件自己的工作区，不挂到用户的任何 workspace 上，
 * 所以它不会出现在左侧会话列表里；插件自己的页面负责展示这些会话。
 */
export function observerWorkspace() {
  const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const dir = path.join(DSH_HOME, 'dsh-task-cards', 'workspace')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {}
  return dir
}

/** 待完成的观察者会话：由事件驱动完成，不轮询。 */
export class Waiter {
  constructor() {
    this.pending = new Map()
  }

  expect(sessionId, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(sessionId)
        if (!entry) return
        this.pending.delete(sessionId)
        resolve({ ok: false, reason: '观察者会话超时未完成', text: entry.text || '', usage: entry.usage || null, toolCalls: entry.toolCalls || 0 })
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(sessionId, { timer, text: '', usage: null, toolCalls: 0, resolve })
    })
  }

  /** 每次会话事件都送进来：累计文本、usage、工具调用次数。 */
  acceptEvent(sessionId, event) {
    const entry = this.pending.get(sessionId)
    if (!entry) return
    if (event.type === 'assistant/message') {
      const text = messageText(event.data?.message)
      if (text) entry.text = text
      if (event.data?.usage) entry.usage = event.data.usage
    } else if (event.type === 'tool/call') {
      entry.toolCalls += 1
    }
  }

  /** 回合结束：有最终文本才算完成。 */
  finish(sessionId) {
    const entry = this.pending.get(sessionId)
    if (!entry || !entry.text) return
    this.pending.delete(sessionId)
    clearTimeout(entry.timer)
    entry.resolve({ ok: true, text: entry.text, usage: entry.usage, toolCalls: entry.toolCalls })
  }

  cancel(sessionId, reason) {
    const entry = this.pending.get(sessionId)
    if (!entry) return
    this.pending.delete(sessionId)
    clearTimeout(entry.timer)
    entry.resolve({ ok: false, reason, text: entry.text || '', usage: entry.usage || null, toolCalls: entry.toolCalls || 0 })
  }
}

/**
 * 观察者用哪个模型：设置里指定了就用它，否则读宿主的默认模型选择。
 * 必须给出具体 provider/model：系统提示词的 {{model}} 变量依赖 agent.options.model，
 * 不给的话整段提示词装配会直接失败。
 */
export function resolveModel(ctx, config) {
  if (config.provider && config.model) return { provider: config.provider, model: config.model }
  try {
    const selection = ctx.agentDefaultModel?.currentSelection?.()
    if (selection && selection.provider && selection.model) {
      return { provider: selection.provider, model: selection.model, reasoningEffort: selection.reasoningEffort }
    }
  } catch (err) {
    /* 没有默认模型服务：返回 null，让调用方记异常 */
  }
  return null
}

/** 取 assistant/message 里的纯文本块。 */
export function messageText(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

/**
 * 观察者的输入：最近三轮「用户输入 + 模型最终输出」。
 * 只给最后一轮回复会让分类丢掉上下文（比如这轮在做的事是什么）。
 */
export function buildPayload(turns, lastReply, maxBytes) {
  const list = Array.isArray(turns) ? turns.filter((turn) => turn && (turn.user || turn.assistant)) : []
  const parts = []
  list.forEach((turn, index) => {
    parts.push(`【第 ${index + 1} 轮】`)
    if (turn.user) parts.push(`用户：${truncateBytes(turn.user, 6000)}`)
    if (turn.assistant) parts.push(`模型：${truncateBytes(turn.assistant, 12000)}`)
  })
  if (!parts.length && lastReply) parts.push(`【最后一轮】\n模型：${truncateBytes(lastReply, 12000)}`)
  return truncateBytes(parts.join('\n'), maxBytes)
}

/** 按字节截断，避免把大段输出整个塞进观察者。 */
export function truncateBytes(text, maxBytes) {
  const buffer = Buffer.from(text, 'utf8')
  if (buffer.length <= maxBytes) return text
  const sliced = buffer.subarray(0, maxBytes).toString('utf8')
  // 末尾可能切在多字节字符中间，退回一个字符
  return sliced.replace(/\uFFFD$/, '')
}

/** 把观察者会话挂到插件自己的工作区；失败不影响观察本身。 */
async function attachToWorkspace(ctx, sessionId) {
  try {
    const registry = ctx.workspaceRegistry
    if (!registry || typeof registry.create !== 'function') {
      console.log('[dsh-task-cards] 宿主没有 workspaceRegistry，观察者会话不会出现在侧栏')
      return
    }
    const workspace = await registry.create(observerWorkspace(), '任务卡观察者')
    await workspace.attachSession(sessionId)
    console.log(`[dsh-task-cards] 观察者会话已挂到工作区「${workspace.title}」：${sessionId}`)
  } catch (err) {
    console.log(`[dsh-task-cards] 挂工作区失败：${(err && err.message) || err}`)
  }
}

export class Observer {
  constructor({ getCtx, settings, cards, records, log }) {
    this.getCtx = getCtx
    this.settings = settings
    this.cards = cards
    this.records = records
    this.log = log || (() => {})
    this.waiter = new Waiter()
    this.queue = Promise.resolve()
  }

  /** 排队串行：不并发开一堆观察者会话。 */
  enqueue(job) {
    const next = this.queue.then(job, job)
    this.queue = next.catch(() => {})
    return next
  }

  /**
   * @param {{ originSessionId: string, turn: number, replyText: string, cwd?: string }} input
   */
  async run(input) {
    const config = this.settings.get()
    const reply = String(input.replyText || '').trim()
    if (!config.enabled) return null
    if (!reply) return null
    if (reply.length < config.minReplyChars) return null

    const ctx = this.getCtx()
    if (!ctx || !ctx.agents || !ctx.sessionController) {
      await this.records.add({
        status: 'error',
        originSessionId: input.originSessionId,
        turn: input.turn,
        error: '宿主缺少 agents / sessionController，观察者未运行',
        attempts: 0,
      })
      return null
    }

    const startedAt = Date.now()
    const payload = buildPayload(input.turns, reply, config.maxInputBytes)
    const userText = `以下是某次会话最近几轮的输入与模型最终输出（越靠后越新）。请判断最后一轮结束后有没有值得留下的事，并只输出 JSON。\n\n<conversation>\n${payload}\n</conversation>`
    let last = null

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      last = await this.runOnce(ctx, config, input, userText, attempt)
      if (last.ok) break
      this.log(`观察者第 ${attempt} 次失败：${last.reason}`)
    }

    const durationMs = Date.now() - startedAt
    const base = {
      originSessionId: input.originSessionId,
      turn: input.turn,
      observerSessionId: last && last.sessionId,
      model: last && last.model,
      inputChars: payload.length,
      outputChars: last && last.text ? last.text.length : 0,
      usage: last && last.usage,
      toolCalls: last && last.toolCalls,
      durationMs,
      attempts: last && last.attempts,
      excerpt: last && last.text ? last.text.slice(0, 400) : '',
    }

    if (!last || !last.ok) {
      const entry = await this.records.add({
        ...base,
        status: 'invalid',
        error: (last && last.reason) || '未知原因',
        cardsCreated: 0,
      })
      return entry
    }

    const created = []
    for (const draft of last.cards) {
      const card = await this.cards.create(draft.title, {
        detail: draft.detail,
        source: 'agent',
        kind: draft.kind,
        severity: draft.severity,
        action: draft.action,
        origin: { sessionId: input.originSessionId, turn: input.turn, observerSessionId: last.sessionId },
      })
      created.push(card)
    }

    const entry = await this.records.add({
      ...base,
      status: created.length > 0 ? 'ok' : 'empty',
      cardsCreated: created.length,
      cardIds: created.map((card) => card.id),
    })
    this.log(
      `观察者：${input.originSessionId} 回合 ${input.turn} → ${entry.status} ${created.length} 张卡，` +
        `${(base.usage && base.usage.inputTokens) || 0}/${(base.usage && base.usage.outputTokens) || 0} tok，${durationMs}ms`,
    )
    return entry
  }

  async runOnce(ctx, config, input, userText, attempt) {
    const sessionId = `${OBSERVER_SESSION_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}-${attempt}`
    const expects = this.waiter.expect(sessionId, config.timeoutMs)
    const controller = new AbortController()
    let handle = null
    try {
      const chosen = resolveModel(ctx, config)
      if (!chosen) return { ok: false, reason: '没有可用的模型：设置里没选，宿主也没有默认模型', sessionId, attempts: attempt }
      const agentOptions = { provider: chosen.provider, model: chosen.model }
      if (chosen.reasoningEffort) agentOptions.reasoningEffort = chosen.reasoningEffort
      handle = await ctx.agents.create({
        sessionId,
        // 不挂 parentSession：挂上以后 sessionController 会拒绝直接投递
        // （"owned by subagent routing"）。身份只靠下面那条 descriptor 事件表达。
        meta: { cwd: observerWorkspace(), agentPreset: OBSERVER_PRESET_ID },
        setup: (childCtx, child) => {
          // 子代理身份靠这条会话事件判定（dsh-subagent 的 foldSubagentDescriptor）。
          try {
            child.session.append('subagent/descriptor', {
              version: 3,
              mode: 'one-shot',
              provider: 'dsh-task-cards',
              label: '任务卡观察者',
            })
          } catch (err) {}
        },
        agentOptions,
      })
      // 挂到插件自己的工作区：侧栏能看到这个会话，直接复用 dsh 的对话/轨迹视图。
      await attachToWorkspace(ctx, sessionId)
      // 建会话时直接带上观察者 preset：这样组合里只有我们的提示词插件，
      // 不会混进默认 preset 的 persona / skill / 工具定义。
      if (ctx.agentPresets && typeof ctx.agentPresets.select === 'function') {
        // 兜底：万一 factory 没认 meta.agentPreset，这里仍是空会话，select 会补上。
        const composed = typeof ctx.agentPresets.composedPreset === 'function' ? ctx.agentPresets.composedPreset(handle.agent.ctx) : undefined
        if (composed === undefined) await ctx.agentPresets.select(handle.agent, OBSERVER_PRESET_ID)
      }
      // prompt 的第二个参数是必需的 AbortSignal：不传会让宿主内部直接抛错。
      await ctx.sessionController.prompt(
        {
          requestId: `card-${Date.now().toString(36)}-${attempt}`,
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: userText }],
        },
        controller.signal,
      )
      const result = await expects
      if (!result.ok) return { ok: false, reason: result.reason, sessionId, attempts: attempt, text: result.text, usage: result.usage }
      const parsed = extractJson(result.text)
      if (!parsed.ok) {
        return { ok: false, reason: parsed.reason, sessionId, attempts: attempt, text: result.text, usage: result.usage, toolCalls: result.toolCalls }
      }
      const coerced = coerceCards(parsed.value)
      if (!coerced.ok) {
        return { ok: false, reason: coerced.reason, sessionId, attempts: attempt, text: result.text, usage: result.usage, toolCalls: result.toolCalls }
      }
      return {
        ok: true,
        cards: coerced.cards,
        sessionId,
        attempts: attempt,
        text: result.text,
        usage: result.usage,
        toolCalls: result.toolCalls,
        model: `${chosen.provider}/${chosen.model}`,
        via: parsed.via,
      }
    } catch (err) {
      this.waiter.cancel(sessionId, '创建或投递观察者会话失败')
      return {
        ok: false,
        reason: `观察者会话失败：${(err && err.message) || String(err)}`,
        sessionId,
        attempts: attempt,
        text: '',
        usage: null,
      }
    } finally {
      try {
        controller.abort()
      } catch (err) {}
      if (handle) {
        // 观察者会话已经产出结果；释放 agent，会话日志仍然留在宿主里可追溯。
        Promise.resolve(handle.dispose()).catch(() => {})
      }
    }
  }
}

/** 观察者会话自己也会触发回合结束事件，必须排除，否则无限递归。 */
export function isObserverSession(sessionId) {
  return String(sessionId || '').startsWith(OBSERVER_SESSION_PREFIX)
}
