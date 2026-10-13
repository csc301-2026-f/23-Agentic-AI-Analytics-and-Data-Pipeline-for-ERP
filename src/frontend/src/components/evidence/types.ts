export type Evidence = {
  evidenceId: string;
  sql: string;
  executedAt: string;
  durationMs: number;
  tables: string[];
  columns: string[];
  filters: string[];
  supportingRows: {
    columns: string[];
    rows: (string | number | null)[][];
    rowCount: number;
    truncated: boolean;
  };
};