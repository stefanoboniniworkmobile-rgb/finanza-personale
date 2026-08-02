"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

/**
 * Avatar di Boris (scontornato). Click → lightbox che lo ingrandisce.
 * Tooltip: "Engineer Boris".
 */
export function BorisAvatar() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Engineer Boris"
        aria-label="Ingrandisci — Engineer Boris"
        className="shrink-0 w-10 h-10 grid place-items-center rounded-xl bg-bg border border-line hover:ring-2 hover:ring-brand-200 transition"
      >
        <Image
          src="/boris.png"
          alt="Engineer Boris"
          width={36}
          height={36}
          className="object-contain"
        />
      </button>

      {open &&
        mounted &&
        createPortal(
          <div
            className="fp-drawer-backdrop fixed inset-0 z-[60] grid place-items-center p-6"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-label="Engineer Boris"
          >
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="relative flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rounded-3xl bg-white p-4 shadow-2xl">
                <Image
                  src="/boris.png"
                  alt="Engineer Boris"
                  width={220}
                  height={220}
                  className="object-contain"
                />
              </div>
              <div className="mt-3 text-white text-sm font-semibold tracking-tight">
                Engineer Boris 🐱
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
