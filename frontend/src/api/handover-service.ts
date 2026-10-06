import { saveRows, listRows } from '@/data/local-store'
import { handoverSeed } from '@/data/handover-seed'
import type {
  Actor,
  AuditEntry,
  ControlledTodo,
  Defect,
  GapItem,
  HandoverForm,
  HandoverState,
  HazardRef,
  OutboxEvent,
  QueueDefect,
  ReconItem,
  ServiceResult,
} from '@/data/handover-types'
import {
  CONCLUSIONS,
  UNIT_BUILDER,
  UNIT_RECEIVER,
  UNIT_NAMES,
  levelRank,
} from '@/data/handover-types'

// 投运前验收与移交台账：所有业务规则集中在这一个文件，页面不做业务判断。
// 规则裁决见 docs/handover-rules.md。

const HANDOVER_KEY = 'urban-utility-tunnel:handover'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nowIso(): string {
  return new Date().toISOString()
}

function withHashes(s: HandoverState): HandoverState {
  for (const f of s.forms) {
    if (!f.contentHash) f.contentHash = contentHash(f)
  }
  return s
}

function dget(key: string): HandoverState {
  const fallback = withHashes(handoverSeed())
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
  try {
    const parsed = JSON.parse(raw) as HandoverState
    // 新版本字段兜底
    return withHashes({ ...clone(fallback), ...parsed })
  } catch {
    window.localStorage.setItem(key, JSON.stringify(fallback))
    return clone(fallback)
  }
}

let memory: HandoverState | null = null

export function getState(): HandoverState {
  if (memory === null) {
    memory = dget(HANDOVER_KEY)
  }
  return memory
}

function persist() {
  if (memory === null) return
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(HANDOVER_KEY, JSON.stringify(memory))
  }
}

/** 测试/重置：恢复演示数据 */
export function resetHandover(): HandoverState {
  memory = withHashes(handoverSeed())
  persist()
  rebuildAutoRecon()
  return getState()
}

// ---------- 工具 ----------

function contentHash(form: {
  formNo: string
  tunnelName: string
  section: string
  acceptDate: string
  handoverDate: string
  warrantyEnd: string
}): string {
  const raw = [form.formNo, form.tunnelName, form.section, form.acceptDate, form.handoverDate, form.warrantyEnd].join('|')
  let h = 0
  for (let i = 0; i < raw.length; i++) {
    h = (h * 31 + raw.charCodeAt(i)) | 0
  }
  return `h${Math.abs(h)}`
}

function nextSeq(s: HandoverState): number {
  const seq = s.nextSeq
  s.nextSeq += 1
  return seq
}

function audit(
  s: HandoverState,
  actor: Actor,
  action: string,
  target: string,
  field: string,
  reason: string,
  rejected: boolean,
): AuditEntry {
  const entry: AuditEntry = {
    seq: nextSeq(s),
    actor: actor.name,
    unit: actor.unit,
    action: rejected ? `驳回·${action}` : action,
    target,
    field,
    reason,
    at: nowIso(),
  }
  s.audits.unshift(entry)
  return entry
}

function enqueue(s: HandoverState, type: string, businessKey: string, payload: unknown) {
  const ev: OutboxEvent = {
    seq: nextSeq(s),
    type,
    businessKey,
    payload: payload === undefined || payload === null ? '' : JSON.stringify(payload),
    status: 'queued',
  }
  s.outbox.push(ev)
}

function findForm(s: HandoverState, formNo: string): HandoverForm | undefined {
  return s.forms.find((f) => f.formNo === formNo)
}

function ownerConflict(field: string, ownerUnit: string, actor: Actor): string {
  return `驳回：归属冲突——${field}归属${UNIT_NAMES[ownerUnit] ?? ownerUnit}（${ownerUnit}），${
    UNIT_NAMES[actor.unit] ?? actor.unit
  }（${actor.unit}）仅可读，禁止代改`
}

// ---------- 异常结论 → 待查台账（唯一入口，规则自动项可重建） ----------

