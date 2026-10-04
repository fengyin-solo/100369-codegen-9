// 火情处置联动逻辑的纯 Node 断言脚本：用 esbuild 打包后在 Node 中运行。
import { SEED_ROWS } from '../src/data/seed'

// local-store 在读取时会判断 window/localStorage，这里先装好垫片。
const memory = new Map<string, string>()
const store: Storage = {
  get length() {
    return memory.size
  },
  clear: () => memory.clear(),
  getItem: (key: string) => (memory.has(key) ? (memory.get(key) as string) : null),
  key: (index: number) => [...memory.keys()][index] ?? null,
  removeItem: (key: string) => void memory.delete(key),
  setItem: (key: string, value: string) => void memory.set(key, value),
}
;(globalThis as { window?: unknown }).window = { localStorage: store }
;(globalThis as { localStorage?: unknown }).localStorage = store
;(globalThis as { location?: { reload: () => void } }).location = { reload: () => undefined }

const { allRows, resetRows, saveRows } = await import('../src/data/local-store')
const {
  boardGroups,
  boardCounts,
  confirmFire,
  dispatchFire,
  extinguishFire,
  rejectFire,
  resolveLevel,
} = await import('../src/api/fireboard')
import type { EntryRow } from '../src/data/types'

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exitCode = 1
    throw new Error(msg)
  } else {
    console.log('PASS:', msg)
  }
}

function findReport(code: string): EntryRow {
  const r = allRows().firereport.find((x) => x['报告编号'] === code)
  if (!r) throw new Error('missing ' + code)
  return r
}
function linked(table: string, code: string) {
  return allRows()[table].filter((x) => String(x['关联火情编号'] ?? '') === code)
}

// 初始看板
const counts0 = Object.fromEntries(boardCounts().map((x) => [x.status, x.count]))
assert(counts0['待核实'] === 3, `初始待核实 3 起，实际 ${counts0['待核实']}`)
assert(counts0['已确认'] === 2, `初始已确认 2 起，实际 ${counts0['已确认']}`)
assert(counts0['已出警'] === 1, `初始已出警 1 起`)
assert(counts0['已扑灭'] === 2, `初始已扑灭 2 起`)
const groups = boardGroups()
assert(groups.length === 4, `按 4 个林场分组，实际 ${groups.length}`)
assert(groups.every((g) => g.columns.length === 4), '每组四列状态')

// 采信顺序：来源Ⅲ vs 现场Ⅱ → 采信现场
const lvl4 = resolveLevel(findReport('FR-2026-004'))
assert(lvl4.level.includes('Ⅱ') && lvl4.conflict, 'FR-004 冲突时采信现场核实Ⅱ级')

// 缺面积
const fr1 = findReport('FR-2026-001')
assert(String(fr1['过火面积']) === '', 'FR-001 初始缺过火面积')

// 正常确认
const beforeStock = (allRows().supply.find(
  (s) => s['储备林场'] === '青岗林场' && s['物资名称'] === '风力灭火机',
) as EntryRow)['实际储备量']
let res = confirmFire(Number(fr1.id))
assert(res.ok, 'FR-001 确认成功：' + res.message)
const code1 = 'FR-2026-001'
assert(linked('fireteam', code1).length === 1, '生成 1 条队伍出动待办')
assert(linked('allocation', code1).length === 6, '生成 6 条物资调拨清单项')
assert(linked('drone', code1).length === 1, '生成 1 条无人机巡查任务')
assert(String(findReport(code1)['过火面积']) === '1000', `缺面积按Ⅳ级区间回填 1000 亩，实际 ${findReport(code1)['过火面积']}`)
assert(findReport(code1).status === '已确认', '火情状态变为已确认')
const teamTodo = linked('fireteam', code1)[0]
assert(String(teamTodo['所属林场']) === '青岗林场', '待办顺着火情→队伍的林场关系派出')
assert(String(teamTodo['记录类型']) === '出动待办', '待办标记为处置事项')
const afterStock = (allRows().supply.find(
  (s) => s['储备林场'] === '青岗林场' && s['物资名称'] === '风力灭火机',
) as EntryRow)['实际储备量']
assert(Number(afterStock) === Number(beforeStock) - 8, `风力灭火机库存按Ⅳ级基数扣减 8（${beforeStock}→${afterStock}）`)

