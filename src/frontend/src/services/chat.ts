import type { AnalyticsChartSpec } from '../components/charts'

export type ClarificationOption = {
  label: string
  value: string
}

export type Clarification = {
  question: string
  options: ClarificationOption[]
}

export type ChatReply = {
  conversationId: string
  messageId: string
  status?: 'clarification_needed'
  response: string
  chart?: AnalyticsChartSpec | null
  clarification?: Clarification
}

export type ChatErrorKind = 'network' | 'conversation_missing' | 'server' | 'invalid'

export class ChatRequestError extends Error {
  readonly kind: ChatErrorKind

  constructor(kind: ChatErrorKind, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ChatRequestError'
    this.kind = kind
  }

  get retryable(): boolean {
    return this.kind !== 'conversation_missing'
  }
}

function isLineChartSpec(value: Record<string, unknown>): boolean {
  return value.type === 'line' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'xAxisName' in value &&
    typeof value.xAxisName === 'string' &&
    'yAxisName' in value &&
    typeof value.yAxisName === 'string' &&
    'seriesNames' in value &&
    Array.isArray(value.seriesNames) &&
    value.seriesNames.every((name) => typeof name === 'string') &&
    'data' in value &&
    Array.isArray(value.data) &&
    value.data.every(
      (series) =>
        Array.isArray(series) &&
        series.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            (typeof point[0] === 'number' || typeof point[0] === 'string') &&
            typeof point[1] === 'number',
        ),
    )
}

function isBarChartSpec(value: Record<string, unknown>): boolean {
  return value.type === 'bar' &&
    typeof value.title === 'string' &&
    typeof value.xAxisName === 'string' &&
    typeof value.yAxisName === 'string' &&
    Array.isArray(value.data) &&
    value.data.every(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        !Array.isArray(row) &&
        'category' in row &&
        typeof row.category === 'string' &&
        Object.entries(row).every(
          ([key, item]) =>
            key === 'category' || typeof item === 'number' || typeof item === 'string',
        ),
    )
}

function isPieChartSpec(value: Record<string, unknown>): boolean {
  return value.type === 'pie' &&
    typeof value.title === 'string' &&
    Array.isArray(value.data) &&
    value.data.every(
      (slice) =>
        typeof slice === 'object' &&
        slice !== null &&
        'label' in slice &&
        typeof slice.label === 'string' &&
        'value' in slice &&
        typeof slice.value === 'number' &&
        (!('color' in slice) || typeof slice.color === 'string' || slice.color === null),
    )
}

function isAnalyticsChartSpec(value: unknown): value is AnalyticsChartSpec {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false
  }

  const chart = value as Record<string, unknown>
  return isLineChartSpec(chart) || isBarChartSpec(chart) || isPieChartSpec(chart)
}

function isClarification(value: unknown): value is Clarification {
  if (typeof value !== 'object' || value === null) return false
  const clarification = value as Record<string, unknown>
  return typeof clarification.question === 'string' &&
    clarification.question.trim() !== '' &&
    (clarification.options === undefined ||
      (Array.isArray(clarification.options) &&
        clarification.options.every(
          (option) =>
            typeof option === 'object' &&
            option !== null &&
            typeof option.label === 'string' &&
            typeof option.value === 'string',
        )))
}

function invalidResponse(message = 'The assistant returned an invalid response. Please try again.') {
  return new ChatRequestError('invalid', message)
}

export async function sendChatMessage(
  message: string,
  conversationId: string | null,
  signal: AbortSignal,
): Promise<ChatReply> {
  let response: Response
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conversationId ? { conversationId, message } : { message }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof TypeError) {
      throw new ChatRequestError(
        'network',
        'Could not reach the backend. Start it from the repository root with "uvicorn src.backend.app:app --reload", then try again.',
        { cause: error },
      )
    }
    throw error
  }

  if (response.status === 404) {
    throw new ChatRequestError(
      'conversation_missing',
      'This conversation is no longer available. Start a new analysis to continue.',
    )
  }

  if (!response.ok) {
    throw new ChatRequestError(
      'server',
      `The assistant request failed (${response.status}). Try again, or edit your request.`,
    )
  }

  let result: unknown
  try {
    result = await response.json()
  } catch (error) {
    if (signal.aborted) throw error
    throw invalidResponse()
  }
  if (
    typeof result !== 'object' ||
    result === null ||
    !('response' in result) ||
    typeof result.response !== 'string' ||
    !('conversationId' in result) ||
    typeof result.conversationId !== 'string' ||
    !('messageId' in result) ||
    typeof result.messageId !== 'string'
  ) {
    throw invalidResponse()
  }

  if (
    'chart' in result &&
    result.chart !== null &&
    result.chart !== undefined &&
    !isAnalyticsChartSpec(result.chart)
  ) {
    throw invalidResponse('The assistant returned an invalid chart. Please try again.')
  }

  const status = 'status' in result ? result.status : undefined
  if (status !== undefined && status !== null && status !== 'clarification_needed') {
    throw invalidResponse()
  }

  const reply: ChatReply = {
    conversationId: result.conversationId,
    messageId: result.messageId,
    response: result.response,
    chart: 'chart' in result && isAnalyticsChartSpec(result.chart) ? result.chart : undefined,
  }

  if (status === 'clarification_needed') {
    const clarification = 'clarification' in result ? result.clarification : undefined
    if (!isClarification(clarification)) throw invalidResponse()
    reply.status = 'clarification_needed'
    reply.clarification = {
      question: clarification.question,
      options: clarification.options ?? [],
    }
  }

  return reply
}
