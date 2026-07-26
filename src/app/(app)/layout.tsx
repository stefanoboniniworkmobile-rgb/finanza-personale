import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Euro, Settings } from "lucide-react";
import { getActiveHolder, listHolders } from "@/lib/holder";
import { HolderSwitcher } from "@/components/layout/HolderSwitcher";
import { UserMenu } from "@/components/layout/UserMenu";
import { SidebarNav } from "@/components/layout/SidebarNav";
import { APP_VERSION, APP_CREDIT } from "@/lib/version";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const initials = (session.user.email || "?")
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  // Intestatario attivo + lista di tutti (per il selettore in topbar)
  const activeHolder = await getActiveHolder(session.user.id!);
  const allHolders = await listHolders(session.user.id!);

  return (
    <div>
      {/* Top bar */}
      <header className="border-b border-line bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 sticky top-0 z-20">
        <div className="h-[52px] px-4 flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2.5 shrink-0"
          >
            <div className="w-8 h-8 rounded-[9px] bg-ink grid place-items-center text-white shadow-sm">
              <Euro size={17} strokeWidth={2.25} />
            </div>
            <span className="font-semibold text-[13.5px] tracking-tight text-ink">
              Finanza&nbsp;Personale
            </span>
          </Link>

          <div className="w-px h-5 bg-line mx-1.5" aria-hidden />

          <HolderSwitcher
            holders={allHolders.map((h) => ({ id: h.id, name: h.name }))}
            activeId={activeHolder.id}
          />

          <div className="flex-1" />

          <Link
            href="/impostazioni"
            aria-label="Impostazioni"
            className="w-8 h-8 grid place-items-center rounded-lg text-sub hover:text-ink hover:bg-line2 transition-colors"
          >
            <Settings size={17} strokeWidth={1.75} />
          </Link>
          <UserMenu
            initials={initials}
            name={session.user.name}
            email={session.user.email ?? ""}
            signOutAction={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          />
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 border-r border-line bg-white min-h-[calc(100vh-52px)] sticky top-[52px] self-start flex flex-col">
          <SidebarNav />
          <div className="mt-auto px-4 py-3 border-t border-line text-[10px] leading-relaxed text-sub">
            <div className="num-mono">v{APP_VERSION}</div>
            <div>{APP_CREDIT}</div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 p-6">{children}</main>
      </div>
    </div>
  );
}