// 幂等
res = confirmFire(Number(fr1.id))
assert(!res.ok && res.message.includes('重复确认'), '重复确认被幂等拦截：' + res.message)
assert(linked('fireteam', code1).length === 1, '重复确认不新增队伍待办')
assert(linked('allocation', code1).length === 6, '重复确认不新增调拨项')
assert(linked('drone', code1).length === 1, '重复确认不新增无人机任务')

// 出警联动
res = dispatchFire(Number(fr1.id))
assert(res.ok, 'FR-001 出警成功：' + res.message)
assert(linked('fireteam', code1).every((t) => String(t.status) === '已出动'), '队伍待办已出动')
assert(linked('allocation', code1).every((t) => String(t.status) === '已出库'), '调拨项已出库')
assert(linked('drone', code1).every((t) => String(t.status) === '飞行中'), '无人机任务飞行中')
assert(findReport(code1).status === '已出警', '火情状态变为已出警')

// 扑灭联动
res = extinguishFire(Number(fr1.id))
assert(res.ok, 'FR-001 扑灭成功：' + res.message)
assert(findReport(code1).status === '已扑灭', '火情状态变为已扑灭')
assert(linked('drone', code1).every((t) => String(t.status) === '已完成'), '无人机任务已完成')

// 误报无任务
res = rejectFire(Number(findReport('FR-2026-007').id))
assert(res.ok && linked('fireteam', 'FR-2026-007').length === 0, 'FR-007 确认误报且无联动任务')

// 回滚①库存不足：FR-002 青岗 Ⅱ级
{
  const snap = JSON.stringify(allRows())
  const r = confirmFire(Number(findReport('FR-2026-002').id))
  assert(!r.ok && r.message.includes('回退'), 'FR-002 库存不足确认失败并提示回退：' + r.message)
  assert(JSON.stringify(allRows()) === snap, '失败后所有表无任何改动（整体回退）')
  assert(findReport('FR-2026-002').status === '待核实', '回滚后火情仍为待核实')
}

// 回滚②无待命队伍：云岭唯一在营队改为休整，再试待核实的 FR-007（先恢复为待核实）
{
  resetRows('firereport')
  const teams = allRows().fireteam.map((t) =>
    String(t['所属林场']) === '云岭林场' && String(t.status) === '在营待命'
      ? { ...t, status: '休整中', 出动状态: '休整中' }
      : t,
  )
  saveRows('fireteam', teams)
  const fr7 = findReport('FR-2026-007')
  const snap = JSON.stringify(allRows())
  const r = confirmFire(Number(fr7.id))
  assert(!r.ok && r.message.includes('在营待命'), '云岭无待命队伍时确认失败：' + r.message)
  assert(JSON.stringify(allRows()) === snap, '无队伍失败同样整体回退')
}

// 种子幂等：已确认的 FR-003 重复确认不产生重复任务
{
  resetRows('firereport')
  resetRows('fireteam')
  resetRows('allocation')
  resetRows('drone')
  resetRows('supply')
  const r = confirmFire(Number(findReport('FR-2026-003').id))
  assert(!r.ok && r.message.includes('重复确认'), '种子里已确认的 FR-003 重复确认不产生任务')
  assert(linked('fireteam', 'FR-2026-003').length === 1, 'FR-003 仍只有 1 条待办')
  assert(linked('allocation', 'FR-2026-003').length === 6, 'FR-003 仍只有 6 条调拨')
  assert(linked('drone', 'FR-2026-003').length === 1, 'FR-003 仍只有 1 条无人机任务')
}

// 数据量健全性
assert(allRows().supply.length === 24, `物资库存 4 林场 × 6 类 = 24，实际 ${allRows().supply.length}`)
assert(allRows().allocation.length === 30, `台账 5 起历史火情 × 6 = 30，实际 ${allRows().allocation.length}`)
assert(SEED_ROWS.allocation.length === 30, '种子台账 30 条')

console.log('\n全部断言完成')
