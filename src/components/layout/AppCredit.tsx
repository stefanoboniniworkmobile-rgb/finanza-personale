import Image from "next/image";
import { APP_VERSION, APP_CREDIT } from "@/lib/version";

/**
 * Riga credito in fondo alla navigazione: la foto di Boris (la vera
 * ispirazione 🐱) accanto a versione e "bBorisLab".
 */
export function AppCredit() {
  return (
    <div className="flex items-center gap-2.5">
      <Image
        src="/boris.jpg"
        alt="Boris, la vera ispirazione"
        title="Boris — la vera ispirazione 🐱"
        width={38}
        height={38}
        className="rounded-lg object-cover shrink-0 border border-line"
      />
      <div className="text-[10px] leading-relaxed text-sub">
        <div className="num-mono">v{APP_VERSION}</div>
        <div>{APP_CREDIT}</div>
      </div>
    </div>
  );
}
