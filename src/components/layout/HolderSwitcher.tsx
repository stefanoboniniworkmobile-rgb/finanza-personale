"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { switchHolder } from "@/app/(app)/holder-actions";

export type HolderOption = { id: string; name: string };

export function HolderSwitcher({
  holders,
  activeId,
}: {
  holders: HolderOption[];
  activeId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const active = holders.find((h) => h.id === activeId);

  const handleSelect = (id: string) => {
    if (id === activeId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await switchHolder(id);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={pending}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-line bg-white hover:bg-bg text-xs transition cursor-pointer"
        title="Cambia intestatario"
      >
        <span className="text-[10px] uppercase tracking-wider text-sub">
          Intestatario
        </span>
        <span className="font-medium text-ink">{active?.name ?? "—"}</span>
        <span className="text-sub text-[10px] ml-0.5">▾</span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 mt-1 w-[260px] bg-white border border-line rounded-lg shadow-2xl z-20 py-1">
            <div className="text-[10px] uppercase tracking-wider text-sub font-semibold px-3 py-1.5">
              Cambia intestatario
            </div>
            {holders.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => handleSelect(h.id)}
                disabled={pending}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-bg flex items-center justify-between ${
                  h.id === activeId ? "font-semibold text-brand-600" : "text-ink"
                }`}
              >
                <span>{h.name}</span>
                {h.id === activeId && <span className="text-[10px]">✓</span>}
              </button>
            ))}
            <div className="border-t border-line2 mt-1 pt-1">
              <Link
                href="/impostazioni/intestatari"
                onClick={() => setOpen(false)}
                className="block px-3 py-1.5 text-xs text-sub hover:bg-bg hover:text-ink"
              >
                Gestisci intestatari…
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
