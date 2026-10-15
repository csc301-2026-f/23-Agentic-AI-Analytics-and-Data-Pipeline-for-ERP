'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PayloadValue } from './ReportPayloadPreview'
import {
  createBusinessDemoDraft,
  createBusinessDemoRevision,
  getReviewMode,
  loadApprovedReport,
  loadBusinessStatus,
  type BusinessReportStatus,
  type ReviewMode,
} from '../../services/review'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function statusLabel(status: BusinessReportStatus['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

export default function BusinessWorkspace() {
  const [mode, setMode] = useState<ReviewMode | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [reportStatus, setReportStatus] = useState<BusinessReportStatus | null>(null)
  const [approvedPayload, setApprovedPayload] = useState<Record<string, unknown> | null>(
    null,
  )
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(
    async (selectedMode = mode, selectedId = draftId) => {
      if (!selectedMode || !selectedId) return
      setIsLoading(true)
      setError('')
      try {
        const latestStatus = await loadBusinessStatus(selectedMode, selectedId)
        setReportStatus(latestStatus)
        if (latestStatus.status === 'approved') {
          setApprovedPayload(await loadApprovedReport(selectedMode, selectedId))
        } else {
          setApprovedPayload(null)
        }
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'The report status could not be loaded.',
        )
      } finally {
        setIsLoading(false)
      }
    },
    [draftId, mode],
  )

  useEffect(() => {
    let isActive = true
    const requestedId = new URLSearchParams(window.location.search).get('draftId')

    async function initialize() {
      try {
        const loadedMode = await getReviewMode()
        if (!isActive) return
        setMode(loadedMode)
        setDraftId(requestedId)
        if (requestedId) {
          const latestStatus = await loadBusinessStatus(loadedMode, requestedId)
          if (!isActive) return
          setReportStatus(latestStatus)
          if (latestStatus.status === 'approved') {
            setApprovedPayload(await loadApprovedReport(loadedMode, requestedId))
          }
        }
        if (isActive) setIsLoading(false)
      } catch (requestError) {
        if (!isActive) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'The demo could not be initialized.',
        )
        setIsLoading(false)
      }
    }

    void initialize()

    return () => {
      isActive = false
    }
  }, [])

  useEffect(() => {
    function refreshWhenFocused() {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', refreshWhenFocused)
    document.addEventListener('visibilitychange', refreshWhenFocused)
    return () => {
      window.removeEventListener('focus', refreshWhenFocused)
      document.removeEventListener('visibilitychange', refreshWhenFocused)
    }
  }, [refresh])

  async function submitSample() {
    if (!mode || isSubmitting) return
    setIsSubmitting(true)
    setError('')
    setNotice('')
    try {
      const created = await createBusinessDemoDraft(mode)
      setDraftId(created.draftId)
      window.history.replaceState(null, '', `/demo?draftId=${created.draftId}`)
      setReportStatus(created)
      setApprovedPayload(null)
      setNotice('Sample draft submitted. It is awaiting reviewer approval.')
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The sample report could not be submitted.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submitRevision() {
    if (!mode || !draftId || isSubmitting) return
    setIsSubmitting(true)
    setError('')
    setNotice('')
    try {
      const revised = await createBusinessDemoRevision(mode, draftId)
      setReportStatus(revised)
      setApprovedPayload(null)
      setNotice(
        `Revision ${revised.revision} submitted. It is awaiting reviewer approval.`,
      )
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'A revised sample report could not be submitted.',
      )
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
            <span className="breadcrumb-current">Business demo</span>
            <span className="breadcrumb-chevron" aria-hidden="true">
              ›
            </span>
            <Link href="/review">Reviewer workspace</Link>
          </nav>
        </div>
      </header>

      <section className="review-page business-page" aria-labelledby="business-title">
        <div className="review-heading">
          <div>
            <p className="review-eyebrow">GenLedge · D2 business-user view</p>
            <h1 id="business-title">Report approval demo</h1>
            <p className="review-subtitle">
              Submit a sample report and view its payload only after approval.
            </p>
          </div>
          {mode && (
            <span className={`review-demo-label review-mode-${mode}`}>
              <span aria-hidden="true" />
              {mode === 'real'
                ? 'REAL BACKEND · PostgreSQL'
                : 'MOCK · browser-local data'}
            </span>
          )}
        </div>

        <aside className="business-demo-notice">
          <strong>Demo substitute for agent-generated reports.</strong> This page
          submits a fixed sample cash-flow report; it does not call or represent the
          Agent Harness.
        </aside>

        {!draftId ? (
          <section className="business-start-card">
            <span className="review-empty-icon" aria-hidden="true">
              ↗
            </span>
            <h2>Start a report approval demo</h2>
            <p>
              Submit a sample cash-flow draft to the review queue. The business view
              will show its status, but not its report contents, until a reviewer
              approves it.
            </p>
            <button
              className="review-button review-button-approve"
              disabled={!mode || isSubmitting}
              onClick={() => void submitSample()}
              type="button"
            >
              {isSubmitting ? 'Submitting…' : 'Submit sample cash-flow report'}
            </button>
          </section>
        ) : (
          <section className="business-report-card" aria-label="Submitted report">
            <div className="business-report-header">
              <div>
                <p className="review-eyebrow">Submitted report</p>
                <h2>Draft {draftId.slice(0, 8)}</h2>
              </div>
              <div className="business-report-actions">
                <button
                  className="review-button review-button-secondary"
                  disabled={isLoading}
                  onClick={() => void refresh()}
                  type="button"
                >
                  {isLoading ? 'Refreshing…' : 'Refresh status'}
                </button>
              </div>
            </div>

            {isLoading ? (
              <div className="business-status" role="status">
                <span className="review-spinner" aria-hidden="true" />
                Loading report status…
              </div>
            ) : error ? (
              <div className="review-feedback-message review-feedback-error" role="alert">
                {error}
              </div>
            ) : reportStatus ? (
              <>
                <div className={`business-lifecycle business-lifecycle-${reportStatus.status}`}>
                  <span aria-hidden="true">
                    {reportStatus.status === 'approved'
                      ? '✓'
                      : reportStatus.status === 'rejected'
                        ? '!'
                        : '…'}
                  </span>
                  <div>
                    <strong>
                      {reportStatus.status === 'pending'
                        ? 'Awaiting review'
                        : reportStatus.status === 'approved'
                          ? 'Approved'
                          : 'Not approved'}
                    </strong>
                    <p>
                      Revision {reportStatus.revision} · {statusLabel(reportStatus.status)}
                      {' · '}Updated {formatDate(reportStatus.updatedAt)}
                    </p>
                  </div>
                </div>

                {notice && (
                  <p className="review-feedback-message review-feedback-success" role="status">
                    {notice}
                  </p>
                )}

                {reportStatus.status === 'pending' && (
                  <p className="business-privacy-note">
                    The report payload is not available in the business view while the
                    draft is pending review.
                  </p>
                )}

                {reportStatus.status === 'rejected' && (
                  <div className="business-rejected-message">
                    <strong>This report was not released.</strong>
                    <p>
                      The reviewer rejected this revision. Reviewer feedback remains
                      in the reviewer history. You can submit a new sample revision;
                      automatic report regeneration is not connected.
                    </p>
                    <button
                      className="review-button review-button-secondary"
                      disabled={isSubmitting}
                      onClick={() => void submitRevision()}
                      type="button"
                    >
                      {isSubmitting ? 'Submitting…' : 'Submit revised sample'}
                    </button>
                  </div>
                )}

                {reportStatus.status === 'approved' && approvedPayload && (
                  <section className="review-panel business-approved" aria-labelledby="approved-title">
                    <div className="review-panel-heading">
                      <div>
                        <p className="review-eyebrow">Approved report</p>
                        <h3 id="approved-title">
                          {String(approvedPayload.title ?? 'Approved report')}
                        </h3>
                      </div>
                      <span>Revision {reportStatus.revision}</span>
                    </div>
                    <div className="review-payload">
                      <PayloadValue value={approvedPayload} />
                    </div>
                  </section>
                )}
              </>
            ) : null}
          </section>
        )}

        {!isLoading && error && !draftId && (
          <p className="review-feedback-message review-feedback-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  )
}
