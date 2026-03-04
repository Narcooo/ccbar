#!/usr/bin/env python3
"""ccbar — Accurate cost tracking and quota monitoring for Claude Code.

Zero dependencies. Pure Python stdlib. Cross-session cost history with
per-model pricing, streaming dedup, cache hit rate, and OAuth quota bars.

Layout is configurable via ~/.config/ccbar.json or CCBAR_LAYOUT env var.
"""

import json
import sys
import os
import time
import glob
import subprocess
import re
import shutil
import tempfile
from datetime import datetime, timedelta, timezone

from ccbar import __version__

# ── Timezone: use system local ──
LOCAL_TZ = datetime.now().astimezone().tzinfo

# ── Cache paths: cross-platform temp dir ──
_TMPDIR = tempfile.gettempdir()
QUOTA_CACHE = os.path.join(_TMPDIR, "ccbar-quota.json")
TOKEN_CACHE = os.path.join(_TMPDIR, "ccbar-tokens.json")
QUOTA_TTL = 30   # API refresh interval (seconds)
TOKEN_TTL = 60   # JSONL scan interval (seconds)
COMPACT_CTX_THRESHOLD = 80  # ctx% above this → auto-compress to 1 row

HOME = os.path.expanduser("~")
PROJECTS_DIR = os.path.join(HOME, ".claude", "projects")
CONFIG_PATH = os.path.join(HOME, ".config", "ccbar.json")

# ── Default layout: 2 rows × 3 items ──
# Available items: 5h, 7d, model, today, week, month, session, path
DEFAULT_LAYOUT = [
    ["5h", "7d", "model"],
    ["session", "today", "month"],
]

# ── Per-model pricing (USD per million tokens) ──
# Overridable in ~/.config/ccbar.json under "pricing"
PRICING_TABLE = {
    "claude-opus-4-6":   {"in": 15, "out": 75, "cc": 18.75, "cr": 1.5},
    "claude-opus-4-5":   {"in": 15, "out": 75, "cc": 18.75, "cr": 1.5},
    "claude-sonnet-4-5": {"in": 3,  "out": 15, "cc": 3.75,  "cr": 0.3},
    "claude-sonnet-4-6": {"in": 3,  "out": 15, "cc": 3.75,  "cr": 0.3},
    "claude-haiku-4-5":  {"in": .8, "out": 4,  "cc": 1,     "cr": .08},
}
DFLT_PRICING = {"in": 3, "out": 15, "cc": 3.75, "cr": 0.3}

# ── OAuth API config ──
API_CONFIG = {
    "endpoint": "https://api.anthropic.com/api/oauth/usage",
    "beta_header": "oauth-2025-04-20",
}

def _per_token(table):
    """Convert $/million table to $/token for calculation."""
    return {k: {t: v / 1e6 for t, v in rates.items()} for k, rates in table.items()}

PRICING = _per_token(PRICING_TABLE)
DFLT = {t: v / 1e6 for t, v in DFLT_PRICING.items()}

# ── True-color palette ──
# Edit these or override in ~/.config/ccbar.json {"colors": {"cost": [255,0,0]}}
COLORS = {
    "sep":    (60, 60, 70),      # separator │
    "label":  (120, 160, 220),   # "5h" "7d" labels (steel blue)
    "today":  (110, 160, 200),   # "today" label (muted slate blue)
    "week":   (130, 155, 190),   # "week" label (dusty blue)
    "month":  (145, 150, 180),   # "month" label (lavender gray)
    "proj":   (255, 150, 100),   # "proj" label (coral orange)
    "model":  (80, 220, 180),    # model name (teal)
    "cost":   (255, 210, 80),    # cost $ (gold)
    "tok":    (220, 220, 230),   # token numbers (bright white)
    "ctx":    (160, 160, 180),   # ctx label
    "time":   (240, 180, 130),   # clock (warm peach)
    "dim":    (140, 140, 155),   # dim text
    "cache":  (130, 140, 160),   # cache cost (muted steel)
    "hit":    (100, 200, 160),   # cache hit rate (green-teal)
    "tleft":  (180, 160, 220),   # time-left countdown
    "paren":  (70, 70, 80),      # parentheses
    "empty":  (45, 45, 45),      # empty bar segments
    "sess":   (200, 180, 255),   # session label (light purple)
    "burn":   (255, 160, 100),   # burn rate (warm orange)
    "proj_":  (200, 130, 80),    # projection arrow (amber)
    "path":   (160, 180, 200),   # path label (steel)
    "lines+": (100, 200, 120),   # lines added (green)
    "lines-": (200, 100, 100),   # lines removed (red)
    "compact":(200, 200, 100),   # compact-mode today cost (muted yellow)
}


