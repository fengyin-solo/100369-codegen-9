<template>
  <section class="page" data-module="allocation">
    <header class="page-head">
      <div>
        <h2>物资调拨台账</h2>
        <p class="page-desc">
          火情确认时按火势等级自动新增处置调拨项；重复确认同一火情不产生重复调拨记录。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出调拨台账</button>
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
        <span>林场</span>
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
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无调拨记录，确认火情后会自动生成</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条调拨记录</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries, filterRows, listRows, moduleMeta } from '@/api/local-service'
import { FOREST_FARMS } from '@/data/seed'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('allocation')
const columns = ["调拨单号", "关联火情编号", "储备林场", "物资名称", "计量单位", "调拨数量", "火势等级", "调拨时间", "台账状态"]
const filterFields = ["关联火情编号", "物资名称"]
const farms = FOREST_FARMS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({ '储备林场': '' })

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  { label: '调拨记录数', value: rows.value.length },
  { label: '待出库数', value: rows.value.filter((row) => String(row.status) === '待出库').length },
  {
    label: '累计调拨物资',
    value: rows.value.reduce((sum, row) => sum + (Number(row['调拨数量']) || 0), 0),
  },
])

function resetFilters() {
  filters.value = { '储备林场': '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function reload() {
  const active: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters.value)) {
    if (value.trim() !== '') {
      active[key] = value
    }
  }
  rows.value = filterRows(listRows(meta.key), active)
  total.value = rows.value.length
}

onMounted(reload)
</script>
