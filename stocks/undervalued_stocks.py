#!/usr/bin/env python3
"""
Undervalued US Stock Screener
==============================
Scoring model weights:
  - DCF margin of safety      25%
  - FCF yield                 20%
  - P/E ratio (vs sector)     20%
  - P/B ratio                 10%
  - Dividend yield            10%
  - Dividend growth trend     10%
  - Company age (≥15 yrs)      5%

HOW OFTEN TO RUN:
  Recommended schedule (add to crontab):
    Weekly  — Sunday night for a full rescan of fundamentals
              0 20 * * 0  python3 /path/to/undervalued_stocks.py
    Daily   — After market close for price-sensitive metrics (P/E, FCF yield)
              0 17 * * 1-5 python3 /path/to/undervalued_stocks.py --quick
  Rationale: Earnings and FCF data update quarterly; prices update daily.
  A weekly deep scan + daily price refresh balances accuracy vs. API load.
"""

import argparse
import datetime
import warnings
import sys

warnings.filterwarnings("ignore")

try:
    import yfinance as yf
    import pandas as pd
    import numpy as np
    from tabulate import tabulate
except ImportError as e:
    sys.exit(f"Missing dependency: {e}. Run: pip3 install yfinance pandas numpy tabulate")

# ── Configuration ────────────────────────────────────────────────────────────

# Broad universe: large/mid cap S&P 500 + extras. Extend as needed.
TICKER_UNIVERSE = [
    # Technology
    "AAPL","MSFT","GOOGL","META","INTC","CSCO","IBM","HPQ","TXN","QCOM","ORCL","ADBE","CRM","NVDA",
    # Financials
    "JPM","BAC","WFC","GS","MS","AXP","BRK-B","BLK","USB","PNC","TFC","COF","MMC",
    # Healthcare
    "JNJ","PFE","MRK","ABT","MDT","UNH","CVS","HUM","CI","AMGN","BMY","LLY","ABBV","GILD",
    # Consumer Staples
    "PG","KO","PEP","MO","PM","CL","GIS","K","HRL","SJM","CPB","CAG","CLX","CHD",
    # Consumer Discretionary
    "MCD","YUM","DPZ","SBUX","NKE","TGT","COST","LOW","HD","TJX","ROST","BBY","WHR",
    # Energy
    "XOM","CVX","COP","PSX","VLO","MPC","OKE","KMI","WMB","EOG","PXD","HAL","SLB",
    # Industrials
    "GE","HON","MMM","CAT","DE","EMR","ETN","ROK","PH","ITW","DOV","GWW","MSI","ROP",
    # Utilities
    "NEE","DUK","SO","AEP","EXC","XEL","ED","WEC","ES","ETR","PPL","FE","CNP",
    # Materials
    "LIN","APD","ECL","DD","PPG","SHW","NEM","FCX","NUE","VMC","MLM",
    # Real Estate
    "PLD","AMT","CCI","EQIX","O","SPG","PSA","EQR","AVB","DRE","VTR",
    # Communication
    "VZ","T","CMCSA","DIS","NFLX","CHTR","TMUS","DISH","LUMN",
]

# DCF assumptions
WACC = 0.09          # 9% discount rate
TERMINAL_GROWTH = 0.025  # 2.5% perpetuity growth
FCF_GROWTH_YEARS = 5    # forecast horizon
MIN_COMPANY_AGE_YEARS = 15

# Score weights (must sum to 1.0)
WEIGHTS = {
    "dcf_margin":      0.25,
    "fcf_yield":       0.20,
    "pe_score":        0.20,
    "pb_score":        0.10,
    "div_yield":       0.10,
    "div_growth":      0.10,
    "age_bonus":       0.05,
}

# ── Helpers ──────────────────────────────────────────────────────────────────

def safe_get(info: dict, *keys, default=None):
    for k in keys:
        v = info.get(k)
        if v is not None and v != 0:
            return v
    return default


