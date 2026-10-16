'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import MappingDefinitionEditor from './MappingDefinitionEditor'
import MappingLineageCanvas from './MappingLineageCanvas'
import ReportDefinitionPreview from './ReportDefinitionPreview'
import {
  decideMappingProposal,
  getLatestMappingProposals,
  loadMockReviewState,
  resetMockReviewState,
  saveMappingRevision,
  subscribeToMockReviewState,
  type MappingProposal,
  type MockReviewState,
  type ReportDefinition,
  type ReportView,
} from '../../services/review'

type ReviewTab = 'pending' | 'history'

function statusLabel(status: string) {
  return status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function proposalKey(proposal: MappingProposal) {
  return `${proposal.mappingId}:${proposal.revision}`
}

function cloneDefinition(definition: ReportDefinition) {
  return structuredClone(definition)
}

function fieldsForView(view: ReportView) {
  return view.type === 'table'
    ? view.columnFieldIds
    : [view.xFieldId, ...view.yFieldIds].filter(
        (fieldId): fieldId is string => fieldId !== null,
      )
}

function sourceColumnLabel(definition: ReportDefinition, columnId: string) {
  for (const source of definition.sources) {
    const column = source.selectedColumns.find((item) => item.id === columnId)
    if (column) return `${source.schema}.${source.table}.${column.name}`
  }
  return null
}

export default function ReviewWorkspace() {
  const [state, setState] = useState<MockReviewState>({
    proposals: [],
    reportRequests: [],
  })
  const [activeTab, setActiveTab] = useState<ReviewTab>('pending')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null)
  const [editedProposal, setEditedProposal] = useState<{
    key: string
    definition: ReportDefinition
  } | null>(null)
  const [feedback, setFeedback] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  function refreshState() {
    try {
      const nextState = loadMockReviewState()
      setState(nextState)
      setLoadError('')
      return nextState
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Mock mapping data could not be loaded.',
      )
      return null
    }
  }

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      refreshState()
      setIsLoading(false)
    }, 0)
    const unsubscribe = subscribeToMockReviewState(() => {
      refreshState()
    })
    return () => {
      window.clearTimeout(initialLoad)
      unsubscribe()
    }
  }, [])

  const latestProposals = useMemo(
    () => getLatestMappingProposals(state.proposals),
    [state.proposals],
  )
  const pendingProposals = latestProposals.filter(
    (proposal) => proposal.status === 'pending',
  )
  const historyProposals = state.proposals
    .filter((proposal) => proposal.status !== 'pending')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const visibleProposals =
    activeTab === 'pending' ? pendingProposals : historyProposals
  const selectedProposal =
    visibleProposals.find((proposal) => proposalKey(proposal) === selectedKey) ??
    visibleProposals[0] ??
    null
  const selectedProposalKey = selectedProposal ? proposalKey(selectedProposal) : ''
  const editedDefinition =
    selectedProposal && editedProposal?.key === selectedProposalKey
      ? editedProposal.definition
      : selectedProposal?.definition ?? null
  const latestSelected = selectedProposal
    ? latestProposals.find(
        (proposal) => proposal.mappingId === selectedProposal.mappingId,
      )
    : null
  const editable =
    selectedProposal !== null &&
    latestSelected?.revision === selectedProposal.revision &&
    (selectedProposal.status === 'pending' ||
      selectedProposal.status === 'changes_requested' ||
      selectedProposal.status === 'approved')
  const dirty =
    selectedProposal !== null &&
    editedDefinition !== null &&
    JSON.stringify(editedDefinition) !== JSON.stringify(selectedProposal.definition)
  const focusedView = editedDefinition?.views.find(
    (view) => view.id === selectedViewId,
  )
  const focusedFieldIds = focusedView ? fieldsForView(focusedView) : []
  const focusedLineage = editedDefinition?.fieldLineage.filter((lineage) =>
    focusedFieldIds.includes(lineage.outputFieldId),
  ) ?? []
  const focusedSources = editedDefinition
    ? [
        ...new Set(
          focusedLineage.flatMap((lineage) =>
            lineage.sourceColumnIds.flatMap((columnId) => {
              const name = sourceColumnLabel(editedDefinition, columnId)
              return name ? [name] : []
            }),
          ),
        ),
      ]
    : []
  const focusedTransformations = editedDefinition
    ? [
        ...new Set(
          focusedLineage.flatMap((lineage) =>
            lineage.transformationIds.flatMap((transformationId) => {
              const transformation = editedDefinition.transformations.find(
                (item) => item.id === transformationId,
              )
              return transformation ? [transformation.name] : []
            }),
          ),
        ),
      ]
    : []
  const focusedFilters = editedDefinition
    ? editedDefinition.filters.map((filter) => {
        const source = sourceColumnLabel(editedDefinition, filter.sourceColumnId)
        const operator = { gte: '≥', lt: '<', eq: '=' }[filter.operator]
        return `${source ?? 'Unknown source field'} ${operator} :${filter.parameter} (mock ${filter.mockValue})`
      })
    : []
  const focusedOutputs = editedDefinition
    ? editedDefinition.outputFields
        .filter((field) => focusedFieldIds.includes(field.id))
        .map((field) => field.label)
    : []

  function updateEditedDefinition(definition: ReportDefinition) {
    if (selectedProposal) {
      setEditedProposal({ key: selectedProposalKey, definition })
    }
  }

  function selectTab(tab: ReviewTab) {
    setActiveTab(tab)
    setSelectedKey(null)
    setSelectedViewId(null)
    setActionError('')
    setNotice('')
    setFeedback('')
  }

  function refresh() {
    setIsRefreshing(true)
    refreshState()
    setIsRefreshing(false)
  }

  function saveRevision() {
    if (!selectedProposal || !editedDefinition || !editable || !dirty) return
    setActionError('')
    setNotice('')
    try {
      const saved = saveMappingRevision(
        selectedProposal.mappingId,
        selectedProposal.revision,
        editedDefinition,
      )
      const nextState = loadMockReviewState()
      setState(nextState)
      setActiveTab('pending')
      setSelectedKey(proposalKey(saved))
      setSelectedViewId(null)
      setEditedProposal({
        key: proposalKey(saved),
        definition: cloneDefinition(saved.definition),
      })
      setFeedback('')
      setNotice(`Revision ${saved.revision} saved as a new pending definition.`)
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'The mapping revision could not be saved.',
      )
      refreshState()
    }
  }

  function submitDecision(decision: 'approved' | 'changes_requested') {
    if (!selectedProposal || !editable || dirty) return
    if (decision === 'changes_requested' && !feedback.trim()) {
      setActionError('Add actionable feedback about the mapping before requesting changes.')
      return
    }
    setActionError('')
    setNotice('')
    try {
      const updated = decideMappingProposal(
        selectedProposal.mappingId,
        selectedProposal.revision,
        decision,
        feedback,
      )
      setState(loadMockReviewState())
      setActiveTab('history')
      setSelectedKey(proposalKey(updated))
      setFeedback('')
      setNotice(
        decision === 'approved'
          ? `Definition revision ${updated.revision} approved and published for mock requests.`
          : `Changes requested for definition revision ${updated.revision}.`,
      )
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'The mapping review action failed.',
      )
      refreshState()
    }
  }

  function resetDemo() {
    resetMockReviewState()
    setSelectedKey(null)
    setActiveTab('pending')
    setEditedProposal(null)
    setFeedback('')
    setActionError('')
    setNotice('Mock review data reset.')
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
            <span className="breadcrumb-current">Definition review</span>
          </nav>
        </div>
      </header>

      <section className="review-page mapping-review-page" aria-labelledby="review-title">
        <div className="review-heading">
          <div>
            <p className="review-eyebrow">GenLedge · D2 data engineer workspace</p>
            <h1 id="review-title">Report definition review</h1>
            <p className="review-subtitle">
              Review source mappings and report structure—not narrative or financial
              results.
            </p>
          </div>
          <div className="review-heading-actions">
            <span className="review-demo-label review-mode-mock">
              <span aria-hidden="true" />
              MOCK · browser-local data
            </span>
            <button
              className="review-button review-button-secondary"
              disabled={isLoading || isRefreshing}
              onClick={refresh}
              type="button"
            >
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
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
          This screen reviews reusable mapping definitions. No warehouse schema was
          discovered, no SQL was run, and no report figures are being approved.
        </aside>

        {isLoading ? (
          <div className="review-state" role="status">Loading mock mapping proposals…</div>
        ) : loadError ? (
          <div className="review-state review-state-error" role="alert">
            <p>{loadError}</p>
            <button className="review-button review-button-secondary" onClick={refresh} type="button">
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="review-tabs" role="tablist" aria-label="Mapping proposal status">
              <button
                aria-selected={activeTab === 'pending'}
                className={`review-tab${activeTab === 'pending' ? ' is-active' : ''}`}
                onClick={() => selectTab('pending')}
                role="tab"
                type="button"
              >
                Pending <span>{pendingProposals.length}</span>
              </button>
              <button
                aria-selected={activeTab === 'history'}
                className={`review-tab${activeTab === 'history' ? ' is-active' : ''}`}
                onClick={() => selectTab('history')}
                role="tab"
                type="button"
              >
                Review history <span>{historyProposals.length}</span>
              </button>
            </div>

            {visibleProposals.length === 0 ? (
              <div className="review-state">
                <span className="review-empty-icon" aria-hidden="true">
                  {activeTab === 'pending' ? '↗' : '✓'}
                </span>
                <h2>
                  {activeTab === 'pending'
                    ? 'No definitions awaiting review'
                    : 'No mapping history yet'}
                </h2>
                <p>
                  {activeTab === 'pending'
                    ? 'Submit a mock definition request from the business workspace to start the flow.'
                    : 'Approved, changed, and superseded definition revisions will be retained here.'}
                </p>
                {activeTab === 'pending' && (
                  <p>Submit a request from the separate business-user screen to start the workflow.</p>
                )}
              </div>
            ) : (
              <div className="review-layout mapping-review-layout">
                <aside className="review-queue" aria-label="Mapping proposals">
                  <div className="review-queue-heading">
                    <h2>{activeTab === 'pending' ? 'Pending queue' : 'Revision history'}</h2>
                    <span>{visibleProposals.length}</span>
                  </div>
                  <ul>
                    {visibleProposals.map((proposal) => (
                      <li key={proposalKey(proposal)}>
                        <button
                          aria-current={
                            proposalKey(proposal) === selectedProposalKey
                              ? 'true'
                              : undefined
                          }
                          className={`review-draft-option${proposalKey(proposal) === selectedProposalKey ? ' is-selected' : ''}`}
                          onClick={() => {
                            setSelectedKey(proposalKey(proposal))
                            setSelectedViewId(null)
                            setEditedProposal({
                              key: proposalKey(proposal),
                              definition: cloneDefinition(proposal.definition),
                            })
                            setFeedback('')
                            setActionError('')
                            setNotice('')
                          }}
                          type="button"
                        >
                          <span className="review-draft-option-top">
                            <span>{proposal.definition.title}</span>
                            <span className={`mapping-status mapping-status-${proposal.status}`}>
                              {statusLabel(proposal.status)}
                            </span>
                          </span>
                          <span className="review-draft-option-meta">
                            Revision {proposal.revision} · {formatDate(proposal.updatedAt)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </aside>

                {selectedProposal && editedDefinition && (
                  <article className="review-detail mapping-review-detail">
                    <header className="review-detail-header">
                      <div>
                        <div className="review-detail-kicker">
                          <span>Definition {selectedProposal.mappingId.slice(0, 13)}</span>
                          <span aria-hidden="true">·</span>
                          <span>Revision {selectedProposal.revision}</span>
                        </div>
                        <h2>{selectedProposal.definition.title}</h2>
                      </div>
                      <span className={`mapping-status mapping-status-${selectedProposal.status}`}>
                        {statusLabel(selectedProposal.status)}
                      </span>
                    </header>

                    <ReportDefinitionPreview
                      definition={editedDefinition}
                      onSelectView={setSelectedViewId}
                      selectedViewId={selectedViewId}
                    />
                    {focusedView && (
                      <section className="review-lineage-focus" aria-labelledby="review-lineage-focus-title">
                        <div>
                          <p className="review-eyebrow">Selected component trace</p>
                          <h3 id="review-lineage-focus-title">{focusedView.title}</h3>
                          <p>
                            Illustrative agent path: {focusedSources.join(', ') || 'No source fields mapped'}{' '}
                            → Filters: {focusedFilters.join('; ') || 'none listed'} →{' '}
                            {focusedTransformations.join('; ') || 'No transformation listed'} →{' '}
                            {focusedOutputs.join(', ') || 'No output fields bound'} → {focusedView.title}.
                          </p>
                        </div>
                        <MappingLineageCanvas
                          definition={editedDefinition}
                          focusedViewId={focusedView.id}
                        />
                      </section>
                    )}

                    <section className="mapping-request-summary">
                      <p className="review-eyebrow">Business request</p>
                      <p>{selectedProposal.requestText}</p>
                      {selectedProposal.clarificationText && (
                        <p>Business clarification: {selectedProposal.clarificationText}</p>
                      )}
                      <span>
                        Submitted {formatDate(selectedProposal.createdAt)} · Mock proposal
                      </span>
                    </section>

                    <MappingDefinitionEditor
                      definition={editedDefinition}
                      editable={editable}
                      onChange={updateEditedDefinition}
                    />

                    {selectedProposal.status === 'changes_requested' &&
                      selectedProposal.reviewHistory
                        .filter(
                          (event) =>
                            event.action === 'changes_requested' &&
                            event.revision === selectedProposal.revision,
                        )
                        .map((event) => (
                          <section className="mapping-feedback-callout" key={event.id}>
                            <strong>Actionable mapping feedback</strong>
                            <p>{event.feedback}</p>
                          </section>
                        ))}

                    {selectedProposal.status === 'approved' && editable && (
                      <p className="mapping-unsaved-note">
                        Editing an approved definition and saving a revision will
                        withdraw the older approval until the new revision is reviewed.
                      </p>
                    )}

                    {selectedProposal.reviewHistory.length > 0 && (
                      <details className="mapping-history">
                        <summary>Review history ({selectedProposal.reviewHistory.length})</summary>
                        <ol>
                          {selectedProposal.reviewHistory.map((event) => (
                            <li key={event.id}>
                              <span className="mapping-history-marker" aria-hidden="true" />
                              <div>
                                <strong>
                                  Revision {event.revision} · {statusLabel(event.action)}
                                </strong>
                                <p>{event.summary}</p>
                                {event.feedback && <p className="mapping-history-feedback">{event.feedback}</p>}
                                <time dateTime={event.createdAt}>
                                  {event.actor} · {formatDate(event.createdAt)}
                                </time>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </details>
                    )}

                    {editable && (
                      <section className="mapping-decision-panel" aria-labelledby="mapping-decision-title">
                        <div>
                          <p className="review-eyebrow">Data engineer decision</p>
                          <h3 id="mapping-decision-title">Review the definition structure</h3>
                          <p>
                            Approve the reusable mapping, or request specific changes
                            to its sources, lineage, filters, transformations, or layout.
                          </p>
                        </div>
                        {selectedProposal.status === 'pending' && (
                          <label className="mapping-form-field" htmlFor="mapping-feedback">
                            <span>Actionable feedback · required to request changes</span>
                            <textarea
                              id="mapping-feedback"
                              maxLength={2000}
                              onChange={(event) => setFeedback(event.target.value)}
                              placeholder="For example: map the reporting date from approved_at rather than created_at."
                              value={feedback}
                            />
                          </label>
                        )}
                        {dirty && (
                          <p className="mapping-unsaved-note">
                            Unsaved edits change the preview. Save them as a new revision
                            before approving or requesting changes.
                          </p>
                        )}
                        {actionError && <p className="review-feedback-message review-feedback-error" role="alert">{actionError}</p>}
                        <div className="mapping-decision-actions">
                          {dirty && (
                            <button
                              className="review-button review-button-approve"
                              onClick={saveRevision}
                              type="button"
                            >
                              Save as new revision
                            </button>
                          )}
                          {!dirty && selectedProposal.status === 'pending' && (
                            <>
                              <button
                                className="review-button review-button-reject"
                                onClick={() => submitDecision('changes_requested')}
                                type="button"
                              >
                                Request changes
                              </button>
                              <button
                                className="review-button review-button-approve"
                                onClick={() => submitDecision('approved')}
                                type="button"
                              >
                                Approve definition
                              </button>
                            </>
                          )}
                          {selectedProposal.status === 'changes_requested' && !dirty && (
                            <p className="mapping-unsaved-note">
                              Edit the structured fields above and save a corrected revision.
                            </p>
                          )}
                        </div>
                      </section>
                    )}

                    {notice && (
                      <p className="review-feedback-message review-feedback-success" role="status">
                        {notice}
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
