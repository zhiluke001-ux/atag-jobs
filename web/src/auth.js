export async function registerUser({
  email,
  username,
  name,
  password,
  phone,
  discord,
  role = "part-timer",
  verificationDataUrl,
}) {
  const VALID_ROLES = ["part-timer", "pm", "admin"];
  const pickedRole = VALID_ROLES.includes(role) ? role : "part-timer";

  const body = {
    email: String(email || "").trim(),
    username: String(username || "").trim(),
    name: String(name || "").trim(),
    password,
    phone: String(phone || "").trim(),
    discord: String(discord || "").trim(),
    role: pickedRole,
    verificationDataUrl, // ✅ required
  };

  const res = await apiPost("/register", body);

  // ✅ DO NOT setToken here (must wait for admin verify)
  return withAvatarFallback(res.user);
}
