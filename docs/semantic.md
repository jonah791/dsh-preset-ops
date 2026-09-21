# dsh-preset-ops · 语义文档

> 版本 v0.1.0 · 2026-09-21 · 状态：**已实现，待线上验收（挂载后按 A1–A9 逐条实测）**

## 1 元信息

| 项 | 值 |
|---|---|
| 包名 | `dsh-preset-ops` |
| 行 id（profile patch） | `agent-preset-ops`（= `src/index.ts` 的 `export const name`） |
| 类型 | host 插件，纯工具面（5 工具），无 client 面、无常驻资源 |
| 依赖 | `inject = ['tools']`；外部进程 `python`（配置 `pythonExe`） |
| 出处 | 主人 2026-09-21「需要规范一下预设的创作和迭代流程，并创建出一个插件来辅助」 |
| 配套技能 | `tavern-preset-iteration`（流程正本） |

## 2 定位与反定位

**是**：把「色欲之罪预设」五态流程（S1 取证 → S2 设计 → S3 施工 → S4 验证 → S5 发布）里**可判据的步骤**工具化。

**不是**：
- 不是预设编辑器——`source.md` / `skeleton.json` 不在写入面内
- 不是构建器的替代——产物 json 只能由 `build.py` 生成
- 不是发布管道——**不 push**（项目红线：不开源，只做本地仓库）
- 不是判官——不裁决「改得对不对」，只把事实（退出码、差异清单、读数）端出来

## 3 术语

| 词 | 含义 |
|---|---|
| 三处一致 | 基准 `色欲之罪V<版本>.json` = 运行版 `色欲之罪.json` = build 产物 `色欲之罪预设/色欲之罪.json`，md5 相同 |
| 启用态双写 | `prompts[].enabled` 与 `prompt_order[].enabled` 必须一致（build 负责双写） |
| 闸门 | S4 的三步验证：build → verify → assemble；**裁决只看退出码** |
| 假红 | 管道提前关闭（如 `Select-Object -First N`）杀掉 Python 进程，退出码 1 而非失败 |
| 基准现算 | 素材读数由当前词表现算（`tavern_forensics.py` 按 `slot_stats.py` 字节指纹缓存），不硬编码 |

## 4 概念模型与不变量

```
配置(presetDir/workspaceRoot/pythonExe) ──▶ runner.resolvePaths ──▶ 路径集合
                                                        │
                        ┌───────────────────────────────┼───────────────────────────────┐
                        ▼                               ▼                               ▼
                 预设脚本(presetDir)            度量脚本(metricsDir)              git(presetDir)
              build/verify/assemble/diff      slots/attention/forensics      status/tag/commit
                        │                               │                               │
                        └────────────► 退出码 = 唯一裁决 ◄──────────────┘
```

**不变量**
1. **退出码是唯一裁决**：文本解析（`parseVerify` / `parseAssemble`）只服务展示，不参与判定。
2. **失败必须分类**：`ok` / `script-failed` / `python-missing` / `script-missing` / `timeout` / `spawn-failed`。「跑不动」与「跑了没过」不得混为一谈；跑不动即停，不用后续步骤掩盖。
3. **写入面极窄**：`preset_release`（非干跑）只做四件事——复制产物到基准、复制到运行版、`git commit`、`git tag`；且 `verify` 未过 → **拒绝**。
4. **参数不过 shell**：一律 `execFile(file, argv[])`，用户输入只进 argv 数组（不拼 shell 字符串）。
5. **版本号必须先校验**：`preset_release` 要求 `主.次` 形态，不合法即拒（防路径穿越与误写文件名）。
6. **路径可配、默认显式**：无配置文件时用 `E:/alice/tavern` 的默认值；不做隐式 cwd 推断。

## 5 契约

### 5.1 工具面

