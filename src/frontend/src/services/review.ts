export type ReviewStatus = 'pending' | 'approved' | 'rejected'
export type ReviewDecision = Exclude<ReviewStatus, 'pending'>
export type ReviewMode = 'mock' | 'real'

export type ReviewDraft = {
  draftId: string
  conversationId: string
  revision: number
  status: ReviewStatus
  reportPayload: Record<string, unknown>
  evidenceId: string
  rejectionFeedback: string | null
  createdAt: string
  updatedAt: string
  reviewedAt: string | null
}

export type BusinessReportStatus = {
  draftId: string
  revision: number
  status: ReviewStatus
  updatedAt: string
  reviewedAt: string | null
}

type DecideDraftInput = {
  draft: ReviewDraft
  decision: ReviewDecision
  expectedRevision: number
  feedback?: string
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

const STORAGE_KEY = 'genledge.review.mockDrafts'

const mockDrafts: ReviewDraft[] = [
  {
    draftId: '8fbfdc5a-40bd-4b42-9ddd-2b290c55d401',
    conversationId: 'cash-flow-q3-review',
    revision: 3,
    status: 'pending',
    reportPayload: {
      title: 'Q3 cash flow summary',
      period: { start: '2026-07-01', end: '2026-09-30' },
      executiveSummary:
        'Operating cash flow improved through the quarter, with stronger collections offsetting higher payroll costs.',
      metrics: [
        { label: 'Total inflows', amount: '184250.00', currency: 'USD' },
        { label: 'Total outflows', amount: '132870.00', currency: 'USD' },
        { label: 'Net cash flow', amount: '51380.00', currency: 'USD' },
      ],
      observations: [
        'September had the highest customer receipts.',
        'Payroll was the largest recurring outflow.',
      ],
      generatedAt: '2026-10-14T15:42:00Z',
    },
    evidenceId: 'evidence-q3-cash-flow',
    rejectionFeedback: null,
    createdAt: '2026-10-14T15:42:00Z',
    updatedAt: '2026-10-15T08:10:00Z',
    reviewedAt: null,
  },
  {
    draftId: '5f10c53c-5c83-47cb-aeef-457ecfe0d202',
    conversationId: 'revenue-by-region',
    revision: 2,
    status: 'rejected',
    reportPayload: {
      title: 'Revenue by region',
      period: { start: '2026-04-01', end: '2026-06-30' },
      executiveSummary:
        'North America remained the largest region by reported revenue.',
      regions: [
        { name: 'North America', revenue: '295400.00' },
        { name: 'Europe', revenue: '142800.00' },
      ],
    },
    evidenceId: 'evidence-revenue-regions',
    rejectionFeedback: 'Please include the reporting currency and clarify the period comparison.',
    createdAt: '2026-10-13T16:15:00Z',
    updatedAt: '2026-10-14T11:20:00Z',
    reviewedAt: '2026-10-14T11:20:00Z',
  },
  {
    draftId: '423aac45-47df-4c54-b65e-c70a34e70903',
    conversationId: 'monthly-expense-overview',
    revision: 1,
    status: 'approved',
    reportPayload: {
      title: 'Monthly expense overview',
      period: { start: '2026-08-01', end: '2026-08-31' },
      executiveSummary: 'Operating expenses totaled 48,920.00 USD for August.',
      categories: [
        { name: 'Payroll', amount: '30400.00' },
        { name: 'Facilities', amount: '12100.00' },
        { name: 'Other', amount: '6420.00' },
      ],
    },
    evidenceId: 'evidence-expense-overview',
    rejectionFeedback: null,
    createdAt: '2026-10-11T09:00:00Z',
    updatedAt: '2026-10-12T13:05:00Z',
    reviewedAt: '2026-10-12T13:05:00Z',
  },
]

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch (error) {
    throw new ReviewRequestError(
      error instanceof Error ? error.message : 'Could not reach the review service.',
      0,
    )
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'detail' in body &&
      typeof body.detail === 'string'
        ? body.detail
        : `The review request failed (${response.status}).`
    throw new ReviewRequestError(message, response.status)
  }

  if (body === null) {
    throw new ReviewRequestError('The review service returned an invalid response.', 502)
  }
  return body as T
}

function readMockDrafts(): ReviewDraft[] {
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (!saved) return mockDrafts.map((draft) => ({ ...draft }))

  const drafts: unknown = JSON.parse(saved)
  if (!Array.isArray(drafts)) {
    throw new ReviewRequestError('Saved mock review data is invalid.', 500)
  }
  return drafts as ReviewDraft[]
}

