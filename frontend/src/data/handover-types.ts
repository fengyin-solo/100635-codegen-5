// 投运前验收与移交：领域模型（认单位的台账）
// 规则裁决见 docs/handover-rules.md，所有口径以该文件为准。

export const UNIT_BUILDER = 'BUILDER' // 建设单位（验收结论归属方）
export const UNIT_RECEIVER = 'RECEIVER' // 接收单位（运行方）
export const UNIT_SUPERVISOR = 'SUPERVISOR' // 监理（只读第三方）

export const UNIT_NAMES: Record<string, string> = {
  BUILDER: '城廊建设有限公司',
  RECEIVER: '管廊运维中心',
  SUPERVISOR: '市政工程监理处',
}

export type Actor = {
  id: string
  name: string
  unit: string
  role: string
}

/** 移交单：每张单子绑定验收单位与接收单位 */
export type HandoverForm = {
  id: string // 内部键
  formNo: string // 移交单编号（全局唯一自然键）
  tunnelName: string
  section: string // 区段/舱室
  acceptUnit: string // 验收单位（结论归属）
  receiverUnit: string // 接收单位
  acceptor: string // 验收人
  acceptDate: string // 验收日期
  handoverDate: string // 移交日期
  warrantyEnd: string // 缺陷责任期截止日
  conclusion: string // 验收结论
  status: string // 待验收 / 已验收 / 已移交 / 补建待确认
  source: string // 正式移交 / 补建-事实移交 / 往期回填
  evidence: string[] // 补建凭证
  createdBy: string
  createdAt: string
  contentHash: string
  conclusionVersions: ConclusionVersion[]
}

export type ConclusionVersion = {
  conclusion: string
  acceptor: string
  approver: string
  approverUnit: string
  approvedAt: string
}

export const CONCLUSIONS = ['合格', '有条件合格', '不合格', '待补验（补建）']

export const DEFECT_LEVELS = ['一般', '严重', '危急']
// 严重度排序（索引越大越严）
export function levelRank(level: string): number {
  return DEFECT_LEVELS.indexOf(level)
}

/** 缺陷判定：建设/接收双方各自留痕，冲突时取严 */
export type Defect = {
  id: string
  defectNo: string
  formNo: string
  location: string
  description: string
  builderLevel: string // 建设单位判定；'' = 未判
  receiverLevel: string // 接收单位判定；'' = 未判
  adoptedLevel: string // 仲裁后生效档
  adoptedBy: string // 仲裁依据单位
  downgradedNote: string // 宽松档降级提示
  rectifyDue: string // 整改要求日
  status: string // 待判定 / 已锁定 / 已闭环 / 已转隐患
  source: string // 正式移交 / 往期回填
  createdAt: string
}

/** 受控待办：缺陷责任期内遗留问题 */
export type ControlledTodo = {
  id: string
  todoNo: string
  formNo: string
  defectNo: string
  title: string
  ownerUnit: string // 责任单位（闭环权限归属）
  ownerName: string
  dueDate: string // 要求闭环日
  closedAt: string
  status: string // 待整改 / 整改中 / 已闭环 / 已转隐患
  source: string
}

export type ReconItem = {
  id: string
  refType: string // form / defect / sync
  refNo: string
  reason: string
  detail: string
  status: string // 待查 / 已核实 / 已排除
  source: string // 移交台账 / 回填 / 同步 / 巡检
  createdAt: string
  resolvedAt: string
  auto: boolean // 规则自动写入（重算时可重建）
}

export type GapItem = {
  id: string
  batch: string
  rawSummary: string
  missingFields: string[]
  kind: string // form / defect
  suggestedFormNo: string
  status: string // 待确认 / 已确认 / 已剔除
  resolvedNote: string
  createdAt: string
  resolvedAt: string
}

export type HazardRef = {
  id: string
  hazardNo: string
  sourceTodoNo: string
  location: string
  level: string
  measure: string
  ownerName: string
  foundDate: string
  dueDate: string
  status: string // 待整改（写入隐患整改模块）
  createdAt: string
}

export type AuditEntry = {
  seq: number
  actor: string
  unit: string
  action: string
  target: string
  field: string
  reason: string
  at: string
}

export type OutboxEvent = {
  seq: number
  type: string
  businessKey: string
  payload: string // JSON；断线不顶上：为空说明本事件就缺载荷
  status: string // queued / synced / failed
}

export type QueueForm = {
  formNo: string
  tunnelName: string
  section: string
  acceptDate: string
  handoverDate: string
  warrantyEnd: string
  conclusion: string
  acceptor: string
  status: string
  source: string
  evidence: string[]
}

export type QueueDefect = {
  patrolDate: string // 巡检日期：阶段 B 的排序键
  formNo: string
  location: string
  description: string
  level: string // 巡检（接收方）判定档
  rectifyDue: string
}

export type HandoverState = {
  forms: HandoverForm[]
  defects: Defect[]
  todos: ControlledTodo[]
  recon: ReconItem[]
  gaps: GapItem[]
  hazards: HazardRef[]
  audits: AuditEntry[]
  outbox: OutboxEvent[]
  backfillQueue: QueueForm[]
  legacyQueue: QueueDefect[]
  nextSeq: number
  backfillDone: boolean
  lastSweepAt: string
}

export type ServiceResult<T = unknown> = {
  ok: boolean
  message: string
  data?: T
}
