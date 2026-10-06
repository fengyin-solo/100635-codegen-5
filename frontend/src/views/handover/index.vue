<template>
  <section class="page" data-module="handover">
    <header class="page-head">
      <div>
        <h2>投运前验收与移交</h2>
        <p class="page-desc">
          认单位的移交台账：验收结论仅验收单位验收人可改，其他单位只读，越权代改一律驳回并写明归属冲突；
          责任期遗留问题受控待办、到期自动转隐患。规则依据《规则裁决书》。
        </p>
      </div>
      <div class="page-actions">
        <label class="actor-switch">
          当前身份
          <select :value="store.actor.id" @change="switchActor(($event.target as HTMLSelectElement).value)">
            <option v-for="a in ACTORS" :key="a.id" :value="a.id">
              {{ a.name }}｜{{ a.unitName }}｜{{ a.role }}
            </option>
          </select>
        </label>
        <button class="btn" type="button" @click="resetAll">重置演示数据</button>
      </div>
    </header>

    <p class="status-legend">
      当前操作人归属：<strong>{{ store.actor.unitName }}（{{ store.actor.unit }}）</strong>· 角色：{{ store.actor.role }}
      ｜模拟跑批日期
      <input v-model="asOf" class="date-input" type="date" />
      <button class="link" type="button" @click="sweep">执行到期扫描</button>
    </p>

    <div class="stat-row">
      <article v-for="card in statCards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value" :class="{ warn: card.warn }">{{ card.value }}</strong>
      </article>
    </div>

    <div v-if="banner" class="banner" :class="bannerOk ? 'ok' : 'err'">{{ banner }}</div>

    <nav class="tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        class="tab"
        :class="{ active: tab === t.key }"
        @click="tab = t.key"
      >
        {{ t.label }}
        <em v-if="t.badge" class="badge">{{ t.badge }}</em>
      </button>
    </nav>

    <!-- 移交单 -->
    <div v-if="tab === 'forms'">
      <form class="filter-bar" @submit.prevent>
        <label class="filter-item">
          <span>移交单编号</span>
          <input v-model="formFilter" placeholder="按移交单编号检索" />
        </label>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th>移交单编号</th><th>管廊/区段</th><th>验收单位</th><th>接收单位</th>
            <th>验收日期</th><th>缺陷责任期至</th><th>验收结论</th><th>验收人</th>
            <th>来源</th><th>状态</th><th>归属动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in filteredForms" :key="f.id">
            <td>{{ f.formNo }}</td>
            <td>{{ f.tunnelName }}<br /><small>{{ f.section }}</small></td>
            <td>{{ UNIT_NAMES[f.acceptUnit] }}</td>
            <td>{{ UNIT_NAMES[f.receiverUnit] }}</td>
            <td>{{ f.acceptDate || '—' }}</td>
            <td>{{ f.warrantyEnd || '—' }}</td>
            <td>{{ f.conclusion }}<small v-if="f.conclusionVersions.length">（v{{ f.conclusionVersions.length }}）</small></td>
            <td>{{ f.acceptor || '无签字' }}</td>
            <td>{{ f.source }}</td>
            <td>{{ f.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openApprove(f)">审批结论</button>
              <button class="link" type="button" @click="doConfirm(f)">接收确认</button>
              <button class="link" type="button" @click="openDefect(f)">登记缺陷判定</button>
              <button class="link" type="button" @click="showVersions(f)">审批留痕</button>
            </td>
          </tr>
        </tbody>
      </table>

      <h3 class="subhead">登记新移交单（建档归属：建设单位）</h3>
      <form class="editor" @submit.prevent="createForm">
        <input v-model="draft.formNo" placeholder="移交单编号，如 YJ-2026-010" required />
        <input v-model="draft.tunnelName" placeholder="管廊名称" required />
        <input v-model="draft.section" placeholder="区段/舱室" />
        <input v-model="draft.acceptDate" type="date" title="验收日期" />
        <input v-model="draft.handoverDate" type="date" title="移交日期" />
        <input v-model="draft.warrantyEnd" type="date" title="缺陷责任期截止日" />
        <select v-model="draft.conclusion">
          <option v-for="c in CONCLUSIONS" :key="c" :value="c">{{ c }}</option>
        </select>
        <label class="check"><input v-model="draft.isBackfill" type="checkbox" /> 补建-事实移交（凭证≥2类）</label>
        <button class="btn primary" type="submit">登记移交单</button>
        <small v-if="draft.isBackfill" class="hint">
          凭证：实际投运记录、接管巡检记录、资产/费用入账凭证（至少两类，逗号分隔）
          <input v-model="draft.evidenceText" placeholder="凭证1，凭证2" class="full" />
        </small>
      </form>
    </div>

    <!-- 缺陷判定 -->
    <div v-if="tab === 'defects'">
      <table class="data-table">
        <thead>
          <tr>
            <th>缺陷编号</th><th>移交单</th><th>部位/描述</th><th>建设方判定</th>
            <th>接收方判定</th><th>生效档（取严）</th><th>落锤方</th><th>宽松档提示</th><th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in state.defects" :key="d.id">
            <td>{{ d.defectNo }}</td>
            <td>{{ d.formNo }}</td>
            <td>{{ d.location }}<br /><small>{{ d.description }}</small></td>
            <td>{{ d.builderLevel || '未判' }}</td>
            <td>{{ d.receiverLevel || '未判' }}</td>
            <td><strong>{{ d.adoptedLevel || '—' }}</strong></td>
            <td>{{ d.adoptedBy === 'RECEIVER' ? '接收单位' : d.adoptedBy === 'BUILDER' ? '建设单位' : '—' }}</td>
            <td><small>{{ d.downgradedNote || '—' }}</small></td>
            <td>{{ d.status }}</td>
          </tr>
        </tbody>
      </table>
      <p class="hint">
        仲裁规则：以更严一档为准；同档以接收单位（运行方）为准；宽松一档降级为提示留档。
        首次判定即按该档受控，不等待对方。
      </p>
    </div>

    <!-- 受控待办 -->
    <div v-if="tab === 'todos'">
      <table class="data-table">
        <thead>
          <tr>
            <th>待办编号</th><th>移交单</th><th>内容</th><th>责任单位</th><th>责任人</th>
            <th>要求闭环日</th><th>状态</th><th>归属动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in state.todos" :key="t.id">
            <td>{{ t.todoNo }}</td>
            <td>{{ t.formNo }}</td>
            <td>{{ t.title }}</td>
            <td>{{ UNIT_NAMES[t.ownerUnit] ?? t.ownerUnit }}</td>
            <td>{{ t.ownerName }}</td>
            <td :class="{ overdue: isOverdue(t.dueDate) && t.status !== '已闭环' && t.status !== '已转隐患' }">
              {{ t.dueDate }}
            </td>
            <td>{{ t.status }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="closeTodo(t)">责任单位闭环</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 转入隐患 -->
    <div v-if="tab === 'hazards'">
      <table class="data-table">
        <thead>
          <tr><th>隐患编号</th><th>来源待办</th><th>部位</th><th>等级</th><th>整改措施</th><th>发现日期</th><th>状态</th></tr>
        </thead>
        <tbody>
          <tr v-for="h in state.hazards" :key="h.id">
            <td>{{ h.hazardNo }}</td><td>{{ h.sourceTodoNo }}</td><td>{{ h.location }}</td>
            <td>{{ h.level }}</td><td>{{ h.measure }}</td><td>{{ h.foundDate }}</td><td>{{ h.status }}</td>
          </tr>
        </tbody>
      </table>
      <p class="hint">
        上述记录已同时写入「隐患整改管理」模块（整改状态=待整改），可在该模块核验：条数由同一批写入产生，
        本页数字直接读隐患模块真实记录，两处一致。
      </p>
    </div>

    <!-- 待查台账 -->
    <div v-if="tab === 'recon'">
      <table class="data-table">
        <thead>
          <tr><th>类型</th><th>业务键</th><th>异常原因</th><th>说明</th><th>来源入口</th><th>状态</th><th>动作</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in state.recon" :key="r.id">
            <td>{{ r.refType }}</td><td>{{ r.refNo }}</td><td>{{ r.reason }}</td>
            <td><small style="white-space: pre-line">{{ r.detail }}</small></td>
            <td>{{ r.source }}{{ r.auto ? '·规则' : '·人工/同步' }}</td>
            <td>{{ r.status }}</td>
            <td class="row-actions">
              <template v-if="r.status === '待查'">
                <button class="link" type="button" @click="resolveReconItem(r, '已核实')">核实</button>
                <button class="link" type="button" @click="resolveReconItem(r, '已排除')">排除</button>
              </template>
              <span v-else>{{ r.resolvedAt.slice(0, 10) }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="hint">异常结论在所有入口只汇聚到这一本台账，概览卡片与看板角标读同一函数，不允许出现两个数。</p>
    </div>

    <!-- 缺项清单 + 回填/同步 -->
    <div v-if="tab === 'ops'">
      <h3 class="subhead">缺项清单（逐条人工确认；确认前不计有效条数、不触发转隐患）</h3>
      <table class="data-table">
        <thead>
          <tr><th>批次</th><th>原始摘要</th><th>缺失字段</th><th>建议归属单</th><th>状态</th><th>动作</th></tr>
        </thead>
        <tbody>
          <tr v-for="g in state.gaps" :key="g.id">
            <td>{{ g.batch }}</td><td>{{ g.rawSummary }}</td><td>{{ g.missingFields.join('、') }}</td>
            <td>{{ g.suggestedFormNo }}</td><td>{{ g.status }}<small v-if="g.resolvedNote">{{ g.resolvedNote }}</small></td>
            <td class="row-actions">
              <template v-if="g.status === '待确认'">
                <button class="link" type="button" @click="openGap(g)">补齐确认</button>
                <button class="link" type="button" @click="discardGap(g)">无法核实剔除</button>
              </template>
            </td>
          </tr>
          <tr v-if="!state.gaps.length"><td colspan="6" class="empty-state">暂无缺项（执行回填后生成）</td></tr>
        </tbody>
      </table>

      <h3 class="subhead">存量回填</h3>
      <p class="hint">
        阶段A：存量移交单按验收日期升序回填骨架；阶段B：往期巡检明细按巡检日期升序整体搬入挂接，
        缺字段/挂不到有效单的进缺项清单，巡检日期早于验收日期的转待查。
        队列现有骨架 {{ state.backfillQueue.length }} 单、往期明细 {{ state.legacyQueue.length }} 条。
      </p>
      <button class="btn primary" type="button" :disabled="state.backfillDone" @click="doBackfill">
        {{ state.backfillDone ? '回填已执行' : '执行两阶段回填' }}
      </button>

      <h3 class="subhead">同步（断线断点续传）</h3>
      <p class="hint">
        连续确认游标 = <strong>{{ stats.syncCursor }}</strong>，queued {{ stats.syncQueued }} 条。
        重连从游标+1 的<strong>原事件</strong>开始，缺载荷事件拒收并挂待查，绝不拿上一条值顶上。
      </p>
      <div class="row-actions">
        <button class="btn" type="button" @click="doSync(-1)">正常同步</button>
        <button class="btn" type="button" @click="doSync(6)">模拟在序号6后断线</button>
        <button class="btn" type="button" @click="doSync(-1)">再次同步（从断点续传）</button>
      </div>
      <table class="data-table">
        <thead><tr><th>序号</th><th>事件</th><th>业务键</th><th>载荷</th><th>状态</th></tr></thead>
        <tbody>
          <tr v-for="ev in [...state.outbox].sort((a, b) => a.seq - b.seq)" :key="ev.seq">
            <td>{{ ev.seq }}</td><td>{{ ev.type }}</td><td>{{ ev.businessKey }}</td>
            <td><small>{{ ev.payload === '' ? '（空——不允许顶上一条值）' : ev.payload }}</small></td>
            <td>{{ ev.status }}</td>
          </tr>
        </tbody>
      </table>

      <h3 class="subhead">越权驳回审计（只进审计，不进业务数据）</h3>
      <table class="data-table">
        <thead><tr><th>序号</th><th>操作人</th><th>单位</th><th>动作</th><th>对象</th><th>归属冲突说明</th><th>时间</th></tr></thead>
        <tbody>
          <tr v-for="a in state.audits" :key="a.seq">
            <td>{{ a.seq }}</td><td>{{ a.actor }}</td><td>{{ a.unit }}</td><td>{{ a.action }}</td>
            <td>{{ a.target }}</td><td><small>{{ a.reason }}</small></td><td>{{ a.at.slice(0, 16).replace('T', ' ') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 弹窗：审批结论 -->
    <div v-if="approveTarget" class="modal-mask" @click.self="approveTarget = null">
      <form class="modal" @submit.prevent="doApprove">
        <h3>审批验收结论 · {{ approveTarget.formNo }}</h3>
        <p class="hint">仅 {{ UNIT_NAMES[approveTarget.acceptUnit] }} 的验收人可提交；审批人与时间系统自动记录。</p>
        <select v-model="approveForm.conclusion">
          <option v-for="c in CONCLUSIONS" :key="c" :value="c">{{ c }}</option>
        </select>
        <input v-model="approveForm.warrantyEnd" type="date" title="缺陷责任期截止日" required />
        <div class="row-actions">
          <button class="btn primary" type="submit">提交审批</button>
          <button class="btn ghost" type="button" @click="approveTarget = null">取消</button>
        </div>
      </form>
    </div>

    <!-- 弹窗：登记缺陷判定 -->
    <div v-if="defectTarget" class="modal-mask" @click.self="defectTarget = null">
      <form class="modal" @submit.prevent="doRecordDefect">
        <h3>登记缺陷判定 · {{ defectTarget.formNo }}</h3>
        <p class="hint">建设/接收各写各的判定列；两次判定到达后自动取严仲裁。</p>
        <input v-model="defectForm.location" placeholder="缺陷部位" required />
        <input v-model="defectForm.description" placeholder="缺陷描述" required />
        <select v-model="defectForm.level">
          <option value="一般">一般</option><option value="严重">严重</option><option value="危急">危急</option>
        </select>
        <input v-model="defectForm.rectifyDue" type="date" title="整改要求日（留空取责任期截止日）" />
        <div class="row-actions">
          <button class="btn primary" type="submit">以当前身份提交判定</button>
          <button class="btn ghost" type="button" @click="defectTarget = null">取消</button>
        </div>
      </form>
    </div>

    <!-- 弹窗：缺项补齐 -->
    <div v-if="gapTarget" class="modal-mask" @click.self="gapTarget = null">
      <form class="modal" @submit.prevent="doConfirmGap">
        <h3>缺项人工确认</h3>
        <p class="hint">补齐字段后按当前规则引擎即时重放：绑定归属、去重、异常判定同新单。</p>
        <input v-model="gapForm.formNo" placeholder="归属/新建移交单编号" />
        <input v-model="gapForm.acceptDate" type="date" title="验收日期（补移交单时）" />
        <input v-model="gapForm.patrolDate" type="date" title="巡检日期（补往期缺陷时）" />
        <input v-model="gapForm.rectifyDue" type="date" title="整改要求日/责任期截止日" />
        <div class="row-actions">
          <button class="btn primary" type="submit">确认并重放</button>
          <button class="btn ghost" type="button" @click="gapTarget = null">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  closeTodo as svcCloseTodo,
  confirmHandover,
  getState,
  handoverStats,
  pushSync,
  recordDefectFinding,
  approveConclusion,
  rebuildAutoRecon,
  resetHandover,
  resolveGap,
  resolveRecon,
  runBackfill,
  runWarrantySweep,
  submitForm,
  today,
} from '@/api/handover-service'
import { ACTORS, useSessionStore } from '@/stores/session'
import {
  CONCLUSIONS,
  UNIT_NAMES,
  type ControlledTodo,
  type Defect,
  type GapItem,
  type HandoverForm,
  type HandoverState,
  type ReconItem,
} from '@/data/handover-types'

const store = useSessionStore()
const asOf = ref(today())
const tab = ref('forms')
const state = ref<HandoverState>(getState())
const stats = ref(handoverStats(asOf.value))
const banner = ref('')
const bannerOk = ref(true)
const formFilter = ref('')

const draft = reactive({
  formNo: '',
  tunnelName: '',
  section: '',
  acceptDate: '',
  handoverDate: '',
  warrantyEnd: '',
  conclusion: '合格',
  isBackfill: false,
  evidenceText: '',
})

const approveTarget = ref<HandoverForm | null>(null)
const approveForm = reactive({ conclusion: '合格', warrantyEnd: '' })
const defectTarget = ref<HandoverForm | null>(null)
const defectForm = reactive({ location: '', description: '', level: '严重', rectifyDue: '' })
const gapTarget = ref<GapItem | null>(null)
const gapForm = reactive({ formNo: '', acceptDate: '', patrolDate: '', rectifyDue: '' })

function refresh(msg?: string, ok = true) {
  state.value = getState()
  stats.value = handoverStats(asOf.value)
  if (msg) {
    banner.value = msg
    bannerOk.value = ok
  }
}

onMounted(() => {
  rebuildAutoRecon()
  // 首次打开演示：跑一次到期扫描，把已逾期未闭环的遗留问题自动转隐患
  if (!state.value.lastSweepAt && state.value.todos.some((t) => t.dueDate < asOf.value && t.status === '待整改')) {
    const r = runWarrantySweep(asOf.value)
    refresh(r.message, r.ok)
  } else {
    refresh()
  }
})

function switchActor(id: string) {
  const a = ACTORS.find((x) => x.id === id)
  if (a) {
    store.setActor(a)
    refresh(`已切换身份：${a.name}｜${a.unitName}｜${a.role}`)
  }
}

function isOverdue(d: string) {
  return d !== '' && d < asOf.value
}

const filteredForms = computed(() =>
  formFilter.value ? state.value.forms.filter((f) => f.formNo.includes(formFilter.value.trim())) : state.value.forms,
)

const statCards = computed(() => [
  { label: '移交单（有效/总数）', value: `${stats.value.formsValid}/${stats.value.formsTotal}`, warn: false },
  { label: '待验收/补建', value: stats.value.pendingAccept, warn: stats.value.pendingAccept > 0 },
  { label: '受控待办（未闭环）', value: stats.value.todosOpen, warn: false },
  { label: '到期未闭环', value: stats.value.todosOverdue, warn: stats.value.todosOverdue > 0 },
  { label: '已自动转隐患', value: stats.value.hazardsFromHandover, warn: stats.value.hazardsFromHandover > 0 },
  { label: '待查未结', value: stats.value.reconOpen, warn: stats.value.reconOpen > 0 },
  { label: '缺项待确认', value: stats.value.gapPending, warn: stats.value.gapPending > 0 },
  { label: '越权驳回累计', value: stats.value.rejectedWrites, warn: false },
])

const tabs = computed(() => [
  { key: 'forms', label: '移交台账', badge: 0 },
  { key: 'defects', label: '缺陷判定', badge: 0 },
  { key: 'todos', label: '受控待办', badge: stats.value.todosOpen },
  { key: 'hazards', label: '转入隐患', badge: stats.value.hazardsFromHandover },
  { key: 'recon', label: '待查台账', badge: stats.value.reconOpen },
  { key: 'ops', label: '回填/同步/审计', badge: stats.value.gapPending },
])

function notice(ok: boolean, message: string) {
  refresh(message, ok)
}

function createForm() {
  const r = submitForm(
    { id: store.actor.id, name: store.actor.name, unit: store.actor.unit, role: store.actor.role },
    {
      ...draft,
      source: draft.isBackfill ? '补建-事实移交' : '正式移交',
      acceptor: '',
      evidence: draft.isBackfill
        ? draft.evidenceText.split(/[，,]/).map((x) => x.trim()).filter(Boolean)
        : [],
    },
  )
  notice(r.ok, r.message)
}

function openApprove(f: HandoverForm) {
  approveTarget.value = f
  approveForm.conclusion = f.conclusion
  approveForm.warrantyEnd = f.warrantyEnd
}

function doApprove() {
  if (!approveTarget.value) return
  const r = approveConclusion(
    { id: store.actor.id, name: store.actor.name, unit: store.actor.unit, role: store.actor.role },
    approveTarget.value.formNo,
    approveForm.conclusion,
    approveForm.warrantyEnd,
  )
  approveTarget.value = null
  notice(r.ok, r.message)
}

function doConfirm(f: HandoverForm) {
  const r = confirmHandover(
    { id: store.actor.id, name: store.actor.name, unit: store.actor.unit, role: store.actor.role },
    f.formNo,
  )
  notice(r.ok, r.message)
}

function openDefect(f: HandoverForm) {
  defectTarget.value = f
  defectForm.location = ''
  defectForm.description = ''
  defectForm.level = '严重'
  defectForm.rectifyDue = ''
}

function doRecordDefect() {
  if (!defectTarget.value) return
  const r = recordDefectFinding(
    { id: store.actor.id, name: store.actor.name, unit: store.actor.unit, role: store.actor.role },
    defectTarget.value.formNo,
    defectForm.location,
    defectForm.description,
    defectForm.level,
    defectForm.rectifyDue,
  )
  defectTarget.value = null
  notice(r.ok, r.message)
}

function showVersions(f: HandoverForm) {
  if (!f.conclusionVersions.length) {
    notice(false, `${f.formNo} 尚无审批版本（无签字记录）`)
    return
  }
  const text = f.conclusionVersions
    .map(
      (v, i) =>
        `v${i + 1} 结论=${v.conclusion}｜审批人=${v.approver}｜单位=${v.approverUnit}｜时间=${v.approvedAt}`,
    )
    .join('\n')
  notice(true, `${f.formNo} 审批留痕（不可改版本）：\n${text}`)
}

function closeTodo(t: ControlledTodo) {
  const r = svcCloseTodo(
    { id: store.actor.id, name: store.actor.name, unit: store.actor.unit, role: store.actor.role },
    t.todoNo,
  )
  notice(r.ok, r.message)
}

function resolveReconItem(r: ReconItem, verdict: '已核实' | '已排除') {
  const res = resolveRecon(
    { id: store.actor.id, name: store.actor.name, unit: store.actor.unit, role: store.actor.role },
    r.id,
    verdict,
    `${verdict}处理`,
  )
  notice(res.ok, res.message)
}

function openGap(g: GapItem) {
  gapTarget.value = g
  gapForm.formNo = g.suggestedFormNo
  gapForm.acceptDate = ''
  gapForm.patrolDate = ''
  gapForm.rectifyDue = ''
}

function doConfirmGap() {
  if (!gapTarget.value) return
  const r = resolveGap(
    { id: store.actor.id, name: store.actor.name, unit: store.actor.unit, role: store.actor.role },
    gapTarget.value.id,
    'confirmed',
    { ...gapForm },
  )
  gapTarget.value = null
  notice(r.ok, r.message)
}

function discardGap(g: GapItem) {
  const r = resolveGap(
    { id: store.actor.id, name: store.actor.name, unit: store.actor.unit, role: store.actor.role },
    g.id,
    'discard',
    { note: '人工核实无法确认' },
  )
  notice(r.ok, r.message)
}

function doBackfill() {
  const r = runBackfill({ id: store.actor.id, name: store.actor.name, unit: store.actor.unit, role: store.actor.role })
  notice(r.ok, r.message)
}

function sweep() {
  const r = runWarrantySweep(asOf.value)
  notice(r.ok, r.message)
}

function doSync(offlineAfter: number) {
  const r = pushSync(offlineAfter)
  notice(r.ok, `${r.message}\n${(r.data?.steps ?? []).map((x) => `#${x.seq} ${x.status}: ${x.message}`).join('\n')}`)
}

function resetAll() {
  resetHandover()
  refresh('演示数据已重置（自动待查项已按当前数据重算）')
}
</script>

<style scoped>
.actor-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.date-input {
  margin: 0 4px;
}
.warn {
  color: #c0392b;
}
.overdue {
  color: #c0392b;
  font-weight: 700;
}
.banner {
  margin: 8px 0;
  padding: 10px 12px;
  border-radius: 6px;
  white-space: pre-line;
  font-size: 13px;
}
.banner.ok {
  background: #eafaf1;
  border: 1px solid #27ae60;
  color: #1e8449;
}
.banner.err {
  background: #fdedec;
  border: 1px solid #c0392b;
  color: #922b21;
}
.tabs {
  display: flex;
  gap: 4px;
  margin: 12px 0;
  flex-wrap: wrap;
}
.tab {
  border: 1px solid #d6dde5;
  background: #fff;
  padding: 6px 14px;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
  position: relative;
}
.tab.active {
  background: #1f6fb2;
  color: #fff;
  border-color: #1f6fb2;
}
.badge {
  font-style: normal;
  background: #c0392b;
  color: #fff;
  border-radius: 10px;
  padding: 0 7px;
  margin-left: 6px;
  font-size: 12px;
}
.subhead {
  margin: 18px 0 8px;
  font-size: 15px;
}
.editor {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  margin-top: 8px;
  padding: 12px;
  border: 1px dashed #b8c4d0;
  border-radius: 6px;
}
.editor .full,
.modal .full {
  width: 100%;
}
.check {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.hint {
  color: #5d6d7e;
  font-size: 12px;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #fff;
  border-radius: 8px;
  padding: 18px 20px;
  width: 420px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
</style>
