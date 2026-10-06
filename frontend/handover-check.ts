// 规则自检测试：node 环境注入 localStorage 垫片，tsc 编译后执行（见 scripts/handover-check.sh）。
// 覆盖：归属拦截/越权驳回、取严仲裁、待办到期转隐患幂等、编号去重、
// 回填两阶段+缺项、同步断点续传不顶上、双口径一致。
import assert from 'node:assert'
import { listRows } from './src/data/local-store'

void (async () => {
  const store: Record<string, string> = {}
  ;(globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v
      },
      removeItem: (k: string) => delete store[k],
    },
  }

  const svc = await import('./src/api/handover-service')

const builder: import('./src/data/handover-types.ts').Actor = {
  id: 'b', name: '高建成', unit: 'BUILDER', role: '验收人',
}
const builderPm: import('./src/data/handover-types.ts').Actor = {
  id: 'bpm', name: '段工', unit: 'BUILDER', role: '项目经理',
}
const receiver: import('./src/data/handover-types.ts').Actor = {
  id: 'r', name: '管运维', unit: 'RECEIVER', role: '运维主管',
}
const supervisor: import('./src/data/handover-types.ts').Actor = {
  id: 's', name: '简理', unit: 'SUPERVISOR', role: '监理工程师',
}

let passed = 0
function check(name: string, cond: boolean, extra = '') {
  assert.ok(cond, `${name} ${extra}`)
  passed++
  console.log(`✓ ${name}`)
}

svc.resetHandover()

// 1. 接收单位不能改验收结论（核心乱象修复）
let r = svc.approveConclusion(receiver, 'YJ-2024-001', '不合格', '2027-01-01')
check('接收单位改验收结论被驳回', r.ok === false && r.message.includes('归属冲突'), r.message)
const f1 = svc.getState().forms.find((x) => x.formNo === 'YJ-2024-001')!
check('被驳回后原结论零改动', f1.conclusion === '合格')

// 2. 同单位但角色不对（项目经理）也不能审批
r = svc.approveConclusion(builderPm, 'YJ-2026-004', '合格', '2028-10-01')
check('建设单位非验收人角色被驳回', r.ok === false && r.message.includes('验收人'))

// 3. 监理只读
r = svc.confirmHandover(supervisor, 'YJ-2026-002')
check('监理无法执行接收确认', r.ok === false)

// 4. 正常审批留版本（审批人/时间系统生成）
r = svc.approveConclusion(builder, 'YJ-2026-004', '合格', '2028-10-01')
check('验收人审批通过', r.ok)
const f4 = svc.getState().forms.find((x) => x.formNo === 'YJ-2026-004')!
check('审批版本记录审批人/单位/时间', f4.conclusionVersions.length === 1 && f4.conclusionVersions[0].approverUnit === 'BUILDER')

// 5. 接收单位可确认接收
r = svc.confirmHandover(receiver, 'YJ-2026-004')
check('接收单位确认移交', r.ok)

// 6. 取严仲裁：建设判一般、接收判严重 → 严重生效、建设档降级提示
r = svc.recordDefectFinding(builder, 'YJ-2026-004', 'K0+500 测试点', '仲裁测试', '一般', '2028-09-01')
check('建设方首次判一般受控', r.ok)
r = svc.recordDefectFinding(receiver, 'YJ-2026-004', 'K0+500 测试点', '仲裁测试', '严重', '2028-09-01')
check('接收方判严重二次到达', r.ok)
const d = svc.getState().defects.find((x) => x.location === 'K0+500 测试点')!
check('取严：生效档=严重', d.adoptedLevel === '严重')
check('落锤方=接收单位（更严方）', d.adoptedBy === 'RECEIVER')
check('宽松档降级为提示', d.downgradedNote.includes('降级为提示'))
const todoNew = svc.getState().todos.find((t) => t.defectNo === d.defectNo)
check('严重缺陷生成受控待办', !!todoNew && todoNew.status === '待整改')