def score_pe(pe: float) -> float:
    """Higher score for lower P/E (value zone 5-15, penalise >30)."""
    if pe is None or pe <= 0:
        return 0.0
    if pe <= 10:
        return 1.0
    if pe <= 15:
        return 0.85
    if pe <= 20:
        return 0.65
    if pe <= 25:
        return 0.45
    if pe <= 30:
        return 0.25
    return max(0.0, 1.0 - (pe / 60))


def score_pb(pb: float) -> float:
    """Lower P/B is better; score 1.0 at P/B ≤ 1, 0 at P/B ≥ 5."""
    if pb is None or pb <= 0:
        return 0.0
    return max(0.0, min(1.0, (5.0 - pb) / 4.0))


def dcf_intrinsic_value(fcf: float, growth_rate: float, shares: int) -> float | None:
    """Simple multi-stage DCF: 5-yr explicit + terminal value."""
    if not fcf or not shares or shares <= 0:
        return None
    g = min(max(growth_rate, -0.20), 0.30)  # clamp growth
    pv = 0.0
    cf = fcf
    for yr in range(1, FCF_GROWTH_YEARS + 1):
        cf *= (1 + g)
        pv += cf / ((1 + WACC) ** yr)
    # Terminal value
    terminal = cf * (1 + TERMINAL_GROWTH) / (WACC - TERMINAL_GROWTH)
    pv += terminal / ((1 + WACC) ** FCF_GROWTH_YEARS)
    return pv / shares


def dividend_growth_score(ticker_obj) -> float:
    """
    Returns 0-1 score based on consistency of dividend growth over 5 years.
    1.0 = growing every year; 0.5 = flat; 0 = declining or no dividends.
    """
    try:
        divs = ticker_obj.dividends
        if divs.empty:
            return 0.0
        # Annual totals
        annual = divs.resample("YE").sum()
        annual = annual[annual > 0]
        if len(annual) < 2:
            return 0.1
        recent = annual.tail(6)
        if len(recent) < 2:
            return 0.1
        growth_flags = [(recent.iloc[i] >= recent.iloc[i - 1]) for i in range(1, len(recent))]
        score = sum(growth_flags) / len(growth_flags)
        return round(score, 3)
    except Exception:
        return 0.0


def company_age_score(founded_year: int | None) -> float:
    """1.0 if ≥ MIN_COMPANY_AGE_YEARS, scaled below that."""
    if not founded_year:
        return 0.5  # unknown → neutral
    age = datetime.datetime.now().year - founded_year
    if age >= MIN_COMPANY_AGE_YEARS:
        return 1.0
    return round(age / MIN_COMPANY_AGE_YEARS, 3)


# ── Main screener ─────────────────────────────────────────────────────────────

