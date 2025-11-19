// worker.js (v1.1.4 - 增强空响应fallback与调试日志)
// =================================================================================
// 项目: puter-2api (Cloudflare Worker 单文件版)
// 版本: 1.0.3-cfw-pro (代号: Chimera Synthesis - Puter Pro)
// 作者: 首席AI执行官 (Principal AI Executive Officer)
// 协议: 奇美拉协议 · 综合版 (Project Chimera: Synthesis Edition)
// 日期: 2025-11-20
//
// 更新日志:
// v1.1.4:
// 1. 在TransformStream中添加内容发送跟踪与fallback逻辑，避免空回复。
// 2. 增强console.error日志，记录上游响应长度与样本数据。
// 3. UI中添加空响应提示显示。
// v1.1.3: ... (前版日志省略)
// =================================================================================
// --- [第一部分: 核心配置 (Configuration-as-Code)] ---
const CONFIG = {
  PROJECT_NAME: "puter-2api",
  PROJECT_VERSION: "1.0.3-cfw-pro",
  API_MASTER_KEY: "1",
  UPSTREAM_URL: "https://api.puter.com/drivers/call",
  PUTER_AUTH_TOKENS: [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0IjoiYXUiLCJ2IjoiMC4wLjAiLCJ1dSI6Ino4U1N4Z3k2VEJtbDZMTGVOUFVaZVE9PSIsImF1IjoiaWRnL2ZEMDdVTkdhSk5sNXpXUGZhUT09IiwicyI6Inc0UTJ3djM1ZHhwdkkyTlg3L3lWMlE9PSIsImlhdCI6MTc2MzQ5NDg5NX0.rSOf1PJ9ZL6Aup2Tn4mkAnVUHJCNN37tCUSlQZtBBM0",
  ],
  CHAT_MODELS: [
    "gpt-4o-mini", "gpt-4o", "gemini-1.5-flash", "gpt-5.1", "gpt-5.1-chat-latest", "gpt-5-2025-08-07", "gpt-5", "gpt-5-mini-2025-08-07", "gpt-5-mini", "gpt-5-nano-2025-08-07", "gpt-5-nano", "gpt-5-chat-latest", "o1", "o3", "o3-mini", "o4-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-opus-4-1-20250805", "claude-opus-4-1", "claude-opus-4-20250514", "claude-sonnet-4-20250514", "claude-3-7-sonnet-20250219", "claude-3-7-sonnet-latest", "claude-3-haiku-20240307", "grok-beta", "grok-vision-beta", "grok-3", "grok-3-fast", "grok-3-mini", "grok-3-mini-fast", "grok-2-vision", "grok-2", "gemini-2.0-flash"
  ],
  IMAGE_MODELS: ["gpt-image-1"],
  VIDEO_MODELS: ["sora-2", "sora-2-pro"],
  DEFAULT_CHAT_MODEL: "gpt-4o-mini",
  DEFAULT_IMAGE_MODEL: "gpt-image-1",
  DEFAULT_VIDEO_MODEL: "sora-2",
};
let tokenIndex = 0;
// --- [第二部分: Worker 入口与路由] ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return handleUI(request);
    } else if (url.pathname.startsWith('/v1/')) {
      return handleApi(request);
    } else {
      return createErrorResponse(`路径未找到: ${url.pathname}`, 404, 'not_found');
    }
  }
};
// --- [第三部分: API 代理逻辑] ---
async function handleApi(request) {
  if (request.method === 'OPTIONS') {
    return handleCorsPreflight();
  }
  const authHeader = request.headers.get('Authorization');
  if (CONFIG.API_MASTER_KEY && CONFIG.API_MASTER_KEY !== "1") {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return createErrorResponse('需要 Bearer Token 认证。', 401, 'unauthorized');
    }
    const token = authHeader.substring(7);
    if (token !== CONFIG.API_MASTER_KEY) {
      return createErrorResponse('无效的 API Key。', 403, 'invalid_api_key');
    }
  }
  const url = new URL(request.url);
  const requestId = `puter-${crypto.randomUUID()}`;
  switch (url.pathname) {
    case '/v1/models':
      return handleModelsRequest(request);
    case '/v1/chat/completions':
      return handleChatCompletions(request, requestId);
    case '/v1/images/generations':
      return handleImageGenerations(request, requestId);
    case '/v1/videos/generations':
      return handleVideoGenerations(request, requestId);
    default:
      return createErrorResponse(`API 路径不支持: ${url.pathname}`, 404, 'not_found');
  }
}
async function handleModelsRequest(request) {
    const allModels = [...CONFIG.CHAT_MODELS, ...CONFIG.IMAGE_MODELS, ...CONFIG.VIDEO_MODELS];
    const modelsData = {
        object: 'list',
        data: allModels.map(modelId => ({
            id: modelId,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'puter-2api',
        })),
    };
    return new Response(JSON.stringify(modelsData), {
        headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' })
    });
}
async function handleChatCompletions(request, requestId) {
  if (request.method !== 'POST') {
    return createErrorResponse(`此端点仅接受 POST 请求，但收到了 ${request.method}。`, 405, 'method_not_allowed');
  }
  try {
    const requestData = await request.json();
    const upstreamPayload = createUpstreamPayload('chat', requestData);
    const upstreamResponse = await fetch(CONFIG.UPSTREAM_URL, {
      method: 'POST',
      headers: createUpstreamHeaders(requestId),
      body: JSON.stringify(upstreamPayload),
    });
    if (!upstreamResponse.ok) {
      return await handleErrorResponse(upstreamResponse);
    }
    // [v1.1.4] 添加上游响应长度日志
    const upstreamText = await upstreamResponse.clone().text();
    console.error(`[DEBUG ${requestId}] 上游响应长度: ${upstreamText.length}, 样本: ${upstreamText.substring(0, 200)}...`);
    const transformStream = createUpstreamToOpenAIStream(requestId, requestData.model || CONFIG.DEFAULT_CHAT_MODEL);
    if (upstreamResponse.body) {
        return new Response(upstreamResponse.body.pipeThrough(transformStream), {
            headers: corsHeaders({
                'Content-Type': 'text/event-stream; charset=utf-8',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Worker-Trace-ID': requestId,
            }),
        });
    } else {
        return createErrorResponse('上游未返回有效响应体。', 502, 'bad_gateway');
    }
  } catch (e) {
    if (e instanceof SyntaxError) {
        return createErrorResponse('无法解析请求体。请确保它是有效的 JSON 格式。', 400, 'invalid_json');
    }
    console.error('处理聊天请求时发生异常:', e);
    return createErrorResponse(`处理请求时发生内部错误: ${e.message}`, 500, 'internal_server_error');
  }
}
async function handleImageGenerations(request, requestId) {
    if (request.method !== 'POST') {
        return createErrorResponse(`此端点仅接受 POST 请求，但收到了 ${request.method}。`, 405, 'method_not_allowed');
    }
    try {
        const requestData = await request.json();
        const upstreamPayload = createUpstreamPayload('image', requestData);
        const upstreamResponse = await fetch(CONFIG.UPSTREAM_URL, {
            method: 'POST',
            headers: createUpstreamHeaders(requestId),
            body: JSON.stringify(upstreamPayload),
        });
        if (!upstreamResponse.ok) {
            return await handleErrorResponse(upstreamResponse);
        }
        const imageBytes = await upstreamResponse.arrayBuffer();
        const bytes = new Uint8Array(imageBytes);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const b64_json = btoa(binary);
        const responseData = {
            created: Math.floor(Date.now() / 1000),
            data: [{ b64_json: b64_json }]
        };
        return new Response(JSON.stringify(responseData), {
            headers: corsHeaders({
                'Content-Type': 'application/json; charset=utf-8',
                'X-Worker-Trace-ID': requestId,
            }),
        });
    } catch (e) {
        console.error('处理图像生成请求时发生异常:', e);
        return createErrorResponse(`处理请求时发生内部错误: ${e.message}`, 500, 'internal_server_error');
    }
}
async function handleVideoGenerations(request, requestId) {
    return createErrorResponse(
        '此部署版本不支持视频生成功能。该功能可能需要 Puter.com 的高级账户才能使用。',
        403,
        'access_denied'
    );
}
// --- 辅助函数 ---
function _get_auth_token() {
    const token = CONFIG.PUTER_AUTH_TOKENS[tokenIndex];
    tokenIndex = (tokenIndex + 1) % CONFIG.PUTER_AUTH_TOKENS.length;
    return token;
}
function getDriverFromModel(model) {
    if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3") || model.startsWith("o4")) return "openai-completion";
    if (model.startsWith("claude")) return "claude";
    if (model.startsWith("gemini")) return "gemini";
    if (model.startsWith("grok")) return "xai";
    return "openai-completion";
}
function createUpstreamPayload(type, requestData) {
    const authToken = _get_auth_token();
    switch (type) {
        case 'chat':
            const model = requestData.model || CONFIG.DEFAULT_CHAT_MODEL;
            return {
                interface: "puter-chat-completion",
                driver: getDriverFromModel(model),
                test_mode: false,
                method: "complete",
                args: { messages: requestData.messages, model: model, stream: true },
                auth_token: authToken
            };
        case 'image':
            return {
                interface: "puter-image-generation",
                driver: "openai-image-generation",
                test_mode: false,
                method: "generate",
                args: { model: requestData.model || CONFIG.DEFAULT_IMAGE_MODEL, quality: requestData.quality || "high", prompt: requestData.prompt },
                auth_token: authToken
            };
        case 'video':
            return {
                interface: "puter-video-generation",
                driver: "openai-video-generation",
                test_mode: false,
                method: "generate",
                args: { model: requestData.model || CONFIG.DEFAULT_VIDEO_MODEL, seconds: requestData.seconds || 8, size: requestData.size || "1280x720", prompt: requestData.prompt },
                auth_token: authToken
            };
    }
}
function createUpstreamHeaders(requestId) {
    return {
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Origin': 'https://docs.puter.com',
        'Referer': 'https://docs.puter.com/',
        // [v1.1.4] 保持稳定UA，避免上游拦截
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'X-Request-ID': requestId,
    };
}
async function handleErrorResponse(response) {
    const errorBody = await response.text();
    console.error(`上游服务错误: ${response.status}`, errorBody);
    try {
        const errorJson = JSON.parse(errorBody);
        if (errorJson.error && errorJson.error.message) {
             return createErrorResponse(`上游服务错误: ${errorJson.error.message}`, response.status, errorJson.error.code || 'upstream_error');
        }
    } catch(e) {}
    return createErrorResponse(`上游服务返回错误 ${response.status}: ${errorBody}`, response.status, 'upstream_error');
}
// [v1.1.4] 增强TransformStream：添加内容跟踪与fallback
function createUpstreamToOpenAIStream(requestId, model) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  let contentSent = false; // 跟踪是否发送过内容
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          try {
            const data = JSON.parse(line);
            let content = null;
            if (data.type === 'text' && typeof data.text === 'string') {
                content = data.text;
            } else if (typeof data.text === 'string') {
                content = data.text;
            }
            if (content !== null && content.length > 0) {
              contentSent = true;
              const openAIChunk = {
                id: requestId,
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{ index: 0, delta: { content: content }, finish_reason: null }],
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
            }
          } catch (e) {
            console.error('无法解析上游 NDJSON 数据块:', line, e);
          }
        }
      }
    },
    flush(controller) {
      // [v1.1.4] 如果无内容，发送fallback提示
      if (!contentSent) {
        const fallbackContent = "上游未返回有效内容。请检查提示词长度、模型可用性或认证token，并重试。";
        const fallbackChunk = {
          id: requestId,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model,
          choices: [{ index: 0, delta: { content: fallbackContent }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(fallbackChunk)}\n\n`));
        console.error(`[DEBUG ${requestId}] 发送fallback响应（无上游内容）`);
      }
      // 处理缓冲区剩余数据
      if (buffer && buffer.trim()) {
          try {
             const data = JSON.parse(buffer);
             if (data.text && !contentSent) {
                 contentSent = true;
                 const openAIChunk = {
                    id: requestId,
                    object: 'chat.completion.chunk',
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    choices: [{ index: 0, delta: { content: data.text }, finish_reason: null }],
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
             }
          } catch(e) {}
      }
      const finalChunk = {
        id: requestId,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    },
  });
}
function handleCorsPreflight() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
function createErrorResponse(message, status, code) {
  return new Response(JSON.stringify({ error: { message, type: 'api_error', code } }), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' })
  });
}
function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...extra
  };
}
// --- [第四部分: 开发者驾驶舱 UI] ---
function handleUI(request) {
  let origin;
  const hfSpaceHost = request.headers.get('x-hf-space-host');
  if (hfSpaceHost) {
      origin = `https://${hfSpaceHost}`;
  } else {
      const hostname = new URL(request.url).hostname;
      origin = `https://${hostname}`;
  }
 
  const allModels = [...CONFIG.CHAT_MODELS, ...CONFIG.IMAGE_MODELS, ...CONFIG.VIDEO_MODELS];
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${CONFIG.PROJECT_NAME} - 开发者驾驶舱</title>
    <style>
      :root { --bg-color: #121212; --sidebar-bg: #1E1E1E; --main-bg: #121212; --border-color: #333333; --text-color: #E0E0E0; --text-secondary: #888888; --primary-color: #FFBF00; --primary-hover: #FFD700; --input-bg: #2A2A2A; --error-color: #CF6679; --success-color: #66BB6A; --font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; --font-mono: 'Fira Code', 'Consolas', 'Monaco', monospace; }
      * { box-sizing: border-box; }
      body { font-family: var(--font-family); margin: 0; background-color: var(--bg-color); color: var(--text-color); font-size: 14px; display: flex; height: 100vh; overflow: hidden; }
      .skeleton { background-color: #2a2a2a; background-image: linear-gradient(90deg, #2a2a2a, #3a3a3a, #2a2a2a); background-size: 200% 100%; animation: skeleton-loading 1.5s infinite; border-radius: 4px; }
      @keyframes skeleton-loading { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
      select, textarea, input { background-color: var(--input-bg); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-color); padding: 10px; font-family: var(--font-family); font-size: 14px; width: 100%; }
      select:focus, textarea:focus, input:focus { outline: none; border-color: var(--primary-color); }
    </style>
</head>
<body>
    <main-layout></main-layout>
    <template id="main-layout-template">
      <style>
        .layout { display: flex; width: 100%; height: 100vh; }
        .sidebar { width: 380px; flex-shrink: 0; background-color: var(--sidebar-bg); border-right: 1px solid var(--border-color); padding: 20px; display: flex; flex-direction: column; overflow-y: auto; }
        .main-content { flex-grow: 1; display: flex; flex-direction: column; padding: 20px; overflow: hidden; }
        .header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 15px; margin-bottom: 15px; border-bottom: 1px solid var(--border-color); }
        .header h1 { margin: 0; font-size: 20px; }
        .header .version { font-size: 12px; color: var(--text-secondary); margin-left: 8px; }
        .collapsible-section { margin-top: 20px; }
        .collapsible-section summary { cursor: pointer; font-weight: bold; margin-bottom: 10px; list-style: none; }
        .collapsible-section summary::-webkit-details-marker { display: none; }
        .collapsible-section summary::before { content: '▶'; margin-right: 8px; display: inline-block; transition: transform 0.2s; }
        .collapsible-section[open] > summary::before { transform: rotate(90deg); }
        @media (max-width: 768px) { .layout { flex-direction: column; } .sidebar { width: 100%; height: auto; border-right: none; border-bottom: 1px solid var(--border-color); } }
      </style>
      <div class="layout">
        <aside class="sidebar">
          <header class="header">
            <h1>${CONFIG.PROJECT_NAME}<span class="version">v${CONFIG.PROJECT_VERSION}</span></h1>
            <status-indicator></status-indicator>
          </header>
          <info-panel></info-panel>
          <details class="collapsible-section" open><summary>⚙️ 主流客户端集成</summary><client-guides></client-guides></details>
          <details class="collapsible-section"><summary>📚 模型总览</summary><model-list-panel></model-list-panel></details>
        </aside>
        <main class="main-content"><live-terminal></live-terminal></main>
      </div>
    </template>
    <template id="status-indicator-template">
      <style>
        .indicator { display: flex; align-items: center; gap: 8px; font-size: 12px; }
        .dot { width: 10px; height: 10px; border-radius: 50%; transition: background-color: 0.3s; }
        .dot.grey { background-color: #555; } .dot.yellow { background-color: #FFBF00; animation: pulse 2s infinite; } .dot.green { background-color: var(--success-color); } .dot.red { background-color: var(--error-color); }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255, 191, 0, 0.4); } 70% { box-shadow: 0 0 0 10px rgba(255, 191, 0, 0); } 100% { box-shadow: 0 0 0 0 rgba(255, 191, 0, 0); } }
      </style>
      <div class="indicator"><div id="status-dot" class="dot grey"></div><span id="status-text">正在初始化...</span></div>
    </template>
    <template id="info-panel-template">
      <style>
        .panel { display: flex; flex-direction: column; gap: 12px; } .info-item { display: flex; flex-direction: column; } .info-item label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
        .info-value { background-color: var(--input-bg); padding: 8px 12px; border-radius: 4px; font-family: var(--font-mono); font-size: 13px; color: var(--primary-color); display: flex; align-items: center; justify-content: space-between; word-break: break-all; }
        .info-value.password { -webkit-text-security: disc; } .info-value.visible { -webkit-text-security: none; } .actions { display: flex; gap: 8px; }
        .icon-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 2px; display: flex; align-items: center; } .icon-btn:hover { color: var(--text-color); } .icon-btn svg { width: 16px; height: 16px; } .skeleton { height: 34px; }
      </style>
      <div class="panel">
        <div class="info-item"><label>API 端点 (Endpoint)</label><div id="api-url" class="info-value skeleton"></div></div>
        <div class="info-item"><label>API 密钥 (Master Key)</label><div id="api-key" class="info-value password skeleton"></div></div>
      </div>
    </template>
    <template id="client-guides-template">
       <style>
        .tabs { display: flex; border-bottom: 1px solid var(--border-color); } .tab { padding: 8px 12px; cursor: pointer; border: none; background: none; color: var(--text-secondary); } .tab.active { color: var(--primary-color); border-bottom: 2px solid var(--primary-color); }
        .content { padding: 15px 0; } pre { background-color: var(--input-bg); padding: 12px; border-radius: 4px; font-family: var(--font-mono); font-size: 12px; white-space: pre-wrap; word-break: break-all; position: relative; }
        .copy-code-btn { position: absolute; top: 8px; right: 8px; background: #444; border: 1px solid #555; color: #ccc; border-radius: 4px; cursor: pointer; padding: 2px 6px; font-size: 12px; } .copy-code-btn:hover { background: #555; } .copy-code-btn.copied { background-color: var(--success-color); color: #121212; }
       </style>
       <div><div class="tabs"></div><div class="content"></div></div>
    </template>
    <template id="model-list-panel-template">
      <style>
        .model-list-container { padding-top: 10px; }
        .model-category h3 { font-size: 14px; color: var(--primary-color); margin: 15px 0 8px 0; border-bottom: 1px solid var(--border-color); padding-bottom: 5px; }
        .model-list { list-style: none; padding: 0; margin: 0; }
        .model-list li { background-color: var(--input-bg); padding: 6px 10px; border-radius: 4px; margin-bottom: 5px; font-family: var(--font-mono); font-size: 12px; }
      </style>
      <div class="model-list-container"></div>
    </template>
    <template id="live-terminal-template">
      <style>
        .terminal { display: flex; flex-direction: column; height: 100%; background-color: var(--sidebar-bg); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
        .mode-tabs { display: flex; border-bottom: 1px solid var(--border-color); flex-shrink: 0; }
        .mode-tab { padding: 10px 15px; cursor: pointer; background: none; border: none; color: var(--text-secondary); font-size: 14px; }
        .mode-tab.active { color: var(--primary-color); border-bottom: 2px solid var(--primary-color); }
        .pro-tag { font-size: 10px; color: var(--primary-color); margin-left: 5px; vertical-align: super; opacity: 0.8; }
        .output-window { flex-grow: 1; padding: 15px; overflow-y: auto; line-height: 1.6; }
        .output-window p, .output-window div { margin: 0 0 1em 0; }
        .output-window .message.user { color: var(--primary-color); font-weight: bold; }
        .output-window .message.assistant { color: var(--text-color); white-space: pre-wrap; }
        .output-window .message.error { color: var(--error-color); }
        .output-window img, .output-window video { max-width: 100%; border-radius: 4px; }
        .input-area { border-top: 1px solid var(--border-color); padding: 15px; display: flex; flex-direction: column; gap: 10px; }
        .tab-content { display: none; } .tab-content.active { display: flex; flex-direction: column; gap: 10px; }
        .param-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        textarea { flex-grow: 1; resize: none; min-height: 80px; }
        .submit-btn { background-color: var(--primary-color); color: #121212; border: none; border-radius: 4px; padding: 10px 15px; height: 42px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; }
        .submit-btn:hover { background-color: var(--primary-hover); } .submit-btn:disabled { background-color: #555; cursor: not-allowed; }
        .submit-btn.cancel svg { width: 24px; height: 24px; } .submit-btn svg { width: 20px; height: 20px; }
        .placeholder { color: var(--text-secondary); }
      </style>
      <div class="terminal">
        <div class="mode-tabs">
          <button class="mode-tab active" data-mode="chat">文生文 (Chat)</button>
          <button class="mode-tab" data-mode="image">文生图 (Image)<span class="pro-tag">未修复目前不可用</span></button>
          <button class="mode-tab" data-mode="video">文生视频 (Video)<span class="pro-tag">需高级账户</span></button>
        </div>
        <div class="output-window"><p class="placeholder">多模态测试终端已就绪。请选择模式并输入指令... (提示：使用较长提示词避免空响应)</p></div>
        <div class="input-area">
          <div id="chat-panel" class="tab-content active">
            <select id="chat-model-select"></select>
            <textarea id="chat-prompt-input" rows="3" placeholder="输入您的对话内容..."></textarea>
          </div>
          <div id="image-panel" class="tab-content">
            <select id="image-model-select"></select>
            <textarea id="image-prompt-input" rows="3" placeholder="输入您的图片描述..."></textarea>
          </div>
          <div id="video-panel" class="tab-content">
            <select id="video-model-select"></select>
            <textarea id="video-prompt-input" rows="3" placeholder="输入您的视频描述... (此功能当前不可用)"></textarea>
            <div class="param-grid">
              <input type="text" id="video-size-input" value="1280x720" placeholder="分辨率 (e.g., 1280x720)">
              <input type="number" id="video-seconds-input" value="8" placeholder="视频时长 (秒)">
            </div>
          </div>
          <button id="submit-btn" class="submit-btn" title="发送/生成">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.949a.75.75 0 00.95.544l3.239-1.281a.75.75 0 000-1.39L4.23 6.28a.75.75 0 00-.95-.545L1.865 3.45a.75.75 0 00.95-.826l.002-.007.002-.006zm.002 14.422a.75.75 0 00.95.826l1.415-2.28a.75.75 0 00-.545-.95l-3.239-1.28a.75.75 0 00-1.39 0l-1.28 3.239a.75.75 0 00.544.95l4.95 1.414zM12.75 8.5a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-5.5z"/></svg>
          </button>
        </div>
      </div>
    </template>
    <script>
      const CLIENT_CONFIG = {
        WORKER_ORIGIN: '${origin}',
        API_MASTER_KEY: '${CONFIG.API_MASTER_KEY}',
        CHAT_MODELS: ${JSON.stringify(CONFIG.CHAT_MODELS)},
        IMAGE_MODELS: ${JSON.stringify(CONFIG.IMAGE_MODELS)},
        VIDEO_MODELS: ${JSON.stringify(CONFIG.VIDEO_MODELS)},
        DEFAULT_CHAT_MODEL: '${CONFIG.DEFAULT_CHAT_MODEL}',
        CUSTOM_MODELS_STRING: '${allModels.map(m => `+${m}`).join(',')}'
      };
      const AppState = { INITIALIZING: 'INITIALIZING', HEALTH_CHECKING: 'HEALTH_CHECKING', READY: 'READY', REQUESTING: 'REQUESTING', STREAMING: 'STREAMING', ERROR: 'ERROR' };
      let currentState = AppState.INITIALIZING;
      let abortController = null;
      class BaseComponent extends HTMLElement {
        constructor(id) {
          super();
          this.attachShadow({ mode: 'open' });
          const template = document.getElementById(id);
          if (template) this.shadowRoot.appendChild(template.content.cloneNode(true));
        }
      }
      class MainLayout extends BaseComponent { constructor() { super('main-layout-template'); } }
      customElements.define('main-layout', MainLayout);
      class StatusIndicator extends BaseComponent {
        constructor() { super('status-indicator-template'); this.dot = this.shadowRoot.getElementById('status-dot'); this.text = this.shadowRoot.getElementById('status-text'); }
        setState(state, message) {
          this.dot.className = 'dot';
          switch (state) {
            case 'checking': this.dot.classList.add('yellow'); break;
            case 'ok': this.dot.classList.add('green'); break;
            case 'error': this.dot.classList.add('red'); break;
            default: this.dot.classList.add('grey'); break;
          }
          this.text.textContent = message;
        }
      }
      customElements.define('status-indicator', StatusIndicator);
      class InfoPanel extends BaseComponent {
        constructor() { super('info-panel-template'); this.apiUrlEl = this.shadowRoot.getElementById('api-url'); this.apiKeyEl = this.shadowRoot.getElementById('api-key'); }
        connectedCallback() { this.render(); }
        render() {
          this.populateField(this.apiUrlEl, CLIENT_CONFIG.WORKER_ORIGIN + '/v1');
          this.populateField(this.apiKeyEl, CLIENT_CONFIG.API_MASTER_KEY, true);
        }
        populateField(el, value, isPassword = false) {
          el.classList.remove('skeleton');
          el.innerHTML = \`<span>\${value}</span><div class="actions">\${isPassword ? '<button class="icon-btn" data-action="toggle-visibility" title="切换可见性"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/><path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.18l.88-1.473a1.65 1.65 0 012.899 0l.88 1.473a1.65 1.65 0 010 1.18l-.88 1.473a1.65 1.65 0 01-2.899 0l-.88-1.473zM18.45 10.59a1.651 1.651 0 010-1.18l.88-1.473a1.65 1.65 0 012.899 0l.88 1.473a1.65 1.65 0 010 1.18l-.88 1.473a1.65 1.65 0 01-2.899 0l-.88-1.473zM10 17a1.651 1.651 0 01-1.18 0l-1.473-.88a1.65 1.65 0 010-2.899l1.473-.88a1.651 1.651 0 011.18 0l1.473.88a1.65 1.65 0 010 2.899l-1.473.88a1.651 1.651 0 01-1.18 0z" clip-rule="evenodd"/></svg></button>' : ''}<button class="icon-btn" data-action="copy" title="复制"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.121A1.5 1.5 0 0117 6.621V16.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 017 16.5v-13z"/><path d="M5 6.5A1.5 1.5 0 016.5 5h3.879a1.5 1.5 0 011.06.44l3.122 3.121A1.5 1.5 0 0115 9.621V14.5a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 015 14.5v-8z"/></svg></button></div>\`;
          el.querySelector('[data-action="copy"]').addEventListener('click', () => navigator.clipboard.writeText(value));
          if (isPassword) el.querySelector('[data-action="toggle-visibility"]').addEventListener('click', () => el.classList.toggle('visible'));
        }
      }
      customElements.define('info-panel', InfoPanel);
      class ClientGuides extends BaseComponent {
        constructor() { super('client-guides-template'); this.tabs = this.shadowRoot.querySelector('.tabs'); this.content = this.shadowRoot.querySelector('.content'); this.guides = { 'cURL': this.getCurlGuide(), 'Python': this.getPythonGuide(), 'LobeChat': this.getLobeChatGuide(), 'Next-Web': this.getNextWebGuide() }; }
        connectedCallback() {
          Object.keys(this.guides).forEach((name, index) => { const tab = document.createElement('button'); tab.className = 'tab'; tab.textContent = name; if (index === 0) tab.classList.add('active'); tab.addEventListener('click', () => this.switchTab(name)); this.tabs.appendChild(tab); });
          this.switchTab(Object.keys(this.guides)[0]);
          this.content.addEventListener('click', (e) => { const button = e.target.closest('.copy-code-btn'); if (button) { const code = button.closest('pre').querySelector('code').innerText; navigator.clipboard.writeText(code).then(() => { button.textContent = '已复制!'; button.classList.add('copied'); setTimeout(() => { button.textContent = '复制'; button.classList.remove('copied'); }, 2000); }); } });
        }
        switchTab(name) { this.tabs.querySelector('.active')?.classList.remove('active'); const newActiveTab = Array.from(this.tabs.children).find(tab => tab.textContent === name); newActiveTab?.classList.add('active'); this.content.innerHTML = this.guides[name]; }
        getCurlGuide() { return \`<pre><button class="copy-code-btn">复制</button><code>curl --location '\\\${CLIENT_CONFIG.WORKER_ORIGIN}/v1/chat/completions' \\\\<br>--header 'Content-Type: application/json' \\\\<br>--header 'Authorization: Bearer \\\${CLIENT_CONFIG.API_MASTER_KEY}' \\\\<br>--data '{<br> "model": "\\\${CLIENT_CONFIG.DEFAULT_CHAT_MODEL}",<br> "messages": [{"role": "user", "content": "你好"}],<br> "stream": true<br>}'</code></pre>\`; }
        getPythonGuide() { return \`<pre><button class="copy-code-btn">复制</button><code>import openai<br><br>client = openai.OpenAI(<br> api_key="\\\${CLIENT_CONFIG.API_MASTER_KEY}",<br> base_url="\\\${CLIENT_CONFIG.WORKER_ORIGIN}/v1"<br>)<br><br>stream = client.chat.completions.create(<br> model="\\\${CLIENT_CONFIG.DEFAULT_CHAT_MODEL}",<br> messages=[{"role": "user", "content": "你好"}],<br> stream=True,<br>)<br><br>for chunk in stream:<br> print(chunk.choices[0].delta.content or "", end="")</code></pre>\`; }
        getLobeChatGuide() { return \`<p>在 LobeChat 设置中:</p><pre><button class="copy-code-btn">复制</button><code>API Key: \\\${CLIENT_CONFIG.API_MASTER_KEY}<br>API 地址: \\\${CLIENT_CONFIG.WORKER_ORIGIN}<br>模型列表: (请留空或手动填入)</code></pre>\`; }
        getNextWebGuide() { return \`<p>在 ChatGPT-Next-Web 部署时:</p><pre><button class="copy-code-btn">复制</button><code>CODE=\\\${CLIENT_CONFIG.API_MASTER_KEY}<br>BASE_URL=\\\${CLIENT_CONFIG.WORKER_ORIGIN}<br>CUSTOM_MODELS=\\\${CLIENT_CONFIG.CUSTOM_MODELS_STRING}</code></pre>\`; }
      }
      customElements.define('client-guides', ClientGuides);
      class ModelListPanel extends BaseComponent {
        constructor() { super('model-list-panel-template'); this.container = this.shadowRoot.querySelector('.model-list-container'); }
        connectedCallback() { this.render(); }
        render() {
          const categories = { '文生文 (Chat)': CLIENT_CONFIG.CHAT_MODELS, '文生图 (Image)': CLIENT_CONFIG.IMAGE_MODELS, '文生视频 (Video)': CLIENT_CONFIG.VIDEO_MODELS };
          for (const [title, models] of Object.entries(categories)) {
            if (models.length > 0) {
              const categoryDiv = document.createElement('div');
              categoryDiv.className = 'model-category';
              categoryDiv.innerHTML = \`<h3>\${title}</h3><ul class="model-list">\${models.map(m => \`<li>\${m}</li>\`).join('')}</ul>\`;
              this.container.appendChild(categoryDiv);
            }
          }
        }
      }
      customElements.define('model-list-panel', ModelListPanel);
      class LiveTerminal extends BaseComponent {
        constructor() {
          super('live-terminal-template');
          this.activeMode = 'chat';
          this.output = this.shadowRoot.querySelector('.output-window');
          this.btn = this.shadowRoot.getElementById('submit-btn');
          this.tabs = this.shadowRoot.querySelectorAll('.mode-tab');
          this.panels = this.shadowRoot.querySelectorAll('.tab-content');
         
          this.inputs = {
            chat: { model: this.shadowRoot.getElementById('chat-model-select'), prompt: this.shadowRoot.getElementById('chat-prompt-input') },
            image: { model: this.shadowRoot.getElementById('image-model-select'), prompt: this.shadowRoot.getElementById('image-prompt-input') },
            video: { model: this.shadowRoot.getElementById('video-model-select'), prompt: this.shadowRoot.getElementById('video-prompt-input'), size: this.shadowRoot.getElementById('video-size-input'), seconds: this.shadowRoot.getElementById('video-seconds-input') }
          };
          this.sendIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.949a.75.75 0 00.95.544l3.239-1.281a.75.75 0 000-1.39L4.23 6.28a.75.75 0 00-.95-.545L1.865 3.45a.75.75 0 00.95-.826l.002-.007.002-.006zm.002 14.422a.75.75 0 00.95.826l1.415-2.28a.75.75 0 00-.545-.95l-3.239-1.28a.75.75 0 00-1.39 0l-1.28 3.239a.75.75 0 00.544.95l4.95 1.414zM12.75 8.5a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-5.5z"/></svg>';
          this.cancelIcon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"/></svg>';
        }
        connectedCallback() {
          this.btn.addEventListener('click', () => this.handleSubmit());
          this.tabs.forEach(tab => tab.addEventListener('click', () => this.switchMode(tab.dataset.mode)));
          this.populateModels();
        }
        populateModels() {
          this.populateSelect(this.inputs.chat.model, CLIENT_CONFIG.CHAT_MODELS);
          this.populateSelect(this.inputs.image.model, CLIENT_CONFIG.IMAGE_MODELS);
          this.populateSelect(this.inputs.video.model, CLIENT_CONFIG.VIDEO_MODELS);
        }
        populateSelect(selectEl, models) {
          if (!selectEl || !models || models.length === 0) return;
          selectEl.innerHTML = models.map(m => \`<option value="\${m}">\${m}</option>\`).join('');
        }
        switchMode(mode) {
          this.activeMode = mode;
          this.tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
          this.panels.forEach(p => p.classList.toggle('active', p.id === \`\${mode}-panel\`));
        }
        handleSubmit() {
          if (currentState === AppState.REQUESTING || currentState === AppState.STREAMING) {
            this.cancelRequest();
          } else {
            this.startRequest();
          }
        }
        addMessage(role, content, isHtml = false) {
          const el = document.createElement('div');
          el.className = 'message ' + role;
          if (isHtml) {
            el.innerHTML = content;
          } else {
            el.textContent = content;
          }
          this.output.appendChild(el);
          this.output.scrollTop = this.output.scrollHeight;
          return el;
        }
        async startRequest() {
          const currentInputs = this.inputs[this.activeMode];
          const prompt = currentInputs.prompt.value.trim();
          if (!prompt) return;
          setState(AppState.REQUESTING);
          this.output.innerHTML = '';
          this.addMessage('user', prompt);
          abortController = new AbortController();
          try {
            switch (this.activeMode) {
              case 'chat': await this.handleChatRequest(prompt); break;
              case 'image': await this.handleImageRequest(prompt); break;
              case 'video': await this.handleVideoRequest(prompt); break;
            }
          } catch (e) {
            if (e.name !== 'AbortError') {
              this.addMessage('error', '请求失败: ' + e.message);
              setState(AppState.ERROR);
            }
          } finally {
            if (currentState !== AppState.ERROR && currentState !== AppState.INITIALIZING) {
              setState(AppState.READY);
            }
          }
        }
        async handleChatRequest(prompt) {
          const model = this.inputs.chat.model.value;
          const assistantEl = this.addMessage('assistant', '▍');
         
          const response = await fetch(CLIENT_CONFIG.WORKER_ORIGIN + '/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CLIENT_CONFIG.API_MASTER_KEY },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], stream: true }),
            signal: abortController.signal,
          });
          if (!response.ok) throw new Error((await response.json()).error.message);
          setState(AppState.STREAMING);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let fullResponse = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value);
            const lines = chunk.split('\\n').filter(line => line.startsWith('data:'));
            for (const line of lines) {
              const data = line.substring(5).trim();
              if (data === '[DONE]') { 
                assistantEl.textContent = fullResponse || '（无响应内容）'; 
                // [v1.1.4] 如果fullResponse为空，添加提示
                if (!fullResponse) {
                  this.addMessage('error', '检测到空响应，请检查日志或尝试更详细的提示词。');
                }
                return; 
              }
              try {
                const json = JSON.parse(data);
                const delta = json.choices[0].delta.content;
                if (delta) { fullResponse += delta; assistantEl.textContent = fullResponse + '▍'; this.output.scrollTop = this.output.scrollHeight; }
              } catch (e) {}
            }
          }
          assistantEl.textContent = fullResponse || '（无响应内容）';
          if (!fullResponse) {
            this.addMessage('error', '检测到空响应，请检查日志或尝试更详细的提示词。');
          }
        }
        async handleImageRequest(prompt) {
          const model = this.inputs.image.model.value;
          this.addMessage('assistant', '正在生成图片...');
          const response = await fetch(CLIENT_CONFIG.WORKER_ORIGIN + '/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CLIENT_CONFIG.API_MASTER_KEY },
            body: JSON.stringify({ model, prompt }),
            signal: abortController.signal,
          });
          if (!response.ok) throw new Error((await response.json()).error.message);
          const result = await response.json();
          const b64 = result.data[0].b64_json;
          this.output.innerHTML = '';
          this.addMessage('user', prompt);
          this.addMessage('assistant', \`<img src="data:image/png;base64,\${b64}" alt="Generated Image"> \`, true);
        }
        async handleVideoRequest(prompt) {
          const model = this.inputs.video.model.value;
          const size = this.inputs.video.size.value;
          const seconds = parseInt(this.inputs.video.seconds.value, 10);
          this.addMessage('assistant', '正在请求视频生成...');
          const response = await fetch(CLIENT_CONFIG.WORKER_ORIGIN + '/v1/videos/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + CLIENT_CONFIG.API_MASTER_KEY },
            body: JSON.stringify({ model, prompt, size, seconds }),
            signal: abortController.signal,
          });
          if (!response.ok) throw new Error((await response.json()).error.message);
          const result = await response.json();
          const url = result.data[0].url;
          this.output.innerHTML = '';
          this.addMessage('user', prompt);
          this.addMessage('assistant', \`<video src="\${url}" controls autoplay muted loop playsinline></video>\`, true);
        }
        cancelRequest() {
          if (abortController) {
            abortController.abort();
            abortController = null;
          }
          setState(AppState.READY);
        }
        updateButton(state) {
          if (state === AppState.REQUESTING || state === AppState.STREAMING) {
            this.btn.innerHTML = this.cancelIcon;
            this.btn.title = "取消";
            this.btn.classList.add('cancel');
            this.btn.disabled = false;
          } else {
            this.btn.innerHTML = this.sendIcon;
            this.btn.title = "发送/生成";
            this.btn.classList.remove('cancel');
            this.btn.disabled = state !== AppState.READY;
          }
        }
      }
      customElements.define('live-terminal', LiveTerminal);
      function setState(newState) {
        currentState = newState;
        const terminal = document.querySelector('live-terminal');
        if (terminal) terminal.updateButton(newState);
      }
      async function healthCheck() {
        const statusIndicator = document.querySelector('main-layout')?.shadowRoot.querySelector('status-indicator');
        if (!statusIndicator) return;
        statusIndicator.setState('checking', '检查服务...');
        try {
          const response = await fetch(CLIENT_CONFIG.WORKER_ORIGIN + '/v1/models', { headers: { 'Authorization': 'Bearer ' + CLIENT_CONFIG.API_MASTER_KEY } });
          if (response.ok) {
            statusIndicator.setState('ok', '服务正常');
            setState(AppState.READY);
          } else {
            const errorData = await response.json();
            throw new Error(errorData.error.message || '未知错误');
          }
        } catch (e) {
          statusIndicator.setState('error', '检查失败');
          setState(AppState.ERROR);
          const terminal = document.querySelector('live-terminal');
          if(terminal) {
            terminal.output.innerHTML = '';
            terminal.addMessage('error', '健康检查失败: ' + e.message);
          }
        }
      }
      document.addEventListener('DOMContentLoaded', () => {
        setState(AppState.INITIALIZING);
        customElements.whenDefined('main-layout').then(() => {
          healthCheck();
        });
      });
    </script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // [v1.1.3] 仅保留标准策略，避免控制台警告
      'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()'
    },
  });
}