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

HOME = os.path.expanduser("~")
PROJECTS_DIR = os.path.join(HOME, ".claude", "projects")
CONFIG_PATH = os.path.join(HOME, ".config", "ccbar.json")

# ── Default layout: 2 rows × 3 items ──
# Available items: 5h, 7d, model, today, history, session, total
DEFAULT_LAYOUT = [
    ["5h", "today", "history"],
    ["7d", "session", "total"],
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

    # ── Labels: deep blue family (distinct but all dark-blue) ──
    "label":  (70, 110, 180),    # "5h" "7d" (deep steel blue)
    "sess":   (80, 105, 170),    # "session" (deep navy blue)
    "today":  (65, 120, 175),    # "today" (deep ocean blue)
    "week":   (75, 115, 165),    # "week" (deep slate blue)
    "month":  (85, 100, 160),    # "month" (deep indigo blue)
    "ctx":    (60, 125, 185),    # "ctx" (deep sky blue)

    # ── Money: gold family ──
    "cost":   (255, 210, 60),    # cost $ values (gold)
    "burn":   (255, 190, 50),    # burn rate $/h (warm gold)
    "proj_":  (240, 180, 50),    # projection →$ (amber gold)

    # ── Time: violet family ──
    "tleft":  (170, 150, 230),   # 5h/7d countdown (violet)
    "dur":    (180, 155, 220),   # session duration (light violet)
    "time":   (240, 170, 110),   # clock HH:MM (warm amber, distinct)

    # ── Data ──
    "tok":    (200, 210, 230),   # token numbers (soft white)
    "model":  (80, 220, 170),    # model name (teal-green)
    "proj":   (255, 140, 80),    # "proj" breakdown (coral)
    "hit":    (200, 170, 100),   # cache hit rate (warm tan)
    "cache":  (170, 145, 110),   # cache ♻ symbol (muted bronze)

    # ── Misc ──
    "dim":    (120, 120, 140),   # dim text
    "paren":  (70, 70, 80),      # parentheses
    "empty":  (45, 45, 45),      # empty bar segments
    "total":  (110, 155, 200),   # total label (blue family)
    "lines+": (80, 210, 100),    # lines added (green)
    "lines-": (220, 90, 90),     # lines removed (red)
}


def rgb(r, g, b):
    return f"\033[1;38;2;{r};{g};{b}m"


def _c(name):
    return rgb(*COLORS[name])


R = "\033[0m"


def pct_color(pct):
    """Smooth gradient: green → yellow → red."""
    t = max(0, min(100, pct)) / 100.0
    h = 120.0 * (1.0 - t * t)
    return rgb(*_hsl_rgb(h))


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
    if n >= 1_000_000_000:
        return f"{n / 1e9:.1f}B"
    if n >= 1_000_000:
        return f"{n / 1e6:.1f}M"
    if n >= 1_000:
        return f"{n / 1e3:.1f}k"
    return str(int(n))


def fcost(v):
    if v >= 1_000_000:
        return f"${v / 1e6:.1f}M"
    if v >= 1_000:
        return f"${v / 1e3:.1f}k"
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
    if hours >= 24:
        return f"{hours // 24}d{hours % 24}h"
    return f"{hours}h{mins % 60}m"


# ═══════════════════════════════════════
#  Gradient bar
# ═══════════════════════════════════════

def _hsl_rgb(h, s=0.80, l=0.52):
    """HSL (h in degrees) → (R, G, B) ints."""
    h = max(0.0, min(120.0, h))
    c = (1.0 - abs(2.0 * l - 1.0)) * s
    x = c * (1.0 - abs((h / 60.0) % 2 - 1.0))
    m = l - c / 2.0
    if h < 60:
        r, g, b = c, x, 0.0
    else:
        r, g, b = x, c, 0.0
    return int((r + m) * 255), int((g + m) * 255), int((b + m) * 255)


