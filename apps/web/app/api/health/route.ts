export const runtime = 'nodejs';
export const revalidate = 0;

export async function GET() {
  return new Response(JSON.stringify({ ok: true, t: Date.now() }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}
