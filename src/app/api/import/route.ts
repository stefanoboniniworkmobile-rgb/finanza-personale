import { auth } from "@/auth";
import { importExcelForHolder } from "@/lib/excel-import";
import { getActiveHolder } from "@/lib/holder";
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
  }
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "File mancante" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const holder = await getActiveHolder(session.user.id);
    const result = await importExcelForHolder(holder.id, buf);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("Import error", e);
    return NextResponse.json(
      { error: e?.message || "Import fallito" },
      { status: 500 },
    );
  }
}
