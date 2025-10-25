import { apiPost, setToken, clearToken } from "./api";

export async function login(identifier, password) {
  const res = await apiPost("/login", { identifier, password });
  setToken(res.token);
  return res.user;
}

// Allow role selection at sign-up
const VALID_ROLES = ["part-timer", "pm", "admin"];

export async function registerUser({ email, username, name, password, role = "part-timer" }) {
  const pickedRole = VALID_ROLES.includes(role) ? role : "part-timer";
  const res = await apiPost("/register", { email, username, name, password, role: pickedRole });
  setToken(res.token);
  return res.user;
}

export async function forgotPassword(email) {
  return apiPost("/forgot-password", { email });
}

export async function resetPassword(token, password) {
  return apiPost("/reset-password", { token, password });
}

export function logout() {
  clearToken();
}
