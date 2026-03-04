#!/usr/bin/env python3
"""ccbar — Accurate cost tracking and quota monitoring for Claude Code.

Zero dependencies. Pure Python stdlib. Cross-session cost history with
per-model pricing, streaming dedup, cache hit rate, and OAuth quota bars.
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

# ── Per-model pricing (USD per token) ──
# in=input, out=output, cc=cache_creation, cr=cache_read
PRICING = {
    "claude-opus-4-6":   {"in": 15/1e6, "out": 75/1e6, "cc": 18.75/1e6, "cr": 1.5/1e6},
    "claude-opus-4-5":   {"in": 15/1e6, "out": 75/1e6, "cc": 18.75/1e6, "cr": 1.5/1e6},
    "claude-sonnet-4-5": {"in": 3/1e6,  "out": 15/1e6, "cc": 3.75/1e6,  "cr": 0.3/1e6},
    "claude-sonnet-4-6": {"in": 3/1e6,  "out": 15/1e6, "cc": 3.75/1e6,  "cr": 0.3/1e6},
    "claude-haiku-4-5":  {"in": .8/1e6, "out": 4/1e6,  "cc": 1/1e6,     "cr": .08/1e6},
}
DFLT = {"in": 3/1e6, "out": 15/1e6, "cc": 3.75/1e6, "cr": 0.3/1e6}

# ── True-color palette ──
# Edit these to customize your statusline colors.
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
}

def rgb(r, g, b):
    return f"\033[1;38;2;{r};{g};{b}m"

def c(name):
    return rgb(*COLORS[name])

R = "\033[0m"
SEP = f" {c('sep')}│{R} "


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
            return f"{c('tleft')}resetting{R}"
        h, m = secs // 3600, (secs % 3600) // 60
        if h > 24:
            return f"{c('tleft')}{h // 24}d{h % 24}h{R}"
        return f"{c('tleft')}{h}h{m:02d}m{R}"
    except (ValueError, TypeError):
        return ""


def vlen(s):
    """Visible length (strip ANSI escape codes)."""
    return len(re.sub(r'\033\[[^m]*m', '', s))


def pad(s, w):
    return s + ' ' * max(0, w - vlen(s))


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
    bar += f"{c('empty')}{'─' * empty}{R}"
    return bar


# ═══════════════════════════════════════
#  OAuth API — real quota
# ═══════════════════════════════════════

def get_oauth_token():
    """Get OAuth token: env var → macOS keychain → None."""
    # 1. Environment variable (works everywhere)
    token = os.environ.get("CLAUDE_OAUTH_TOKEN", "").strip()
    if token:
        return token

    # 2. macOS Keychain fallback
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

    # Use urllib.request (stdlib) instead of curl subprocess
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://api.anthropic.com/api/oauth/usage",
            headers={
                "Authorization": f"Bearer {token}",
                "anthropic-beta": "oauth-2025-04-20",
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

            # Collect per-message: last entry wins (dedup streaming chunks)
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
                        # Last entry per msg_id has final output_tokens
                        msgs[msg_id] = (msg, usage, ts_str)
            except OSError:
                continue

            # Accumulate deduplicated messages
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
#  Render
# ═══════════════════════════════════════

def main():
    """Read Claude Code JSON from stdin, output formatted two-line statusbar."""
    raw = sys.stdin.read()
    data = json.loads(raw)

    model = data.get("model", {}).get("display_name", "?")
    cwd = data.get("workspace", {}).get("current_dir", "") or data.get("cwd", "")
    proj_dir = data.get("workspace", {}).get("project_dir", "") or cwd
    ctx_pct = int(data.get("context_window", {}).get("used_percentage", 0) or 0)

    pk = proj_dir.replace("/", "-") if proj_dir else ""
    quota = fetch_quota()
    tokens = get_tokens()

    cols = shutil.get_terminal_size((120, 24)).columns
    now_str = datetime.now(LOCAL_TZ).strftime("%H:%M")

    # Adaptive bar width
    if cols >= 140:
        bw = 16
    elif cols >= 100:
        bw = 10
    else:
        bw = 7

    ps = proj_stats(tokens, pk)

    def g(k):
        return tokens.get(k, 0)

    def gp(k):
        return ps[k] if ps else 0

    # ── 5h quota ──
    h5_tl = ""
    if quota and quota.get("five_hour"):
        h5 = quota["five_hour"]
        h5_pct = int(h5.get("utilization", 0) or 0)
        h5_bar = (f"{c('label')}5h{R} {gradient_bar(h5_pct, bw)} "
                  f"{pct_color(h5_pct)}{h5_pct:2d}%{R}")
        h5_tl = time_left(h5.get("resets_at"))
    else:
        h5_bar = f"{c('label')}5h{R} {c('dim')}--{R}"

    # ── 7d quota ──
    d7_tl = ""
    if quota and quota.get("seven_day"):
        d7 = quota["seven_day"]
        d7_pct = int(d7.get("utilization", 0) or 0)
        d7_bar = (f"{c('label')}7d{R} {gradient_bar(d7_pct, bw)} "
                  f"{pct_color(d7_pct)}{d7_pct:2d}%{R}")
        d7_tl = time_left(d7.get("resets_at"))
        for key, lb in [("seven_day_opus", "op"), ("seven_day_sonnet", "sn")]:
            m = quota.get(key)
            if m and (m.get("utilization") or 0) > 0:
                d7_bar += f" {c('dim')}{lb}:{int(m['utilization'])}%{R}"
    else:
        d7_bar = f"{c('label')}7d{R} {c('dim')}--{R}"

    # ── Row 1: 5h │ 7d │ model ctx% clock ──
    a1_left = h5_bar
    a1_right = h5_tl
    b1_left = d7_bar
    b1_right = d7_tl
    c1 = (f"{c('model')}{model}{R} "
          f"{ctx_color(ctx_pct)}ctx {ctx_pct}%{R} "
          f"{c('time')}{now_str}{R}")

    # ── Row 2 helpers ──
    def tok_cache(tok, cr, in_tok):
        s = f"{c('tok')}{fmt(tok)}{R}"
        if cr > 0:
            total_in = cr + in_tok
            hit = int(cr * 100 / total_in) if total_in > 0 else 0
            s += f" {c('hit')}⟳{fmt(cr)}{R}{c('cache')}/{hit}%{R}"
        return s

    def cost_total(base, cc):
        return f"{c('cost')}{fcost(base + cc)}{R}"

    # today: tok ⟳cache/hit% $cost › proj ...
    a2 = (f"{c('today')}today{R} "
          f"{tok_cache(g('today_tok'), g('today_cr_tok'), g('today_in_tok'))} "
          f"{cost_total(g('today_cost'), g('today_ccost'))}")
    if gp("today_tok") or gp("today_cr_tok"):
        a2 += (f" {c('dim')}›{R} {c('proj')}proj{R} "
               f"{tok_cache(gp('today_tok'), gp('today_cr_tok'), gp('today_in_tok'))} "
               f"{cost_total(gp('today_cost'), gp('today_ccost'))}")

    # week: tok $cost › proj tok $cost
    b2 = (f"{c('week')}week{R} {c('tok')}{fmt(g('week_tok'))}{R} "
          f"{cost_total(g('week_cost'), g('week_ccost'))}")
    if gp("week_tok"):
        b2 += (f" {c('dim')}›{R} {c('proj')}proj{R} "
               f"{c('tok')}{fmt(gp('week_tok'))}{R} "
               f"{cost_total(gp('week_cost'), gp('week_ccost'))}")

    # month: tok $cost › proj $cost
    c2 = (f"{c('month')}month{R} {c('tok')}{fmt(g('month_tok'))}{R} "
          f"{cost_total(g('month_cost'), g('month_ccost'))}")
    if gp("month_cost") + gp("month_ccost") > 0:
        c2 += (f" {c('dim')}›{R} {c('proj')}proj{R} "
               f"{cost_total(gp('month_cost'), gp('month_ccost'))}")

    # ── Pad columns ──
    def rpad(left, right, w):
        gap = max(1, w - vlen(left) - vlen(right))
        return left + " " * gap + right

    wa = max(vlen(a1_left) + 1 + vlen(a1_right), vlen(a2))
    wb = max(vlen(b1_left) + 1 + vlen(b1_right), vlen(b2))
    wc = max(vlen(c1), vlen(c2))

    row1 = SEP.join([rpad(a1_left, a1_right, wa),
                     rpad(b1_left, b1_right, wb),
                     pad(c1, wc)])
    row2 = SEP.join([pad(a2, wa), pad(b2, wb), pad(c2, wc)])

    print(row1)
    print(row2)


# ═══════════════════════════════════════
#  Install / Uninstall
# ═══════════════════════════════════════

def install():
    """Register ccbar as Claude Code's statusline command."""
    settings_path = os.path.join(HOME, ".claude", "settings.json")

    # Read existing settings
    settings = {}
    if os.path.exists(settings_path):
        try:
            with open(settings_path, "r") as f:
                settings = json.load(f)
        except (OSError, json.JSONDecodeError):
            pass

    # Backup
    if os.path.exists(settings_path):
        ts = datetime.now().strftime("%Y%m%d%H%M%S")
        backup = f"{settings_path}.bak.{ts}"
        try:
            shutil.copy2(settings_path, backup)
            print(f"  Backed up → {backup}")
        except OSError:
            pass

    # Set statusline
    settings["statusLine"] = {"type": "command", "command": "ccbar"}

    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)

    print("✓ ccbar installed as Claude Code statusline")
    print("  Restart Claude Code to activate.")


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

    # Clean up cache files
    for cache in (QUOTA_CACHE, TOKEN_CACHE):
        try:
            os.remove(cache)
        except FileNotFoundError:
            pass

    print("✓ ccbar uninstalled. Cache files cleaned.")


# ═══════════════════════════════════════
#  CLI entry point
# ═══════════════════════════════════════

def cli():
    if "--install" in sys.argv:
        install()
    elif "--uninstall" in sys.argv:
        uninstall()
    elif "--version" in sys.argv:
        print(f"ccbar {__version__}")
    elif "--help" in sys.argv or "-h" in sys.argv:
        print(f"ccbar {__version__} — Accurate cost tracking for Claude Code")
        print()
        print("Usage:")
        print("  ccbar              Read Claude Code JSON from stdin, output statusbar")
        print("  ccbar --install    Register ccbar as Claude Code statusline command")
        print("  ccbar --uninstall  Remove ccbar and clean up caches")
        print("  ccbar --version    Print version")
        print()
        print("Environment:")
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
