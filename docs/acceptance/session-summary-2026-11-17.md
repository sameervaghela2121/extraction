# Update — 2026-11-17

## Done

- Acceptance catalog rewritten to match **D-01 … D-59** plus **D-60** (paper-first) and
  **D-61** (portal dashboard). **263** cases (was 245).
- Status rollup: ✅ 141 · 🆕 fix 36 · 🆕 86. No open 🔶 values; open-question sections removed.
- Portal dashboard cases **TC-DASH-001…006** (supervisor/super-admin home; figures match Reports).
- New registration cases **TC-IN-021…024** (paper-first + barcode/roll clash).
- Partials: **TC-PRTV-012/013**, **TC-PSELL-009**; store loss **TC-LOSS-010**; FY alerts
  **TC-ALERT-010/011**; custom range **TC-RPT-022**; reopen alert **TC-ALERT-008** (section 02).
- Store-loss tolerance **10 kg** (D-21); godown-move and role cases match D-42…D-55.

## Authority

| Doc | Role |
|---|---|
| `decisions.md` | Canonical log D-01 … D-60 |
| `Royale-Touche-decisions-2026-11-05.md` | Business-facing tables (incl. §12 paper-first) |
| `2026-11-04-inventory-acceptance.md` | Acceptance criteria (AC-01 notes D-60 order) |
| `test-cases/` | Full catalog (IDs unchanged except new TC-IN-020…022) |

## Next

1. Business re-reviews the updated catalog.
2. Automate ✅ cases first (same IDs).
3. Failing tests for each 🆕 fix, then implement.
4. Build remaining 🆕 features (partials portal UI, store loss, minimum stock, alerts, …).
