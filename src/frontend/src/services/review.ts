export type MappingStatus =
  | 'pending'
  | 'changes_requested'
  | 'approved'
  | 'superseded'

export type SourceColumn = {
  id: string
  name: string
  dataType: string
}

export type SourceReference = {
  id: string
  schema: string
  table: string
  selectedColumns: SourceColumn[]
}

export type TransformationKind =
  | 'calendar_month'
  | 'sum'
  | 'sum_positive'
  | 'sum_negative_absolute'

export type Transformation = {
  id: string
  name: string
  kind: TransformationKind
  sourceColumnIds: string[]
  outputFieldId: string
  description: string
}

export type DefinitionFilter = {
  id: string
  sourceColumnId: string
  operator: 'gte' | 'lt' | 'eq'
  parameter: string
  mockValue: string
}

export type OutputField = {
  id: string
  name: string
  label: string
  dataType: string
  description: string
}

export type FieldLineage = {
  outputFieldId: string
  sourceColumnIds: string[]
  transformationIds: string[]
}

export type ReportView = {
  id: string
  title: string
  type: 'bar' | 'line' | 'table'
  xFieldId: string | null
  yFieldIds: string[]
  columnFieldIds: string[]
}

export type ReportDefinition = {
  schemaVersion: 1
  definitionId: string
  revision: number
  title: string
  sources: SourceReference[]
  filters: DefinitionFilter[]
  transformations: Transformation[]
  outputFields: OutputField[]
  fieldLineage: FieldLineage[]
  views: ReportView[]
  mockFixture: 'cash-flow'
}

export type ReviewHistoryEvent = {
  id: string
  revision: number
  action: 'submitted' | 'changes_requested' | 'revision_saved' | 'approved'
  actor: 'Business user' | 'Data engineer'
  summary: string
  feedback: string | null
  createdAt: string
}

export type MappingProposal = {
  proposalId: string
  mappingId: string
  revision: number
  status: MappingStatus
  requestText: string
  clarificationText?: string
  definition: ReportDefinition
  reviewHistory: ReviewHistoryEvent[]
  createdAt: string
  updatedAt: string
}

export type MockReportRequest = {
  id: string
  mappingId: string
  definitionRevision: number
  title: string
  requestedAt: string
  period: string
  currency: string
  rows: Record<string, string | number>[]
}

export type MockReviewState = {
  proposals: MappingProposal[]
  reportRequests: MockReportRequest[]
}

export class ReviewRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ReviewRequestError'
  }
}

export const MOCK_REVIEW_STORAGE_KEY = 'genledge.review.mockDrafts'
export const MOCK_REVIEW_CHANGE_EVENT = 'genledge:mock-review-change'

function newId(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

function now() {
  return new Date().toISOString()
}

function emptyState(): MockReviewState {
  return { proposals: [], reportRequests: [] }
}

function isMockReviewState(value: unknown): value is MockReviewState {
  return (
    typeof value === 'object' &&
    value !== null &&
    'proposals' in value &&
    Array.isArray(value.proposals) &&
    'reportRequests' in value &&
    Array.isArray(value.reportRequests)
  )
}

export function loadMockReviewState(): MockReviewState {
  const stored = window.localStorage.getItem(MOCK_REVIEW_STORAGE_KEY)
  if (!stored) return emptyState()

  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    throw new ReviewRequestError('Saved mock mapping data is invalid JSON.', 500)
  }

  if (Array.isArray(parsed)) {
    // Older mock entries represented report payloads, not reusable definitions.
    return emptyState()
  }
  if (!isMockReviewState(parsed)) {
    throw new ReviewRequestError('Saved mock mapping data has an invalid shape.', 500)
  }
  return parsed
}

function saveMockReviewState(state: MockReviewState) {
  window.localStorage.setItem(MOCK_REVIEW_STORAGE_KEY, JSON.stringify(state))
  window.dispatchEvent(new Event(MOCK_REVIEW_CHANGE_EVENT))
}

export function subscribeToMockReviewState(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === MOCK_REVIEW_STORAGE_KEY || event.key === null) onChange()
  }
  window.addEventListener('storage', onStorage)
  window.addEventListener(MOCK_REVIEW_CHANGE_EVENT, onChange)
  window.addEventListener('focus', onChange)
  return () => {
    window.removeEventListener('storage', onStorage)
    window.removeEventListener(MOCK_REVIEW_CHANGE_EVENT, onChange)
    window.removeEventListener('focus', onChange)
  }
}

export function resetMockReviewState() {
  window.localStorage.removeItem(MOCK_REVIEW_STORAGE_KEY)
  window.dispatchEvent(new Event(MOCK_REVIEW_CHANGE_EVENT))
}

