"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteForecast, duplicateForecast } from "@/app/(app)/forecast/actions";

export function ForecastListActions({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onDuplicate = () => {
    startTransition(async () => {
      const res = await duplicateForecast(id);
      if (res.ok) {
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  };

  const onDelete = () => {
    if (!confirm(`Eliminare lo scenario "${name}"? L'azione è irreversibile.`)) return;
    startTransition(async () => {
      await deleteForecast(id);
      router.refresh();
    });
  };

  return (
    <div className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onDuplicate}
        disabled={pending}
        className="text-sub hover:text-ink text-xs px-2 py-1 rounded hover:bg-line2"
        title="Duplica scenario"
      >
        ⎘
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="text-sub hover:text-err-600 text-xs px-2 py-1 rounded hover:bg-err-50"
        title="Elimina scenario"
      >
        ✕
      </button>
    </div>
  );
}
