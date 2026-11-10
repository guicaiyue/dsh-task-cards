// 失败排查 + 策略与验收模板两屏的文案。由该屏实现方维护。

import type { ExtraDict } from './extras'

export const FAILURE_DICT: ExtraDict = {
  // ── 失败排查：结论条 ──────────────────────────────────────────
  failJudge: { zh: '判定者：{judge}', en: 'judge: {judge}' },
  failJudgeSystem: { zh: '系统', en: 'system' },
  failJudgeDecision: { zh: '决策者', en: 'decision agent' },
  failJudgeUser: { zh: '用户', en: 'you' },
  failJudgeNone: { zh: '还没人判过', en: 'no verdict yet' },
  failReasonFallback: {
    zh: '没有 verify 事件，先看实际结果再定下一步。',
    en: 'No verify event yet — read the actual result first.',
  },
  failNextStep: { zh: '下一步：{step}', en: 'Next: {step}' },
  failNextFailed: {
    zh: '补证据后重开这张卡，或改验收标准后再试一次',
    en: 'gather evidence and reopen, or revise the criteria and retry',
  },
  failNextUnknown: {
    zh: '证据不足：交决策者补判，或打开会话确认实际发生了什么',
    en: 'thin evidence: hand it to the decision agent, or open the session to see what happened',
  },
  failOpenDetail: { zh: '查看详情', en: 'Open detail' },
  failOpenSession: { zh: '打开会话', en: 'Open session' },
  failNoSession: { zh: '这张卡没有可回访的会话', en: 'no session to revisit' },

  // ── 失败排查：列表 ────────────────────────────────────────────
  failEmpty: { zh: '没有需要排查的卡', en: 'No cards need triage' },
  failEmptyHint: {
    zh: 'failed / unknown 的卡会出现在这里：左边选一张，右边并排看要求、结果与判定。',
    en: 'Failed or unknown cards land here: pick one on the left to compare requirement, result and verdict.',
  },
  failListTitle: { zh: '需排查', en: 'Needs triage' },
  failListCount: { zh: '{n} 张', en: '{n} cards' },
  failSelectHint: { zh: '选一张卡，看它为什么没过', en: 'Pick a card to see why it did not pass' },
  failWait: { zh: '等待原因：{reason}', en: 'waiting: {reason}' },

  // ── 失败排查：三栏 ────────────────────────────────────────────
  failColRequirement: { zh: '卡片要求', en: 'Requirement' },
  failColActual: { zh: '实际结果', en: 'Actual result' },
  failColVerdict: { zh: '验收判定', en: 'Verdict' },
  failReqAction: { zh: '将执行', en: 'action' },
  failReqScope: { zh: '范围', en: 'scope' },
  failReqEffect: { zh: '影响', en: 'effect' },
  failEvidenceEmpty: { zh: '还没有证据记录', en: 'No evidence recorded' },
  failEvidenceLoading: { zh: '正在读取案卷…', en: 'Loading case file…' },
  failEvidenceError: { zh: '案卷读取失败：{error}', en: 'Failed to load case file: {error}' },
  failOk: { zh: '通过', en: 'pass' },
  failNotOk: { zh: '未通过', en: 'fail' },
  failDuration: { zh: '耗时 {duration}', en: 'took {duration}' },
  failSpecExit: { zh: '{cmd} 退出码 == {code}', en: '{cmd} exit code == {code}' },
  failSpecFileExists: { zh: '{path} 存在', en: '{path} exists' },
  failSpecFileAbsent: { zh: '{path} 不存在', en: '{path} absent' },
  failSpecHttp: { zh: '{url} 状态码 == {code}', en: '{url} status == {code}' },
  failVerdictEmpty: {
    zh: '没有 verify 事件（验收还没跑）',
    en: 'No verify event yet (verification has not run)',
  },
  failVerdictActor: { zh: '执行者：{actor}', en: 'actor: {actor}' },
  failVerdictAuthority: { zh: '授权：{authority}', en: 'authority: {authority}' },
  failVerdictReason: { zh: '原因：{reason}', en: 'reason: {reason}' },
  failVerdictAt: { zh: '时间：{time}', en: 'at: {time}' },
  failActorObserver: { zh: '观察者', en: 'observer' },
  failActorDecision: { zh: '决策者', en: 'decision agent' },
  failActorScheduler: { zh: '调度器', en: 'scheduler' },
  failActorExecutor: { zh: '执行者', en: 'executor' },
  failActorVerifier: { zh: '验收器', en: 'verifier' },
  failActorUser: { zh: '用户', en: 'user' },
  failActorSystem: { zh: '系统', en: 'system' },
  failAuthorityDelegated: { zh: '秘书代批', en: 'delegated' },
  failAuthorityUser: { zh: '用户', en: 'user' },
  failAuthoritySystem: { zh: '系统', en: 'system' },

  // ── 策略与验收模板：内置模板 ──────────────────────────────────
  policyTemplatesTitle: { zh: '内置验收模板', en: 'Built-in verification templates' },
  policyTemplatesHint: {
    zh: '机器项写成可执行检查：只判边界事实，不证明智能体的思考。每条 checker 超时 10s，超时记 unknown、不重试。',
    en: 'Machine checks are executable assertions over boundary facts. Each checker times out at 10s; a timeout records unknown and is never retried.',
  },
  policyTplExitName: { zh: '命令退出码', en: 'Command exit code' },
  policyTplExitWhen: {
    zh: '提交代码、跑测试、构建、迁移脚本：只要命令有确定的退出码。',
    en: 'Commits, tests, builds, migrations: whenever the command has a definite exit code.',
  },
  policyTplExitPass: {
    zh: '退出码 == expect（通常是 0），标准输出留作证据。',
    en: 'exit code == expect (usually 0); captured output is kept as evidence.',
  },
  policyTplFileName: { zh: '文件存在 / 不存在', en: 'File exists / absent' },
  policyTplFileWhen: {
    zh: '产物、归档、补丁写完后确认文件真的在那里，或确认敏感文件不在。',
    en: 'After writing an artifact, archive or patch, confirm the file is really there — or that a sensitive file is gone.',
  },
  policyTplFilePass: {
    zh: '路径的存在性与 expect 一致，存在时记 sha256 前 12 位。',
    en: "The path's existence matches expect; when present, record the first 12 hex chars of sha256.",
  },
  policyTplHttpName: { zh: 'HTTP 状态码', en: 'HTTP status code' },
  policyTplHttpWhen: {
    zh: '部署、对外接口、健康检查：一个状态码就能判断。',
    en: 'Deploys, public endpoints, health checks: one status code is enough.',
  },
  policyTplHttpPass: {
    zh: 'HTTP 状态码 == expect（如 200）；内网地址默认拒绝。',
    en: 'HTTP status == expect (e.g. 200); private addresses are refused by default.',
  },
  policyTplWhen: { zh: '什么时候用', en: 'when to use' },
  policyTplPass: { zh: '判 confirmed 的条件', en: 'confirmed when' },
  policyTplTimeout: { zh: '超时 10s 记 unknown', en: '10s timeout → unknown' },
  policyLayersTitle: { zh: '三层判定', en: 'Three-way verdict' },
  gateScopeTitle: { zh: '回合内闸门覆盖范围', en: 'In-turn gate coverage' },
  gateScopeBody: {
    zh: '闸门只覆盖「插件观察到并已挂载 agent 作用域」的会话：危险动作在这些会话里执行前会被拦下并建卡。插件启动前就已存在、或未产生过事件的会话不在覆盖范围；那些会话里只会在事后建一张「未拦截」卡提示人工确认。当前主机若收不到工具事件回调，闸门自动降级为只建卡，不假装拦截。',
    en: 'The gate only covers sessions the plugin has observed and attached to their agent scope. Sessions created before the plugin started, or ones with no events yet, are not covered: there the plugin only files a post-hoc "not blocked" card for manual confirmation. If the host never delivers tool events, the gate degrades to card-only and does not pretend to block.',
  },
  policyLayerConfirmedText: {
    zh: '证据齐且全部通过',
    en: 'every criterion passed, evidence complete',
  },
  policyLayerFailedText: {
    zh: '有明确反证（退出码非 0、文件缺失、状态码不对）',
    en: 'clear counter-evidence (non-zero exit, missing file, wrong status)',
  },
  policyLayerUnknownText: {
    zh: '证据不足或 checker 超时：交决策者补判',
    en: 'evidence missing or checker timed out: hand it to the decision agent',
  },

  // ── 策略与验收模板：当前生效阈值 ──────────────────────────────
  policyThresholdTitle: { zh: '当前生效阈值', en: 'Active thresholds' },
  policyThresholdHint: {
    zh: '保存后立即生效，并留一条设置变更记录。',
    en: 'Saved values apply immediately and leave a settings-change record.',
  },
  policyFieldMinReply: { zh: '只分析不短于（字）', en: 'Analyse replies longer than (chars)' },
  policyFieldTimeout: { zh: '单卡超时（毫秒）', en: 'Per-card timeout (ms)' },
  policyFieldMaxInput: { zh: '单次输入上限（字节）', en: 'Max input bytes per run' },
  policyFieldPrecedent: { zh: '票拟最多带几条判例', en: 'Precedents per advice' },
  policyFieldAutoApply: {
    zh: '票拟可自动执行时，系统直接动手',
    en: 'Let the system act on auto-applicable advice',
  },
  policyFieldAutoApplyHint: {
    zh: '只有撤回不需要你动手的，才会被标为可自动执行。',
    en: 'Only advice whose undo never needs your hands is marked auto-applicable.',
  },
  policyFieldDiagnostics: {
    zh: '只自动放行可逆的诊断性改动',
    en: 'Auto-approve reversible diagnostics only',
  },
  policyFieldDiagnosticsHint: {
    zh: '仅限加临时日志、插桩、复测、只读检查；commit/push/删除/发布/对外仍要你批。',
    en: 'Temporary logs, instrumentation, re-tests and read-only checks only; commit/push/delete/release/external still need your approval.',
  },
}
