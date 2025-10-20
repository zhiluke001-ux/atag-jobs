
import { apiPost, setToken } from "./api";
import { clearToken } from "./api";

export async function login(email) {
  const res = await apiPost("/login", { email });
  setToken(res.token);
  return res.user;
}

export function logout() {
  clearToken();
}
