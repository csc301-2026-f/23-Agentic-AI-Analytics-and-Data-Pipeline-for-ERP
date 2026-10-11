'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ChartRenderer, type AnalyticsChartSpec } from './components/charts'
import { sendChatMessage } from './services/chat'

type Message = {
  id: number
  role: 'assistant' | 'user'
  content: string
  chart?: AnalyticsChartSpec
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
  const [requestError, setRequestError] = useState('')
  const nextMessageId = useRef(1)
  const conversationEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const requestController = useRef<AbortController | null>(null)

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  function startNewAnalysis() {
    requestController.current?.abort()
    requestController.current = null
    setMessages([welcomeMessage])
    setDraft('')
    setIsThinking(false)
    setRequestError('')
    nextMessageId.current = 1
    inputRef.current?.focus()
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || isThinking) return

    const controller = new AbortController()
    requestController.current = controller
    const messageId = nextMessageId.current++
    setMessages((currentMessages) => [
      ...currentMessages,
      { id: messageId, role: 'user', content },
    ])
    setDraft('')
    setRequestError('')
    setIsThinking(true)

    try {
      const result = await sendChatMessage(content, controller.signal)
      if (controller.signal.aborted) return

      const replyId = nextMessageId.current++
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: replyId,
          role: 'assistant',
          content: result.response,
          chart: result.chart ?? undefined,
        },
      ])
    } catch (error) {
      if (!controller.signal.aborted) {
        setRequestError(
          error instanceof Error
            ? error.message
            : 'The assistant request failed. Please try again.',
        )
      }
    } finally {
      if (requestController.current === controller) {
        requestController.current = null
        setIsThinking(false)
      }
    }
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
                  <p>{message.content}</p>
                  {message.chart && <ChartRenderer spec={message.chart} />}
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
              {requestError && (
                <p className="request-error" role="alert">
                  {requestError}
                </p>
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
              placeholder="Ask about cash flow, revenue, or an analysis..."
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
        </footer>
      </section>
    </main>
  )
}

export default App
