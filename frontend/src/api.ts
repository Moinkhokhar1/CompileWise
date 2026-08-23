export const API_BASE = "http://localhost:4000";

export interface AuthUser {
  token: string;
  id: string;
  name: string;
  role: "FACULTY" | "STUDENT";
}

const STORAGE_KEY = "cc_auth_user";

// NEW: session persistence so refresh doesn't log people out.
export function saveAuth(user: AuthUser) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}

export function loadAuth(): AuthUser | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function signup(name: string, email: string, password: string, role: "FACULTY" | "STUDENT") {
  const res = await fetch(`${API_BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password, role }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.formErrors?.join(", ") || data.error || "Signup failed");
  return data as { token: string; user: { id: string; name: string; role: "FACULTY" | "STUDENT" } };
}

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");
  return data as { token: string; user: { id: string; name: string; role: "FACULTY" | "STUDENT" } };
}

// Shared authed request helper used by both dashboards.
export async function authedFetch(token: string, path: string, opts: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  return res.json();
}