// 7. 同级分歧以接收单位为准
svc.recordDefectFinding(builder, 'YJ-2026-004', 'K0+600 同级点', '同级仲裁', '严重', '2028-09-01')
svc.recordDefectFinding(receiver, 'YJ-2026-004', 'K0+600 同级点', '同级仲裁', '严重', '2028-09-01')
const d2 = svc.getState().defects.find((x) => x.location === 'K0+600 同级点')!
check('同档分歧以接收单位落锤', d2.adoptedLevel === '严重' && d2.adoptedBy === 'RECEIVER')

// 8. 重复判定幂等
const beforeCount = svc.getState().todos.length
svc.recordDefectFinding(receiver, 'YJ-2026-004', 'K0+600 同级点', '同级仲裁', '严重', '2028-09-01')
check('同判定重复提交幂等', svc.getState().todos.length === beforeCount)

// 9. 待办到期自动转隐患 + 幂等
const st = svc.getState()
const overdueTodo = st.todos.find((t) => t.todoNo === 'TK-2024-001')!
check('种子含已逾期待办', overdueTodo.dueDate === '2026-09-30')
r = svc.runWarrantySweep('2026-10-06')
check('到期扫描转隐患', !!r.ok && !!((r.data as { created: string[] } | undefined)?.created.includes('YH-TK-2024-001')))
const h = svc.getState().hazards.find((x) => x.sourceTodoNo === 'TK-2024-001')!
check('隐患待整改', h.status === '待整改' && h.level === '一般')
const hazRow = listRows('hazard').find((x) => x['隐患编号'] === 'YH-TK-2024-001')
check('隐患整改模块新增一条待整改', !!hazRow && hazRow['整改状态'] === '待整改')
r = svc.runWarrantySweep('2026-10-06')
check('重复跑批不重复转隐患（幂等）', svc.getState().hazards.filter((x) => x.sourceTodoNo === 'TK-2024-001').length === 1)
check('待办状态置为已转隐患', svc.getState().todos.find((t) => t.todoNo === 'TK-2024-001')!.status === '已转隐患')

// 10. 非责任单位不能闭环待办
r = svc.closeTodo(receiver, 'TK-2026-007')
check('接收方不能闭环建设方待办', r.ok === false && r.message.includes('归属冲突'))

// 11. 同编号重复提交：同内容幂等、异内容驳回+待查
r = svc.submitForm(builder, {
  formNo: 'YJ-2024-001', tunnelName: '城西干线综合管廊', section: 'K0+000~K1+200 电力舱',
  acceptDate: '2024-09-20', handoverDate: '2024-10-08', warrantyEnd: '2026-10-07',
  conclusion: '合格', acceptor: '高建成', source: '正式移交', evidence: [],
})
check('同编号同内容幂等返回', r.ok && r.message.includes('去重'))
const formsCount = svc.getState().forms.length
r = svc.submitForm(builder, {
  formNo: 'YJ-2024-001', tunnelName: '城西干线综合管廊', section: 'K9+9+9 被篡改',
  acceptDate: '2024-09-20', handoverDate: '2024-10-08', warrantyEnd: '2026-10-07',
  conclusion: '合格', acceptor: '高建成', source: '正式移交', evidence: [],
})
check('同编号异内容驳回', r.ok === false && r.message.includes('内容不一致'))
check('驳回不新增单据', svc.getState().forms.length === formsCount)
check('冲突写入唯一待查台账', svc.getState().recon.some((x) => x.refNo === 'YJ-2024-001' && x.reason.includes('内容不一致')))

