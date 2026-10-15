'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  decideReviewDraft,
  filterDraftsByStatus,
  getReviewMode,
  loadReviewDrafts,
  type ReviewDraft,
  type ReviewDecision,
  type ReviewMode,
} from '../../services/review'
import { PayloadValue } from './ReportPayloadPreview'

function formatLabel(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function StatusBadge({ status }: { status: ReviewDraft['status'] }) {
  return (
    <span className={`review-status review-status-${status}`}>
      <span aria-hidden="true" />
      {formatLabel(status)}
    </span>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function ReviewWorkspace() {
  const [mode, setMode] = useState<ReviewMode | null>(null)
  const [latestDrafts, setLatestDrafts] = useState<ReviewDraft[]>([])
  const [historyDrafts, setHistoryDrafts] = useState<ReviewDraft[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'pending' | 'history'>('pending')
  const [feedback, setFeedback] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    let isActive = true
    getReviewMode()
      .then(async (loadedMode) => {
        const [loadedDrafts, loadedHistory] = await Promise.all([
          loadReviewDrafts(loadedMode),
          loadReviewDrafts(loadedMode, true),
        ])
        if (!isActive) return
        setMode(loadedMode)
        setLatestDrafts(loadedDrafts)
        setHistoryDrafts(loadedHistory)
        const firstPending = filterDraftsByStatus(loadedDrafts, ['pending'])[0]
        setSelectedKey(
          firstPending
            ? `${firstPending.draftId}:${firstPending.revision}`
            : null,
        )
      })
      .catch((error: unknown) => {
        if (isActive) {
          setLoadError(
            error instanceof Error ? error.message : 'Drafts could not be loaded.',
          )
        }
      })
      .finally(() => {
        if (isActive) setIsLoading(false)
      })

    return () => {
      isActive = false
    }
  }, [])

  const pendingDrafts = filterDraftsByStatus(latestDrafts, ['pending'])
  const completedDrafts = filterDraftsByStatus(historyDrafts, [
    'approved',
    'rejected',
  ])
  const visibleDrafts = activeTab === 'pending' ? pendingDrafts : completedDrafts
  const selectedDraft = visibleDrafts.find(
    (draft) => `${draft.draftId}:${draft.revision}` === selectedKey,
  )

  async function refreshDrafts(nextMode = mode) {
    if (!nextMode) return
    setIsRefreshing(true)
    setLoadError('')
    try {
      const [loadedDrafts, loadedHistory] = await Promise.all([
        loadReviewDrafts(nextMode),
        loadReviewDrafts(nextMode, true),
      ])
      setLatestDrafts(loadedDrafts)
      setHistoryDrafts(loadedHistory)
      const nextVisible =
        activeTab === 'pending'
          ? filterDraftsByStatus(loadedDrafts, ['pending'])
          : filterDraftsByStatus(loadedHistory, ['approved', 'rejected'])
      if (
        !nextVisible.some(
          (draft) => `${draft.draftId}:${draft.revision}` === selectedKey,
        )
      ) {
        setSelectedKey(
          nextVisible[0]
            ? `${nextVisible[0].draftId}:${nextVisible[0].revision}`
            : null,
        )
      }
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Drafts could not be refreshed.',
      )
    } finally {
      setIsRefreshing(false)
    }
  }

  async function submitDecision(decision: ReviewDecision) {
    if (!selectedDraft || !mode || isSubmitting) return
    if (decision === 'rejected' && !feedback.trim()) {
      setActionError('Add reviewer feedback before rejecting this draft.')
      return
    }

    setIsSubmitting(true)
    setActionError('')
    setSuccessMessage('')

    try {
      const updatedDraft = await decideReviewDraft(mode, {
        draft: selectedDraft,
        decision,
        expectedRevision: selectedDraft.revision,
        feedback: decision === 'rejected' ? feedback.trim() : undefined,
      })
      const [loadedDrafts, loadedHistory] = await Promise.all([
        loadReviewDrafts(mode),
        loadReviewDrafts(mode, true),
      ])
      setLatestDrafts(loadedDrafts)
      setHistoryDrafts(loadedHistory)
      setActiveTab('history')
      setSelectedKey(`${updatedDraft.draftId}:${updatedDraft.revision}`)
      setFeedback('')
      setSuccessMessage(
        `Revision ${updatedDraft.revision} ${decision === 'approved' ? 'approved' : 'rejected'} successfully.`,
      )
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        error.status === 409
      ) {
        setActionError(
          'This draft changed after it was loaded. Refresh the draft list and review the latest revision.',
        )
        void refreshDrafts()
      } else {
        setActionError(
          error instanceof Error
            ? error.message
            : 'The review action could not be completed. Please try again.',
        )
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="app-shell review-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/" aria-label="GenLedge home">
            gen<span>ledge</span>
            <span className="brand-mark" aria-hidden="true">
              ↗
            </span>
          </Link>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Workspace</Link>
            <span className="breadcrumb-chevron" aria-hidden="true">
              ›
            </span>
            <Link href="/demo">Business demo</Link>
            <span className="breadcrumb-chevron" aria-hidden="true">
              ›
            </span>
            <span className="breadcrumb-current">Report review</span>
          </nav>
        </div>
      </header>

      <section className="review-page" aria-labelledby="review-title">
        <div className="review-heading">
          <div>
            <p className="review-eyebrow">GenLedge · D2 reviewer workspace</p>
            <h1 id="review-title">Report review</h1>
            <p className="review-subtitle">
              Inspect each draft and record a decision on the displayed revision.
            </p>
          </div>
          <div className="review-heading-actions">
            {mode && (
              <span className={`review-demo-label review-mode-${mode}`}>
                <span aria-hidden="true" />
                {mode === 'real'
                  ? 'REAL BACKEND · LOCAL DEV ONLY'
                  : 'MOCK · browser-local data'}
              </span>
            )}
            <button
              className="review-button review-button-secondary"
              disabled={isLoading || isRefreshing}
              onClick={() => void refreshDrafts()}
              type="button"
            >
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {mode === 'real' && (
          <p className="review-local-auth-note">
            Localhost-only development demo; there is no reviewer login and this is
            not production authentication.
          </p>
        )}

        {isLoading ? (
          <div className="review-state" role="status">
            <span className="review-spinner" aria-hidden="true" />
            Loading report drafts…
          </div>
        ) : loadError ? (
          <div className="review-state review-state-error" role="alert">
            <p>{loadError}</p>
            <button
              className="review-button review-button-secondary"
              onClick={() => window.location.reload()}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
          <div className="review-tabs" role="tablist" aria-label="Draft status">
            <button
              aria-selected={activeTab === 'pending'}
              className={`review-tab${activeTab === 'pending' ? ' is-active' : ''}`}
              onClick={() => {
                setActiveTab('pending')
                const first = pendingDrafts[0]
                setSelectedKey(first ? `${first.draftId}:${first.revision}` : null)
                setActionError('')
              }}
              role="tab"
              type="button"
            >
              Pending <span>{pendingDrafts.length}</span>
            </button>
            <button
              aria-selected={activeTab === 'history'}
              className={`review-tab${activeTab === 'history' ? ' is-active' : ''}`}
              onClick={() => {
                setActiveTab('history')
                const first = completedDrafts[0]
                setSelectedKey(first ? `${first.draftId}:${first.revision}` : null)
                setActionError('')
              }}
              role="tab"
              type="button"
            >
              History <span>{completedDrafts.length}</span>
            </button>
          </div>
          {visibleDrafts.length === 0 ? (
            <div className="review-state">
              <span className="review-empty-icon" aria-hidden="true">
                ✓
              </span>
              <h2>
                {activeTab === 'pending'
                  ? 'No drafts awaiting review'
                  : 'No completed reviews yet'}
              </h2>
              <p>
                {activeTab === 'pending'
                  ? 'New report drafts will appear here when they are ready.'
                  : 'Approved and rejected revisions will remain available here.'}
              </p>
            </div>
          ) : (
          <div className="review-layout">
            <aside className="review-queue" aria-label="Report drafts">
              <div className="review-queue-heading">
                <h2>{activeTab === 'pending' ? 'Draft queue' : 'Review history'}</h2>
                <span>{visibleDrafts.length}</span>
              </div>
              <ul>
                {visibleDrafts.map((draft) => {
                  const draftKey = `${draft.draftId}:${draft.revision}`
                  return (
                  <li key={draftKey}>
                    <button
                      aria-current={draftKey === selectedKey ? 'true' : undefined}
                      className={`review-draft-option${draftKey === selectedKey ? ' is-selected' : ''}`}
                      onClick={() => {
                        setSelectedKey(draftKey)
                        setFeedback('')
                        setActionError('')
                        setSuccessMessage('')
                      }}
                      type="button"
                    >
                      <span className="review-draft-option-top">
                        <span>{String(draft.reportPayload.title ?? 'Untitled report')}</span>
                        <StatusBadge status={draft.status} />
                      </span>
                      <span className="review-draft-option-meta">
                        Revision {draft.revision} <span aria-hidden="true">·</span>{' '}
                        {formatDate(draft.updatedAt)}
                      </span>
                    </button>
                  </li>
                  )
                })}
              </ul>
            </aside>

            {selectedDraft && (
              <article className="review-detail">
                <header className="review-detail-header">
                  <div>
                    <div className="review-detail-kicker">
                      <span>Draft {selectedDraft.draftId.slice(0, 8)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Revision {selectedDraft.revision}</span>
                    </div>
                    <h2>{String(selectedDraft.reportPayload.title ?? 'Untitled report')}</h2>
                  </div>
                  <StatusBadge status={selectedDraft.status} />
                </header>

                <div className="review-meta">
                  <div>
                    <span>Conversation</span>
                    <strong>{selectedDraft.conversationId}</strong>
                  </div>
                  <div>
                    <span>Last updated</span>
                    <strong>{formatDate(selectedDraft.updatedAt)}</strong>
                  </div>
                  {selectedDraft.reviewedAt && (
                    <div>
                      <span>Reviewed</span>
                      <strong>{formatDate(selectedDraft.reviewedAt)}</strong>
                    </div>
                  )}
                </div>

                <section className="review-panel" aria-labelledby="report-preview-title">
                  <div className="review-panel-heading">
                    <div>
                      <p className="review-eyebrow">Structured payload</p>
                      <h3 id="report-preview-title">Report preview</h3>
                    </div>
                    <span>Reviewer view</span>
                  </div>
                  <div className="review-payload">
                    <PayloadValue value={selectedDraft.reportPayload} />
                  </div>
                </section>

                {selectedDraft.rejectionFeedback && (
                  <section className="review-feedback-note" aria-label="Rejection feedback">
                    <strong>Previous reviewer feedback</strong>
                    <p>{selectedDraft.rejectionFeedback}</p>
                  </section>
                )}

                <section className="review-evidence-placeholder" aria-labelledby="evidence-title">
                  <span className="review-evidence-icon" aria-hidden="true">
                    ◌
                  </span>
                  <div>
                    <h3 id="evidence-title">Evidence inspector</h3>
                    <p>
                      Evidence details are not connected yet. The existing
                      EvidenceInspector will be shown here when the protected evidence
                      API is integrated.
                    </p>
                  </div>
                  <span className="review-coming-soon">Coming soon</span>
                </section>

                {activeTab === 'pending' && selectedDraft.status === 'pending' && (
                  <section className="review-decision" aria-labelledby="decision-title">
                    <div>
                      <p className="review-eyebrow">Decision</p>
                      <h3 id="decision-title">Record your review</h3>
                    </div>
                    <label className="review-feedback-label" htmlFor="review-feedback">
                      Feedback <span>(required to reject)</span>
                    </label>
                    <textarea
                      id="review-feedback"
                      maxLength={4000}
                      onChange={(event) => setFeedback(event.target.value)}
                      placeholder="Share what should be corrected before this report is approved…"
                      value={feedback}
                    />
                    <div className="review-decision-footer">
                      <span>{feedback.length}/4000 characters</span>
                      <div className="review-actions">
                        <button
                          className="review-button review-button-reject"
                          disabled={isSubmitting}
                          onClick={() => void submitDecision('rejected')}
                          type="button"
                        >
                          {isSubmitting ? 'Saving…' : 'Reject draft'}
                        </button>
                        <button
                          className="review-button review-button-approve"
                          disabled={isSubmitting}
                          onClick={() => void submitDecision('approved')}
                          type="button"
                        >
                          {isSubmitting ? 'Saving…' : 'Approve report'}
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                {successMessage && (
                  <p className="review-feedback-message review-feedback-success" role="status">
                    {successMessage}
                  </p>
                )}
                {actionError && (
                  <p className="review-feedback-message review-feedback-error" role="alert">
                    {actionError}
                  </p>
                )}
              </article>
            )}
          </div>
          )}
          </>
        )}
      </section>
    </main>
  )
}
