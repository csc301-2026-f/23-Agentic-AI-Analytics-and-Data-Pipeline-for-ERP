import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatRequestError, sendChatMessage } from './chat'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const clarificationReply = {
  conversationId: 'conv_1',
  messageId: 'msg_1',
  status: 'clarification_needed',
  response: 'Which time period should this analysis cover?',
  chart: null,
  clarification: {
    question: 'Which time period should this analysis cover?',
    options: [{ label: 'Year to date', value: 'Year to date' }],
  },
}

function requestBody() {
  const [, init] = vi.mocked(fetch).mock.calls[0]
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

async function captureError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected the request to fail.')
}

describe('chat service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('omits conversationId when starting a new conversation', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ conversationId: 'conv_1', messageId: 'msg_1', response: 'Hi' }),
    )

    const reply = await sendChatMessage('Cash flow', null, new AbortController().signal)

    expect(requestBody()).toEqual({ message: 'Cash flow' })
    expect(reply).toEqual({
      conversationId: 'conv_1',
      messageId: 'msg_1',
      response: 'Hi',
      chart: undefined,
    })
  })

  it('sends the conversationId with clarification answers', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ conversationId: 'conv_1', messageId: 'msg_2', response: 'Done' }),
    )

    await sendChatMessage('Year to date', 'conv_1', new AbortController().signal)

    expect(requestBody()).toEqual({ conversationId: 'conv_1', message: 'Year to date' })
  })

  it('parses clarification replies', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(clarificationReply))

    const reply = await sendChatMessage('Cash flow', null, new AbortController().signal)

    expect(reply.status).toBe('clarification_needed')
    expect(reply.clarification).toEqual(clarificationReply.clarification)
  })

  it('defaults missing clarification options to an empty list', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ...clarificationReply,
        clarification: { question: 'Which metric do you mean?' },
      }),
    )

    const reply = await sendChatMessage('Cash flow', null, new AbortController().signal)

    expect(reply.clarification).toEqual({ question: 'Which metric do you mean?', options: [] })
  })

  it('rejects clarification replies without a question', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ ...clarificationReply, clarification: { options: [] } }),
    )

    const error = await captureError(
      sendChatMessage('Cash flow', null, new AbortController().signal),
    )

    expect(error).toBeInstanceOf(ChatRequestError)
    expect((error as ChatRequestError).kind).toBe('invalid')
  })

  it('rejects unknown statuses', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...clarificationReply, status: 'odd' }))

    const error = await captureError(
      sendChatMessage('Cash flow', null, new AbortController().signal),
    )

    expect((error as ChatRequestError).kind).toBe('invalid')
  })

  it('reports a missing conversation as not retryable', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ detail: 'Not found' }, 404))

    const error = await captureError(
      sendChatMessage('Year to date', 'conv_gone', new AbortController().signal),
    )

    expect((error as ChatRequestError).kind).toBe('conversation_missing')
    expect((error as ChatRequestError).retryable).toBe(false)
  })

  it('reports server and network failures as retryable', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 500))
    const serverError = await captureError(
      sendChatMessage('Cash flow', null, new AbortController().signal),
    )
    expect((serverError as ChatRequestError).kind).toBe('server')
    expect((serverError as ChatRequestError).retryable).toBe(true)

    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('fetch failed'))
    const networkError = await captureError(
      sendChatMessage('Cash flow', null, new AbortController().signal),
    )
    expect((networkError as ChatRequestError).kind).toBe('network')
    expect((networkError as ChatRequestError).retryable).toBe(true)
  })
})
