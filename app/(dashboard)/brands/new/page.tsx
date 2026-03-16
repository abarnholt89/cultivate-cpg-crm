"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function NewBrandPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!name) return;

    setLoading(true);

    const { error } = await supabase.from("brands").insert({
      name,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    router.push("/brands");
  }

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Add Brand</h1>

      <input
        className="w-full border rounded p-2 mb-4"
        placeholder="Brand name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <button
        onClick={handleCreate}
        className="bg-black text-white px-4 py-2 rounded"
        disabled={loading}
      >
        {loading ? "Creating..." : "Create Brand"}
      </button>
    </div>
  );
}