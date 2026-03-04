<div align="center">

# ccbar

**Precise project cost accounting for Claude Code**

Zero dependencies. Pure Python stdlib.

[![PyPI](https://img.shields.io/pypi/v/ccbar?style=flat-square&color=blue)](https://pypi.org/project/ccbar/)
[![Python](https://img.shields.io/pypi/pyversions/ccbar?style=flat-square)](https://pypi.org/project/ccbar/)
[![License](https://img.shields.io/github/license/Narcooo/ccbar?style=flat-square)](LICENSE)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)

**[English](#-install)** &nbsp;·&nbsp; **[中文](#-安装)**

<br>

<img src="assets/demo.svg" alt="ccbar demo" width="880">

</div>

<br>

---

<!-- ==================== ENGLISH ==================== -->

## ▸ Install

```bash
pip install ccbar
ccbar --install
```

Restart Claude Code. Done.

## ▸ What it shows

| Row | Content |
|-----|---------|
| **1** | `5h` quota bar + countdown · `today` tokens + ♻cache + cost [› proj ♻cache/hit%] · `week` tokens + cost · `month` tokens + cost |
| **2** | `7d` quota bar + countdown · `session` cost + $/h burn + →projection + duration + lines · `context`% + model + clock · `path` |

**Adaptive** — terminal too narrow? Trailing columns drop automatically. Content within columns is never modified.

## ▸ Key features

<table>
<tr>
<td width="50%">

### Per-model pricing
Opus output: **$75/M**. Haiku: **$4/M**.<br>
Flat pricing tools miscount Opus spend by 5x.<br>
ccbar reads model ID per message.

</td>
<td width="50%">

### Streaming dedup
Each API call → 2–7 JSONL entries.<br>
Without dedup, costs inflate 2–7x.<br>
ccbar deduplicates by `message.id`.

</td>
</tr>
<tr>
<td>

### Cross-session history
Today / week / month totals with<br>
per-project breakdown `› proj`.<br>
Not just session vanity metrics.

</td>
<td>

### Burn rate & projection
`$8.50/h` — session burn rate.<br>
`→$14` — projected cost by end of<br>
current 5-hour quota window.

</td>
</tr>
<tr>
<td>

### Cache tokens
`♻253M` — total cache tokens at a glance.<br>
`♻55.9M/97%` — per-project with hit rate.

</td>
<td>

### HSL gradient bars
Green→yellow→red hue rotation.<br>
Read quota status in 0.1 seconds.<br>
No parsing "Block 2/4 🟢 Normal".

</td>
</tr>
</table>

## ▸ Configure

Default layout: **2 rows × 4 columns**.

```bash
# Environment variable (pipe = row separator, comma = item separator)
export CCBAR_LAYOUT="5h,today,week,month|7d,session,model,path"

# Or generate config file
ccbar --init-config   # → ~/.config/ccbar.json
```

<details>
<summary><b>Config file reference</b></summary>

```json
{
  "rows": [["5h", "today", "week", "month"], ["7d", "session", "model", "path"]],
  "columns": null,
  "colors": {},
  "pricing": {
    "claude-opus-4-6":    { "in": 15,  "out": 75, "cc": 18.75, "cr": 1.5  },
    "claude-sonnet-4-6":  { "in": 3,   "out": 15, "cc": 3.75,  "cr": 0.3  },
    "claude-haiku-4-5":   { "in": 0.8, "out": 4,  "cc": 1,     "cr": 0.08 }
  }
}
```

| Field | Description |
|-------|-------------|
| `columns` | Override detected terminal width (`null` = auto via ancestor tty) |
| `pricing` | $/million tokens per model |
| `colors` | `[R, G, B]` overrides for any named color key |

</details>

<details>
<summary><b>Available items</b></summary>

| Item | Shows |
|------|-------|
| `5h` | 5-hour quota bar + reset countdown |
| `7d` | 7-day quota bar + per-model breakdown + countdown |
| `model` | context% + model name + clock |
| `session` | session cost + burn rate + projection + duration + lines changed |
| `today` | today tokens + ♻cache + cost [› proj ♻cache/hit% + cost] |
| `week` | week tokens + cost [› proj cost] |
| `month` | month tokens + cost [› proj cost] |
| `path` | current working directory |

</details>

## ▸ How it works

```
stdin JSON → detect terminal width → fetch OAuth quota (cached 30s)
           → scan ~/.claude/projects/**/*.jsonl (cached 60s)
           → dedup by message.id → per-model pricing → adaptive layout → stdout
```

**OAuth token** — macOS: auto-reads from Keychain. Linux/CI: `export CLAUDE_OAUTH_TOKEN="..."`. Without it, quota bars show `--`.

## ▸ Uninstall

```bash
ccbar --uninstall && pip uninstall ccbar
```

---

<!-- ==================== 中文 ==================== -->

<div align="center">

## 中文文档

</div>

## ▸ 安装

```bash
pip install ccbar
ccbar --install
```

重启 Claude Code 即可。

## ▸ 显示内容

| 行 | 内容 |
|----|------|
| **1** | `5h` 配额条 + 倒计时 · `today` token + ♻缓存 + 费用 [› 项目 ♻缓存/命中率] · `week` token + 费用 · `month` token + 费用 |
| **2** | `7d` 配额条 + 倒计时 · `session` 费用 + 燃烧率 + 预测 + 时长 + 代码行 · `context`% + 模型 + 时钟 · `path` 路径 |

**自适应** — 终端太窄时自动砍掉尾部列，列内内容永不调整。

## ▸ 核心特性

<table>
<tr>
<td width="50%">

### 按模型定价
Opus 输出 **$75/百万 token**，Haiku 仅 **$4/百万**。<br>
统一定价工具会让 Opus 费用偏差 5 倍。<br>
ccbar 逐条读取模型 ID 应用正确费率。

</td>
<td width="50%">

### 流式去重
每次 API 调用产生 2–7 条 JSONL 记录。<br>
不去重会导致费用膨胀 2–7 倍。<br>
ccbar 按 `message.id` 去重。

</td>
</tr>
<tr>
<td>

### 跨会话历史
今日/本周/本月总计 + 按项目细分 `› proj`。<br>
不只是每次重置的会话费用。

</td>
<td>

### 燃烧率与预测
`$8.50/h` — 当前燃烧率。<br>
`→$14` — 按燃烧率预测当前 5 小时配额窗口<br>
结束时的总费用。

</td>
</tr>
<tr>
<td>

### 缓存 token
`♻253M` — 总缓存 token 一目了然。<br>
`♻55.9M/97%` — 按项目显示命中率。

</td>
<td>

### HSL 渐变进度条
绿→黄→红色相旋转。<br>
0.1 秒读懂配额状态。

</td>
</tr>
</table>

## ▸ 配置

默认布局：**2 行 × 4 列**。

```bash
# 环境变量（竖线分隔行，逗号分隔项）
export CCBAR_LAYOUT="5h,today,week,month|7d,session,model,path"

# 或生成配置文件
ccbar --init-config   # → ~/.config/ccbar.json
```

<details>
<summary><b>配置文件参考</b></summary>

```json
{
  "rows": [["5h", "today", "week", "month"], ["7d", "session", "model", "path"]],
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
| `columns` | 覆盖检测到的终端宽度（`null` = 通过祖先 tty 自动检测） |
| `pricing` | 每百万 token 价格 |
| `colors` | `[R, G, B]` 颜色覆盖 |

</details>

<details>
<summary><b>可用项</b></summary>

| 项 | 显示 |
|----|------|
| `5h` | 5 小时配额条 + 倒计时 |
| `7d` | 7 天配额条 + 模型细分 + 倒计时 |
| `model` | 上下文% + 模型名 + 时钟 |
| `session` | 会话费用 + 燃烧率 + 预测 + 时长 + 代码行变化 |
| `today` | 今日 token + ♻缓存 + 费用 [› 项目 ♻缓存/命中率 + 费用] |
| `week` | 本周 token + 费用 [› 项目费用] |
| `month` | 本月 token + 费用 [› 项目费用] |
| `path` | 当前工作目录 |

</details>

## ▸ 工作原理

```
stdin JSON → 检测终端宽度 → 获取 OAuth 配额（缓存 30s）
           → 扫描 ~/.claude/projects/**/*.jsonl（缓存 60s）
           → 按 message.id 去重 → 按模型定价 → 自适应布局 → stdout
```

**OAuth token** — macOS 自动从 Keychain 读取。Linux/CI：`export CLAUDE_OAUTH_TOKEN="..."`。无 OAuth 时配额条显示 `--`。

## ▸ 卸载

```bash
ccbar --uninstall && pip uninstall ccbar
```

---

<div align="center">

MIT License · Made for developers who treat AI compute as a budget line item.

</div>
