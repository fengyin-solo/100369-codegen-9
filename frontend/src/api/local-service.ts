import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 终态状态：落到这些状态就不算待处理了。没登记的模块沿用「最后一个状态是终态」的老规矩。
const TERMINAL_STATUSES: Record<string, string[]> = {
  firereport: ['已扑灭', '误报'],
}

// 火势等级 → 过火面积区间（公顷）：历史报告缺过火面积时按采信等级在区间内回填。
const AREA_RANGE_BY_LEVEL: Record<string, [number, number]> = {
  一般: [0.1, 1],
  较大: [1, 100],
  重大: [100, 1000],
  特别重大: [1000, 5000],
}

// 处置看板固定展示的四个阶段。
export const DISPOSAL_BOARD_STATUSES = ['待核实', '已确认', '已出警', '已扑灭']

export type DisposalCard = {
  id: number
  reportNo: string
  location: string
  startTime: string
  source: string
  level: string
  conflict: boolean
  area: string
  areaBackfilled: boolean
  lastHandledAt: string
  status: string
}

export type DisposalFarmGroup = {
  farm: string
  buckets: { status: string; reports: DisposalCard[] }[]
}

export type DisposalBoard = {
  farms: DisposalFarmGroup[]
  totals: { status: string; count: number }[]
}

