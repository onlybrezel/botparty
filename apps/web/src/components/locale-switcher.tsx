'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { localeFromPathname, localizeHref, supportedLocales } from '@/lib/i18n';

type LocaleSwitcherProps = {
  compact?: boolean;
};

export function LocaleSwitcher({ compact = false }: LocaleSwitcherProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = localeFromPathname(pathname || '/');
  const search = searchParams.toString();

  return (
    <div className={`flex items-center gap-1 ${compact ? '' : 'rounded-xl border border-[var(--border)] bg-[var(--card)] p-1'}`}>
      {supportedLocales.map((entry) => {
        const active = entry === locale;
        return (
          <Link
            key={entry}
            href={localizeHref(pathname || '/', entry, search)}
            hrefLang={entry}
            prefetch={false}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
              active
                ? 'bg-[var(--primary)] text-white'
                : compact
                  ? 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                  : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]'
            }`}
            aria-current={active ? 'true' : undefined}
          >
            {entry.toUpperCase()}
          </Link>
        );
      })}
    </div>
  );
}
