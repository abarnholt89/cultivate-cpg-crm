"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { RetailerRow } from "./_components/retailer-row";

export default function ClientBoard() {
  const params = useParams();
  const brandId = params.id as string;
  const router = useRouter();

  const [rows, setRows] = useState<any[]>([]);
  const [brandName, setBrandName] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [brandId]);

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.replace("/login"); return; }
    setUserId(user.id);

    const { data: membership } = await supabase
      .from("brand_users")
      .select("role")
      .eq("user_id", user.id)
      .eq("brand_id", brandId)
      .maybeSingle();
    if (!membership) { router.replace("/brands"); return; }

    const [rowsRes, brandRes] = await Promise.all([
      supabase.from("brand_board_rows").select("*").eq("brand_id", brandId),
      supabase.from("brands").select("id, name").eq("id", brandId).single(),
    ]);

    const sorted = (rowsRes.data ?? []).sort((a: any, b: any) => {
      const aDate = a.latest_message_at ?? a.last_contact_date ?? "";
      const bDate = b.latest_message_at ?? b.last_contact_date ?? "";
      return bDate.localeCompare(aDate);
    });

    setRows(sorted);
    setBrandName(brandRes.data?.name ?? "");
    setLoading(false);
  }

  if (loading) return <div className="p-8 text-sm text-slate-500">Loading…</div>;

  return (
    <div className="max-w-7xl mx-auto px-8 py-6">
      <div className="mb-5">
        <Link href="/brands" className="text-xs text-slate-500 hover:underline">← Back to Brands</Link>
        <h1 className="text-2xl font-medium text-slate-900 mt-2">{brandName} · Board</h1>
        <div className="text-sm text-slate-500 mt-1">{rows.length} retailers</div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[240px_160px_1fr_120px_24px] gap-4 px-5 py-3 bg-slate-50 text-xs text-slate-500 uppercase tracking-wide border-b">
          <div>Retailer</div>
          <div>Status</div>
          <div>Latest message</div>
          <div>Updated</div>
          <div></div>
        </div>
        {rows.map((row: any) => (
          <RetailerRow key={row.retailer_id} row={row} brandId={brandId} userId={userId!} />
        ))}
      </div>
    </div>
  );
}
