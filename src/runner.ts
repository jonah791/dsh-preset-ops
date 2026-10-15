/**
 * dsh-preset-ops 纯逻辑层：路径解析 / 命令构造 / 结果解析 / 失败归类。
 *
 * 纪律（AGENTS.md dsh-plugin-testability）：本文件**无 I/O、无宿主依赖、无平台假设**，
 * 所有副作用留在 src/index.ts。判据是真源：
 *   - 通过/失败以**退出码**为准（文本解析只服务于展示，不参与裁决）
 *   - 产物路径与脚本名集中在这里，避免散落在工具实现里
 */

export type Step = 'build' | 'verify' | 'assemble' | 'slots' | 'attention' | 'forensics'

export const STEP_SCRIPTS: Record<Step, string> = {
  build: 'build.py',
  verify: 'verify.py',
  assemble: 'assemble.py',
  slots: 'slot_stats.py',
  attention: 'chain_attention.py',
  forensics: 'tavern_forensics.py',
}

/** 度量类脚本不在预设目录里，住在 文风/位格统计/。 */
export const METRIC_STEPS: Step[] = ['slots', 'attention', 'forensics']

export interface PathInput {
  presetDir: string
  workspaceRoot: string
  baselineJson?: string
  runtimeJson?: string
  pythonExe?: string
}

export interface Paths {
  presetDir: string
  workspaceRoot: string
  baselineJson: string
  runtimeJson: string
  productJson: string
  materialsDir: string
  metricsDir: string
  pythonExe: string
}

export interface Cmd {
  file: string
  argv: string[]
  cwd: string
}

/** 统一成正斜杠，去掉尾斜杠——跨 Windows/WSL 两套写法都能比。 */
export function normDir(p: string): string {
  const s = String(p ?? '').trim().replace(/\\/g, '/')
  return s.length > 1 ? s.replace(/\/+$/, '') : s
}

export function joinPath(dir: string, name: string): string {
  return normDir(dir) + '/' + String(name).replace(/^\/+/, '')
}

/**
 * 从目录清单里挑基准产物：`色欲之罪V3.10.json` > `色欲之罪V3.3.json`（数值比较，不是字典序），
 * 同版本多份取第一个；没有 V 文件时回退到运行版。
 */
export function pickBaseline(names: string[], runtimeName = '色欲之罪.json'): string {
  const ver = /^色欲之罪V(\d+)\.(\d+)\.json$/
  const scored: Array<{ name: string; major: number; minor: number }> = []
  for (const n of names) {
    const m = ver.exec(n)
    if (m) scored.push({ name: n, major: Number(m[1]), minor: Number(m[2]) })
  }
  scored.sort((a, b) => (b.major - a.major) || (b.minor - a.minor) || a.name.localeCompare(b.name))
  return scored[0]?.name ?? runtimeName
}

/**
 * 只改 skeleton.json 的**顶层** `name`（缩进 2 空格的 `  "name": "..."`）。
 * 块内的 name（缩进 ≥4 空格）一律不动；没匹配到时**原样返回**（调用方须自行校验，别把「没找到」当成「已是」）。
 */
export function patchTopLevelName(skeletonText: string, newName: string): string {
  return skeletonText.replace(/^ {2}"name": "[^"]*",/m, '  "name": "' + newName + '",')
}

/**
 * 同步 verify.py 的 `DEFAULT_REF = '...'`（**硬编码常量**——技能 §4 的第 ③ 步，此前每次发布靠人手改）。
 * 没匹配到时原样返回（调用方须自行校验）。
 */
export function patchVerifyRef(verifyText: string, newRef: string): string {
  return verifyText.replace(/^DEFAULT_REF = '[^']*'/m, "DEFAULT_REF = '" + newRef + "'")
}

export function resolvePaths(input: PathInput): Paths {
  const presetDir = normDir(input.presetDir)
  const workspaceRoot = normDir(input.workspaceRoot)
  const baselineName = input.baselineJson && input.baselineJson.trim() ? input.baselineJson.trim() : '色欲之罪V3.3.json'
  const runtimeName = input.runtimeJson && input.runtimeJson.trim() ? input.runtimeJson.trim() : '色欲之罪.json'
  const baselineJson = baselineName.includes('/') ? normDir(baselineName) : joinPath(workspaceRoot, baselineName)
  return {
    presetDir,
    workspaceRoot,
    baselineJson,
    runtimeJson: joinPath(workspaceRoot, runtimeName),
    productJson: joinPath(presetDir, runtimeName),
    materialsDir: joinPath(workspaceRoot, '素材'),
    metricsDir: joinPath(workspaceRoot, '文风/位格统计'),
    pythonExe: (input.pythonExe && input.pythonExe.trim()) || 'python',
  }
}

