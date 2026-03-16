"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Retailer = {
  id: string;
  name: string;
  channel: string | null;
  banner: string | null;
  hq_region: string | null;
  store_count: number | null;
  cost_of_doing_business: string | null;
  distributor: string | null;
  can_anchor_dc: boolean | null;
  team_owner: string | null;
};

function Field({ label, value }: { label: string; value: any }) {
  const display =
    value === null || value === undefined || value === "" ? "—" : String(value);

  return (
    <div className="border rounded-xl p-4">
      <div className="text-xs tracking-wide text-gray-500 uppercase">{label}</div>
      <div className="mt-2 text-sm">{display}</div>
    </div>
  );
}

export default function RetailerDetailPage() {
  const params = useParams();
  const idParam = params?.id;
  const retailerId = Array.isArray(idParam) ? idParam[0] : idParam;

  const [retailer, setRetailer] = useState<Retailer | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!retailerId) return;

    async function load() {
      setError("");

      const { data, error } = await supabase
        .from("retailers")
        .select(
          "id,name,channel,banner,hq_region,store_count,cost_of_doing_business,distributor,can_anchor_dc,team_owner"
        )
        .eq("id", retailerId)
        .single();

      if (error) {
        setError(error.message);
        setRetailer(null);
        return;
      }

      setRetailer(data as Retailer);
    }

    load();
  }, [retailerId]);

  if (!retailerId) {
    return (
      <div className="p-6">
        <Link href="/retailers" className="underline text-sm">
          ← Back to Retailers
        </Link>
        <p className="mt-4 text-sm text-red-600">No retailer ID in the URL.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href="/retailers" className="underline text-sm">
          ← Back to Retailers
        </Link>
        <h1 className="text-3xl font-bold mt-2">{retailer?.name ?? "Retailer"}</h1>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {retailer && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Channel" value={retailer.channel} />
            <Field label="Retailer" value={retailer.name} />
            <Field label="Banner" value={retailer.banner} />
            <Field label="HQ Region" value={retailer.hq_region} />
            <Field label="Store Count" value={retailer.store_count} />
            <Field label="Cost of Doing Business" value={retailer.cost_of_doing_business} />
            <Field label="Distributor" value={retailer.distributor} />
            <Field
              label="Can Anchor DC"
              value={
                retailer.can_anchor_dc === null
                  ? null
                  : retailer.can_anchor_dc
                  ? "Yes"
                  : "No"
              }
            />
            <Field label="Team Owner" value={retailer.team_owner} />
          </div>
        </>
      )}
    </div>
  );
}