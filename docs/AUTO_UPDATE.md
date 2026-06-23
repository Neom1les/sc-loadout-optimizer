# Keeping the SC Earnings & Patch Data Current

The **Earnings Finder** and **Patch Hub** data is community-curated and shifts
with each Star Citizen patch. It is refreshed **manually, on request** — there
is **no stored API key and no automatic job**, by design (the repo and the
website are public, so no secret lives here).

## How to refresh (the normal way)

Just ask Claude Code in this repo:

> "Update the SC data."

Claude then:
1. Web-searches the **current live SC patch** and the latest money / reputation
   methods + any new gameplay features.
2. Merges findings into `data/activities.json`, `data/guides.json`, and
   `data/patch-info.json` — adds new entries, revises aUEC/hour values, and
   flags anything no longer viable (it doesn't silently delete).
3. Commits & pushes. GitHub Pages rebuilds; the Patch Hub shows the new data
   patch + date.

No key, nothing to configure. You see exactly what changed in the commit.

## Optional: run the helper script locally

`scripts/update-sc-data.py` does the same fetch programmatically with the
Anthropic API. It is **not wired to any GitHub Action** — run it on your own
machine with your own key if you ever want to:

```bash
pip install anthropic
export ANTHROPIC_API_KEY=sk-ant-...      # stays on your machine only
export RUN_DATE=$(date -u +%Y-%m-%d)
python scripts/update-sc-data.py
git diff data/                            # review, then commit if good
```

The key never enters the repo or GitHub. (A scheduled GitHub Action was
deliberately **not** used, to avoid storing a key in a public project.)

## Design notes

- **Conservative merges** — new data added, existing values revised in place,
  dropped activities demoted to `confidence: "stale"` + tagged, never removed.
- **Accuracy flags** — aUEC/hour are community estimates, each carrying a
  `verified` / `estimated` / `rough` / `stale` confidence the UI surfaces.
