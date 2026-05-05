type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } }

interface McpToolResult {
  content: ContentBlock[]
  isError?: boolean
}

export const createSuccessResponse = (data: unknown): McpToolResult => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(data, null, 2),
    },
  ],
})

export const createErrorResponse = (error: unknown, message: string): McpToolResult => {
  const detail =
    error !== null && typeof error === 'object' && 'response' in error
      ? (error as { response?: { data?: unknown } }).response?.data
      : error instanceof Error
        ? error.message
        : String(error)

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: message, detail }, null, 2),
      },
    ],
    isError: true,
  }
}

export const createBlobResponse = (
  data: Buffer | string,
  mimeType: string,
  uri: string,
): McpToolResult => ({
  content: [
    {
      type: 'resource',
      resource: {
        uri,
        mimeType,
        blob: Buffer.isBuffer(data) ? data.toString('base64') : data,
      },
    },
  ],
})
