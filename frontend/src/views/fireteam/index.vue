<template>
  <section class="page" data-module="fireteam">
    <header class="page-head">
      <div>
        <h2>扑火队伍管理</h2>
        <p class="page-desc">队伍档案与火情处置出动待办同页维护；确认火情后待办自动同步到这里。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记扑火队伍</button>
        <button class="btn" type="button" @click="exportRows">导出扑火队伍清单</button>
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
        <span>记录类型</span>
        <select v-model="filters['记录类型']">
          <option value="">全部</option>
          <option value="队伍档案">队伍档案</option>
          <option value="出动待办">火情出动待办</option>
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
        <tr
          v-for="row in rows"
          :key="String(row.id)"
          :class="{ 'todo-row': String(row['记录类型'] ?? '') === '出动待办' }"
        >
          <td v-for="column in columns" :key="column">
            <template v-if="column === '记录类型'">
              <span :class="String(row[column]) === '出动待办' ? 'type-badge todo' : 'type-badge'">{{ row[column] ?? '队伍档案' }}</span>
            </template>
            <template v-else-if="column === '处置事项'">
              <span v-if="row[column]">{{ row[column] }}</span>
              <span v-else class="muted-cell">—</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>
            {{ row.status }}
            <span v-if="String(row['关联火情编号'] ?? '')" class="linked-chip">关联 {{ row['关联火情编号'] }}</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 1" class="empty-state">暂无扑火队伍数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条记录，其中火情出动待办 {{ todoCount }} 条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  filterRows,
  listEntries,
  listRows,
  moduleMeta,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('fireteam')
const columns = ["队伍编号", "队伍名称", "所属林场", "队长姓名", "队员人数", "集结半径", "值班状态", "出动状态", "记录类型", "处置事项", "关联火情编号"]
const filterFields = ["队伍名称", "所属林场"]

const all = ref<EntryRow[]>([])
const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({ '记录类型': '' })

const todoCount = computed(
  () => all.value.filter((row) => String(row['记录类型'] ?? '') === '出动待办').length,
)
const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => [
  {
    label: '队伍总数',
    value: all.value.filter((row) => String(row['记录类型'] ?? '队伍档案') === '队伍档案').length,
  },
  {
    label: '待命队伍',
    value: all.value.filter(
      (row) => String(row['记录类型'] ?? '队伍档案') === '队伍档案' && String(row.status) === '在营待命',
    ).length,
  },
  { label: '出动待办', value: todoCount.value },
])

function resetFilters() {
  filters.value = { '记录类型': '' }
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '扑火队伍登记入口尚未接入审批流'
}

function reload() {
  errorMessage.value = ''
  all.value = listRows(meta.key)
  const active: Record<string, string> = {}
  for (const [key, value] of Object.entries(filters.value)) {
    if (value.trim() !== '') {
      active[key] = value
    }
  }
  rows.value = filterRows(all.value, active)
  total.value = rows.value.length
  void listEntries
}

onMounted(reload)
</script>

<style scoped>
.type-badge { font-size: 11px; border-radius: 4px; padding: 1px 6px; background: #eef2f7; color: var(--muted); }
.type-badge.todo { background: #fff7e6; color: #b54708; }
.linked-chip { font-size: 11px; color: var(--brand); margin-left: 6px; }
.todo-row { background: #fffdf5; }
.muted-cell { color: var(--muted); }
</style>
