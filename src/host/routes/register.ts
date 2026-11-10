// 路由注册：按 API_ROUTES 一张表挂上去，统一套上栅栏、方法校验与错误映射。

import { API_ROUTES } from '../../shared/routes'
import { StoreError } from '../cards/store'
import { type FenceCtx, makeFence } from '../fence'
import type { Log } from '../host-api'
import type { HttpRequestLike, HttpResponseLike, RouteSpec } from '../http'
import { fail } from '../http'
import { createActionHandler } from './action'
import { createCardsHandler } from './cards'
import { createCaseHandler } from './case'
import { createDecisionsHandler } from './decisions'
import type { RouteDeps } from './deps'
import { createEvidenceHandler } from './evidence'
import { createInspectHandler } from './inspect'
import { createModelsHandler } from './models'
import { createPanelCssHandler } from './panel-css'
import { createPolicyHandler } from './policy'
import { createPresenceHandler } from './presence'
import { createProgressHandler } from './progress'
import { createReconcileHandler } from './reconcile'
import { createRecordsHandler } from './records'
import { createSettingsHandler } from './settings'
import { createStatsHandler } from './stats'
import { createTimelineHandler } from './timeline'
import { createTitlesHandler } from './titles'
import { createTodoHandler } from './todo'
import { createVerifyHandler } from './verify'
import { createWorkspacesHandler } from './workspaces'

export interface WebServerLike {
  register(route: Omit<RouteSpec, 'methods'> & { methods?: string[] }): () => void
}

export interface RegisterOptions {
  webServer: WebServerLike
  fenceCtx: FenceCtx
  deps: RouteDeps
  log: Log
  effect(fn: () => () => void, label: string): unknown
}

/** 用栅栏 + 方法校验 + 错误映射包住一个 handler。 */
function wrapHandler(spec: RouteSpec, rejection: (req: HttpRequestLike) => number, log: Log) {
  const inner = spec.handler
  const allow = spec.methods
  return async (req: HttpRequestLike, res: HttpResponseLike): Promise<unknown> => {
    const denied = rejection(req)
    if (denied) return fail(res, denied, 'FORBIDDEN', '拒绝访问')
    if (allow && req.method && !allow.includes(req.method)) {
      try {
        res.setHeader('Allow', allow.join(', '))
      } catch {
        /* 头部已发 */
      }
      return fail(res, 405, 'METHOD_NOT_ALLOWED', `只支持 ${allow.join('/')} 请求`)
    }
    try {
      return await inner(req, res)
    } catch (err) {
      if (err instanceof StoreError) {
        // 台账自证收口（审计 P0-4）：计划绑定/自证类错误按 403，其余仍是 400。
        const forbidden = new Set([
          'PLAN_BOUND',
          'PLAN_MISMATCH',
          'SELF_REPORT_FORBIDDEN',
          'PANEL_TOKEN_REQUIRED',
          'PANEL_ORIGIN_REJECTED',
          'PANEL_BROWSER_REQUIRED',
        ])
        return fail(res, forbidden.has(err.code) ? 403 : 400, err.code, err.message)
      }
      if (res.headersSent || res.writableEnded) {
        try {
          res.destroy()
        } catch {
          /* 连接已断 */
        }
        return undefined
      }
      log(`请求处理失败 ${spec.path}: ${(err as Error)?.message || String(err)}`)
      return fail(res, 500, 'INTERNAL_ERROR', '请求处理失败，请重试', err)
    }
  }
}

export function registerRoutes(options: RegisterOptions): void {
  const { webServer, fenceCtx, deps, log, effect } = options
  const rejection = makeFence(fenceCtx)
  const disposers: Array<() => void> = []

  // 清理必须早于任何注册：注册中途抛错时，已注册的路由也要能卸掉。
  effect(
    () => () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 已经卸载 */
        }
      }
    },
    'dsh-task-cards: routes',
  )

  for (const spec of routeTable(deps)) {
    try {
      disposers.push(webServer.register({ ...spec, handler: wrapHandler(spec, rejection, log) }))
    } catch (err) {
      log(`路由注册失败 ${spec.path}: ${(err as Error)?.message || String(err)}`)
    }
  }
}

/** 路由表：路径常量来自 shared/routes.ts，两端共用。 */
function routeTable(deps: RouteDeps): RouteSpec[] {
  return [...cardRoutes(deps), ...kernelRoutes(deps), ...panelRoutes(deps)]
}

/** 内核路由：案卷、清单、证据、验收、对账、记录、进度。 */
function kernelRoutes(deps: RouteDeps): RouteSpec[] {
  return [
    [API_ROUTES.caseInfo, 'GET', createCaseHandler],
    [API_ROUTES.todo, 'POST', createTodoHandler],
    [API_ROUTES.evidence, 'POST', createEvidenceHandler],
    [API_ROUTES.reconcile, 'POST', createReconcileHandler],
    [API_ROUTES.progress, 'GET', createProgressHandler],
    [API_ROUTES.records, 'GET', createRecordsHandler],
    [API_ROUTES.verify, 'POST', createVerifyHandler],
    [API_ROUTES.css, 'GET', createPanelCssHandler],
  ].map(([path, method, factory]) => ({
    kind: 'exact' as const,
    path: path as string,
    methods: [method as string],
    handler: (factory as (d: RouteDeps) => RouteSpec['handler'])(deps),
  }))
}

/** 卡与动作：面板的主干。 */
function cardRoutes(deps: RouteDeps): RouteSpec[] {
  return [
    {
      kind: 'exact',
      path: API_ROUTES.cards,
      methods: ['GET', 'POST'],
      handler: createCardsHandler(deps),
    },
    {
      kind: 'exact',
      path: API_ROUTES.action,
      methods: ['POST'],
      handler: createActionHandler(deps),
    },
    {
      kind: 'exact',
      path: API_ROUTES.decisions,
      methods: ['GET', 'POST'],
      handler: createDecisionsHandler(deps),
    },
  ]
}

/** 设置与只读面板：模型、诊断、策略、工作区、时间线、标题。 */
function panelRoutes(deps: RouteDeps): RouteSpec[] {
  return [
    {
      kind: 'exact',
      path: API_ROUTES.presence,
      methods: ['POST'],
      handler: createPresenceHandler(deps),
    },
    {
      kind: 'exact',
      path: API_ROUTES.settings,
      methods: ['GET', 'POST'],
      handler: createSettingsHandler(deps),
    },
    {
      kind: 'exact',
      path: API_ROUTES.models,
      methods: ['GET'],
      handler: createModelsHandler(deps),
    },
    {
      kind: 'exact',
      path: API_ROUTES.inspect,
      methods: ['GET'],
      handler: createInspectHandler(deps),
    },
    {
      kind: 'exact',
      path: API_ROUTES.policy,
      methods: ['GET', 'POST'],
      handler: createPolicyHandler(deps),
    },
    {
      kind: 'exact',
      path: API_ROUTES.workspaces,
      methods: ['GET'],
      handler: createWorkspacesHandler(deps),
    },
    {
      kind: 'exact',
      path: API_ROUTES.stats,
      methods: ['GET'],
      handler: createStatsHandler(deps),
    },
    {
      kind: 'exact',
      path: API_ROUTES.timeline,
      methods: ['GET'],
      handler: createTimelineHandler(deps),
    },
    {
      kind: 'exact',
      path: API_ROUTES.titles,
      methods: ['GET'],
      handler: createTitlesHandler(deps),
    },
  ]
}