/** 构造一条要跑的命令。度量类脚本从 metricsDir 跑，其余从 presetDir 跑。 */
export function stepCommand(paths: Paths, step: Step, opts: { target?: string; extra?: string[]; sourceMd?: string; logsDir?: string } = {}): Cmd {
  const script = STEP_SCRIPTS[step]
  if (METRIC_STEPS.includes(step)) {
    const scriptPath = joinPath(paths.metricsDir, script)
    const argv: string[] = [scriptPath]
    if (step === 'slots') argv.push(opts.target || paths.materialsDir)
    else if (step === 'attention') argv.push(opts.target || joinPath(paths.presetDir, 'source.md'))
    else if (step === 'forensics') {
      if (opts.target) argv.push('--dump', opts.target)
    }
    if (opts.extra?.length) argv.push(...opts.extra)
    return { file: paths.pythonExe, argv, cwd: paths.metricsDir }
  }
  const argv: string[] = [joinPath(paths.presetDir, script)]
  if (step === 'assemble') argv.push(opts.target || paths.productJson)
  else if (step === 'verify' && opts.target) argv.push(opts.target)
  if (opts.extra?.length) argv.push(...opts.extra)
  return { file: paths.pythonExe, argv, cwd: paths.presetDir }
}

export function diffCommand(paths: Paths, oldJson: string, newJson: string, verbose = false): Cmd {
  const argv = [joinPath(paths.presetDir, 'diff_preset.py'), oldJson, newJson, '--json']
  if (verbose) argv.push('--verbose')
  return { file: paths.pythonExe, argv, cwd: paths.presetDir }
}

export function gitCommand(paths: Paths, argv: string[]): Cmd {
  return { file: 'git', argv: ['-C', paths.presetDir, ...argv], cwd: paths.presetDir }
}

/** 给子进程用的环境：Python 在 Windows 下输出中文必须显式声明编码（否则 UnicodeEncodeError）。 */
export function childEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
}

export type FailureKind = 'ok' | 'script-failed' | 'python-missing' | 'script-missing' | 'timeout' | 'spawn-failed'

export interface RunOutcome {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError?: string
}

/** 失败归类：把「跑不动」与「跑了但没过」分开——语义精确性（进化规则 1）。 */
export function classifyFailure(o: RunOutcome, scriptExists = true): { kind: FailureKind; hint: string } {
  const err = o.spawnError ?? ''
  if (/ENOENT/i.test(err) && !scriptExists) return { kind: 'script-missing', hint: '脚本不存在：检查 presetDir / metricsDir 配置' }
  if (/ENOENT/i.test(err)) return { kind: 'python-missing', hint: '找不到解释器：检查 pythonExe 配置（或 PATH 里的 python）' }
  if (o.timedOut) return { kind: 'timeout', hint: '超时：加大 timeoutMs，或先单独跑一次确认脚本本身耗时' }
  if (err) return { kind: 'spawn-failed', hint: '进程启动失败：' + err }
  if (o.code === 0) return { kind: 'ok', hint: '' }
  return { kind: 'script-failed', hint: verdictHint(o.stdout + '\n' + o.stderr) }
}

/**
 * 已知的假红：用 `Select-Object -First N` 之类的截断会让管道提前关闭并杀掉 Python 进程，
 * 退出码变 1 但脚本其实成功。流水线里如果出现 BrokenPipeError，按假红提示。
 */
export function verdictHint(text: string): string {
  if (/BrokenPipeError|broken pipe/i.test(text)) return '疑似假红：管道提前关闭（截断输出）导致进程被杀，看脚本自身输出为准'
  if (/Unexpected UTF-8 BOM/i.test(text)) return 'JSON 带 BOM：写入方应使用 UTF8Encoding($false) / utf-8-sig 读取'
  if (/回环不一致/.test(text)) return '回环不一致：确认差异是本批预期，再在发布阶段更新参照（不是改参照来消错）'
  if (/assembly healthy/.test(text)) return '组装模拟通过'
  return '脚本退出码非 0：读它的输出判断是内容问题还是环境问题'
}

export interface CheckItem { line: string; ok: boolean }

