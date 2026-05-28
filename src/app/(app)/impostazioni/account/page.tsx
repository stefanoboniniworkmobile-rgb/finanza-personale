import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import AccountClient from "./AccountClient";

/**
 * Server component: carica i dati account dell'utente loggato e li passa
 * a AccountClient (interattivo per cambio email + logout).
 */
export default async function AccountPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;

  const [user, sessions, pendingChange] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        createdAt: true,
      },
    }),
    prisma.session.findMany({
      where: { userId, expires: { gt: new Date() } },
      select: { id: true, sessionToken: true, expires: true },
      orderBy: { expires: "desc" },
    }),
    prisma.emailChangeRequest.findFirst({
      where: { userId, used: false, expires: { gt: new Date() } },
      select: { id: true, newEmail: true, expires: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!user) redirect("/login");

  // Identifichiamo la sessione corrente confrontando il sessionToken col cookie.
  // Auth.js v5 espone session.user ma non l'id della sessione direttamente —
  // qui ci basiamo solo sulla data di expires più recente come euristica per
  // marcare "questa sessione" nell'UI. Approccio semplice e sufficiente.
  const currentSessionId = sessions[0]?.id ?? null;

  return (
    <AccountClient
      user={{
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        createdAt: user.createdAt.toISOString(),
      }}
      sessions={sessions.map((s) => ({
        id: s.id,
        expiresIso: s.expires.toISOString(),
        isCurrent: s.id === currentSessionId,
      }))}
      pendingChange={
        pendingChange
          ? {
              id: pendingChange.id,
              newEmail: pendingChange.newEmail,
              expiresIso: pendingChange.expires.toISOString(),
              createdAtIso: pendingChange.createdAt.toISOString(),
            }
          : null
      }
    />
  );
}
