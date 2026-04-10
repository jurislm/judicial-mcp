/**
 * @file __tests__/mcp.test.js
 * @description MCP 伺服器功能測試
 */

const { TOOLS_CONFIG, TOOL_HANDLERS } = require('../src/tools');

describe('MCP 伺服器測試', () => {
  describe('工具配置', () => {
    test('所有工具都有必要的屬性', () => {
      const tools = Object.values(TOOLS_CONFIG);
      
      tools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool.inputSchema).toHaveProperty('type');
        expect(tool.inputSchema.type).toBe('object');
      });
    });

    test('工具名稱唯一性', () => {
      const tools = Object.values(TOOLS_CONFIG);
      const names = tools.map(tool => tool.name);
      const uniqueNames = [...new Set(names)];
      
      expect(names.length).toBe(uniqueNames.length);
    });

    test('所有工具都有對應的處理器', () => {
      const toolNames = Object.keys(TOOLS_CONFIG);
      const handlerNames = Object.keys(TOOL_HANDLERS);
      
      expect(toolNames.sort()).toEqual(handlerNames.sort());
    });

    test('所有工具都禁止額外屬性', () => {
      const tools = Object.values(TOOLS_CONFIG);
      
      tools.forEach(tool => {
        expect(tool.inputSchema.additionalProperties).toBe(false);
      });
    });
  });

  describe('工具處理器', () => {
    test('list_categories 處理器存在', () => {
      expect(TOOL_HANDLERS.list_categories).toBeDefined();
      expect(typeof TOOL_HANDLERS.list_categories).toBe('function');
    });

    test('auth_token 處理器參數驗證', async () => {
      // 測試缺少環境變數時的行為
      const originalUser = process.env.JUDICIAL_USER;
      const originalPassword = process.env.JUDICIAL_PASSWORD;
      
      delete process.env.JUDICIAL_USER;
      delete process.env.JUDICIAL_PASSWORD;
      
      await expect(TOOL_HANDLERS.auth_token({}))
        .rejects
        .toThrow('未提供使用者帳號或密碼');
      
      // 恢復環境變數
      if (originalUser) process.env.JUDICIAL_USER = originalUser;
      if (originalPassword) process.env.JUDICIAL_PASSWORD = originalPassword;
    });
  });

  describe('工具配置驗證', () => {
    test('auth_token 工具配置正確 — 不暴露帳密欄位', () => {
      const tool = TOOLS_CONFIG.auth_token;

      expect(tool.name).toBe('auth_token');
      // 安全性：帳密從環境變數讀取，不在 inputSchema 中暴露
      expect(tool.inputSchema.properties).not.toHaveProperty('user');
      expect(tool.inputSchema.properties).not.toHaveProperty('password');
      expect(tool.inputSchema.required).toBeUndefined();
    });

    test('list_judgments 工具配置正確', () => {
      const tool = TOOLS_CONFIG.list_judgments;
      
      expect(tool.name).toBe('list_judgments');
      expect(tool.inputSchema.properties).toHaveProperty('token');
      expect(tool.inputSchema.required).toContain('token');
    });

    test('get_judgment 工具配置正確', () => {
      const tool = TOOLS_CONFIG.get_judgment;
      
      expect(tool.name).toBe('get_judgment');
      expect(tool.inputSchema.properties).toHaveProperty('token');
      expect(tool.inputSchema.properties).toHaveProperty('jid');
      expect(tool.inputSchema.required).toContain('token');
      expect(tool.inputSchema.required).toContain('jid');
    });

    test('download_file 工具配置正確', () => {
      const tool = TOOLS_CONFIG.download_file;
      
      expect(tool.name).toBe('download_file');
      expect(tool.inputSchema.properties).toHaveProperty('fileSetId');
      expect(tool.inputSchema.properties).toHaveProperty('top');
      expect(tool.inputSchema.properties).toHaveProperty('skip');
      expect(tool.inputSchema.properties).toHaveProperty('token');
      expect(tool.inputSchema.required).toEqual(['fileSetId', 'token']);
      // JSON Schema integer type（非 string + pattern）
      expect(tool.inputSchema.properties.top.type).toBe('integer');
      expect(tool.inputSchema.properties.skip.type).toBe('integer');
      expect(tool.inputSchema.properties.top.pattern).toBeUndefined();
      expect(tool.inputSchema.properties.skip.pattern).toBeUndefined();
    });

    test('list_categories 工具配置正確', () => {
      const tool = TOOLS_CONFIG.list_categories;
      
      expect(tool.name).toBe('list_categories');
      expect(tool.inputSchema.properties).toEqual({
        token: {
          type: 'string',
          description: '從 member_token 工具取得的會員授權 Token'
        }
      });
      expect(tool.inputSchema.required).toEqual(['token']);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });

    test('list_resources 工具配置正確', () => {
      const tool = TOOLS_CONFIG.list_resources;
      
      expect(tool.name).toBe('list_resources');
      expect(tool.inputSchema.properties).toHaveProperty('categoryNo');
      expect(tool.inputSchema.properties).toHaveProperty('token');
      expect(tool.inputSchema.required).toEqual(['categoryNo', 'token']);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });

    test('member_token 工具配置正確 — 不暴露帳密欄位', () => {
      const tool = TOOLS_CONFIG.member_token;

      expect(tool.name).toBe('member_token');
      // 安全性：帳密從環境變數讀取，不在 inputSchema 中暴露
      expect(tool.inputSchema.properties).not.toHaveProperty('user');
      expect(tool.inputSchema.properties).not.toHaveProperty('password');
      expect(tool.inputSchema.required).toBeUndefined();
      expect(tool.inputSchema.additionalProperties).toBe(false);
    });
  });
});