def rgb(r, g, b):
    return f"\033[1;38;2;{r};{g};{b}m"


def _c(name):
    return rgb(*COLORS[name])


R = "\033[0m"


def pct_color(pct):
    """Smooth gradient: green → yellow → red."""
    t = max(0, min(100, pct)) / 100.0
    if t < 0.5:
        f = t / 0.5
        r, g, b = int(40 + 215 * f), int(210 + 10 * f), int(100 - 100 * f)
    else:
        f = (t - 0.5) / 0.5
        r, g, b = 255, int(220 - 170 * f), int(40 * (1 - f))
    return rgb(r, g, b)


def ctx_color(pct):
    """Smooth gradient for ctx: cool gray → amber → deep orange."""
    t = max(0, min(100, pct)) / 100.0
    if t < 0.5:
        f = t / 0.5
        r, g, b = int(140 + 95 * f), int(150 - 10 * f), int(170 - 100 * f)
    else:
        f = (t - 0.5) / 0.5
        r, g, b = int(235 + 20 * f), int(140 - 80 * f), int(70 - 40 * f)
    return rgb(r, g, b)


# ═══════════════════════════════════════
#  Formatting helpers
# ═══════════════════════════════════════

def fmt(n):
    if n >= 1_000_000:
        return f"{n / 1e6:.1f}M"
    if n >= 1_000:
        return f"{n / 1e3:.1f}k"
    return str(int(n))


def fcost(v):
    if v >= 100:
        return f"${v:.0f}"
    if v >= 10:
        return f"${v:.1f}"
    return f"${v:.2f}"


def time_left(resets_at_str):
    if not resets_at_str:
        return ""
    try:
        left = datetime.fromisoformat(resets_at_str) - datetime.now(timezone.utc)
        secs = int(left.total_seconds())
        if secs <= 0:
            return f"{_c('tleft')}resetting{R}"
        h, m = secs // 3600, (secs % 3600) // 60
        if h > 24:
            return f"{_c('tleft')}{h // 24}d{h % 24}h{R}"
        return f"{_c('tleft')}{h}h{m:02d}m{R}"
    except (ValueError, TypeError):
        return ""


def vlen(s):
    """Visible length (strip ANSI escape codes)."""
    return len(re.sub(r'\033\[[^m]*m', '', s))


def pad(s, w):
    return s + ' ' * max(0, w - vlen(s))


def shorten_path(p, max_len=25):
    """Shorten path: /Users/foo/projects/bar → ~/projects/bar or .../bar."""
    if not p:
        return ""
    home = os.path.expanduser("~")
    if p.startswith(home):
        p = "~" + p[len(home):]
    if len(p) <= max_len:
        return p
    parts = p.split(os.sep)
    # Keep last 2 components
    short = os.sep.join(parts[-2:]) if len(parts) >= 2 else parts[-1]
    return f"…/{short}" if len(short) < len(p) else p[:max_len - 1] + "…"


def fmt_duration(ms):
    """Format milliseconds to human-readable duration."""
    if not ms or ms <= 0:
        return ""
    secs = int(ms / 1000)
    if secs < 60:
        return f"{secs}s"
    mins = secs // 60
    if mins < 60:
        return f"{mins}m"
    hours = mins // 60
    return f"{hours}h{mins % 60}m"


# ═══════════════════════════════════════
#  Gradient bar
# ═══════════════════════════════════════

