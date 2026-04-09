"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type AuthorizedRow = {
  retailer_id: string | null;
  retailer_name: string | null;
  authorized_item_count: number;
  authorized_upc_count: number;
};

type BrandRow = {
  id: string;
  name: string;
};

export default function AuthorizedAccountsPage() {
  const params = useParams();
  const idParam = params?.id;
  const brandKey = Array.isArray(idParam) ? idParam[0] : idParam;

  const [rows, setRows] = useState<AuthorizedRow[]>([]);
  const [brandName, setBrandName] = useState("Authorized Accounts");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!brandKey) return;

    async function load() {
      setError("");
      setRows([]);

      // Step 1: load brands and match client-side
      const { data: brands, error: brandsError } = await supabase
        .from("brands")
        .select("id,name");

      if (brandsError) {
        setError(brandsError.message);
        return;
      }

      const matchedBrand = ((brands as BrandRow[]) ?? []).find(
        (b) => b.name.trim().toLowerCase() === String(brandKey).trim().toLowerCase()
      );

      if (!matchedBrand) {
        setError(`Brand not found for "${brandKey}"`);
        return;
      }

      setBrandName(matchedBrand.name);

      // Step 2: load authorized rows by real UUID
      const { data, error } = await supabase
        .from("authorized_accounts_full")
        .select(
          "brand_id, retailer_id, retailer_name, authorized_item_count, authorized_upc_count"
        )
        .eq("brand_id", matchedBrand.id);

      if (error) {
        setError(error.message);
        return;
      }

      setRows((data as AuthorizedRow[]) || []);
    }

    load();
  }, [brandKey]);

  return (
    <div className="p-6 space-y-6">
      <Link href={`/brands/${brandKey}`} className="underline text-sm">
        ← Back to Brand Dashboard
      </Link>

      <div>
        <h1 className="text-2xl font-bold">{brandName} — Authorized Accounts</h1>
        <p className="text-gray-600 mt-1">
          Authorized SKUs and UPC coverage by retailer
        </p>
      </div>

      {error && <div className="text-red-600 text-sm">{error}</div>}

      {rows.length === 0 ? (
        <div className="text-sm text-gray-600">No authorized data loaded yet.</div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <div className="grid grid-cols-4 bg-gray-100 text-sm font-medium p-3">
            <div>Retailer</div>
            <div>Authorized Items</div>
            <div>Authorized UPCs</div>
            <div></div>
          </div>

{rows.map((row, index) => (
  <div
    key={`${row.retailer_id ?? "no-retailer"}-${index}`}
              className="grid grid-cols-4 items-center border-t p-3 text-sm"
            >
              <div className="font-medium">{row.retailer_name || "Retailer"}</div>
              <div>{row.authorized_item_count}</div>
              <div>{row.authorized_upc_count}</div>
<div className="text-right">
  {row.retailer_id ? (
    <Link
      href={`/brands/${brandKey}/retailers/${row.retailer_id}`}
      className="underline"
    >
      Open retailer
    </Link>
  ) : (
    <span className="text-gray-400">Standalone</span>
  )}
</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}