function nowText(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 采信顺序：现场核实结果优先于报告来源。核实栏填了（且不是「无火情」）就以核实为准。
export function adoptedFireLevel(row: EntryRow): string {
  const verified = String(row['核实火势等级'] ?? '').trim()
  if (verified && verified !== '无火情') {
    return verified
  }
  return String(row['火势等级'] ?? '').trim()
}

function hasLevelConflict(row: EntryRow): boolean {
  const reported = String(row['火势等级'] ?? '').trim()
  const verified = String(row['核实火势等级'] ?? '').trim()
  return reported !== '' && verified !== '' && verified !== '无火情' && reported !== verified
}

// 历史缺过火面积：按采信火势等级的区间回填，取值由记录 id 决定，刷新不会变。
function withBackfilledArea(row: EntryRow): { row: EntryRow; backfilled: boolean } {
  const current = String(row['过火面积'] ?? '').trim()
  if (current !== '') {
    return { row, backfilled: false }
  }
  const range = AREA_RANGE_BY_LEVEL[adoptedFireLevel(row)]
  if (!range) {
    return { row, backfilled: false }
  }
  const [low, high] = range
  const ratio = ((Number(row.id) * 37) % 100) / 100
  const value = low + (high - low) * ratio
  return {
    row: { ...row, 过火面积: `${value.toFixed(1)}公顷`, 面积来源: '按火势等级区间回填' },
    backfilled: true,
  }
}

// 顺着火情与队伍的数据关系找林场：先取报告上的所属林场，缺了再用起火地点去匹配队伍的所属林场。
function resolveFarm(report: EntryRow, teams: EntryRow[]): string {
  const direct = String(report['所属林场'] ?? '').trim()
  if (direct !== '') {
    return direct
  }
  const location = String(report['起火地点'] ?? '')
  const knownFarms = [...new Set(teams.map((team) => String(team['所属林场'] ?? '').trim()))].filter(
    (farm) => farm !== '',
  )
  return knownFarms.find((farm) => location.includes(farm)) ?? '未指明林场'
}

function nextId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

function nextCode(rows: EntryRow[], field: string, prefix: string): string {
  const max = rows.reduce((acc, row) => {
    const match = String(row[field] ?? '').match(/(\d+)$/)
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

// 处置看板：按林场分组、按处置阶段分列，顺带把历史缺的过火面积回填落库。
export function loadFireDisposalBoard(): DisposalBoard {
  const teams = listRows('fireteam')
  const stored = listRows('firereport')
  const filled = stored.map((row) => withBackfilledArea(row))
  const normalized = filled.map((item) => item.row)
  if (filled.some((item) => item.backfilled)) {
    saveRows('firereport', normalized)
  }
  const farms = new Map<string, EntryRow[]>()
  for (const row of normalized) {
    const farm = resolveFarm(row, teams)
    const bucket = farms.get(farm) ?? []
    bucket.push(row)
    farms.set(farm, bucket)
  }
  const groups: DisposalFarmGroup[] = [...farms.entries()].map(([farm, rows]) => ({
    farm,
    buckets: DISPOSAL_BOARD_STATUSES.map((status) => ({
      status,
      reports: rows
        .filter((row) => String(row.status) === status)
        .map((row) => ({
          id: Number(row.id),
          reportNo: String(row['报告编号'] ?? ''),
          location: String(row['起火地点'] ?? ''),
          startTime: String(row['起火时间'] ?? ''),
          source: String(row['报告来源'] ?? ''),
          level: adoptedFireLevel(row),
          conflict: hasLevelConflict(row),
          area: String(row['过火面积'] ?? ''),
          areaBackfilled: String(row['面积来源'] ?? '') !== '',
          lastHandledAt: String(row['最近处置时间'] ?? ''),
          status: String(row.status),
        }))
        .sort((a, b) => b.lastHandledAt.localeCompare(a.lastHandledAt)),
    })),
  }))
  const totals = DISPOSAL_BOARD_STATUSES.map((status) => ({
    status,
    count: normalized.filter((row) => String(row.status) === status).length,
  }))
  return { farms: groups, totals }
}

// 确认火情：一个事务里同时生成扑火队伍出动待办、物资调拨清单、无人机巡查任务。
// 先全部校验再落库，任一环节失败整体回退；重复确认只生效一次，不产生重复任务。
export function confirmFireReport(id: number): ActionResult {
  const meta = moduleMeta('firereport')
  const reports = listRows('firereport')
  const report = reports.find((row) => Number(row.id) === id)
  if (!report) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (String(report.status) !== '待核实') {
    return {
      ok: false,
      message: `${meta.entity}已是「${String(report.status)}」，确认只生效一次，不重复生成处置任务`,
    }
  }
  const reportNo = String(report['报告编号'] ?? `FIRE-${id}`)
  const teams = listRows('fireteam')
  const drones = listRows('drone')
  const supplies = listRows('supply')
  // 防重：三类衍生记录里任一已带过这份报告的编号，就说明处置任务生成过，直接拒绝。
  const alreadyDispatched =
    teams.some((row) => String(row['出动状态'] ?? '').includes(reportNo)) ||
    drones.some((row) => String(row['飞行路线'] ?? '').includes(reportNo)) ||
    supplies.some((row) => String(row['物资名称'] ?? '').includes(reportNo))
  if (alreadyDispatched) {
    return { ok: false, message: `火情${reportNo}的处置任务已生成过，重复确认不生效` }
  }
  const farm = resolveFarm(report, teams)
  const team = teams.find(
    (row) => String(row['所属林场']) === farm && String(row.status) === '在营待命',
  )
  if (!team) {
    return { ok: false, message: `${farm}没有在营待命的扑火队伍，无法确认火情，未生成任何处置任务` }
  }

  const stamp = nowText()
  const level = adoptedFireLevel(report)
  // 1) 扑火队伍出动待办：队伍页同步可见（已出动 + 待处理）
  const nextTeams = teams.map((row) =>
    Number(row.id) === Number(team.id)
      ? {
          ...row,
          status: '已出动',
          pending: true,
          abnormal: false,
          值班状态: '火警出动',
          出动状态: `出动处置${reportNo}`,
        }
      : row,
  )
  // 2) 防火物资调拨清单：物资台账同步新增处置项
  const supplyItem: EntryRow = {
    id: nextId(supplies),
    status: '需补充',
    pending: true,
    abnormal: false,
    物资编号: nextCode(supplies, '物资编号', 'SUPP'),
    物资名称: `火情${reportNo}处置调拨`,
    物资类别: '调拨清单',
    规格型号: `按${level || '一般'}火势配给`,
    储备林场: farm,
    预警储备量: '',
    实际储备量: '',
    物资状态: '需补充',
  }
  // 3) 无人机巡查任务
  const droneTask: EntryRow = {
    id: nextId(drones),
    status: '待执行',
    pending: true,
    abnormal: false,
    任务编号: nextCode(drones, '任务编号', 'DRON'),
    飞行区域: `${farm}${String(report['起火地点'] ?? '')}`,
    飞行路线: `火情${reportNo}核实巡查`,
    飞手姓名: '待指派',
    起飞时间: '',
    降落时间: '',
    发现异常数: '',
    任务状态: '待执行',
  }
  const confirmed: EntryRow = withBackfilledArea({
    ...report,
    status: '已确认',
    pending: true,
    abnormal: hasLevelConflict(report),
    核实火势等级: String(report['核实火势等级'] ?? '').trim() || String(report['火势等级'] ?? ''),
    扑救情况: '已确认，出动/调拨/巡查任务已生成',
    最近处置时间: stamp,
    报告状态: '已确认',
  }).row
  const nextReports = reports.map((row) => (Number(row.id) === id ? confirmed : row))

  // 落库前留快照，任何一步写失败就整体回退，不留半截处置。
  const snapshot = { firereport: reports, fireteam: teams, drone: drones, supply: supplies }
  try {
    saveRows('fireteam', nextTeams)
    saveRows('drone', [...drones, droneTask])
    saveRows('supply', [...supplies, supplyItem])
    saveRows('firereport', nextReports)
  } catch {
    saveRows('firereport', snapshot.firereport)
    saveRows('fireteam', snapshot.fireteam)
    saveRows('drone', snapshot.drone)
    saveRows('supply', snapshot.supply)
    return { ok: false, message: '处置任务生成失败，已整体回退，请重试' }
  }
  return {
    ok: true,
    message: `火情${reportNo}已确认：${String(team['队伍名称'])}出动、物资调拨与无人机巡查任务已生成`,
  }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  // 核实火情走确认联动：出动待办、调拨清单、巡查任务要么一起生成，要么一个都不生成。
  if (key === 'firereport' && action === '核实火情') {
    return confirmFireReport(id)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const terminal = TERMINAL_STATUSES[key] ?? [meta.statuses[meta.statuses.length - 1]]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !terminal.includes(target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 记录上有「最近处置时间」字段的，每次流转都顺手刷新处置时点。
  if ('最近处置时间' in updated) {
    updated['最近处置时间'] = nowText()
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