function autoRecon(s: HandoverState): ReconItem[] {
  const items: ReconItem[] = []
  const push = (refType: string, refNo: string, reason: string, detail: string, source = '移交台账') => {
    items.push({
      id: `auto-${refType}-${refNo}-${reason}`,
      refType,
      refNo,
      reason,
      detail,
      status: '待查',
      source,
      createdAt: '',
      resolvedAt: '',
      auto: true,
    })
  }

  for (const form of s.forms) {
    const isBackfillOverdue =
      form.source === '补建-事实移交' &&
      form.warrantyEnd !== '' &&
      form.warrantyEnd < today() &&
      s.todos.some((t) => t.formNo === form.formNo && (t.status === '待整改' || t.status === '整改中'))
    if (isBackfillOverdue) {
      push(
        'form',
        form.formNo,
        '补建单超默认缺陷责任期仍有遗留问题',
        '补建时已超过缺陷责任期，禁止追溯认定移交时合格；遗留问题须人工核实后转隐患整改',
      )
    }

    const openSerious = s.defects.some(
      (d) =>
        d.formNo === form.formNo &&
        (d.status === '已锁定') &&
        (d.adoptedLevel === '严重' || d.adoptedLevel === '危急') &&
        s.todos.some((t) => t.defectNo === d.defectNo && t.status !== '已闭环' && t.status !== '已转隐患'),
    )
    if (
      (form.conclusion === '合格' || form.conclusion === '有条件合格') &&
      (form.status === '已验收' || form.status === '已移交') &&
      openSerious
    ) {
      push('form', form.formNo, '结论与缺陷状态矛盾', '验收结论为合格/有条件合格，但存在未闭环的严重及以上缺陷')
    }

    if (form.acceptDate === '' && (form.status === '已验收' || form.status === '已移交')) {
      push('form', form.formNo, '验收日期缺失', '单据已验收/移交但缺少验收日期')
    }
    if (
      form.acceptDate !== '' &&
      form.handoverDate !== '' &&
      form.acceptDate > form.handoverDate
    ) {
      push('form', form.formNo, '日期时序异常', `验收日期 ${form.acceptDate} 晚于移交日期 ${form.handoverDate}`)
    }
    if (
      (form.status === '已验收' || form.status === '已移交') &&
      (!form.acceptor || form.conclusionVersions.length === 0)
    ) {
      push('form', form.formNo, '结论异常：无验收人签字', '验收结论已产生但缺少验收人签字与审批记录，审批不生效')
    }
  }
  return items
}

