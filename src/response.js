/**
 * @file src/response.js
 * @description MCP 規範回應格式工具函數
 *
 * MCP spec: CallToolResult = { content: ContentBlock[], isError?: boolean }
 * - 成功：isError 省略（預設 false）
 * - 失敗：isError: true，讓 client 能分辨工具錯誤與成功回應
 */

/**
 * 建立成功的 MCP 工具回應
 * @param {*} data - 回傳的資料（會序列化為 JSON）
 * @returns {Object} MCP CallToolResult
 */
const createSuccessResponse = (data) => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify(data, null, 2),
    },
  ],
});

/**
 * 建立失敗的 MCP 工具回應
 * MCP 規範要求錯誤回應必須包含 isError: true
 * @param {Error|Object} error - 錯誤物件
 * @param {string} message - 錯誤描述
 * @returns {Object} MCP CallToolResult with isError: true
 */
const createErrorResponse = (error, message) => {
  const detail = error?.response?.data ?? error?.message ?? String(error);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ error: message, detail }, null, 2),
      },
    ],
    isError: true,
  };
};

/**
 * 建立二進位資源的 MCP 工具回應
 * MCP spec: resource content type 用於傳遞二進位資料（blob）
 * @param {Buffer|string} data - 原始二進位資料
 * @param {string} mimeType - MIME type（如 'application/octet-stream'）
 * @param {string} uri - 資源識別 URI
 * @returns {Object} MCP CallToolResult with resource content type
 */
const createBlobResponse = (data, mimeType, uri) => ({
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
});

module.exports = { createSuccessResponse, createErrorResponse, createBlobResponse };
