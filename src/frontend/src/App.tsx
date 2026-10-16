'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ChartRenderer, type AnalyticsChartSpec } from './components/charts'
import { ChatRequestError, sendChatMessage, type Clarification } from './services/chat'

type Message = {
  id: number
  role: 'assistant' | 'user'
  content: string
  chart?: AnalyticsChartSpec
  clarification?: Clarification
  undelivered?: boolean
}

type FailedRequest = {
  content: string
  userMessageId: number
  message: string
  retryable: boolean
}

const welcomeMessage: Message = {
  id: 0,
  role: 'assistant',
  content:
    "Hi! Ask me about your finances, like cash flow or revenue, and I'll help prepare an analysis.",
}

function App() {
  const [messages, setMessages] = useState<Message[]>([welcomeMessage])
  const [draft, setDraft] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [failedRequest, setFailedRequest] = useState<FailedRequest | null>(null)
  const nextMessageId = useRef(1)
  const conversationId = useRef<string | null>(null)
  const conversationEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestController = useRef<AbortController | null>(null)

  const lastMessage = messages[messages.length - 1]
  const openClarificationId =
    lastMessage.role === 'assistant' && lastMessage.clarification ? lastMessage.id : null

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking, failedRequest])

  function startNewAnalysis() {
    requestController.current?.abort()
    requestController.current = null
    conversationId.current = null
    setMessages([welcomeMessage])
    setDraft('')
    setIsThinking(false)
    setFailedRequest(null)
    nextMessageId.current = 1
    inputRef.current?.focus()
  }

  async function submitContent(content: string, retryMessageId?: number) {
    if (!content || isThinking) return

    const controller = new AbortController()
    requestController.current = controller
    const userMessageId = retryMessageId ?? nextMessageId.current++
    setMessages((currentMessages) =>
      retryMessageId === undefined
        ? [...currentMessages, { id: userMessageId, role: 'user', content }]
        : currentMessages.map((message) =>
            message.id === retryMessageId ? { ...message, undelivered: false } : message,
          ),
    )
    setFailedRequest(null)
    setIsThinking(true)

    try {
      const result = await sendChatMessage(content, conversationId.current, controller.signal)
      if (controller.signal.aborted) return

      conversationId.current = result.conversationId
      const replyId = nextMessageId.current++
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: replyId,
          role: 'assistant',
          content: result.response,
          chart: result.chart ?? undefined,
          clarification: result.clarification,
        },
      ])
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === userMessageId ? { ...message, undelivered: true } : message,
          ),
        )
        setFailedRequest({
          content,
          userMessageId,
          message:
            error instanceof Error
              ? error.message
              : 'The assistant request failed. Try again, or edit your request.',
          retryable: !(error instanceof ChatRequestError) || error.retryable,
        })
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null
        setIsThinking(false)
      }
    }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || isThinking) return
    setDraft('')
    void submitContent(content)
  }

  function retryFailedRequest() {
    if (!failedRequest) return
    void submitContent(failedRequest.content, failedRequest.userMessageId)
  }

  function editFailedRequest() {
    if (!failedRequest) return
    setMessages((currentMessages) =>
      currentMessages.filter((message) => message.id !== failedRequest.userMessageId),
    )
    setDraft(failedRequest.content)
    setFailedRequest(null)
    inputRef.current?.focus()
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/" aria-label="GenLedge home">
            gen<span>ledge</span>
            <span className="brand-mark" aria-hidden="true">
              ↗
            </span>
          </Link>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span>Workspace</span>
            <span className="breadcrumb-chevron" aria-hidden="true">
              ›
            </span>
            <span className="breadcrumb-current">Analytics</span>
            <span className="breadcrumb-chevron" aria-hidden="true">
              ›
            </span>
            <Link href="/demo">Business demo</Link>
            <span className="breadcrumb-chevron" aria-hidden="true">
              ›
            </span>
            <Link href="/review">Review</Link>
          </nav>
        </div>
      </header>

      <section className="chat-app" aria-label="Analytics assistant">
        <div className="chat-heading">
          <h1>Analytics Assistant</h1>
          <button className="new-analysis-button" onClick={startNewAnalysis}>
            <span aria-hidden="true">+</span>
            New analysis
          </button>
        </div>

        <section className="conversation" aria-label="Current conversation">
          <div className="conversation-inner">
            <div className="date-divider">
              <span>Today</span>
            </div>

            <div className="message-list" aria-live="polite">
              {messages.map((message) => (
                <article
                  className={`message message-${message.role}`}
                  key={message.id}
                >
                  {message.role === 'assistant' && (
                    <div className="assistant-label">
                      <span className="status-dot" aria-hidden="true" />
                      GenLedge Assistant
                    </div>
                  )}
                  {message.clarification && (
                    <span className="clarification-tag">Needs clarification</span>
                  )}
                  <p>{message.content}</p>
                  {message.chart && <ChartRenderer spec={message.chart} />}
                  {message.clarification &&
                    message.clarification.options.length > 0 && (
                      <div
                        aria-label="Suggested answers"
                        className="clarification-options"
                        role="group"
                      >
                        {message.clarification.options.map((option) => (
                          <button
                            className="clarification-option"
                            disabled={
                              message.id !== openClarificationId ||
                              isThinking ||
                              failedRequest !== null
                            }
                            key={option.value}
                            onClick={() => void submitContent(option.value)}
                            type="button"
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  {message.undelivered && (
                    <span className="message-undelivered">Not delivered</span>
                  )}
                </article>
              ))}
              {isThinking && (
                <div className="thinking-indicator" role="status">
                  <span className="status-dot" aria-hidden="true" />
                  <span>GenLedge Assistant is thinking</span>
                  <span className="thinking-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              )}
              {failedRequest && !isThinking && (
                <div className="request-error" role="alert">
                  <p>{failedRequest.message}</p>
                  <div className="request-error-actions">
                    {failedRequest.retryable ? (
                      <>
                        <button onClick={retryFailedRequest} type="button">
                          Retry
                        </button>
                        <button onClick={editFailedRequest} type="button">
                          Edit request
                        </button>
                      </>
                    ) : (
                      <button onClick={startNewAnalysis} type="button">
                        Start new analysis
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div ref={conversationEndRef} />
            </div>
          </div>
        </section>

        <footer className="composer-area">
          <form className="composer" onSubmit={sendMessage}>
            <label className="visually-hidden" htmlFor="message-input">
              Message the analytics assistant
            </label>
            <input
              autoComplete="off"
              id="message-input"
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                openClarificationId === null
                  ? 'Ask about cash flow, revenue, or an analysis...'
                  : 'Answer the question above, or type your own...'
              }
              ref={inputRef}
              value={draft}
            />
            <button
              aria-label="Send message"
              className="send-button"
              disabled={!draft.trim() || isThinking}
              type="submit"
            >
              <span>Send</span>
              <span className="send-arrow" aria-hidden="true">
                ↑
              </span>
            </button>
          </form>
          {openClarificationId !== null && (
            <p className="composer-hint">
              Your answer continues the current request. Use New analysis to start over.
            </p>
          )}
        </footer>
      </section>
    </main>
  )
}

export default App
