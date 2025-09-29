import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ensureCsrf } from "../../../lib/csrf";

export const runtime = "nodejs";

export async function GET() {
  const uid = cookies().get("uid")?.value;
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = await ensureCsrf(uid);
  return NextResponse.json({ token });
}
