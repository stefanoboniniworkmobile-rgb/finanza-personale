import { NextResponse } from "next/server";
import { APP_VERSION, APP_CREDIT } from "@/lib/version";

/**
 * Endpoint pubblico per leggere la versione realmente deployata, senza login.
 * Utile per capire subito se un deploy è andato e se il numero di versione
 * (git rev-list --count HEAD, calcolato al build) si sta incrementando.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { version: APP_VERSION, credit: APP_CREDIT },
    { headers: { "Cache-Control": "no-store" } },
  );
}