def gradient_bar(pct, width=10):
    """Gradient bar with HSL hue interpolation (green→yellow→red).

    Each ━ cell colored by its position in the full bar via HSL hue rotation.
    """
    pct = max(0, min(100, pct))
    frac = pct * width / 100.0
    filled = int(frac)
    partial = frac - filled

    if pct > 0 and filled == 0 and partial < 0.01:
        filled = 1
        partial = 0.0

    bar = ""
    for i in range(filled):
        h = 120.0 * (1.0 - (i + 0.5) / width)
        r, g, b = _hsl_rgb(h)
        bar += f"\033[38;2;{r};{g};{b}m━"

    if partial > 0.1 and filled < width:
        h = 120.0 * (1.0 - (filled + 0.5) / width)
        r, g, b = _hsl_rgb(h)
        bar += f"\033[38;2;{r};{g};{b}m╸"
        empty = width - filled - 1
    else:
        empty = width - filled

    bar += f"{_c('empty')}{'─' * empty}{R}"
    return bar


# ═══════════════════════════════════════
#  Config
# ═══════════════════════════════════════

def load_config():
    """Load layout config: CCBAR_LAYOUT env → ~/.config/ccbar.json → defaults.

    Config can override: rows, colors, pricing, api, columns.
    """
    global PRICING, DFLT, API_CONFIG

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
            # Columns override
            if "columns" in file_cfg:
                cfg["columns"] = int(file_cfg["columns"])
            if "rows" in file_cfg:
                cfg["rows"] = file_cfg["rows"]
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
        "all_tok": 0, "all_cost": 0.0, "all_ccost": 0.0,
        "all_cr_tok": 0, "all_in_tok": 0,
    }
    st = {**ZERO, "projects": {}}

    if not os.path.isdir(PROJECTS_DIR):
        return st

    for proj in os.listdir(PROJECTS_DIR):
        pp = os.path.join(PROJECTS_DIR, proj)
        if not os.path.isdir(pp):
            continue
        p = dict(ZERO)
        for fp in glob.glob(os.path.join(pp, "**", "*.jsonl"), recursive=True):

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
                # All-time totals (no date filter)
                for d in (st, p):
                    d["all_tok"] += tok
                    d["all_cost"] += base
                    d["all_ccost"] += cr
                    d["all_cr_tok"] += cr_tok
                    d["all_in_tok"] += in_tok
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

        if p["all_tok"] > 0:
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
# ctx["lw"] = label width for this column (for cross-row label alignment).

# Label text length per item (for computing column label alignment)
ITEM_LABEL_LEN = {
    "5h": 2, "7d": 2, "model": 3,  # "ctx"
    "session": 4, "today": 5, "history": 4, "total": 5,  # "sess", "week"
}


def _label_gap(ctx, own_len):
    """Compute gap after label: 1 base space + extra padding to align."""
    lw = ctx.get("lw", own_len)
    return " " * (1 + max(0, lw - own_len))

def render_5h(ctx):
    """5-hour quota bar + countdown."""
    quota, bw = ctx["quota"], ctx["bw"]
    g = _label_gap(ctx, 2)
    if quota and quota.get("five_hour"):
        h5 = quota["five_hour"]
        pct = int(h5.get("utilization", 0) or 0)
        if bw > 0:
            left = (f"{_c('label')}5h{R}{g}{gradient_bar(pct, bw)} "
                    f"{pct_color(pct)}{pct:2d}%{R}")
        else:
            left = f"{_c('label')}5h{R}{g}{pct_color(pct)}{pct}%{R}"
        right = time_left(h5.get("resets_at"))
    else:
        left = f"{_c('label')}5h{R}{g}{_c('dim')}--{R}"
        right = ""
    return left, right