def gradient_bar(pct, width=24):
    pct = max(0, min(100, pct))
    filled = int(pct * width / 100)
    if pct > 0 and filled == 0:
        filled = 1
    empty = width - filled
    bar = ""
    for i in range(filled):
        t = i / max(width - 1, 1)
        if t < 0.5:
            f = t / 0.5
            r, g, b = int(40 + 215 * f), int(210 + 10 * f), int(100 - 100 * f)
        else:
            f = (t - 0.5) / 0.5
            r, g, b = 255, int(220 - 170 * f), int(40 * (1 - f))
        bar += f"\033[38;2;{r};{g};{b}m━"
    bar += f"{_c('empty')}{'─' * empty}{R}"
    return bar


# ═══════════════════════════════════════
#  Config
# ═══════════════════════════════════════

def load_config():
    """Load layout config: CCBAR_LAYOUT env → ~/.config/ccbar.json → defaults.

    Config can override: rows, colors, pricing, api, compact_threshold.
    """
    global PRICING, DFLT, API_CONFIG, COMPACT_CTX_THRESHOLD

    cfg = {"rows": DEFAULT_LAYOUT}

    # 1. Config file (load first for colors/pricing/api)
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r") as f:
                file_cfg = json.load(f)
            # Merge colors
            if "colors" in file_cfg:
                for k, v in file_cfg["colors"].items():
                    if k in COLORS and isinstance(v, (list, tuple)) and len(v) == 3:
                        COLORS[k] = tuple(v)
            # Merge pricing ($/million format in config)
            if "pricing" in file_cfg:
                for model, rates in file_cfg["pricing"].items():
                    PRICING_TABLE[model] = rates
                PRICING = _per_token(PRICING_TABLE)
                if "default" in file_cfg["pricing"]:
                    DFLT = {t: v / 1e6 for t, v in file_cfg["pricing"]["default"].items()}
            # Merge API config
            if "api" in file_cfg:
                API_CONFIG.update(file_cfg["api"])
            # Compact threshold
            if "compact_threshold" in file_cfg:
                COMPACT_CTX_THRESHOLD = int(file_cfg["compact_threshold"])
            cfg = file_cfg if "rows" in file_cfg else cfg
        except (OSError, json.JSONDecodeError):
            pass

    # 2. Env var overrides rows
    env = os.environ.get("CCBAR_LAYOUT", "").strip()
    if env:
        cfg["rows"] = [row.split(",") for row in env.split("|")]

    return cfg


# ═══════════════════════════════════════
#  OAuth API — real quota
# ═══════════════════════════════════════

def get_oauth_token():
    """Get OAuth token: env var → macOS keychain → None."""
    token = os.environ.get("CLAUDE_OAUTH_TOKEN", "").strip()
    if token:
        return token

    try:
        raw = subprocess.check_output(
            ["security", "find-generic-password",
             "-s", "Claude Code-credentials", "-w"],
            stderr=subprocess.DEVNULL, text=True).strip()
        return json.loads(raw).get("claudeAiOauth", {}).get("accessToken", "")
    except (FileNotFoundError, subprocess.CalledProcessError,
            json.JSONDecodeError, KeyError):
        return ""


