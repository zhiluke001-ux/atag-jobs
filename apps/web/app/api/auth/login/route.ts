import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { ensureCsrf } from "../../../lib/csrf";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { email } = await req.json().catch(() => ({}));
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  const u = await prisma.user.findUnique({ where: { email } });
  if (!u) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const res = NextResponse.json({ ok: true, user: { id: u.id, name: u.name, role: u.role, email: u.email } });
  res.cookies.set("uid", u.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 7 * 24 * 3600
  });
  await ensureCsrf(u.id).catch(() => {});
  return res;
}
