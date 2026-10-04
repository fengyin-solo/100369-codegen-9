<template>
  <section class="page" data-module="firedisposal">
    <header class="page-head">
      <div>
        <h2>火情报告处置看板</h2>
        <p class="page-desc">
          按林场分栏跟进待核实、已确认、已出警、已扑灭的火情报告。报告来源与现场核实冲突时采信现场核实结果；历史缺过火面积按火势等级区间回填。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="reload">刷新看板</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in totals" :key="item.status" class="stat-card">
        <span class="stat-label">{{ item.status }}</span>
        <strong class="stat-value">{{ item.count }}</strong>
      </article>
    </div>

    <section v-for="farm in farms" :key="farm.farm" class="board-farm">
      <h3 class="board-farm-title">{{ farm.farm }}</h3>
      <div class="board-grid">
        <div v-for="bucket in farm.buckets" :key="bucket.status" class="board-col">
          <p class="board-col-title">
            <span>{{ bucket.status }}</span>
            <span>{{ bucket.reports.length }}</span>
          </p>
          <article v-for="card in bucket.reports" :key="card.id" class="board-card">
            <p class="board-card-title">
              <span>{{ card.reportNo }}</span>
              <span class="tag" :class="{ warn: card.conflict }">
                {{ card.level || '等级待定' }}
              </span>
            </p>
            <p>起火地点：{{ card.location || '—' }}</p>
            <p>过火面积：{{ card.area || '—' }}<span v-if="card.areaBackfilled" class="tag info">回填</span></p>
            <p>报告来源：{{ card.source || '—' }}</p>
            <p v-if="card.conflict" class="conflict-text">报告与核实冲突，已采信现场核实</p>
            <p>最近处置：{{ card.lastHandledAt || '—' }}</p>
            <p v-if="nextActions(card.status).length" class="row-actions">
              <button
                v-for="action in nextActions(card.status)"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, card)"
              >
                {{ action }}
              </button>
            </p>
          </article>
          <p v-if="!bucket.reports.length" class="board-empty">暂无{{ bucket.status }}报告</p>
        </div>
      </div>
    </section>
    <p v-if="!farms.length" class="empty-state">暂无火情报告数据</p>

    <footer class="page-foot">
      <span>确认火情将同时生成扑火队伍出动待办、物资调拨清单与无人机巡查任务，重复确认只生效一次</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  loadFireDisposalBoard,
  runAction as applyAction,
} from '@/api/local-service'
import type { DisposalCard, DisposalFarmGroup } from '@/api/local-service'

// 每个阶段在看板上能点出的下一步动作。
const NEXT_ACTIONS: Record<string, string[]> = {
  待核实: ['核实火情', '确认误报'],
  已确认: ['出动扑救'],
  已出警: ['确认扑灭'],
  已扑灭: [],
}

const farms = ref<DisposalFarmGroup[]>([])
const totals = ref<{ status: string; count: number }[]>([])
const message = ref('')
const messageOk = ref(false)

function nextActions(status: string): string[] {
  return NEXT_ACTIONS[status] ?? []
}

function runAction(action: string, card: DisposalCard) {
  message.value = ''
  const result = applyAction('firereport', card.id, action)
  messageOk.value = result.ok
  message.value = result.message
  reload()
}

function reload() {
  const board = loadFireDisposalBoard()
  farms.value = board.farms
  totals.value = board.totals
}

onMounted(reload)
</script>
