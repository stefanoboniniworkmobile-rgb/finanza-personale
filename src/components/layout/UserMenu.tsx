"use client";

import { useState } from "react";

export function UserMenu({
  initials,
  name,
  email,
  signOutAction,
}: {
  initials: string;
  name: string | null | undefined;
  email: string;
  signOutAction: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-pink-400 grid place-items-center text-white text-[11px] font-semibold cursor-pointer"
        title="Account"
      >
        {initials}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 mt-1 w-[260px] bg-white border border-line rounded-lg shadow-2xl z-20 py-1">
            <div className="px-3 py-2 border-b border-line2">
              <div className="text-[10px] uppercase tracking-wider text-sub font-semibold mb-0.5">
                Account
              </div>
              {name && (
                <div className="text-sm font-medium text-ink truncate">
                  {name}
                </div>
              )}
              <div
                className="text-[12px] text-sub truncate"
                title={email}
              >
                {email}
              </div>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-bg text-ink"
              >
                Esci
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
