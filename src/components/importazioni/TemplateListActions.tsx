"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTemplate, duplicateTemplate } from "@/app/(app)/importazioni/actions";

export function TemplateListActions({ templateId }: { templateId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onDuplicate = () => {
    startTransition(async () => {
      const r = await duplicateTemplate(templateId);
      if (r.ok) router.push(`/importazioni/templates/${r.id}`);
      else alert(r.error);
    });
  };

  const onDelete = () => {
    if (!confirm("Eliminare questo template? Verranno persi anche i mapping. Lo storico import resta.")) return;
    startTransition(async () => {
      const r = await deleteTemplate(templateId);
      if (!r.ok) alert(r.error);
      else router.refresh();
    });
  };

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        className="btn-ghost text-xs"
        onClick={onDuplicate}
        disabled={pending}
      >
        Duplica
      </button>
      <button
        type="button"
        className="btn-ghost text-xs !text-err-600 hover:!bg-err-50"
        onClick={onDelete}
        disabled={pending}
      >
        Elimina
      </button>
    </div>
  );
}
