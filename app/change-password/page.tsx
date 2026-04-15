"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<{ type: "error" | "success"; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false); // true once session is confirmed

  // Handle Supabase password-reset links: the recovery token lives in the URL hash
  // e.g. /change-password#access_token=...&type=recovery
  useEffect(() => {
    async function bootstrap() {
      const hash = window.location.hash;
      if (hash && hash.includes("type=recovery")) {
        const params = new URLSearchParams(hash.slice(1));
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          // Clear the hash so tokens aren't exposed in history
          window.history.replaceState(null, "", window.location.pathname);
        }
      }
      setReady(true);
    }
    bootstrap();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setStatus({ type: "error", message: "Passwords do not match." });
      return;
    }
    if (password.length < 8) {
      setStatus({ type: "error", message: "Password must be at least 8 characters." });
      return;
    }

    setLoading(true);
    setStatus(null);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      setStatus({ type: "error", message: error.message });
      return;
    }

    setStatus({ type: "success", message: "Password updated. Redirecting…" });
    setTimeout(() => router.replace("/brands"), 1500);
  }

  return (
    <div className="min-h-screen flex" style={{ background: "#f7faf8" }}>
      {/* Left brand panel */}
      <div
        className="hidden lg:flex flex-col justify-between w-1/2 p-12"
        style={{ background: "#123b52" }}
      >
        <div className="flex items-center gap-3">
          <img
            src="/cultivate-icon.jpeg"
            alt="Cultivate"
            width={32}
            height={32}
            className="rounded-md object-contain"
          />
          <span className="text-lg font-bold" style={{ color: "#78f5cd" }}>
            Cultivate CPG
          </span>
        </div>

        <div>
          <h2 className="text-3xl font-bold leading-snug text-white">
            Set your new password
          </h2>
          <p className="mt-3 text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
            Choose a strong password to keep your account secure.
          </p>
        </div>

        <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          © {new Date().getFullYear()} Cultivate CPG
        </p>
      </div>

      {/* Right form panel */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 lg:hidden">
            <img src="/cultivate-icon.jpeg" alt="Cultivate" width={28} height={28} className="rounded object-contain" />
            <span className="font-bold text-base" style={{ color: "#123b52" }}>Cultivate CPG</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold" style={{ color: "#123b52" }}>
              Change Password
            </h1>
            <p className="mt-1 text-sm" style={{ color: "#5b6e7a" }}>
              Enter and confirm your new password below.
            </p>
          </div>

          {status && (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{
                background: status.type === "error" ? "#fef2f2" : "#eefcf6",
                color: status.type === "error" ? "#dc2626" : "#166534",
                border: `1px solid ${status.type === "error" ? "#fecaca" : "#bbf7d0"}`,
              }}
            >
              {status.message}
            </div>
          )}

          {ready && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" style={{ color: "#123b52" }}>
                  New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{ border: "1px solid #e6efea", background: "#fff", color: "#123b52" }}
                  placeholder="Min. 8 characters"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium" style={{ color: "#123b52" }}>
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{ border: "1px solid #e6efea", background: "#fff", color: "#123b52" }}
                  placeholder="Repeat your password"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg py-2.5 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
                style={{ background: "#123b52", color: "#78f5cd" }}
              >
                {loading ? "Updating…" : "Update Password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
