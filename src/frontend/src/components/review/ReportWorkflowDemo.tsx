'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import {
  createMockReportRequest,
  getApprovedDefinitions,
  getLatestMappingProposals,
  loadMockReviewState,
  resetMockReviewState,
  submitMappingProposal,
  subscribeToMockReviewState,
  type MappingProposal,
  type MockReviewState,
} from '../../services/review'

const workflowSteps = [
  'Request a report',
  'Clarify the need',
  'Await review',
  'Report ready',
  'View results',
]

const initialRequest =
  'I’d like a monthly report showing how cash is moving through the business.'
const initialClarification =
  'Q3 2026 in USD. Net cash flow by month, with a chart and a monthly breakdown.'

function stepTitle(step: number, proposal: MappingProposal | null) {
  if (step === 2) {
    if (proposal?.status === 'approved') return 'Report ready'
    if (proposal?.status === 'changes_requested') return 'Mapping changes requested'
    return 'Awaiting review'
  }
  return [
    'What report do you need?',
    'A few details',
    'Awaiting review',
    'Your reports',
    'Your report',
  ][step]
}

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getProposalFeedback(proposal: MappingProposal | null) {
  if (!proposal) return null
  return [...proposal.reviewHistory]
    .reverse()
    .find(
      (event) =>
        event.action === 'changes_requested' &&
        event.revision === proposal.revision,
    )?.feedback
}

