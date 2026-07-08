/**
 * @file __tests__/index.test.js
 * @description MCP server 入口（src/index.js）測試 — handler 註冊與分支涵蓋
 */

const mockHandlers = new Map();
let mockOnErrorSetter;

const mockConnect = jest.fn().mockResolvedValue(undefined);

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => {
    const instance = {
      setRequestHandler: (schema, handler) => mockHandlers.set(schema, handler),
      connect: mockConnect,
    };
    Object.defineProperty(instance, 'onerror', {
      set(fn) {
        mockOnErrorSetter = fn;
      },
      get() {
        return mockOnErrorSetter;
      },
    });
    return instance;
  }),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../src/tools.js', () => ({
  TOOLS_CONFIG: { fake_tool: { name: 'fake_tool', description: 'd', inputSchema: { type: 'object' } } },
  TOOL_HANDLERS: {
    fake_tool: jest.fn(),
  },
}));

const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { TOOL_HANDLERS } = require('../src/tools.js');

describe('src/index.js', () => {
  let exitSpy;
  let stderrSpy;

  beforeAll(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    require('../src/index.js');
  });

  afterAll(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  beforeEach(() => {
    TOOL_HANDLERS.fake_tool.mockReset();
    stderrSpy.mockClear();
  });

  test('console.log/info/warn 重定向到 stderr', () => {
    console.log('hello');
    expect(stderrSpy).toHaveBeenCalledWith('hello\n');
  });

  test('ListTools handler 回傳工具清單', async () => {
    const result = await mockHandlers.get(ListToolsRequestSchema)();
    expect(result.tools).toEqual([{ name: 'fake_tool', description: 'd', inputSchema: { type: 'object' } }]);
  });

  test('CallTool handler：未知工具拋出並回傳 isError', async () => {
    const result = await mockHandlers.get(CallToolRequestSchema)({ params: { name: 'unknown', arguments: {} } });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('未知的工具');
  });

  test('CallTool handler：一般 handler 結果包裝成 success response', async () => {
    TOOL_HANDLERS.fake_tool.mockResolvedValueOnce({ ok: true });
    const result = await mockHandlers.get(CallToolRequestSchema)({ params: { name: 'fake_tool', arguments: {} } });

    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true });
  });

  test('CallTool handler：resource content（如 download_file）不重複包裝', async () => {
    const blobResult = { content: [{ type: 'resource', resource: {} }] };
    TOOL_HANDLERS.fake_tool.mockResolvedValueOnce(blobResult);
    const result = await mockHandlers.get(CallToolRequestSchema)({ params: { name: 'fake_tool', arguments: {} } });

    expect(result).toBe(blobResult);
  });

  test('CallTool handler：handler 拋出錯誤時回傳 isError', async () => {
    TOOL_HANDLERS.fake_tool.mockRejectedValueOnce(new Error('boom'));
    const result = await mockHandlers.get(CallToolRequestSchema)({ params: { name: 'fake_tool', arguments: {} } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('boom');
  });

  test('server.onerror 記錄協議層錯誤', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockOnErrorSetter({ message: 'protocol error' });
    expect(errorSpy).toHaveBeenCalledWith('MCP 協議錯誤:', 'protocol error');
    errorSpy.mockRestore();
  });

  test('server.onerror：無 message 時直接記錄原始錯誤物件', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const rawError = 'raw protocol failure';
    mockOnErrorSetter(rawError);
    expect(errorSpy).toHaveBeenCalledWith('MCP 協議錯誤:', rawError);
    errorSpy.mockRestore();
  });

  test('CallTool handler：arguments 缺省時退回空物件', async () => {
    TOOL_HANDLERS.fake_tool.mockResolvedValueOnce({ ok: true });
    await mockHandlers.get(CallToolRequestSchema)({ params: { name: 'fake_tool' } });

    expect(TOOL_HANDLERS.fake_tool).toHaveBeenCalledWith({});
  });

  test('main() 連線成功', () => {
    expect(mockConnect).toHaveBeenCalled();
  });

  test('main() 連線失敗時記錄錯誤並結束程序', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const connectError = new Error('connection failed');
    mockConnect.mockRejectedValueOnce(connectError);

    jest.resetModules();
    require('../src/index.js');
    // 讓 main().catch(...) 的微任務有機會執行
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith('伺服器啟動失敗:', connectError);
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
  });
});