| 工具 | 参数 | 返回（schema 已声明，多余字段会被宿主拒绝） | 副作用 |
|---|---|---|---|
| `preset_status` | `baseline?` | `ok / md5[] / threeWayConsistent / prompts / orderEntries / enabledPrompts / enabledOrder / dualWriteConsistent / enabledContentChars / gitHead / gitTag / gitDirty / warnings[]` | **无**（只读） |
| `preset_gate` | `steps? / target?` | `ok / blockedAt / reason / steps[]` | 生成 `色欲之罪预设/色欲之罪.json`（build 覆盖） |
| `preset_diff` | `old? / new? / verbose?` | `ok / identical / old / new / blocks[] / added[] / removed[] / topKeys[] / orderChanged / extChanged[] / totalDelta` | **无** |
| `preset_metrics` | `kind? / target?` | `ok / results[]` | forensics 带 `--dump` 时写导出目录（仅当显式传 target） |
| `preset_release` | `version / message? / dryRun? / skipVerify?` | `ok / dryRun / refused / verifyHead / plan[] / done[] / error` | 复制两个 json + git commit/tag（非干跑） |

### 5.2 调用点清单（契约的另一半：谁调谁）

| 调用点 | 被调 | 说明 |
|---|---|---|
| `preset_gate` (build) | `<presetDir>/build.py` | cwd = presetDir |
| `preset_gate` (verify) | `<presetDir>/verify.py` | 参照由 verify.py 自身默认（仓外基准） |
| `preset_gate` (assemble) | `<presetDir>/assemble.py <产物>` | 判据行 `assembly healthy` |
| `preset_diff` | `<presetDir>/diff_preset.py --json` | 2026-09-21 新增的正式工具 |
| `preset_metrics` (slots) | `<metricsDir>/slot_stats.py <目录>` | 词表唯一真源；缺省目录 = `素材/` |
| `preset_metrics` (attention) | `<metricsDir>/chain_attention.py <source.md>` | 注意力预算 |
| `preset_metrics` (forensics) | `<metricsDir>/tavern_forensics.py` | 读 `%APPDATA%\com.tauritavern.client\logs` |
| `preset_status` / `preset_release` | `git -C <presetDir> …` | `log/tag/status/add/commit/tag -f` |
| `preset_status` | 直接读三个 json | 不算 md5 之外的语义 |

> 反向调用点（谁调本插件）：目前只有会话里的我。**没有任何项目脚本依赖它**——插件可随时卸载而不影响预设工程。

## 6 边界与信任

| 维度 | 事实 |
|---|---|
| 能力边界 | 与宿主同进程、全权限（capability ≠ 沙箱）。危险面集中在 `preset_release`：写两个 json + 动 git |
| 降险设计 | 干跑默认；`verify` 硬前置；版本号白名单校验；不 push；`skipVerify` 是显式高风险开关 |
| 信任外部输入 | 不信任：`version` / `message` / 路径参数都过校验或只进 argv；**不执行**任何来自 JSON 内容的指令 |
| 隐私 | 不读凭据；日志只有路径与命令行（预设正文不入日志） |
| 网络 | 无 |

## 7 可证伪验收

| id | 判据 | 命令/入口 | 状态 |
|---|---|---|---|
| A1 | 纯函数单测全绿 | `node --test "tests/*.test.mjs"` | 已实测（**18/18**，2026-09-21；含「空集不得当通过」假绿防线） |
| A2 | `tsc -p tsconfig.json` 退出码 0 | 构建 | 已实测（exit 0） |
| A3 | 挂载后 5 个工具出现在工具面 | 调 `preset_status` | 已实测（2026-09-21 00:1x，挂载 + 重启后逐个真调） |
| A4 | `preset_status` 读数和盘上真源一致 | 调 `preset_status` | 已实测（74 块 / **order 69** / 启用 46 vs 49 / 三处 md5 `49FFDA…` 一致 / git 有未提交改动如实报出） |
| A5 | 坏样本必须失败（尸体测试） | 见下「判据修订」 | 已实测（`preset_diff` 指向不存在文件 → `ok=false` + **带出脚本原话** `Errno 2 No such file`）。原判据「改 baselineJson 指向 V3.0 后调 preset_gate」**不可行**：`preset_gate` 不接受基准参数（verify 用自身默认参照）⇒ 改为等价判据；`preset_gate` 的真坏样本未构造，见 §10 |
| A6 | `preset_diff` 自比报 `identical=true` | old=new=基准 | 已实测 |
| A7 | `preset_diff` 对 V3.2↔V3.3 报 **15 个内容块**（已知真值） | 工具面 `preset_diff` | 已实测（15 块 / +1985 字符 / 新增块「位格调度」，与交接文档 §4.4 记录逐条吻合） |
| A8 | `preset_release` 干跑不写任何文件 | dryRun=true | 已实测（只回计划；代码路径在 `copyFile` 之前返回） |
| A9 | `preset_release` 守卫拒绝路径 | 版本号守卫 / verify 非 0 | 部分实测：版本号守卫已实测拒绝（`abc` → `refused`）；**verify 非 0 触发的拒绝路径未实测**（需构造失败参照），见 §10 |

