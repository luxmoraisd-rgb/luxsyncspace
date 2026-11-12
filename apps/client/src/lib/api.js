const TOKEN_KEY = "luxsyncspace_token";
const LEGACY_TOKEN_KEY = "synapse_token";
const NETWORK_ERROR_MESSAGE = "Unable to connect to the server. Please check your internet connection and try again.";
const NETWORK_ERROR_PATTERN = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|getaddrinfo|failed to fetch|network error/i;
const configuredApiUrl = String(import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
export const API_BASE = configuredApiUrl || "/api";
export const SOCKET_URL = String(import.meta.env.VITE_SOCKET_URL || "").replace(/\/+$/, "") || undefined;
export function socketOptions() {
  return {
    auth: { token: authStore.get() },
    transports: ["websocket"],
    upgrade: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 750,
    reconnectionDelayMax: 5000,
    timeout: 12000
  };
}

export function apiUrl(path = "") {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export const authStore = {
  get: () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) return token;
    const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (legacyToken) {
      localStorage.setItem(TOKEN_KEY, legacyToken);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    }
    return legacyToken;
  },
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
};

export async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  let response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      headers: {
        ...(!isFormData ? { "Content-Type": "application/json" } : {}),
        ...(authStore.get() ? { Authorization: `Bearer ${authStore.get()}` } : {}),
        ...options.headers
      }
    });
  } catch (error) {
    if (error instanceof TypeError) throw new Error(NETWORK_ERROR_MESSAGE);
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login") {
      authStore.clear();
      window.dispatchEvent(new CustomEvent("luxsyncspace:unauthorized"));
    }
    const message = payload.error || "Request failed";
    throw new Error(NETWORK_ERROR_PATTERN.test(message) ? NETWORK_ERROR_MESSAGE : message);
  }
  return payload;
}
