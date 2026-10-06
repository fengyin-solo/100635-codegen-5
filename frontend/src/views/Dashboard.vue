<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>

    <section class="handover-board">
      <h3>投运前验收移交台账（与移交台账页同源同函数，条数只有一个）</h3>
      <div class="stat-row">
        <article class="stat-card"><span class="stat-label">移交单总数</span><strong class="stat-value">{{ handover.total }}</strong></article>
        <article class="stat-card"><span class="stat-label">待验收</span><strong class="stat-value">{{ handover.pendingAccept }}</strong></article>
        <article class="stat-card"><span class="stat-label">已驳回</span><strong class="stat-value" :class="{ alert: handover.rejected }">{{ handover.rejected }}</strong></article>
        <article class="stat-card"><span class="stat-label">受控待办未闭环</span><strong class="stat-value" :class="{ alert: handover.openTodos }">{{ handover.openTodos }}</strong></article>
        <article class="stat-card"><span class="stat-label">到期已转隐患</span><strong class="stat-value">{{ handover.hazardsGenerated }}</strong></article>
        <article class="stat-card"><span class="stat-label">待查台账</span><strong class="stat-value" :class="{ alert: handover.pendingVerify }">{{ handover.pendingVerify }}</strong></article>
        <article class="stat-card"><span class="stat-label">越权驳回</span><strong class="stat-value" :class="{ alert: handover.conflictsRejected }">{{ handover.conflictsRejected }}</strong></article>
        <article class="stat-card"><span class="stat-label">存量回填/补建</span><strong class="stat-value">{{ handover.backfilled }}</strong></article>
      </div>
      <p class="source-note">异常结论、越权驳回、缺项待确认均回写「待查台账」；本看板与移交页的待查数字同一次计算，断线重连后也一起变。</p>
    </section>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>今日新增</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.name">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { handoverStats, sweepOverdue } from '@/api/handover-service'
import { loadOverview } from '@/api/local-service'
import type { HandoverStats } from '@/data/handover-types'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const handover = ref<HandoverStats>({
  total: 0, pendingAccept: 0, accepted: 0, rejected: 0, openDefects: 0, openTodos: 0,
  overdueTodos: 0, hazardsGenerated: 0, pendingVerify: 0, conflictsRejected: 0, backfilled: 0,
})

function refresh() {
  // 到期扫描在统计前执行（幂等），看板与台账页拿到的是同一时刻的同一份数据。
  sweepOverdue()
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
  handover.value = handoverStats()
}

onMounted(refresh)
</script>

<style scoped>
.handover-board { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; }
.handover-board h3 { margin: 0 0 8px; font-size: 15px; }
.source-note { color: #57606a; font-size: 12px; margin: 6px 0 0; }
.alert { color: #cf222e; }
</style>
