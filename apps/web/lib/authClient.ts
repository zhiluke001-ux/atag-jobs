export type Role = 'PART_TIMER' | 'PM' | 'ADMIN';

export async function loginAndGetRole(email: string): Promise<Role | null> {
  await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ email }),
  });
  const me = await fetch('/api/auth/me', { credentials: 'include' })
    .then(r => r.json())
    .catch(() => null);
  return (me?.user?.role ?? null) as Role | null;
}
