export async function api(url, options = {}) {
  const body = options.body;
  const response = await fetch("/api" + url, {
    ...options,
    headers: {
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
    body: body && !(body instanceof FormData) ? JSON.stringify(body) : body,
  });
  const result = await response
    .json()
    .catch(() => ({ error: "服务暂时不可用" }));
  if (!response.ok) {
    const error = new Error(result.error || "请求失败");
    error.status = response.status;
    throw error;
  }
  return result;
}
