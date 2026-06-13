"use client";

import React from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  type = "button",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60";
  const sizes = { sm: "h-7 px-2.5 text-xs", md: "h-9 px-3.5 text-sm" };
  const variants = {
    default:
      "bg-zinc-200 text-zinc-900 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700",
    primary: "bg-blue-600 text-white hover:bg-blue-500",
    danger:
      "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900",
    ghost:
      "text-zinc-600 hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-800",
  };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(base, sizes[size], variants[variant])}
    >
      {children}
    </button>
  );
}

const LEVEL_STYLES: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  error: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  muted: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
};

export function Badge({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: keyof typeof LEVEL_STYLES;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        LEVEL_STYLES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "muted" }: { tone?: "ok" | "warn" | "error" | "muted" }) {
  const c = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    error: "bg-red-500",
    muted: "bg-zinc-400",
  }[tone];
  return <span className={cn("inline-block h-2.5 w-2.5 rounded-full", c)} />;
}

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-700",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      {children}
      {hint && <span className="text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

export function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-md bg-zinc-950 p-3 text-xs leading-relaxed">
      {diff.split("\n").map((line, i) => {
        const tone =
          line[0] === "+"
            ? "text-emerald-400"
            : line[0] === "-"
              ? "text-red-400"
              : "text-zinc-400";
        return (
          <div key={i} className={tone}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
