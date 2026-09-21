/**
 * dsh-preset-ops：预设工程流程助手（配合技能 tavern-preset-iteration）。
 *
 * 把「五态流程」里可判据的步骤做成工具，让流程不靠记忆：
 *   preset_status  只读体检：三处 md5 一致 / 启用态双写 / 块数 / 字符 / git 状态
 *   preset_gate    S4 闸门：build -> verify -> assemble，**以退出码为裁决**，报「断在哪一步」
 *   preset_diff    S4-4 逐字段比对：打印「有改动的块」清单（重构安全带）
 *   preset_metrics S1/S4-5 度量：位格统计 / 注意力预算 / 酒馆实测取证
 *   preset_release S5 发布：三处同步 + tag，**默认干跑**，且 verify 未过一律拒绝
 *
 * 边界（不做什么）：不写预设内容（内容只从 source.md 进）；不 push（本项目不开源，只做本地仓库）；
 * 不替主人裁决改什么。工具只搬动事实与判据。
 * 2026-09-21 立：主人「规范一下预设的创作和迭代流程，并创建出一个插件来辅助」。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, readFile, readdir, stat } from 'node:fs/promises'
import {
  childEnv, classifyFailure, diffCommand, dualWriteReport, flattenOrder, gateVerdict, gitCommand,
  headLines, joinPath, parseAssemble, parseDiffJson, parseVerify, pickBaseline, resolvePaths,
  stepCommand, tailLines,
} from './runner.js'
import type { Cmd, FailureKind, GateStep, Step } from './runner.js'

export const name = 'agent-preset-ops'
export const inject = ['tools'] as const

export interface Config {
  enabled: boolean
  presetDir: string
  workspaceRoot: string
  baselineJson: string
  pythonExe: string
  timeoutMs: number
}

export const Config = z.object({
  enabled: z.boolean().default(true),
  presetDir: z.string().default('E:/alice/tavern/色欲之罪预设'),
  workspaceRoot: z.string().default('E:/alice/tavern'),
  baselineJson: z.string().default(''),
  pythonExe: z.string().default('python'),
  timeoutMs: z.number().default(180000),
})

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError?: string
}

function run(cmd: Cmd, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd.file, cmd.argv, {
      cwd: cmd.cwd, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true, encoding: 'utf8',
      env: childEnv(process.env),
    }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: number | string; killed?: boolean }) | null
      let code: number | null = 0
      if (e) {
        if (typeof e.code === 'number') code = e.code
        else if (e.code === 'ETIMEDOUT' || e.killed) code = null
        else code = 1
      }
      resolve({
        code,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        timedOut: Boolean(e && (e.killed === true || e.code === 'ETIMEDOUT')),
        spawnError: e && typeof e.code === 'string' && e.code !== 'ETIMEDOUT' ? String(e.code) : undefined,
      })
    })
  })
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true } catch { return false }
}

async function md5(p: string): Promise<string> {
  try {
    const buf = await readFile(p)
    return createHash('md5').update(buf).digest('hex').toUpperCase()
  } catch { return '' }
}

async function runStep(cmd: Cmd, timeoutMs: number, scriptPath: string): Promise<RunResult & { kind: FailureKind; hint: string }> {
  const out = await run(cmd, timeoutMs)
  const scriptExists = await exists(scriptPath)
  const cls = classifyFailure(out, scriptExists)
  return { ...out, ...cls }
}

export function apply(ctx: Context, config: Config): void {
  const logger = ctx.logger('agent-preset-ops')
  const paths = () => resolvePaths({
    presetDir: config.presetDir,
    workspaceRoot: config.workspaceRoot,
    baselineJson: config.baselineJson,
    pythonExe: config.pythonExe,
  })

  /** 基准产物缺省值：扫描工作区根目录里版本号最高的 `色欲之罪V*.json`。 */
  async function effectiveBaseline(): Promise<string> {
    const p = paths()
    if (config.baselineJson.trim()) return p.baselineJson
    try {
      const names = await readdir(p.workspaceRoot)
      const picked = pickBaseline(names)
      return joinPath(p.workspaceRoot, picked)
    } catch {
      return p.baselineJson
    }
  }

  ctx.tools.register(defineTool({
    name: 'preset_status',
    description: '预设体检（只读，零副作用）：产物/基准/运行版三处 md5 是否一致、块数与启用态双写是否自洽、启用内容字符数、git 是否干净与最新 tag。用于任何改动前后确认"现在是什么状态"。',
    parameters: {
      baseline: { type: 'string', description: '基准产物文件名或绝对路径（缺省=扫描工作区里版本号最高的 色欲之罪V*.json）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          presetDir: { type: 'string' },
          baseline: { type: 'string' },
          md5: { type: 'array', items: { type: 'object', additionalProperties: true } },
          threeWayConsistent: { type: 'boolean' },
          prompts: { type: 'number' },
          orderEntries: { type: 'number' },
          enabledPrompts: { type: 'number' },
          enabledOrder: { type: 'number' },
          dualWriteConsistent: { type: 'boolean' },
          enabledContentChars: { type: 'number' },
          gitHead: { type: 'string' },
          gitTag: { type: 'string' },
          gitDirty: { type: 'string' },
          warnings: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
      },
      render: (_a: unknown, v: any) => {
        if (v.error) return [{ type: 'text', text: 'preset_status 错误: ' + v.error }]
        const lines = [
          `状态: ${v.ok ? 'OK' : '有告警'} | 三处 md5 ${v.threeWayConsistent ? '一致' : '不一致'} | 启用态双写 ${v.dualWriteConsistent ? '一致' : '不一致'}`,
          `块数 ${v.prompts} / order ${v.orderEntries}（已摊平分组）/ 启用 prompts ${v.enabledPrompts} vs order ${v.enabledOrder} / 启用块正文合计 ${v.enabledContentChars} 字符（口径：enabled===true 的 content）`,
          `git: ${v.gitHead || '(非仓库?)'} ${v.gitTag ? 'tag=' + v.gitTag : '(无 tag)'} ${v.gitDirty ? '| 有未提交改动' : '| 工作树干净'}`,
          ...(v.md5 ?? []).map((m: any) => `  ${m.role}: ${m.exists ? m.md5 : '(缺失)'} ${m.path}`),
          ...(v.warnings ?? []).map((w: string) => '  ⚠ ' + w),
        ]
        if (v.gitDirty) lines.push('未提交改动:\n' + String(v.gitDirty).trim())
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: { baseline?: string }): Promise<any> {
      const p = paths()
      const baseline = args.baseline && args.baseline.includes('/') ? args.baseline
        : (args.baseline ? joinPath(p.workspaceRoot, args.baseline) : await effectiveBaseline())
      const warnings: string[] = []
      const files = [
        { role: '基准', path: baseline },
        { role: '运行版', path: p.runtimeJson },
        { role: '产物', path: p.productJson },
      ]
      const md5s: Array<{ role: string; path: string; exists: boolean; md5: string }> = []
      for (const f of files) {
        const ex = await exists(f.path)
        md5s.push({ role: f.role, path: f.path, exists: ex, md5: ex ? await md5(f.path) : '' })
        if (!ex) warnings.push(`${f.role} 文件缺失: ${f.path}`)
      }
      const present = md5s.filter((m) => m.exists)
      const threeWayConsistent = present.length >= 2 && new Set(present.map((m) => m.md5)).size === 1

      let prompts = 0, orderEntries = 0, enabledPrompts = 0, enabledOrder = 0, enabledContentChars = 0
      let dualWriteConsistent = false
      let productErr = ''
      try {
        const data = JSON.parse(await readFile(p.productJson, 'utf8')) as Record<string, any>
        const ps: any[] = data.prompts ?? []
        prompts = ps.length
        // ST 的 prompt_order 是分组嵌套（[{character_id, order:[…]}]）——必须摊平；
        // 按平铺读会得到「order 1」这种荒谬读数，并让双写检查在空集上判「一致」（假绿，2026-09-21 实测捕获）。
        const entries = flattenOrder(data.prompt_order)
        orderEntries = entries.length
        enabledPrompts = ps.filter((x) => x?.enabled === true).length
        enabledOrder = entries.filter((e) => e.enabled === true).length
        const missingEnabled = ps.filter((x) => typeof x?.enabled !== 'boolean').length
        const dw = dualWriteReport(ps, entries)
        dualWriteConsistent = dw.consistent
        if (entries.length === 0) {
          warnings.push('prompt_order 摊平后为空或结构未识别——双写检查无数据，不算通过')
        } else if (!dw.consistent) {
          warnings.push(`启用态双写不一致: ${dw.mismatched.length} 条（可比对 ${dw.comparable} / 未比对 ${dw.unchecked}）`)
        }
        if (missingEnabled > 0) warnings.push(`有 ${missingEnabled} 个块没有 enabled 键（启用计数只认 enabled===true）`)
        // 口径显式：启用块（enabled===true）的正文合计——与文档里「启用内容块」的旧口径不可直接比
        enabledContentChars = ps
          .filter((x) => x?.enabled === true && typeof x?.content === 'string')
          .reduce((s, x) => s + String(x.content).length, 0)
      } catch (e) {
        productErr = String((e as Error)?.message ?? e)
        warnings.push('产物不可解析（先跑 build）: ' + productErr)
      }

      const git: Record<string, string> = { head: '', tag: '', dirty: '' }
      try {
        const h = await run(gitCommand(p, ['log', '-1', '--oneline']), 20000)
        git.head = h.stdout.trim()
        const t = await run(gitCommand(p, ['describe', '--tags', '--abbrev=0']), 20000)
        git.tag = t.code === 0 ? t.stdout.trim() : ''
        const d = await run(gitCommand(p, ['status', '--porcelain']), 20000)
        git.dirty = d.stdout
      } catch { warnings.push('git 不可用或目录非仓库') }

      return {
        ok: warnings.length === 0,
        presetDir: p.presetDir,
        baseline,
        md5: md5s,
        threeWayConsistent,
        prompts, orderEntries, enabledPrompts, enabledOrder, dualWriteConsistent,
        enabledContentChars,
        gitHead: git.head, gitTag: git.tag, gitDirty: git.dirty,
        warnings,
        error: productErr ? '' : '',
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'preset_gate',
    description: 'S4 验证闸门：按序跑 build.py → verify.py → assemble.py（可用 steps 收窄）。裁决只看退出码；失败时报「断在哪一步 + 属于哪类失败（脚本问题/解释器缺失/超时/假红）」。构建产物通过 build.py 生成，不直接改 json。',
    parameters: {
      steps: { type: 'array', description: '要跑的步骤子集（缺省 build,verify,assemble）' },
      target: { type: 'string', description: '组装模拟的目标 json（缺省=build 产物）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          blockedAt: { type: 'string' },
          reason: { type: 'string' },
          steps: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_a: unknown, v: any) => {
        const lines = (v.steps ?? []).map((s: any) =>
          `[${s.code === 0 ? 'PASS' : 'FAIL'}] ${s.step} exit=${s.code} ${s.kind}${s.hint ? ' | ' + s.hint : ''}\n${s.head ? '    ' + String(s.head).replace(/\n/g, '\n    ') : ''}`)
        const head = v.ok
          ? 'S4 闸门: 全绿（可以进 S5 发布）'
          : `S4 闸门: 阻断于 [${v.blockedAt}] —— ${v.reason}`
        return [{ type: 'text', text: head + '\n' + lines.join('\n') }]
      },
    },
    async execute(args: { steps?: string[]; target?: string }): Promise<any> {
      const p = paths()
      const want = (args.steps && args.steps.length ? args.steps : ['build', 'verify', 'assemble']) as Step[]
      const order: Step[] = ['build', 'verify', 'assemble']
      const steps: GateStep[] = []
      for (const step of order) {
        if (!want.includes(step)) continue
        const cmd = stepCommand(p, step, { target: step === 'assemble' ? args.target : undefined })
        const scriptPath = String(cmd.argv[0])
        logger.info(`S4 ${step}: ${cmd.file} ${cmd.argv.slice(1).join(' ')}`)
        const r = await runStep(cmd, config.timeoutMs, scriptPath)
        const head = step === 'assemble' ? (parseAssemble(r.stdout).line || headLines(r.stdout, 3))
          : step === 'verify' ? (parseVerify(r.stdout).conclusion || headLines(r.stdout, 4))
            : tailLines(r.stdout, 3)
        steps.push({ step, code: r.code, kind: r.kind, hint: r.hint, head })
        // 语义精确性：跑不动（解释器/超时）与跑了没过分开报，且跑不动就停，不掩盖
        if (r.code !== 0) break
      }
      const verdict = gateVerdict(steps)
      return { ok: verdict.ok, blockedAt: verdict.blockedAt, reason: verdict.reason, steps }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'preset_diff',
    description: 'S4-4 逐字段比对两版预设 json，输出「有改动的块」清单（含字符增减、字段变动、顺序与 extensions 变化）。用于重构后证明"只改了该改的"——主人的措辞与词料不许被顺手动过。',
    parameters: {
      old: { type: 'string', description: '旧/参照 json（缺省=基准产物）' },
      new: { type: 'string', description: '新 json（缺省=build 产物）' },
      verbose: { type: 'boolean', description: '打印字段级旧值/新值' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          identical: { type: 'boolean' },
          old: { type: 'string' },
          new: { type: 'string' },
          blocks: { type: 'array', items: { type: 'object', additionalProperties: true } },
          added: { type: 'array', items: { type: 'string' } },
          removed: { type: 'array', items: { type: 'string' } },
          topKeys: { type: 'array', items: { type: 'string' } },
          orderChanged: { type: 'boolean' },
          extChanged: { type: 'array', items: { type: 'string' } },
          totalDelta: { type: 'number' },
          raw: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_a: unknown, v: any) => {
        if (v.error) {
          const why = String(v.raw ?? '').trim()
          return [{
            type: 'text',
            text: `preset_diff 错误: ${v.error}\n输入旧: ${v.old}\n输入新: ${v.new}`
              + (why ? `\n脚本原话（失败必带原因，不吞异常）:\n${why}` : ''),
          }]
        }
        if (v.identical) return [{ type: 'text', text: `两版逐字段等价（无差异）\n  ${v.old}\n  ${v.new}` }]
        const lines = [
          `改动概览: 内容块 ${v.blocks.length} 个（合计 ${v.totalDelta >= 0 ? '+' : ''}${v.totalDelta} 字符）`
            + (v.added.length ? ` | 新增块 ${v.added.length}` : '')
            + (v.removed.length ? ` | 删除块 ${v.removed.length}` : '')
            + (v.topKeys.length ? ` | 顶层参数 ${v.topKeys.join(',')}` : '')
            + (v.orderChanged ? ' | 发送顺序有变' : ''),
        ]
        for (const b of v.blocks) lines.push(`  ${b.name} | ${b.delta >= 0 ? '+' : ''}${b.delta} 字符${b.contentChanged ? ' [content]' : ''}`)
        for (const a of v.added) lines.push(`  + ${a}`)
        for (const r of v.removed) lines.push(`  - ${r}`)
        if (v.extChanged?.length) lines.push('  extensions 变化: ' + v.extChanged.join(', '))
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: { old?: string; new?: string; verbose?: boolean }): Promise<any> {
      const p = paths()
      const baseline = await effectiveBaseline()
      const oldJson = args.old || baseline
      const newJson = args.new || p.productJson
      const cmd = diffCommand(p, oldJson, newJson, args.verbose === true)
      const scriptPath = String(cmd.argv[0])
      const r = await runStep(cmd, config.timeoutMs, scriptPath)
      const rep = parseDiffJson(r.stdout)
      if (!rep.ok) {
        return {
          ok: false, identical: false, old: oldJson, new: newJson, blocks: [], added: [], removed: [],
          topKeys: [], orderChanged: false, extChanged: [], totalDelta: 0,
          raw: tailLines(r.stdout + '\n' + r.stderr, 12), error: r.hint || '输出不可解析（脚本或路径问题）',
        }
      }
      return {
        ok: true, identical: rep.identical, old: oldJson, new: newJson,
        blocks: rep.blocks, added: rep.added, removed: rep.removed, topKeys: rep.topKeys,
        orderChanged: rep.orderChanged, extChanged: rep.extChanged, totalDelta: rep.totalDelta,
        raw: '', error: '',
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'preset_metrics',
    description: '度量：位格统计（slots，词表唯一真源在 slot_stats.py）/ 思考链注意力预算（attention）/ 酒馆实测取证（forensics，含基准现算与词表指纹）。返回每项的退出码与关键行——百分比结论必须连同"由哪张词表、哪个切分得到"一起读。',
    parameters: {
      kind: { type: 'string', description: 'slots | attention | forensics | all（缺省 all）' },
      target: { type: 'string', description: 'slots 的文本目录 / attention 的 source.md / forensics 的日志目录' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          results: { type: 'array', items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_a: unknown, v: any) => {
        const lines = (v.results ?? []).map((r: any) =>
          `[${r.code === 0 ? 'PASS' : 'FAIL'}] ${r.kind} exit=${r.code}${r.hint ? ' | ' + r.hint : ''}\n${r.excerpt || ''}`)
        return [{ type: 'text', text: lines.join('\n\n') }]
      },
    },
    async execute(args: { kind?: string; target?: string }): Promise<any> {
      const p = paths()
      const want: Step[] = args.kind && args.kind !== 'all'
        ? [args.kind as Step]
        : ['slots', 'attention', 'forensics']
      const results: any[] = []
      for (const kind of want) {
        if (!['slots', 'attention', 'forensics'].includes(kind)) {
          results.push({ kind, code: -1, hint: '未知度量类型（slots|attention|forensics|all）', excerpt: '' })
          continue
        }
        const cmd = stepCommand(p, kind, { target: args.target })
        const r = await runStep(cmd, config.timeoutMs, String(cmd.argv[0]))
        const excerpt = kind === 'slots' ? (tailLines(r.stdout, 8) || headLines(r.stdout, 8)) : headLines(r.stdout, 12)
        results.push({ kind, code: r.code, hint: r.hint, excerpt })
      }
      return { ok: results.every((r) => r.code === 0), results }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'preset_release',
    description: 'S5 发布：三处同步（产物 → 新基准文件 + 运行版）+ git commit/tag。默认干跑（dryRun=true）只报计划；verify.py 未过一律拒绝执行。不 push（本项目不开源，只做本地仓库）。',
    parameters: {
      version: { type: 'string', required: true, description: '新版本号（如 3.4 → 色欲之罪V3.4.json）' },
      message: { type: 'string', description: 'commit 信息（缺省自动生成）' },
      dryRun: { type: 'boolean', description: 'true=只报计划不写入（缺省 true）' },
      skipVerify: { type: 'boolean', description: '跳过 verify 前置门（仅当你在别处刚跑过；高风险）' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          dryRun: { type: 'boolean' },
          refused: { type: 'string' },
          verifyHead: { type: 'string' },
          plan: { type: 'array', items: { type: 'string' } },
          done: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
      },
      render: (_a: unknown, v: any) => {
        if (v.refused) return [{ type: 'text', text: `发布被拒: ${v.refused}\n（前置门输出）\n${v.verifyHead || ''}` }]
        const lines = [`发布${v.dryRun ? '（干跑，未写入）' : '（已执行）'}: ${v.ok ? 'OK' : '有问题'}`]
        for (const s of v.plan) lines.push('  计划: ' + s)
        for (const s of v.done) lines.push('  已完成: ' + s)
        if (v.error) lines.push('  错误: ' + v.error)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args: { version: string; message?: string; dryRun?: boolean; skipVerify?: boolean }): Promise<any> {
      const p = paths()
      const dryRun = args.dryRun !== false
      const ver = String(args.version ?? '').trim().replace(/^v/i, '')
      if (!/^\d+\.\d+$/.test(ver)) {
        return { ok: false, dryRun, refused: `版本号形态不对（要 主.次，如 3.4）：收到 ${args.version}`, verifyHead: '', plan: [], done: [], error: '' }
      }
      const newBaseline = joinPath(p.workspaceRoot, `色欲之罪V${ver}.json`)
      const plan = [
        `verify 前置门: python verify.py（未过即拒绝）`,
        `同步: ${p.productJson} → ${newBaseline}`,
        `同步: ${p.productJson} → ${p.runtimeJson}`,
        `git add -A && git commit -m "${args.message || 'V' + ver}"`,
        `git tag -f v${ver} -m "${args.message || 'V' + ver}"`,
        `（不 push：本项目只做本地仓库）`,
      ]
      let verifyHead = ''
      if (!args.skipVerify) {
        const cmd = stepCommand(p, 'verify')
        const r = await runStep(cmd, config.timeoutMs, String(cmd.argv[0]))
        verifyHead = parseVerify(r.stdout).conclusion || tailLines(r.stdout + r.stderr, 6)
        if (r.code !== 0) {
          return { ok: false, dryRun, refused: `verify.py 退出码 ${r.code}（${r.kind}${r.hint ? '：' + r.hint : ''}）——先让校验变绿再发布`, verifyHead, plan, done: [], error: '' }
        }
      }
      if (!(await exists(p.productJson))) {
        return { ok: false, dryRun, refused: 'build 产物不存在：先跑 preset_gate 的 build', verifyHead, plan, done: [], error: '' }
      }
      if (dryRun) return { ok: true, dryRun: true, refused: '', verifyHead, plan, done: [], error: '' }

      const done: string[] = []
      try {
        await copyFile(p.productJson, newBaseline)
        done.push('同步基准: ' + newBaseline)
        await copyFile(p.productJson, p.runtimeJson)
        done.push('同步运行版: ' + p.runtimeJson)
        const msg = args.message || `V${ver}`
        const a = await run(gitCommand(p, ['add', '-A']), config.timeoutMs)
        if (a.code !== 0) throw new Error('git add 失败: ' + (a.stderr || a.stdout))
        const c = await run(gitCommand(p, ['commit', '-m', msg]), config.timeoutMs)
        done.push('commit: ' + (c.stdout.split('\n')[0] || c.stderr.trim()))
        const t = await run(gitCommand(p, ['tag', '-f', `v${ver}`, '-m', msg]), config.timeoutMs)
        done.push(t.code === 0 ? `tag v${ver} 已打` : 'tag 失败: ' + t.stderr.trim())
        return { ok: true, dryRun: false, refused: '', verifyHead, plan, done, error: '' }
      } catch (e) {
        return { ok: false, dryRun: false, refused: '', verifyHead, plan, done, error: String((e as Error)?.message ?? e) }
      }
    },
  }))

  // cordis4 没有 ready 事件（脚手架模板里的 ctx.on('ready') 会被 tsc 拒）——在 apply 期直接自报构建身份。
  logger.info(`agent-preset-ops 已装载 | presetDir=${config.presetDir} python=${config.pythonExe} timeout=${config.timeoutMs}ms`)
}
