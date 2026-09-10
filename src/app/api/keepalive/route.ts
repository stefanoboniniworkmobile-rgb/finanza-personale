import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Endpoint keep-alive per evitare che Supabase (piano free) metta in pausa il
 * progetto dopo ~7 giorni di inattività. Fa una query banale (`SELECT 1`) così
 * il database conta come "attivo". Chiamato ogni giorno da GitHub Actions
 * (.github/workflows/keepalive.yml).
 *
 * Volutamente senza segreti: espone solo un ping innocuo, nessun dato.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { ok: true, ts: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
