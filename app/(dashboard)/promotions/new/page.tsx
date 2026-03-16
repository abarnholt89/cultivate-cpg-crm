"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Role = "admin" | "rep" | "client" | null;

type BrandOption = {
  id: string;
  name: string;
};

type RetailerOption = {
  id: string;
  name: string;
  banner: string | null;
  distributor: string | null;
  rep_owner_user_id: string | null;
};

function formatDateForInput(value: string | null) {
  if (!value) return "";
  return value.slice(0, 10);
}

export default function NewPromotionPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const [role, setRole] = useState<Role>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [retailers, setRetailers] = useState<RetailerOption[]>([]);

  const [brandId, setBrandId] = useState("");
  const [retailerId, setRetailerId] = useState("");

  const [promoName, setPromoName] = useState("");
  const [promoType, setPromoType] = useState("");
  const [promoStatus, setPromoStatus] = useState("planned");
  const [promoScope, setPromoScope] = useState<"retailer" | "distributor">("retailer");

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [discountPercent, setDiscountPercent] = useState("");
  const [discountAmount, setDiscountAmount] = useState("");
  const [promoTextRaw, setPromoTextRaw] = useState("");
  const [notes, setNotes] = useState("");
  const [skuDescription, setSkuDescription] = useState("");
  const [unitUpc, setUnitUpc] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setStatus("");

      try {
        const { data: authData } = await supabase.auth.getUser();
        const currentUserId = authData?.user?.id ?? null;

        if (!currentUserId) {
          setStatus("You must be signed in.");
          setLoading(false);
          return;
        }

        setUserId(currentUserId);

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", currentUserId)
          .single();

        if (profileError) {
          setStatus(profileError.message);
          setLoading(false);
          return;
        }

        const nextRole = (profile?.role as Role) ?? null;
        setRole(nextRole);

        if (nextRole !== "admin" && nextRole !== "rep") {
          setStatus("You do not have access to create promotions.");
          setLoading(false);
          return;
        }

        const { data: brandRows, error: brandError } = await supabase
          .from("brands")
          .select("id,name")
          .order("name", { ascending: true });

        if (brandError) {
          setStatus(brandError.message);
          setLoading(false);
          return;
        }

        setBrands((brandRows as BrandOption[]) ?? []);

        if (nextRole === "admin") {
          const { data: retailerRows, error: retailerError } = await supabase
            .from("retailers")
            .select("id,name,banner,distributor,rep_owner_user_id")
            .order("name", { ascending: true });

          if (retailerError) {
            setStatus(retailerError.message);
            setLoading(false);
            return;
          }

          setRetailers((retailerRows as RetailerOption[]) ?? []);
        } else {
          const { data: retailerRows, error: retailerError } = await supabase
            .from("retailers")
            .select("id,name,banner,distributor,rep_owner_user_id")
            .eq("rep_owner_user_id", currentUserId)
            .order("name", { ascending: true });

          if (retailerError) {
            setStatus(retailerError.message);
            setLoading(false);
            return;
          }

          setRetailers((retailerRows as RetailerOption[]) ?? []);
        }
      } catch (err: any) {
        setStatus(err?.message || "Failed to load form.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === brandId) ?? null,
    [brands, brandId]
  );

  const selectedRetailer = useMemo(
    () => retailers.find((r) => r.id === retailerId) ?? null,
    [retailers, retailerId]
  );

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    if (role !== "admin" && role !== "rep") {
      setStatus("You do not have access to create promotions.");
      return;
    }

    if (!brandId) {
      setStatus("Please select a brand.");
      return;
    }

    if (promoScope === "retailer" && !retailerId) {
      setStatus("Please select a retailer.");
      return;
    }

    if (!promoType.trim()) {
      setStatus("Please enter a promo type.");
      return;
    }

    if (!promoStatus.trim()) {
      setStatus("Please enter a promo status.");
      return;
    }

    if (!startDate) {
      setStatus("Please enter a start date.");
      return;
    }

    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
      setStatus("Start date is invalid.");
      return;
    }

    const end = endDate ? new Date(endDate) : null;
    if (endDate && (!end || Number.isNaN(end.getTime()))) {
      setStatus("End date is invalid.");
      return;
    }

    const promoYear = start.getFullYear();
    const promoMonth = start.getMonth() + 1;

    setSaving(true);
    setStatus("");

    try {
      const payload = {
        brand_id: brandId,
        retailer_id: promoScope === "retailer" ? retailerId : null,
        brand_name: selectedBrand?.name ?? "",
        retailer_name:
          promoScope === "retailer"
            ? selectedRetailer?.name ?? ""
            : "Distributor Program",
        retailer_banner: promoScope === "retailer" ? selectedRetailer?.banner ?? null : null,
        distributor: selectedRetailer?.distributor ?? null,
        cultivate_rep: role === "rep" ? userId : null,
        sku_description: skuDescription.trim() || "Manual Promotion Entry",
        unit_upc: unitUpc.trim() || null,
        promo_year: promoYear,
        promo_month: promoMonth,
        promo_name: promoName.trim() || null,
        promo_type: promoType.trim(),
        promo_status: promoStatus.trim(),
        promo_scope: promoScope,
        start_date: formatDateForInput(startDate),
        end_date: endDate ? formatDateForInput(endDate) : null,
        discount_percent: discountPercent ? Number(discountPercent) : null,
        discount_amount: discountAmount ? Number(discountAmount) : null,
        promo_text_raw: promoTextRaw.trim() || null,
        notes: notes.trim() || null,
      };

      const { error } = await supabase.from("promotions").insert(payload);

      if (error) {
        setStatus(error.message);
        setSaving(false);
        return;
      }

      router.push("/promotions");
      router.refresh();
    } catch (err: any) {
      setStatus(err?.message || "Failed to save promotion.");
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6">Loading…</div>;
  }

  if (role !== "admin" && role !== "rep") {
    return (
      <div className="p-6 space-y-4">
        <Link className="underline text-sm" href="/promotions">
          ← Back to Promotions
        </Link>
        <div className="text-red-600 text-sm">
          {status || "You do not have access to create promotions."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="space-y-2">
        <Link className="underline text-sm" href="/promotions">
          ← Back to Promotions
        </Link>
        <h1 className="text-3xl font-bold">Add Promotion</h1>
        <p className="text-sm text-gray-500">
          Create a manual promotion entry for future plans, one-off accounts, or planned deals.
        </p>
        {status ? <div className="text-sm text-red-600">{status}</div> : null}
      </div>

      <form onSubmit={handleSave} className="border rounded-xl p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Brand</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
            >
              <option value="">Select brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Promo Scope</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={promoScope}
              onChange={(e) =>
                setPromoScope(e.target.value as "retailer" | "distributor")
              }
            >
              <option value="retailer">Retailer</option>
              <option value="distributor">Distributor</option>
            </select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Retailer</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={retailerId}
              onChange={(e) => setRetailerId(e.target.value)}
              disabled={promoScope === "distributor"}
            >
              <option value="">
                {promoScope === "distributor"
                  ? "Not required for distributor promos"
                  : "Select retailer"}
              </option>
              {retailers.map((retailer) => (
                <option key={retailer.id} value={retailer.id}>
                  {retailer.banner?.trim()
                    ? `${retailer.banner} (${retailer.name})`
                    : retailer.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Promo Name</label>
<select
  className="w-full border rounded px-3 py-2"
  value={promoType}
  onChange={(e) => setPromoType(e.target.value)}
>
  <option value="">Select Promo Type</option>
  <option value="TPR">TPR</option>
  <option value="Feature">Feature</option>
  <option value="Display">Display</option>
  <option value="Digital">Digital</option>
  <option value="Distributor OI">Distributor OI</option>
  <option value="Other">Other</option>
</select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Promo Type</label>
            <select
  className="w-full border rounded px-3 py-2"
  value={promoName}
  onChange={(e) => setPromoName(e.target.value)}
>
  <option value="">Select Promo Name</option>
  <option value="TPR">TPR</option>
  <option value="Feature">Feature</option>
  <option value="Display">Display</option>
  <option value="Digital">Digital</option>
  <option value="Distributor OI">Distributor OI</option>
  <option value="Other">Other</option>
</select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Promo Status</label>
            <select
              className="w-full border rounded px-3 py-2"
              value={promoStatus}
              onChange={(e) => setPromoStatus(e.target.value)}
            >
              <option value="planned">planned</option>
              <option value="submitted">submitted</option>
              <option value="approved">approved</option>
              <option value="live">live</option>
              <option value="complete">complete</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">SKU Description</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={skuDescription}
              onChange={(e) => setSkuDescription(e.target.value)}
              placeholder="Optional assortment / item description"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Start Date</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">End Date</label>
            <input
              type="date"
              className="w-full border rounded px-3 py-2"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Discount %</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded px-3 py-2"
              value={discountPercent}
              onChange={(e) => setDiscountPercent(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Discount $</label>
            <input
              type="number"
              step="0.01"
              className="w-full border rounded px-3 py-2"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">UPC</label>
            <input
              className="w-full border rounded px-3 py-2"
              value={unitUpc}
              onChange={(e) => setUnitUpc(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Promo Text</label>
            <textarea
              className="w-full border rounded px-3 py-2"
              rows={3}
              value={promoTextRaw}
              onChange={(e) => setPromoTextRaw(e.target.value)}
              placeholder="Client-facing promo detail or retailer promo copy"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium">Notes</label>
            <textarea
              className="w-full border rounded px-3 py-2"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal planning notes"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="bg-black text-white px-4 py-2 rounded disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Promotion"}
          </button>

          <Link href="/promotions" className="border px-4 py-2 rounded">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}