/** 规则自动待查项按当前数据重算；人工项（驳回、同步缺值等）保留不动。所有入口写同一本台账。 */
export function rebuildAutoRecon(): ReconItem[] {
  const s = getState()
  const manual = s.recon.filter((r) => !r.auto)
  const auto = autoRecon(s)
  const seen = new Set<string>()
  const merged: ReconItem[] = []
  // 已存在的自动项若仍然成立，保留原建单时间与处置状态（只有人工解除才会消失）
  for (const item of [...manual, ...s.recon.filter((r) => r.auto)]) {
    const key = `${item.refNo}|${item.reason}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  for (const calc of auto) {
    const key = `${calc.refNo}|${calc.reason}`
    if (seen.has(key)) continue
    seen.add(key)
    calc.createdAt = nowIso()
    merged.push(calc)
  }
  const stillValid = new Set(auto.map((r) => `${r.refNo}|${r.reason}`))
  s.recon = merged.filter((r) => !r.auto || stillValid.has(`${r.refNo}|${r.reason}`) || r.status !== '待查')
  persist()
  return s.recon
}

function addManualRecon(
  s: HandoverState,
  refType: string,
  refNo: string,
  reason: string,
  detail: string,
  source: string,
): void {
  const exists = s.recon.some(
    (r) => r.refNo === refNo && r.reason === reason && r.status === '待查' && !r.auto,
  )
  if (exists) return
  s.recon.unshift({
    id: `M${nextSeq(s)}`,
    refType,
    refNo,
    reason,
    detail,
    status: '待查',
    source,
    createdAt: nowIso(),
    resolvedAt: '',
    auto: false,
  })
}

function commit(): void {
  rebuildAutoRecon()
  persist()
}

// ---------- 移交单 ----------

export type FormDraft = {
  formNo: string
  tunnelName: string
  section: string
  acceptDate: string
  handoverDate: string
  warrantyEnd: string
  conclusion: string
  acceptor: string
  source: string
  evidence: string[]
}

/** 登记移交单（建设单位建档）。同编号重复提交：同内容幂等、异内容驳回并挂待查。 */
export function submitForm(actor: Actor, draft: FormDraft): ServiceResult<HandoverForm> {
  const s = getState()
  if (actor.unit !== UNIT_BUILDER) {
    audit(s, actor, '登记移交单', draft.formNo, '移交单元数据', ownerConflict('移交单建档', UNIT_BUILDER, actor), true)
    persist()
    return { ok: false, message: ownerConflict('移交单建档', UNIT_BUILDER, actor) }
  }
  if (!draft.formNo.trim()) {
    return { ok: false, message: '移交单编号不能为空' }
  }
  if (!CONCLUSIONS.includes(draft.conclusion)) {
    return { ok: false, message: `验收结论必须是：${CONCLUSIONS.join(' / ')}` }
  }
  if (draft.source === '补建-事实移交') {
    if (draft.evidence.length < 2) {
      return { ok: false, message: '补建单须至少登记两类凭证（实际投运记录 / 接管巡检 / 资产入账凭证等）' }
    }
    if (draft.conclusion !== '待补验（补建）') {
      return { ok: false, message: '补建单确认前结论位只能是「待补验（补建）」，禁止补造合格结论' }
    }
  }

  const hash = contentHash(draft)
  const existing = findForm(s, draft.formNo)
  if (existing) {
    if (existing.contentHash === hash) {
      return { ok: true, message: `移交单 ${draft.formNo} 内容与已登记单一致，按编号去重，不重复登记`, data: existing }
    }
    const reason = '同编号重复提交且内容不一致'
    addManualRecon(
      s,
      'form',
      draft.formNo,
      reason,
      `已存单指纹 ${existing.contentHash}，本次提交指纹 ${hash}；本次写入已驳回，以原单为准，待人工裁决`,
      '移交台账',
    )
    audit(s, actor, '登记移交单', draft.formNo, '移交单内容', `${reason}，驳回写入并转待查`, true)
    commit()
    return { ok: false, message: `驳回：移交单 ${draft.formNo} 已存在但内容不一致，本次拒绝写入，冲突已转待查台账` }
  }

  const isBackfill = draft.source !== '正式移交'
  const form: HandoverForm = {
    id: `F${nextSeq(s)}`,
    ...draft,
    acceptUnit: UNIT_BUILDER,
    receiverUnit: UNIT_RECEIVER,
    status: isBackfill ? '补建待确认' : draft.acceptDate ? '待验收' : '待验收',
    createdBy: actor.name,
    createdAt: nowIso(),
    contentHash: hash,
    conclusionVersions: [],
  }
  s.forms.push(form)
  audit(s, actor, '登记移交单', form.formNo, '移交单元数据', `来源：${form.source}`, false)
  enqueue(s, 'form.created', form.formNo, { formNo: form.formNo, hash })
  commit()
  return { ok: true, message: `移交单 ${form.formNo} 已登记，归属：验收单位 ${UNIT_NAMES[UNIT_BUILDER]}`, data: form }
}

/** 审批验收结论：仅验收单位的验收人；审批人与时间由系统生成，追加不可改版本。 */
export function approveConclusion(
  actor: Actor,
  formNo: string,
  conclusion: string,
  warrantyEnd: string,
): ServiceResult {
  const s = getState()
  const form = findForm(s, formNo)
  if (!form) return { ok: false, message: `没有找到移交单 ${formNo}` }
  const field = '验收结论'
  if (actor.unit !== form.acceptUnit) {
    const msg = ownerConflict(field, form.acceptUnit, actor)
    audit(s, actor, '修改验收结论', formNo, field, msg, true)
    persist()
    return { ok: false, message: msg }
  }
  if (actor.role !== '验收人') {
    const msg = `驳回：归属冲突——${field}仅 ${UNIT_NAMES[form.acceptUnit]} 的验收人可审批，${actor.name}（${actor.role}）无验收人角色`
    audit(s, actor, '修改验收结论', formNo, field, msg, true)
    persist()
    return { ok: false, message: msg }
  }
  if (!CONCLUSIONS.includes(conclusion)) {
    return { ok: false, message: `验收结论必须是：${CONCLUSIONS.join(' / ')}` }
  }
  if (!warrantyEnd) {
    return { ok: false, message: '审批验收结论必须同时确定缺陷责任期截止日' }
  }
  if (form.acceptDate && warrantyEnd <= form.acceptDate) {
    return { ok: false, message: '缺陷责任期截止日必须晚于验收日期' }
  }
  form.conclusion = conclusion
  form.warrantyEnd = warrantyEnd
  form.status = '已验收'
  form.conclusionVersions.push({
    conclusion,
    acceptor: actor.name,
    approver: actor.name,
    approverUnit: actor.unit,
    approvedAt: nowIso(),
  })
  form.acceptor = form.acceptor || actor.name
  audit(s, actor, '审批验收结论', formNo, field, `结论=${conclusion}；责任期至 ${warrantyEnd}`, false)
  enqueue(s, 'form.approved', formNo, { formNo, conclusion, warrantyEnd })
  commit()
  return {
    ok: true,
    message: `验收结论「${conclusion}」已由 ${actor.name}（${UNIT_NAMES[actor.unit]}）审批，责任期至 ${warrantyEnd}；版本号 v${form.conclusionVersions.length}`,
  }
}

/** 接收确认：仅接收单位 */
export function confirmHandover(actor: Actor, formNo: string): ServiceResult {
  const s = getState()
  const form = findForm(s, formNo)
  if (!form) return { ok: false, message: `没有找到移交单 ${formNo}` }
  const field = '接收确认'
  if (actor.unit !== form.receiverUnit) {
    const msg = ownerConflict(field, form.receiverUnit, actor)
    audit(s, actor, '接收确认', formNo, field, msg, true)
    persist()
    return { ok: false, message: msg }
  }
  if (form.status !== '已验收') {
    return { ok: false, message: `移交单当前为「${form.status}」，须先由验收单位审批验收结论` }
  }
  form.status = '已移交'
  if (!form.handoverDate) form.handoverDate = today()
  audit(s, actor, '接收确认', formNo, field, `接收单位 ${UNIT_NAMES[actor.unit]} 确认接收`, false)
  enqueue(s, 'form.handed', formNo, { formNo, handoverDate: form.handoverDate })
  commit()
  return { ok: true, message: `移交单 ${formNo} 已由接收单位确认接收，移交日期 ${form.handoverDate}` }
}

// ---------- 缺陷判定：取严仲裁 ----------

export function recordDefectFinding(
  actor: Actor,
  formNo: string,
  location: string,
  description: string,
  level: string,
  rectifyDue: string,
): ServiceResult<Defect> {
  const s = getState()
  const form = findForm(s, formNo)
  if (!form) return { ok: false, message: `没有找到移交单 ${formNo}` }
  if (!location.trim()) return { ok: false, message: '缺陷部位不能为空' }
  if (!['一般', '严重', '危急'].includes(level)) return { ok: false, message: '判定档必须是 一般 / 严重 / 危急' }

  // 双方各自只能写自己的判定列
  if (actor.unit !== UNIT_BUILDER && actor.unit !== UNIT_RECEIVER) {
    const msg = `驳回：归属冲突——缺陷判定仅建设单位与接收单位可登记，${UNIT_NAMES[actor.unit] ?? actor.unit} 仅可读`
    audit(s, actor, '登记缺陷判定', formNo, '缺陷判定', msg, true)
    persist()
    return { ok: false, message: msg }
  }

  let defect = s.defects.find((d) => d.formNo === formNo && d.location === location)
  const isFirst = !defect
  if (isFirst) {
    defect = {
      id: `D${nextSeq(s)}`,
      defectNo: `QX-${formNo}-${String(s.defects.length + 1).padStart(3, '0')}`,
      formNo,
      location,
      description,
      builderLevel: '',
      receiverLevel: '',
      adoptedLevel: '',
      adoptedBy: '',
      downgradedNote: '',
      rectifyDue: rectifyDue || form.warrantyEnd,
      status: '待判定',
      source: form.source === '正式移交' ? '正式移交' : form.source,
      createdAt: nowIso(),
    }
    s.defects.push(defect)
  }
  const d: Defect = defect as Defect

  // 重复判定同档：幂等
  const ownKey = actor.unit === UNIT_BUILDER ? 'builderLevel' : 'receiverLevel'
  if (!isFirst && d[ownKey] === level) {
    return { ok: true, message: `缺陷 ${d.defectNo} 已有相同判定，按幂等处理`, data: d }
  }
  d[ownKey] = level

  adjudicate(d)

  // 受控待办：生效档为严重/危急即建（一般问题按验收结论附条件跟踪——
  // 规则书：首次判定即对该档生效受控，严重/危急强制建待办；双方均判一般时仅提示不建待办）
  const needTodo = d.adoptedLevel === '严重' || d.adoptedLevel === '危急'
  let todo = s.todos.find((t) => t.defectNo === d.defectNo)
  if (needTodo && !todo) {
    const due = d.rectifyDue || form.warrantyEnd
    todo = {
      id: `T${nextSeq(s)}`,
      todoNo: `TK-${d.defectNo}`,
      formNo,
      defectNo: d.defectNo,
      title: `${location} ${description}`.slice(0, 60),
      ownerUnit: UNIT_BUILDER, // 责任期内缺陷整改责任在建设单位
      ownerName: '待指派',
      dueDate: due,
      closedAt: '',
      status: '待整改',
      source: d.source,
    }
    s.todos.push(todo)
  }
  if (todo && levelRank(d.adoptedLevel) > levelRank('一般')) {
    // 仲裁加严时同步收紧待办期限
    if (d.rectifyDue && (!todo.dueDate || d.rectifyDue < todo.dueDate)) {
      todo.dueDate = d.rectifyDue
    }
    if (todo.status === '已闭环') {
      // 已闭环但仲裁加严：重新打开（从严档强制）
      todo.status = '待整改'
      todo.closedAt = ''
    }
  }

  d.status = '已锁定'
  audit(
    s,
    actor,
    '登记缺陷判定',
    formNo,
    actor.unit === UNIT_BUILDER ? '建设单位判定' : '接收单位判定',
    `${actor.unit === UNIT_BUILDER ? '建设' : '接收'}方判「${level}」，仲裁生效档「${d.adoptedLevel}」（${
      d.adoptedBy === UNIT_RECEIVER ? '接收方落锤' : UNIT_NAMES[d.adoptedBy]
    }）`,
    false,
  )
  enqueue(s, 'defect.found', d.defectNo, { defectNo: d.defectNo, adoptedLevel: d.adoptedLevel })
  commit()
  return {
    ok: true,
    message: isFirst
      ? `缺陷 ${d.defectNo} 首次判定「${level}」即按该档受控，待办 ${todo?.todoNo ?? '（一般问题暂不建待办）'}`
      : `缺陷 ${d.defectNo} 二次判定到达，取严生效「${d.adoptedLevel}」，宽松档已降级为提示`,
    data: d,
  }
}

/** 仲裁：更严一档生效；同级以接收单位为准；宽松档降级提示。 */
function adjudicate(d: Defect): void {
  const b = d.builderLevel
  const r = d.receiverLevel
  if (b && !r) {
    d.adoptedLevel = b
    d.adoptedBy = UNIT_BUILDER
    d.downgradedNote = ''
  } else if (!b && r) {
    d.adoptedLevel = r
    d.adoptedBy = UNIT_RECEIVER
    d.downgradedNote = b === '' ? '建设方尚未判定，先按接收方现场判定受控；建设方判定到达后重新仲裁' : ''
  } else if (b && r) {
    if (levelRank(r) > levelRank(b)) {
      d.adoptedLevel = r
      d.adoptedBy = UNIT_RECEIVER
      d.downgradedNote = `建设单位判定「${b}」较宽松，按取严原则降级为提示（${UNIT_NAMES[UNIT_BUILDER]} 判）`
    } else if (levelRank(b) > levelRank(r)) {
      d.adoptedLevel = b
      d.adoptedBy = UNIT_BUILDER
      d.downgradedNote = `接收单位判定「${r}」较宽松，按取严原则降级为提示（${UNIT_NAMES[UNIT_RECEIVER]} 判）`
    } else {
      d.adoptedLevel = r
      d.adoptedBy = UNIT_RECEIVER
      d.downgradedNote = `双方判定同级「${b}」，按运行方负责原则由接收单位落锤`
    }
  }
}

// ---------- 受控待办 ----------

export function closeTodo(actor: Actor, todoNo: string): ServiceResult {
  const s = getState()
  const todo = s.todos.find((t) => t.todoNo === todoNo)
  if (!todo) return { ok: false, message: `没有找到待办 ${todoNo}` }
  if (actor.unit !== todo.ownerUnit) {
    const msg = ownerConflict('待办闭环', todo.ownerUnit, actor)
    audit(s, actor, '闭环待办', todoNo, '闭环确认', msg, true)
    persist()
    return { ok: false, message: msg }
  }
  if (todo.status === '已转隐患') {
    return { ok: false, message: `待办 ${todoNo} 已转隐患，闭环动作请到隐患整改模块完成` }
  }
  todo.status = '已闭环'
  todo.closedAt = nowIso()
  audit(s, actor, '闭环待办', todoNo, '闭环确认', `责任单位 ${UNIT_NAMES[actor.unit]} 确认闭环`, false)
  enqueue(s, 'todo.closed', todoNo, { todoNo, closedAt: todo.closedAt })
  commit()
  return { ok: true, message: `待办 ${todoNo} 已闭环` }
}

/** 到期未闭环自动转隐患（幂等，按来源待办编号去重）。asOf 用于演示跑批。 */
export function runWarrantySweep(asOf: string = today()): ServiceResult<{ created: string[] }> {
  const s = getState()
  const created: string[] = []
  for (const todo of s.todos) {
    if (todo.status !== '待整改' && todo.status !== '整改中') continue
    if (!todo.dueDate || todo.dueDate >= asOf) continue
    const hazardNo = `YH-${todo.todoNo}`
    if (s.hazards.some((h) => h.sourceTodoNo === todo.todoNo) || s.hazards.some((h) => h.hazardNo === hazardNo)) {
      continue // 幂等
    }
    const defect = s.defects.find((d) => d.defectNo === todo.defectNo)
    const hazard: HazardRef = {
      id: `H${nextSeq(s)}`,
      hazardNo,
      sourceTodoNo: todo.todoNo,
      location: defect?.location ?? todo.formNo,
      level: defect?.adoptedLevel ?? '严重',
      measure: todo.title,
      ownerName: todo.ownerName,
      foundDate: asOf,
      dueDate: todo.dueDate,
      status: '待整改',
      createdAt: nowIso(),
    }
    s.hazards.push(hazard)
    // 同步写一条到隐患整改模块（hazard），让那边多出一条待整改
    pushHazardRow(hazard, todo.formNo)
    todo.status = '已转隐患'
    if (defect) defect.status = '已转隐患'
    created.push(hazardNo)
    audit(
      s,
      { id: 'system', name: '系统跑批', unit: 'SYSTEM', role: '定时器' },
      '到期转隐患',
      todo.todoNo,
      '受控待办',
      `责任期遗留问题到期（${todo.dueDate}）未闭环，自动生成隐患 ${hazardNo}`,
      false,
    )
    enqueue(s, 'todo.expired', todo.todoNo, { todoNo: todo.todoNo, hazardNo })
  }
  s.lastSweepAt = nowIso()
  commit()
  return {
    ok: true,
    message: created.length
      ? `跑批完成：${created.length} 条到期未闭环待办已自动转隐患（${created.join('、')}），隐患整改模块新增对应待整改`
      : '跑批完成：没有到期未闭环的受控待办',
    data: { created },
  }
}

// 隐患整改模块（hazard）使用通用 EntryRow 存储，字段以模块元数据为准。
function pushHazardRow(h: HazardRef, formNo: string) {
  try {
    const rows = listRows('hazard')
    const id = rows.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1
    rows.push({
      id,
      status: '待整改',
      pending: true,
      abnormal: false,
      隐患编号: h.hazardNo,
      隐患部位: h.location,
      隐患等级: h.level,
      整改措施: h.measure,
      责任人员: h.ownerName,
      发现日期: h.foundDate,
      整改期限: h.dueDate,
      整改状态: '待整改',
      来源: `移交台账自动转入（移交单 ${formNo} / 待办 ${h.sourceTodoNo}）`,
    })
    saveRows('hazard', rows)
  } catch {
    // 纯数据层不可用时（测试环境）忽略跨模块写入，handover 内 HazardRef 仍是真实读数
  }
}

// ---------- 待查处置 / 缺项确认 ----------

export function resolveRecon(actor: Actor, id: string, verdict: '已核实' | '已排除', note: string): ServiceResult {
  const s = getState()
  const item = s.recon.find((r) => r.id === id)
  if (!item) return { ok: false, message: `没有找到待查项 ${id}` }
  if (item.status !== '待查') return { ok: false, message: '待查项已处置，不可重复操作' }
  item.status = verdict
  item.resolvedAt = nowIso()
  item.detail = `${item.detail}\n处置（${actor.name}/${UNIT_NAMES[actor.unit] ?? actor.unit}）：${verdict}。${note}`
  audit(s, actor, '处置待查', item.refNo, '待查台账', `${verdict}：${note}`, false)
  commit()
  return { ok: true, message: `待查项 ${item.refNo} 已标记「${verdict}」` }
}

export function resolveGap(
  actor: Actor,
  id: string,
  verdict: 'confirmed' | 'discard',
  payload: { formNo?: string; acceptDate?: string; patrolDate?: string; rectifyDue?: string; note?: string },
): ServiceResult {
  const s = getState()
  const gap = s.gaps.find((g) => g.id === id)
  if (!gap) return { ok: false, message: `没有找到缺项 ${id}` }
  if (gap.status !== '待确认') return { ok: false, message: '缺项已确认，不可重复操作' }

  if (verdict === 'discard') {
    gap.status = '已剔除'
    gap.resolvedNote = payload.note || '人工核实无法确认，剔除'
    gap.resolvedAt = nowIso()
    audit(s, actor, '剔除缺项', gap.rawSummary.slice(0, 20), '缺项清单', gap.resolvedNote, false)
    commit()
    return { ok: true, message: '缺项已剔除并留痕，不计入有效数据' }
  }

  // confirmed：补齐后按当前规则引擎即时重放
  if (gap.kind === 'form') {
    if (!payload.formNo || !payload.acceptDate) {
      return { ok: false, message: '确认移交单缺项至少要补齐 移交单编号 与 验收日期' }
    }
    const draft: FormDraft = {
      formNo: payload.formNo,
      tunnelName: gap.rawSummary,
      section: '补录待补',
      acceptDate: payload.acceptDate,
      handoverDate: payload.acceptDate,
      warrantyEnd: payload.rectifyDue || addMonths(payload.acceptDate, 24),
      conclusion: '待补验（补建）',
      acceptor: actor.unit === UNIT_BUILDER ? actor.name : '待建设单位补签',
      source: '补建-事实移交',
      evidence: ['缺项人工补录单'],
    }
    const r = submitForm({ ...actor, unit: UNIT_BUILDER, role: '验收人' }, draft)
    if (!r.ok) return r
  } else {
    const formNo = payload.formNo || gap.suggestedFormNo
    const form = findForm(s, formNo)
    if (!form || (form.status !== '已验收' && form.status !== '已移交')) {
      return { ok: false, message: `归属单 ${formNo} 不存在或尚未有效，不能挂接；请先确认移交单骨架` }
    }
    if (!payload.patrolDate) return { ok: false, message: '确认往期缺陷缺项必须补齐巡检日期' }
    const r = recordDefectFinding(
      { ...actor, unit: UNIT_RECEIVER },
      formNo,
      gap.rawSummary,
      gap.rawSummary,
      '严重',
      payload.rectifyDue || form.warrantyEnd,
    )
    if (!r.ok) return r
  }
  gap.status = '已确认'
  gap.resolvedAt = nowIso()
  gap.resolvedNote = payload.note || '字段补齐，已按规则引擎重放'
  audit(s, actor, '确认缺项', gap.rawSummary.slice(0, 20), '缺项清单', gap.resolvedNote, false)
  commit()
  return { ok: true, message: '缺项已补齐并按规则引擎即时重放（绑定归属、去重、异常判定同新单）' }
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1 + months, d)
  return dt.toISOString().slice(0, 10)
}

// ---------- 存量回填 ----------

/** 阶段 A：移交单骨架按验收日期升序；阶段 B：往期明细按巡检日期升序。 */
export function runBackfill(actor: Actor): ServiceResult {
  const s = getState()
  if (s.backfillDone) {
    return { ok: false, message: '存量回填已执行过；如需重放请先重置演示数据' }
  }
  const log: string[] = []

  // 阶段 A
  const queue = [...s.backfillQueue].sort((a, b) =>
    a.acceptDate === b.acceptDate ? a.formNo.localeCompare(b.formNo) : a.acceptDate.localeCompare(b.acceptDate),
  )
  for (const item of queue) {
    const r = submitForm(
      { id: 'backfill', name: `${actor.name}（回填）`, unit: UNIT_BUILDER, role: '验收人' },
      {
        formNo: item.formNo,
        tunnelName: item.tunnelName,
        section: item.section,
        acceptDate: item.acceptDate,
        handoverDate: item.handoverDate,
        warrantyEnd: item.warrantyEnd,
        conclusion: item.conclusion,
        acceptor: item.acceptor,
        source: item.source,
        evidence: item.evidence,
      },
    )
    log.push(`骨架 ${item.formNo}（验收 ${item.acceptDate}）：${r.ok ? '入库' : r.message}`)
    if (r.ok && r.data) {
      // 历史已审批：补一条版本（回溯登记，标记为回填）
      const form = r.data
      form.conclusionVersions.push({
        conclusion: form.conclusion,
        acceptor: form.acceptor,
        approver: form.acceptor,
        approverUnit: UNIT_BUILDER,
        approvedAt: `${item.acceptDate}T00:00:00（往期回填补登）`,
      })
      form.status = item.status
    }
  }

  // 阶段 B：往期明细按巡检日期升序；缺项逐条列出等人工确认
  const legacy = [...s.legacyQueue].sort((a, b) => a.patrolDate.localeCompare(b.patrolDate))
  let seq = 0
  for (const item of legacy) {
    const form = findForm(s, item.formNo)
    const missing: string[] = []
    if (!item.patrolDate) missing.push('巡检日期')
    if (!item.rectifyDue) missing.push('整改要求日')
    const formValid = form && (form.status === '已验收' || form.status === '已移交')
    if (!formValid) missing.push('归属移交单未有效')
    if (missing.length) {
      seq += 1
      const gap: GapItem = {
        id: `G${nextSeq(s)}`,
        batch: '往期回填-2023',
        rawSummary: `${item.location}｜${item.description}`,
        missingFields: missing,
        kind: 'defect',
        suggestedFormNo: item.formNo,
        status: '待确认',
        resolvedNote: '',
        createdAt: nowIso(),
        resolvedAt: '',
      }
      s.gaps.push(gap)
      log.push(`明细 ${item.location}：缺 ${missing.join('、')} → 缺项清单 ${gap.id}`)
      continue
    }
    if (item.patrolDate < (form as HandoverForm).acceptDate) {
      addManualRecon(
        s,
        'defect',
        `${item.formNo}/${item.location}`,
        '往期巡检日期早于验收日期',
        `巡检日期 ${item.patrolDate} 早于验收日期 ${(form as HandoverForm).acceptDate}，时序矛盾，待人工核实`,
        '回填',
      )
      log.push(`明细 ${item.location}：时序矛盾 → 待查台账`)
      continue
    }
    const r = recordDefectFinding(
      { id: 'backfill', name: `${actor.name}（回填）`, unit: UNIT_RECEIVER, role: '运维主管' },
      item.formNo,
      item.location,
      item.description,
      item.level,
      item.rectifyDue,
    )
    log.push(`明细（巡检 ${item.patrolDate}）${item.location}：${r.ok ? '挂接入库' : r.message}`)
  }

  s.backfillQueue = []
  s.legacyQueue = []
  s.backfillDone = true
  audit(s, actor, '执行存量回填', '回填批次', '回填引擎', `骨架 ${queue.length} 单、明细 ${legacy.length} 条`, false)
  commit()
  return { ok: true, message: `回填完成：\n${log.join('\n')}` }
}

// ---------- 同步：断线从断点续传，缺值不顶上 ----------

export function syncCursor(s: HandoverState = getState()): number {
  let cursor = 0
  for (const ev of [...s.outbox].sort((a, b) => a.seq - b.seq)) {
    if (ev.status === 'synced' && ev.seq === cursor + 1) cursor = ev.seq
  }
  return cursor
}

export type SyncStep = { seq: number; status: string; message: string }

/**
 * 模拟对端接收：从游标+1 的原事件开始，逐条确认；缺载荷/缺关键字段不顶上、挂待查。
 * @param goOfflineAfter 在确认完该序号后断线（该序号仍 synced，之后的保持 queued）；-1 表示不断线
 */
export function pushSync(goOfflineAfter = -1): ServiceResult<{ steps: SyncStep[] }> {
  const s = getState()
  const steps: SyncStep[] = []
  const sorted = [...s.outbox].sort((a, b) => a.seq - b.seq)
  for (const ev of sorted) {
    if (ev.status !== 'queued') continue
    if (goOfflineAfter >= 0 && ev.seq > goOfflineAfter) {
      steps.push({ seq: ev.seq, status: '断线', message: `同步链路在确认序号 ${goOfflineAfter} 后中断，本事件保持 queued` })
      break
    }
    // 绝不拿上一条值顶上：本事件缺载荷即拒收
    if (ev.payload === '') {
      ev.status = 'failed'
      addManualRecon(
        s,
        'sync',
        `${ev.type}:${ev.businessKey}`,
        '同步事件缺载荷',
        `序号 ${ev.seq}（${ev.type} / ${ev.businessKey}）载荷为空，未沿用上一条事件的值，原值保持不动，待补推`,
        '同步',
      )
      audit(
        s,
        { id: 'sync', name: '同步通道', unit: 'SYSTEM', role: '通道' },
        '同步拒收',
        ev.businessKey,
        '事件载荷',
        `序号 ${ev.seq} 缺载荷，不顶上、挂待查`,
        true,
      )
      steps.push({ seq: ev.seq, status: 'failed', message: '缺载荷，拒收并挂待查（未顶上一条值）' })
      break
    }
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(ev.payload) as Record<string, unknown>
    } catch {
      ev.status = 'failed'
      steps.push({ seq: ev.seq, status: 'failed', message: '载荷无法解析，拒收' })
      break
    }
    if (!payload.formNo && !payload.defectNo && !payload.todoNo) {
      ev.status = 'failed'
      addManualRecon(
        s,
        'sync',
        `${ev.type}:${ev.businessKey}`,
        '同步事件缺关键字段',
        `序号 ${ev.seq} 缺少业务键字段，拒收并保持原值`,
        '同步',
      )
      steps.push({ seq: ev.seq, status: 'failed', message: '缺业务键，拒收并挂待查' })
      break
    }
    ev.status = 'synced'
    steps.push({ seq: ev.seq, status: 'synced', message: `${ev.type} 确认成功` })
  }
  commit()
  const cursor = syncCursor(s)
  return {
    ok: true,
    message: `同步结束，连续确认游标 = ${cursor}（下次从序号 ${cursor + 1} 的原事件续传）`,
    data: { steps },
  }
}

// ---------- 唯一统计口径：概览与看板共用 ----------

export type HandoverStats = {
  formsTotal: number
  formsValid: number
  pendingAccept: number
  handed: number
  todosOpen: number
  todosOverdue: number
  hazardsFromHandover: number
  reconOpen: number
  gapPending: number
  rejectedWrites: number
  syncCursor: number
  syncQueued: number
}

export function handoverStats(asOf: string = today()): HandoverStats {
  const s = getState()
  // 隐患数以隐患整改模块（hazard）的真实记录为准读数，本台账的 HazardRef 是写入凭证
  let hazardCount = s.hazards.length
  try {
    hazardCount = listRows('hazard').filter((r) => String(r['来源'] ?? '').includes('移交台账自动转入')).length
    if (hazardCount === 0 && s.hazards.length > 0) hazardCount = s.hazards.length
  } catch {
    hazardCount = s.hazards.length
  }
  return {
    formsTotal: s.forms.length,
    formsValid: s.forms.filter((f) => f.status === '已验收' || f.status === '已移交').length,
    pendingAccept: s.forms.filter((f) => f.status === '待验收' || f.status === '补建待确认').length,
    handed: s.forms.filter((f) => f.status === '已移交').length,
    todosOpen: s.todos.filter((t) => t.status === '待整改' || t.status === '整改中').length,
    todosOverdue: s.todos.filter(
      (t) => (t.status === '待整改' || t.status === '整改中') && t.dueDate !== '' && t.dueDate < asOf,
    ).length,
    hazardsFromHandover: hazardCount,
    reconOpen: s.recon.filter((r) => r.status === '待查').length,
    gapPending: s.gaps.filter((g) => g.status === '待确认').length,
    rejectedWrites: s.audits.filter((a) => a.action.startsWith('驳回')).length,
    syncCursor: syncCursor(s),
    syncQueued: s.outbox.filter((e) => e.status === 'queued').length,
  }
}
