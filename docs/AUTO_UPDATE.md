# Auto-Update Pipeline — SC Earnings & Patch Data

Keeps the **Earnings Finder** and **Patch Hub** data current with each new Star
Citizen patch, automatically.

## How it works

1. **`.github/workflows/update-sc-data.yml`** runs every **Monday 06:00 UTC**
   (and can be triggered manually under *Actions → Update SC Data → Run workflow*).
2. It runs **`scripts/update-sc-data.py`**, which uses **Claude (Opus 4.8) with
   web search** to find the current SC patch and the latest money / reputation
   methods + new gameplay features.
3. The script merges the findings into `data/activities.json`,
   `data/guides.json`, and `data/patch-info.json`:
   - **adds** new activities and guides,
   - **revises** aUEC/hour values for known activities,
   - marks no-longer-viable activities **`stale`** (it never deletes — you review),
   - bumps the patch stamp + `auto_updated` date.
4. If anything changed, the workflow commits to `master` and GitHub Pages
   rebuilds. The site shows the data patch + last-updated date in the Patch Hub.

## One-time setup (required)

The workflow needs an Anthropic API key as a repository secret:

1. Get a key at <https://console.anthropic.com> → API Keys.
2. In the repo: **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key
3. Done. The next scheduled run (or a manual *Run workflow*) will use it.

> Cost is minimal — one Opus 4.8 run with web search per week (a few cents).

## Run it locally

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...
export RUN_DATE=$(date -u +%Y-%m-%d)
python scripts/update-sc-data.py
git diff data/        # review, then commit if good
```

## Design notes

- **Conservative merges.** New data is added; existing entries are revised in
  place; dropped activities are demoted to `confidence: "stale"` + tagged, not
  removed. Every change lands in a reviewable commit.
- **Accuracy flags.** aUEC/hour are community estimates — each carries a
  `verified` / `estimated` / `rough` / `stale` confidence the UI surfaces.
- **Model.** `claude-opus-4-8` with the `web_search_20260209` server tool and
  adaptive thinking. Change `MODEL` in the script to adjust.
