export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const sessionStr = localStorage.getItem("crm-user-session");
  let token = "";
  if (sessionStr) {
    try {
      const parsed = JSON.parse(sessionStr);
      token = parsed?.token || "";
    } catch (e) {
      // ignore
    }
  }

  const url = typeof input === "string" ? input : (input instanceof Request ? input.url : input.toString());
  
  let updatedInit: RequestInit = init || {};
  if (url.startsWith("/api/")) {
    // If it's a Headers object
    if (updatedInit.headers instanceof Headers) {
      if (token) {
        updatedInit.headers.set("Authorization", `Bearer ${token}`);
      }
    } else if (Array.isArray(updatedInit.headers)) {
      if (token) {
        const hasAuth = updatedInit.headers.some(h => h[0].toLowerCase() === "authorization");
        if (!hasAuth) {
          updatedInit.headers.push(["Authorization", `Bearer ${token}`]);
        }
      }
    } else {
      // regular record object
      const headers = { ...(updatedInit.headers || {}) } as Record<string, string>;
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      updatedInit = {
        ...updatedInit,
        headers
      };
    }
  }

  return fetch(input, updatedInit);
}
