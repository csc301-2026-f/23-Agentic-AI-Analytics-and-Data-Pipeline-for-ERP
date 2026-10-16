'use client'

import { useState } from 'react'
import type { ReportDefinition } from '../../services/review'

type MappingLineageCanvasProps = {
  definition: ReportDefinition
  focusedViewId?: string | null
}

export default function MappingLineageCanvas({
  definition,
  focusedViewId = null,
}: MappingLineageCanvasProps) {
  const [selectedFieldId, setSelectedFieldId] = useState(
    definition.outputFields[0]?.id ?? '',
  )
  const sourcePositions = new Map<string, { x: number; y: number }>()
  const sourceTops = new Map<string, number>()
  let sourceTop = 58

  for (const source of definition.sources) {
    sourceTops.set(source.id, sourceTop)
    source.selectedColumns.forEach((column, columnIndex) => {
      sourcePositions.set(column.id, {
        x: 274,
        y: sourceTop + 53 + columnIndex * 34,
      })
    })
    sourceTop += 46 + source.selectedColumns.length * 34 + 18
  }

  const outputPositions = new Map(
    definition.outputFields.map((field, index) => [
      field.id,
      { x: 360, y: 132 + index * 76 },
    ]),
  )
  const viewPositions = new Map<string, Array<{ x: number; y: number }>>()
  let viewTop = 58
  for (const view of definition.views) {
    const fieldIds =
      view.type === 'table'
        ? view.columnFieldIds
        : [view.xFieldId, ...view.yFieldIds].filter(
            (fieldId): fieldId is string => fieldId !== null,
          )
    viewPositions.set(
      view.id,
      fieldIds.map((fieldId, index) => ({
        x: 688,
        y: viewTop + 90 + index * 34,
      })),
    )
    viewTop += 74 + fieldIds.length * 28
  }
  const canvasHeight = Math.max(
    300,
    sourceTop + 12,
    110 + definition.outputFields.length * 76,
    viewTop + 12,
  )
  const selectedOutput = definition.outputFields.find(
    (field) => field.id === selectedFieldId,
  )
  const selectedSource = definition.sources
    .flatMap((source) =>
      source.selectedColumns.map((column) => ({
        source,
        column,
      })),
    )
    .find(({ column }) => column.id === selectedFieldId)
  const selectedLineage = definition.fieldLineage.find(
    (lineage) => lineage.outputFieldId === selectedFieldId,
  )
  const focusedView = definition.views.find((view) => view.id === focusedViewId)
  const focusedFieldIds = new Set(
    focusedView
      ? focusedView.type === 'table'
        ? focusedView.columnFieldIds
        : [focusedView.xFieldId, ...focusedView.yFieldIds].filter(
            (fieldId): fieldId is string => fieldId !== null,
          )
      : [],
  )
  const selectedSources = (selectedLineage?.sourceColumnIds ?? [])
    .map((columnId) => {
      for (const source of definition.sources) {
        const column = source.selectedColumns.find(
          (item) => item.id === columnId,
        )
        if (column) return `${source.schema}.${source.table}.${column.name}`
      }
      return null
    })
    .filter((name): name is string => name !== null)
  const selectedTransformations = (selectedLineage?.transformationIds ?? [])
    .map((id) =>
      definition.transformations.find((transformation) => transformation.id === id),
    )
    .filter((transformation) => transformation !== undefined)
  const mappedOutputs = selectedSource
    ? definition.fieldLineage
        .filter((lineage) => lineage.sourceColumnIds.includes(selectedFieldId))
        .map((lineage) =>
          definition.outputFields.find((field) => field.id === lineage.outputFieldId),
        )
        .filter((field) => field !== undefined)
    : []

  return (
    <section className="mapping-lineage-section" aria-labelledby="mapping-lineage-title">
      <div className="mapping-section-heading">
        <div>
          <p className="review-eyebrow">Schema and field lineage</p>
          <h3 id="mapping-lineage-title">Proposed data flow</h3>
        </div>
        <span className="mapping-illustrative-label">Illustrative metadata · no warehouse discovery</span>
      </div>
      <div
        className="mapping-lineage-viewport"
        role="region"
        aria-label="Lineage diagram. Scroll horizontally on narrow screens."
        tabIndex={0}
      >
        <div className="mapping-lineage-canvas" style={{ height: canvasHeight }}>
          <div className="mapping-lineage-column-label" style={{ left: 24 }}>
            Source tables
          </div>
          <div className="mapping-lineage-column-label" style={{ left: 360 }}>
            Proposed outputs
          </div>
          <div className="mapping-lineage-column-label" style={{ left: 688 }}>
            Report layout
          </div>
          <svg
            aria-hidden="true"
            className="mapping-lineage-wires"
            height={canvasHeight}
            viewBox={`0 0 960 ${canvasHeight}`}
            width="960"
          >
            {definition.fieldLineage.flatMap((lineage) => {
              const output = outputPositions.get(lineage.outputFieldId)
              if (!output) return []
              const active =
                selectedFieldId === lineage.outputFieldId ||
                focusedFieldIds.has(lineage.outputFieldId)
              const sourceWires = lineage.sourceColumnIds.flatMap((columnId) => {
                const source = sourcePositions.get(columnId)
                if (!source) return []
                const sourceSelected = selectedFieldId === columnId
                const isActive = active || sourceSelected
                return [
                  <path
                    className={isActive ? 'is-selected' : ''}
                    d={`M ${source.x} ${source.y} H 318 V ${output.y} H ${output.x}`}
                    key={`${columnId}-${lineage.outputFieldId}`}
                  />,
                ]
              })
              const viewWires = definition.views.flatMap((view) => {
                const positions = viewPositions.get(view.id) ?? []
                const fieldIds =
                  view.type === 'table'
                    ? view.columnFieldIds
                    : [view.xFieldId, ...view.yFieldIds].filter(
                        (fieldId): fieldId is string => fieldId !== null,
                      )
                return fieldIds.flatMap((fieldId, index) =>
                  fieldId === lineage.outputFieldId && positions[index]
                    ? [
                        <path
                          className={
                            active && (focusedViewId === view.id || !focusedViewId)
                              ? 'is-selected'
                              : ''
                          }
                          d={`M ${output.x + 264} ${output.y} H 650 V ${positions[index].y} H ${positions[index].x}`}
                          key={`${lineage.outputFieldId}-${view.id}-${index}`}
                        />,
                      ]
                    : [],
                )
              })
              return [...sourceWires, ...viewWires]
            })}
          </svg>

          {definition.sources.map((source) => {
            const top = sourceTops.get(source.id) ?? 58
            return (
              <section
                aria-label={`${source.schema}.${source.table} source table`}
                className="mapping-lineage-node mapping-lineage-source"
                key={source.id}
                style={{ left: 24, top, width: 250 }}
              >
                <header>
                  <span className="mapping-node-icon" aria-hidden="true">▤</span>
                  <strong>{source.schema}.{source.table}</strong>
                  <small>source</small>
                </header>
                {source.selectedColumns.map((column) => (
                  <button
                    aria-pressed={selectedFieldId === column.id}
                    className={`mapping-lineage-field${selectedFieldId === column.id ? ' is-selected' : ''}`}
                    key={column.id}
                    onClick={() => setSelectedFieldId(column.id)}
                    type="button"
                  >
                    <code>{column.name}</code>
                    <span>{column.dataType}</span>
                  </button>
                ))}
              </section>
            )
          })}

          <section
            aria-label="Proposed output fields"
            className="mapping-lineage-node mapping-lineage-outputs"
            style={{ left: 360, top: 58, width: 264 }}
          >
            <header>
              <span className="mapping-node-icon" aria-hidden="true">ƒ</span>
              <strong>Definition transforms</strong>
              <small>structured</small>
            </header>
            {definition.outputFields.map((field) => {
              const lineage = definition.fieldLineage.find(
                (item) => item.outputFieldId === field.id,
              )
              const transformNames = (lineage?.transformationIds ?? [])
                .map(
                  (id) =>
                    definition.transformations.find((item) => item.id === id)?.name,
                )
                .filter((name): name is string => name !== undefined)
              return (
                <button
                  aria-pressed={selectedFieldId === field.id}
                  className={`mapping-lineage-output${selectedFieldId === field.id ? ' is-selected' : ''}`}
                  key={field.id}
                  onClick={() => setSelectedFieldId(field.id)}
                  type="button"
                >
                  <strong>{field.label}</strong>
                  <code>{field.name}</code>
                  <small>{transformNames.join(' · ') || 'No transformation linked'}</small>
                </button>
              )
            })}
          </section>

          {definition.views.map((view) => {
            const viewIndex = definition.views.findIndex((item) => item.id === view.id)
            const top = 58 + definition.views
              .slice(0, viewIndex)
              .reduce((height, previous) => {
                const count =
                  previous.type === 'table'
                    ? previous.columnFieldIds.length
                    : previous.yFieldIds.length + (previous.xFieldId ? 1 : 0)
                return height + 74 + count * 34
              }, 0)
            const bindings =
              view.type === 'table'
                ? view.columnFieldIds
                : [view.xFieldId, ...view.yFieldIds].filter(
                    (fieldId): fieldId is string => fieldId !== null,
                  )
            return (
              <section
                aria-label={`${view.title} ${view.type} layout`}
                className={`mapping-lineage-node mapping-lineage-view${focusedViewId === view.id ? ' is-focused' : ''}`}
                key={view.id}
                style={{ left: 688, top, width: 240 }}
              >
                <header>
                  <span className="mapping-node-icon" aria-hidden="true">
                    {view.type === 'table' ? '▦' : '▥'}
                  </span>
                  <strong>{view.title}</strong>
                  <small>{view.type}</small>
                </header>
                <div className="mapping-view-skeleton" aria-hidden="true">
                  {view.type === 'table' ? '▤  ━━━  ━━━' : '▁ ▃ ▆ ▄ ▇'}
                </div>
                {bindings.map((fieldId) => {
                  const field = definition.outputFields.find(
                    (item) => item.id === fieldId,
                  )
                  if (!field) return null
                  return (
                    <button
                      aria-pressed={selectedFieldId === field.id}
                      className={`mapping-lineage-binding${selectedFieldId === field.id ? ' is-selected' : ''}`}
                      key={field.id}
                      onClick={() => setSelectedFieldId(field.id)}
                      type="button"
                    >
                      <span>{view.type === 'table' ? 'Column' : field.id === view.xFieldId ? 'X-axis' : 'Series'}</span>
                      <code>{field.name}</code>
                    </button>
                  )
                })}
              </section>
            )
          })}
        </div>
      </div>
      <div className="mapping-lineage-detail" aria-live="polite">
        <strong>
          {selectedOutput?.label ?? selectedSource?.column.name ?? 'Field details'}
        </strong>
        <span>
          {selectedOutput
            ? `${selectedSources.join(', ') || 'No source mapped'} → ${selectedTransformations.map((item) => item.description).join('; ') || 'No transformation'}`
            : selectedSource
              ? `${selectedSource.source.schema}.${selectedSource.source.table}.${selectedSource.column.name} → ${mappedOutputs.map((field) => field.label).join(', ') || 'No output fields mapped'}`
              : 'Select an output field to inspect its source and transformation.'}
        </span>
      </div>
    </section>
  )
}