/** verify.py 的输出解析——只服务展示；**裁决看退出码**。 */
export function parseVerify(stdout: string): { items: CheckItem[]; conclusion: string } {
  const items: CheckItem[] = []
  let conclusion = ''
  for (const raw of String(stdout ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (/结论|conclusion/i.test(line)) conclusion = line
    if (/^(OK|FAIL|PASS|ERROR|不一致|一致)/i.test(line) || /\bOK\b|\bFAIL\b/.test(line)) {
      items.push({ line, ok: !/FAIL|不一致|ERROR/i.test(line) })
    }
  }
  return { items, conclusion }
}

export function parseAssemble(stdout: string): { healthy: boolean; line: string } {
  const m = /assembly healthy[^\n]*/i.exec(String(stdout ?? ''))
  return { healthy: Boolean(m), line: m ? m[0].trim() : '' }
}

export interface DiffRow { name: string; delta: number; contentChanged: boolean }

export interface DiffReport {
  ok: boolean
  identical: boolean
  blocks: DiffRow[]
  added: string[]
  removed: string[]
  topKeys: string[]
  orderChanged: boolean
  extChanged: string[]
  totalDelta: number
}

/** diff_preset.py --json 的输出 → 结构化。无法解析时 ok=false（不假装成功）。 */
export function parseDiffJson(text: string): DiffReport {
  const empty: DiffReport = { ok: false, identical: false, blocks: [], added: [], removed: [], topKeys: [], orderChanged: false, extChanged: [], totalDelta: 0 }
  const start = String(text ?? '').indexOf('{')
  if (start < 0) return empty
  try {
    const d = JSON.parse(text.slice(start)) as Record<string, any>
    const blocks: DiffRow[] = (d.blocks ?? []).map((b: any) => ({
      name: String(b.key ?? '?'),
      delta: Number(b.delta ?? 0),
      contentChanged: Boolean(b.content_changed),
    }))
    const counts = d.counts ?? {}
    const rep: DiffReport = {
      ok: true,
      identical: blocks.length === 0 && (d.top ?? []).length === 0 && !d.order && (d.ext ?? []).length === 0
        && (counts.added ?? []).length === 0 && (counts.removed ?? []).length === 0,
      blocks,
      added: (counts.added ?? []).map(String),
      removed: (counts.removed ?? []).map(String),
      topKeys: (d.top ?? []).map((t: any) => String(Array.isArray(t) ? t[0] : t)),
      orderChanged: Boolean(d.order),
      extChanged: (d.ext ?? []).map((e: any) => String(Array.isArray(e) ? e[0] : e)),
      totalDelta: blocks.reduce((s, b) => s + b.delta, 0),
    }
    return rep
  } catch {
    return empty
  }
}

export interface GateStep { step: Step; code: number | null; kind: FailureKind; hint: string; head: string }

/** 五态流程的 S4 闸门：全部步骤退出码 0 才算过；任一失败即阻断，并给出「断在哪一步」。 */
export function gateVerdict(steps: GateStep[]): { ok: boolean; blockedAt: string; reason: string } {
  for (const s of steps) {
    if (s.code !== 0) {
      return { ok: false, blockedAt: s.step, reason: s.kind === 'script-failed' ? (s.hint || '脚本退出码非 0') : `${s.kind}: ${s.hint}` }
    }
  }
  return { ok: true, blockedAt: '', reason: '全部通过' }
}

export interface OrderEntry { identifier: string; enabled: boolean | undefined }

/**
 * 摊平 `prompt_order`。SillyTavern 的真实形状是**分组嵌套**：
 *   [{ character_id: 100000, order: [{ identifier, enabled }, …] }, …]
 * 早期版本 / 某些预设又是平铺数组，两种都要认——按平铺读会得到「1 条」这种荒谬读数（2026-09-21 实测捕获）。
 */
export function flattenOrder(promptOrder: unknown): OrderEntry[] {
  const out: OrderEntry[] = []
  const seen = new Set<unknown>()
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const x of node) walk(x)
      return
    }
    const obj = node as Record<string, unknown>
    const id = typeof obj.identifier === 'string' ? obj.identifier
      : typeof obj.name === 'string' ? obj.name : ''
    if (id) out.push({ identifier: id, enabled: typeof obj.enabled === 'boolean' ? obj.enabled : undefined })
    if (Array.isArray(obj.order)) walk(obj.order)
    if (Array.isArray(obj.prompts)) walk(obj.prompts)
  }
  walk(promptOrder)
  return out
}

export interface DualWriteReport {
  comparable: number
  mismatched: string[]
  unchecked: number
  /** 可比对数为 0 时必须为 false——空集不许当通过（假绿比失败更坏）。 */
  consistent: boolean
}

/** 逐条比对 `prompts[].enabled` 与 `prompt_order[].enabled`（同一 identifier）。 */
export function dualWriteReport(
  prompts: Array<{ identifier?: string; name?: string; enabled?: boolean }>,
  entries: OrderEntry[],
): DualWriteReport {
  const map = new Map<string, boolean | undefined>()
  for (const p of prompts) {
    const key = String(p.identifier ?? p.name ?? '')
    if (key) map.set(key, typeof p.enabled === 'boolean' ? p.enabled : undefined)
  }
  let comparable = 0
  let unchecked = 0
  const mismatched: string[] = []
  for (const e of entries) {
    const pe = map.get(e.identifier)
    if (pe === undefined || e.enabled === undefined) { unchecked++; continue }
    comparable++
    if (pe !== e.enabled) mismatched.push(e.identifier)
  }
  return { comparable, mismatched, unchecked, consistent: comparable > 0 && mismatched.length === 0 }
}

export function headLines(text: string, n = 6): string {
  return String(text ?? '').split(/\r?\n/).filter((l) => l.trim()).slice(0, n).join('\n')
}

export function tailLines(text: string, n = 6): string {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.trim())
  return lines.slice(Math.max(0, lines.length - n)).join('\n')
}
