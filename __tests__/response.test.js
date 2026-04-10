/**
 * @file __tests__/response.test.js
 * @description MCP 回應格式測試 — 驗證符合 MCP 規範
 */

const { createSuccessResponse, createErrorResponse } = require('../src/response');

describe('MCP 回應格式', () => {
  describe('createSuccessResponse', () => {
    test('回傳單一 text content 項目', () => {
      const data = { id: '1', name: 'test' };
      const result = createSuccessResponse(data);

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    test('content text 是純 JSON 字串（無混合 message 前綴）', () => {
      const data = { token: 'abc123', expires: 3600 };
      const result = createSuccessResponse(data);

      // 不應有 "成功\n\n{" 的混合格式
      expect(result.content[0].text).not.toMatch(/^[^{]/);
      // 應可直接 JSON.parse
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    });

    test('JSON 包含完整資料', () => {
      const data = { items: [1, 2, 3], total: 3 };
      const result = createSuccessResponse(data);
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed).toEqual(data);
    });

    test('不含 isError 欄位（成功時）', () => {
      const result = createSuccessResponse({});
      expect(result.isError).toBeUndefined();
    });
  });

  describe('createErrorResponse — MCP 規範 isError: true', () => {
    test('必須包含 isError: true', () => {
      const error = new Error('API 失敗');
      const result = createErrorResponse(error, '執行工具時發生錯誤');

      // MCP 規範：工具錯誤回應必須設 isError: true
      expect(result.isError).toBe(true);
    });

    test('回傳單一 text content 項目', () => {
      const error = new Error('timeout');
      const result = createErrorResponse(error, '連線逾時');

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');
    });

    test('content 包含錯誤訊息', () => {
      const error = new Error('not found');
      const result = createErrorResponse(error, '資源不存在');

      expect(result.content[0].text).toContain('資源不存在');
    });

    test('HTTP error response 詳情被包含', () => {
      const error = { response: { data: { code: 401, message: 'Unauthorized' } } };
      const result = createErrorResponse(error, '認證失敗');

      expect(result.content[0].text).toContain('Unauthorized');
    });
  });

  describe('未知工具錯誤', () => {
    test('未知工具應回傳 isError: true', () => {
      const error = new Error('未知的工具: nonexistent_tool');
      const result = createErrorResponse(error, '未知的工具: nonexistent_tool');

      expect(result.isError).toBe(true);
    });
  });
});
