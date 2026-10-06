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

    <h3 class="subhead">投运前验收与移交 · 同一口径（与移交台账页共用 handoverStats）</h3>
    <div class="stat-row">
      <article v-for="card in handoverCards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { handoverStats } from '@/api/handover-service'
import { computed } from 'vue'
import type { OverviewResult } from '@/data/types'

const cards = ref<OverviewResult['cards']>([])
const moduleRows = ref<OverviewResult['modules']>([])
const handoverCards = computed(() => {
  const s = handoverStats()
  return [
    { label: '移交单有效/总数', value: `${s.formsValid}/${s.formsTotal}` },
    { label: '待验收/补建', value: s.pendingAccept },
    { label: '受控待办未闭环', value: s.todosOpen },
    { label: '到期未闭环', value: s.todosOverdue },
    { label: '自动转隐患(读隐患模块)', value: s.hazardsFromHandover },
    { label: '待查未结', value: s.reconOpen },
    { label: '缺项待确认', value: s.gapPending },
    { label: '越权驳回累计', value: s.rejectedWrites },
  ]
})

function refresh() {
  const payload = loadOverview()
  cards.value = payload.cards
  moduleRows.value = payload.modules
}

onMounted(() => {
  refresh()
})
</script>