export function getLatestMappingProposals(
  proposals: MappingProposal[],
): MappingProposal[] {
  const latestByMapping = new Map<string, MappingProposal>()
  for (const proposal of proposals) {
    const current = latestByMapping.get(proposal.mappingId)
    if (!current || proposal.revision > current.revision) {
      latestByMapping.set(proposal.mappingId, proposal)
    }
  }
  return [...latestByMapping.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )
}

export function getApprovedDefinitions(
  proposals: MappingProposal[],
): MappingProposal[] {
  return getLatestMappingProposals(proposals).filter(
    (proposal) => proposal.status === 'approved',
  )
}

export function createSampleReportDefinition(
  mappingId: string,
  title = 'Monthly cash-flow definition',
  revision = 1,
): ReportDefinition {
  const stableId = (suffix: string) => `${mappingId}:${suffix}`
  const sourceId = stableId('source-ledger')
  const columnIds = {
    date: stableId('column-posted-at'),
    amount: stableId('column-signed-amount'),
    currency: stableId('column-currency-code'),
    memo: stableId('column-entry-memo'),
  }
  const outputIds = {
    month: stableId('field-month'),
    inflows: stableId('field-inflows'),
    outflows: stableId('field-outflows'),
    net: stableId('field-net-cash-flow'),
  }
  const transforms: Transformation[] = [
    {
      id: stableId('transform-month'),
      name: 'Group by calendar month',
      kind: 'calendar_month',
      sourceColumnIds: [columnIds.date],
      outputFieldId: outputIds.month,
      description: 'Group source dates into calendar months.',
    },
    {
      id: stableId('transform-inflows'),
      name: 'Sum positive amounts',
      kind: 'sum_positive',
      sourceColumnIds: [columnIds.amount],
      outputFieldId: outputIds.inflows,
      description: 'Add positive signed amounts within each month.',
    },
    {
      id: stableId('transform-outflows'),
      name: 'Sum absolute negative amounts',
      kind: 'sum_negative_absolute',
      sourceColumnIds: [columnIds.amount],
      outputFieldId: outputIds.outflows,
      description: 'Add the absolute value of negative signed amounts.',
    },
    {
      id: stableId('transform-net'),
      name: 'Sum signed amounts',
      kind: 'sum',
      sourceColumnIds: [columnIds.amount],
      outputFieldId: outputIds.net,
      description: 'Sum signed amounts without changing their sign.',
    },
  ]

  return {
    schemaVersion: 1,
    definitionId: mappingId,
    revision,
    title,
    sources: [
      {
        id: sourceId,
        schema: 'mock_finance',
        table: 'ledger_entries',
        selectedColumns: [
          { id: columnIds.date, name: 'posted_at', dataType: 'timestamp' },
          { id: columnIds.amount, name: 'signed_amount', dataType: 'numeric' },
          { id: columnIds.currency, name: 'currency_code', dataType: 'text' },
          { id: columnIds.memo, name: 'entry_memo', dataType: 'text' },
        ],
      },
    ],
    filters: [
      {
        id: stableId('filter-start'),
        sourceColumnId: columnIds.date,
        operator: 'gte',
        parameter: 'start_date',
        mockValue: '2026-07-01',
      },
      {
        id: stableId('filter-end'),
        sourceColumnId: columnIds.date,
        operator: 'lt',
        parameter: 'end_date',
        mockValue: '2026-10-01',
      },
      {
        id: stableId('filter-currency'),
        sourceColumnId: columnIds.currency,
        operator: 'eq',
        parameter: 'currency',
        mockValue: 'USD',
      },
    ],
    transformations: transforms,
    outputFields: [
      {
        id: outputIds.month,
        name: 'month',
        label: 'Month',
        dataType: 'date',
        description: 'Calendar month derived from the posting timestamp.',
      },
      {
        id: outputIds.inflows,
        name: 'inflows',
        label: 'Cash inflows',
        dataType: 'currency',
        description: 'Total positive entries in the month.',
      },
      {
        id: outputIds.outflows,
        name: 'outflows',
        label: 'Cash outflows',
        dataType: 'currency',
        description: 'Absolute total of negative entries in the month.',
      },
      {
        id: outputIds.net,
        name: 'net_cash_flow',
        label: 'Net cash flow',
        dataType: 'currency',
        description: 'Signed total of entries in the month.',
      },
    ],
    fieldLineage: transforms.map((transform) => ({
      outputFieldId: transform.outputFieldId,
      sourceColumnIds: [...transform.sourceColumnIds],
      transformationIds: [transform.id],
    })),
    views: [
      {
        id: stableId('view-monthly-trend'),
        title: 'Monthly cash movement',
        type: 'bar',
        xFieldId: outputIds.month,
        yFieldIds: [outputIds.inflows, outputIds.outflows, outputIds.net],
        columnFieldIds: [],
      },
      {
        id: stableId('view-monthly-detail'),
        title: 'Monthly detail',
        type: 'table',
        xFieldId: null,
        yFieldIds: [],
        columnFieldIds: Object.values(outputIds),
      },
    ],
    mockFixture: 'cash-flow',
  }
}

