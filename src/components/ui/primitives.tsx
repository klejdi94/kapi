import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import clsx from 'clsx';

/* ------------------------------------------------------------------ button */

type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap ' +
  'transition-[background-color,border-color,color,opacity,transform] duration-100 active:scale-[0.97] ' +
  'disabled:opacity-40 disabled:pointer-events-none disabled:active:scale-100 select-none';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:brightness-110 active:brightness-95 shadow-sm',
  default: 'bg-surface-2 text-fg border border-line hover:bg-surface-3 hover:border-line-strong',
  ghost: 'text-dim hover:text-fg hover:bg-surface-2',
  subtle: 'bg-surface-3 text-fg hover:brightness-110',
  danger: 'bg-transparent text-danger border border-line hover:bg-danger/10 hover:border-danger/40',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-6.5 px-2 text-[11.5px]',
  md: 'h-8 px-3 text-[12.5px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', className, ...props },
  ref,
) {
  return <button ref={ref} type="button" className={clsx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)} {...props} />;
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  tone?: 'default' | 'danger';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, tone = 'default', className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      className={clsx(
        'inline-flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded transition-colors duration-100',
        'disabled:opacity-30 disabled:pointer-events-none',
        active ? 'bg-surface-3 text-fg' : 'text-faint hover:text-fg hover:bg-surface-2',
        tone === 'danger' && 'hover:text-danger',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/* ------------------------------------------------------------------- input */

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      autoComplete="off"
      className={clsx(
        'h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[12.5px] text-fg',
        'transition-colors duration-100 hover:border-line-strong focus:border-accent focus:outline-none',
        className,
      )}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className={clsx('relative', className)}>
      <select
        ref={ref}
        className={clsx(
          'h-8 w-full cursor-pointer appearance-none rounded-md border border-line bg-surface pl-2.5 pr-7 text-[12.5px]',
          'transition-colors duration-100 hover:border-line-strong focus:border-accent focus:outline-none',
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-faint"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <path d="M3 4.5 6 7.5 9 4.5" />
      </svg>
    </div>
  );
});

/* -------------------------------------------------------------- segmented */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  count?: number;
  dot?: boolean;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx('flex items-center gap-0.5', className)} role="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={clsx(
              'relative inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px] font-medium transition-colors duration-100',
              selected ? 'bg-surface-3 text-fg' : 'text-dim hover:text-fg hover:bg-surface-2',
            )}
          >
            {option.label}
            {option.count !== undefined && option.count > 0 && (
              <span className="tnum rounded-full bg-accent/18 px-1.5 text-[10px] font-semibold text-accent">{option.count}</span>
            )}
            {option.dot && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ misc */

export function Badge({
  children,
  tone = 'dim',
  className,
  title,
}: {
  children: ReactNode;
  tone?: 'ok' | 'warn' | 'danger' | 'info' | 'accent' | 'dim';
  className?: string;
  title?: string;
}) {
  const tones = {
    ok: 'text-ok bg-ok/12',
    warn: 'text-warn bg-warn/12',
    danger: 'text-danger bg-danger/12',
    info: 'text-info bg-info/12',
    accent: 'text-accent bg-accent/14',
    dim: 'text-dim bg-surface-3',
  } as const;
  return (
    <span
      title={title}
      className={clsx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide', tones[tone], className)}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin-slow', className)} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('flex flex-col gap-1.5', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wider text-faint">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] leading-snug text-faint">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={clsx('flex cursor-pointer items-start gap-2.5', disabled && 'cursor-not-allowed opacity-50')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[12.5px] leading-tight text-fg">{label}</span>
        {hint && <span className="text-[11.5px] leading-snug text-faint">{hint}</span>}
      </span>
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode;
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 py-10 text-center">
      {icon && <div className="text-faint opacity-60">{icon}</div>}
      <div className="max-w-md space-y-1.5">
        <p className="text-[13px] font-medium text-dim">{title}</p>
        {detail && <p className="text-[12px] leading-relaxed text-faint">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

/** Renders ⌘K-style hints without every caller repeating the styling. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-sans text-[10.5px] font-medium text-faint">
      {children}
    </kbd>
  );
}
