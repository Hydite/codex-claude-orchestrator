const DEFAULT_TIMEOUT_MS = 15_000;

function errorText(result) {
  return result?.content
    ?.map((item) => item?.text)
    .filter(Boolean)
    .join("\n") || "工具调用失败";
}

export function createMcpBridge(hostWindow = window, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const pending = new Map();
  let requestId = 0;

  const onMessage = (event) => {
    const message = event.data;
    if (message?.jsonrpc === "2.0" && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      hostWindow.clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || "MCP bridge error"));
      else request.resolve(message.result);
    }
  };

  hostWindow.addEventListener("message", onMessage);

  const request = (method, params) => {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timer = hostWindow.setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`MCP bridge timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      hostWindow.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
    });
  };

  return {
    async callTool(name, args = {}) {
      let result;
      if (hostWindow.openai?.callTool) {
        result = await hostWindow.openai.callTool(name, args);
      } else {
        result = await request("tools/call", { name, arguments: args });
      }
      if (result?.isError) throw new Error(errorText(result));
      return result;
    },
    async sendMessage(text) {
      if (hostWindow.openai?.sendFollowUpMessage) return hostWindow.openai.sendFollowUpMessage({ prompt: text });
      return request("ui/message", { role: "user", content: [{ type: "text", text }] });
    },
    subscribeToolResults(listener) {
      const handle = (event) => {
        const message = event.data;
        if (message?.method === "ui/notifications/tool-result" && message.params) {
          listener(message.params.structuredContent || message.params);
        }
      };
      hostWindow.addEventListener("message", handle);
      return () => hostWindow.removeEventListener("message", handle);
    },
    destroy() {
      hostWindow.removeEventListener("message", onMessage);
      for (const request of pending.values()) {
        hostWindow.clearTimeout(request.timer);
        request.reject(new Error("MCP bridge disposed"));
      }
      pending.clear();
    }
  };
}

export function structured(result) {
  return result?.structuredContent || result || {};
}
