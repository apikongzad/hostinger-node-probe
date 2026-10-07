export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const time = new Date().toISOString();
  const host = request.headers.get("host") ?? "-";
  console.log(`[next-bare] GET /api/health ${time} host=${host}`);
  return Response.json(
    { ok: true, app: "next-bare", time, pid: process.pid },
    { headers: { "X-Probe": "next-bare" } },
  );
}
