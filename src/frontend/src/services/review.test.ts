import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createBusinessDemoDraft,
  createBusinessDemoRevision,
  decideReviewDraft,
  filterDraftsByStatus,
  loadApprovedReport,
  loadBusinessStatus,
  loadReviewDrafts,
  type ReviewDraft,
} from './review'

const pendingDraft: ReviewDraft = {
  draftId: '8fbfdc5a-40bd-4b42-9ddd-2b290c55d401',
  conversationId: 'demo',
  revision: 4,
  status: 'pending',
  reportPayload: { title: 'Cash flow' },
  evidenceId: 'not-used-by-business-view',
  rejectionFeedback: null,
  createdAt: '2026-10-15T10:00:00Z',
  updatedAt: '2026-10-15T10:00:00Z',
  reviewedAt: null,
}

describe('review service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn())
    const storage = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      setTimeout: globalThis.setTimeout.bind(globalThis),
    })
  })

  it('filters a pending queue separately from completed history', () => {
    const approved = { ...pendingDraft, status: 'approved' as const }
    expect(filterDraftsByStatus([pendingDraft, approved], ['pending'])).toEqual([
      pendingDraft,
    ])
    expect(
      filterDraftsByStatus([pendingDraft, approved], ['approved', 'rejected']),
    ).toEqual([approved])
  })

  it('sends the displayed expected revision and rejection feedback', async () => {
    const updated = {
      ...pendingDraft,
      status: 'rejected',
      rejectionFeedback: 'Clarify the date range.',
    }
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(updated), { status: 200 }),
    )

    await decideReviewDraft('real', {
      draft: pendingDraft,
      decision: 'rejected',
      expectedRevision: 4,
      feedback: '  Clarify the date range.  ',
    })

    expect(fetch).toHaveBeenCalledWith(
      `/api/review/drafts/${pendingDraft.draftId}/reject`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          expectedRevision: 4,
          feedback: 'Clarify the date range.',
        }),
      }),
    )
  })

  it('submits approval against the displayed revision', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ ...pendingDraft, status: 'approved' }),
        { status: 200 },
      ),
    )

    await decideReviewDraft('real', {
      draft: pendingDraft,
      decision: 'approved',
      expectedRevision: 4,
    })

    expect(fetch).toHaveBeenCalledWith(
      `/api/review/drafts/${pendingDraft.draftId}/approve`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedRevision: 4 }),
      }),
    )
  })

  it('surfaces stale revision conflicts without treating them as success', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ detail: 'Expected revision 4, but latest is 5.' }),
        { status: 409 },
      ),
    )

    await expect(
      decideReviewDraft('real', {
        draft: pendingDraft,
        decision: 'approved',
        expectedRevision: 4,
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('loads actual reviewer history from its dedicated endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ drafts: [pendingDraft] }), { status: 200 }),
    )

    await loadReviewDrafts('real', true)

    expect(fetch).toHaveBeenCalledWith(
      '/api/review/drafts/history',
      expect.objectContaining({ cache: 'no-store' }),
    )
  })

  it('keeps mock decisions and revised history in browser-local persistence', async () => {
    const submitted = await createBusinessDemoDraft('mock')
    expect(submitted.status).toBe('pending')
    expect('reportPayload' in submitted).toBe(false)
    await expect(loadApprovedReport('mock', submitted.draftId)).rejects.toMatchObject({
      status: 404,
    })

    const pending = (await loadReviewDrafts('mock')).find(
      (draft) => draft.draftId === submitted.draftId,
    )
    if (!pending) throw new Error('Submitted mock draft was not found.')
    const rejected = await decideReviewDraft('mock', {
      draft: pending,
      decision: 'rejected',
      expectedRevision: 1,
      feedback: 'Clarify the period.',
    })
    expect(rejected.rejectionFeedback).toBe('Clarify the period.')
    expect((await loadBusinessStatus('mock', submitted.draftId)).status).toBe(
      'rejected',
    )

    const revision = await createBusinessDemoRevision('mock', submitted.draftId)
    const allHistory = await loadReviewDrafts('mock', true)
    const history = allHistory.filter(
      (draft) => draft.draftId === submitted.draftId,
    )
    expect(revision).toMatchObject({ revision: 2, status: 'pending' })
    expect(history.map(({ revision: version, status }) => [version, status])).toEqual([
      [1, 'rejected'],
      [2, 'pending'],
    ])
  })
})
