'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import MappingLineageCanvas from './MappingLineageCanvas'
import {
  createMockReportRequest,
  getApprovedDefinitions,
  getLatestMappingProposals,
  loadMockReviewState,
  resetMockReviewState,
  submitMappingProposal,
  subscribeToMockReviewState,
  type MappingProposal,
  type MockReportRequest,
  type MockReviewState,
} from '../../services/review'

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function BusinessWorkspace() {
  const [state, setState] = useState<MockReviewState>({
    proposals: [],
    reportRequests: [],
  })
  const [requestText, setRequestText] = useState(
    'I need a monthly view of cash moving in and out of the business.',
  )
  const [period, setPeriod] = useState('Q3 2026')
  const [currency, setCurrency] = useState('USD')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function refresh() {
    try {
      setState(loadMockReviewState())
      setError('')
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Mock report definition data could not be loaded.',
      )
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      refresh()
      setIsLoading(false)
    }, 0)
    const unsubscribe = subscribeToMockReviewState(() => refresh())
    return () => {
      window.clearTimeout(initialLoad)
      unsubscribe()
    }
  }, [])

  const latestProposals = useMemo(
    () => getLatestMappingProposals(state.proposals),
    [state.proposals],
  )
  const approvedDefinitions = getApprovedDefinitions(state.proposals)
  const selectedRun =
    state.reportRequests.find((request) => request.id === selectedRunId) ??
    state.reportRequests[state.reportRequests.length - 1] ??
    null

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    try {
      const proposal = submitMappingProposal(requestText)
      setState(loadMockReviewState())
      setNotice(
        `Mapping proposal revision ${proposal.revision} submitted. It is awaiting data engineer review.`,
      )
      setRequestText('')
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'The mock mapping request could not be submitted.',
      )
    }
  }

  function requestReport(mappingId: string) {
    setError('')
    setNotice('')
    try {
      const request = createMockReportRequest(mappingId, { period, currency })
      const nextState = loadMockReviewState()
      setState(nextState)
      setSelectedRunId(request.id)
      setNotice(
        `Mock report request created using approved definition revision ${request.definitionRevision}.`,
      )
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The mock report request could not be created.',
      )
    }
  }

  function resetDemo() {
    resetMockReviewState()
    setState({ proposals: [], reportRequests: [] })
    setRequestText('I need a monthly view of cash moving in and out of the business.')
    setSelectedRunId(null)
    setError('')
    setNotice('Mock definition and report-request data reset.')
  }

  function proposalFeedback(proposal: MappingProposal) {
    return [...proposal.reviewHistory]
      .reverse()
      .find(
        (event) =>
          event.action === 'changes_requested' &&
          event.revision === proposal.revision,
      )?.feedback
  }

  function definitionForRequest(request: MockReportRequest) {
    return state.proposals.find(
      (proposal) =>
        proposal.mappingId === request.mappingId &&
        proposal.revision === request.definitionRevision,
    )?.definition
  }

  return (
    <main className="app-shell review-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/" aria-label="GenLedge home">
            gen<span>ledge</span>
            <span className="brand-mark" aria-hidden="true">↗</span>
          </Link>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Workspace</Link>
            <span className="breadcrumb-chevron" aria-hidden="true">›</span>
            <span className="breadcrumb-current">Business demo</span>
            <span className="breadcrumb-chevron" aria-hidden="true">›</span>
            <Link href="/review">Data engineer review</Link>
          </nav>
        </div>
      </header>

      <section className="review-page mapping-business-page" aria-labelledby="business-title">
        <div className="review-heading">
          <div>
            <p className="review-eyebrow">GenLedge · D2 business-user workspace</p>
            <h1 id="business-title">Reusable report definitions</h1>
            <p className="review-subtitle">
              Request a mapping definition, then reuse it after a data engineer
              approves its structure.
            </p>
          </div>
          <div className="review-heading-actions">
            <span className="review-demo-label review-mode-mock">
              <span aria-hidden="true" />
              MOCK · browser-local data
            </span>
            <button
              className="review-button review-button-secondary"
              disabled={isLoading}
              onClick={refresh}
              type="button"
            >
              Refresh
            </button>
            <button
              className="review-button review-button-secondary"
              onClick={resetDemo}
              type="button"
            >
              Reset demo
            </button>
          </div>
        </div>

        <aside className="mapping-demo-notice">
          <strong>Mock-only workflow.</strong> Mapping proposals use a fixed
          illustrative cash-flow schema. No live warehouse discovery, Agent Harness,
          SQL execution, PostgreSQL connection, or real report calculation is involved.
        </aside>

        {isLoading ? (
          <div className="review-state" role="status">Loading mock definitions…</div>
        ) : (
          <>
            <section className="mapping-business-card" aria-labelledby="mapping-request-title">
              <div className="mapping-business-card-heading">
                <div>
                  <p className="review-eyebrow">Business user</p>
                  <h2 id="mapping-request-title">Request a report definition</h2>
                  <p>
                    This submits a sample mapping proposal—not a financial report and
                    not an Agent Harness request.
                  </p>
                </div>
                <span className="mapping-step-number">01</span>
              </div>
              <form className="mapping-request-form" onSubmit={submitRequest}>
                <label className="mapping-form-field" htmlFor="mapping-request">
                  <span>What reusable report structure do you need?</span>
                  <textarea
                    id="mapping-request"
                    maxLength={800}
                    onChange={(event) => setRequestText(event.target.value)}
                    placeholder="Describe the fields and view you need…"
                    required
                    value={requestText}
                  />
                </label>
                <div className="mapping-form-actions">
                  <span>Creates a pending mapping with sample schema metadata.</span>
                  <button className="review-button review-button-approve" type="submit">
                    Submit mapping proposal
                  </button>
                </div>
              </form>
            </section>

            <section className="mapping-business-card" aria-labelledby="mapping-status-title">
              <div className="mapping-business-card-heading">
                <div>
                  <p className="review-eyebrow">Lifecycle</p>
                  <h2 id="mapping-status-title">Your definition requests</h2>
                  <p>Current status and revision; report figures are not shown here.</p>
                </div>
                <span className="mapping-step-number">02</span>
              </div>
              {latestProposals.length === 0 ? (
                <div className="mapping-empty-state">
                  <span className="review-empty-icon" aria-hidden="true">↗</span>
                  <strong>No mapping requests yet</strong>
                  <span>Submit a definition request to start the mock review flow.</span>
                </div>
              ) : (
                <div className="mapping-request-list">
                  {latestProposals.map((proposal) => {
                    const feedback = proposalFeedback(proposal)
                    return (
                      <article className="mapping-request-card" key={proposal.mappingId}>
                        <div className="mapping-request-card-heading">
                          <div>
                            <h3>{proposal.definition.title}</h3>
                            <p>{proposal.requestText}</p>
                          </div>
                          <span className={`mapping-status mapping-status-${proposal.status}`}>
                            {statusLabel(proposal.status)}
                          </span>
                        </div>
                        <div className="mapping-request-meta">
                          <span>Definition {proposal.mappingId.slice(0, 13)}</span>
                          <span>Revision {proposal.revision}</span>
                        </div>
                        {proposal.status === 'pending' && (
                          <p className="mapping-lifecycle-note">
                            Awaiting data engineer review. Only definition structure is
                            being reviewed.
                          </p>
                        )}
                        {proposal.status === 'changes_requested' && (
                          <div className="mapping-feedback-callout">
                            <strong>Changes requested · mapping feedback</strong>
                            <p>{feedback ?? 'See review history for requested changes.'}</p>
                            <span>
                              A data engineer can edit this proposal and save a corrected
                              revision. No automatic regeneration is simulated.
                            </span>
                          </div>
                        )}
                        {proposal.status === 'approved' && (
                          <div className="mapping-approved-note">
                            This latest definition revision is approved and available
                            for mock report requests.
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="mapping-business-card" aria-labelledby="approved-definitions-title">
              <div className="mapping-business-card-heading">
                <div>
                  <p className="review-eyebrow">Published definitions</p>
                  <h2 id="approved-definitions-title">Request a report from an approved definition</h2>
                  <p>
                    A newer pending or changed revision hides an older approval from
                    this list.
                  </p>
                </div>
                <span className="mapping-step-number">03</span>
              </div>
              {approvedDefinitions.length === 0 ? (
                <div className="mapping-empty-state">
                  <strong>No latest approved definitions</strong>
                  <span>
                    A data engineer must approve the current mapping revision before
                    it can be reused.
                  </span>
                  <Link className="review-button review-button-secondary" href="/review">
                    Open data engineer review
                  </Link>
                </div>
              ) : (
                <>
                  <div className="mapping-run-parameters">
                    <label className="mapping-form-field">
                      <span>Reporting period · mock parameter</span>
                      <input
                        onChange={(event) => setPeriod(event.target.value)}
                        value={period}
                      />
                    </label>
                    <label className="mapping-form-field">
                      <span>Currency · mock parameter</span>
                      <select
                        onChange={(event) => setCurrency(event.target.value)}
                        value={currency}
                      >
                        <option value="USD">USD</option>
                        <option value="CAD">CAD</option>
                      </select>
                    </label>
                  </div>
                  <div className="mapping-approved-definition-list">
                    {approvedDefinitions.map((proposal) => (
                      <article
                        className="mapping-approved-definition"
                        key={proposal.mappingId}
                      >
                        <div>
                          <h3>{proposal.definition.title}</h3>
                          <p>
                            Approved revision {proposal.revision} ·{' '}
                            {proposal.definition.sources
                              .map((source) => `${source.schema}.${source.table}`)
                              .join(', ')}
                          </p>
                        </div>
                        <button
                          className="review-button review-button-approve"
                          onClick={() => requestReport(proposal.mappingId)}
                          type="button"
                        >
                          Request mock report
                        </button>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>

            {selectedRun && (
              <section className="mapping-business-card mapping-simulated-report" aria-labelledby="simulated-report-title">
                <div className="mapping-business-card-heading">
                  <div>
                    <p className="review-eyebrow">Simulated report · mock fixture values</p>
                    <h2 id="simulated-report-title">{selectedRun.title}</h2>
                    <p>
                      Request {selectedRun.id.slice(0, 12)} · approved definition
                      revision {selectedRun.definitionRevision} · {selectedRun.period} ·{' '}
                      {selectedRun.currency}
                    </p>
                  </div>
                  <span className="mapping-status mapping-status-approved">Approved definition</span>
                </div>
                <p className="mapping-simulation-warning">
                  Artificial demonstration figures only. No warehouse rows were
                  retrieved and no governed query was executed.
                </p>
                {(() => {
                  const definition = definitionForRequest(selectedRun)
                  if (!definition) {
                    return (
                      <p className="review-feedback-message review-feedback-error" role="alert">
                        The definition snapshot for this mock request is unavailable.
                      </p>
                    )
                  }
                  return (
                    <>
                      <MappingLineageCanvas definition={definition} />
                      <div className="mapping-result-table-wrap">
                        <table className="mapping-result-table">
                          <thead>
                            <tr>
                              {definition.outputFields.map((field) => (
                                <th key={field.id}>{field.label}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {selectedRun.rows.map((row, index) => (
                              <tr key={`${selectedRun.id}-${index}`}>
                                {definition.outputFields.map((field) => (
                                  <td key={field.id}>
                                    {typeof row[field.id] === 'number'
                                      ? new Intl.NumberFormat('en-US', {
                                          style: field.dataType === 'currency' ? 'currency' : 'decimal',
                                          currency: selectedRun.currency,
                                          maximumFractionDigits: 0,
                                        }).format(Number(row[field.id]))
                                      : row[field.id]}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )
                })()}
                {state.reportRequests.length > 1 && (
                  <label className="mapping-form-field mapping-run-picker">
                    <span>Previous mock requests</span>
                    <select
                      onChange={(event) => setSelectedRunId(event.target.value)}
                      value={selectedRun.id}
                    >
                      {[...state.reportRequests]
                        .reverse()
                        .map((request) => (
                          <option key={request.id} value={request.id}>
                            {request.title} · {request.requestedAt}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </section>
            )}

            {notice && (
              <p className="review-feedback-message review-feedback-success" role="status">
                {notice}
              </p>
            )}
            {error && (
              <p className="review-feedback-message review-feedback-error" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </section>
    </main>
  )
}
