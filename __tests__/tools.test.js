/**
 * @file __tests__/tools.test.js
 * @description 工具模組完整測試覆蓋
 */

const axios = require('axios');
const { TOOLS_CONFIG, TOOL_HANDLERS } = require('../src/tools');

// Mock axios
jest.mock('axios');
const mockedAxios = axios;

describe('Tools 模組測試', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JUDICIAL_USER = 'test_user';
    process.env.JUDICIAL_PASSWORD = 'test_password';
  });

  afterEach(() => {
    delete process.env.JUDICIAL_USER;
    delete process.env.JUDICIAL_PASSWORD;
  });

  describe('TOOL_HANDLERS.auth_token', () => {
    test('成功取得授權 Token — 回傳 API 原始資料', async () => {
      const mockResponse = { data: { token: 'test_token_123' } };
      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await TOOL_HANDLERS.auth_token({});

      expect(result).toEqual(mockResponse.data);
    });

    test('缺少帳號密碼時拋出錯誤', async () => {
      delete process.env.JUDICIAL_USER;
      delete process.env.JUDICIAL_PASSWORD;

      await expect(TOOL_HANDLERS.auth_token({}))
        .rejects.toThrow('未提供使用者帳號或密碼');
    });

    test('API 請求失敗時拋出錯誤', async () => {
      const mockError = {
        response: { data: { message: 'Invalid credentials' } }
      };
      mockedAxios.post.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.auth_token({}))
        .rejects.toThrow('授權失敗: Invalid credentials');
    });

    test('網路錯誤時拋出錯誤', async () => {
      const mockError = new Error('Network Error');
      mockedAxios.post.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.auth_token({}))
        .rejects.toThrow('授權失敗: Network Error');
    });
  });

  describe('TOOL_HANDLERS.list_judgments', () => {
    test('成功取得裁判書清單 — 回傳 API 原始資料', async () => {
      const mockResponse = { data: [{ id: '1', title: 'Test Judgment' }] };
      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await TOOL_HANDLERS.list_judgments({ token: 'valid_token' });

      expect(result).toEqual(mockResponse.data);
    });

    test('Token 為空時拋出錯誤', async () => {
      await expect(TOOL_HANDLERS.list_judgments({ token: '' }))
        .rejects.toThrow('缺少必要參數: token');
    });

    test('Token 為空格時拋出錯誤', async () => {
      await expect(TOOL_HANDLERS.list_judgments({ token: '   ' }))
        .rejects.toThrow('無效的授權 Token');
    });

    test('Token 不是字串時拋出錯誤', async () => {
      await expect(TOOL_HANDLERS.list_judgments({ token: 123 }))
        .rejects.toThrow('無效的授權 Token');
    });

    test('API 請求失敗時拋出錯誤', async () => {
      const mockError = {
        response: { data: { message: 'Invalid token' } }
      };
      mockedAxios.post.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.list_judgments({ token: 'invalid_token' }))
        .rejects.toThrow('取得裁判書清單失敗: Invalid token');
    });

    test('網路錯誤時拋出錯誤', async () => {
      const mockError = new Error('Network Error');
      mockedAxios.post.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.list_judgments({ token: 'valid_token' }))
        .rejects.toThrow('取得裁判書清單失敗: Network Error');
    });
  });

  describe('TOOL_HANDLERS.get_judgment', () => {
    test('成功取得裁判書內容 — 回傳 API 原始資料', async () => {
      const mockResponse = { data: { content: 'Judgment content' } };
      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await TOOL_HANDLERS.get_judgment({
        token: 'valid_token',
        jid: 'judgment_id'
      });

      expect(result).toEqual(mockResponse.data);
    });

    test('缺少必要參數時拋出錯誤', async () => {
      await expect(TOOL_HANDLERS.get_judgment({ token: 'valid_token' }))
        .rejects.toThrow('缺少必要參數: jid');
    });

    test('API 請求失敗時拋出錯誤', async () => {
      const mockError = {
        response: { data: { message: 'Judgment not found' } }
      };
      mockedAxios.post.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.get_judgment({ 
        token: 'invalid_token', 
        jid: 'invalid_id' 
      }))
        .rejects.toThrow('取得裁判書內容失敗: Judgment not found');
    });

    test('網路錯誤時拋出錯誤', async () => {
      const mockError = new Error('Network Error');
      mockedAxios.post.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.get_judgment({ 
        token: 'valid_token', 
        jid: 'judgment_id' 
      }))
        .rejects.toThrow('取得裁判書內容失敗: Network Error');
    });
  });

  describe('TOOL_HANDLERS.list_categories', () => {
    test('成功取得主題分類清單 — 回傳 API 原始資料', async () => {
      const mockResponse = { data: [{ id: '1', name: 'Category 1' }] };
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await TOOL_HANDLERS.list_categories({ token: 'test-token' });

      expect(result).toEqual(mockResponse.data);
    });

    test('API 請求失敗時拋出錯誤', async () => {
      const mockError = {
        response: { data: { message: 'Service unavailable' } }
      };
      mockedAxios.get.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.list_categories({ token: 'test-token' }))
        .rejects.toThrow('取得主題分類清單失敗: Service unavailable');
    });

    test('網路錯誤時拋出錯誤', async () => {
      const mockError = new Error('Network Error');
      mockedAxios.get.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.list_categories({ token: 'test-token' }))
        .rejects.toThrow('取得主題分類清單失敗: Network Error');
    });
  });

  describe('TOOL_HANDLERS.list_resources', () => {
    test('成功取得資料源清單 — 回傳 API 原始資料', async () => {
      const mockResponse = { data: [{ id: '1', name: 'Resource 1' }] };
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await TOOL_HANDLERS.list_resources({ categoryNo: 'CAT001', token: 'test-token' });

      expect(result).toEqual(mockResponse.data);
    });

    test('缺少必要參數時拋出錯誤', async () => {
      await expect(TOOL_HANDLERS.list_resources({}))
        .rejects.toThrow('缺少必要參數: categoryNo, token');
    });

    test('API 請求失敗時拋出錯誤', async () => {
      const mockError = {
        response: { data: { message: 'Category not found' } }
      };
      mockedAxios.get.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.list_resources({ categoryNo: 'INVALID', token: 'test-token' }))
        .rejects.toThrow('取得資料源清單失敗: Category not found');
    });

    test('網路錯誤時拋出錯誤', async () => {
      const mockError = new Error('Network Error');
      mockedAxios.get.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.list_resources({ categoryNo: 'CAT001', token: 'test-token' }))
        .rejects.toThrow('取得資料源清單失敗: Network Error');
    });
  });

  describe('TOOL_HANDLERS.download_file', () => {
    test('成功下載檔案 — 回傳 MCP resource 內容類型', async () => {
      const fileData = Buffer.from('file content');
      const mockResponse = {
        data: fileData,
        headers: { 'content-type': 'application/octet-stream' }
      };
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await TOOL_HANDLERS.download_file({ fileSetId: 'FILE001', token: 'test-token' });

      // 回傳 MCP 規範的 resource content type（二進位資料用 blob）
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('resource');
      expect(result.content[0].resource.blob).toBeDefined();
      expect(result.content[0].resource.mimeType).toBe('application/octet-stream');
    });

    test('API 請求失敗時拋出錯誤', async () => {
      const mockError = {
        response: { data: { message: 'File not found' } }
      };
      mockedAxios.get.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.download_file({ fileSetId: 'INVALID', token: 'test-token' }))
        .rejects.toThrow('檔案下載失敗: File not found');
    });

    test('網路錯誤時拋出錯誤', async () => {
      const mockError = new Error('Network Error');
      mockedAxios.get.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.download_file({ fileSetId: 'FILE001', token: 'test-token' }))
        .rejects.toThrow('檔案下載失敗: Network Error');
    });

    test('top 與 skip 接受整數', async () => {
      const fileData = Buffer.from('file content');
      const mockResponse = {
        data: fileData,
        headers: { 'content-type': 'application/json' }
      };
      mockedAxios.get.mockResolvedValueOnce(mockResponse);

      const result = await TOOL_HANDLERS.download_file({
        fileSetId: 'FILE001',
        token: 'test-token',
        top: 10,
        skip: 0
      });

      expect(result.content[0].type).toBe('resource');
    });
  });

  describe('TOOL_HANDLERS.member_token', () => {
    test('成功取得會員 Token — 回傳 API 原始資料', async () => {
      const mockResponse = { data: { token: 'member_token_123' } };
      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const result = await TOOL_HANDLERS.member_token({});

      expect(result).toEqual(mockResponse.data);
    });

    test('API 請求失敗時拋出錯誤', async () => {
      const mockError = {
        response: { data: { message: 'Invalid credentials' } }
      };
      mockedAxios.post.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.member_token({}))
        .rejects.toThrow('會員授權失敗: Invalid credentials');
    });

    test('網路錯誤時拋出錯誤', async () => {
      const mockError = new Error('Network Error');
      mockedAxios.post.mockRejectedValueOnce(mockError);

      await expect(TOOL_HANDLERS.member_token({}))
        .rejects.toThrow('會員授權失敗: Network Error');
    });

    test('缺少帳號密碼時拋出錯誤', async () => {
      delete process.env.JUDICIAL_USER;
      delete process.env.JUDICIAL_PASSWORD;

      await expect(TOOL_HANDLERS.member_token({}))
        .rejects.toThrow('未提供使用者帳號或密碼');
    });
  });

  describe('工具配置測試', () => {
    test('所有工具都有處理器', () => {
      const toolNames = Object.keys(TOOLS_CONFIG);
      
      toolNames.forEach(toolName => {
        expect(TOOL_HANDLERS[toolName]).toBeDefined();
        expect(typeof TOOL_HANDLERS[toolName]).toBe('function');
      });
    });
  });

  describe('驗證工具函數測試', () => {
    test('所有工具的 token 欄位驗證', async () => {
      // 空 token 應被 required 攔截
      await expect(TOOL_HANDLERS.list_judgments({ token: '' }))
        .rejects.toThrow('缺少必要參數: token');

      // 空格 token 應被 token validator 攔截
      await expect(TOOL_HANDLERS.list_judgments({ token: '   ' }))
        .rejects.toThrow('無效的授權 Token');
    });
  });
});
