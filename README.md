# ccbar

**Precise project cost accounting for Claude Code. Zero dependencies.**

ccbar scans your local JSONL logs to compute per-model, per-project, cross-session costs with streaming dedup, shows real-time OAuth quota bars, burn rate, and cost projection — all in pure Python stdlib.

<!-- ![demo](screenshots/demo.png) -->

## Install

```bash
pip install ccbar
ccbar --install
```

Restart Claude Code. Done.

## What it shows

```
5h ━━━━━━━━─ 87% 0h44m │ today 8.8M $502 › proj 1.6M ♻55.9M $124 │ week  21.2M $990 │ month 22.1M $1.0k
7d ━━──────── 29% 5d15h │ session $8.50 $8.50/h →$14 1h0m +250/-40 │ context 42% Opus 4.6 23:16 │ path  ~/myproj
```

**Row 1:** 5h quota bar + countdown │ today tokens + cost [› proj cache] │ week tokens + cost │ month tokens + cost

**Row 2:** 7d quota bar + countdown │ session cost · burn rate · projection · duration · lines │ context% · model · clock │ path

### Adaptive layout

Width too narrow? ccbar drops trailing columns automatically — content within columns is never modified.

### Session burn rate & projection

- **`$8.50/h`** — current burn rate (session cost ÷ session duration)
- **`→$14`** — projected total cost by end of current 5-hour quota window

## Why ccbar?

### Project costs, not session vanity metrics

Most tools show session cost that resets every session. ccbar scans all JSONL logs to compute **today / week / month** totals with **per-project breakdown** — so you know "this project cost $124 today" not just "I spent $502 total".

### Per-model pricing

Opus output costs **$75/M tokens**. Haiku costs **$4/M**. A tool that assumes flat pricing will undercount your Opus spending by 5x. ccbar reads the model ID from each JSONL message and applies the correct rate.

### Streaming dedup

Each API call produces 2–7 JSONL entries during streaming. Without dedup, cost numbers inflate 2–7x. ccbar deduplicates by `message.id`, keeping only the final entry.

### Cache tokens

`♻55.9M` shows how many input tokens came from cache. ccbar makes this visible at a glance.

### Gradient progress bars

HSL hue rotation (green→yellow→red) tells you quota status instantly. No parsing needed.

### Zero dependencies

Pure stdin→stdout, single process, instant exit. Python stdlib only.

## Comparison

| | ccbar | ccusage statusline | Other statuslines |
|---|---|---|---|
| **Focus** | Project cost accounting | Session analysis | Display formatting |
| **OAuth quota bars** | 5h + 7d with countdown | - | - |
| **Cross-session history** | today/week/month | daily/blocks | session only |
| **Per-project breakdown** | `› proj` | - | - |
| **Burn rate / projection** | $/h → projected | tok/min + projection | - |
| **Cache tokens** | ♻ visible | internal | - |
| **Streaming dedup** | msg_id | msg_id:req_id | N/A |
| **Per-model pricing** | configurable | LiteLLM prefetch | N/A |
| **Auto-adaptive layout** | drop columns | - | - |
| **Dependencies** | 0 | 15+ npm | Node/Go/Rust |

## Configure

Default: 2 rows × 4 columns.

### Environment variable

```bash
export CCBAR_LAYOUT="5h,today,week,month|7d,session,model,path"
```

### Config file

```bash
ccbar --init-config   # creates ~/.config/ccbar.json
```

```json
{
  "rows": [["5h", "today", "week", "month"], ["7d", "session", "model", "path"]],
  "columns": null,
  "colors": {},
  "pricing": {
    "claude-opus-4-6": {"in": 15, "out": 75, "cc": 18.75, "cr": 1.5},
    "claude-sonnet-4-6": {"in": 3, "out": 15, "cc": 3.75, "cr": 0.3},
    "claude-haiku-4-5": {"in": 0.8, "out": 4, "cc": 1, "cr": 0.08}
  }
}
```

- **columns** — override detected terminal width (null = auto-detect)
- **pricing** — $/million tokens
- **colors** — `[R, G, B]` overrides for any named color

### Available items

| Item | Shows |
|------|-------|
| `5h` | 5-hour quota bar + reset countdown |
| `7d` | 7-day quota bar + per-model breakdown + countdown |
| `model` | context% + model name + clock |
| `session` | session cost + $/h burn rate + →projection + duration + lines |
| `today` | today tokens + cost [› proj + ♻cache tokens + cost] |
| `week` | week tokens + cost [› proj] |
| `month` | month tokens + cost [› proj] |
| `path` | current working directory |

## How it works

1. Claude Code pipes JSON to stdin (model, context, cost, workspace)
2. ccbar detects real terminal width via ancestor tty
3. ccbar fetches OAuth quota from Anthropic API (cached 30s)
4. ccbar scans `~/.claude/projects/**/*.jsonl` for token usage (cached 60s)
5. Streaming entries deduplicated by `message.id` — last entry wins
6. Per-model pricing applied per message
7. Adaptive layout drops trailing columns if content exceeds terminal width

### OAuth token

macOS: auto-reads from Keychain. Linux/CI:
```bash
export CLAUDE_OAUTH_TOKEN="your-token"
```
Without OAuth, quota bars show `--` but everything else works.

