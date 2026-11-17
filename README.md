# Token Radar

A radar for token launches: every pre-token protocol in a frozen DefiLlama snapshot,
ranked by the implied value of a launch, with a farm plan for each.

Built for the make.fun bounty **token-radar-01**. Model version **radar-2**.

## What it does

The snapshot is one frozen DefiLlama protocol index (2026-11-14, 758 protocols with
at least $5M of TVL). The radar scores every pre-token protocol in it — 198 rows:
the 40-protocol watchlist (every protocol with at least $50M of TVL and no token on
record) plus 158 early rows below that floor — and ranks them by implied value.

Implied value is an expected value, calibrated from the snapshot's own live protocols:

```
implied = tvl_usd × category_multiple × launch_propensity × growth_mult × maturity_mult
```

- **category_multiple** — what a token is worth if it launches, as a multiple of TVL:
  the median market-cap-to-TVL ratio of the live-token protocols in the same category,
  shrunk toward the snapshot's overall median (prior strength 5) and clamped to
  0.03–0.60. A DEX is priced like a DEX and a lender like a lender.
- **launch_propensity** — how often protocols in the category have a token at all:
  the share of the category's protocols that record one, smoothed toward the
  snapshot's overall share. Risk curators almost never launch; DEXs and lenders
  usually do.
- **growth_mult** = 1 + clamp(change_7d, −60, 120) / 100 × 0.5
- **maturity_mult** = 0.6 + min(age_days, 1095) / 1095 × 0.4 (unknown age: 365 days)

The calibration is recomputed from whatever snapshot the program is given — no
protocol name is ever special-cased, and no number is hardcoded from this snapshot.

A wrapped, staked or bridged product of a token that already trades is not a launch
candidate (WBTC is Bitcoin on Ethereum; a canonical bridge is a chain's own
plumbing), so bridges, liquid staking, wrapped products, exchanges and versioned
pools are left out — the watchlist's own definition, applied to the whole board.

Each row carries a seven-step farm plan derived from the protocol's own record
(category, chains, TVL, age), with every step stating what it costs and how long it
takes. The fifth step names the category's main risk.

## The dashboard

A single self-contained page (no network, no external assets) in `dashboard/`:

- A sortable, filterable, paged board: search, category, chain, minimum TVL and
  seven-day growth filters; 25 rows a page.
- A detail drawer for every protocol: the thesis the numbers imply, the full model
  breakdown (with the page recomputing the row and checking it against the board
  file), live comparables in the same category, and the farm plan.
- A model sandbox: move the growth and maturity weights and the whole board is
  recomputed and re-ranked live in the page.
- A calibration tab: every category's fitted multiple and launch rate, with the
  counts behind them.
- A live-token view: the protocols that already trade, set aside from the ranking
  with their market caps — the market the calibration is fitted on.
- A method section stating the model, the scope, the caveats and a note to the judge.

## Run it

Node 22.18+ (or 24), standard library only, no dependencies:

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

That writes `board.json` (the ranked board), `data.js` (the dashboard's dataset),
`dashboard/` (the page), `screenshots/` and `dossier.json` into the output
directory. Open `out/dashboard/index.html` to see the radar.

## Layout

```
main.ts                entrypoint: reads the snapshot, writes the output directory
lib/model.ts           the model: calibration, scoring, farm plans, board checks
vendor/makefun-board.ts  the kit's dossier builder (vendored, unchanged)
dashboard/             the page: index.html, app.css, app.js
screenshots/           the three screenshots, taken at 1440×900
```

## Caveats

Implied value is an estimate built on medians: a category's past multiples do not
set the price of the next launch, and a launch is a team's decision, not a law of
nature. "Pre-token" is the index's record — a launch the index has not picked up
would still show as pre-token. Nothing here is financial advice.
