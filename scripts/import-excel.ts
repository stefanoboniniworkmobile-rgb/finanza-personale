/**
 * CLI per importare un .xlsm nel DB di un utente specifico.
 *
 * Uso:
 *   npm run import:excel -- --email tu@esempio.it --file ../../registro_spese.xlsm
 *
 * Se l'utente non esiste, viene creato.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { prisma } from "../src/lib/db";
import { importExcelForHolder } from "../src/lib/excel-import";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  if (fallback !== undefined) return fallback;
  console.error(`Argomento mancante: --${name}`);
  process.exit(1);
}

async function main() {
  const email = arg("email");
  const file = arg("file");
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    console.error("File non trovato:", filePath);
    process.exit(1);
  }
  const buf = fs.readFileSync(filePath);

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({ data: { email, locale: "it" } });
    console.log(`Creato nuovo utente: ${user.email} (${user.id})`);
  }

  // Risolvi l'Intestatario (Holder) di destinazione: si può passare --holder NOME,
  // altrimenti viene usato il primo Holder dell'utente; se non esiste, ne creiamo uno "Stefano".
  const holderName = arg("holder", "Stefano");
  let holder = await prisma.holder.findFirst({
    where: { userId: user.id, name: holderName },
  });
  if (!holder) {
    holder = await prisma.holder.create({
      data: { userId: user.id, name: holderName },
    });
    console.log(`Creato nuovo intestatario: ${holder.name} (${holder.id})`);
  }

  console.log(`Importazione da ${filePath} per ${user.email} → ${holder.name}…`);
  const result = await importExcelForHolder(holder.id, buf);
  console.log("Done:", result);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