// 12. 补建单：凭证不足/伪造合格都被拒
r = svc.submitForm(receiver, {
  formNo: 'YJ-OLD-X', tunnelName: 'X', section: '', acceptDate: '', handoverDate: '',
  warrantyEnd: '2020-01-01', conclusion: '待补验（补建）', acceptor: '',
  source: '补建-事实移交', evidence: ['仅一类凭证'],
})
check('接收单位建档直接拒（归属）', r.ok === false && r.message.includes('归属冲突'))
r = svc.submitForm(builder, {
  formNo: 'YJ-OLD-X', tunnelName: 'X', section: '', acceptDate: '', handoverDate: '',
  warrantyEnd: '2020-01-01', conclusion: '待补验（补建）', acceptor: '',
  source: '补建-事实移交', evidence: ['仅一类凭证'],
})
check('补建凭证不足两类被拒', r.ok === false && r.message.includes('凭证'))
r = svc.submitForm(builder, {
  formNo: 'YJ-OLD-X', tunnelName: 'X', section: '', acceptDate: '', handoverDate: '',
  warrantyEnd: '2020-01-01', conclusion: '合格', acceptor: '',
  source: '补建-事实移交', evidence: ['凭证1', '凭证2'],
})
check('补建单禁止补造合格结论', r.ok === false && r.message.includes('禁止补造'))

// 13. 两阶段回填：骨架按验收日期、明细按巡检日期；缺项进清单、时序矛盾进待查
r = svc.runBackfill(receiver)
check('回填执行成功', r.ok && r.message.includes('回填完成'))
const g1 = svc.getState().gaps.find((g) => g.rawSummary.includes('绝缘值偏低'))
check('缺巡检日期/要求日的明细进缺项清单', !!g1 && g1.status === '待确认' && g1.missingFields.includes('巡检日期'))
check('缺项不计入有效缺陷之外的待办（不触发自动转隐患）',
  !svc.getState().todos.some((t) => t.title.includes('绝缘')))
const reconTime = svc.getState().recon.some((x) => x.reason.includes('巡检日期早于验收日期'))
check('巡检早于验收的时序矛盾转待查', reconTime)
check('正常巡检明细挂接为缺陷', svc.getState().defects.some((d) => d.description.includes('浮球开关')))

// 14. 缺项人工确认后重放生效
r = svc.resolveGap(receiver, g1!.id, 'confirmed', {
  formNo: 'YJ-2023-010', patrolDate: '2023-09-20', rectifyDue: '2025-06-17',
})
check('缺项补齐确认', r.ok)
check('确认后缺项状态更新', svc.getState().gaps.find((g) => g.id === g1!.id)!.status === '已确认')

// 15. 同步：断点续传，缺载荷不顶上、挂待查
let sr = svc.pushSync(6) // 确认完序号6后断线，7保持queued
check('断线发生在序号6确认后', sr.ok)
check('序号6已确认成功', svc.getState().outbox.find((e) => e.seq === 6)!.status === 'synced')
check('序号7未被跳过、保持queued', svc.getState().outbox.find((e) => e.seq === 7)!.status === 'queued')
sr = svc.pushSync(-1)
check('重连从游标+1的序号7原事件续传', sr.ok)
const ev7 = svc.getState().outbox.find((e) => e.seq === 7)!
check('序号7空载荷被拒收（不顶上）', ev7.status === 'failed')
check('空载荷事件挂待查', svc.getState().recon.some((x) => x.refNo.includes('QX-EXT-101') && x.reason.includes('缺载荷')))
check('同步游标停在6（7失败，后续不跳过）', svc.syncCursor() === 6)

// 16. 唯一口径：stats 读数与各列表一致
const s2 = svc.getState()
const st2 = svc.handoverStats('2026-10-06')
check('统计-待查未结与台账一致',
  st2.reconOpen === s2.recon.filter((x) => x.status === '待查').length)
check('统计-待办未闭环与列表一致',
  st2.todosOpen === s2.todos.filter((x) => x.status === '待整改' || x.status === '整改中').length)
check('统计-驳回数与审计一致',
  st2.rejectedWrites === s2.audits.filter((x) => x.action.startsWith('驳回')).length)
check('自动转隐患数=隐患模块真实转入记录数',
  st2.hazardsFromHandover === listRows('hazard')
    .filter((x) => String(x['来源'] ?? '').includes('移交台账自动转入')).length)

console.log(`\n全部 ${passed} 项断言通过`)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