## Uninstall

```bash
ccbar --uninstall
pip uninstall ccbar
```

## License

MIT

---

# ccbar（中文）

**Claude Code 精确项目成本核算工具。零依赖。**

ccbar 扫描本地 JSONL 日志，按模型、按项目计算跨会话费用，支持流式去重、实时 OAuth 配额进度条、燃烧率和费用预测——纯 Python 标准库实现。

## 安装

```bash
pip install ccbar
ccbar --install
```

重启 Claude Code 即可。

## 显示内容

```
5h ━━━━━━━━─ 87% 0h44m │ today 8.8M $502 › proj 1.6M ♻55.9M $124 │ week  21.2M $990 │ month 22.1M $1.0k
7d ━━──────── 29% 5d15h │ session $8.50 $8.50/h →$14 1h0m +250/-40 │ context 42% Opus 4.6 23:16 │ path  ~/myproj
```

**第一行：** 5h 配额条 + 倒计时 │ 今日 token + 费用 [› 项目缓存] │ 本周 token + 费用 │ 本月 token + 费用

**第二行：** 7d 配额条 + 倒计时 │ 会话费用 · 燃烧率 · 预测 · 时长 · 代码行 │ 上下文% · 模型 · 时钟 │ 路径

### 自适应布局

终端太窄？ccbar 自动砍掉尾部列——列内内容永不调整。

### 会话燃烧率与预测

- **`$8.50/h`** — 当前燃烧率（会话费用 ÷ 会话时长）
- **`→$14`** — 按燃烧率预测当前 5 小时配额窗口结束时的总费用

## 为什么选 ccbar？

### 追踪项目费用，不是会话虚荣指标

多数工具只显示每次会话重置的费用。ccbar 扫描全部 JSONL 日志计算 **今日/本周/本月** 总计，支持 **按项目细分**——你能知道"这个项目今天花了 $124"，而不只是"我总共花了 $502"。

### 按模型定价

Opus 输出 **$75/百万 token**，Haiku 仅 **$4/百万**。假设统一定价会让 Opus 费用偏差 5 倍。ccbar 从每条 JSONL 读取模型 ID，应用正确费率。

### 流式去重

每次 API 调用产生 2–7 条 JSONL 流式记录。不去重会导致费用膨胀 2–7 倍。ccbar 按 `message.id` 去重，只保留最终条目。

### 缓存 token

`♻55.9M` 显示多少输入 token 来自缓存，一目了然。

### 渐变进度条

HSL 色相旋转（绿→黄→红）让你瞬间读懂配额状态。

### 零依赖

纯 stdin→stdout，单进程，即时退出。仅依赖 Python 标准库。

## 配置

默认：2 行 × 4 列。

### 环境变量

```bash
export CCBAR_LAYOUT="5h,today,week,month|7d,session,model,path"
```

### 配置文件

```bash
ccbar --init-config   # 创建 ~/.config/ccbar.json
```

```json
{
  "rows": [["5h", "today", "week", "month"], ["7d", "session", "model", "path"]],
  "columns": null,
  "colors": {},
  "pricing": {
    "claude-opus-4-6": {"in": 15, "out": 75, "cc": 18.75, "cr": 1.5},
    "claude-sonnet-4-6": {"in": 3, "out": 15, "cc": 3.75, "cr": 0.3},
    "claude-haiku-4-5": {"in": 0.8, "out": 4, "cc": 1, "cr": 0.08}
  }
}
```

- **columns** — 覆盖检测到的终端宽度（null = 自动检测）
- **pricing** — 每百万 token 价格
- **colors** — `[R, G, B]` 颜色覆盖

### 可用项

| 项 | 显示 |
|----|------|
| `5h` | 5 小时配额条 + 倒计时 |
| `7d` | 7 天配额条 + 模型细分 + 倒计时 |
| `model` | 上下文% + 模型名 + 时钟 |
| `session` | 会话费用 + 燃烧率 + 预测 + 时长 + 代码行 |
| `today` | 今日 token + 费用 [› 项目 + ♻缓存 token + 费用] |
| `week` | 本周 token + 费用 [› 项目] |
| `month` | 本月 token + 费用 [› 项目] |
| `path` | 当前工作目录 |

## 工作原理

1. Claude Code 通过 stdin 传入 JSON（模型、上下文、费用、工作区）
2. ccbar 通过祖先进程 tty 检测真实终端宽度
3. ccbar 从 Anthropic API 获取 OAuth 配额（缓存 30 秒）
4. ccbar 扫描 `~/.claude/projects/**/*.jsonl` 获取 token 用量（缓存 60 秒）
5. 按 `message.id` 去重流式条目——保留最终值
6. 按消息逐条应用模型定价
7. 自适应布局：超宽时砍掉尾部列

### OAuth token

macOS：自动从 Keychain 读取。Linux/CI：
```bash
export CLAUDE_OAUTH_TOKEN="your-token"
```
没有 OAuth 时配额条显示 `--`，其余功能正常。

## 卸载

```bash
ccbar --uninstall
pip uninstall ccbar
```

## 许可

MIT
