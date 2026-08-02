import { BorisAvatar } from "./BorisAvatar";
import { APP_VERSION, APP_CREDIT } from "@/lib/version";

/**
 * Riga credito in fondo alla navigazione: Boris (scontornato, cliccabile per
 * ingrandirlo) accanto a versione e "bBorisLab".
 */
export function AppCredit() {
  return (
    <div className="flex items-center gap-2.5">
      <BorisAvatar />
      <div className="text-[10px] leading-relaxed text-sub">
        <div className="num-mono">v{APP_VERSION}</div>
        <div>{APP_CREDIT}</div>
      </div>
    </div>
  );
}
