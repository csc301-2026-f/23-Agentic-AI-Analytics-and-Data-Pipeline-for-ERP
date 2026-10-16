import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MappingLineageCanvas from '../components/review/MappingLineageCanvas'
import ReportDefinitionPreview from '../components/review/ReportDefinitionPreview'
import {
  createMockReportRequest,
  createSampleReportDefinition,
  decideMappingProposal,
  getApprovedDefinitions,
  loadMockReviewState,
  MOCK_REVIEW_STORAGE_KEY,
  resetMockReviewState,
  saveMappingRevision,
  submitMappingProposal,
  type MockReviewState,
  type ReportDefinition,
} from './review'

describe('mock report-definition workflow', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = new Map()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      dispatchEvent: vi.fn(),
    })
    vi.stubGlobal('fetch', vi.fn())
  })

  it('submits a pending mapping proposal with versioned sample metadata', () => {
    const proposal = submitMappingProposal(
      'Show monthly cash movement by source field.',
      'Use Q3 2026 in USD.',
    )

    expect(proposal).toMatchObject({
      revision: 1,
      status: 'pending',
      requestText: 'Show monthly cash movement by source field.',
      clarificationText: 'Use Q3 2026 in USD.',
      definition: {
        schemaVersion: 1,
        revision: 1,
        mockFixture: 'cash-flow',
      },
    })
    expect(proposal.proposalId).toBe(`${proposal.mappingId}:r1`)
    expect(loadMockReviewState().proposals).toEqual([proposal])
  })

  it('exposes submitted source tables, columns, transformations, and lineage to the engineer view', () => {
    const proposal = submitMappingProposal('Create a monthly cash movement view.')
    const definition = proposal.definition
    const markup = renderToStaticMarkup(
      createElement(MappingLineageCanvas, { definition }),
    )

    expect(definition.sources[0]).toMatchObject({
      schema: 'mock_finance',
      table: 'ledger_entries',
    })
    expect(
      definition.sources[0].selectedColumns.map((column) => column.name),
    ).toContain('signed_amount')
    expect(definition.transformations.map((item) => item.name)).toContain(
      'Sum positive amounts',
    )
    expect(markup).toContain('mock_finance.ledger_entries')
    expect(markup).toContain('signed_amount')
    expect(markup).toContain('Sum positive amounts')
    expect(markup).toContain('Proposed outputs')
  })

  it('stores actionable mapping feedback and permits a corrected source-field revision', () => {
    const proposal = submitMappingProposal('Map approved cash movement.')
    const mistakenDefinition = structuredClone(proposal.definition)
    const memoColumnId = `${proposal.mappingId}:column-entry-memo`
    const amountColumnId = `${proposal.mappingId}:column-signed-amount`
    const inflowsId = `${proposal.mappingId}:field-inflows`
    const inflowsTransformId = `${proposal.mappingId}:transform-inflows`
    mistakenDefinition.fieldLineage = mistakenDefinition.fieldLineage.map((lineage) =>
      lineage.outputFieldId === inflowsId
        ? { ...lineage, sourceColumnIds: [memoColumnId] }
        : lineage,
    )
    mistakenDefinition.transformations = mistakenDefinition.transformations.map(
      (transformation) =>
        transformation.id === inflowsTransformId
          ? { ...transformation, sourceColumnIds: [memoColumnId] }
          : transformation,
    )
    const stateWithMistake: MockReviewState = {
      proposals: [{ ...proposal, definition: mistakenDefinition }],
      reportRequests: [],
    }
    storage.set(MOCK_REVIEW_STORAGE_KEY, JSON.stringify(stateWithMistake))

    const rejected = decideMappingProposal(
      proposal.mappingId,
      1,
      'changes_requested',
      'Map inflows from signed_amount, not the descriptive memo field.',
    )
    const correctedDefinition = structuredClone(rejected.definition)
    correctedDefinition.fieldLineage = correctedDefinition.fieldLineage.map(
      (lineage) =>
        lineage.outputFieldId === inflowsId
          ? { ...lineage, sourceColumnIds: [amountColumnId] }
          : lineage,
    )
    correctedDefinition.transformations = correctedDefinition.transformations.map(
      (transformation) =>
        transformation.id === inflowsTransformId
          ? { ...transformation, sourceColumnIds: [amountColumnId] }
          : transformation,
    )

    const revised = saveMappingRevision(
      proposal.mappingId,
      rejected.revision,
      correctedDefinition,
    )
    const history = loadMockReviewState().proposals

    expect(revised).toMatchObject({ revision: 2, status: 'pending' })
    expect(
      revised.definition.fieldLineage.find(
        (lineage) => lineage.outputFieldId === inflowsId,
      )?.sourceColumnIds,
    ).toEqual([amountColumnId])
    expect(history.map((item) => [item.revision, item.status])).toEqual([
      [1, 'changes_requested'],
      [2, 'pending'],
    ])
    expect(history[1].reviewHistory).toEqual(history[0].reviewHistory)
    expect(
      history[1].reviewHistory.find((event) => event.action === 'changes_requested')
        ?.feedback,
    ).toContain(
      'signed_amount, not the descriptive memo field',
    )
  })

  it('does not publish an outdated revision and only exposes the latest approved definition', () => {
    const first = submitMappingProposal('Monthly movement by date.')
    const second = saveMappingRevision(first.mappingId, 1, {
      ...first.definition,
      title: 'Corrected monthly movement definition',
    })

    expect(() =>
      decideMappingProposal(first.mappingId, 1, 'approved'),
    ).toThrowError(/no longer current/)
    expect(getApprovedDefinitions(loadMockReviewState().proposals)).toEqual([])

    decideMappingProposal(second.mappingId, second.revision, 'approved')
    expect(getApprovedDefinitions(loadMockReviewState().proposals)).toMatchObject([
      { revision: 2, status: 'approved', definition: { revision: 2 } },
    ])

    const third = saveMappingRevision(second.mappingId, second.revision, {
      ...second.definition,
      title: 'New pending definition revision',
    })
    expect(third.revision).toBe(3)
    expect(getApprovedDefinitions(loadMockReviewState().proposals)).toEqual([])
    expect(
      loadMockReviewState().proposals.find(
        (proposal) => proposal.revision === second.revision,
      )?.status,
    ).toBe('superseded')
  })

  it('refuses mock report requests until the latest definition is approved', () => {
    const proposal = submitMappingProposal('Request a reusable cash-flow report.')

    expect(() =>
      createMockReportRequest(proposal.mappingId, {
        period: 'Q3 2026',
        currency: 'USD',
      }),
    ).toThrowError(/Only the latest approved definition/)
    expect(loadMockReviewState().reportRequests).toEqual([])
  })

  it('reuses approved definitions for multiple clearly simulated report requests', () => {
    const proposal = submitMappingProposal('Request a reusable cash-flow report.')
    decideMappingProposal(proposal.mappingId, proposal.revision, 'approved')

    const firstRun = createMockReportRequest(proposal.mappingId, {
      period: 'Q3 2026',
      currency: 'USD',
    })
    const secondRun = createMockReportRequest(proposal.mappingId, {
      period: 'September 2026',
      currency: 'USD',
    })

    expect(firstRun.id).not.toBe(secondRun.id)
    expect(firstRun.definitionRevision).toBe(1)
    expect(firstRun.rows[0][`${proposal.mappingId}:field-net-cash-flow`]).toBe(21300)
    expect(loadMockReviewState().reportRequests).toHaveLength(2)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('renders arbitrary source schemas, table names, and columns without fixture assumptions in the canvas', () => {
    const mappingId = 'mapping-arbitrary-schema'
    const definition: ReportDefinition = createSampleReportDefinition(mappingId)
    definition.sources[0] = {
      ...definition.sources[0],
      schema: 'tenant_42.operations',
      table: 'posted_movements',
      selectedColumns: definition.sources[0].selectedColumns.map((column) =>
        column.id.endsWith('column-posted-at')
          ? { ...column, name: 'authorized_timestamp' }
          : column,
      ),
    }
    const markup = renderToStaticMarkup(
      createElement(MappingLineageCanvas, { definition }),
    )

    expect(markup).toContain('tenant_42.operations.posted_movements')
    expect(markup).toContain('authorized_timestamp')
    expect(markup).not.toContain('transactions')
  })

  it('highlights the selected report component path through the lineage canvas', () => {
    const definition = createSampleReportDefinition('mapping-focused-lineage')
    const selectedView = definition.views[0]
    const markup = renderToStaticMarkup(
      createElement(MappingLineageCanvas, {
        definition,
        focusedViewId: selectedView.id,
      }),
    )

    expect(markup).toContain('mapping-lineage-view is-focused')
    expect(markup).toContain('mapping-lineage-wires')
    expect(markup).toContain('is-selected')
  })

  it('previews metadata-driven chart and detail layouts with selectable lineage controls', () => {
    const definition = createSampleReportDefinition('mapping-preview')
    definition.title = 'Illustrative operations view'
    definition.sources[0].schema = 'tenant_ops'
    definition.sources[0].table = 'journal_items'
    definition.views[0].title = 'Movement trend'
    definition.views[1].title = 'Movement details'
    const markup = renderToStaticMarkup(
      createElement(ReportDefinitionPreview, {
        definition,
        selectedViewId: null,
        onSelectView: vi.fn(),
      }),
    )

    expect(markup).toContain('Illustrative operations view')
    expect(markup).toContain('Movement trend')
    expect(markup).toContain('Movement details')
    expect(markup).toContain('Inspect Movement trend and its source lineage')
    expect(markup).toContain('tenant_ops')
    expect(markup).toContain('do not represent queried or calculated business results')
  })

  it('resets the browser-local mock state for a clean presentation', () => {
    submitMappingProposal('One temporary mapping.')
    resetMockReviewState()

    expect(storage.has(MOCK_REVIEW_STORAGE_KEY)).toBe(false)
    expect(loadMockReviewState()).toEqual({ proposals: [], reportRequests: [] })
  })
})
