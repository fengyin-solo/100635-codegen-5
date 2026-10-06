import { listRows, saveRows } from '@/data/local-store'
import { stricterSeverity, UNITS } from '@/data/handover-rules'
import { handoverDB, persistHandover, resetHandoverDB } from '@/data/handover-store'
import type {
  AuditLog,
  Conclusion,
  ControlledTodo,
  Defect,
  DefectInput,
  HandoverDB,
  HandoverForm,
  HandoverStats,
  Identity,
  ServiceResult,
  Severity,
  SyncItem,
  VerifyEntry,
  VerifyKind,
} from '@/data/handover-types'
import type { EntryRow } from '@/data/types'

// ===== 日期工具：责任期按月顺延，截止日仍未闭环即触发转隐患 =====

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const lastDay = new Date(y, m + months, 0).getDate()
  const day = Math.min(d, lastDay)
  return `${y + Math.floor((m - 1 + months) / 12)}-${String(((m - 1 + months) % 12) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowStamp(): string {
  return `${today()} ${new Date().toTimeString().slice(0, 5)}`
}

// ===== 身份：验收结论归接收单位，每页操作都带当前单位与操作人 =====

let identity: Identity = { unit: 'CONS', person: '陈建设' }

export function currentIdentity(): Identity {
  return identity
}

export function switchIdentity(next: Identity): void {
  identity = { ...next }
}

function unitName(unit: Identity['unit']): string {
  return UNITS[unit].short
}

// ===== 内部写入：审计、待查、同步队列、ID 分配 =====

function nextId<T extends { id: string }>(rows: T[], prefix: string): string {
  const max = rows.reduce((acc, row) => {
    const n = Number(String(row.id).replace(/\D/g, ''))
    return Number.isFinite(n) && n > acc ? n : acc
  }, 0)
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

function addAudit(db: HandoverDB, entry: Omit<AuditLog, 'id'>): void {
  db.audits.unshift({ id: nextId(db.audits, 'A'), ...entry })
}

function addVerify(db: HandoverDB, entry: Omit<VerifyEntry, 'id'>): void {
  // 同单同类型待查只留一条，重复回写不产生第二条计数。
  const dup = db.verifies.some(
    (v) => v.status === '待确认' && v.kind === entry.kind && v.handoverNo === entry.handoverNo,
  )
  if (!dup) {
    db.verifies.unshift({ id: nextId(db.verifies, 'V'), ...entry })
  }
}

function enqueue(db: HandoverDB, module: string, op: string, payload: unknown): void {
  db.seq += 1
  db.outbox.unshift({ seq: db.seq, createdAt: nowStamp(), module, op, payload, status: '待同步', attempts: 0 })
}

function historyEvent(form: HandoverForm, actor: Identity, action: string, detail: string, rejected = false): void {
  form.history.unshift({ at: nowStamp(), actor: actor.person, unit: actor.unit, action, detail, rejected })
}

// ===== 查询 =====

export function listForms(keyword = ''): HandoverForm[] {
  const db = handoverDB()
  const word = keyword.trim()
  const rows = [...db.forms].sort((a, b) => b.id - a.id)
  if (!word) return rows
  return rows.filter((form) =>
    [form.handoverNo, form.tunnelName, form.recvUnit, form.consUnit, form.acceptor ?? ''].some((v) =>
      v.includes(word),
    ),
  )
}

export function listTodos(status = ''): ControlledTodo[] {
  const rows = [...handoverDB().todos].sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
  return status ? rows.filter((t) => t.status === status) : rows
}

export function listVerifies(status = ''): VerifyEntry[] {
  const rows = [...handoverDB().verifies].sort((a, b) => b.raisedAt.localeCompare(a.raisedAt))
  return status ? rows.filter((v) => v.status === status) : rows
}

export function listAudits(): AuditLog[] {
  return [...handoverDB().audits].sort((a, b) => b.at.localeCompare(a.at))
}

export function listOutbox(): SyncItem[] {
  return [...handoverDB().outbox].sort((a, b) => a.seq - b.seq)
}

// ===== 提交移交单（建设单位）：按移交单编号去重，同单反复提交只算一次 =====

export type SubmitInput = {
  handoverNo: string
  tunnelName: string
  section: string
  recvUnit: string
  consUnit: string
  liabilityMonths?: number | null
}

export function submitForm(input: SubmitInput): ServiceResult<HandoverForm> {
  const db = handoverDB()
  const actor = identity
  const clean: SubmitInput = {
    handoverNo: input.handoverNo.trim(),
    tunnelName: input.tunnelName.trim(),
    section: input.section.trim(),
    recvUnit: input.recvUnit.trim(),
    consUnit: input.consUnit.trim(),
    liabilityMonths: input.liabilityMonths ?? null,
  }

  const missing = ['handoverNo', 'tunnelName', 'section', 'recvUnit', 'consUnit'].filter(
    (key) => !String(clean[key as keyof SubmitInput] ?? '').trim(),
  )
  if (missing.length) {
    return { ok: false, message: `必填项缺失（${missing.join('、')}），拒绝写入` }
  }

  // 提交移交单是建设单位的动作；其他单位提交同样拒绝写入。
  if (actor.unit !== 'CONS') {
    const message = `驳回：提交移交单归建设单位，当前身份为${unitName(actor.unit)}（只读），拒绝写入。`
    addAudit(db, { at: nowStamp(), actor: actor.person, unit: actor.unit, action: '提交移交单', handoverNo: clean.handoverNo, message, rejected: true })
    persistHandover(db)
    return { ok: false, message }
  }

  if (db.forms.some((f) => f.handoverNo === clean.handoverNo)) {
    const message = `移交单编号 ${clean.handoverNo} 已登记，按编号去重，重复提交只算一次，拒绝写入。`
    addAudit(db, { at: nowStamp(), actor: actor.person, unit: actor.unit, action: '提交移交单', handoverNo: clean.handoverNo, message, rejected: true })
    persistHandover(db)
    return { ok: false, message }
  }

  db.idSeq += 1
  const form: HandoverForm = {
    id: db.idSeq,
    handoverNo: clean.handoverNo,
    tunnelName: clean.tunnelName,
    section: clean.section,
    consUnit: clean.consUnit,
    recvUnit: clean.recvUnit,
    submittedBy: actor.person,
    submittedAt: nowStamp(),
    conclusion: '待验收',
    defects: [],
    liabilityMonths: clean.liabilityMonths ?? null,
    status: '待验收',
    ownerUnit: 'RECV',
    backfilled: false,
    factTakeover: false,
    history: [],
    createdAt: nowStamp(),
  }
  historyEvent(form, actor, '提交移交单', '建设单位提交移交单，验收结论待接收单位判定。')
  db.forms.push(form)
  addAudit(db, { at: nowStamp(), actor: actor.person, unit: actor.unit, action: '提交移交单', handoverNo: form.handoverNo, message: `提交移交单 ${form.handoverNo}，状态：待验收。`, rejected: false })
  enqueue(db, 'handover', '提交移交单', { handoverNo: form.handoverNo, id: form.id })
  persistHandover(db)
  return { ok: true, message: `移交单 ${form.handoverNo} 已登记（待接收单位验收）`, data: form }
}

// ===== 判定验收结论（仅接收单位）：越权代改一律驳回并写明归属冲突 =====

export type ConclusionInput = {
  formId: number
  conclusion: Exclude<Conclusion, '待验收'>
  acceptDate: string
  liabilityMonths: number
  defects: DefectInput[]
}

function rejectConclusion(db: HandoverDB, form: HandoverForm, actor: Identity, detail: string): ServiceResult<HandoverForm> {
  const message = `驳回：${detail} 移交单 ${form.handoverNo} 的验收结论归接收单位所有，${unitName(actor.unit)}对该单只读，拒绝写入。归属冲突已登记。`
  historyEvent(form, actor, '修改验收结论', `${actor.person}（${unitName(actor.unit)}）越权改结论：${detail}`, true)
  addAudit(db, { at: nowStamp(), actor: actor.person, unit: actor.unit, action: '修改验收结论', handoverNo: form.handoverNo, message, rejected: true })
  addVerify(db, {
    kind: '越权驳回待查',
    handoverNo: form.handoverNo,
    summary: `${actor.person}（${unitName(actor.unit)}）试图改动验收结论，归属冲突已驳回：验收结论归接收单位。`,
    missingFields: [],
    source: '越权写入拦截',
    raisedAt: nowStamp(),
    raisedBy: '系统',
    ownerUnit: 'RECV',
    status: '待确认',
  })
  enqueue(db, 'handover', '越权驳回', { handoverNo: form.handoverNo, by: actor.unit })
  persistHandover(db)
  return { ok: false, message }
}

export function setConclusion(input: ConclusionInput): ServiceResult<HandoverForm> {
  const db = handoverDB()
  const actor = identity
  const form = db.forms.find((f) => f.id === input.formId)
  if (!form) return { ok: false, message: '没有找到这张移交单' }

  // 归属校验：只有接收单位的验收人能动验收结论。
  if (actor.unit !== form.ownerUnit) {
    return rejectConclusion(db, form, actor, '非归属单位试图修改验收结论。')
  }
  if (!actor.person.trim()) {
    return rejectConclusion(db, form, actor, '操作人缺失，无法锁定验收人。')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.acceptDate)) {
    return { ok: false, message: '验收日期格式应为 YYYY-MM-DD' }
  }
  if (!Number.isInteger(input.liabilityMonths) || input.liabilityMonths <= 0) {
    return { ok: false, message: '缺陷责任期（月）必须为正整数' }
  }

  // 同一张单的结论允许被本单位复核修订，但每次修订都留痕；别的单位一个字都不能动。
  form.conclusion = input.conclusion
  form.acceptDate = input.acceptDate
  form.acceptor = actor.person
  form.liabilityMonths = input.liabilityMonths
  form.liabilityStart = input.acceptDate
  form.liabilityEnd = addMonths(input.acceptDate, input.liabilityMonths)
  form.status = input.conclusion === '不合格' ? '已驳回' : '已验收'

  // 遗留缺陷：两方判定打架取更严一档；每条生成一条受控待办，截止日为责任期届满。
  // 复核重判时，同部位同描述的缺陷沿用原记录（保留整改进度与已转隐患的历史），只给新增缺陷开待办。
  const defectSeq = form.defects.reduce((acc, d) => {
    const n = Number(String(d.id).replace(/\D/g, ''))
    return Number.isFinite(n) && n > acc ? n : acc
  }, 0)
  let defectCounter = defectSeq
  const defects: Defect[] = input.defects
    .filter((d) => d.location.trim() || d.desc.trim())
    .map((d) => {
      const judged = stricterSeverity(d.consSeverity, d.recvSeverity)
      const existing = form.defects.find(
        (old) => old.location === d.location.trim() && old.desc === d.desc.trim(),
      )
      if (existing) {
        return {
          ...existing,
          consSeverity: d.consSeverity,
          recvSeverity: d.recvSeverity,
          effectiveSeverity: judged.effective,
          basis: judged.basis,
          hint: judged.hint,
        }
      }
      defectCounter += 1
      const created: Defect = {
        id: `D-${String(defectCounter).padStart(3, '0')}`,
        location: d.location.trim(),
        desc: d.desc.trim(),
        consSeverity: d.consSeverity,
        recvSeverity: d.recvSeverity,
        effectiveSeverity: judged.effective,
        basis: judged.basis,
        hint: judged.hint,
        status: '待整改',
      }
      const todoId = nextId(db.todos, 'T')
      created.todoId = todoId
      db.todos.push({
        id: todoId,
        handoverNo: form.handoverNo,
        defectId: created.id,
        title: `${created.location} ${created.desc}`.trim(),
        severity: created.effectiveSeverity,
        responsibleUnit: 'CONS',
        followUnit: 'RECV',
        dueDate: form.liabilityEnd as string,
        status: '待整改',
        createdAt: nowStamp(),
      })
      return created
    })

  // 被从本次判定里拿掉的旧缺陷：只清理尚未转隐患的孤儿待办；已转隐患的保留（隐患不能被复核抹掉）。
  const keptIds = new Set(defects.map((d) => d.id))
  for (const old of form.defects) {
    if (!keptIds.has(old.id) && old.todoId) {
      const todo = db.todos.find((t) => t.id === old.todoId)
      if (todo && todo.status !== '已转隐患') {
        db.todos = db.todos.filter((t) => t.id !== old.todoId)
      }
    }
  }
  form.defects = defects

  historyEvent(
    form,
    actor,
    '判定结论',
    `${actor.person}（接收单位）判定：${input.conclusion}；责任期${input.liabilityMonths}个月（${form.liabilityStart}~${form.liabilityEnd}）；遗留缺陷${defects.length}条。`,
  )
  addAudit(db, {
    at: nowStamp(),
    actor: actor.person,
    unit: actor.unit,
    action: '判定结论',
    handoverNo: form.handoverNo,
    message: `判定${input.conclusion}，验收人 ${actor.person}，验收日期 ${input.acceptDate}，遗留缺陷${defects.length}条。`,
    rejected: false,
  })

  // 异常结论回写待查台账（其余入口读同一份）。
  if (input.conclusion === '不合格') {
    addVerify(db, {
      kind: '结论异常待查',
      handoverNo: form.handoverNo,
      summary: `验收结论为「不合格」，缺陷${defects.length}条，已驳回移交并跟踪整改。`,
      missingFields: [],
      source: '验收结论回写',
      raisedAt: nowStamp(),
      raisedBy: actor.person,
      ownerUnit: 'RECV',
      status: '待确认',
    })
  }

  enqueue(db, 'handover', '判定结论', { handoverNo: form.handoverNo, conclusion: input.conclusion })
  persistHandover(db)
  sweepOverdue(db)
  persistHandover(db)
  return { ok: true, message: `已判定「${input.conclusion}」，验收人/时间已锁定，遗留缺陷${defects.length}条`, data: form }
}

// ===== 缺陷整改（建设单位）与闭环确认（接收单位） =====

export function updateDefectStatus(formId: number, defectId: string, next: '待整改' | '整改中'): ServiceResult {
  const db = handoverDB()
  const actor = identity
  const form = db.forms.find((f) => f.id === formId)
  if (!form) return { ok: false, message: '没有找到这张移交单' }
  if (actor.unit !== 'CONS') {
    return { ok: false, message: `驳回：缺陷整改归建设单位，${unitName(actor.unit)}只读，拒绝写入。` }
  }
  const defect = form.defects.find((d) => d.id === defectId)
  if (!defect) return { ok: false, message: '没有找到这条缺陷' }
  if (defect.status === '已闭环') return { ok: false, message: '缺陷已闭环，不能回退' }
  defect.status = next
  const todo = db.todos.find((t) => t.id === defect.todoId)
  if (todo && todo.status !== '已转隐患') todo.status = next
  historyEvent(form, actor, '登记整改', `${defect.location} 缺陷整改进度更新为「${next}」。`)
  addAudit(db, { at: nowStamp(), actor: actor.person, unit: actor.unit, action: '登记整改', handoverNo: form.handoverNo, message: `缺陷 ${defectId} 更新为「${next}」。`, rejected: false })
  enqueue(db, 'handover', '登记整改', { handoverNo: form.handoverNo, defectId, status: next })
  persistHandover(db)
  return { ok: true, message: `缺陷已登记为「${next}」` }
}

export function closeDefect(formId: number, defectId: string): ServiceResult {
  const db = handoverDB()
  const actor = identity
  const form = db.forms.find((f) => f.id === formId)
  if (!form) return { ok: false, message: '没有找到这张移交单' }
  // 闭环验收是接收单位的权力：建设单位整改，但闭环要接收单位点头。
  if (actor.unit !== form.ownerUnit) {
    return { ok: false, message: `驳回：闭环确认归接收单位，${unitName(actor.unit)}只读，拒绝写入。` }
  }
  const defect = form.defects.find((d) => d.id === defectId)
  if (!defect) return { ok: false, message: '没有找到这条缺陷' }
  if (defect.status === '已闭环') return { ok: false, message: '缺陷已闭环，无需重复操作' }
  defect.status = '已闭环'
  defect.closedAt = nowStamp()
  const todo = db.todos.find((t) => t.id === defect.todoId)
  if (todo) todo.status = '已闭环'
  // 对应的"不合格"待查项随闭环关闭。
  db.verifies.forEach((v) => {
    if (v.status === '待确认' && v.handoverNo === form.handoverNo && v.kind === '结论异常待查') {
      v.status = '已确认'
      v.resolution = '缺陷已闭环确认'
      v.resolvedAt = nowStamp()
    }
  })
  historyEvent(form, actor, '闭环确认', `${defect.location} 缺陷经接收单位确认闭环。`)
  addAudit(db, { at: nowStamp(), actor: actor.person, unit: actor.unit, action: '闭环确认', handoverNo: form.handoverNo, message: `缺陷 ${defectId} 闭环确认。`, rejected: false })
  enqueue(db, 'handover', '闭环确认', { handoverNo: form.handoverNo, defectId })
  persistHandover(db)
  return { ok: true, message: '缺陷已闭环确认' }
}

// ===== 到期未闭环自动转隐患（幂等：只转一次，隐患整改那边多一条待整改） =====

function nextHazardNo(rows: EntryRow[]): string {
  const max = rows.reduce((acc, row) => {
    const m = String(row['隐患编号'] ?? '').match(/(\d+)$/)
    return m ? Math.max(acc, Number(m[1])) : acc
  }, 1000)
  return `HAZA-${String(max + 1).padStart(4, '0')}`
}

export function sweepOverdue(externalDB?: HandoverDB): { converted: string[] } {
  const ownsDB = !externalDB
  const db = externalDB ?? handoverDB()
  const converted: string[] = []
  const now = today()

  const open = db.todos.filter(
    (t) => t.status !== '已闭环' && t.status !== '已转隐患' && t.dueDate < now,
  )
  if (open.length === 0) {
    if (ownsDB) persistHandover(db)
    return { converted }
  }

  const hazards = listRows('hazard')
  const nextHazardRows = [...hazards]

  for (const todo of open) {
    const form = db.forms.find((f) => f.handoverNo === todo.handoverNo)
    const defect = form?.defects.find((d) => d.id === todo.defectId)
    const hazardNo = nextHazardNo(nextHazardRows)
    todo.status = '已转隐患'
    todo.hazardNo = hazardNo
    if (defect) defect.hazardNo = hazardNo
    converted.push(`${todo.id}->${hazardNo}`)

    nextHazardRows.push({
      id: nextHazardRows.length + 1,
      status: '待整改',
      pending: true,
      abnormal: todo.severity === '严重',
      隐患编号: hazardNo,
      隐患部位: `${todo.handoverNo} ${todo.title}`,
      隐患等级: todo.severity,
      整改措施: `责任期届满（${todo.dueDate}）未闭环，由验收移交受控待办 ${todo.id} 自动转入，责任单位：建设单位。`,
      责任人员: '建设单位（待指派）',
      发现日期: now,
      整改期限: addMonths(now, 1),
      整改状态: '待整改',
    })

    if (form) {
      historyEvent(form, { unit: 'RECV', person: '系统' }, '到期自动转隐患', `受控待办 ${todo.id} 责任期届满未闭环，自动转入隐患整改台账 ${hazardNo}。`)
    }
    addAudit(db, {
      at: nowStamp(),
      actor: '系统',
      unit: 'RECV',
      action: '到期自动转隐患',
      handoverNo: todo.handoverNo,
      message: `受控待办 ${todo.id} 截止 ${todo.dueDate} 未闭环，自动转隐患 ${hazardNo}。`,
      rejected: false,
    })
    enqueue(db, 'hazard', '自动转隐患', { todo: todo.id, hazardNo })
  }

  saveRows('hazard', nextHazardRows)
  if (ownsDB) persistHandover(db)
  return { converted }
}

// ===== 待查台账确认/驳回（仅接收单位） =====

export function resolveVerify(id: string, resolution: string, reject = false): ServiceResult {
  const db = handoverDB()
  const actor = identity
  if (actor.unit !== 'RECV') {
    return { ok: false, message: `驳回：待查台账归接收单位确认，${unitName(actor.unit)}只读，拒绝写入。` }
  }
  const entry = db.verifies.find((v) => v.id === id)
  if (!entry) return { ok: false, message: '没有找到这条待查记录' }
  if (entry.status !== '待确认') return { ok: false, message: '该待查项已处理' }

  entry.status = reject ? '已驳回' : '已确认'
  entry.resolution = resolution.trim() || (reject ? '经核查不予认定' : '经核查确认')
  entry.resolvedAt = nowStamp()

  // 事实接管/缺项确认后：把挂起的单据补成正式台账口径（结论仍需接收单位验收人正式判定）。
  const form = entry.handoverNo ? db.forms.find((f) => f.handoverNo === entry.handoverNo) : undefined
  if (form && !reject && (entry.kind === '事实接管待确认' || entry.kind === '缺项待确认')) {
    historyEvent(form, actor, '待查确认', `${entry.kind}已确认：${entry.resolution}；单据继续等待正式验收结论。`)
  }
  addAudit(db, { at: nowStamp(), actor: actor.person, unit: actor.unit, action: '待查处理', handoverNo: entry.handoverNo, message: `${entry.kind} ${entry.id} ${entry.status}：${entry.resolution}`, rejected: false })
  enqueue(db, 'handover', '待查处理', { id, status: entry.status })
  persistHandover(db)
  return { ok: true, message: `待查项已${entry.status}` }
}

// ===== 存量补录：按验收日期整体搬入；无书面交接按事实接管补建；缺项逐条待查 =====

export type LegacyRow = {
  handoverNo: string
  tunnelName: string
  section: string
  consUnit: string
  recvUnit: string
  acceptDate?: string
  acceptor?: string
  liabilityMonths?: number | null
  takeoverDate?: string
  takeoverEvidence?: string
  conclusion?: Exclude<Conclusion, '待验收'>
  defects?: DefectInput[]
}

export type LegacyReport = {
  imported: number
  pending: number
  blocked: number
  duplicates: number
  items: { handoverNo: string; kind: 'imported' | 'pending' | 'blocked' | 'duplicate'; message: string }[]
}

export function importLegacy(rows: LegacyRow[]): ServiceResult<LegacyReport> {
  const db = handoverDB()
  const actor = identity
  if (actor.unit !== 'CONS') {
    return { ok: false, message: `驳回：存量补录由建设单位发起，${unitName(actor.unit)}只读，拒绝写入。` }
  }

  const report: LegacyReport = { imported: 0, pending: 0, blocked: 0, duplicates: 0, items: [] }
  const dateKey = (r: LegacyRow) => r.acceptDate ?? r.takeoverDate ?? ''
  // 补录顺序：按验收日期（无验收日按事实接管日）从早到晚整批搬入，时间轴自洽。
  const ordered = [...rows].sort((a, b) => dateKey(a).localeCompare(dateKey(b)))

  for (const raw of ordered) {
    const row: LegacyRow = {
      ...raw,
      handoverNo: raw.handoverNo.trim(),
      tunnelName: raw.tunnelName.trim(),
      section: raw.section.trim(),
      consUnit: raw.consUnit.trim(),
      recvUnit: raw.recvUnit.trim(),
    }

    if (db.forms.some((f) => f.handoverNo === row.handoverNo)) {
      report.duplicates += 1
      report.items.push({ handoverNo: row.handoverNo, kind: 'duplicate', message: '编号已存在，按去重规则跳过，不覆盖旧值。' })
      continue
    }

    const hasWritten = Boolean(row.acceptDate && row.acceptor)
    const hasAcceptDate = Boolean(row.acceptDate)
    const factTakeover = !hasWritten && Boolean(row.takeoverDate && row.takeoverEvidence)

    // 完全无凭证（无验收日、无接管痕迹）：不予补建，直接挂起。
    // 有验收日但缺验收人/责任期的，按"缺项"建档挂待验收（事实依据在，只是书面不全）。
    if (!hasAcceptDate && !factTakeover) {
      report.blocked += 1
      report.items.push({ handoverNo: row.handoverNo, kind: 'blocked', message: '无书面验收且无任何接管痕迹，不予补建，进待查台账挂起。' })
      addVerify(db, {
        kind: '缺项待确认',
        handoverNo: row.handoverNo,
        summary: `「${row.tunnelName}」无书面验收、无接管痕迹，存量补建被挂起。`,
        missingFields: ['验收日期', '验收人', '接管痕迹', '验收结论', '缺陷责任期'],
        source: '存量补录·无凭证挂起',
        raisedAt: nowStamp(),
        raisedBy: actor.person,
        ownerUnit: 'RECV',
        status: '待确认',
      })
      continue
    }

    const baseDate = hasWritten ? (row.acceptDate as string) : (row.takeoverDate as string)
    const missing: string[] = []
    if (!row.acceptDate) missing.push('验收日期')
    if (!row.acceptor) missing.push('验收人')
    if (!row.liabilityMonths) missing.push('缺陷责任期')

    // 缺关键项：从严，结论一律挂"待验收"，缺项逐条列入待查等人工确认，绝不默认合格。
    const formal = hasWritten && missing.length === 0
    const conclusion: Conclusion = formal ? (row.conclusion ?? '合格') : '待验收'
    const status = formal
      ? conclusion === '不合格'
        ? '已驳回'
        : '已验收'
      : '待验收'

    db.idSeq += 1
    const form: HandoverForm = {
      id: db.idSeq,
      handoverNo: row.handoverNo,
      tunnelName: row.tunnelName,
      section: row.section,
      consUnit: row.consUnit,
      recvUnit: row.recvUnit,
      submittedBy: actor.person,
      submittedAt: nowStamp(),
      acceptDate: row.acceptDate,
      acceptor: row.acceptor,
      conclusion,
      defects: [],
      liabilityMonths: row.liabilityMonths ?? null,
      liabilityStart: formal ? row.acceptDate : factTakeover ? row.takeoverDate : undefined,
      liabilityEnd: formal && row.liabilityMonths ? addMonths(row.acceptDate as string, row.liabilityMonths) : undefined,
      status,
      ownerUnit: 'RECV',
      takeoverDate: factTakeover ? row.takeoverDate : undefined,
      backfilled: true,
      factTakeover,
      remark: factTakeover
        ? `早年无书面交接，按"事实接管"补建，事实接管日 ${row.takeoverDate}（依据：${row.takeoverEvidence}），责任期自接管日起算，待人工确认。`
        : formal
          ? '存量移交单，按验收日期回填。'
          : '存量回填存在缺项，从严挂待验收，缺项待人工确认。',
      history: [],
      createdAt: nowStamp(),
    }
    historyEvent(
      form,
      actor,
      factTakeover ? '事实接管补建' : '存量回填',
      factTakeover
        ? `无书面交接，以最早接管痕迹 ${row.takeoverDate}（${row.takeoverEvidence}）为事实接管日补建，结论挂待验收。`
        : formal
          ? `按验收日期 ${row.acceptDate} 回填，结论沿用书面记录「${conclusion}」。`
          : `验收日期 ${baseDate} 可查，缺项（${missing.join('、')}），结论从严挂待验收。`,
    )

    if (formal && row.defects?.length) {
      for (const d of row.defects) {
        const judged = stricterSeverity(d.consSeverity, d.recvSeverity)
        const todoId = nextId(db.todos, 'T')
        form.defects.push({
          id: nextId(form.defects.map((x) => ({ id: x.id })), 'D'),
          location: d.location.trim(),
          desc: d.desc.trim(),
          consSeverity: d.consSeverity,
          recvSeverity: d.recvSeverity,
          effectiveSeverity: judged.effective,
          basis: judged.basis,
          hint: judged.hint,
          status: '待整改',
          todoId,
        })
        db.todos.push({
          id: todoId,
          handoverNo: form.handoverNo,
          defectId: form.defects[form.defects.length - 1].id,
          title: `${d.location} ${d.desc}`.trim(),
          severity: judged.effective,
          responsibleUnit: 'CONS',
          followUnit: 'RECV',
          dueDate: form.liabilityEnd as string,
          status: '待整改',
          createdAt: nowStamp(),
        })
      }
    }

    db.forms.push(form)
    addAudit(db, {
      at: nowStamp(),
      actor: actor.person,
      unit: actor.unit,
      action: factTakeover ? '事实接管补建' : '存量回填',
      handoverNo: form.handoverNo,
      message: formal
        ? `按验收日期 ${row.acceptDate} 回填建档，结论「${conclusion}」。`
        : `建档但挂待验收，缺项（${missing.join('、') || '书面验收'}）待确认。`,
      rejected: false,
    })
    enqueue(db, 'handover', factTakeover ? '事实接管补建' : '存量回填', { handoverNo: form.handoverNo })

    if (!formal) {
      report.pending += 1
      addVerify(db, {
        kind: factTakeover ? '事实接管待确认' : '缺项待确认',
        handoverNo: form.handoverNo,
        summary: factTakeover
          ? `「${form.tunnelName}」按事实接管补建（接管日 ${form.takeoverDate}），需确认接管事实、验收结论与责任期。`
          : `「${form.tunnelName}」回填缺项（${missing.join('、')}），结论挂待验收。`,
        missingFields: factTakeover ? ['验收人', '验收结论', '缺陷责任期'] : missing,
        source: factTakeover ? '存量补录·事实接管' : '存量补录·按验收日回填',
        raisedAt: nowStamp(),
        raisedBy: actor.person,
        ownerUnit: 'RECV',
        status: '待确认',
      })
      report.items.push({ handoverNo: row.handoverNo, kind: 'pending', message: factTakeover ? '事实接管补建，缺项待人工确认。' : `缺项（${missing.join('、')}）待确认。` })
    } else {
      report.imported += 1
      report.items.push({ handoverNo: row.handoverNo, kind: 'imported', message: `按验收日期 ${row.acceptDate} 正式建档。` })
    }
  }

  persistHandover(db)
  sweepOverdue(db)
  persistHandover(db)
  return {
    ok: true,
    message: `补录完成：正式建档 ${report.imported} 张，缺项挂起 ${report.pending} 张，无凭证不予补建 ${report.blocked} 张，重复跳过 ${report.duplicates} 张。`,
    data: report,
  }
}

// ===== 同步队列：断线只排队；恢复后从下一条未同步项继续，不拿上次的值顶上 =====

export function setOffline(offline: boolean): void {
  const db = handoverDB()
  db.offline = offline
  persistHandover(db)
}

export function armNextSyncFailure(): void {
  const db = handoverDB()
  db.mockFailNext = true
  persistHandover(db)
}

export function syncNow(): ServiceResult<{ synced: number; failed?: SyncItem; pendingLeft: number }> {
  const db = handoverDB()
  if (db.offline) {
    return { ok: false, message: '同步通道断线中：本次写入已排队，恢复后从下一条未同步项继续。' }
  }
  const pending = db.outbox
    .filter((s) => s.status === '待同步' || s.status === '同步失败')
    .sort((a, b) => a.seq - b.seq)
  if (pending.length === 0) {
    return { ok: true, message: '没有待同步项', data: { synced: 0, pendingLeft: 0 } }
  }

  // 从序号最小的未同步/失败项开始逐条走；已同步项不重放。
  const synced: number[] = []
  let failed: SyncItem | undefined
  for (const item of pending.slice(0, 5)) {
    item.attempts += 1
    if (db.mockFailNext && synced.length === 0 && item.attempts === 1) {
      // 演示"这条没同步成"：失败的一条保留原值，绝不拿上一次成功的值顶替。
      db.mockFailNext = false
      item.status = '同步失败'
      item.lastError = `第 ${item.attempts} 次同步失败，数据保留排队原值，等待续传。`
      failed = item
      break
    }
    item.status = '已同步'
    item.syncedAt = nowStamp()
    item.lastError = undefined
    synced.push(item.seq)
  }
  persistHandover(db)
  const pendingLeft = db.outbox.filter((s) => s.status === '待同步' || s.status === '同步失败').length
  if (failed) {
    return {
      ok: false,
      message: `同步在序号 ${failed.seq} 处中断：该条保留原值不顶替，下次从这条续传；已同步 ${synced.length} 条，剩余 ${pendingLeft} 条。`,
      data: { synced: synced.length, failed, pendingLeft },
    }
  }
  return { ok: true, message: `本轮同步 ${synced.length} 条，剩余待同步 ${pendingLeft} 条。`, data: { synced: synced.length, pendingLeft } }
}

// ===== 概览/看板/台账三处共用同一个统计函数：条数不允许出现两个数 =====

export function handoverStats(): HandoverStats {
  const db = handoverDB()
  const todos = db.todos
  const now = today()
  return {
    total: db.forms.length,
    pendingAccept: db.forms.filter((f) => f.status === '待验收').length,
    accepted: db.forms.filter((f) => f.status === '已验收' || f.status === '已移交').length,
    rejected: db.forms.filter((f) => f.status === '已驳回').length,
    openDefects: db.forms.reduce(
      (sum, f) => sum + f.defects.filter((d) => d.status !== '已闭环').length,
      0,
    ),
    openTodos: todos.filter((t) => t.status !== '已闭环' && t.status !== '已转隐患').length,
    overdueTodos: todos.filter((t) => t.status !== '已闭环' && t.status !== '已转隐患' && t.dueDate < now).length,
    hazardsGenerated: todos.filter((t) => t.status === '已转隐患').length,
    pendingVerify: db.verifies.filter((v) => v.status === '待确认').length,
    conflictsRejected: db.audits.filter((a) => a.rejected && a.action === '修改验收结论').length,
    backfilled: db.forms.filter((f) => f.backfilled).length,
  }
}

export function resetHandover(): void {
  const db = resetHandoverDB()
  persistHandover(db)
  sweepOverdue(db)
  persistHandover(db)
}

export type { VerifyKind }
