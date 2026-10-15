<!--
  DSH 插件生态公约声明（plugin-ecosystem-convention · 组合优先/声明清晰/兼容优先）
  purpose: 预设工程流程助手：状态体检 / 构建验证闸门 / 逐字段比对 / 位格度量 / 发布同步（配合技能 tavern-preset-iteration）
  inject: ['tools']
  tools: preset_status,preset_gate,preset_diff,preset_metrics,preset_release
  runtime: host-only
  envDeps: 见 README「配置」节
  boundary: 见 README「设计要点」与「生效判据与回退」节
  compat: cordis ^4.0.1 / dsh-tools >=0.1.0-rc.6
-->
# dsh-preset-ops

<p align="center">
  <a href="https://github.com/jonah791/dsh-preset-ops"><img src="https://img.shields.io/badge/version-0.1.0-blue" alt="version"></a>
  <img src="https://img.shields.io/badge/License-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-3178C6" alt="TypeScript">
  <img src="https://img.shields.io/badge/tests-18%20passed-brightgreen" alt="tests">
</p>

预设工程流程助手——把「色欲之罪预设」的创作与迭代流程（技能 `tavern-preset-iteration` 里的五态状态机）做成工具，让流程不靠记忆。

**它不写预设内容**：内容只从 `source.md` 进、产物只从 `build.py` 出。插件只搬动事实与判据。

## 快速开始

**1) 装依赖**（在目标 profile 的 `package.json` 加 link 依赖）：

```jsonc
"dsh-preset-ops": "link:E:/alice/self-plugins/dsh-preset-ops"
```

**2) 挂组合**：

```yaml
- id: dsh-preset-ops
  name: dsh-preset-ops
```

**3) 30 秒验证**：`preset_status` → 应报产物/基准/运行版三处 md5 是否一致

## 五个工具

| 工具 | 对应流程态 | 干什么 |
|---|---|---|
| `preset_status` | 任何改动前后 | 只读体检：三处 md5 是否一致、启用态双写是否自洽、块数/字符、git 干净度与最新 tag |
| `preset_gate` | S4 验证 | 按序跑 `build.py → verify.py → assemble.py`，**以退出码裁决**，失败报「断在哪一步 + 哪类失败」 |
| `preset_diff` | S4-4 | 逐字段比对两版 json，打印「有改动的块」清单（重构安全带） |
| `preset_metrics` | S1 / S4-5 | 位格统计 / 思考链注意力预算 / 酒馆实测取证（含基准现算与词表指纹） |
| `preset_release` | S5 发布 | 三处同步 + commit + tag。**默认干跑**；`verify.py` 未过一律拒绝。不 push |

## 配置（profile patch 行）

```yaml
- insert:
    - id: agent-preset-ops
      name: dsh-preset-ops
      config:
        presetDir: E:/alice/tavern/色欲之罪预设
        workspaceRoot: E:/alice/tavern
        pythonExe: python
        timeoutMs: 180000
```

`baselineJson` 留空时自动扫描工作区根目录里版本号最高的 `色欲之罪V*.json`（数值比较，`V3.10 > V3.3`）。

## 边界（不做什么）

- 不写 `source.md` / `skeleton.json`；不直接改产物 json（产物只能由 build 生成）
- **不 push**：本项目只做本地仓库（红线：不开源）
- 不替主人裁决改什么——工具只报事实与判据
- 释放动作默认干跑，`verify` 是硬前置门

## 开发与验收

```powershell
# 类型只需两个纯 devDeps（.npmrc 已禁 auto-install-peers，防 @deepseek-ai 真实副本遮蔽宿主 link farm）
node <harness>/node_modules/typescript/bin/tsc -p tsconfig.json    # 判据：退出码 0
node --test "tests/*.test.mjs"                                     # 15 项离线单测
```

`src/runner.ts` 是纯逻辑层（路径/命令/解析/失败归类，无 I/O），`src/index.ts` 只接线。
判据纪律：**通过与否以退出码为准**，文本解析只服务展示；失败分「跑不动」（解释器缺失/超时/脚本不存在）与「跑了没过」两类，前者即停不掩盖。
详细契约与可证伪验收表见 `docs/semantic.md`。

## 测试

```bash
cd self-plugins/dsh-preset-ops && npm test
```

**18 条用例**（跑一次得到）。

## 落盘与自证

**本插件无持久产物**——它不写文件、不落侧车；判据全在**行为侧**（见「快速开始」的 30 秒验证与「生效判据与回退」节）。