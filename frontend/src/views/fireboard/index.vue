<template>
  <section class="page board-page" data-module="firereport-board">
    <header class="page-head">
      <div>
        <h2>火情报告处置看板</h2>
        <p class="page-desc">
          按林场分列待核实、已确认、已出警、已扑灭火情；起火地点、火势等级与最近处置时点一屏掌握。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetDemo">重置演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in counts" :key="item.status" class="stat-card">
        <span class="stat-label">{{ item.status }}</span>
        <strong class="stat-value" :class="`level-${item.status}`">{{ item.count }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">涉及林场</span>
        <strong class="stat-value">{{ groups.length }}</strong>
      </article>
    </div>

    <div class="rule-box">
      <p class="rule-line">
        <strong>采信顺序：</strong>
        <span v-for="(name, index) in credibility" :key="name" class="rule-token">
          {{ index + 1 }}.{{ name }}
        </span>
        报告来源与现场核实结果冲突时，一律采信现场核实等级。
      </p>
      <p class="rule-line">
        <strong>面积回填：</strong>历史缺过火面积按火势等级区间回填（Ⅰ级 0–1 亩取 0；Ⅲ级 1–100 亩取 1；Ⅱ级 100–1000 亩取 100；Ⅳ级 ≥1000 亩取 1000），卡片以「回填」标注。
      </p>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>所属林场</span>
        <select v-model="farmFilter">
          <option value="">全部林场</option>
          <option v-for="farm in farms" :key="farm" :value="farm">{{ farm }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>关键字</span>
        <input v-model="keyword" placeholder="按报告编号 / 起火地点检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <p v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</p>

    <div v-for="group in groups" :key="group.farm" class="farm-block">
      <h3 class="farm-title">
        {{ group.farm }}
        <span class="farm-count">
          火情 {{ group.columns.reduce((sum, col) => sum + col.cards.length, 0) }} 起
        </span>
      </h3>
      <div class="kanban-row">
        <section v-for="col in group.columns" :key="col.status" class="kanban-col" :class="`col-${col.status}`">
          <header class="col-head">
            <span>{{ col.status }}</span>
            <strong>{{ col.cards.length }}</strong>
          </header>
          <article v-for="card in col.cards" :key="card.reportCode" class="fire-card">
            <div class="card-top">
              <span class="card-code">{{ card.reportCode }}</span>
              <span
                class="level-badge"
                :class="badgeClass(card.effectiveLevel)"
                :title="card.levelConflict ? `报告等级 ${card.sourceLevel}，采信现场核实 ${card.verifiedLevel}` : ''"
              >
                {{ card.effectiveLevel }}
              </span>
            </div>
            <p class="card-place">📍 {{ card.place }}</p>
            <p class="card-meta">
              过火面积：{{ card.area }} 亩
              <span v-if="card.areaBackfilled" class="tag tag-backfill">按等级回填</span>
            </p>
            <p v-if="card.levelConflict" class="card-meta conflict-line">
              <span class="tag tag-conflict">等级冲突</span>
              来源「{{ card.source }}」报 {{ card.sourceLevel }}，已采信现场核实 {{ card.verifiedLevel }}
            </p>
            <p v-else class="card-meta muted">来源：{{ card.source }}</p>
            <p v-if="card.verifiedNote" class="card-meta muted">核实：{{ card.verifiedNote }}</p>
            <p class="card-meta time-line">最近处置：{{ card.latestTime }}</p>
            <div class="card-actions">
              <button
                v-if="card.status === '待核实'"
                class="btn primary small"
                type="button"
                @click="onConfirm(card)"
              >
                确认火情
              </button>
              <button
                v-if="card.status === '已确认'"
                class="btn primary small"
                type="button"
                @click="onDispatch(card)"
              >
                出动扑救
              </button>
              <button
                v-if="card.status === '已出警'"
                class="btn primary small"
                type="button"
                @click="onExtinguish(card)"
              >
                确认扑灭
              </button>
              <button
                v-if="card.status === '待核实'"
                class="btn small"
                type="button"
                @click="onReject(card)"
              >
                确认误报
              </button>
              <span v-if="card.hasLinkedTasks && card.status !== '待核实'" class="linked-flag">处置任务已联动</span>
            </div>
          </article>
          <p v-if="!col.cards.length" class="col-empty">暂无</p>
        </section>
      </div>
    </div>

    <p v-if="!groups.length" class="empty-state" style="padding: 24px">没有符合条件的火情报告</p>

    <footer class="page-foot">
      <span>确认火情将在同一事务内生成：扑火队伍出动待办 · 防火物资调拨清单 · 无人机巡查任务；任一失败整体回退，重复确认只生效一次。</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  CREDIBILITY_ORDER,
  boardCounts,
  boardGroups,
  confirmFire,
  dispatchFire,
  extinguishFire,
  rejectFire,
} from '@/api/fireboard'
import { FOREST_FARMS } from '@/data/seed'
import { resetRows } from '@/data/local-store'
import type { BoardCard } from '@/api/fireboard'

type Group = ReturnType<typeof boardGroups>[number]

const groups = ref<Group[]>([])
const counts = ref<{ status: string; count: number }[]>([])
const farmFilter = ref('')
const keyword = ref('')
const message = ref('')
const messageOk = ref(false)
const farms = FOREST_FARMS
const credibility = CREDIBILITY_ORDER

function flash(ok: boolean, text: string) {
  messageOk.value = ok
  message.value = text
}

function badgeClass(level: string): string {
  if (level.includes('Ⅳ')) return 'badge-l4'
  if (level.includes('Ⅲ')) return 'badge-l3'
  if (level.includes('Ⅱ')) return 'badge-l2'
  if (level.includes('Ⅰ')) return 'badge-l1'
  return ''
}

function reload() {
  message.value = ''
  groups.value = boardGroups(farmFilter.value, keyword.value)
  counts.value = boardCounts()
}

function resetFilters() {
  farmFilter.value = ''
  keyword.value = ''
  reload()
}

function onConfirm(card: BoardCard) {
  // 现场核实等级缺省时，确认动作即采信当前最高可信来源（有核实记录时服务端仍优先现场）。
  const result = confirmFire(Number(card.row.id))
  flash(result.ok, result.message)
  if (result.ok) {
    reload()
  }
}

function onDispatch(card: BoardCard) {
  const result = dispatchFire(Number(card.row.id))
  flash(result.ok, result.message)
  if (result.ok) {
    reload()
  }
}

function onExtinguish(card: BoardCard) {
  const result = extinguishFire(Number(card.row.id))
  flash(result.ok, result.message)
  if (result.ok) {
    reload()
  }
}

function onReject(card: BoardCard) {
  const result = rejectFire(Number(card.row.id))
  flash(result.ok, result.message)
  if (result.ok) {
    reload()
  }
}

function resetDemo() {
  resetRows('firereport')
  resetRows('fireteam')
  resetRows('supply')
  resetRows('allocation')
  resetRows('drone')
  flash(true, '演示数据已重置为初始状态')
  reload()
}

const totalReports = computed(() => counts.value.reduce((sum, item) => sum + item.count, 0))
void totalReports

onMounted(reload)
</script>

<style scoped>
.rule-box {
  background: #fff;
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  font-size: 12px;
  color: var(--muted);
}
.rule-line { margin: 4px 0; }
.rule-token { margin: 0 4px; white-space: nowrap; }
.ok-text { color: #067647; font-size: 13px; }
.farm-block { margin-bottom: 18px; }
.farm-title { font-size: 15px; margin: 10px 0 8px; display: flex; align-items: center; gap: 8px; }
.farm-count { font-size: 12px; color: var(--muted); font-weight: 400; background: #eef2f7; border-radius: 999px; padding: 2px 10px; }
.kanban-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.kanban-col { background: #eef2f7; border-radius: 8px; padding: 8px; min-height: 120px; }
.col-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 600; padding: 2px 4px 8px; }
.col-待核实 { background: #f2f4f7; }
.col-已确认 { background: #fff7e6; }
.col-已出警 { background: #eef4ff; }
.col-已扑灭 { background: #ecfdf3; }
.fire-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; margin-bottom: 8px; }
.card-top { display: flex; justify-content: space-between; align-items: center; }
.card-code { font-size: 12px; color: var(--muted); }
.level-badge { font-size: 12px; border-radius: 6px; padding: 1px 8px; color: #fff; }
.badge-l1 { background: #12b76a; }
.badge-l2 { background: #f79009; }
.badge-l3 { background: #ef6820; }
.badge-l4 { background: #d92d20; }
.card-place { margin: 6px 0 4px; font-size: 13px; font-weight: 600; }
.card-meta { margin: 3px 0; font-size: 12px; }
.card-meta.muted { color: var(--muted); }
.time-line { color: #344054; }
.conflict-line { color: #b42318; }
.tag { border-radius: 4px; padding: 0 6px; font-size: 11px; margin-left: 4px; }
.tag-backfill { background: #fef0c7; color: #b54708; }
.tag-conflict { background: #fee4e2; color: #b42318; margin-left: 0; }
.card-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap; }
.btn.small { padding: 3px 10px; font-size: 12px; }
.linked-flag { font-size: 11px; color: #067647; }
.col-empty { text-align: center; color: var(--muted); font-size: 12px; padding: 12px 0; }
.filter-item select { padding: 4px 8px; border: 1px solid var(--border); border-radius: 6px; }
</style>
