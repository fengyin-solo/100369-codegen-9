// 冒烟测试：在 node 里垫一层 localStorage，验证处置看板与确认联动逻辑。
import { strict as assert } from 'node:assert'

const store = new Map<string, string>()
globalThis.window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
} as any

const svc = await import('../src/api/local-service')
const store1 = await import('../src/data/local-store')

// 1. 看板按林场分组、四阶段分列
const board = svc.loadFireDisposalBoard()
assert.ok(board.farms.length >= 4, '至少四个林场分组')
const farmNames = board.farms.map((f: any) => f.farm)
assert.ok(farmNames.includes('东山林场') && farmNames.includes('北岭林场'), '包含东山/北岭林场')
for (const farm of board.farms) {
  assert.deepEqual(farm.buckets.map((b: any) => b.status), ['待核实', '已确认', '已出警', '已扑灭'])
}

// 2. 历史缺过火面积按等级区间回填并落库
const dong = board.farms.find((f: any) => f.farm === '东山林场')
const pending1 = dong.buckets[0].reports.find((c: any) => c.reportNo === 'FIRE-0001')
assert.ok(pending1.area.endsWith('公顷') && pending1.areaBackfilled, 'FIRE-0001 缺面积已回填')
const v1 = parseFloat(pending1.area)
assert.ok(v1 >= 1 && v1 <= 100, `较大火势回填值 ${v1} 应在 1-100 区间`)
const beiling = board.farms.find((f: any) => f.farm === '北岭林场')
const confirmed7 = beiling.buckets[1].reports.find((c: any) => c.reportNo === 'FIRE-0007')
const v7 = parseFloat(confirmed7.area)
assert.ok(v7 >= 100 && v7 <= 1000, `采信核实「重大」回填值 ${v7} 应在 100-1000 区间`)
const stored = store1.listRows('firereport')
assert.ok(String(stored.find((r: any) => r.id === 1)['过火面积']).endsWith('公顷'), '回填已落库')

// 3. 冲突采信：现场核实优先
const c2 = dong.buckets[1].reports.find((c: any) => c.reportNo === 'FIRE-0002')
assert.equal(c2.level, '较大', 'FIRE-0002 报告一般/核实较大，采信核实')
assert.ok(c2.conflict, 'FIRE-0002 标记冲突')

// 4. 确认火情：三类衍生任务同时生成
const teamsBefore = store1.listRows('fireteam').length
const dronesBefore = store1.listRows('drone').length
const suppliesBefore = store1.listRows('supply').length
const ok = svc.confirmFireReport(1)
assert.ok(ok.ok, `确认应成功: ${ok.message}`)
const report1 = store1.listRows('firereport').find((r: any) => r.id === 1)
assert.equal(report1.status, '已确认')
assert.ok(String(report1['最近处置时间']).length > 0, '最近处置时间已刷新')
const teams = store1.listRows('fireteam')
assert.equal(teams.length, teamsBefore, '不新增队伍，只更新出动状态')
const dispatched = teams.find((t: any) => String(t['出动状态']).includes('FIRE-0001'))
assert.ok(dispatched, '存在出动待办队伍')
assert.equal(dispatched['所属林场'], '东山林场', '顺着林场关系找到东山队伍')
assert.equal(dispatched.status, '已出动')
assert.equal(dispatched.pending, true, '队伍页待办可见')
const drones = store1.listRows('drone')
assert.equal(drones.length, dronesBefore + 1, '新增一条无人机巡查任务')
assert.ok(String(drones[drones.length - 1]['飞行路线']).includes('FIRE-0001'))
const supplies = store1.listRows('supply')
assert.equal(supplies.length, suppliesBefore + 1, '物资台账新增一条调拨处置项')
assert.ok(String(supplies[supplies.length - 1]['物资名称']).includes('FIRE-0001'))
assert.equal(supplies[supplies.length - 1]['储备林场'], '东山林场')

// 5. 重复确认只生效一次
const again = svc.confirmFireReport(1)
assert.ok(!again.ok, '重复确认被拒绝')
assert.equal(store1.listRows('drone').length, dronesBefore + 1, '不产生重复无人机任务')
assert.equal(store1.listRows('supply').length, suppliesBefore + 1, '不产生重复调拨单')
assert.equal(store1.listRows('fireteam').filter((t: any) => String(t['出动状态']).includes('FIRE-0001')).length, 1)

// 6. 经 runAction 走同一联动入口（火情报告页按钮）
const viaAction = svc.runAction('firereport', 5, '核实火情')
assert.ok(viaAction.ok, `runAction 核实火情应成功: ${viaAction.message}`)
assert.ok(store1.listRows('drone').some((d: any) => String(d['飞行路线']).includes('FIRE-0005')))
assert.ok(store1.listRows('supply').some((s: any) => String(s['物资名称']).includes('FIRE-0005')))
assert.ok(store1.listRows('fireteam').some((t: any) => String(t['出动状态']).includes('FIRE-0005') && t['所属林场'] === '南坪林场'))

// 7. 无待命队伍时整体回退：把北岭队伍全部置为扑救中，再确认北岭的新报告
const teamsNow = store1.listRows('fireteam').map((t: any) =>
  t['所属林场'] === '北岭林场' ? { ...t, status: '扑救中' } : t,
)
store1.saveRows('fireteam', teamsNow)
const reports = store1.listRows('firereport')
store1.saveRows('firereport', [...reports, {
  id: 9, status: '待核实', pending: true, abnormal: false,
  报告编号: 'FIRE-0009', 所属林场: '北岭林场', 起火地点: '北岭林场西坡', 起火时间: '2026-10-04 08:00',
  火势等级: '一般', 核实火势等级: '', 报告来源: '群众报警', 过火面积: '', 扑救情况: '待核实',
  报告人: '测试', 最近处置时间: '2026-10-04 08:00', 报告状态: '待核实',
}])
const dBefore = store1.listRows('drone').length
const sBefore = store1.listRows('supply').length
const fail = svc.confirmFireReport(9)
assert.ok(!fail.ok, '无待命队伍应失败')
assert.ok(fail.message.includes('北岭林场'), fail.message)
assert.equal(store1.listRows('firereport').find((r: any) => r.id === 9).status, '待核实', '报告状态回退')
assert.equal(store1.listRows('drone').length, dBefore, '无人机任务未残留')
assert.equal(store1.listRows('supply').length, sBefore, '调拨单未残留')

// 8. 后续流转：出动扑救 → 确认扑灭，最近处置时间刷新
const dispatch = svc.runAction('firereport', 2, '出动扑救')
assert.ok(dispatch.ok)
assert.equal(store1.listRows('firereport').find((r: any) => r.id === 2).status, '已出警')
const out = svc.runAction('firereport', 3, '确认扑灭')
assert.ok(out.ok)
const r3 = store1.listRows('firereport').find((r: any) => r.id === 3)
assert.equal(r3.status, '已扑灭')
assert.equal(r3.pending, false, '已扑灭是终态不算待处理')

console.log('全部冒烟断言通过')
