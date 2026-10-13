import type { Evidence } from "./types";

export const evidenceFixture: Evidence = {
  evidenceId: "evidence_789",
  sql: "SELECT date_trunc('month', txn_date) AS month, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS inflows, SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS outflows FROM transactions WHERE txn_date >= '2026-01-01' AND txn_date < '2026-04-01' GROUP BY 1 ORDER BY 1",
  executedAt: "2026-10-13T19:00:00Z",
  durationMs: 42,
  tables: ["transactions"],
  columns: ["transactions.txn_date", "transactions.amount"],
  filters: ["txn_date >= '2026-01-01'", "txn_date < '2026-04-01'"],
  supportingRows: {
    columns: ["txn_id", "txn_date", "description", "amount"],
    rows: [
      ["t_001", "2026-01-03", "Customer payment", "12000.00"],
      ["t_002", "2026-01-09", "Office rent", "-4500.00"],
      ["t_003", "2026-01-15", "Customer payment", "18000.00"],
      ["t_004", "2026-01-28", "Payroll", "-15500.00"],
    ],
    rowCount: 4,
    truncated: true,
  },
};