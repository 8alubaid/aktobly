import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import type { Option } from "../lib/options";

export function IconButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button
      type="button"
      className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-1.5 text-[12px] text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Select({
  options,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { options: Option[] }) {
  return (
    <select
      className={`h-8 min-w-0 truncate rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[12.5px] text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus:border-accent dark:border-zinc-700/80 dark:bg-zinc-800/60 dark:text-zinc-200 dark:hover:border-zinc-600 ${className}`}
      {...props}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1 font-sans text-[10px] text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
      {children}
    </kbd>
  );
}

export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <rect x="64" y="64" width="896" height="896" rx="200" className="fill-zinc-900 dark:fill-zinc-100" />
      <path
        d="M512 248 L716 776 H624 L580 656 H444 L400 776 H308 Z M472 580 H552 L512 466 Z"
        className="fill-zinc-50 dark:fill-zinc-900"
      />
      <circle cx="742" cy="300" r="52" fill="#a78bfa" />
    </svg>
  );
}
