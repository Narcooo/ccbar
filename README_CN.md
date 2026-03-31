<div align="center">

<br>

<img src="assets/logo.svg" alt="ccbar" width="400">

<br>
<br>

**Vibe coding 不再只是玩玩而已。你得知道花了多少。**

Claude Code 实时成本追踪与配额监控，零依赖。

[![PyPI](https://img.shields.io/pypi/v/ccbar?style=flat-square&color=blue)](https://pypi.org/project/ccbar/)
[![Downloads](https://img.shields.io/pypi/dm/ccbar?style=flat-square&color=green)](https://pypi.org/project/ccbar/)
[![Python](https://img.shields.io/pypi/pyversions/ccbar?style=flat-square)](https://pypi.org/project/ccbar/)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)

[![English](https://img.shields.io/badge/lang-English-grey?style=flat-square)](./README.md)
[![中文](https://img.shields.io/badge/lang-中文-blue?style=flat-square)](#)

</div>

<br>

<div align="center">
<img src="assets/demo.svg" alt="ccbar 演示" width="920">
</div>

<br>

## 为什么用 ccbar

你每天在烧 API 额度或者 $200/月的 Max 订阅——但 Claude Code 不告诉你烧了多快、哪个项目烧的、到今天结束会花多少。ccbar 填上这个空缺。

它**同时支持两种计费模式**：无论你是 API 按量付费还是 Pro/Max 订阅按配额使用，ccbar 都能实时追踪你的花费。不用猜，月底不再有惊吓。

## 安装

公开 GitHub marketplace：

```bash
/plugin marketplace add https://github.com/Narcooo/ccbar
/plugin install ccbar@narcooo
/ccbar:setup
```

这是目前公开可用的安装方式。

本地开发 marketplace：

如果你在本地开发，或者市场上架前要先试装，先用独立的开发版 marketplace 清单走文件路径安装。使用 `.claude-plugin/dev-marketplace/marketplace.json` 可以避免本地调试时覆盖公开 `narcooo` marketplace 标识。

```bash
/plugin marketplace add /absolute/path/to/ccbar/.claude-plugin/dev-marketplace/marketplace.json
/plugin install ccbar@ccbar-dev
/ccbar:setup
```

`ccbar` 现在是原生 Claude Code 插件。`setup` 会把插件接到 `statusLine.command`，之后 `SessionStart` hook 会在配置漂移时自动修复。

如果你只是做本地调试，也可以用一个很薄的 Python wrapper 去调用已经构建好的 Node CLI。这个入口不是正式安装方式，前提仍然是先把本地 Node 构建产物生成出来。

```bash
npm run build
python -m ccbar doctor
```

## 你看到什么

```
第1行:  5h 配额条 + 倒计时 · 今日 token + 费用 › 项目 token ♻缓存/命中率 费用 · 本周费用 › 项目 token 费用 │ 本月 token 费用 › 项目费用
第2行:  7d 配额条 + 倒计时 · 会话费用 + $/h + →预测 + 时长 + ctx% + 代码行 · 项目总成本 › 项目 token ♻缓存 费用 + 路径
```

终端太窄？ccbar 会先切到紧凑 2x2 布局，再在不得已时裁掉尾部列；列内内容永不截断。

## 极致轻量

ccbar 现在是基于 Node.js/TypeScript 的原生 Claude Code 插件。不再依赖 PyPI 引导层，也不需要单独执行 `ccbar --install`。它直接读取 Claude Code 已有的 JSONL 日志，并通过插件链路输出到底部状态栏。

| | ccbar | 同类工具 |
|---|---|---|
| 运行形态 | **原生 Claude 插件** | 外部脚本 + 手工接线 |
| 安装方式 | **`/plugin install` + `/ccbar:setup`** | 包管理器安装 + shell 胶水 |
| 后台进程 | **非必需** | 持久守护进程 |
| 配置 | 插件 JSON 配置 + slash commands | YAML + env + 后台设置 |

## 精确到分

大多数工具用统一费率估算成本。这是错的——Opus 输出比 Haiku 贵 **19 倍**。ccbar 做对了：

- **按模型定价** — 逐条读取模型 ID。Opus、Sonnet、Haiku 各自正确计价。
- **流式去重** — 每次 API 调用写入 2–7 条 JSONL。ccbar 按 `message.id` 去重，每条消息只算一次。
- **缓存区分** — 缓存读取只有新输入 10% 的价格。ccbar 分别追踪，按项目显示 ♻命中率。
- **跨会话累计** — 会话费用重启归零，你的账单不会。ccbar 扫描全部 JSONL——日、周、月、按项目。

## 全方位监控

| 指标 | 它告诉你什么 |
|------|-------------|
| **5h / 7d 配额条** | 绿→黄→红渐变。在撞限额之前就知道要撞了。 |
| **燃烧率** `$8.50/h` | 这个会话花钱的速度。 |
| **预测** `→$18` | 按当前速度，到配额重置时会花多少。 |
| **项目细分** `› proj ♻56M/97% $124` | 哪个项目在吃预算。缓存命中率附赠。 |
| **代码行变化** `+250/-40` | 本会话的代码产出——花的钱值不值？ |
| **Context %** | 上下文窗口用了多满。帮你决定何时 compact。 |
| **今日 / 本周 / 本月** | 滚动累计，随时知道账单到哪了。 |

## API 和订阅——全都追踪

**API 用户** — ccbar 从逐模型 token 定价精确计算费用。你能看到每会话、每项目、每天的美元花费。

**Pro / Max 订阅用户** — ccbar 通过 Anthropic OAuth API 读取你的配额。5 小时和 7 天进度条精确显示剩余额度，附带重置倒计时。

不管哪种，一条状态栏讲完整个故事。

## 配置

```bash
/ccbar:configure
/ccbar:doctor
```

<details>
<summary>配置参考</summary>

```json
{
  "compactRows": [["5h", "today"], ["7d", "total"]],
  "compactBreakpoint": 113,
  "columns": null
}
```

| 字段 | 说明 |
|------|------|
| `rows` | 固定宽屏布局覆盖——可用项: `5h` `7d` `today` `history` `session` `model` `total` |
| `compactRows` | 窄屏布局覆盖。不写时使用内置紧凑布局。 |
| `compactBreakpoint` | 从宽屏切到窄屏布局的宽度阈值。 |
| `columns` | 覆盖检测到的宽度（`null` = 自动检测；如果拿不到宽度信号，会回退到安全默认值） |

</details>

插件配置保存在 `~/.claude/plugins/ccbar/config.json`。

## 工作原理

```
stdin JSON → 插件运行时 → 扫描 ~/.claude/projects/**/*.jsonl
           → 按 message.id 去重 → 按模型定价
           → 自适应布局 → stdout
```

插件命令：
- `/ccbar:setup` 接管 `statusLine.command`
- `/ccbar:configure` 编辑插件配置
- `/ccbar:doctor` 检查插件缓存与状态栏接线

## 卸载

```bash
/plugin remove ccbar
```

---

<div align="center">

MIT

</div>