export function submitMappingProposal(
  requestText: string,
  clarificationText = '',
): MappingProposal {
  const normalizedRequest = requestText.trim()
  if (!normalizedRequest) {
    throw new ReviewRequestError('Describe the report definition you need.', 422)
  }

  const state = loadMockReviewState()
  const mappingId = newId('mapping')
  const timestamp = now()
  const historyEvent: ReviewHistoryEvent = {
    id: newId('history'),
    revision: 1,
    action: 'submitted',
    actor: 'Business user',
    summary: 'Submitted a request for a reusable report definition.',
    feedback: null,
    createdAt: timestamp,
  }
  const proposal: MappingProposal = {
    proposalId: `${mappingId}:r1`,
    mappingId,
    revision: 1,
    status: 'pending',
    requestText: normalizedRequest,
    clarificationText: clarificationText.trim() || undefined,
    definition: createSampleReportDefinition(mappingId),
    reviewHistory: [historyEvent],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  saveMockReviewState({ ...state, proposals: [...state.proposals, proposal] })
  return proposal
}

export function validateReportDefinition(definition: ReportDefinition): string[] {
  const errors: string[] = []
  const selectedColumnIds = new Set(
    definition.sources.flatMap((source) =>
      source.selectedColumns.map((column) => column.id),
    ),
  )
  const outputFieldIds = new Set(definition.outputFields.map((field) => field.id))
  const transformationIds = new Set(
    definition.transformations.map((transformation) => transformation.id),
  )

  if (!definition.title.trim()) errors.push('Enter a definition name.')
  if (
    definition.sources.length === 0 ||
    definition.sources.some(
      (source) =>
        !source.schema.trim() ||
        !source.table.trim() ||
        source.selectedColumns.length === 0,
    )
  ) {
    errors.push('Each source needs a schema, table, and selected columns.')
  }
  if (definition.outputFields.length === 0) {
    errors.push('Add at least one proposed output field.')
  }
  if (
    definition.fieldLineage.some(
      (lineage) =>
        !outputFieldIds.has(lineage.outputFieldId) ||
        lineage.sourceColumnIds.length === 0 ||
        lineage.sourceColumnIds.some((columnId) => !selectedColumnIds.has(columnId)) ||
        lineage.transformationIds.some((id) => !transformationIds.has(id)),
    )
  ) {
    errors.push('Every output needs valid selected-source and transformation lineage.')
  }
  if (
    definition.filters.some(
      (filter) => !selectedColumnIds.has(filter.sourceColumnId),
    )
  ) {
    errors.push('Every filter must use a selected source column.')
  }
  if (
    definition.views.some((view) => {
      const fields = [
        ...view.yFieldIds,
        ...view.columnFieldIds,
        ...(view.xFieldId ? [view.xFieldId] : []),
      ]
      return (
        fields.length === 0 ||
        fields.some((fieldId) => !outputFieldIds.has(fieldId)) ||
        (view.type === 'table' && view.columnFieldIds.length === 0) ||
        (view.type !== 'table' &&
          (view.xFieldId === null || view.yFieldIds.length === 0))
      )
    })
  ) {
    errors.push('Layout bindings must reference proposed output fields.')
  }
  return errors
}

function updateHistory(
  proposals: MappingProposal[],
  mappingId: string,
  event: ReviewHistoryEvent,
) {
  return proposals.map((proposal) =>
    proposal.mappingId === mappingId
      ? { ...proposal, reviewHistory: [...proposal.reviewHistory, event] }
      : proposal,
  )
}

function latestProposal(proposals: MappingProposal[], mappingId: string) {
  return getLatestMappingProposals(proposals).find(
    (proposal) => proposal.mappingId === mappingId,
  )
}

export function saveMappingRevision(
  mappingId: string,
  expectedRevision: number,
  editedDefinition: ReportDefinition,
): MappingProposal {
  const state = loadMockReviewState()
  const latest = latestProposal(state.proposals, mappingId)
  if (
    !latest ||
    latest.revision !== expectedRevision ||
    !['pending', 'changes_requested', 'approved'].includes(latest.status)
  ) {
    throw new ReviewRequestError('This mapping revision is no longer current.', 409)
  }

  const errors = validateReportDefinition(editedDefinition)
  if (errors.length) throw new ReviewRequestError(errors[0], 422)
  if (editedDefinition.definitionId !== mappingId) {
    throw new ReviewRequestError('The reusable definition ID cannot be changed.', 422)
  }

  const revision = latest.revision + 1
  const timestamp = now()
  const event: ReviewHistoryEvent = {
    id: newId('history'),
    revision,
    action: 'revision_saved',
    actor: 'Data engineer',
    summary: 'Saved a corrected report definition as a new revision.',
    feedback: null,
    createdAt: timestamp,
  }
  const proposals = updateHistory(state.proposals, mappingId, event)
  const previous = proposals.find(
    (proposal) => proposal.mappingId === mappingId && proposal.revision === latest.revision,
  )
  if (previous?.status === 'pending' || previous?.status === 'approved') {
    previous.status = 'superseded'
  }

  const proposal: MappingProposal = {
    ...latest,
    proposalId: `${mappingId}:r${revision}`,
    revision,
    status: 'pending',
    definition: { ...editedDefinition, revision },
    reviewHistory: [...latest.reviewHistory, event],
    updatedAt: timestamp,
  }
  proposals.push(proposal)
  saveMockReviewState({ ...state, proposals })
  return proposal
}

export function decideMappingProposal(
  mappingId: string,
  expectedRevision: number,
  decision: 'approved' | 'changes_requested',
  feedback = '',
): MappingProposal {
  const state = loadMockReviewState()
  const latest = latestProposal(state.proposals, mappingId)
  const normalizedFeedback = feedback.trim()
  if (
    !latest ||
    latest.revision !== expectedRevision ||
    latest.status !== 'pending'
  ) {
    throw new ReviewRequestError('This mapping revision is no longer current.', 409)
  }
  if (decision === 'changes_requested' && !normalizedFeedback) {
    throw new ReviewRequestError(
      'Add actionable mapping feedback before requesting changes.',
      422,
    )
  }

  const timestamp = now()
  const event: ReviewHistoryEvent = {
    id: newId('history'),
    revision: latest.revision,
    action: decision,
    actor: 'Data engineer',
    summary:
      decision === 'approved'
        ? 'Approved the reusable report definition.'
        : 'Requested changes to the report definition.',
    feedback: decision === 'changes_requested' ? normalizedFeedback : null,
    createdAt: timestamp,
  }
  const proposals = updateHistory(state.proposals, mappingId, event)
  const current = proposals.find(
    (proposal) =>
      proposal.mappingId === mappingId && proposal.revision === expectedRevision,
  )
  if (!current) {
    throw new ReviewRequestError('The mapping proposal could not be found.', 404)
  }
  current.status = decision
  current.updatedAt = timestamp
  saveMockReviewState({ ...state, proposals })
  return current
}

function simulatedCashFlowRows(definition: ReportDefinition) {
  const fixtureRows: Record<string, string | number>[] = [
    {
      month: 'Jul 2026',
      inflows: 62000,
      outflows: 40700,
      net: 21300,
    },
    {
      month: 'Aug 2026',
      inflows: 58000,
      outflows: 45100,
      net: 12900,
    },
    {
      month: 'Sep 2026',
      inflows: 64250,
      outflows: 47070,
      net: 17180,
    },
  ]
  return fixtureRows.map((fixtureRow) =>
    Object.fromEntries(
      definition.outputFields.map((field) => [
        field.id,
        fixtureRow[
          field.id.endsWith(':field-month')
            ? 'month'
            : field.id.endsWith(':field-inflows')
              ? 'inflows'
              : field.id.endsWith(':field-outflows')
                ? 'outflows'
                : field.id.endsWith(':field-net-cash-flow')
                  ? 'net'
                  : field.id
        ] ?? '—',
      ]),
    ),
  )
}

export function createMockReportRequest(
  mappingId: string,
  { period, currency }: { period: string; currency: string },
): MockReportRequest {
  const state = loadMockReviewState()
  const approved = latestProposal(state.proposals, mappingId)
  if (!approved || approved.status !== 'approved') {
    throw new ReviewRequestError(
      'Only the latest approved definition can be used for a report request.',
      403,
    )
  }
  if (approved.definition.mockFixture !== 'cash-flow') {
    throw new ReviewRequestError('No mock data fixture exists for this definition.', 422)
  }

  const request: MockReportRequest = {
    id: newId('mock-run'),
    mappingId,
    definitionRevision: approved.revision,
    title: approved.definition.title,
    requestedAt: now(),
    period: period.trim() || 'Q3 2026',
    currency: currency.trim() || 'USD',
    rows: simulatedCashFlowRows(approved.definition),
  }
  saveMockReviewState({
    ...state,
    reportRequests: [...state.reportRequests, request],
  })
  return request
}