def fetch_quota():
    """Fetch OAuth quota with TTL cache."""
    try:
        if os.path.exists(QUOTA_CACHE):
            if time.time() - os.path.getmtime(QUOTA_CACHE) < QUOTA_TTL:
                with open(QUOTA_CACHE, "r") as f:
                    return json.load(f)
    except (OSError, json.JSONDecodeError):
        pass

    token = get_oauth_token()
    if not token:
        return None

    try:
        import urllib.request
        req = urllib.request.Request(
            API_CONFIG["endpoint"],
            headers={
                "Authorization": f"Bearer {token}",
                "anthropic-beta": API_CONFIG["beta_header"],
            },
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return None

    try:
        with open(QUOTA_CACHE, "w") as f:
            json.dump(data, f)
    except OSError:
        pass
    return data


# ═══════════════════════════════════════
#  JSONL scan — token/cost stats
# ═══════════════════════════════════════

def est_cost(model, u):
    """Return (base_cost, cache_read_cost)."""
    p = PRICING.get(model, DFLT)
    base = (
        (u.get("input_tokens", 0) or 0) * p["in"]
        + (u.get("output_tokens", 0) or 0) * p["out"]
        + (u.get("cache_creation_input_tokens", 0) or 0) * p["cc"]
    )
    cr = (u.get("cache_read_input_tokens", 0) or 0) * p["cr"]
    return base, cr


def scan_tokens():
    """Scan all JSONL files, return totals + per-project breakdown.

    Deduplicates by message ID — streaming produces 2-7 entries per call,
    only the last (with final output_tokens) is kept.
    """
    now = datetime.now(LOCAL_TZ)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = (today_start - timedelta(days=now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    cuts = {
        "today": today_start,
        "week":  week_start,
        "month": month_start,
    }

    ZERO = {
        "today_tok": 0, "today_cost": 0.0, "today_ccost": 0.0,
        "today_cr_tok": 0, "today_in_tok": 0,
        "week_tok": 0, "week_cost": 0.0, "week_ccost": 0.0,
        "week_cr_tok": 0, "week_in_tok": 0,
        "month_tok": 0, "month_cost": 0.0, "month_ccost": 0.0,
    }
    st = {**ZERO, "projects": {}}

    if not os.path.isdir(PROJECTS_DIR):
        return st

    month_ts = cuts["month"].timestamp()
    for proj in os.listdir(PROJECTS_DIR):
        pp = os.path.join(PROJECTS_DIR, proj)
        if not os.path.isdir(pp):
            continue
        p = dict(ZERO)
        for fp in glob.glob(os.path.join(pp, "**", "*.jsonl"), recursive=True):
            try:
                if os.path.getmtime(fp) < month_ts:
                    continue
            except OSError:
                continue

            msgs = {}
            try:
                with open(fp, "r", errors="ignore") as f:
                    for line in f:
                        if '"input_tokens"' not in line:
                            continue
                        try:
                            entry = json.loads(line)
                        except (json.JSONDecodeError, ValueError):
                            continue
                        msg = entry.get("message", {})
                        usage = msg.get("usage")
                        ts_str = entry.get("timestamp", "")
                        msg_id = msg.get("id", "")
                        if not usage or not ts_str or not msg_id:
                            continue
                        if entry.get("type") == "progress":
                            continue
                        msgs[msg_id] = (msg, usage, ts_str)
            except OSError:
                continue

            for msg, usage, ts_str in msgs.values():
                try:
                    ts = datetime.fromisoformat(
                        ts_str.replace("Z", "+00:00")
                    ).astimezone(LOCAL_TZ)
                except (ValueError, TypeError):
                    continue
                tok = sum(usage.get(k, 0) or 0 for k in (
                    "input_tokens", "output_tokens",
                    "cache_creation_input_tokens"))
                cr_tok = usage.get("cache_read_input_tokens", 0) or 0
                in_tok = ((usage.get("input_tokens", 0) or 0)
                          + (usage.get("cache_creation_input_tokens", 0) or 0))
                base, cr = est_cost(msg.get("model", ""), usage)
                if ts >= cuts["month"]:
                    for d in (st, p):
                        d["month_tok"] += tok
                        d["month_cost"] += base
                        d["month_ccost"] += cr
                    if ts >= cuts["week"]:
                        for d in (st, p):
                            d["week_tok"] += tok
                            d["week_cost"] += base
                            d["week_ccost"] += cr
                            d["week_cr_tok"] += cr_tok
                            d["week_in_tok"] += in_tok
                        if ts >= cuts["today"]:
                            for d in (st, p):
                                d["today_tok"] += tok
                                d["today_cost"] += base
                                d["today_ccost"] += cr
                                d["today_cr_tok"] += cr_tok
                                d["today_in_tok"] += in_tok

        if p["month_tok"] > 0:
            st["projects"][proj] = p

    return st


def get_tokens():
    """Return cached or fresh token stats."""
    try:
        if os.path.exists(TOKEN_CACHE):
            if time.time() - os.path.getmtime(TOKEN_CACHE) < TOKEN_TTL:
                with open(TOKEN_CACHE, "r") as f:
                    return json.load(f)
    except (OSError, json.JSONDecodeError):
        pass

    st = scan_tokens()
    try:
        with open(TOKEN_CACHE, "w") as f:
            json.dump(st, f)
    except OSError:
        pass
    return st


def proj_stats(tokens, pk):
    """Extract current project's stats from cached data."""
    projects = tokens.get("projects", {})
    norm_pk = pk.replace("_", "-")
    for name, data in projects.items():
        if name.replace("_", "-") == norm_pk:
            return data
    return None


# ═══════════════════════════════════════
#  Item renderers
# ═══════════════════════════════════════
#
# Each returns (left_str, right_str).
# "right" is used for right-aligned countdown timers (empty for most items).

def render_5h(ctx):
    """5-hour quota bar + countdown."""
    quota, bw = ctx["quota"], ctx["bw"]
    if quota and quota.get("five_hour"):
        h5 = quota["five_hour"]
        pct = int(h5.get("utilization", 0) or 0)
        if bw > 0:
            left = (f"{_c('label')}5h{R} {gradient_bar(pct, bw)} "
                    f"{pct_color(pct)}{pct:2d}%{R}")
        else:
            # Ultra-narrow: no bar, just label + pct
            left = f"{_c('label')}5h{R} {pct_color(pct)}{pct}%{R}"
        right = time_left(h5.get("resets_at"))
    else:
        left = f"{_c('label')}5h{R} {_c('dim')}--{R}"
        right = ""
    return left, right


def render_7d(ctx):
    """7-day quota bar + countdown + per-model breakdown."""
    quota, bw = ctx["quota"], ctx["bw"]
    if quota and quota.get("seven_day"):
        d7 = quota["seven_day"]
        pct = int(d7.get("utilization", 0) or 0)
        if bw > 0:
            left = (f"{_c('label')}7d{R} {gradient_bar(pct, bw)} "
                    f"{pct_color(pct)}{pct:2d}%{R}")
        else:
            left = f"{_c('label')}7d{R} {pct_color(pct)}{pct}%{R}"
        # Per-model breakdown only when there's room
        if bw >= 7:
            for key, lb in [("seven_day_opus", "op"), ("seven_day_sonnet", "sn")]:
                m = quota.get(key)
                if m and (m.get("utilization") or 0) > 0:
                    left += f" {_c('dim')}{lb}:{int(m['utilization'])}%{R}"
        right = time_left(d7.get("resets_at"))
    else:
        left = f"{_c('label')}7d{R} {_c('dim')}--{R}"
        right = ""
    return left, right


def render_model(ctx):
    """Model name + context %. Clock is rendered separately via right-align."""
    model = ctx["model"]
    ctx_pct = ctx["ctx_pct"]
    left = f"{_c('model')}{model}{R} {ctx_color(ctx_pct)}ctx {ctx_pct}%{R}"
    return left, ""


def render_session(ctx):
    """Session cost + burn rate + projection + duration + lines."""
    cost_data = ctx["data"].get("cost", {})
    sess_cost = cost_data.get("total_cost_usd", 0) or 0
    dur_ms = cost_data.get("total_duration_ms", 0) or 0
    lines_add = cost_data.get("total_lines_added", 0) or 0
    lines_rm = cost_data.get("total_lines_removed", 0) or 0

    s = f"{_c('sess')}sess{R} {_c('cost')}{fcost(sess_cost)}{R}"

    # Burn rate: $/hour
    dur_hours = dur_ms / 3_600_000 if dur_ms else 0
    burn_rate = sess_cost / dur_hours if dur_hours > 0.01 else 0
    if burn_rate > 0:
        s += f" {_c('burn')}{fcost(burn_rate)}/h{R}"

    # Projection: estimated cost for remaining 5h window
    quota = ctx.get("quota")
    if burn_rate > 0 and quota and quota.get("five_hour"):
        resets_at = quota["five_hour"].get("resets_at", "")
        if resets_at:
            try:
                remaining = datetime.fromisoformat(resets_at) - datetime.now(timezone.utc)
                rem_hours = max(0, remaining.total_seconds() / 3600)
                if rem_hours > 0:
                    projected = sess_cost + burn_rate * rem_hours
                    s += f" {_c('proj_')}→{fcost(projected)}{R}"
            except (ValueError, TypeError):
                pass

    dur = fmt_duration(dur_ms)
    if dur:
        s += f" {_c('dim')}{dur}{R}"
    if lines_add or lines_rm:
        s += f" {_c('lines+')}+{lines_add}{R}{_c('dim')}/{R}{_c('lines-')}-{lines_rm}{R}"
    return s, ""


def render_path(ctx):
    """Current working directory (shortened)."""
    cwd = ctx["cwd"]
    short = shorten_path(cwd)
    return f"{_c('path')}{short}{R}", ""


def _tok_cache(tok, cr, in_tok):
    """Format: token_count [⟳cache_read/hit%]."""
    s = f"{_c('tok')}{fmt(tok)}{R}"
    if cr > 0:
        total_in = cr + in_tok
        hit = int(cr * 100 / total_in) if total_in > 0 else 0
        s += f" {_c('hit')}⟳{fmt(cr)}{R}{_c('cache')}/{hit}%{R}"
    return s


def _cost_total(base, cc):
    return f"{_c('cost')}{fcost(base + cc)}{R}"


def render_today(ctx):
    """Today: tokens + cost [› proj tokens + cache/hit% + cost]."""
    g, gp = ctx["g"], ctx["gp"]
    # Today: just tokens + cost (no cache detail — that's proj-level)
    s = (f"{_c('today')}today{R} {_c('tok')}{fmt(g('today_tok'))}{R} "
         f"{_cost_total(g('today_cost'), g('today_ccost'))}")
    # Proj: tokens + cache/hit% + cost (cache matters at project level)
    if gp("today_tok") or gp("today_cr_tok"):
        s += (f" {_c('dim')}›{R} {_c('proj')}proj{R} "
              f"{_tok_cache(gp('today_tok'), gp('today_cr_tok'), gp('today_in_tok'))} "
              f"{_cost_total(gp('today_cost'), gp('today_ccost'))}")
    return s, ""


def render_week(ctx):
    """Week: tokens + cost [› proj ...]."""
    g, gp = ctx["g"], ctx["gp"]
    s = (f"{_c('week')}week{R} {_c('tok')}{fmt(g('week_tok'))}{R} "
         f"{_cost_total(g('week_cost'), g('week_ccost'))}")
    if gp("week_tok"):
        s += (f" {_c('dim')}›{R} {_c('proj')}proj{R} "
              f"{_c('tok')}{fmt(gp('week_tok'))}{R} "
              f"{_cost_total(gp('week_cost'), gp('week_ccost'))}")
    return s, ""


def render_month(ctx):
    """Month: tokens + cost [› proj cost]."""
    g, gp = ctx["g"], ctx["gp"]
    s = (f"{_c('month')}month{R} {_c('tok')}{fmt(g('month_tok'))}{R} "
         f"{_cost_total(g('month_cost'), g('month_ccost'))}")
    if gp("month_cost") + gp("month_ccost") > 0:
        s += (f" {_c('dim')}›{R} {_c('proj')}proj{R} "
              f"{_cost_total(gp('month_cost'), gp('month_ccost'))}")
    return s, ""


RENDERERS = {
    "5h":      render_5h,
    "7d":      render_7d,
    "model":   render_model,
    "today":   render_today,
    "week":    render_week,
    "month":   render_month,
    "session": render_session,
    "path":    render_path,
}


# ═══════════════════════════════════════
#  Render
# ═══════════════════════════════════════

def main():
    """Read Claude Code JSON from stdin, output formatted statusbar."""
    raw = sys.stdin.read()
    data = json.loads(raw)

    cfg = load_config()
    rows_cfg = cfg.get("rows", DEFAULT_LAYOUT)

    model = data.get("model", {}).get("display_name", "?")
    cwd = data.get("workspace", {}).get("current_dir", "") or data.get("cwd", "")
    proj_dir = data.get("workspace", {}).get("project_dir", "") or cwd
    ctx_pct = int(data.get("context_window", {}).get("used_percentage", 0) or 0)

    pk = proj_dir.replace("/", "-") if proj_dir else ""
    quota = fetch_quota()
    tokens = get_tokens()

    cols = shutil.get_terminal_size((120, 24)).columns

    # ── Width-adaptive bar size ──
    # Progressive degradation for split windows
    if cols >= 140:
        bw = 16
    elif cols >= 120:
        bw = 10
    elif cols >= 90:
        bw = 7
    elif cols >= 70:
        bw = 4
    else:
        bw = 0  # No bars, just percentages

    ps = proj_stats(tokens, pk)

    def g(k):
        return tokens.get(k, 0)

    def gp(k):
        return ps[k] if ps else 0

    # Shared context for all renderers
    ctx = {
        "data": data, "model": model, "cwd": cwd, "proj_dir": proj_dir,
        "ctx_pct": ctx_pct, "quota": quota, "tokens": tokens, "ps": ps,
        "cols": cols, "bw": bw, "g": g, "gp": gp,
    }

    sep = f" {_c('sep')}│{R} "
    sep_vlen = 3  # visible: " │ "

    # ── Context-adaptive: compress to 1 row when ctx is high ──
    compact = ctx_pct >= COMPACT_CTX_THRESHOLD and len(rows_cfg) > 1
    active_rows = [rows_cfg[0]] if compact else rows_cfg

    # ── Clock (right-aligned on row 1) ──
    now_str = datetime.now(LOCAL_TZ).strftime("%H:%M")
    clock = f"{_c('time')}{now_str}{R}"
    clock_vlen = vlen(clock)

    for row_idx, row_items in enumerate(active_rows):
        cells = []
        for item_name in row_items:
            renderer = RENDERERS.get(item_name)
            if not renderer:
                continue
            left, right = renderer(ctx)
            cells.append((left, right))

        if not cells:
            continue

        # Compact mode: append today cost to last cell
        if compact and row_idx == 0:
            today_cost = g("today_cost") + g("today_ccost")
            if today_cost > 0:
                last_left, last_right = cells[-1]
                last_left += f" {_c('compact')}{fcost(today_cost)}/d{R}"
                cells[-1] = (last_left, last_right)

        # ── Compose cells into row string ──
        parts = []
        for left, right in cells:
            if right:
                parts.append(left + " " + right)
            else:
                parts.append(left)
        row_str = sep.join(parts)
        row_vlen = vlen(row_str)

        # ── Row 1: right-align clock to terminal edge ──
        if row_idx == 0:
            gap = max(1, cols - row_vlen - clock_vlen - 1)
            row_str += " " * gap + clock

        # ── Width overflow: progressive truncation for non-row-1 ──
        if vlen(row_str) > cols and row_idx > 0:
            # Pass 1: re-render without proj breakdowns
            saved_ps = ctx["ps"]
            ctx["ps"] = None
            trimmed = []
            for item_name in row_items:
                renderer = RENDERERS.get(item_name)
                if not renderer:
                    continue
                left, right = renderer(ctx)
                trimmed.append(left if not right else left + " " + right)
            ctx["ps"] = saved_ps
            row_str = sep.join(trimmed)

            # Pass 2: if still too wide, drop items from the end
            while vlen(row_str) > cols and len(trimmed) > 1:
                trimmed.pop()
                row_str = sep.join(trimmed)

        print(row_str)


# ═══════════════════════════════════════
#  Install / Uninstall
# ═══════════════════════════════════════

def install():
    """Register ccbar as Claude Code's statusline command."""
    settings_path = os.path.join(HOME, ".claude", "settings.json")

    settings = {}
    if os.path.exists(settings_path):
        try:
            with open(settings_path, "r") as f:
                settings = json.load(f)
        except (OSError, json.JSONDecodeError):
            pass

    if os.path.exists(settings_path):
        ts = datetime.now().strftime("%Y%m%d%H%M%S")
        backup = f"{settings_path}.bak.{ts}"
        try:
            shutil.copy2(settings_path, backup)
            print(f"  Backed up → {backup}")
        except OSError:
            pass

    settings["statusLine"] = {"type": "command", "command": "ccbar"}

    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)

    print("✓ ccbar installed as Claude Code statusline")
    print("  Restart Claude Code to activate.")
    print()
    print("  Default layout: 2 rows × 3 items")
    print("  Customize: ~/.config/ccbar.json or CCBAR_LAYOUT env var")
    print()
    print("  Example single-row (avoids 'context left until' overlap):")
    print('    CCBAR_LAYOUT="5h,7d,session,model"')


def uninstall():
    """Remove ccbar from Claude Code settings and clean up caches."""
    settings_path = os.path.join(HOME, ".claude", "settings.json")

    if os.path.exists(settings_path):
        try:
            with open(settings_path, "r") as f:
                settings = json.load(f)
            if "statusLine" in settings:
                del settings["statusLine"]
                with open(settings_path, "w") as f:
                    json.dump(settings, f, indent=2)
                print("✓ Removed statusLine from settings.json")
            else:
                print("  statusLine not found in settings.json")
        except (OSError, json.JSONDecodeError) as e:
            print(f"  Error updating settings: {e}")

    for cache in (QUOTA_CACHE, TOKEN_CACHE):
        try:
            os.remove(cache)
        except FileNotFoundError:
            pass

    print("✓ ccbar uninstalled. Cache files cleaned.")


def init_config():
    """Create default config file at ~/.config/ccbar.json."""
    if os.path.exists(CONFIG_PATH):
        print(f"  Config already exists: {CONFIG_PATH}")
        return

    default_cfg = {
        "rows": DEFAULT_LAYOUT,
        "compact_threshold": COMPACT_CTX_THRESHOLD,
        "colors": {},
        "pricing": PRICING_TABLE,
        "api": API_CONFIG,
    }
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(default_cfg, f, indent=2)
    print(f"✓ Created config: {CONFIG_PATH}")
    print()
    print("  Available items: 5h, 7d, model, session, today, week, month, path")
    print()
    print("  Pricing: $/million tokens — update when Anthropic changes rates")
    print("  API: endpoint + beta header for OAuth quota")
    print(f"  Compact: auto-compress to 1 row when ctx ≥ {COMPACT_CTX_THRESHOLD}%")


# ═══════════════════════════════════════
#  CLI entry point
# ═══════════════════════════════════════

def cli():
    if "--install" in sys.argv:
        install()
    elif "--uninstall" in sys.argv:
        uninstall()
    elif "--init-config" in sys.argv:
        init_config()
    elif "--version" in sys.argv:
        print(f"ccbar {__version__}")
    elif "--help" in sys.argv or "-h" in sys.argv:
        print(f"ccbar {__version__} — Accurate cost tracking for Claude Code")
        print()
        print("Usage:")
        print("  ccbar                Read Claude Code JSON from stdin, output statusbar")
        print("  ccbar --install      Register ccbar as Claude Code statusline command")
        print("  ccbar --uninstall    Remove ccbar and clean up caches")
        print("  ccbar --init-config  Create default config at ~/.config/ccbar.json")
        print("  ccbar --version      Print version")
        print()
        print("Layout items: 5h, 7d, model, today, week, month, session, path")
        print()
        print("Environment:")
        print("  CCBAR_LAYOUT         Row layout (e.g. '5h,7d,model|today,week,month')")
        print("  CLAUDE_OAUTH_TOKEN   OAuth token (skip keychain lookup)")
    else:
        try:
            main()
        except Exception:
            print("\033[31mccbar error\033[0m")
            import traceback
            traceback.print_exc(file=sys.stderr)


if __name__ == "__main__":
    cli()
