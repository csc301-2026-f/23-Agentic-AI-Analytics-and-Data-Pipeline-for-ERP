import type { Evidence } from "./types";

export function EvidenceInspector({ evidence }: { evidence: Evidence }) {
  const { sql, tables, columns, filters, supportingRows, executedAt, durationMs } = evidence;

  return (
    <section>
      <h3>Evidence</h3>
      <p>
        Executed {executedAt} ({durationMs} ms)
      </p>

      <h4>SQL</h4>
      <pre>{sql}</pre>

      <h4>Tables</h4>
      <ul>{tables.map((t) => <li key={t}>{t}</li>)}</ul>

      <h4>Columns</h4>
      <ul>{columns.map((c) => <li key={c}>{c}</li>)}</ul>

      <h4>Filters</h4>
      <ul>{filters.map((f) => <li key={f}>{f}</li>)}</ul>

      <h4>Supporting rows ({supportingRows.rowCount})</h4>
      {supportingRows.truncated && <p>Showing a limited sample of the rows.</p>}
      <table>
        <thead>
          <tr>{supportingRows.columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {supportingRows.rows.map((row, i) => (
            <tr key={i}>{row.map((cell, j) => <td key={j}>{cell ?? ""}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}