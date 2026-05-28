/**
 * GET /api/psd2/sync-status?jobs=id1,id2,...
 *
 * Endpoint di polling per la UI. Restituisce lo stato corrente dei SyncJob
 * richiesti. La UI in /impostazioni/banche lo chiama ogni 3-5s mentre ci sono
 * job non terminati, poi ferma il polling.
 *
 * Sicurezza: ogni job ritornato deve essere relativo a una BankConnection
 * il cui Holder appartiene all'utente loggato. I jobId di altri utenti
 * vengono silenziosamente filtrati (non si distinguono da "id inesistente").
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const authSession = await auth();
  if (!authSession?.user?.id) {
    return NextResponse.json({ ok: false, error: "Non autenticato" }, { status: 401 });
  }
  const userId = authSession.user.id;

  const url = new URL(req.url);
  const jobsParam = url.searchParams.get("jobs") ?? "";
  const requestedIds = jobsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (requestedIds.length === 0) {
    return NextResponse.json({ ok: true, jobs: [] });
  }

  // Carica solo i job che appartengono all'utente (via Holder della BankConnection)
  const jobs = await prisma.syncJob.findMany({
    where: {
      id: { in: requestedIds },
      bankConnection: {
        holder: { userId },
      },
    },
    select: {
      id: true,
      status: true,
      importedCount: true,
      updatedCount: true,
      healedCount: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
      attemptCount: true,
      bankConnection: {
        select: {
          bankAccount: { select: { id: true, name: true } },
          aspspName: true,
        },
      },
    },
  });

  return NextResponse.json({
    ok: true,
    jobs: jobs.map((j) => ({
      id: j.id,
      status: j.status,
      importedCount: j.importedCount,
      updatedCount: j.updatedCount,
      healedCount: j.healedCount,
      errorMessage: j.errorMessage,
      startedAt: j.startedAt?.toISOString() ?? null,
      finishedAt: j.finishedAt?.toISOString() ?? null,
      attemptCount: j.attemptCount,
      bankAccountId: j.bankConnection.bankAccount.id,
      bankAccountName: j.bankConnection.bankAccount.name,
      aspspName: j.bankConnection.aspspName,
    })),
  });
}