def render_7d(ctx):
    """7-day quota bar + countdown + per-model breakdown."""
    quota, bw = ctx["quota"], ctx["bw"]
    g = _label_gap(ctx, 2)
    if quota and quota.get("seven_day"):
        d7 = quota["seven_day"]
        pct = int(d7.get("utilization", 0) or 0)
        if bw > 0:
            left = (f"{_c('label')}7d{R}{g}{gradient_bar(pct, bw)} "
                    f"{pct_color(pct)}{pct:2d}%{R}")
        else:
            left = f"{_c('label')}7d{R}{g}{pct_color(pct)}{pct}%{R}"
        # Per-model breakdown only when there's room
        if bw >= 7:
            for key, lb in [("seven_day_opus", "op"), ("seven_day_sonnet", "sn")]:
                m = quota.get(key)
                if m and (m.get("utilization") or 0) > 0:
                    left += f" {_c('dim')}{lb}:{int(m['utilization'])}%{R}"
        right = time_left(d7.get("resets_at"))
    else:
        left = f"{_c('label')}7d{R}{g}{_c('dim')}--{R}"
        right = ""
    return left, right


def render_model(ctx):
    """ctx% + model name + clock right-aligned."""
    model = ctx["model"]
    ctx_pct = ctx["ctx_pct"]
    now_str = datetime.now(LOCAL_TZ).strftime("%H:%M")
    g = _label_gap(ctx, 3)  # "ctx" = 3
    left = f"{_c('ctx')}ctx{R}{g}{ctx_color(ctx_pct)}{ctx_pct}%{R} {_c('model')}{model}{R}"
    right = f"{_c('time')}{now_str}{R}"
    return left, right


def render_session(ctx):
    """Session cost + burn rate + projection + duration + lines."""
    cost_data = ctx["data"].get("cost", {})
    sess_cost = cost_data.get("total_cost_usd", 0) or 0
    dur_ms = cost_data.get("total_duration_ms", 0) or 0
    lines_add = cost_data.get("total_lines_added", 0) or 0
    lines_rm = cost_data.get("total_lines_removed", 0) or 0

    g = _label_gap(ctx, 4)  # "sess" = 4
    s = f"{_c('sess')}sess{R}{g}{_c('cost')}{fcost(sess_cost)}{R}"

    # Burn rate: $/hour
    dur_hours = dur_ms / 3_600_000 if dur_ms else 0
    burn_rate = sess_cost / dur_hours if dur_hours > 0.01 else 0
    if burn_rate > 0:
        s += f" {_c('burn')}{fcost(burn_rate)}/h{R}"

    # Projection
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

    # Duration
    dur = fmt_duration(dur_ms)
    if dur:
        s += f" {_c('dur')}{dur}{R}"

    # Context percentage
    ctx_pct = ctx["ctx_pct"]
    if ctx_pct > 0:
        s += f" {ctx_color(ctx_pct)}{ctx_pct}%{R}"

    # Lines → right-aligned
    right = f"{_c('lines+')}+{lines_add}{R}{_c('dim')}/{R}{_c('lines-')}-{lines_rm}{R}"
    return s, right


def render_total(ctx):
    """All-time: tokens + ♻cache + cost + path."""
    gt, gp = ctx["g"], ctx["gp"]
    cwd = ctx["cwd"]
    gap = _label_gap(ctx, 5)  # "total" = 5
    # Global all-time
    g_cost = gt("all_cost") + gt("all_ccost")
    left = (f"{_c('total')}total{R}{gap}"
            f"{_tok_cache(gt('all_tok'), gt('all_cr_tok'), gt('all_in_tok'), pct=False)} "
            f"{_c('cost')}{fcost(g_cost)}{R}")
    # Project breakdown
    if gp("all_cost") + gp("all_ccost") > 0:
        p_cost = gp("all_cost") + gp("all_ccost")
        left += (f" {_c('dim')}›{R} {_c('proj')}proj{R} "
                 f"{_tok_cache(gp('all_tok'), gp('all_cr_tok'), gp('all_in_tok'), pct=True)} "
                 f"{_c('cost')}{fcost(p_cost)}{R}")
    short = shorten_path(cwd)
    right = f"{_c('dim')}{short}{R}"
    return left, right