def analyse_ticker(symbol: str, quick: bool = False) -> dict | None:
    try:
        tk = yf.Ticker(symbol)
        info = tk.info or {}

        # ── Basic guards ──────────────────────────────────────────────────
        market_cap = safe_get(info, "marketCap")
        if not market_cap or market_cap < 1e9:   # skip micro-caps
            return None

        current_price = safe_get(info, "currentPrice", "regularMarketPrice", "previousClose")
        if not current_price:
            return None

        # ── Metrics ───────────────────────────────────────────────────────
        fcf        = safe_get(info, "freeCashflow")
        shares     = safe_get(info, "sharesOutstanding")
        fcf_yield_val = (fcf / market_cap) if fcf and market_cap else None

        pe         = safe_get(info, "trailingPE", "forwardPE")
        pb         = safe_get(info, "priceToBook")
        div_yield  = safe_get(info, "dividendYield", default=0.0) or 0.0
        # yfinance ≥1.0 returns dividendYield as a decimal (0.029 = 2.9%).
        # Guard against builds that return it as a whole-number percent (2.9).
        if div_yield > 1.0:
            div_yield = div_yield / 100.0
        sector     = info.get("sector", "Unknown")
        name       = info.get("shortName", symbol)
        founded    = info.get("founded")           # not always available

        # Estimate company age from earliest available price if 'founded' missing
        if not founded:
            try:
                hist = tk.history(period="max")
                if not hist.empty:
                    founded = hist.index[0].year
            except Exception:
                founded = None

        # FCF growth rate (use analyst estimate, else 5% default)
        fcf_growth = safe_get(info, "revenueGrowth", default=0.05) or 0.05
        fcf_growth = min(fcf_growth, 0.25)

        # ── DCF margin of safety ──────────────────────────────────────────
        intrinsic = dcf_intrinsic_value(fcf, fcf_growth, shares)
        if intrinsic and intrinsic > 0 and current_price > 0:
            margin_of_safety = (intrinsic - current_price) / intrinsic
        else:
            margin_of_safety = None

        # Require at least some positive signal from DCF or FCF
        if margin_of_safety is None and fcf_yield_val is None:
            return None

        # ── Sub-scores (all 0-1) ──────────────────────────────────────────
        dcf_score = max(0.0, min(1.0, (margin_of_safety + 0.5) if margin_of_safety is not None else 0.5))
        fcf_score = max(0.0, min(1.0, (fcf_yield_val * 10) if fcf_yield_val else 0.5))
        pe_score  = score_pe(pe)
        pb_score  = score_pb(pb)
        dy_score  = max(0.0, min(1.0, div_yield * 15))  # 6.7% yield → 1.0
        dg_score  = dividend_growth_score(tk) if not quick else 0.0
        age_score = company_age_score(founded)

        # ── Composite weighted score ──────────────────────────────────────
        composite = (
            WEIGHTS["dcf_margin"] * dcf_score +
            WEIGHTS["fcf_yield"]  * fcf_score +
            WEIGHTS["pe_score"]   * pe_score  +
            WEIGHTS["pb_score"]   * pb_score  +
            WEIGHTS["div_yield"]  * dy_score  +
            WEIGHTS["div_growth"] * dg_score  +
            WEIGHTS["age_bonus"]  * age_score
        )

        return {
            "symbol":           symbol,
            "name":             name[:28],
            "sector":           sector[:18],
            "price":            round(current_price, 2),
            "intrinsic_dcf":    round(intrinsic, 2) if intrinsic else None,
            "margin_of_safety": round(margin_of_safety * 100, 2) if margin_of_safety is not None else None,
            "pe":               round(pe, 1) if pe else None,
            "pb":               round(pb, 2) if pb else None,
            "fcf_yield_pct":    round(fcf_yield_val * 100, 2) if fcf_yield_val else None,
            "div_yield_pct":    round(div_yield * 100, 2),
            "div_growth_pct":   round(dg_score * 100, 1),
            "company_age":      (datetime.datetime.now().year - founded) if founded else None,
            "score":            round(composite, 4),
        }

    except Exception as e:
        print(f"  [skip] {symbol}: {e}", file=sys.stderr)
        return None


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Undervalued US Stock Screener")
    parser.add_argument("--quick", action="store_true",
                        help="Skip dividend history fetch (faster daily run)")
    parser.add_argument("--top", type=int, default=10,
                        help="Number of top stocks to display (default: 10)")
    parser.add_argument("--universe", nargs="+",
                        help="Override ticker universe with custom list")
    parser.add_argument("--output", type=str, default=None,
                        help="Save full results to a JSON file (e.g. stocks/data/weekly.json)")
    parser.add_argument("--run-type", choices=["weekly", "daily"], default="weekly",
                        help="Label stored in JSON metadata (default: weekly)")
    args = parser.parse_args()

    universe = args.universe if args.universe else TICKER_UNIVERSE
    print(f"\n{'='*60}")
    print(f"  Undervalued US Stock Screener  |  {datetime.date.today()}")
    print(f"  Universe: {len(universe)} tickers | Top {args.top} results")
    print(f"{'='*60}\n")

    results = []
    for i, sym in enumerate(universe, 1):
        print(f"  [{i:>3}/{len(universe)}] Analysing {sym:<8}", end="\r", flush=True)
        row = analyse_ticker(sym, quick=args.quick)
        if row:
            results.append(row)

    print(" " * 60, end="\r")  # clear progress line

    if not results:
        print("No results returned. Check network / API limits.")
        return

    df = pd.DataFrame(results).sort_values("score", ascending=False).reset_index(drop=True)
    df.index += 1  # rank from 1

    top = df.head(args.top)
    top_display = top.apply(lambda r: pd.Series({
        "Symbol":          r["symbol"],
        "Name":            r["name"],
        "Sector":          r["sector"],
        "Price":           r["price"],
        "Intrinsic (DCF)": r["intrinsic_dcf"] if r["intrinsic_dcf"] is not None else "N/A",
        "MoS %":           f"{r['margin_of_safety']:.1f}%" if r["margin_of_safety"] is not None else "N/A",
        "P/E":             r["pe"] if r["pe"] is not None else "N/A",
        "P/B":             r["pb"] if r["pb"] is not None else "N/A",
        "FCF Yield %":     f"{r['fcf_yield_pct']:.1f}%" if r["fcf_yield_pct"] is not None else "N/A",
        "Div Yield %":     f"{r['div_yield_pct']:.2f}%",
        "Div Growing":     f"{r['div_growth_pct']:.0f}%",
        "Co. Age (est)":   r["company_age"] if r["company_age"] is not None else "?",
        "Score":           r["score"],
    }), axis=1)

    print(f"\n{'─'*60}")
    print(f"  TOP {args.top} UNDERVALUED STOCKS")
    print(f"{'─'*60}\n")
    print(tabulate(top_display, headers="keys", tablefmt="rounded_outline", showindex=True))

    if args.output:
        import json, os
        out_path = args.output
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        payload = {
            "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
            "run_type": args.run_type,
            "universe_size": len(universe),
            "top_n": args.top,
            "weights": WEIGHTS,
            "model": {
                "wacc": WACC,
                "terminal_growth": TERMINAL_GROWTH,
                "fcf_growth_years": FCF_GROWTH_YEARS,
                "min_company_age_years": MIN_COMPANY_AGE_YEARS,
            },
            "results": df.where(df.notna(), other=None).to_dict(orient="records"),
        }

        class _NaNSafeEncoder(json.JSONEncoder):
            def iterencode(self, o, _one_shot=False):
                # Walk the structure and replace any float nan/inf with None
                return super().iterencode(self._clean(o), _one_shot)
            def _clean(self, o):
                if isinstance(o, float) and (o != o or o == float('inf') or o == float('-inf')):
                    return None
                if isinstance(o, dict):
                    return {k: self._clean(v) for k, v in o.items()}
                if isinstance(o, list):
                    return [self._clean(v) for v in o]
                return o

        with open(out_path, "w") as f:
            json.dump(payload, f, indent=2, cls=_NaNSafeEncoder)
        print(f"  Saved → {out_path}")

    print(f"""
{'─'*60}
Scoring weights:
  DCF Margin of Safety {WEIGHTS['dcf_margin']*100:.0f}%  |  FCF Yield {WEIGHTS['fcf_yield']*100:.0f}%
  P/E Score            {WEIGHTS['pe_score']*100:.0f}%  |  P/B Score {WEIGHTS['pb_score']*100:.0f}%
  Dividend Yield       {WEIGHTS['div_yield']*100:.0f}%  |  Div Growth {WEIGHTS['div_growth']*100:.0f}%
  Company Age Bonus    {WEIGHTS['age_bonus']*100:.0f}%

Recommended run schedule (add to crontab):
  Weekly deep scan  →  0 20 * * 0   python3 {__file__}
  Daily price scan  →  0 17 * * 1-5 python3 {__file__} --quick
{'─'*60}
""")


if __name__ == "__main__":
    main()
