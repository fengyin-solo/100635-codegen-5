// 投运前验收移交台账：认单位（归属绑定）、认编号（去重）、认时间轴（责任期/到期转隐患）。
// 与通用 EntryRow 不同，这一块是受控模型：任何写入都要过归属校验，越权直接拒绝写入。

export type UnitId = 'CONS' | 'RECV' | 'SUPV' | 'REGU'

export type Conclusion = '合格' | '有条件合格' | '不合格' | '待验收'
export type Severity = '严重' | '一般' | '轻微'
export type HandoverStatus = '待验收' | '已验收' | '已移交' | '已驳回'
export type DefectStatus = '待整改' | '整改中' | '已闭环'
export type TodoStatus = '待整改' | '整改中' | '已闭环' | '已转隐患'
export type VerifyKind = '缺项待确认' | '结论异常待查' | '越权驳回待查' | '事实接管待确认'
export type VerifyStatusValue = '待确认' | '已确认' | '已驳回'

export type Identity = {
  unit: UnitId
  person: string
}

// 同一处缺陷两方各判一档：有效判定只按严格度产生，输掉的一档降级为提示留存。
export type DefectInput = {
  location: string
  desc: string
  consSeverity?: Severity
  recvSeverity?: Severity
}

export type Defect = {
  id: string
  location: string
  desc: string
  consSeverity?: Severity
  recvSeverity?: Severity
  effectiveSeverity: Severity
  basis: string
  hint?: string
  status: DefectStatus
  todoId?: string
  hazardNo?: string
  closedAt?: string
}

export type HistoryEvent = {
  at: string
  actor: string
  unit: UnitId
  action: string
  detail: string
  rejected?: boolean
}

export type HandoverForm = {
  id: number
  handoverNo: string
  tunnelName: string
  section: string
  consUnit: string
  recvUnit: string
  submittedBy: string
  submittedAt: string
  // 验收结论归属于接收单位：验收人、验收时间随结论锁定，任何单位都不能事后抹掉。
  acceptDate?: string
  acceptor?: string
  conclusion: Conclusion
  defects: Defect[]
  liabilityMonths: number | null
  liabilityStart?: string
  liabilityEnd?: string
  status: HandoverStatus
  // 验收结论归属戳：恒为接收单位；写结论逐条比对当前身份单位。
  ownerUnit: UnitId
  // 早年无书面交接、按事实接管补建时：取最早一条可追溯接管痕迹（巡检/运行）的日期。
  takeoverDate?: string
  backfilled: boolean
  factTakeover: boolean
  remark?: string
  history: HistoryEvent[]
  createdAt: string
}

export type ControlledTodo = {
  id: string
  handoverNo: string
  defectId: string
  title: string
  severity: Severity
  responsibleUnit: UnitId
  followUnit: UnitId
  dueDate: string
  status: TodoStatus
  hazardNo?: string
  createdAt: string
}

// 待查台账：缺项、异常结论、越权驳回都回写这里；台账页与概览看板读的是同一份。
export type VerifyEntry = {
  id: string
  kind: VerifyKind
  handoverNo?: string
  summary: string
  missingFields: string[]
  source: string
  raisedAt: string
  raisedBy: string
  ownerUnit: UnitId
  status: VerifyStatusValue
  resolution?: string
  resolvedAt?: string
}

export type AuditLog = {
  id: string
  at: string
  actor: string
  unit: UnitId
  action: string
  handoverNo?: string
  message: string
  rejected: boolean
}

export type SyncItem = {
  seq: number
  createdAt: string
  module: string
  op: string
  payload: unknown
  status: '待同步' | '已同步' | '同步失败'
  syncedAt?: string
  lastError?: string
  attempts: number
}

export type HandoverDB = {
  forms: HandoverForm[]
  todos: ControlledTodo[]
  verifies: VerifyEntry[]
  audits: AuditLog[]
  outbox: SyncItem[]
  idSeq: number
  seq: number
  offline: boolean
  mockFailNext: boolean
}

export type HandoverStats = {
  total: number
  pendingAccept: number
  accepted: number
  rejected: number
  openDefects: number
  openTodos: number
  overdueTodos: number
  hazardsGenerated: number
  pendingVerify: number
  conflictsRejected: number
  backfilled: number
}

export type ServiceResult<T = undefined> = {
  ok: boolean
  message: string
  data?: T
}
