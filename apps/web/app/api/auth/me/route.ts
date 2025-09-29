import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "../../../lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const uid = cookies().get("uid")?.value;
  if (!uid) return NextResponse.json({ user: null }, { status: 401 });
  const u = await prisma.user.findUnique({ where: { id: uid } });
  if (!u) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user: { id: u.id, name: u.name, role: u.role, email: u.email } });
}
