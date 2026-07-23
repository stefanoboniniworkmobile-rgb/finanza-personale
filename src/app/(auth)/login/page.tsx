import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginClient } from "./LoginClient";

/**
 * Server component: prima di mostrare il form controlla se c'è già una sessione
 * valida e in quel caso manda alla dashboard. Questo redirect lo faceva il
 * middleware; ora che il middleware è un pass-through deve stare qui.
 *
 * LoginClient usa useSearchParams (?check=1, ?error=...), che in Next 15
 * richiede un boundary Suspense per non far fallire il prerender.
 */
export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  );
}