function money(value: unknown, currency: string) {
  if (typeof value !== 'number') return String(value ?? '—')
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

export default function ReportWorkflowDemo() {
  const [state, setState] = useState<MockReviewState>({
    proposals: [],
    reportRequests: [],
  })
  const [step, setStep] = useState(0)
  const [requestText, setRequestText] = useState(initialRequest)
  const [clarification, setClarification] = useState(initialClarification)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function refresh() {
    try {
      const nextState = loadMockReviewState()
      setState(nextState)
      setError('')
      return nextState
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Mock report definition data could not be loaded.',
      )
      return null
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      const nextState = refresh()
      if (nextState) {
        const latest = getLatestMappingProposals(nextState.proposals).at(0)
        if (latest) {
          setRequestText(latest.requestText)
          setClarification(latest.clarificationText || initialClarification)
          if (latest.status === 'pending' || latest.status === 'changes_requested') {
            setStep(2)
          } else if (latest.status === 'approved') {
            setStep(nextState.reportRequests.length ? 4 : 3)
          }
        }
      }
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
  const latestProposal = latestProposals.at(0) ?? null
  const approvedDefinitions = getApprovedDefinitions(state.proposals)
  const selectedRun =
    state.reportRequests.find((request) => request.id === selectedRunId) ??
    state.reportRequests.at(-1) ??
    null
  const selectedDefinition = selectedRun
    ? state.proposals.find(
        (proposal) =>
          proposal.mappingId === selectedRun.mappingId &&
          proposal.revision === selectedRun.definitionRevision,
      )?.definition
    : null
  const furthestStep = !latestProposal
    ? 0
    : latestProposal.status === 'approved'
      ? state.reportRequests.length
        ? 4
        : 3
      : 2
  const feedback = getProposalFeedback(latestProposal)

  function continueToClarification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!requestText.trim()) {
      setError('Describe the report structure you need.')
      return
    }
    setError('')
    setStep(1)
  }

  function submitClarification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNotice('')
    try {
      submitMappingProposal(requestText, clarification)
      const nextState = refresh()
      if (nextState) {
        setState(nextState)
        setStep(2)
        setNotice('Your request is awaiting review on the separate data engineer screen.')
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'The sample report request could not be submitted.',
      )
    }
  }

  function openMockReport(proposal: MappingProposal) {
    setError('')
    setNotice('')
    try {
      const report = createMockReportRequest(proposal.mappingId, {
        period: 'Q3 2026',
        currency: 'USD',
      })
      const nextState = loadMockReviewState()
      setState(nextState)
      setSelectedRunId(report.id)
      setStep(4)
      setNotice(
        `Simulated report created using approved definition revision ${report.definitionRevision}.`,
      )
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The simulated report could not be created.',
      )
    }
  }

  function restart() {
    resetMockReviewState()
    setState({ proposals: [], reportRequests: [] })
    setStep(0)
    setRequestText(initialRequest)
    setClarification(initialClarification)
    setSelectedRunId(null)
    setError('')
    setNotice('Mock walkthrough restarted.')
  }

  const stepContent = (() => {
    if (isLoading) return <div className="wf-loading" role="status">Loading prototype data…</div>
    if (step === 0) {
      return (
        <form
          className="wf-conversation"
          id="workflow-request-form"
          onSubmit={continueToClarification}
        >
          <div className="wf-assistant-label"><span />GenLedge Assistant</div>
          <p>What would you like to understand about your business?</p>
          <div className="wf-request-bubble">
            <label htmlFor="workflow-request">You</label>
            <textarea
              id="workflow-request"
              maxLength={800}
              onChange={(event) => setRequestText(event.target.value)}
              required
              value={requestText}
            />
          </div>
          {error && <p className="wf-error" role="alert">{error}</p>}
        </form>
      )
    }
    if (step === 1) {
      return (
        <form
          className="wf-conversation"
          id="workflow-clarification-form"
          onSubmit={submitClarification}
        >
          <p className="wf-previous-message">{requestText}</p>
          <div className="wf-assistant-label"><span />GenLedge Assistant</div>
          <p>
            I can put that together. What period and currency should I use? Would
            you like money coming in and going out separately, or just the net cash
            flow?
          </p>
          <div className="wf-request-bubble">
            <label htmlFor="workflow-clarification">You</label>
            <textarea
              id="workflow-clarification"
              maxLength={1000}
              onChange={(event) => setClarification(event.target.value)}
              required
              value={clarification}
            />
          </div>
          {error && <p className="wf-error" role="alert">{error}</p>}
        </form>
      )
    }
    if (step === 2) {
      const approved = latestProposal?.status === 'approved'
      const changed = latestProposal?.status === 'changes_requested'
      return (
        <div className="wf-handoff">
          <span className={`wf-badge ${approved ? 'is-approved' : 'is-warning'}`}>
            {approved ? 'Ready' : changed ? 'Mapping changes requested' : 'Awaiting review'}
          </span>
          <h3>
            {approved
              ? 'Your report definition is approved.'
              : changed
                ? 'The engineer requested mapping changes.'
                : 'Your request is with a data engineer.'}
          </h3>
          <p>
            {approved
              ? 'You can now use the approved definition to request a simulated report.'
              : changed
                ? 'The feedback below describes the definition changes needed. No automatic agent regeneration is simulated.'
                : 'The report definition will be available once its structure is approved.'}
          </p>
          {latestProposal && (
            <div className="wf-request-summary">
              <p>{latestProposal.requestText}</p>
              <p>{latestProposal.clarificationText || clarification}</p>
              <span>
                {statusLabel(latestProposal.status)} · Definition revision {latestProposal.revision}
              </span>
            </div>
          )}
          {feedback && (
            <div className="wf-feedback"><strong>Reviewer feedback</strong><p>{feedback}</p></div>
          )}
          {approved && latestProposal && (
            <button
              className="wf-button wf-primary"
              onClick={() => setStep(3)}
              type="button"
            >
              View approved definition
            </button>
          )}
          {!approved && (
            <p className="wf-prototype-note">
              The reviewer uses a separate screen. This business-user page does not provide reviewer access.
            </p>
          )}
        </div>
      )
    }
    if (step === 3) {
      return approvedDefinitions.length ? (
        <div className="wf-report-list">
          <p className="wf-intro">Approved report definitions are reusable. Choose one to request a mock report.</p>
          {approvedDefinitions.map((proposal) => (
            <article className="wf-definition-card" key={proposal.mappingId}>
              <div>
                <span className="wf-badge is-approved">Approved · revision {proposal.revision}</span>
                <h3>{proposal.definition.title}</h3>
                <p>{proposal.definition.sources.map((source) => `${source.schema}.${source.table}`).join(', ')}</p>
              </div>
              <button className="wf-button wf-primary" onClick={() => openMockReport(proposal)} type="button">
                Request report
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="wf-handoff">
          <span className="wf-badge is-warning">Awaiting review</span>
          <h3>No approved report definition yet.</h3>
          <p>A data engineer must approve the current definition before it can be reused.</p>
          <p className="wf-prototype-note">
            The reviewer uses a separate screen. This business-user page does not provide reviewer access.
          </p>
        </div>
      )
    }
    return selectedRun && selectedDefinition ? (
      <div className="wf-results">
        <div className="wf-results-heading">
          <div>
            <span className="wf-badge is-approved">Simulated report · mock data</span>
            <h3>{selectedRun.title}</h3>
            <p>{selectedRun.period} · {selectedRun.currency} · approved definition revision {selectedRun.definitionRevision}</p>
          </div>
          <button className="wf-button" onClick={() => setStep(4)} type="button">Back to reports</button>
        </div>
        <p className="wf-prototype-note">
          Artificial demonstration figures only. No warehouse rows were retrieved
          and no governed query was executed.
        </p>
        <div className="wf-results-table-wrap">
          <table className="wf-results-table">
            <thead>
              <tr>{selectedDefinition.outputFields.map((field) => <th key={field.id}>{field.label}</th>)}</tr>
            </thead>
            <tbody>
              {selectedRun.rows.map((row, index) => (
                <tr key={`${selectedRun.id}-${index}`}>
                  {selectedDefinition.outputFields.map((field) => (
                    <td key={field.id}>
                      {field.dataType === 'currency'
                        ? money(row[field.id], selectedRun.currency)
                        : String(row[field.id] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ) : (
      <div className="wf-handoff"><h3>No simulated report to show yet.</h3><p>Choose an approved definition and request a report.</p></div>
    )
  })()

  return (
    <div className="wf-app">
      <header className="wf-topbar">
        <div className="wf-topbar-inner">
          <Link className="wf-brand" href="/" aria-label="GenLedge home">gen<span>ledge</span><sup>↗</sup></Link>
          <nav className="wf-breadcrumb" aria-label="Breadcrumb">
            <Link href="/">Workspace</Link><span>›</span><strong>Report workflow</strong>
          </nav>
          <span className="wf-offline"><i /> Prototype · simulated data</span>
        </div>
      </header>
      <main className="wf-main">
        <div className="wf-page-heading">
          <div><p className="wf-eyebrow">GenLedge · walkthrough</p><h1>Report workflow</h1></div>
          <button className="wf-button" onClick={restart} type="button"><span aria-hidden="true">↻</span> Restart Demo</button>
        </div>
        <div className="wf-workspace">
          <aside className="wf-sidebar">
            <nav className="wf-steps" aria-label="Report workflow steps">
              <section className="wf-flow-group">
                <h2>♙ Business user <span>Request</span></h2>
                {workflowSteps.slice(0, 3).map((label, index) => (
                  <button
                    aria-current={step === index ? 'step' : undefined}
                    className={`wf-step${step === index ? ' is-active' : ''}${index < step ? ' is-done' : ''}`}
                    disabled={index > furthestStep || isLoading}
                    key={label}
                    onClick={() => { setStep(index); setError('') }}
                    type="button"
                  >
                    <span className="wf-step-number">{index < step ? '✓' : index + 1}</span>{label}
                  </button>
                ))}
              </section>
              <section className="wf-flow-group">
                <h2>♙ Business user <span>Report</span></h2>
                {workflowSteps.slice(3).map((label, offset) => {
                  const index = offset + 3
                  return (
                    <button
                      aria-current={step === index ? 'step' : undefined}
                      className={`wf-step${step === index ? ' is-active' : ''}${index < step ? ' is-done' : ''}`}
                      disabled={index > furthestStep || isLoading}
                      key={label}
                      onClick={() => setStep(index)}
                      type="button"
                    >
                      <span className="wf-step-number">{index < step ? '✓' : index + 1}</span>{label}
                    </button>
                  )
                })}
              </section>
              <p className="wf-sidebar-note"><strong>Demo walkthrough</strong>Sample metadata and simulated results only.</p>
            </nav>
          </aside>
          <section className="wf-stage" aria-labelledby="workflow-stage-title">
            <header className="wf-stage-header">
              <div><p>Step {step + 1} of {workflowSteps.length}</p><h2 id="workflow-stage-title">{stepTitle(step, latestProposal)}</h2></div>
              <span className="wf-badge is-business">Business user</span>
            </header>
            <div className="wf-stage-body">
              {notice && <p className="wf-notice" role="status">{notice}</p>}
              {stepContent}
            </div>
            <footer className="wf-stage-footer">
              {step > 0 ? (
                <button className="wf-button wf-quiet" onClick={() => setStep(step - 1)} type="button">
                  ← Back
                </button>
              ) : <span />}
              {step === 0 && (
                <button
                  className="wf-button wf-primary"
                  form="workflow-request-form"
                  type="submit"
                >
                  Continue →
                </button>
              )}
              {step === 1 && (
                <button
                  className="wf-button wf-primary"
                  form="workflow-clarification-form"
                  type="submit"
                >
                  Send reply →
                </button>
              )}
              {step === 2 && latestProposal && latestProposal.status !== 'approved' && (
                <span className="wf-footer-note">Reviewer actions are on the separate /review screen.</span>
              )}
              {step === 4 && approvedDefinitions[0] && (
                <button
                  className="wf-button wf-primary"
                  onClick={() => openMockReport(approvedDefinitions[0])}
                  type="button"
                >
                  Run again →
                </button>
              )}
            </footer>
          </section>
        </div>
        <div className="wf-live-message" role="status" aria-live="polite">{error || notice}</div>
      </main>
    </div>
  )
}
