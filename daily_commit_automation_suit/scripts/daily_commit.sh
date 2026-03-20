#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  daily_commit.sh  ·  Daily Commit Automation Suite
#  Writes structured log entries and commits them to the repo
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
LOG_FILE="logs/activity.log"
STATS_FILE="logs/commit_stats.json"
SLOT="${COMMIT_SLOT:-morning}"
LABEL="${COMMIT_LABEL:-🤖 Auto Commit}"
NOW_UTC=$(date -u "+%Y-%m-%d %H:%M:%S UTC")
NOW_DATE=$(date -u "+%Y-%m-%d")
RUN_NUMBER="${GITHUB_RUN_NUMBER:-0}"

# ── Ensure log directory exists ───────────────────────────────────────────────
mkdir -p logs

# ── Helper: pick a random motivational quote ─────────────────────────────────
pick_quote() {
  local quotes=(
    "Small steps every day lead to big results."
    "Consistency beats perfection."
    "Every commit counts — keep building."
    "Progress over perfection, always."
    "Code a little every day; ship something great."
    "Discipline is the bridge between goals and achievement."
    "One commit at a time, one day at a time."
    "Stay consistent. The results will follow."
    "Great software is built commit by commit."
    "Keep pushing — the best code is yet to come."
  )
  local idx=$(( RANDOM % ${#quotes[@]} ))
  echo "${quotes[$idx]}"
}

# ── Helper: generate a fake but realistic "activity summary" ─────────────────
generate_activity() {
  local files_checked=$(( RANDOM % 30 + 5 ))
  local tests_passed=$(( RANDOM % 50 + 20 ))
  local coverage=$(( RANDOM % 20 + 75 ))
  local perf_ms=$(( RANDOM % 200 + 50 ))

  echo "  files_scanned : ${files_checked}"
  echo "  tests_passed  : ${tests_passed}"
  echo "  coverage      : ${coverage}%"
  echo "  avg_perf_ms   : ${perf_ms}"
}

# ── 1. Append to activity log ─────────────────────────────────────────────────
QUOTE=$(pick_quote)

cat >> "${LOG_FILE}" << EOF

═══════════════════════════════════════════════════════════════
  ${LABEL}  |  ${NOW_UTC}
  Run #${RUN_NUMBER}  |  Slot: ${SLOT}
───────────────────────────────────────────────────────────────
  Quote    : "${QUOTE}"
$(generate_activity)
═══════════════════════════════════════════════════════════════
EOF

echo "✅ Activity log updated → ${LOG_FILE}"

# ── 2. Update JSON stats file ─────────────────────────────────────────────────
TOTAL_COMMITS=0
if [[ -f "${STATS_FILE}" ]]; then
  TOTAL_COMMITS=$(python3 -c "
import json, sys
try:
  data = json.load(open('${STATS_FILE}'))
  print(data.get('total_commits', 0))
except:
  print(0)
")
fi
TOTAL_COMMITS=$(( TOTAL_COMMITS + 1 ))

python3 - << PYEOF
import json, os
from datetime import datetime, timezone

stats_file = "${STATS_FILE}"
existing = {}
if os.path.exists(stats_file):
    with open(stats_file) as f:
        try:
            existing = json.load(f)
        except:
            pass

# Update counters
existing["total_commits"]   = ${TOTAL_COMMITS}
existing["last_commit_utc"] = "${NOW_UTC}"
existing["last_slot"]       = "${SLOT}"
existing["last_run"]        = ${RUN_NUMBER}

# Track daily history (keep last 30 days)
history = existing.get("daily_history", [])
today_entry = {
    "date":  "${NOW_DATE}",
    "slot":  "${SLOT}",
    "run":   ${RUN_NUMBER},
    "label": "${LABEL}"
}
history.append(today_entry)
existing["daily_history"] = history[-60:]  # keep 60 entries (~30 days × 2)

with open(stats_file, "w") as f:
    json.dump(existing, f, indent=2)

print(f"✅ Stats updated → total_commits={existing['total_commits']}")
PYEOF

# ── 3. Stage & commit ─────────────────────────────────────────────────────────
git add "${LOG_FILE}" "${STATS_FILE}"

COMMIT_MSG="${LABEL}: ${NOW_UTC} | run #${RUN_NUMBER} | \"${QUOTE}\""

git commit -m "${COMMIT_MSG}"

echo ""
echo "────────────────────────────────────────────"
echo "  ✅ Commit created successfully"
echo "  📅 ${NOW_UTC}"
echo "  🏷️  Slot   : ${SLOT}"
echo "  📊 Total  : ${TOTAL_COMMITS} commits so far"
echo "────────────────────────────────────────────"
