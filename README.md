# 🤖 Daily Commit Automation Suite

Automatically pushes **2 commits every day** to keep the repository active using GitHub Actions.

---

## ⏰ Schedule

| Slot | Cron (UTC) | IST Time |
|------|-----------|----------|
| 🌅 Morning Pulse | `30 3 * * *` | 9:00 AM |
| 🌆 Evening Sync  | `30 12 * * *` | 6:00 PM |

---

## 📁 Project Structure

```
.
├── .github/
│   └── workflows/
│       └── daily_commits.yml   ← GitHub Actions workflow
├── scripts/
│   └── daily_commit.sh         ← Core commit script
├── logs/
│   ├── activity.log            ← Human-readable log (auto-updated)
│   └── commit_stats.json       ← JSON stats tracker (auto-updated)
└── README.md
```

---

## 🚀 Setup (One-Time)

### Step 1 — Clone & push these files

```bash
git clone https://github.com/atultaneja88/daily_commit_automation_suit.git
cd daily_commit_automation_suit

# Copy all files from this package into the repo root
# Then:
git add .
git commit -m "feat: initialize daily commit automation suite"
git push origin main
```

### Step 2 — Verify Actions are enabled

Go to your repo → **Settings → Actions → General**  
Make sure **"Allow all actions and reusable workflows"** is selected.

### Step 3 — That's it! ✅

GitHub Actions will automatically run at 9 AM and 6 PM IST every day.

---

## 🔧 Manual Trigger

You can trigger a commit manually anytime:

1. Go to your repo on GitHub
2. Click **Actions** tab
3. Select **🤖 Daily Commit Automation**
4. Click **Run workflow**

---

## 📊 What gets committed?

Each commit updates two files:

- **`logs/activity.log`** — timestamped entry with slot info, metrics snapshot, and a motivational quote
- **`logs/commit_stats.json`** — running JSON counter with full history of the last 60 commits

---

## 📈 Stats File Format

```json
{
  "total_commits": 42,
  "last_commit_utc": "2026-03-20 03:30:00 UTC",
  "last_slot": "morning",
  "last_run": 21,
  "daily_history": [
    { "date": "2026-03-20", "slot": "morning", "run": 21, "label": "🌅 Morning Pulse" }
  ]
}
```

---

## 🛡️ Permissions

The workflow uses the built-in `GITHUB_TOKEN` — **no personal access token required.**

---

*Built with ❤️ using GitHub Actions*
