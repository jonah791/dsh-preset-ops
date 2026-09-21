/**
 * dsh-preset-ops 离线单测：只测 lib/runner.js 里的纯函数（无 I/O、无平台假设）。
 * 跑法: node --test "tests/*.test.mjs"（先 pnpm run build）
 * 纪律: 夹具不得触碰生产资产——本文件只喂内存字符串。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  childEnv, classifyFailure, dualWriteReport, flattenOrder, gateVerdict, gitCommand, headLines,
  joinPath, normDir, parseAssemble, parseDiffJson, parseVerify, pickBaseline, resolvePaths,
  stepCommand, tailLines, verdictHint,
} from '../lib/runner.js'

test('flattenOrder 认分组嵌套（ST 真实形状）与平铺两种', () => {
  const nested = [{ character_id: 100000, order: [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: false }] }]
  assert.deepEqual(flattenOrder(nested), [{ identifier: 'a', enabled: true }, { identifier: 'b', enabled: false }])
  assert.deepEqual(flattenOrder([{ identifier: 'a', enabled: true }]), [{ identifier: 'a', enabled: true }])
  // 尸体测试：畸形输入不抛，且不臆造条目
  for (const junk of [null, undefined, 0, 'x', {}, [], [{}]]) assert.deepEqual(flattenOrder(junk), [])
})

test('flattenOrder 不重复计数（自引用结构不无限递归）', () => {
  const node = { identifier: 'a', enabled: true, order: [] }
  node.order.push(node)
  assert.equal(flattenOrder([node]).length, 1)
})

test('dualWriteReport：空集不许当通过（假绿防线）', () => {
  const prompts = [{ identifier: 'a', enabled: true }]
  const empty = dualWriteReport(prompts, [])
  assert.equal(empty.comparable, 0)
  assert.equal(empty.consistent, false)
  const ok = dualWriteReport(prompts, [{ identifier: 'a', enabled: true }])
  assert.equal(ok.consistent, true)
  assert.equal(ok.comparable, 1)
  const bad = dualWriteReport(prompts, [{ identifier: 'a', enabled: false }])
  assert.equal(bad.consistent, false)
  assert.deepEqual(bad.mismatched, ['a'])
  const partial = dualWriteReport(prompts, [{ identifier: 'a', enabled: true }, { identifier: 'zzz', enabled: true }])
  assert.equal(partial.unchecked, 1)
})

test('pickBaseline 按数值版本挑最高，而非字典序', () => {
  const names = ['色欲之罪V3.3.json', '色欲之罪V3.10.json', '色欲之罪V2.9.json', '色欲之罪.json', 'README.md']
  assert.equal(pickBaseline(names), '色欲之罪V3.10.json')
  assert.equal(pickBaseline([]), '色欲之罪.json')
  assert.equal(pickBaseline(['README.md']), '色欲之罪.json')
})

test('normDir / joinPath 跨 Windows 与正斜杠两种写法统一', () => {
  assert.equal(normDir('E:\\alice\\tavern\\'), 'E:/alice/tavern')
  assert.equal(normDir('E:/alice/tavern'), 'E:/alice/tavern')
  assert.equal(joinPath('E:\\alice\\tavern\\', '色欲之罪.json'), 'E:/alice/tavern/色欲之罪.json')
  assert.equal(joinPath('E:/a', '/b/c.json'), 'E:/a/b/c.json')
})

test('resolvePaths 派生产物与度量目录', () => {
  const p = resolvePaths({ presetDir: 'E:\\alice\\tavern\\色欲之罪预设', workspaceRoot: 'E:\\alice\\tavern' })
  assert.equal(p.productJson, 'E:/alice/tavern/色欲之罪预设/色欲之罪.json')
  assert.equal(p.runtimeJson, 'E:/alice/tavern/色欲之罪.json')
  assert.equal(p.baselineJson, 'E:/alice/tavern/色欲之罪V3.3.json')
  assert.equal(p.metricsDir, 'E:/alice/tavern/文风/位格统计')
  assert.equal(p.materialsDir, 'E:/alice/tavern/素材')
  assert.equal(p.pythonExe, 'python')
})

test('resolvePaths 支持绝对路径基准与自定义解释器', () => {
  const p = resolvePaths({ presetDir: 'D:/x', workspaceRoot: 'D:/y', baselineJson: 'E:/z/V9.9.json', pythonExe: 'py -3' })
  assert.equal(p.baselineJson, 'E:/z/V9.9.json')
  assert.equal(p.pythonExe, 'py -3')
})

test('stepCommand：预设脚本从 presetDir 跑，度量脚本从 metricsDir 跑', () => {
  const p = resolvePaths({ presetDir: 'E:/t/p', workspaceRoot: 'E:/t' })
  const build = stepCommand(p, 'build')
  assert.equal(build.cwd, 'E:/t/p')
  assert.equal(build.argv[0], 'E:/t/p/build.py')
  const assemble = stepCommand(p, 'assemble')
  assert.equal(assemble.argv[1], 'E:/t/p/色欲之罪.json')
  const slots = stepCommand(p, 'slots')
  assert.equal(slots.cwd, 'E:/t/文风/位格统计')
  assert.equal(slots.argv[0], 'E:/t/文风/位格统计/slot_stats.py')
  assert.equal(slots.argv[1], 'E:/t/素材')
  const attention = stepCommand(p, 'attention')
  assert.equal(attention.argv[1], 'E:/t/p/source.md')
})

test('gitCommand 把 -C 放在最前，避免 cwd 失效时改错仓库', () => {
  const p = resolvePaths({ presetDir: 'E:/t/p', workspaceRoot: 'E:/t' })
  assert.deepEqual(gitCommand(p, ['status', '--porcelain']).argv, ['-C', 'E:/t/p', 'status', '--porcelain'])
})

test('childEnv 强制 Python 的 UTF-8 输出（否则中文报 UnicodeEncodeError）', () => {
  const env = childEnv({ PATH: 'x' })
  assert.equal(env.PYTHONIOENCODING, 'utf-8')
  assert.equal(env.PYTHONUTF8, '1')
  assert.equal(env.PATH, 'x')
})

test('classifyFailure 区分「跑不动」与「跑了没过」', () => {
  assert.equal(classifyFailure({ code: 0, stdout: '', stderr: '', timedOut: false }).kind, 'ok')
  assert.equal(classifyFailure({ code: 1, stdout: '', stderr: '', timedOut: false }).kind, 'script-failed')
  assert.equal(classifyFailure({ code: null, stdout: '', stderr: '', timedOut: true }).kind, 'timeout')
  assert.equal(classifyFailure({ code: 1, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT' }, true).kind, 'python-missing')
  assert.equal(classifyFailure({ code: 1, stdout: '', stderr: '', timedOut: false, spawnError: 'ENOENT' }, false).kind, 'script-missing')
  assert.equal(classifyFailure({ code: 1, stdout: '', stderr: '', timedOut: false, spawnError: 'EACCES' }).kind, 'spawn-failed')
})

test('verdictHint 认得假红与三个已知坑', () => {
  assert.match(verdictHint('Traceback ... BrokenPipeError'), /假红/)
  assert.match(verdictHint('json.decoder.JSONDecodeError: Unexpected UTF-8 BOM'), /BOM/)
  assert.match(verdictHint('回环不一致: 3 处'), /回环不一致/)
  assert.equal(verdictHint('随便什么'), '脚本退出码非 0：读它的输出判断是内容问题还是环境问题')
})

test('parseVerify 只服务展示，裁决仍看退出码', () => {
  const out = '检查1 OK\n检查2 FAIL\n结论: 有问题\n'
  const r = parseVerify(out)
  assert.equal(r.items.length >= 2, true)
  assert.equal(r.items[1].ok, false)
  assert.match(r.conclusion, /有问题/)
  assert.equal(parseVerify('').items.length, 0)
})

test('parseAssemble 判 healthy 行', () => {
  assert.equal(parseAssemble('assembly healthy: no order/dangling issues').healthy, true)
  assert.equal(parseAssemble('dangling reference at order[3]').healthy, false)
})

test('parseDiffJson 解析真实形状并判断等价', () => {
  const sample = JSON.stringify({
    top: [], blocks: [{ key: '位格调度', fields: [], chars: [1, 966], delta: 965, content_changed: true }],
    order: null, ext: [], counts: { prompts_old: 73, prompts_new: 74, added: ['位格调度'], removed: [] },
  })
  const r = parseDiffJson('前置噪声\n' + sample)
  assert.equal(r.ok, true)
  assert.equal(r.identical, false)
  assert.equal(r.blocks[0].name, '位格调度')
  assert.equal(r.totalDelta, 965)
  assert.deepEqual(r.added, ['位格调度'])
})

test('parseDiffJson 尸体测试：垃圾输入不抛异常，且不假装成功', () => {
  for (const junk of ['', 'not json at all', '{ broken', '[]']) {
    const r = parseDiffJson(junk)
    assert.equal(r.ok, false)
    assert.equal(r.blocks.length, 0)
  }
})

test('gateVerdict 报「断在哪一步」', () => {
  const ok = gateVerdict([
    { step: 'build', code: 0, kind: 'ok', hint: '', head: '' },
    { step: 'verify', code: 0, kind: 'ok', hint: '', head: '' },
  ])
  assert.equal(ok.ok, true)
  const bad = gateVerdict([
    { step: 'build', code: 0, kind: 'ok', hint: '', head: '' },
    { step: 'verify', code: 1, kind: 'script-failed', hint: '回环不一致：确认差异是本批预期', head: '' },
  ])
  assert.equal(bad.ok, false)
  assert.equal(bad.blockedAt, 'verify')
  assert.match(bad.reason, /回环不一致/)
  const missing = gateVerdict([{ step: 'build', code: null, kind: 'python-missing', hint: '找不到解释器', head: '' }])
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /python-missing/)
})

test('headLines / tailLines 过滤空行并截断', () => {
  const text = 'a\n\nb\nc\nd\ne\n'
  assert.equal(headLines(text, 2), 'a\nb')
  assert.equal(tailLines(text, 2), 'd\ne')
  assert.equal(headLines('', 3), '')
})
