"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { createUserSchema, type CreateUserInput } from "@/lib/admin/createUserSchema";

const FIELDS: { name: keyof CreateUserInput; label: string; type: string }[] = [
  { name: "fullName", label: "Full name", type: "text" },
  { name: "displayName", label: "Display name", type: "text" },
  { name: "username", label: "Username", type: "text" },
  { name: "email", label: "Email", type: "email" },
  { name: "tempPassword", label: "Temporary password", type: "text" },
];

export function CreateUserDialog({
  departments,
}: {
  departments: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { departmentIds: [] },
  });

  function toggleDept(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setValue("departmentIds", [...next], { shouldValidate: true });
      return next;
    });
  }

  function close() {
    setOpen(false);
    setServerError(null);
  }

  async function onSubmit(values: CreateUserInput) {
    setServerError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setServerError(body.error ?? "Failed to create user");
      return;
    }
    reset();
    setSelected(new Set());
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="bg-accent text-white rounded-md px-4 py-2 text-sm font-semibold hover:bg-accent-ink transition-colors"
      >
        + New User
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/30 grid place-items-center z-50 p-4">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSubmit(onSubmit)}
            className="bg-surface border border-border rounded-lg p-6 w-full max-w-[440px] max-h-[90vh] overflow-auto"
          >
            <h2 className="font-semibold text-text mb-4">Create user</h2>

            {serverError && (
              <div className="mb-4 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">
                {serverError}
              </div>
            )}

            {FIELDS.map((f) => (
              <div key={f.name} className="mb-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-text-faint mb-1">
                  {f.label}
                </label>
                <input
                  type={f.type}
                  {...register(f.name)}
                  className="w-full px-3 py-2 rounded-md border border-border bg-surface focus:ring-2 focus:ring-accent outline-none"
                />
                {errors[f.name] && (
                  <p className="text-xs text-dropped-fg mt-1">{errors[f.name]?.message as string}</p>
                )}
              </div>
            ))}

            <label className="block text-xs font-semibold uppercase tracking-wide text-text-faint mb-1.5">
              Departments
            </label>
            <input type="hidden" {...register("departmentIds")} />
            <div className="flex flex-wrap gap-2 mb-1">
              {departments.map((d) => {
                const on = selected.has(d.id);
                return (
                  <button
                    type="button"
                    key={d.id}
                    onClick={() => toggleDept(d.id)}
                    className={
                      "px-3 py-1.5 text-sm font-medium rounded-full border transition-colors " +
                      (on
                        ? "bg-accent-soft text-accent-ink border-accent"
                        : "bg-surface-2 text-text-muted border-border hover:bg-surface")
                    }
                  >
                    {d.name}
                  </button>
                );
              })}
            </div>
            {errors.departmentIds && (
              <p className="text-xs text-dropped-fg mb-2">Select at least one department</p>
            )}
            <p className="text-xs text-text-faint mb-4">Click to assign one or more departments.</p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 text-sm rounded-md border border-border text-text-muted hover:bg-surface-2"
              >
                Cancel
              </button>
              <button
                disabled={isSubmitting}
                className="px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
              >
                {isSubmitting ? "Creating…" : "Create user"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
