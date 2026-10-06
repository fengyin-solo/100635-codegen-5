<template>
  <section class="page" data-module="handover">
    <header class="page-head">
      <div>
        <h2>投运前验收移交</h2>
        <p class="page-desc">认单位的验收移交台账：每张移交单登记接收单位、验收结论与缺陷责任期；只有本单位验收人能动结论，越权代改一律驳回。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="showRules = !showRules">规则与裁决</button>
        <button class="btn" type="button" @click="openLegacy">存量补录</button>
        <button class="btn primary" type="button" @click="openCreate">登记移交单</button>
      </div>
    </header>

    <!-- 身份条：台账"认单位"，一切动作都以当前单位归属判定 -->
    <div class="identity-bar">
      <span class="identity-label">当前身份</span>
      <select v-model="unitSelect" @change="onIdentityChange">
        <option v-for="opt in unitOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
      </select>
      <input v-model="personInput" class="person-input" placeholder="操作人姓名" @change="onIdentityChange" />
      <span class="identity-hint">归属：{{ currentUnitName }} · 权限：{{ currentRoles }}</span>
    </div>

    <div v-if="banner" class="banner" :class="bannerOk ? 'ok' : 'err'">{{ banner }}</div>

    <div class="stat-row">
      <article class="stat-card"><span class="stat-label">移交单总数</span><strong class="stat-value">{{ stats.total }}</strong></article>
      <article class="stat-card"><span class="stat-label">待验收</span><strong class="stat-value">{{ stats.pendingAccept }}</strong></article>
      <article class="stat-card"><span class="stat-label">已驳回</span><strong class="stat-value" :class="{ 'stat-alert': stats.rejected }">{{ stats.rejected }}</strong></article>
      <article class="stat-card"><span class="stat-label">受控待办（未闭环）</span><strong class="stat-value" :class="{ 'stat-alert': stats.openTodos }">{{ stats.openTodos }}</strong></article>
      <article class="stat-card"><span class="stat-label">已转隐患</span><strong class="stat-value">{{ stats.hazardsGenerated }}</strong></article>
      <article class="stat-card"><span class="stat-label">待查台账</span><strong class="stat-value" :class="{ 'stat-alert': stats.pendingVerify }">{{ stats.pendingVerify }}</strong></article>
      <article class="stat-card"><span class="stat-label">越权驳回</span><strong class="stat-value" :class="{ 'stat-alert': stats.conflictsRejected }">{{ stats.conflictsRejected }}</strong></article>
    </div>
    <p class="single-source">以上数字与「运营概览」看板同源同时刻计算，不存在第二个数。</p>

    <div class="tabs">
      <button v-for="tab in tabs" :key="tab.key" class="tab" :class="{ active: activeTab === tab.key }" type="button" @click="activeTab = tab.key">
        {{ tab.label }}<span v-if="tab.badge" class="tab-badge">{{ tab.badge }}</span>
      </button>
    </div>

    <!-- 台账 -->
    <div v-show="activeTab === 'forms'">
      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item"><span>检索</span><input v-model="keyword" placeholder="按移交单编号/管廊/单位检索" /></label>
        <button class="btn" type="submit">查询</button>
      </form>
      <table class="data-table">
        <thead>
          <tr>
            <th>移交单编号</th><th>管廊/区段</th><th>建设单位</th><th>接收单位（归属）</th>
            <th>验收人/日期</th><th>验收结论</th><th>缺陷责任期</th><th>遗留缺陷</th><th>状态</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="form in forms" :key="form.id">
            <td>
              {{ form.handoverNo }}
              <span v-if="form.factTakeover" class="tag tag-warn">事实接管补建</span>
              <span v-else-if="form.backfilled" class="tag">存量回填</span>
            </td>
            <td>{{ form.tunnelName }}<br /><span class="muted">{{ form.section }}</span></td>
            <td>{{ form.consUnit }}</td>
            <td><strong>{{ form.recvUnit }}</strong></td>
            <td>
              <template v-if="form.acceptor">{{ form.acceptor }}<br /><span class="muted">{{ form.acceptDate }}</span></template>
              <span v-else class="muted">待验收</span>
            </td>
            <td><span class="conclusion" :class="conclusionClass(form.conclusion)">{{ form.conclusion }}</span></td>
            <td>
              <template v-if="form.liabilityEnd">{{ form.liabilityStart }} ~ {{ form.liabilityEnd }}<br /><span class="muted">{{ form.liabilityMonths }}个月</span></template>
              <span v-else class="muted">待确认</span>
            </td>
            <td>
              <span v-if="!form.defects.length" class="muted">无</span>
              <div v-for="d in form.defects" :key="d.id" class="defect-line">
                <span class="sev" :class="`sev-${d.effectiveSeverity}`">{{ d.effectiveSeverity }}</span>
                {{ d.location }}
                <span class="tag" :class="d.status === '已闭环' ? 'tag-ok' : ''">{{ d.status }}</span>
                <span v-if="d.hazardNo" class="tag tag-alert">已转{{ d.hazardNo }}</span>
                <button class="link" type="button" @click="toggleDefects(form.id)">详情</button>
              </div>
            </td>
            <td><span class="status-pill" :class="`st-${form.status}`">{{ form.status }}</span></td>
            <td class="row-actions">
              <button v-if="form.conclusion === '待验收'" class="link" type="button" @click="openConclusion(form)">判定结论</button>
              <button class="link" type="button" @click="toggleDefects(form.id)">缺陷</button>
              <button class="link" type="button" @click="openHistory(form)">流水</button>
            </td>
          </tr>
          <tr v-if="!forms.length"><td colspan="10" class="empty-state">暂无移交单</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 受控待办 -->
    <div v-show="activeTab === 'todos'">
      <table class="data-table">
        <thead><tr><th>待办号</th><th>移交单</th><th>缺陷</th><th>等级</th><th>责任单位</th><th>跟进单位</th><th>责任期截止</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="todo in todos" :key="todo.id">
            <td>{{ todo.id }}</td>
            <td>{{ todo.handoverNo }}</td>
            <td>{{ todo.title }}</td>
            <td><span class="sev" :class="`sev-${todo.severity}`">{{ todo.severity }}</span></td>
            <td>{{ unitNameOf(todo.responsibleUnit) }}</td>
            <td>{{ unitNameOf(todo.followUnit) }}</td>
            <td><span :class="{ overdue: isOverdue(todo.dueDate) && todo.status !== '已闭环' && todo.status !== '已转隐患' }">{{ todo.dueDate }}</span></td>
            <td>
              <span class="status-pill" :class="todo.status === '已转隐患' ? 'st-已驳回' : todo.status === '已闭环' ? 'st-已移交' : ''">{{ todo.status }}</span>
              <span v-if="todo.hazardNo" class="tag tag-alert">{{ todo.hazardNo }}</span>
            </td>
            <td class="row-actions">
              <button v-if="todo.status === '待整改' || todo.status === '整改中'" class="link" type="button" @click="startFix(todo)">登记整改</button>
              <button v-if="todo.status === '整改中'" class="link" type="button" @click="closeTodo(todo)">闭环确认</button>
              <button class="link" type="button" @click="runSweep">检查到期</button>
            </td>
          </tr>
          <tr v-if="!todos.length"><td colspan="9" class="empty-state">暂无受控待办</td></tr>
        </tbody>
      </table>
      <p class="muted small">到期（责任期截止日已过）仍未闭环的待办自动转入隐患整改台账；转入幂等，只转一次。</p>
    </div>

    <!-- 待查台账 -->
    <div v-show="activeTab === 'verify'">
      <table class="data-table">
        <thead><tr><th>编号</th><th>类型</th><th>移交单</th><th>事项</th><th>缺失项</th><th>来源</th><th>归属</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="v in verifies" :key="v.id">
            <td>{{ v.id }}</td>
            <td><span class="tag tag-warn">{{ v.kind }}</span></td>
            <td>{{ v.handoverNo ?? '—' }}</td>
            <td style="max-width: 340px">{{ v.summary }}<div v-if="v.resolution" class="muted small">处理：{{ v.resolution }}（{{ v.resolvedAt }}）</div></td>
            <td><span v-for="f in v.missingFields" :key="f" class="tag tag-alert">{{ f }}</span><span v-if="!v.missingFields.length" class="muted">—</span></td>
            <td>{{ v.source }}</td>
            <td>{{ unitNameOf(v.ownerUnit) }}</td>
            <td>{{ v.status }}</td>
            <td class="row-actions">
              <template v-if="v.status === '待确认'">
                <button class="link" type="button" @click="resolveOne(v, false)">确认</button>
                <button class="link danger" type="button" @click="resolveOne(v, true)">驳回</button>
              </template>
              <span v-else class="muted">已处理</span>
            </td>
          </tr>
          <tr v-if="!verifies.length"><td colspan="9" class="empty-state">待查台账为空</td></tr>
        </tbody>
      </table>
      <p class="muted small">异常结论、越权驳回、缺项全部回写本台账；运营概览读同一份数据。</p>
    </div>

    <!-- 同步队列 -->
    <div v-show="activeTab === 'sync'">
      <div class="filter-bar">
        <button class="btn" :class="offline ? '' : 'primary'" type="button" @click="toggleOffline">{{ offline ? '恢复连接' : '模拟断线' }}</button>
        <button class="btn" type="button" :disabled="offline" @click="doSync">立即同步（从下一条未同步项继续）</button>
        <button class="btn ghost" type="button" @click="armFail">让下一条同步失败（演示不顶替）</button>
        <span class="muted">通道：<strong :class="offline ? 'error-text' : 'ok-text'">{{ offline ? '断线（只排队）' : '在线' }}</strong></span>
      </div>
      <table class="data-table">
        <thead><tr><th>序号</th><th>时间</th><th>模块</th><th>动作</th><th>内容</th><th>尝试</th><th>状态</th><th>错误</th></tr></thead>
        <tbody>
          <tr v-for="s in outbox" :key="s.seq">
            <td>{{ s.seq }}</td><td>{{ s.createdAt }}</td><td>{{ s.module }}</td><td>{{ s.op }}</td>
            <td class="muted small">{{ JSON.stringify(s.payload) }}</td><td>{{ s.attempts }}</td>
            <td><span class="status-pill" :class="s.status === '已同步' ? 'st-已移交' : s.status === '同步失败' ? 'st-已驳回' : ''">{{ s.status }}</span><span v-if="s.syncedAt" class="muted small"> {{ s.syncedAt }}</span></td>
            <td class="error-text small">{{ s.lastError ?? '' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 审计留痕 -->
    <div v-show="activeTab === 'audit'">
      <table class="data-table">
        <thead><tr><th>时间</th><th>操作人</th><th>单位</th><th>动作</th><th>移交单</th><th>说明</th></tr></thead>
        <tbody>
          <tr v-for="a in audits" :key="a.id" :class="{ 'row-rejected': a.rejected }">
            <td>{{ a.at }}</td><td>{{ a.actor }}</td><td>{{ unitNameOf(a.unit) }}</td><td>{{ a.action }}</td>
            <td>{{ a.handoverNo ?? '—' }}</td><td :class="a.rejected ? 'error-text' : ''">{{ a.message }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 规则与裁决 -->
    <div v-if="showRules" class="rules-panel">
      <h3>台账规则与裁决口径</h3>
      <div v-for="r in rules" :key="r.title" class="rule-item">
        <h4>{{ r.title }}</h4>
        <p>{{ r.body }}</p>
      </div>
    </div>

    <!-- 缺陷详情/操作抽屉（简表） -->
    <div v-if="defectForm" class="modal">
      <div class="modal-card modal-wide">
        <h3>遗留缺陷 · {{ defectForm.handoverNo }}（{{ defectForm.tunnelName }}）</h3>
        <table class="data-table">
          <thead><tr><th>部位</th><th>描述</th><th>建设单位判定</th><th>接收单位判定</th><th>有效判定与依据</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="d in defectForm.defects" :key="d.id">
              <td>{{ d.location }}</td><td>{{ d.desc }}</td>
              <td>{{ d.consSeverity ?? '未判' }}</td><td>{{ d.recvSeverity ?? '未判' }}</td>
              <td><span class="sev" :class="`sev-${d.effectiveSeverity}`">{{ d.effectiveSeverity }}</span><div class="muted small">{{ d.basis }}</div><div v-if="d.hint" class="hint-text small">{{ d.hint }}</div></td>
              <td>{{ d.status }}<div v-if="d.hazardNo" class="tag tag-alert">{{ d.hazardNo }}</div></td>
              <td class="row-actions">
                <button v-if="d.status !== '已闭环'" class="link" type="button" @click="startFixByDefect(defectForm, d)">登记整改</button>
                <button v-if="d.status !== '已闭环'" class="link" type="button" @click="closeByDefect(defectForm, d)">闭环确认</button>
                <span v-else class="tag tag-ok">已闭环</span>
              </td>
            </tr>
            <tr v-if="!defectForm.defects.length"><td colspan="7" class="empty-state">无遗留缺陷</td></tr>
          </tbody>
        </table>
        <div class="modal-foot"><button class="btn" type="button" @click="defectForm = null">关闭</button></div>
      </div>
    </div>

    <!-- 流水 -->
    <div v-if="historyForm" class="modal">
      <div class="modal-card">
        <h3>归属流水 · {{ historyForm.handoverNo }}</h3>
        <ul class="history-list">
          <li v-for="(e, i) in historyForm.history" :key="i" :class="{ rejected: e.rejected }">
            <strong>{{ e.at }} {{ e.actor }}（{{ unitNameOf(e.unit) }}）· {{ e.action }}</strong>
            <p>{{ e.detail }}</p>
          </li>
        </ul>
        <div class="modal-foot"><button class="btn" type="button" @click="historyForm = null">关闭</button></div>
      </div>
    </div>

    <!-- 登记移交单 -->
    <div v-if="createOpen" class="modal">
      <div class="modal-card">
        <h3>登记移交单（建设单位）</h3>
        <div class="form-grid">
          <label><span>移交单编号 *</span><input v-model="createForm.handoverNo" placeholder="YJ-2026-0xx" /></label>
          <label><span>管廊名称 *</span><input v-model="createForm.tunnelName" /></label>
          <label><span>区段 *</span><input v-model="createForm.section" /></label>
          <label><span>建设单位 *</span><input v-model="createForm.consUnit" /></label>
          <label><span>接收单位 *</span><input v-model="createForm.recvUnit" /></label>
          <label><span>约定责任期（月，可验收时再定）</span><input v-model.number="createForm.liabilityMonths" type="number" min="1" /></label>
        </div>
        <p class="muted small">提交后状态为"待验收"；验收结论只能由接收单位验收人判定，同编号重复提交直接拒绝写入。</p>
        <div class="modal-foot">
          <button class="btn" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交移交单</button>
        </div>
      </div>
    </div>

    <!-- 判定验收结论 -->
    <div v-if="conclusionTarget" class="modal">
      <div class="modal-card modal-wide">
        <h3>判定验收结论 · {{ conclusionTarget.handoverNo }}</h3>
        <p class="muted small">仅接收单位（{{ conclusionTarget.recvUnit }}）的验收人可操作；验收人与验收时间提交后锁定。</p>
        <div class="form-grid">
          <label><span>验收结论 *</span>
            <select v-model="conclusionDraft.conclusion">
              <option value="合格">合格</option><option value="有条件合格">有条件合格</option><option value="不合格">不合格</option>
            </select>
          </label>
          <label><span>验收日期 *</span><input v-model="conclusionDraft.acceptDate" type="date" /></label>
          <label><span>缺陷责任期（月）*</span><input v-model.number="conclusionDraft.liabilityMonths" type="number" min="1" /></label>
        </div>
        <h4>遗留缺陷（两方分别判定，打架取更严一档）</h4>
        <table class="data-table">
          <thead><tr><th>部位</th><th>描述</th><th>建设单位判定</th><th>接收单位判定</th><th>预览有效判定</th><th></th></tr></thead>
          <tbody>
            <tr v-for="(d, i) in conclusionDraft.defects" :key="i">
              <td><input v-model="d.location" /></td>
              <td><input v-model="d.desc" /></td>
              <td><select v-model="d.consSeverity"><option :value="undefined">未判</option><option>严重</option><option>一般</option><option>轻微</option></select></td>
              <td><select v-model="d.recvSeverity"><option :value="undefined">未判</option><option>严重</option><option>一般</option><option>轻微</option></select></td>
              <td><span class="sev" :class="`sev-${previewSeverity(d)}`">{{ previewSeverity(d) }}</span></td>
              <td><button class="link danger" type="button" @click="conclusionDraft.defects.splice(i, 1)">删除</button></td>
            </tr>
          </tbody>
        </table>
        <button class="btn" type="button" @click="addDefectRow">增加缺陷</button>
        <div class="modal-foot">
          <button class="btn" type="button" @click="conclusionTarget = null">取消</button>
          <button class="btn primary" type="button" @click="submitConclusion">提交判定（锁定验收人/时间）</button>
        </div>
      </div>
    </div>

    <!-- 存量补录 -->
    <div v-if="legacyOpen" class="modal">
      <div class="modal-card modal-wide">
        <h3>存量移交单补录（按验收日期整体搬入）</h3>
        <p class="muted small">每行一条 JSON，按验收日期（无验收日按事实接管日）从早到晚入库；缺书面交接且有接管痕迹的填 takeoverDate/takeoverEvidence 按"事实接管"补建；无凭证的直接挂起，缺项逐条进待查。</p>
        <textarea v-model="legacyText" class="legacy-area" :placeholder="legacyExample"></textarea>
        <div v-if="legacyReport" class="legacy-report">
          <p>{{ legacyMessage }}</p>
          <ul>
            <li v-for="(it, i) in legacyReport.items" :key="i"><span class="tag" :class="reportTagClass(it.kind)">{{ it.kind }}</span> {{ it.handoverNo }}：{{ it.message }}</li>
          </ul>
        </div>
        <div class="modal-foot">
          <button class="btn" type="button" @click="legacyOpen = false">关闭</button>
          <button class="btn ghost" type="button" @click="legacyText = ''">清空</button>
          <button class="btn primary" type="button" @click="submitLegacy">整批补录</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  armNextSyncFailure,
  closeDefect,
  currentIdentity,
  handoverStats,
  importLegacy,
  listAudits,
  listForms,
  listOutbox,
  listTodos,
  listVerifies,
  resolveVerify,
  setConclusion,
  setOffline,
  submitForm,
  sweepOverdue,
  switchIdentity,
  syncNow,
  updateDefectStatus,
  type LegacyReport,
  type LegacyRow,
} from '@/api/handover-service'
import { RULES, stricterSeverity, UNITS, UNIT_OPTIONS } from '@/data/handover-rules'
import { handoverDB } from '@/data/handover-store'
import { useSessionStore } from '@/stores/session'
import type {
  AuditLog,
  Conclusion,
  ControlledTodo,
  Defect,
  DefectInput,
  HandoverForm,
  HandoverStats,
  Severity,
  SyncItem,
  UnitId,
  VerifyEntry,
} from '@/data/handover-types'

const rules = RULES
const unitOptions = UNIT_OPTIONS
const defaultPerson: Record<UnitId, string> = { CONS: '陈建设', RECV: '高接管', SUPV: '程监理', REGU: '管科长' }
const sessionStore = useSessionStore()

const keyword = ref('')
const forms = ref<HandoverForm[]>([])
const todos = ref<ControlledTodo[]>([])
const verifies = ref<VerifyEntry[]>([])
const audits = ref<AuditLog[]>([])
const outbox = ref<SyncItem[]>([])
const offline = ref(false)
const stats = ref<HandoverStats>({
  total: 0, pendingAccept: 0, accepted: 0, rejected: 0, openDefects: 0, openTodos: 0,
  overdueTodos: 0, hazardsGenerated: 0, pendingVerify: 0, conflictsRejected: 0, backfilled: 0,
})

const activeTab = ref('forms')
const showRules = ref(false)
const banner = ref('')
const bannerOk = ref(true)
const defectForm = ref<HandoverForm | null>(null)
const historyForm = ref<HandoverForm | null>(null)

function unitNameOf(unit: UnitId): string {
  return UNITS[unit].short
}

const unitSelect = ref<UnitId>(currentIdentity().unit)
const personInput = ref(currentIdentity().person)
const currentUnitName = computed(() => UNITS[unitSelect.value].name)
const currentRoles = computed(() => UNITS[unitSelect.value].roles.join('、'))

function onIdentityChange() {
  const person = personInput.value.trim() || defaultPerson[unitSelect.value]
  personInput.value = person
  switchIdentity({ unit: unitSelect.value, person })
  sessionStore.setIdentity(unitSelect.value, person)
  flash(`已切换为 ${UNITS[unitSelect.value].short}（${person}），台账按该单位归属判定读写权限。`, true)
}

const tabs = computed(() => [
  { key: 'forms', label: '移交台账', badge: 0 },
  { key: 'todos', label: '受控待办', badge: stats.value.openTodos },
  { key: 'verify', label: '待查台账', badge: stats.value.pendingVerify },
  { key: 'sync', label: '同步队列', badge: outbox.value.filter((s) => s.status === '待同步').length },
  { key: 'audit', label: '审计留痕', badge: 0 },
])

function flash(message: string, ok = false) {
  banner.value = message
  bannerOk.value = ok
}

function reload() {
  // 每次读之前先做到期扫描（幂等），保证看板与台账同时刻同口径。
  sweepOverdue()
  forms.value = listForms(keyword.value)
  todos.value = listTodos()
  verifies.value = listVerifies()
  audits.value = listAudits()
  outbox.value = listOutbox()
  offline.value = handoverDB().offline
  stats.value = handoverStats()
}

onMounted(() => {
  switchIdentity({ unit: unitSelect.value, person: personInput.value })
  sessionStore.setIdentity(unitSelect.value, personInput.value)
  reload()
})

function isOverdue(date: string): boolean {
  return date < new Date().toISOString().slice(0, 10)
}

function conclusionClass(c: Conclusion): string {
  return c === '不合格' ? 'con-bad' : c === '有条件合格' ? 'con-warn' : c === '待验收' ? 'con-idle' : 'con-ok'
}

function openHistory(form: HandoverForm) {
  historyForm.value = form
}

function toggleDefects(formId: number) {
  const form = forms.value.find((f) => f.id === formId) ?? null
  defectForm.value = form
}

function startFix(todo: ControlledTodo) {
  const form = forms.value.find((f) => f.handoverNo === todo.handoverNo)
  if (!form) return
  const result = updateDefectStatus(form.id, todo.defectId, '整改中')
  flash(result.message, result.ok)
  reload()
}

function startFixByDefect(form: HandoverForm, defect: Defect) {
  const result = updateDefectStatus(form.id, defect.id, '整改中')
  flash(result.message, result.ok)
  reload()
  defectForm.value = forms.value.find((f) => f.id === form.id) ?? null
}

function closeTodo(todo: ControlledTodo) {
  const form = forms.value.find((f) => f.handoverNo === todo.handoverNo)
  if (!form) return
  const result = closeDefect(form.id, todo.defectId)
  flash(result.message, result.ok)
  reload()
}

function closeByDefect(form: HandoverForm, defect: Defect) {
  const result = closeDefect(form.id, defect.id)
  flash(result.message, result.ok)
  reload()
  defectForm.value = forms.value.find((f) => f.id === form.id) ?? null
}

function resolveOne(v: VerifyEntry, reject: boolean) {
  const resolution = window.prompt(reject ? '驳回理由：' : '确认意见：', reject ? '经核查不予认定' : '经核查确认')
  if (resolution === null) return
  const result = resolveVerify(v.id, resolution, reject)
  flash(result.message, result.ok)
  reload()
}

function runSweep() {
  const { converted } = sweepOverdue()
  flash(converted.length ? `到期未闭环 ${converted.length} 条已自动转隐患：${converted.join('，')}` : '暂无到期未闭环待办', true)
  reload()
}

function toggleOffline() {
  const next = !offline.value
  setOffline(next)
  offline.value = next
  flash(next ? '同步通道已断线：后续写入只排队，不重放。' : '连接已恢复：下次同步从序号最小的未同步项继续。', !next)
  reload()
}

function doSync() {
  const result = syncNow()
  flash(result.message, result.ok)
  reload()
}

function armFail() {
  armNextSyncFailure()
  flash('已设置：下一条同步将失败，失败项保留排队原值，绝不拿上一次成功的值顶替。', true)
}

// ===== 登记移交单 =====

const createOpen = ref(false)
const createForm = reactive({ handoverNo: '', tunnelName: '', section: '', consUnit: '市政建投管廊项目部', recvUnit: '管廊运维公司', liabilityMonths: null as number | null })

function openCreate() {
  Object.assign(createForm, { handoverNo: '', tunnelName: '', section: '', consUnit: '市政建投管廊项目部', recvUnit: '管廊运维公司', liabilityMonths: null })
  createOpen.value = true
}

function submitCreate() {
  const result = submitForm({ ...createForm })
  flash(result.message, result.ok)
  if (result.ok) createOpen.value = false
  reload()
}

// ===== 判定结论 =====

const conclusionTarget = ref<HandoverForm | null>(null)
const conclusionDraft = reactive({
  conclusion: '有条件合格' as Exclude<Conclusion, '待验收'>,
  acceptDate: new Date().toISOString().slice(0, 10),
  liabilityMonths: 12,
  defects: [] as DefectInput[],
})

function openConclusion(form: HandoverForm) {
  conclusionTarget.value = form
  conclusionDraft.conclusion = '有条件合格'
  conclusionDraft.acceptDate = form.acceptDate ?? new Date().toISOString().slice(0, 10)
  conclusionDraft.liabilityMonths = form.liabilityMonths ?? 12
  conclusionDraft.defects = form.defects.map((d) => ({
    location: d.location, desc: d.desc, consSeverity: d.consSeverity, recvSeverity: d.recvSeverity,
  }))
}

function addDefectRow() {
  conclusionDraft.defects.push({ location: '', desc: '', consSeverity: '轻微', recvSeverity: '一般' })
}

function previewSeverity(d: DefectInput): Severity {
  return stricterSeverity(d.consSeverity, d.recvSeverity).effective
}

function submitConclusion() {
  if (!conclusionTarget.value) return
  const result = setConclusion({
    formId: conclusionTarget.value.id,
    conclusion: conclusionDraft.conclusion,
    acceptDate: conclusionDraft.acceptDate,
    liabilityMonths: conclusionDraft.liabilityMonths,
    defects: conclusionDraft.defects.filter((d) => d.location.trim() || d.desc.trim()),
  })
  flash(result.message, result.ok)
  if (result.ok) conclusionTarget.value = null
  reload()
}

// ===== 存量补录 =====

const legacyOpen = ref(false)
const legacyText = ref('')
const legacyReport = ref<LegacyReport | null>(null)
const legacyMessage = ref('')
const legacyExample = `{"handoverNo":"YJ-2021-003","tunnelName":"北站路综合管廊","section":"综合舱 0+000~0+800","consUnit":"市政建投管廊项目部","recvUnit":"管廊运维公司","acceptDate":"2021-05-10","acceptor":"赵接管","liabilityMonths":12,"conclusion":"合格","defects":[{"location":"2#风机","desc":"异响","consSeverity":"轻微","recvSeverity":"一般"}]}
{"handoverNo":"YJ-2018-001","tunnelName":"老城南路老舱","section":"老电力舱 0+000~0+500","consUnit":"历史建设主体","recvUnit":"管廊运维公司","takeoverDate":"2018-09-01","takeoverEvidence":"2018-09 起月度巡检记录"}`

function openLegacy() {
  legacyOpen.value = true
  legacyReport.value = null
  legacyMessage.value = ''
}

function reportTagClass(kind: string): string {
  return kind === 'imported' ? 'tag-ok' : kind === 'duplicate' ? '' : 'tag-warn'
}

function submitLegacy() {
  let rows: LegacyRow[]
  try {
    rows = legacyText.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LegacyRow)
  } catch (error) {
    legacyReport.value = null
    flash(`补录数据解析失败：${error instanceof Error ? error.message : '每行需为一条 JSON'}`, false)
    return
  }
  const result = importLegacy(rows)
  legacyReport.value = result.data ?? null
  legacyMessage.value = result.message
  flash(result.message, result.ok)
  reload()
}
</script>

<style scoped>
.identity-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.identity-label { font-weight: 600; }
.identity-bar select, .person-input { padding: 5px 8px; border: 1px solid var(--border); border-radius: 6px; }
.person-input { width: 130px; }
.identity-hint { color: #57606a; font-size: 13px; }
.banner { border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; font-size: 13px; }
.banner.ok { background: #dafbe1; border: 1px solid #2da44e; color: #116329; }
.banner.err { background: #ffebe9; border: 1px solid #cf222e; color: #b42318; }
.stat-alert { color: #cf222e; }
.single-source { color: #57606a; font-size: 12px; margin: 0 0 10px; }
.tabs { display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.tab { border: 1px solid var(--border); background: #fff; border-radius: 6px 6px 0 0; padding: 7px 14px; cursor: pointer; }
.tab.active { background: var(--brand); color: #fff; border-color: var(--brand); }
.tab-badge { display: inline-block; margin-left: 6px; min-width: 18px; padding: 0 5px; border-radius: 9px; background: #cf222e; color: #fff; font-size: 11px; text-align: center; }
.tab.active .tab-badge { background: #fff; color: var(--brand); }
.tag { display: inline-block; border: 1px solid var(--border); border-radius: 4px; padding: 0 5px; font-size: 11px; margin: 1px 2px; color: #57606a; background: #f6f8fa; }
.tag-warn { background: #fff8c5; border-color: #d4a72c; color: #7d4e00; }
.tag-alert { background: #ffebe9; border-color: #cf222e; color: #b42318; }
.tag-ok { background: #dafbe1; border-color: #2da44e; color: #116329; }
.muted { color: #8c959f; }
.small { font-size: 12px; }
.hint-text { color: #7d4e00; }
.ok-text { color: #116329; }
.overdue { color: #cf222e; font-weight: 600; }
.defect-line { margin-bottom: 3px; font-size: 12px; }
.sev { display: inline-block; border-radius: 4px; padding: 0 6px; font-size: 11px; color: #fff; }
.sev-严重 { background: #cf222e; }
.sev-一般 { background: #bf8700; }
.sev-轻微 { background: #2da44e; }
.conclusion { font-weight: 600; }
.con-ok { color: #116329; }
.con-warn { color: #9a6700; }
.con-bad { color: #b42318; }
.con-idle { color: #57606a; font-weight: 400; }
.status-pill { display: inline-block; border-radius: 10px; padding: 1px 10px; font-size: 12px; background: #eaeef2; color: #57606a; }
.st-已移交 { background: #dafbe1; color: #116329; }
.st-已验收 { background: #ddf4ff; color: #0969da; }
.st-待验收 { background: #fff8c5; color: #7d4e00; }
.st-已驳回 { background: #ffebe9; color: #b42318; }
.row-rejected { background: #fff5f5; }
.danger { color: #b42318; }
.rules-panel { margin-top: 14px; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; }
.rule-item { border-top: 1px dashed var(--border); padding: 8px 0; }
.rule-item:first-of-type { border-top: none; }
.rule-item h4 { margin: 4px 0; font-size: 14px; }
.rule-item p { margin: 0; color: #424a53; font-size: 13px; line-height: 1.6; }
.modal { position: fixed; inset: 0; background: rgba(31, 35, 40, 0.45); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.modal-card { background: #fff; border-radius: 10px; padding: 18px 20px; width: 520px; max-width: 100%; max-height: 88vh; overflow: auto; }
.modal-wide { width: 960px; }
.modal-card h3 { margin-top: 0; }
.modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.form-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.form-grid input, .form-grid select { padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; }
.history-list { list-style: none; margin: 0; padding: 0; }
.history-list li { border-left: 3px solid var(--brand); padding: 4px 10px; margin-bottom: 8px; background: #f6f8fa; border-radius: 0 6px 6px 0; }
.history-list li.rejected { border-left-color: #cf222e; background: #fff5f5; }
.history-list p { margin: 2px 0 0; color: #424a53; font-size: 13px; }
.legacy-area { width: 100%; height: 180px; font-family: ui-monospace, monospace; font-size: 12px; border: 1px solid var(--border); border-radius: 6px; padding: 8px; }
.legacy-report { margin-top: 10px; background: #f6f8fa; border-radius: 6px; padding: 8px 12px; max-height: 200px; overflow: auto; }
.legacy-report ul { margin: 6px 0 0; padding-left: 0; list-style: none; }
.legacy-report li { font-size: 12px; margin: 3px 0; }
.modal-card table input, .modal-card table select { width: 100%; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; }
</style>
