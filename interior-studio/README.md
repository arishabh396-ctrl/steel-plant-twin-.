# Studio Ledger: interior design studio demo

A project profit dashboard, cash flow tracker and what-if planner for an
interior design studio. Built as a demo a CA firm can show clients. All data
is fictional sample data (studio "Plumb Line Interiors", Pune, FY 2026-27).

## Files

- `engine.js`: the calculation engine. Pure JavaScript, no dependencies.
  Project costs by trade, percentage-of-completion revenue, milestone and RA
  billing with retention, GST with input credit, TDS deducted by clients,
  advance tax, crew capacity, and a 300-run Monte Carlo simulation.
- `studio-ledger.html`: the dashboard page (three sheets: Projects, Cash flow, What if).
- `test_engine.js`: checks on the engine. Run `node interior-studio/test_engine.js`.

## Run locally

    cd interior-studio
    python3 -m http.server 8000
    # open http://localhost:8000/studio-ledger.html

## Using it with a real client

Replace `PROJECTS`, `STUDIO` and `PIPELINE` in `engine.js` with the client's
figures: project quotes by trade, costs booked to date, billing milestones,
payment history and monthly overheads.

## Views

- **Studio owner**: plain words, "three things to do this month", tap any `?` for an explanation.
- **CA / accountant**: adds sheet A-04 Working papers (revenue recognition schedule,
  debtors ageing, GST working, TDS by client, advance tax) with "Copy for Excel" buttons,
  and a CA note under every `?`. Open with `#ca` at the end of the link to start in this view.

## Hosting on your own web address

`python3 interior-studio/build_site.py` writes a ready-to-upload folder to
`interior-studio/site/` (index.html, engine.js, robots.txt). Upload that folder to any
static host, for example Cloudflare Pages ("Upload assets") or Netlify Drop, then
connect a sub-domain such as `ledger.yourfirm.in`.

Before putting a real client's numbers on it, put the site behind a login
(Cloudflare Access is free for small teams). A public link with real data would
expose confidential client information.
