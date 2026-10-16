import type { ReportDefinition, ReportView } from '../../services/review'

type ReportDefinitionPreviewProps = {
  definition: ReportDefinition
  selectedViewId: string | null
  onSelectView: (viewId: string) => void
}

const samplePeriods = ['Sample 1', 'Sample 2', 'Sample 3']
const barHeights = [54, 82, 66]
const seriesColors = ['#a8cfc0', '#c4dacf', '#bfd1dc']

function bindingLabel(definition: ReportDefinition, fieldId: string | null) {
  return definition.outputFields.find((field) => field.id === fieldId)?.label ?? 'Unbound field'
}

function ChartShape({
  view,
}: {
  view: ReportView
}) {
  const series = view.yFieldIds.slice(0, 3)
  const isLine = view.type === 'line'

  return (
    <span className="report-definition-chart" aria-hidden="true">
      <svg viewBox="0 0 480 128" preserveAspectRatio="none">
        {[18, 48, 78, 108].map((y) => (
          <line className="report-definition-gridline" key={y} x1="22" x2="468" y1={y} y2={y} />
        ))}
        {series.map((fieldId, seriesIndex) => {
          const color = seriesColors[seriesIndex % seriesColors.length]
          if (isLine) {
            const points = barHeights
              .map((height, index) => `${95 + index * 145},${112 - height + seriesIndex * 8}`)
              .join(' ')
            return (
              <g key={fieldId}>
                <polyline fill="none" points={points} stroke={color} strokeWidth="3" />
                {barHeights.map((height, index) => (
                  <circle
                    cx={95 + index * 145}
                    cy={112 - height + seriesIndex * 8}
                    fill={color}
                    key={`${fieldId}-${index}`}
                    r="4"
                  />
                ))}
              </g>
            )
          }
          return barHeights.map((height, index) => {
            const barWidth = Math.min(25, 62 / Math.max(1, series.length))
            const x =
              95 +
              index * 145 -
              (series.length * barWidth + (series.length - 1) * 3) / 2 +
              seriesIndex * (barWidth + 3)
            return (
              <rect
                fill={color}
                height={height}
                key={`${fieldId}-${index}`}
                rx="2"
                width={barWidth}
                x={x}
                y={112 - height}
              />
            )
          })
        })}
        {samplePeriods.map((period, index) => (
          <text className="report-definition-axis-label" key={period} x={95 + index * 145} y="125">
            {period}
          </text>
        ))}
      </svg>
    </span>
  )
}

function DetailShape({
  definition,
  view,
}: {
  definition: ReportDefinition
  view: ReportView
}) {
  const fields = view.columnFieldIds
    .map((fieldId) => definition.outputFields.find((field) => field.id === fieldId))
    .filter((field) => field !== undefined)

  return (
    <span className="report-definition-table" aria-hidden="true">
      <span className="report-definition-table-row is-header">
        {fields.map((field) => <span key={field.id}>{field.label}</span>)}
      </span>
      {samplePeriods.map((period) => (
        <span className="report-definition-table-row" key={period}>
          {fields.map((field) => (
            <span key={field.id}>{field.dataType === 'date' ? period : '—'}</span>
          ))}
        </span>
      ))}
    </span>
  )
}

export default function ReportDefinitionPreview({
  definition,
  selectedViewId,
  onSelectView,
}: ReportDefinitionPreviewProps) {
  return (
    <section className="report-definition-preview" aria-labelledby="report-definition-preview-title">
      <header className="report-definition-preview-heading">
        <div>
          <p className="review-eyebrow">Proposed report · mock layout</p>
          <h3 id="report-definition-preview-title">{definition.title}</h3>
          <p>Select a chart or detail to inspect its proposed source-to-output path.</p>
          <p className="report-definition-preview-sources">
            Source tables: {definition.sources.map((source) => `${source.schema}.${source.table}`).join(', ') || 'None'}
          </p>
        </div>
        <span className="report-preview-mock-badge">Illustrative · no query run</span>
      </header>
      <div className="report-definition-preview-grid">
        {definition.views.map((view) => {
          const selected = selectedViewId === view.id
          const outputLabels = (view.type === 'table'
            ? view.columnFieldIds
            : view.yFieldIds
          ).map((fieldId) => bindingLabel(definition, fieldId))
          return (
            <article className="report-definition-preview-card" key={view.id}>
              <button
                aria-pressed={selected}
                aria-label={`Inspect ${view.title} and its source lineage`}
                className={`report-definition-preview-select${selected ? ' is-selected' : ''}`}
                onClick={() => onSelectView(view.id)}
                type="button"
              >
                <span className="report-definition-preview-card-heading">
                  <strong>{view.title || (view.type === 'table' ? 'Report detail' : 'Report chart')}</strong>
                  <span>Inspect lineage →</span>
                </span>
                {view.type === 'table' ? (
                  <DetailShape definition={definition} view={view} />
                ) : (
                  <ChartShape view={view} />
                )}
                <span className="report-definition-preview-legend">
                  {outputLabels.map((label, index) => (
                    <span key={`${view.id}-${label}`}>
                      <i style={{ backgroundColor: seriesColors[index % seriesColors.length] }} />
                      {label}
                    </span>
                  ))}
                </span>
              </button>
            </article>
          )
        })}
      </div>
      <p className="report-definition-preview-note">
        Mock layout preview only. Bars and table placeholders do not represent queried or calculated business results.
      </p>
    </section>
  )
}
