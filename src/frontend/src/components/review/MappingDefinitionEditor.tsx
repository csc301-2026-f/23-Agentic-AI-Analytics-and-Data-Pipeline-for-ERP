'use client'

import {
  validateReportDefinition,
  type ReportDefinition,
  type TransformationKind,
} from '../../services/review'

type MappingDefinitionEditorProps = {
  definition: ReportDefinition
  editable: boolean
  onChange: (definition: ReportDefinition) => void
}

const operationLabels: Record<TransformationKind, string> = {
  calendar_month: 'Group into calendar month',
  sum: 'Sum signed values',
  sum_positive: 'Sum positive values',
  sum_negative_absolute: 'Sum absolute negative values',
}

export default function MappingDefinitionEditor({
  definition,
  editable,
  onChange,
}: MappingDefinitionEditorProps) {
  const availableColumns = definition.sources.flatMap((source) =>
    source.selectedColumns.map((column) => ({
      ...column,
      sourceName: `${source.schema}.${source.table}`,
    })),
  )
  const validationErrors = validateReportDefinition(definition)

  function updateSource(
    sourceId: string,
    changes: Partial<ReportDefinition['sources'][number]>,
  ) {
    onChange({
      ...definition,
      sources: definition.sources.map((source) =>
        source.id === sourceId ? { ...source, ...changes } : source,
      ),
    })
  }

  function setOutputSource(outputFieldId: string, columnId: string) {
    const currentLineage = definition.fieldLineage.find(
      (lineage) => lineage.outputFieldId === outputFieldId,
    )
    if (!currentLineage) return
    onChange({
      ...definition,
      fieldLineage: definition.fieldLineage.map((lineage) =>
        lineage.outputFieldId === outputFieldId
          ? { ...lineage, sourceColumnIds: [columnId] }
          : lineage,
      ),
      transformations: definition.transformations.map((transformation) =>
        currentLineage.transformationIds.includes(transformation.id)
          ? { ...transformation, sourceColumnIds: [columnId] }
          : transformation,
      ),
    })
  }

  return (
    <div className="mapping-definition-editor">
      <section className="mapping-editor-section" aria-labelledby="mapping-definition-title">
        <div className="mapping-section-heading">
          <div>
            <p className="review-eyebrow">Report definition editor</p>
            <h3 id="mapping-definition-title">Structured mapping metadata</h3>
          </div>
          <span className="mapping-editor-safety-note">
            Structured edits only · nothing is executed
          </span>
        </div>

        <label className="mapping-form-field">
          <span>Reusable definition name</span>
          <input
            disabled={!editable}
            maxLength={120}
            onChange={(event) =>
              onChange({ ...definition, title: event.target.value })
            }
            value={definition.title}
          />
        </label>

        <div className="mapping-editor-grid">
          <section className="mapping-editor-card" aria-labelledby="mapping-sources-title">
            <header>
              <div>
                <p className="review-eyebrow">Warehouse references</p>
                <h4 id="mapping-sources-title">Source tables and columns</h4>
              </div>
            </header>
            {definition.sources.map((source) => (
              <div className="mapping-source-editor" key={source.id}>
                <div className="mapping-source-name-fields">
                  <label className="mapping-form-field">
                    <span>Schema</span>
                    <input
                      disabled={!editable}
                      onChange={(event) =>
                        updateSource(source.id, { schema: event.target.value })
                      }
                      value={source.schema}
                    />
                  </label>
                  <label className="mapping-form-field">
                    <span>Table</span>
                    <input
                      disabled={!editable}
                      onChange={(event) =>
                        updateSource(source.id, { table: event.target.value })
                      }
                      value={source.table}
                    />
                  </label>
                </div>
                <div className="mapping-column-list">
                  {source.selectedColumns.map((column) => (
                    <div className="mapping-column-option" key={column.id}>
                      <span className="mapping-selected-mark" aria-label="Selected">✓</span>
                      <code>{column.name}</code>
                      <span>{column.dataType}</span>
                    </div>
                  ))}
                  <p className="mapping-inline-note">
                    Source fields listed here are included in this definition.
                  </p>
                </div>
              </div>
            ))}
          </section>

          <section className="mapping-editor-card" aria-labelledby="mapping-output-title">
            <header>
              <div>
                <p className="review-eyebrow">Field lineage</p>
                <h4 id="mapping-output-title">Source-to-output mapping</h4>
              </div>
            </header>
            <div className="mapping-output-editor-list">
              {definition.outputFields.map((field) => {
                const lineage = definition.fieldLineage.find(
                  (item) => item.outputFieldId === field.id,
                )
                const transformation = definition.transformations.find(
                  (item) => item.outputFieldId === field.id,
                )
                return (
                  <div className="mapping-output-editor-row" key={field.id}>
                    <label className="mapping-form-field">
                      <span>Output field name</span>
                      <input
                        disabled={!editable}
                        onChange={(event) =>
                          onChange({
                            ...definition,
                            outputFields: definition.outputFields.map((item) =>
                              item.id === field.id
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          })
                        }
                        value={field.name}
                      />
                    </label>
                    <label className="mapping-form-field">
                      <span>Display label</span>
                      <input
                        disabled={!editable}
                        onChange={(event) =>
                          onChange({
                            ...definition,
                            outputFields: definition.outputFields.map((item) =>
                              item.id === field.id
                                ? { ...item, label: event.target.value }
                                : item,
                            ),
                          })
                        }
                        value={field.label}
                      />
                    </label>
                    <label className="mapping-form-field">
                      <span>Mapped source column</span>
                      <select
                        disabled={!editable || availableColumns.length === 0}
                        onChange={(event) =>
                          setOutputSource(field.id, event.target.value)
                        }
                        value={lineage?.sourceColumnIds[0] ?? ''}
                      >
                        {availableColumns.map((column) => (
                          <option key={column.id} value={column.id}>
                            {column.sourceName}.{column.name} ({column.dataType})
                          </option>
                        ))}
                      </select>
                    </label>
                    {transformation && (
                      <label className="mapping-form-field">
                        <span>Structured transformation</span>
                        <select
                          disabled={!editable}
                          onChange={(event) => {
                            const kind = event.target.value as TransformationKind
                            onChange({
                              ...definition,
                              transformations: definition.transformations.map((item) =>
                                item.id === transformation.id
                                  ? {
                                      ...item,
                                      kind,
                                      name: operationLabels[kind],
                                      description: operationLabels[kind],
                                    }
                                  : item,
                              ),
                            })
                          }}
                          value={transformation.kind}
                        >
                          {Object.entries(operationLabels).map(([kind, label]) => (
                            <option key={kind} value={kind}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="mapping-editor-card" aria-labelledby="mapping-filters-title">
            <header>
              <div>
                <p className="review-eyebrow">Parameters and filters</p>
                <h4 id="mapping-filters-title">Structured filter rules</h4>
              </div>
            </header>
            <div className="mapping-filter-list">
              {definition.filters.map((filter) => (
                <div className="mapping-filter-row" key={filter.id}>
                  <label className="mapping-form-field">
                    <span>Source field</span>
                    <select
                      disabled={!editable}
                      onChange={(event) =>
                        onChange({
                          ...definition,
                          filters: definition.filters.map((item) =>
                            item.id === filter.id
                              ? { ...item, sourceColumnId: event.target.value }
                              : item,
                          ),
                        })
                      }
                      value={filter.sourceColumnId}
                    >
                      {availableColumns.map((column) => (
                        <option key={column.id} value={column.id}>
                          {column.sourceName}.{column.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mapping-form-field">
                    <span>Rule</span>
                    <select
                      disabled={!editable}
                      onChange={(event) =>
                        onChange({
                          ...definition,
                          filters: definition.filters.map((item) =>
                            item.id === filter.id
                              ? {
                                  ...item,
                                  operator: event.target.value as typeof item.operator,
                                }
                              : item,
                          ),
                        })
                      }
                      value={filter.operator}
                    >
                      <option value="gte">At or after</option>
                      <option value="lt">Before (exclusive)</option>
                      <option value="eq">Equals</option>
                    </select>
                  </label>
                  <label className="mapping-form-field">
                    <span>Parameter · {filter.parameter}</span>
                    <input
                      disabled={!editable}
                      onChange={(event) =>
                        onChange({
                          ...definition,
                          filters: definition.filters.map((item) =>
                            item.id === filter.id
                              ? { ...item, mockValue: event.target.value }
                              : item,
                          ),
                        })
                      }
                      value={filter.mockValue}
                    />
                  </label>
                </div>
              ))}
            </div>
          </section>

          <section className="mapping-editor-card" aria-labelledby="mapping-layout-title">
            <header>
              <div>
                <p className="review-eyebrow">Presentation metadata</p>
                <h4 id="mapping-layout-title">Proposed report layout</h4>
              </div>
            </header>
            {definition.views.map((view) => (
              <div className="mapping-view-editor-row" key={view.id}>
                <label className="mapping-form-field">
                  <span>Component title</span>
                  <input
                    disabled={!editable}
                    onChange={(event) =>
                      onChange({
                        ...definition,
                        views: definition.views.map((item) =>
                          item.id === view.id
                            ? { ...item, title: event.target.value }
                            : item,
                        ),
                      })
                    }
                    value={view.title}
                  />
                </label>
                <label className="mapping-form-field">
                  <span>Visualization type</span>
                  <select
                    disabled={!editable}
                    onChange={(event) =>
                      onChange({
                        ...definition,
                        views: definition.views.map((item) => {
                          if (item.id !== view.id) return item
                          const type = event.target
                            .value as ReportDefinition['views'][number]['type']
                          if (type === 'table') {
                            return {
                              ...item,
                              type,
                              xFieldId: null,
                              yFieldIds: [],
                              columnFieldIds:
                                item.columnFieldIds.length > 0
                                  ? item.columnFieldIds
                                  : definition.outputFields.map((field) => field.id),
                            }
                          }
                          const xFieldId =
                            item.xFieldId ?? definition.outputFields[0]?.id ?? null
                          return {
                            ...item,
                            type,
                            xFieldId,
                            yFieldIds:
                              item.yFieldIds.length > 0
                                ? item.yFieldIds
                                : definition.outputFields
                                    .filter((field) => field.id !== xFieldId)
                                    .slice(0, 1)
                                    .map((field) => field.id),
                            columnFieldIds: [],
                          }
                        }),
                      })
                    }
                    value={view.type}
                  >
                    <option value="bar">Bar chart</option>
                    <option value="line">Line chart</option>
                    <option value="table">Table</option>
                  </select>
                </label>
                {view.type === 'table' ? (
                  <label className="mapping-form-field mapping-view-binding-editor">
                    <span>Table columns · Ctrl/Cmd-click to select multiple</span>
                    <select
                      disabled={!editable}
                      multiple
                      onChange={(event) =>
                        onChange({
                          ...definition,
                          views: definition.views.map((item) =>
                            item.id === view.id
                              ? {
                                  ...item,
                                  columnFieldIds: Array.from(
                                    event.target.selectedOptions,
                                    (option) => option.value,
                                  ),
                                }
                              : item,
                          ),
                        })
                      }
                      value={view.columnFieldIds}
                    >
                      {definition.outputFields.map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="mapping-form-field">
                      <span>X-axis field</span>
                      <select
                        disabled={!editable}
                        onChange={(event) =>
                          onChange({
                            ...definition,
                            views: definition.views.map((item) =>
                              item.id === view.id
                                ? { ...item, xFieldId: event.target.value }
                                : item,
                            ),
                          })
                        }
                        value={view.xFieldId ?? ''}
                      >
                        {definition.outputFields.map((field) => (
                          <option key={field.id} value={field.id}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <fieldset className="mapping-view-series">
                      <legend>Chart series fields</legend>
                      {definition.outputFields.map((field) => (
                        <label key={field.id}>
                          <input
                            checked={view.yFieldIds.includes(field.id)}
                            disabled={!editable}
                            onChange={(event) =>
                              onChange({
                                ...definition,
                                views: definition.views.map((item) =>
                                  item.id === view.id
                                    ? {
                                        ...item,
                                        yFieldIds: event.target.checked
                                          ? [...item.yFieldIds, field.id]
                                          : item.yFieldIds.filter(
                                              (id) => id !== field.id,
                                            ),
                                      }
                                    : item,
                                ),
                              })
                            }
                            type="checkbox"
                          />
                          {field.label}
                        </label>
                      ))}
                    </fieldset>
                  </>
                )}
              </div>
            ))}
          </section>
        </div>
        {editable && validationErrors.length > 0 && (
          <div className="mapping-validation" role="status">
            {validationErrors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
