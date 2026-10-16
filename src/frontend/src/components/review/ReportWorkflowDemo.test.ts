import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ReviewWorkspace from './ReviewWorkspace'
import ReportWorkflowDemo from './ReportWorkflowDemo'

describe('report workflow walkthrough UI', () => {
  it('renders the separate five-step business workflow with mock labeling', () => {
    const markup = renderToStaticMarkup(createElement(ReportWorkflowDemo))

    expect(markup).toContain('Report workflow')
    expect(markup).toContain('Prototype · simulated data')
    expect(markup).toContain('Request a report')
    expect(markup).toContain('Clarify the need')
    expect(markup).toContain('Await review')
    expect(markup).toContain('Report ready')
    expect(markup).toContain('View results')
    expect(markup).toContain('Step 1 of 5')
    expect(markup).not.toContain('Review &amp; revise')
    expect(markup).not.toContain('Switch to engineer')
    expect(markup).not.toContain('Back to business user')
    expect(markup).not.toContain('href="/review"')
  })

  it('keeps the reviewer page free of business-user route links', () => {
    const markup = renderToStaticMarkup(createElement(ReviewWorkspace))

    expect(markup).toContain('Report definition review')
    expect(markup).not.toContain('href="/demo"')
    expect(markup).not.toContain('Open business workspace')
  })
})
