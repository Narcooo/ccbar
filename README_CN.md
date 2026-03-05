<div align="center">

<br>

<img src="assets/logo.svg" alt="ccbar" width="400">

<br>
<br>

**Claude Code 实时成本追踪与配额监控。**

零依赖 · 纯 Python 标准库 · 一行 `pip install` 搞定

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

```bash
pip install ccbar
ccbar --install
```

重启 Claude Code，底部出现两行状态栏。搞定。

## 你看到什么

```
第1行:  5h 配额条 + 倒计时 · 今日 token + ♻缓存 + 费用 › 项目细分 · 本周 · 本月
第2行:  7d 配额条 + 倒计时 · 会话费用 + $/h + →预测 + 时长 + 代码行 · context% + 模型 · 项目总成本
```

终端太窄？尾部列自动裁掉，列内内容永不截断。

## 极致轻量

ccbar 是一个 Python 文件。没有框架，没有后台守护进程，没有 node_modules。它读取 Claude Code 已有的 JSONL 日志和你已有的 OAuth API。整个包安装不到一秒。

| | ccbar | 同类工具 |
|---|---|---|
| 依赖 | **0** | 10–50+ npm/pip 包 |
| 安装时间 | **< 1s** | 30s – 2min |
| 后台进程 | **无** — 每次刷新时运行 | 持久守护进程 |
| 配置 | 1 个 JSON 文件或 1 个环境变量 | YAML + env + 后台设置 |

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
export CCBAR_LAYOUT="5h,today,history|7d,session,total"
# 或
ccbar --init-config   # → ~/.config/ccbar.json
```

<details>
<summary>配置参考</summary>

```json
{
  "rows": [["5h", "today", "history"], ["7d", "session", "total"]],
  "columns": null,
  "colors": {},
  "pricing": {
    "claude-opus-4-6":    { "in": 15,  "out": 75, "cc": 18.75, "cr": 1.5  },
    "claude-sonnet-4-6":  { "in": 3,   "out": 15, "cc": 3.75,  "cr": 0.3  },
    "claude-haiku-4-5":   { "in": 0.8, "out": 4,  "cc": 1,     "cr": 0.08 }
  }
}
```

| 字段 | 说明 |
|------|------|
| `rows` | 布局网格——可用项: `5h` `7d` `today` `history` `session` `model` `total` |
| `columns` | 覆盖终端宽度（`null` = 自动检测） |
| `pricing` | 每百万 token 价格 |
| `colors` | `[R, G, B]` 颜色覆盖 |

</details>

## 工作原理

```
stdin JSON → 检测终端宽度 → 获取 OAuth 配额（缓存 30s）
           → 扫描 ~/.claude/projects/**/*.jsonl（缓存 60s）
           → 按 message.id 去重 → 按模型定价 → 自适应布局 → stdout
```

OAuth — macOS 自动从 Keychain 读取。Linux/CI：`export CLAUDE_OAUTH_TOKEN="..."`。无 OAuth 时配额条显示 `--`。

## 卸载

```bash
ccbar --uninstall && pip uninstall ccbar
```

---

<div align="center">

MIT · 为把 AI 算力当预算科目的开发者而做。

</div>
