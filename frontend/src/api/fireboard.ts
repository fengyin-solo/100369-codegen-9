import { ALLOC_PLAN, SUPPLY_CATALOG } from '@/data/seed'
import { allRows, listRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 火情处置领域服务：看板、火情报告页都走这里，保证多表联动、同事务提交、重复确认幂等。

export type BoardCard = {
  row: EntryRow
  reportCode: string
  farm: string
  place: string
  effectiveLevel: string
  sourceLevel: string
  verifiedLevel: string
  levelConflict: boolean
  area: string
  areaBackfilled: boolean
  latestTime: string
  source: string
  verifiedNote: string
  fireCase: string
  status: string
  hasLinkedTasks: boolean
}

const KANBAN_STATUSES = ['待核实', '已确认', '已出警', '已扑灭']
const DONE_STATUSES = ['已扑灭', '误报']

// 报告来源与现场核实冲突时的采信顺序（序号越小越优先）。
// 现场核实是处置依据，最优先；卫星热点客观但分辨率有限；群众报警主观成分最高。
export const CREDIBILITY_ORDER = [
  '现场核实结果',
  '无人机巡查',
  '瞭望台报告',
  '巡护员上报',
  '卫星热点',
  '群众报警',
]
export const SOURCE_PRIORITY: Record<string, number> = Object.fromEntries(
  CREDIBILITY_ORDER.map((name, index) => [name, index]),
)

// 火势等级 → 历史缺测过火面积回填区间（亩）。缺面积时取区间下限，标注为按等级回填。
export const AREA_RANGE: Record<string, { min: number; max: number }> = {
  Ⅰ级: { min: 0, max: 1 },
  Ⅱ级: { min: 100, max: 1000 },
  Ⅲ级: { min: 1, max: 100 },
  Ⅳ级: { min: 1000, max: 10000 },
}

const LEVEL_KEYS = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ']

function levelKey(level: string): string | null {
  if (!level) {
    return null
  }
  const found = LEVEL_KEYS.find((key) => level.includes(key))
  return found ?? null
}

function num(value: unknown): number {
  const n = Number(String(value ?? '').trim())
  return Number.isFinite(n) ? n : NaN
}

function nowStamp(label: string): string {
  const d = new Date()
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${label}`
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
}

function findReport(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((item) => Number(item.id) === id)
}

// 采信规则：有现场核实等级一律采信现场；否则按来源可信度回退到报告等级。
export function resolveLevel(row: EntryRow): { level: string; conflict: boolean } {
  const sourceLevel = String(row['火势等级'] ?? '').trim()
  const verifiedLevel = String(row['现场核实等级'] ?? '').trim()
  if (verifiedLevel) {
    return { level: verifiedLevel, conflict: !!sourceLevel && levelKey(verifiedLevel) !== levelKey(sourceLevel) }
  }
  return { level: sourceLevel, conflict: false }
}

// 过火面积缺测时按等级区间回填（取区间下限，亩），回填结果持久化并在看板上标注。
function resolveArea(row: EntryRow, level: string): { area: string; backfilled: boolean } {
  const raw = String(row['过火面积'] ?? '').trim()
  const current = num(raw)
  if (raw !== '' && Number.isFinite(current)) {
    return { area: raw, backfilled: false }
  }
  const key = levelKey(level)
  if (!key) {
    return { area: raw || '待核实', backfilled: false }
  }
  return { area: String(AREA_RANGE[`${key}级`].min), backfilled: true }
}

// 统一提交：各表先在内存草稿里改，全部成功才一次性落库；任何一步抛错都不会留下半成品。
function commitSnapshot(snapshot: Record<string, EntryRow[]>, touched: string[]): void {
  for (const key of touched) {
    saveRows(key, snapshot[key])
  }
}

function draftSnapshot(): { snapshot: Record<string, EntryRow[]>; touched: string[] } {
  return { snapshot: JSON.parse(JSON.stringify(allRows())) as Record<string, EntryRow[]>, touched: [] }
}

export function boardCards(farmFilter = '', keyword = ''): BoardCard[] {
  const rows = listRows('firereport')
  return rows
    .filter((row) => {
      if (farmFilter && String(row['所属林场'] ?? '') !== farmFilter) {
        return false
      }
      if (keyword) {
        const text = `${row['报告编号'] ?? ''}${row['起火地点'] ?? ''}${row['扑救情况'] ?? ''}`
        if (!text.includes(keyword.trim())) {
          return false
        }
      }
      return true
    })
    .map((row) => {
      const { level, conflict } = resolveLevel(row)
      const { area, backfilled } = resolveArea(row, level)
      const code = String(row['报告编号'] ?? '')
      return {
        row,
        reportCode: code,
        farm: String(row['所属林场'] ?? '未划分林场'),
        place: String(row['起火地点'] ?? '—'),
        effectiveLevel: level || '未定级',
        sourceLevel: String(row['火势等级'] ?? ''),
        verifiedLevel: String(row['现场核实等级'] ?? ''),
        levelConflict: conflict,
        area,
        areaBackfilled: backfilled,
        latestTime: String(row['最近处置时点'] ?? '—'),
        source: String(row['报告来源'] ?? '—'),
        verifiedNote: String(row['现场核实说明'] ?? ''),
        fireCase: String(row['扑救情况'] ?? ''),
        status: String(row.status ?? ''),
        hasLinkedTasks:
          listRows('fireteam').some((item) => String(item['关联火情编号'] ?? '') === code) ||
          listRows('drone').some((item) => String(item['关联火情编号'] ?? '') === code) ||
          listRows('allocation').some((item) => String(item['关联火情编号'] ?? '') === code),
      }
    })
}

export function boardGroups(farmFilter = '', keyword = '') {
  const cards = boardCards(farmFilter, keyword)
  const farms = [...new Set(cards.map((card) => card.farm))]
  return farms.map((farm) => ({
    farm,
    columns: KANBAN_STATUSES.map((status) => ({
      status,
      cards: cards.filter((card) => card.status === status),
    })),
  }))
}

export function boardCounts() {
  const cards = boardCards()
  return KANBAN_STATUSES.map((status) => ({
    status,
    count: cards.filter((card) => card.status === status).length,
  }))
}

export const KANBAN_STATUS_LIST = KANBAN_STATUSES

function linkedExists(rows: EntryRow[], reportCode: string): boolean {
  return rows.some((item) => String(item['关联火情编号'] ?? '') === reportCode)
}

// 确认火情：同事务生成扑火队伍出动待办、防火物资调拨清单、无人机巡查任务。
// 任一创建失败整体回退；已确认过（联动任务已存在）的火情重复确认不产生重复任务。
export function confirmFire(id: number, verifiedLevel = '', verifiedNote = ''): ActionResult {
  const reports = listRows('firereport')
  const report = findReport(reports, id)
  if (!report) {
    return { ok: false, message: `没有找到编号为 ${id} 的火情报告` }
  }
  const status = String(report.status)
  const code = String(report['报告编号'] ?? '')
  if (status === '误报' || status === '已扑灭') {
    return { ok: false, message: `火情 ${code} 当前为「${status}」，不能确认` }
  }

  const { snapshot, touched } = draftSnapshot()
  try {
    const reportRows = snapshot.firereport
    const target = findReport(reportRows, id)
    if (!target) {
      throw new Error('火情报告在处置过程中丢失，请刷新后重试')
    }

    // 幂等：已确认且三联动任务都在，重复确认只提示、不再生成。
    const alreadyLinked =
      linkedExists(snapshot.fireteam, code) &&
      linkedExists(snapshot.drone, code) &&
      linkedExists(snapshot.allocation, code)
    if (String(target.status) !== '待核实' && alreadyLinked) {
      return { ok: false, message: `火情 ${code} 已确认，联动任务已生成，重复确认不再产生新任务` }
    }

    // 现场核实结果随确认一并落档。
    if (verifiedLevel.trim()) {
      target['现场核实等级'] = verifiedLevel.trim()
    }
    if (verifiedNote.trim()) {
      target['现场核实说明'] = verifiedNote.trim()
    }
    const { level } = resolveLevel(target)
    const key = levelKey(level)
    if (!key) {
      throw new Error('缺少可信的火势等级，无法按等级编组队伍与调拨物资')
    }

    const farm = String(target['所属林场'] ?? '')
    const place = String(target['起火地点'] ?? '')

    // 缺过火面积按等级区间回填，随本次确认一并落库。
    const { area, backfilled } = resolveArea(target, level)
    if (backfilled) {
      target['过火面积'] = area
    }

    // ① 扑火队伍出动待办：顺着 火情.所属林场 → 队伍.所属林场 找，仅派在营待命队伍。
    const standbyTeams = snapshot.fireteam.filter(
      (item) =>
        String(item['记录类型'] ?? '队伍档案') === '队伍档案' &&
        String(item['所属林场'] ?? '') === farm &&
        String(item.status) === '在营待命',
    )
    if (standbyTeams.length === 0) {
      throw new Error(`${farm}没有「在营待命」的扑火队伍，出动待办创建失败，火情确认已整体回退`)
    }
    const teamTodos = snapshot.fireteam.filter(
      (item) => String(item['记录类型'] ?? '') === '出动待办' && String(item['关联火情编号'] ?? '') === code,
    )
    if (teamTodos.length === 0) {
      const team = standbyTeams[0]
      const stamp = nowStamp('已确认')
      snapshot.fireteam.push({
        id: nextId(snapshot.fireteam),
        status: '待出动',
        pending: true,
        abnormal: false,
        队伍编号: `FT-TODO-${String(id).padStart(3, '0')}`,
        队伍名称: String(team['队伍名称'] ?? ''),
        所属林场: farm,
        队长姓名: String(team['队长姓名'] ?? '随队编组'),
        队员人数: team['队员人数'] ?? '按队伍实编',
        集结半径: team['集结半径'] ?? '—',
        值班状态: '处置事项',
        出动状态: '待出动',
        记录类型: '出动待办',
        处置事项: `出动扑救 ${code}：${place}（采信${level}）`,
        关联火情编号: code,
        生成时间: stamp,
      })
    }

    // ② 防火物资调拨清单：按等级基数逐类核库存，不够就失败回滚。
    const existingAlloc = snapshot.allocation.some(
      (item) => String(item['关联火情编号'] ?? '') === code,
    )
    const plan = ALLOC_PLAN[`${key}级`]
    if (!existingAlloc) {
      const shortages: string[] = []
      SUPPLY_CATALOG.forEach((item, index) => {
        const need = plan[index]
        const stock = snapshot.supply.find(
          (s) => String(s['储备林场'] ?? '') === farm && String(s['物资名称'] ?? '') === item.name,
        )
        const remain = stock ? num(stock['实际储备量']) : NaN
        if (!stock || !Number.isFinite(remain) || remain < need) {
          shortages.push(`${item.name}需${need}${item.unit}${stock ? `、现存${remain}${item.unit}` : '、无库存'}`)
        }
      })
      if (shortages.length > 0) {
        throw new Error(`物资储备不足，调拨清单创建失败（${shortages.join('；')}），火情确认已整体回退`)
      }
      const stamp = nowStamp('已确认')
      SUPPLY_CATALOG.forEach((item, index) => {
        const need = plan[index]
        const stock = snapshot.supply.find(
          (s) => String(s['储备林场'] ?? '') === farm && String(s['物资名称'] ?? '') === item.name,
        ) as EntryRow
        const remain = num(stock['实际储备量']) - need
        const warn = num(stock['预警储备量'])
        stock['实际储备量'] = remain
        const stockStatus = remain < warn ? '需补充' : remain <= Math.floor(warn * 1.5) ? '偏低' : '充足'
        stock.status = stockStatus
        stock['物资状态'] = stockStatus
        stock.pending = stockStatus !== '充足'
        snapshot.allocation.push({
          id: nextId(snapshot.allocation),
          status: '待出库',
          pending: true,
          abnormal: false,
          调拨单号: `ALLOC-NEW-${code}-${index + 1}`,
          关联火情编号: code,
          储备林场: farm,
          物资名称: item.name,
          计量单位: item.unit,
          调拨数量: need,
          火势等级: `${key}级`,
          调拨时间: stamp,
          台账状态: '待出库',
        })
      })
    }

    // ③ 无人机巡查任务：沿起火地点生成空中巡查。
    if (!linkedExists(snapshot.drone, code)) {
      const stamp = nowStamp('已确认')
      snapshot.drone.push({
        id: nextId(snapshot.drone),
        status: '待执行',
        pending: true,
        abnormal: false,
        任务编号: `DRON-FR-${String(id).padStart(3, '0')}`,
        飞行区域: place,
        飞行路线: `${place} 火场环绕侦察`,
        飞手姓名: '值班飞手',
        起飞时间: stamp,
        降落时间: '',
        发现异常数: 0,
        任务状态: '待执行',
        处置事项: `火情 ${code} 现场空中巡查`,
        关联火情编号: code,
      })
    }

    // 火情本体最后置为已确认（只有三项联动全部创建成功才走到这里）。
    target.status = '已确认'
    target['报告状态'] = '已确认'
    target.pending = true
    target['最近处置时点'] = nowStamp('已确认')
    if (!String(target['扑救情况'] ?? '').trim()) {
      target['扑救情况'] = '已确认，队伍待办、物资调拨清单、无人机巡查任务已生成'
    }

    commitSnapshot(snapshot, ['firereport', 'fireteam', 'supply', 'allocation', 'drone'])
    touched.length = 0
    return {
      ok: true,
      message: `火情 ${code} 已确认（采信火势等级：${level}${backfilled ? `，过火面积按${key}级区间回填${area}亩` : ''}），出动待办、调拨清单、无人机任务已同步生成`,
    }
  } catch (error) {
    // 没调用过 commitSnapshot，localStorage 未被改动，等价于整体回退。
    return { ok: false, message: error instanceof Error ? error.message : '火情确认失败，已整体回退' }
  }
}

// 出动扑救：把该火情的队伍待办置为已出动、调拨项置为已出库、无人机任务置为飞行中。
export function dispatchFire(id: number): ActionResult {
  const reports = listRows('firereport')
  const report = findReport(reports, id)
  if (!report) {
    return { ok: false, message: `没有找到编号为 ${id} 的火情报告` }
  }
  const code = String(report['报告编号'] ?? '')
  if (String(report.status) === '已出警') {
    return { ok: false, message: `火情 ${code} 已出警，不要重复下达` }
  }
  if (String(report.status) !== '已确认') {
    return { ok: false, message: `火情 ${code} 当前为「${report.status}」，需先确认火情` }
  }

  const { snapshot } = draftSnapshot()
  try {
    const target = findReport(snapshot.firereport, id)
    if (!target) {
      throw new Error('火情报告在处置过程中丢失，请刷新后重试')
    }
    const stamp = nowStamp('已出警')

    let teamLinked = false
    snapshot.fireteam.forEach((item) => {
      if (String(item['关联火情编号'] ?? '') !== code) {
        return
      }
      teamLinked = true
      item.status = '已出动'
      item['出动状态'] = '已出动'
      item.pending = true
      const text = String(item['处置事项'] ?? '')
      item['处置事项'] = text.replace('待出动', '已出动')
      if (String(item['记录类型'] ?? '') === '出动待办') {
        item['生成时间'] = stamp
      }
    })
    // 出动待办对应的队伍档案同步转为已出动。
    const todo = snapshot.fireteam.find(
      (item) => String(item['记录类型'] ?? '') === '出动待办' && String(item['关联火情编号'] ?? '') === code,
    )
    if (todo) {
      const teamRow = snapshot.fireteam.find(
        (item) =>
          String(item['记录类型'] ?? '队伍档案') === '队伍档案' &&
          String(item['队伍名称'] ?? '') === String(todo['队伍名称'] ?? '') &&
          String(item.status) === '在营待命',
      )
      if (teamRow) {
        teamRow.status = '已出动'
        teamRow['出动状态'] = '已出动'
        teamRow.pending = true
      }
    }
    if (!teamLinked) {
      throw new Error(`火情 ${code} 缺少队伍出动待办，不能出警，请重新确认火情`)
    }

    snapshot.allocation.forEach((item) => {
      if (String(item['关联火情编号'] ?? '') === code) {
        item.status = '已出库'
        item['台账状态'] = '已出库'
        item.pending = false
        item['调拨时间'] = stamp
      }
    })
    snapshot.drone.forEach((item) => {
      if (String(item['关联火情编号'] ?? '') === code && String(item.status) === '待执行') {
        item.status = '飞行中'
        item['任务状态'] = '飞行中'
        item.pending = true
      }
    })

    target.status = '已出警'
    target['报告状态'] = '已出警'
    target.pending = true
    target['最近处置时点'] = stamp
    target['扑救情况'] = '队伍已出动，物资已出库，无人机空中跟进'

    commitSnapshot(snapshot, ['firereport', 'fireteam', 'allocation', 'drone'])
    return { ok: true, message: `火情 ${code} 已出警，扑火队伍、物资调拨、无人机任务同步更新` }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '出动失败，已整体回退' }
  }
}

// 确认扑灭：队伍待办归档、无人机复查任务收尾，火情收口。
export function extinguishFire(id: number): ActionResult {
  const reports = listRows('firereport')
  const report = findReport(reports, id)
  if (!report) {
    return { ok: false, message: `没有找到编号为 ${id} 的火情报告` }
  }
  const code = String(report['报告编号'] ?? '')
  if (String(report.status) === '已扑灭') {
    return { ok: false, message: `火情 ${code} 已扑灭，不要重复操作` }
  }
  if (String(report.status) !== '已出警') {
    return { ok: false, message: `火情 ${code} 当前为「${report.status}」，需出警扑救后才能确认扑灭` }
  }

  const { snapshot } = draftSnapshot()
  const stamp = nowStamp('已扑灭')
  const target = findReport(snapshot.firereport, id)
  if (!target) {
    return { ok: false, message: '火情报告在处置过程中丢失，请刷新后重试' }
  }

  snapshot.fireteam.forEach((item) => {
    if (String(item['关联火情编号'] ?? '') !== code) {
      return
    }
    if (String(item['记录类型'] ?? '') === '出动待办') {
      item.status = '已完成'
      item['出动状态'] = '已完成'
      item.pending = false
    } else {
      item.status = '已撤回'
      item['出动状态'] = '已撤回'
      item.pending = false
    }
  })
  snapshot.drone.forEach((item) => {
    if (String(item['关联火情编号'] ?? '') === code && String(item.status) !== '因故中止') {
      item.status = '已完成'
      item['任务状态'] = '已完成'
      item.pending = false
      if (!String(item['降落时间'] ?? '').trim()) {
        item['降落时间'] = stamp
      }
    }
  })

  target.status = '已扑灭'
  target['报告状态'] = '已扑灭'
  target.pending = false
  target['最近处置时点'] = stamp
  target['扑救情况'] = '明火已扑灭，队伍撤回，无人机复查完成'

  commitSnapshot(snapshot, ['firereport', 'fireteam', 'drone'])
  return { ok: true, message: `火情 ${code} 已扑灭，出动待办与无人机巡查同步收尾` }
}

// 确认误报：不生成任何联动任务。
export function rejectFire(id: number): ActionResult {
  const rows = listRows('firereport')
  const report = findReport(rows, id)
  if (!report) {
    return { ok: false, message: `没有找到编号为 ${id} 的火情报告` }
  }
  const code = String(report['报告编号'] ?? '')
  const linked =
    linkedExists(listRows('fireteam'), code) ||
    linkedExists(listRows('drone'), code) ||
    linkedExists(listRows('allocation'), code)
  if (linked) {
    return { ok: false, message: `火情 ${code} 已生成处置任务，不能按误报处理` }
  }
  const next = rows.map((item) =>
    Number(item.id) === id
      ? {
          ...item,
          status: '误报',
          报告状态: '误报',
          pending: false,
          abnormal: false,
          最近处置时点: nowStamp('确认误报'),
        }
      : item,
  )
  saveRows('firereport', next)
  return { ok: true, message: `火情 ${code} 已确认为误报，未生成处置任务` }
}

export function isTerminalStatus(status: string): boolean {
  return DONE_STATUSES.includes(status)
}
