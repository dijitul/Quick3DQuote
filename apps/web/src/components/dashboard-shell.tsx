'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  Cog,
  CreditCard,
  Cuboid,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Palette,
  ReceiptText,
  ScrollText,
  Settings,
  Sparkles,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
}

const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Quotes', href: '/quotes', icon: ScrollText },
  { label: 'Materials', href: '/materials', icon: Boxes },
  { label: 'Processes', href: '/processes', icon: Cog },
  { label: 'Branding', href: '/branding', icon: Palette },
  { label: 'Embed', href: '/embed', icon: Cuboid },
  { label: 'Billing', href: '/billing', icon: CreditCard },
  { label: 'Settings', href: '/settings', icon: Settings },
];

interface DashboardShellProps {
  children: ReactNode;
  shopName: string;
  userEmail: string;
}

export function DashboardShell({ children, shopName, userEmail }: DashboardShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  const currentTitle = NAV.find((item) => pathname?.startsWith(item.href))?.label ?? 'Dashboard';

  return (
    <div className="flex min-h-screen w-full bg-neutral-50 dark:bg-neutral-950">
      <aside className="hidden w-60 flex-col border-r border-border bg-card md:flex">
        <SidebarInner pathname={pathname ?? ''} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b border-border bg-card/80 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0">
                <SidebarInner
                  pathname={pathname ?? ''}
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">{shopName}</p>
              <h1 className="text-lg font-semibold">{currentTitle}</h1>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <span
                  aria-hidden
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700"
                >
                  {userEmail.charAt(0).toUpperCase()}
                </span>
                <span className="hidden text-sm font-medium md:inline">{userEmail}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>{userEmail}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/settings">Account settings</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/billing">Billing</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  void handleSignOut();
                }}
                className="text-error focus:text-error"
              >
                <LogOut className="h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 p-4 md:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function SidebarInner({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <Sparkles className="h-5 w-5 text-accent-500" />
        <span className="text-base font-semibold">Quick3DQuote</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href as never}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-fast',
                active
                  ? 'bg-accent-50 text-accent-700 dark:bg-neutral-800'
                  : 'text-neutral-600 hover:bg-neutral-100 hover:text-foreground dark:text-neutral-300 dark:hover:bg-neutral-800',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <Gauge className="h-3.5 w-3.5" />
          <span>v0.1.0 · dev preview</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <ReceiptText className="h-3.5 w-3.5" />
          <Link href="/billing" className="hover:text-foreground">
            Manage subscription
          </Link>
        </div>
      </div>
    </div>
  );
}
