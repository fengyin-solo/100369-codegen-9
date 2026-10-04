<template>
  <section class="page" data-module="firereport">
    <header class="page-head">
      <div>
        <h2>火情报告管理</h2>
        <p class="page-desc">维护火情报告，核实、确认、出警、扑灭均走处置联动；处置全貌见「火情处置看板」。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn primary" to="/fireboard">打开处置看板</RouterLink>
        <button class="btn" type="button" @click="exportRows">导出火情报告清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>所属林场</span>
        <select v-model="filters['所属林场']">
          <option value="">全部林场</option>
          <option v-for="farm in farms" :key="farm" :value="farm">{{ farm }}</option>
        </select>
      </label>
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in cards" :key="item.reportCode">
          <td>{{ item.reportCode }}</td>
          <td>{{ item.farm }}</td>
          <td>{{ item.place }}</td>
          <td>{{ item.row['起火时间'] ?? '—' }}</td>
          <td>
            {{ item.effectiveLevel }}
            <span v-if="item.levelConflict" class="mini-tag conflict" title="来源与现场核实冲突，已采信现场核实">冲突采信</span>
          </td>
          <td>
            {{ item.area }} 亩
            <span v-if="item.areaBackfilled" class="mini-tag backfill">回填</span>
          </td>
          <td>{{ item.source }}</td>
          <td>{{ item.verifiedLevel || '—' }}</td>
          <td>{{ item.fireCase || '—' }}</td>
          <td>{{ item.row['报告人'] ?? '—' }}</td>
          <td>{{ item.latestTime }}</td>
          <td>{{ item.status }}</td>
          <td class="row-actions">
            <button v-if="item.status === '待核实'" class="link" type="button" @click="confirm(item)">确认火情</button>
            <button v-if="item.status === '已确认'" class="link" type="button" @click="dispatch(item)">出动扑救</button>
            <button v-if="item.status === '已出警'" class="link" type="button" @click="extinguish(item)">确认扑灭</button>
            <button v-if="item.status === '待核实'" class="link" type="button" @click="reject(item)">确认误报</button>
            <span v-if="!canAct(item.status)" class="muted-link">—</span>
          </td>
        </tr>
        <tr v-if="!cards.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无火情报告数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条火情报告记录</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  boardCards,
  confirmFire,
  dispatchFire,
  extinguishFire,
  rejectFire,
} from '@/api/fireboard'
import type { BoardCard } from '@/api/fireboard'
import { FOREST_FARMS } from '@/data/seed'

const meta = moduleMeta('firereport')
const columns = ["报告编号", "所属林场", "起火地点", "起火时间", "火势等级", "过火面积", "报告来源", "现场核实等级", "扑救情况", "报告人", "最近处置时点"]
const filterFields = ["报告编号", "起火地点"]
const farms = FOREST_FARMS

const cards = ref<BoardCard[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({ '所属林场': '' })

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: cards.value.filter((item) => item.status === status).length,
  })),
)
const stats = computed(() => [
  { label: '今日报告数', value: cards.value.length },
  { label: '已确认火情', value: cards.value.filter((item) => ['已确认', '已出警', '已扑灭'].includes(item.status)).length },
  { label: '扑救中火情', value: cards.value.filter((item) => item.status === '已出警').length },
])

function canAct(status: string): boolean {
  return ['待核实', '已确认', '已出警'].includes(status)
}

function apply(result: { ok: boolean; message: string }) {
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = ''
  reload()
}

function resetFilters() {
  filters.value = { '所属林场': '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function confirm(item: BoardCard) {
  apply(confirmFire(Number(item.row.id)))
}
function dispatch(item: BoardCard) {
  apply(dispatchFire(Number(item.row.id)))
}
function extinguish(item: BoardCard) {
  apply(extinguishFire(Number(item.row.id)))
}
function reject(item: BoardCard) {
  apply(rejectFire(Number(item.row.id)))
}

function reload() {
  errorMessage.value = ''
  cards.value = boardCards(filters.value['所属林场'] ?? '')
  total.value = cards.value.length
}

onMounted(reload)
</script>

<style scoped>
.mini-tag { font-size: 10px; border-radius: 4px; padding: 0 5px; margin-left: 4px; }
.mini-tag.conflict { background: #fee4e2; color: #b42318; }
.mini-tag.backfill { background: #fef0c7; color: #b54708; }
.muted-link { color: var(--muted); font-size: 12px; }
</style>