## 8 与实现的关系

- 纯逻辑层 `src/runner.ts`（路径/命令/解析/失败归类，无 I/O）↔ 接线层 `src/index.ts`（spawn、fs、工具注册）
- 判据真源：**脚本的退出码**（不是解析结果）；词表的真源在 `slot_stats.py`（本插件不复制词表）
- 文档与实现同提交；改判据必须同步改 §5.2 调用点清单与 §7 验收表

## 9 实践修订记录

| 日期 | 缺口 | 修订 |
|---|---|---|
| 2026-09-21 | 脚手架模板里的 `ctx.on('ready')` 在本机 cordis 4.0.1 上编译不过（无 ready 事件），照抄即报错 | apply 期直接 `logger.info` 自报；README 记「cordis4 无 ready」 |
| 2026-09-21 | 仓库内三个既有插件都没有 `.npmrc`，首次 `npm install` 会装出 `@deepseek-ai/*` 真实副本（模块双实例风险） | 本插件加 `.npmrc`（`auto-install-peers=false` / `legacy-peer-deps=true`），并把类型依赖做成指向宿主链接层的本地 junction |
| 2026-09-21 | **工具级验收靠读输出抓到实缺陷**：ST 的 `prompt_order` 是分组嵌套，按平铺读得到「order 1」；双写检查在**空集上判「一致」= 假绿**（比失败更坏）；`enabled !== false` 把「没有 enabled 键」当启用 | 新增纯函数 `flattenOrder`（认嵌套/平铺 + 自引用防护）与 `dualWriteReport`（**可比对数为 0 时必须 false**）；启用计数只认 `enabled===true`，缺键改显式告警；补 3 项单测 |
| 2026-09-21 | `preset_diff` 失败渲染只说「退出码非 0」，把原因吞了（违反「失败必带原因」） | 失败渲染补「脚本原话」（`Errno 2 No such file` 直接可见）+ 输入路径回声 |
| 2026-09-21 | A5 原始判据不可执行（`preset_gate` 不吃基准参数，无法用它构造坏样本） | 判据改为等效可执行形态（缺失输入必须响亮失败）；`preset_gate` 的真坏样本留 §10 |
| 2026-09-21 | 本会话实测：**web 重启重置文件观测**，重启后连续多个 `edit` 被守卫拒绝；且「失败」有两类（观测守卫 vs `old_string` 不匹配）不可混算 | 与 AGENTS.md 既有布线一致（重启后第一次 edit 先 read）；本文件 §10 记录判据需区分失败类别 |

## 10 未决问题

1. `preset_metrics` 只回关键行（截断），**不解析成结构化读数**——若要「读数进版本沿革」，需要为三个脚本各写一个稳定解析器（当前靠脚本自身输出格式，未做契约固化）。
2. `preset_release` 未做「产物三处 md5 复核」这一步——目前靠 `preset_status` 人工确认。是否纳入发布闸门待定。
3. 未接 `docs/semantics/registry.json` 之外的项目注册表；tavern 项目自己的索引在 `色欲之罪预设/流程规范.md`（技能指针）。
