<template>
  <section class="page" data-module="supply">
    <header class="page-head">
      <div>
        <h2>物资储备管理</h2>
        <p class="page-desc">维护防火物资库存；确认火情时按火势等级自动扣减库存并在台账新增处置调拨项。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/allocation">打开调拨台账</RouterLink>
        <button class="btn primary" type="button" @click="openCreate">登记防火物资</button>
        <button class="btn" type="button" @click="exportRows">导出物资储备清单</button>
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
        <span>储备林场</span>
        <select v-model="filters['储备林场']">
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

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无物资储备数据</td>
        </tr>
      </tbody>
    </table>

    <h3 class="ledger-title">物资调拨台账（火情处置同步项，最近 {{ allocRows.length }} 条）</h3>
    <table class="data-table ledger-table">
      <thead>
        <tr>
          <th v-for="column in allocColumns" :key="column">{{ column }}</th>
          <th>台账状态</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in allocRows" :key="String(row.id)">
          <td v-for="column in allocColumns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!allocRows.length">
          <td :colspan="allocColumns.length + 1" class="empty-state">暂无调拨记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条物资储备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  listRows,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { FOREST_FARMS } from '@/data/seed'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('supply')
const columns = ["物资编号", "物资名称", "物资类别", "规格型号", "储备林场", "计量单位", "预警储备量", "实际储备量", "物资状态"]
const actions = ["发起补充", "确认补充", "标记过期"]
const statuses = ["充足", "偏低", "需补充", "已过期"]
const allocColumns = ["调拨单号", "关联火情编号", "储备林场", "物资名称", "计量单位", "调拨数量", "火势等级", "调拨时间"]
const farms = FOREST_FARMS

const rows = ref<EntryRow[]>([])
const allocRows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({ '储备林场': '' })
const filterFields = ["物资名称", "物资类别"]

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '物资种类', value: rows.value.length },
  { label: '需补充种类', value: rows.value.filter((row) => String(row.status) === '需补充').length },
  {
    label: '待出库调拨',
    value: allocRows.value.filter((row) => String(row.status) === '待出库').length,
  },
])

function resetFilters() {
  filters.value = { '储备林场': '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '防火物资登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  const active: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters.value)) {
    if (value.trim() !== '') {
      active[key] = value
    }
  }
  rows.value = filterRows(listRows(meta.key), active)
  total.value = rows.value.length
  allocRows.value = [...listRows('allocation')]
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, 8)
}

onMounted(reload)
</script>

<style scoped>
.ledger-title { font-size: 14px; margin: 18px 0 8px; }
.ledger-table { font-size: 12px; }
.filter-item select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; }
</style>
