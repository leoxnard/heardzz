"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";

/* ------------------------------------------------------------------
   The bar across the top, wherever you are.

   It used to live inside `Game`, which meant it existed only once a round
   did — and the for-you door is a screen with no round on it yet. Somebody
   who opened it could not get back to the daily without the browser's back
   button, which is not navigation, it is escape.

   The right-hand side is whatever the page has to put there: the round
   screens pass their catalogue number and the two panel buttons, the door
   passes nothing. The brand and the nav are the same everywhere, which is
   the point of them.
   ------------------------------------------------------------------ */

export function SiteHeader({ children }: { children?: React.ReactNode }) {
  /*
   * Which link is lit follows the address, not the mode. A sitting built
   * from somebody's taste runs in practice mode, so keying off the mode
   * would light "practice" while they are somewhere else entirely.
   */
  const path = usePathname();

  return (
    <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-ink-edge px-6 py-4 sm:px-10 lg:px-14">
      <Link href="/" className="flex items-center gap-3">
        <span className="block h-4 w-4 bg-flame" aria-hidden="true" />
        <span className="type-display text-xl text-paper">{t("brand")}</span>
      </Link>

      <nav className="flex gap-6">
        <NavLink href="/" active={path === "/"}>{t("nav.daily")}</NavLink>
        <NavLink href="/practice" active={path === "/practice"}>{t("nav.practice")}</NavLink>
        <NavLink href="/for-you" active={path === "/for-you"}>{t("nav.forYou")}</NavLink>
        <NavLink href="/suggest" active={path === "/suggest"}>{t("nav.suggest")}</NavLink>
      </nav>

      {children && <div className="ml-auto flex items-center gap-5">{children}</div>}
    </header>
  );
}

export function NavLink({
  href, active, children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`type-eyebrow border-b-2 pb-[2px] transition-colors duration-150 ${
        active ? "border-flame text-paper" : "border-transparent text-paper-dim hover:text-paper"
      }`}
    >
      {children}
    </Link>
  );
}