def _tok_cache(tok, cr, in_tok, pct=True):
    """Format: token_count [♻cache_read or ♻cache_read/hit%]."""
    s = f"{_c('tok')}{fmt(tok)}{R}"
    if cr > 0:
        s += f" {_c('cache')}♻{R}{_c('hit')}{fmt(cr)}{R}"
        if pct and in_tok > 0:
            total_in = cr + in_tok
            hit = int(cr * 100 / total_in) if total_in > 0 else 0
            s += f"{_c('cache')}/{hit}%{R}"
    return s


def _cost_total(base, cc):
    return f"{_c('cost')}{fcost(base + cc)}{R}"


def render_today(ctx):
    """Today: tokens + cost [› proj tokens + ♻cache/hit% + cost]."""
    gt, gp = ctx["g"], ctx["gp"]
    gap = _label_gap(ctx, 5)  # "today" = 5
    # Total: tokens only (no cache)
    left = f"{_c('today')}today{R}{gap}{_c('tok')}{fmt(gt('today_tok'))}{R}"
    # Proj: tokens + cache/hit% + cost
    if gp("today_tok") or gp("today_cr_tok"):
        left += (f" {_cost_total(gt('today_cost'), gt('today_ccost'))}"
                 f" {_c('dim')}›{R} {_c('proj')}proj{R} "
                 f"{_tok_cache(gp('today_tok'), gp('today_cr_tok'), gp('today_in_tok'), pct=True)}")
        right = _cost_total(gp('today_cost'), gp('today_ccost'))
    else:
        right = _cost_total(gt('today_cost'), gt('today_ccost'))
    return left, right


def render_history(ctx):
    """Week tokens+cost · month tokens+cost, with proj breakdown."""
    gt, gp = ctx["g"], ctx["gp"]
    gap = _label_gap(ctx, 4)  # "week" = 4
    # Week: proj tokens + global cost [› proj cost]
    w_tok = gp("week_tok") if gp("week_tok") else gt("week_tok")
    left = (f"{_c('week')}week{R}{gap}"
            f"{_c('tok')}{fmt(w_tok)}{R} "
            f"{_c('cost')}{fcost(gt('week_cost') + gt('week_ccost'))}{R}")
    if gp("week_cost") + gp("week_ccost") > 0:
        left += (f" {_c('dim')}›{R} {_c('proj')}proj{R}"
                 f" {_c('cost')}{fcost(gp('week_cost') + gp('week_ccost'))}{R}")
    # Month: tokens + cost [› proj cost]
    left += (f" {_c('sep')}│{R} "
             f"{_c('month')}month{R} "
             f"{_c('tok')}{fmt(gt('month_tok'))}{R} "
             f"{_c('cost')}{fcost(gt('month_cost') + gt('month_ccost'))}{R}")
    if gp("month_cost") + gp("month_ccost") > 0:
        left += (f" {_c('dim')}›{R} {_c('proj')}proj{R}"
                 f" {_c('cost')}{fcost(gp('month_cost') + gp('month_ccost'))}{R}")
    return left, ""


RENDERERS = {
    "5h":      render_5h,
    "7d":      render_7d,
    "model":   render_model,
    "today":   render_today,
    "history": render_history,
    "session": render_session,
    "total":   render_total,
}


# ═══════════════════════════════════════
#  Render
# ═══════════════════════════════════════

def _detect_cols():
    """Detect real terminal width via ancestor tty. Falls back to COLUMNS env → 140."""
    import fcntl, termios, struct

    try:
        pid = os.getpid()
        for _ in range(10):
            r = subprocess.run(
                ["ps", "-o", "ppid=,tty=", "-p", str(pid)],
                capture_output=True, text=True, timeout=1,
            )
            parts = r.stdout.split()
            if len(parts) < 2:
                break
            pid, tty = int(parts[0]), parts[1]
            if tty not in ("??", ""):
                with open("/dev/" + tty) as f:
                    res = fcntl.ioctl(f.fileno(), termios.TIOCGWINSZ, b"\x00" * 8)
                    _, c = struct.unpack("HH", res[:4])
                    if c > 0:
                        return c
    except Exception:
        pass

    try:
        c = int(os.environ.get("COLUMNS", 0))
        if c > 0:
            return c
    except (ValueError, TypeError):
        pass

    return 140


