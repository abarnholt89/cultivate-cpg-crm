"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | null;

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const brandMatch = pathname?.match(/^\/brands\/([^/]+)/);
const brandId = brandMatch ? brandMatch[1] : null;

  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<Role>(null);
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function check() {
      const { data: sessionData } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!sessionData.session) {
        const next = encodeURIComponent(pathname || "/brands");
        router.replace(`/login?next=${next}`);
        return;
      }

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;

      if (!userId) {
        const next = encodeURIComponent(pathname || "/brands");
        router.replace(`/login?next=${next}`);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (!mounted) return;

      if (profileError) {
        setRole(null);
        setInboxCount(0);
        setReady(true);
        return;
      }

      const nextRole = (profile?.role as Role) ?? null;
      setRole(nextRole);
      setReady(true);
    }

    check();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      check();
      loadInboxCount();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router, pathname]);

  useEffect(() => {
    if (!ready) return;
    loadInboxCount();
  }, [ready, pathname, role]);

  async function loadInboxCount() {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;

    if (!userId) {
      setInboxCount(0);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (profileError) {
      setInboxCount(0);
      return;
    }

    const nextRole = (profile?.role as Role) ?? null;
    setRole(nextRole);

    // Clients do not use the rep/admin inbox.
    if (nextRole === "client") {
      setInboxCount(0);
      return;
    }

    // For launch: admins and reps only see badge counts for their owned retailers.
    const { data: ownedRetailers, error: ownedRetailersError } = await supabase
      .from("retailers")
      .select("id")
      .eq("rep_owner_user_id", userId);

    if (ownedRetailersError) {
      setInboxCount(0);
      return;
    }

    const retailerIds = (ownedRetailers ?? []).map((r) => r.id);

    if (retailerIds.length === 0) {
      setInboxCount(0);
      return;
    }

    const { data: messageRows, error: messagesError } = await supabase
      .from("brand_retailer_messages")
      .select("id")
      .eq("visibility", "client")
      .in("retailer_id", retailerIds)
      .order("created_at", { ascending: false })
      .limit(100);

    if (messagesError) {
      setInboxCount(0);
      return;
    }

    const messages = (messageRows ?? []) as { id: string }[];

    if (messages.length === 0) {
      setInboxCount(0);
      return;
    }

    const messageIds = messages.map((m) => m.id);

    const { data: readRows, error: readError } = await supabase
      .from("message_reads")
      .select("message_id")
      .eq("user_id", userId)
      .in("message_id", messageIds);

    if (readError) {
      setInboxCount(messages.length);
      return;
    }

    const readIds = new Set((readRows ?? []).map((r) => r.message_id));
    const unreadCount = messages.filter((m) => !readIds.has(m.id)).length;

    setInboxCount(unreadCount);
  }

  const isActive = (href: string) => pathname?.startsWith(href);

  const linkClass = (href: string) =>
    `relative text-sm transition-colors ${
      isActive(href)
        ? "font-semibold text-foreground"
        : "text-muted-foreground hover:text-foreground"
    }`;

  if (!ready) {
    return (
      <div className="min-h-screen bg-background p-6 text-sm text-muted-foreground">
        Checking session…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="border-b border-border bg-card">
        <div className="flex items-center gap-4 px-6 py-4">
          <img
            src="/cultivate-icon.jpeg"
            alt="Cultivate"
            width={26}
            height={26}
            className="h-[26px] w-[26px] object-contain"
          />

          <Link href="/brands" className={linkClass("/brands")}>
            <span className="relative inline-block pb-1">
              Brands
              {isActive("/brands") && (
                <span className="absolute -bottom-[17px] left-0 h-[3px] w-full rounded-full bg-primary" />
              )}
            </span>
          </Link>

          {role !== "client" ? (
            <Link href="/inbox" className={linkClass("/inbox")}>
              <span className="relative inline-flex items-center gap-2 pb-1">
                <span>Inbox</span>
                {inboxCount > 0 && (
                  <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-foreground">
                    {inboxCount}
                  </span>
                )}
                {isActive("/inbox") && (
                  <span className="absolute -bottom-[17px] left-0 right-0 h-[3px] rounded-full bg-primary" />
                )}
              </span>
            </Link>
          ) : null}

          <Link href="/promotions" className={linkClass("/promotions")}>
            <span className="relative inline-block pb-1">
              Promotions
              {isActive("/promotions") && (
                <span className="absolute -bottom-[17px] left-0 h-[3px] w-full rounded-full bg-primary" />
              )}
            </span>
          </Link>
          {brandId && (
  <Link
    href={`/brands/${brandId}/category-review`}
    className={linkClass(`/brands/${brandId}/category-review`)}
  >
    <span className="relative inline-block pb-1">
      Category Review
      {isActive(`/brands/${brandId}/category-review`) && (
        <span className="absolute -bottom-[17px] left-0 h-[3px] w-full rounded-full bg-primary" />
      )}
    </span>
  </Link>
)}

          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
            className="ml-auto text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Logout
          </button>
        </div>
      </div>

      <div>{children}</div>
    </div>
  );
}