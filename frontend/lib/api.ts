const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("agent-x-token");
}

export function setToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem("agent-x-token", token);
}

export function removeToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("agent-x-token");
}

export function getHeaders(): Record<string, string> {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "X-API-Key": API_KEY,
    "X-Timestamp": Date.now().toString(),
  };
}

export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const url = `${API_BASE}${path}`;
  const headers = {
    ...getHeaders(),
    ...(options.headers || {}),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    // Token expired atau invalid
    removeToken();
    if (typeof window !== "undefined") {
      window.location.href = "/?login=expired";
    }
    throw new Error("Unauthorized");
  }

  if (res.status === 429) {
    throw new Error("Rate limit exceeded. Please slow down.");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

// ── Auth ──
export async function login(username: string, passkey: string) {
  const data = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, passkey }),
  });
  if (data.success && data.token) {
    setToken(data.token);
    if (typeof window !== "undefined") {
      localStorage.setItem("agent-x-user", JSON.stringify(data.user));
    }
  }
  return data;
}

export async function register(userData: {
  username: string;
  passkey: string;
  leverage?: number;
  margin?: number;
  balance?: number;
}) {
  return apiFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(userData),
  });
}

export async function getMe() {
  return apiFetch("/api/auth/me");
}

export async function getUsers() {
  return apiFetch("/api/auth/users");
}

export async function updateUser(userId: string, data: object) {
  return apiFetch(`/api/auth/users/${userId}/update`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ── Bot ──
export async function getBotState(userId?: string) {
  const qs = userId ? `?user=${userId}` : "";
  return apiFetch(`/api/bot/state${qs}`);
}

export async function startBot(config: object, userId?: string) {
  const qs = userId ? `?user=${userId}` : "";
  return apiFetch(`/api/bot/start${qs}`, {
    method: "POST",
    body: JSON.stringify(config),
  });
}

export async function stopBot(userId?: string) {
  const qs = userId ? `?user=${userId}` : "";
  return apiFetch(`/api/bot/stop${qs}`, { method: "POST" });
}

export async function resetBot(userId?: string) {
  const qs = userId ? `?user=${userId}` : "";
  return apiFetch(`/api/bot/reset${qs}`, { method: "POST" });
}

// ── Trading ──
export async function getBalance(userId?: string) {
  const qs = userId ? `?user=${userId}` : "";
  return apiFetch(`/api/trading/balance${qs}`);
}

export async function getPositions(userId?: string) {
  const qs = userId ? `?user=${userId}` : "";
  return apiFetch(`/api/trading/positions${qs}`);
}

export async function getTradeHistory(limit = 50, userId?: string) {
  const qs = userId ? `?user=${userId}&limit=${limit}` : `?limit=${limit}`;
  return apiFetch(`/api/trading/history${qs}`);
}

export async function resetBalance(userId?: string) {
  const qs = userId ? `?user=${userId}` : "";
  return apiFetch(`/api/trading/reset-balance${qs}`, { method: "POST" });
}

// ── History ──
export async function getSignalHistory(limit = 100, userId?: string) {
  const qs = userId ? `?user=${userId}&limit=${limit}` : `?limit=${limit}`;
  return apiFetch(`/api/history/signals${qs}`);
}

export async function getHistorySummary(userId?: string) {
  const qs = userId ? `?user=${userId}` : "";
  return apiFetch(`/api/history/summary${qs}`);
}

// ── Market ──
export async function getContracts(limit?: number) {
  const qs = limit ? `?limit=${limit}` : "";
  return apiFetch(`/api/market/contracts${qs}`);
}

export async function getTicker(symbol: string) {
  return apiFetch(`/api/market/ticker/${symbol}`);
}

export async function getCandles(symbol: string, granularity = "5m", limit = 100) {
  return apiFetch(`/api/market/candles/${symbol}?granularity=${granularity}&limit=${limit}`);
}
