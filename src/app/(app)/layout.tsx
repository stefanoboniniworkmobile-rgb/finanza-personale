import { auth, signOut } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getActiveHolder, listHolders } from "@/lib/holder";
import { HolderSwitcher } from "@/components/layout/HolderSwitcher";
import { UserMenu } from "@/components/layout/UserMenu";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const t = await getTranslations("nav");
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
      <div className="border-b border-[var(--line)] bg-white sticky top-0 z-20">
        <div className="px-4 py-2 flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 grid place-items-center text-white font-bold text-sm">
              €
            </div>
            <div className="font-semibold text-sm tracking-tight">Finanza Personale</div>
          </Link>
          <span className="text-[var(--sub)] text-xs select-none" aria-hidden>
            /
          </span>
          <HolderSwitcher
            holders={allHolders.map((h) => ({ id: h.id, name: h.name }))}
            activeId={activeHolder.id}
          />
          <div className="flex-1" />
          <input
            className="input w-72"
            placeholder="Cerca movimenti, conti, categorie…"
          />
          <Link className="btn-ghost grid place-items-center" href="/impostazioni">
            ⚙
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
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 border-r border-[var(--line)] bg-white min-h-[calc(100vh-49px)] py-3 px-2">
          <SidebarSection title={t("general")}>
            <NavLink href="/dashboard" icon="▦">{t("dashboard")}</NavLink>
            <NavLink href="/movimenti" icon="⇋">{t("movimenti")}</NavLink>
            <NavLink href="/budget" icon="◫">{t("budget")}</NavLink>
            <NavLink href="/forecast" icon="◢">{t("forecast")}</NavLink>
            <NavLink href="/mercati" icon="◊">Mercati</NavLink>
          </SidebarSection>
          <SidebarSection title={t("anagrafiche")}>
            <NavLink href="/conti" icon="▤">{t("conti")}</NavLink>
            <NavLink href="/categorie" icon="▥">{t("categorie")}</NavLink>
            <NavLink href="/modalita" icon="▪">{t("modalita")}</NavLink>
          </SidebarSection>
          <SidebarSection title="Strumenti">
            <NavLink href="/importazioni" icon="↥">Importazioni</NavLink>
            <NavLink href="/importazioni/templates" icon="◳">Template import</NavLink>
            <NavLink href="/impostazioni/banche" icon="⇆">Banche</NavLink>
          </SidebarSection>
          <SidebarSection title={t("system")}>
            <NavLink href="/impostazioni" icon="⚙">{t("impostazioni")}</NavLink>
          </SidebarSection>
        </aside>

        <main className="flex-1 min-w-0 p-5">{children}</main>
      </div>
    </div>
  );
}

function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sub)] px-2 mb-1 mt-2">
        {title}
      </div>
      {children}
    </>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-[var(--ink2)] hover:bg-[var(--line2)] hover:text-[var(--ink)] transition"
    >
      <span className="w-4 opacity-70">{icon}</span>
      <span>{children}</span>
    </Link>
  );
}