function saveMockDrafts(drafts: ReviewDraft[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
}

export function filterDraftsByStatus(
  drafts: ReviewDraft[],
  statuses: ReviewStatus[],
): ReviewDraft[] {
  return drafts.filter((draft) => statuses.includes(draft.status))
}

export async function getReviewMode(): Promise<ReviewMode> {
  const response = await requestJson<{ mode: ReviewMode }>('/api/review/mode')
  if (response.mode !== 'real' && response.mode !== 'mock') {
    throw new ReviewRequestError('The review service returned an invalid mode.', 502)
  }
  return response.mode
}

export async function loadReviewDrafts(
  mode: ReviewMode,
  history = false,
): Promise<ReviewDraft[]> {
  if (mode === 'mock') {
    const drafts = readMockDrafts()
    return history
      ? drafts
      : drafts.filter(
          (draft) =>
            !drafts.some(
              (other) =>
                other.draftId === draft.draftId &&
                other.revision > draft.revision,
            ),
        )
  }

  const path = history
    ? '/api/review/drafts/history'
    : '/api/review/drafts'
  const response = await requestJson<{ drafts: ReviewDraft[] }>(path)
  return response.drafts
}

export async function decideReviewDraft(
  mode: ReviewMode,
  { draft, decision, expectedRevision, feedback }: DecideDraftInput,
): Promise<ReviewDraft> {
  const normalizedFeedback = feedback?.trim() ?? ''
  if (decision === 'rejected' && !normalizedFeedback) {
    throw new ReviewRequestError('Reviewer feedback is required to reject a draft.', 422)
  }

  if (mode === 'real') {
    return requestJson<ReviewDraft>(
      `/api/review/drafts/${encodeURIComponent(draft.draftId)}/${decision === 'approved' ? 'approve' : 'reject'}`,
      {
        method: 'POST',
        body: JSON.stringify({
          expectedRevision,
          ...(decision === 'rejected' ? { feedback: normalizedFeedback } : {}),
        }),
      },
    )
  }

  await new Promise((resolve) => window.setTimeout(resolve, 200))
  const drafts = readMockDrafts()
  const index = drafts.findIndex(
    (item) => item.draftId === draft.draftId && item.revision === draft.revision,
  )
  if (
    index === -1 ||
    expectedRevision !== draft.revision ||
    draft.status !== 'pending' ||
    drafts.some(
      (item) => item.draftId === draft.draftId && item.revision > expectedRevision,
    )
  ) {
    throw new ReviewRequestError(
      'The draft revision is no longer pending or current.',
      409,
    )
  }

  const now = new Date().toISOString()
  const updatedDraft = {
    ...draft,
    status: decision,
    rejectionFeedback: decision === 'rejected' ? normalizedFeedback : null,
    updatedAt: now,
    reviewedAt: now,
  }
  drafts[index] = updatedDraft
  saveMockDrafts(drafts)
  return updatedDraft
}

export async function createBusinessDemoDraft(
  mode: ReviewMode,
): Promise<BusinessReportStatus> {
  if (mode === 'real') {
    return requestJson<BusinessReportStatus>('/api/demo/reports', {
      method: 'POST',
    })
  }

  const now = new Date().toISOString()
  const draft: ReviewDraft = {
    draftId: crypto.randomUUID(),
    conversationId: `mock-demo-${Date.now()}`,
    revision: 1,
    status: 'pending',
    reportPayload: {
      title: 'Demo cash flow report',
      period: { start: '2026-07-01', end: '2026-09-30' },
      executiveSummary:
        'Sample report for the D2 approval workflow. This is not generated by the Agent Harness.',
      metrics: [
        { label: 'Cash inflows', amount: '184250.00', currency: 'USD' },
        { label: 'Cash outflows', amount: '132870.00', currency: 'USD' },
        { label: 'Net cash flow', amount: '51380.00', currency: 'USD' },
      ],
    },
    evidenceId: 'mock-demo-evidence',
    rejectionFeedback: null,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
  }
  const drafts = readMockDrafts()
  drafts.push(draft)
  saveMockDrafts(drafts)
  return toBusinessStatus(draft)
}

export async function createBusinessDemoRevision(
  mode: ReviewMode,
  draftId: string,
): Promise<BusinessReportStatus> {
  if (mode === 'real') {
    return requestJson<BusinessReportStatus>(
      `/api/demo/reports/${encodeURIComponent(draftId)}/revisions`,
      { method: 'POST' },
    )
  }

  const drafts = readMockDrafts()
  const current = latestDraft(drafts, draftId)
  if (!current) throw new ReviewRequestError('Draft not found.', 404)
  const now = new Date().toISOString()
  const revision: ReviewDraft = {
    ...current,
    revision: current.revision + 1,
    status: 'pending',
    reportPayload: {
      ...current.reportPayload,
      title: 'Revised demo cash flow report',
      executiveSummary:
        'Revised sample report for the D2 approval workflow. This is not generated by the Agent Harness.',
    },
    rejectionFeedback: null,
    updatedAt: now,
    reviewedAt: null,
  }
  drafts.push(revision)
  saveMockDrafts(drafts)
  return toBusinessStatus(revision)
}

export async function loadBusinessStatus(
  mode: ReviewMode,
  draftId: string,
): Promise<BusinessReportStatus> {
  if (mode === 'real') {
    return requestJson<BusinessReportStatus>(
      `/api/reports/${encodeURIComponent(draftId)}/status`,
    )
  }
  const draft = latestDraft(readMockDrafts(), draftId)
  if (!draft) throw new ReviewRequestError('Draft not found.', 404)
  return toBusinessStatus(draft)
}

export async function loadApprovedReport(
  mode: ReviewMode,
  draftId: string,
): Promise<Record<string, unknown>> {
  if (mode === 'real') {
    const response = await requestJson<{ reportPayload: Record<string, unknown> }>(
      `/api/reports/${encodeURIComponent(draftId)}/approved`,
    )
    return response.reportPayload
  }

  const draft = latestDraft(readMockDrafts(), draftId)
  if (!draft || draft.status !== 'approved') {
    throw new ReviewRequestError('Approved report not found.', 404)
  }
  return draft.reportPayload
}

function latestDraft(drafts: ReviewDraft[], draftId: string) {
  return drafts
    .filter((draft) => draft.draftId === draftId)
    .sort((left, right) => right.revision - left.revision)[0]
}

function toBusinessStatus(draft: ReviewDraft): BusinessReportStatus {
  return {
    draftId: draft.draftId,
    revision: draft.revision,
    status: draft.status,
    updatedAt: draft.updatedAt,
    reviewedAt: draft.reviewedAt,
  }
}
