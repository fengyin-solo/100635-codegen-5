// 端到端冒烟：在 Node 里 shim 浏览器存储，直接驱动受控台账服务，验证关键裁决。
import { build } from 'esbuild'
import { writeFileSync, mkdirSync } from 'node:fs'

const testSource = `
const mem = new Map()
globalThis.window = { localStorage: {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
} }
import {
  switchIdentity, submitForm, setConclusion, updateDefectStatus, closeDefect,
  importLegacy, handoverStats, listForms, listTodos, listVerifies, listOutbox,
  listAudits, setOffline, syncNow, armNextSyncFailure, resolveVerify, sweepOverdue,
} from '@/api/handover-service'
import { handoverDB } from '@/data/handover-store'
import { listRows } from '@/data/local-store'

let pass = 0, fail = 0
function assert(cond, msg) {
  if (cond) { pass++; console.log('PASS', msg) }
  else { fail++; console.log('FAIL', msg) }
}

const CONS = { unit: 'CONS', person: '陈建设' }
const RECV = { unit: 'RECV', person: '高接管' }
const SUPV = { unit: 'SUPV', person: '程监理' }
const REGU = { unit: 'REGU', person: '管科长' }

// 1. 建设单位提交，接收单位/监理不能提交
switchIdentity(CONS)
let r = submitForm({ handoverNo: 'YJ-TEST-01', tunnelName: '测试管廊', section: 'S1', consUnit: '建', recvUnit: '收' })
assert(r.ok, '建设单位可提交移交单')
r = submitForm({ handoverNo: 'YJ-TEST-01', tunnelName: '测试管廊', section: 'S1', consUnit: '建', recvUnit: '收' })
assert(!r.ok && r.message.includes('去重'), '同编号反复提交按去重拒绝写入')
switchIdentity(RECV)
r = submitForm({ handoverNo: 'YJ-TEST-02', tunnelName: 'X', section: 'X', consUnit: '建', recvUnit: '收' })
assert(!r.ok && r.message.includes('驳回'), '接收单位不能提交移交单（建设单位动作）')
switchIdentity(SUPV)
r = submitForm({ handoverNo: 'YJ-TEST-03', tunnelName: 'X', section: 'X', consUnit: '建', recvUnit: '收' })
assert(!r.ok, '监理单位只读，提交被拒')

// 2. 只有接收单位能判结论；建设单位代改驳回且写待查+审计
const form = listForms().find(f => f.handoverNo === 'YJ-TEST-01')
switchIdentity(CONS)
r = setConclusion({ formId: form.id, conclusion: '合格', acceptDate: '2026-05-01', liabilityMonths: 12, defects: [] })
assert(!r.ok && r.message.includes('归属冲突'), '建设单位改结论：驳回并写明归属冲突')
assert(listVerifies().some(v => v.kind === '越权驳回待查' && v.handoverNo === 'YJ-TEST-01'), '越权驳回回写待查台账')
assert(listAudits().some(a => a.rejected && a.handoverNo === 'YJ-TEST-01'), '越权驳回写审计留痕')
assert(handoverStats().conflictsRejected >= 1, '越权驳回计数 >= 1')

switchIdentity(SUPV)
r = setConclusion({ formId: form.id, conclusion: '合格', acceptDate: '2026-05-01', liabilityMonths: 12, defects: [] })
assert(!r.ok, '监理改结论同样驳回（其他单位只读）')

// 3. 接收单位判有条件合格，两方判定打架取更严，宽松档留提示
switchIdentity(RECV)
r = setConclusion({
  formId: form.id, conclusion: '有条件合格', acceptDate: '2026-05-01', liabilityMonths: 1,
  defects: [
    { location: 'P1', desc: '缺陷A', consSeverity: '轻微', recvSeverity: '严重' },
    { location: 'P2', desc: '缺陷B', consSeverity: '一般', recvSeverity: '轻微' },
  ],
})
assert(r.ok, '接收单位判定成功，验收人/时间锁定')
const f2 = listForms().find(f => f.handoverNo === 'YJ-TEST-01')
assert(f2.acceptor === '高接管' && f2.acceptDate === '2026-05-01', '验收人与验收时间随结论锁定')
const d1 = f2.defects.find(d => d.location === 'P1')
const d2 = f2.defects.find(d => d.location === 'P2')
assert(d1.effectiveSeverity === '严重' && d1.hint.includes('轻微'), '轻/重冲突取严重，轻微降级为提示')
assert(d2.effectiveSeverity === '一般' && d2.hint.includes('轻微'), '一般/轻微冲突取一般（更严档）')
assert(listTodos().filter(t => t.handoverNo === 'YJ-TEST-01').length === 2, '2 条遗留缺陷生成 2 条受控待办')

// 4. 建设单位登记整改，接收单位才能闭环
switchIdentity(CONS)
r = updateDefectStatus(f2.id, d1.id, '整改中')
assert(r.ok, '建设单位可登记整改')
r = closeDefect(f2.id, d1.id)
assert(!r.ok && r.message.includes('闭环确认归接收单位'), '建设单位不能闭环（闭环归接收单位）')
switchIdentity(RECV)
r = closeDefect(f2.id, d1.id)
assert(r.ok, '接收单位闭环确认')

// 5. 到期未闭环自动转隐患，只转一次（setConclusion 提交时已跑过一次扫描）
const beforeH = listRows('hazard').length
const sweepA = sweepOverdue()
const conv1 = sweepA.converted.length
const conv2 = sweepOverdue().converted.length
const afterH = listRows('hazard').length
assert(conv1 === 0, '首次扫描（在判定时）已转，本次扫描无新增，不重复转')
assert(conv2 === 0, '转隐患幂等：再次扫描不重复转')
assert(afterH - beforeH === conv1, '隐患整改台账实际新增条数一致')
assert(listRows('hazard').some(h => String(h['隐患部位']).includes('YJ-TEST-01')), '隐患整改那边多出一条待整改（责任期届满未闭环）')
assert(listTodos().find(t => t.defectId === f2.defects.find(d => d.location === 'P2').id)?.status === '已转隐患', '未闭环待办状态为已转隐患')
assert(listTodos().find(t => t.defectId === f2.defects.find(d => d.location === 'P1').id)?.status === '已闭环', '已闭环待办不转隐患')

// 6. 不合格结论回写待查
switchIdentity(CONS)
submitForm({ handoverNo: 'YJ-TEST-04', tunnelName: 'B', section: 'B', consUnit: '建', recvUnit: '收' })
const f4 = listForms().find(f => f.handoverNo === 'YJ-TEST-04')
switchIdentity(RECV)
setConclusion({ formId: f4.id, conclusion: '不合格', acceptDate: '2026-08-01', liabilityMonths: 6, defects: [{ location: 'X', desc: 'Y', consSeverity: '严重', recvSeverity: '严重' }] })
assert(listVerifies().some(v => v.kind === '结论异常待查' && v.handoverNo === 'YJ-TEST-04'), '不合格结论回写待查台账')
assert(f4.status === '已驳回' || listForms().find(f=>f.handoverNo==='YJ-TEST-04').status === '已驳回', '不合格单据状态为已驳回')

// 7. 待查确认归接收单位
switchIdentity(CONS)
const vId = listVerifies().find(v => v.status === '待确认')?.id
r = vId ? resolveVerify(vId, 'x') : { ok: false }
assert(!r.ok, '建设单位不能确认待查台账')

// 8. 存量补录：正式回填/事实接管/缺项挂起/无凭证拒绝/重复跳过
switchIdentity(CONS)
const legacy = [
  { handoverNo: 'YJ-LG-01', tunnelName: '正式回填', section: 's', consUnit: '建', recvUnit: '收', acceptDate: '2021-03-01', acceptor: '王', liabilityMonths: 12, conclusion: '合格' },
  { handoverNo: 'YJ-LG-02', tunnelName: '事实接管', section: 's', consUnit: '建', recvUnit: '收', takeoverDate: '2018-06-01', takeoverEvidence: '2018-06 巡检记录' },
  { handoverNo: 'YJ-LG-03', tunnelName: '缺验收人', section: 's', consUnit: '建', recvUnit: '收', acceptDate: '2022-01-01', liabilityMonths: 12 },
  { handoverNo: 'YJ-LG-04', tunnelName: '无凭证', section: 's', consUnit: '建', recvUnit: '收' },
  { handoverNo: 'YJ-LG-01', tunnelName: '重复', section: 's', consUnit: '建', recvUnit: '收', acceptDate: '2021-03-01', acceptor: '王', liabilityMonths: 12 },
]
const rep = importLegacy(legacy)
assert(rep.ok && rep.data.imported === 1, '正式建档 1 张（按验收日回填）')
assert(rep.data.pending === 2, '事实接管 + 缺项各 1 张挂待确认')
assert(rep.data.blocked === 1, '无凭证不予补建 1 张')
assert(rep.data.duplicates === 1, '重复编号跳过 1 张')
const lg2 = listForms().find(f => f.handoverNo === 'YJ-LG-02')
assert(lg2.factTakeover && lg2.takeoverDate === '2018-06-01' && lg2.conclusion === '待验收', '事实接管补建：接管日取最早痕迹，结论从严挂待验收')
assert(listVerifies().some(v => v.handoverNo === 'YJ-LG-04' && v.kind === '缺项待确认'), '无凭证单据进待查挂起')

// 9. 断线只排队，恢复从下一条未同步继续，失败不顶替
setOffline(true)
submitForm({ handoverNo: 'YJ-SYNC-1', tunnelName: 'S', section: 's', consUnit: '建', recvUnit: '收' })
r = syncNow()
assert(!r.ok && r.message.includes('断线'), '断线期间同步被拒，写入仅排队')
setOffline(false)
armNextSyncFailure()
r = syncNow()
assert(!r.ok && r.data.failed, '恢复后第一条即失败：保留原值')
const failedSeq = r.data.failed.seq
const beforeSync = listOutbox().find(o => o.seq === failedSeq)
assert(beforeSync.status === '同步失败', '失败项保留排队原值，不拿上次值顶替')
r = syncNow()
assert(r.ok, '再次同步从失败项（序号最小未完成项）续传成功')
assert(listOutbox().find(o => o.seq === failedSeq).status === '已同步', '原失败项已补传成功（走这一条本身，不拿上一次的值顶上）')
while (listOutbox().some((o) => o.status === '待同步')) {
  const rr = syncNow()
  if (!rr.ok) throw new Error('续传意外失败：' + rr.message)
}
assert(listOutbox().filter(o => o.status === '待同步').length === 0, '逐条续传至队列清空，已同步项不重放')

// 10. 统计一致性：台账统计与镜像行数同源
const st = handoverStats()
assert(st.total === listForms().length, '统计总数 = 台账条数')
assert(st.pendingVerify === listVerifies('待确认').length, '看板待查数 = 待查台账条数（同一个数）')
assert(st.hazardsGenerated === listTodos().filter(t => t.status === '已转隐患').length, '已转隐患数一致')

console.log('\\nRESULT pass=' + pass + ' fail=' + fail)
if (fail) process.exit(1)
`

mkdirSync('/tmp/hs-test', { recursive: true })
writeFileSync('/tmp/hs-test/test.ts', testSource)

await build({
  entryPoints: ['/tmp/hs-test/test.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: '/tmp/hs-test/out.mjs',
  alias: { '@': new URL('./src', import.meta.url).pathname },
})