def main():
    """Read Claude Code JSON from stdin, output formatted statusbar."""
    raw = sys.stdin.read()
    data = json.loads(raw)

    cfg = load_config()
    rows_cfg = cfg.get("rows", DEFAULT_LAYOUT)

    m = data.get("model", "?")
    model = m.get("display_name", "?") if isinstance(m, dict) else str(m)
    cwd = data.get("workspace", {}).get("current_dir", "") or data.get("cwd", "")
    proj_dir = data.get("workspace", {}).get("project_dir", "") or cwd
    ctx_pct = int(data.get("context_window", {}).get("used_percentage", 0) or 0)

    pk = proj_dir.replace("/", "-") if proj_dir else ""
    quota = fetch_quota()
    tokens = get_tokens()

    cols = cfg.get("columns") or _detect_cols()
    cols -= 4  # safety margin for resize lag + terminal padding

    # ── Initial bar width (will be shrunk adaptively) ──
    bw = 8

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

    active_rows = rows_cfg

    # ── Compute per-column label widths for alignment ──
    n_cols = max((len(r) for r in active_rows), default=0)
    col_lw = [0] * n_cols
    for row_items in active_rows:
        for ci, item_name in enumerate(row_items):
            ll = ITEM_LABEL_LEN.get(item_name, 0)
            if ll > col_lw[ci]:
                col_lw[ci] = ll

    # ── Render all rows, collect cells ──
    all_rows = []
    for row_idx, row_items in enumerate(active_rows):
        cells = []
        for ci, item_name in enumerate(row_items):
            renderer = RENDERERS.get(item_name)
            if not renderer:
                continue
            ctx["lw"] = col_lw[ci] if ci < len(col_lw) else 0
            cells.append(renderer(ctx))
        all_rows.append(cells)

    # ── Compute aligned column widths across all rows ──
    max_cols = max((len(r) for r in all_rows), default=0)
    col_widths = [0] * max_cols
    for cells in all_rows:
        for i, (left, right) in enumerate(cells):
            w = vlen(left)
            if right:
                w += 1 + vlen(right)
            if w > col_widths[i]:
                col_widths[i] = w

    # ── Adaptive: shrink bars → drop proj → drop columns ──
    total = sum(col_widths) + sep_vlen * max(0, max_cols - 1)

    def _compute_widths(rows, nc):
        """Compute column widths and total."""
        cw = [0] * nc
        for cells in rows:
            for i, (left, right) in enumerate(cells):
                if i >= nc:
                    break
                w = vlen(left)
                if right:
                    w += 1 + vlen(right)
                if w > cw[i]:
                    cw[i] = w
        return cw, sum(cw) + sep_vlen * max(0, nc - 1)

    # ── Adaptive: only drop trailing columns, never adjust content ──
    while total > cols and max_cols > 1:
        max_cols -= 1
        col_widths, total = _compute_widths(all_rows, max_cols)
        for row in all_rows:
            while len(row) > max_cols:
                row.pop()

    # ── Output rows with aligned columns ──
    for cells in all_rows:
        parts = []
        for i, (left, right) in enumerate(cells):
            w = col_widths[i] if i < len(col_widths) else 0
            if right:
                gap = max(1, w - vlen(left) - vlen(right))
                parts.append(left + " " * gap + right)
            else:
                parts.append(pad(left, w))
        print(sep.join(parts))


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
        "columns": None,
        "colors": {},
        "pricing": PRICING_TABLE,
        "api": API_CONFIG,
    }
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(default_cfg, f, indent=2)
    print(f"✓ Created config: {CONFIG_PATH}")
    print()
    print("  Available items: 5h, 7d, model, session, today, history, total")
    print()
    print("  columns: set your terminal width (e.g. 162) for optimal layout")
    print("           null = auto-detect (120 fallback in piped mode)")
    print("  Pricing: $/million tokens — update when Anthropic changes rates")
    print("  API: endpoint + beta header for OAuth quota")


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
        print("Layout items: 5h, 7d, model, today, history, session, total")
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
