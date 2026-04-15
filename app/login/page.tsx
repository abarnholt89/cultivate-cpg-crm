"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/brands";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setStatus({ type: "error", message: error.message });
      return;
    }

    router.replace(next);
    router.refresh();
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/change-password`,
    });

    setLoading(false);

    if (error) {
      setStatus({ type: "error", message: error.message });
      return;
    }

    setStatus({ type: "success", message: "Check your email for a password reset link." });
    setShowForgot(false);
  }

  return (
    <div className="min-h-screen flex" style={{ background: "#f7faf8" }}>
      {/* ── Left brand panel ── */}
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

        <div className="space-y-4">
          <h2 className="text-4xl font-bold leading-tight text-white">
            Your brand's growth,<br />tracked in real time.
          </h2>
          <p className="text-base" style={{ color: "rgba(255,255,255,0.65)" }}>
            Monitor retailer relationships, category reviews, and account status
            in one place — built for CPG brands and the reps who grow them.
          </p>
        </div>

        <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          © {new Date().getFullYear()} Cultivate CPG. All rights reserved.
        </p>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-6">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 lg:hidden">
            <img src="/cultivate-icon.jpeg" alt="Cultivate" width={28} height={28} className="rounded object-contain" />
            <span className="font-bold text-base" style={{ color: "#123b52" }}>Cultivate CPG</span>
          </div>

          <div>
            <h1 className="text-2xl font-bold" style={{ color: "#123b52" }}>
              {showForgot ? "Reset Password" : "Welcome back"}
            </h1>
            <p className="mt-1 text-sm" style={{ color: "#5b6e7a" }}>
              {showForgot
                ? "Enter your email and we'll send a reset link."
                : "Sign in to your Cultivate CRM account."}
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

          {showForgot ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" style={{ color: "#123b52" }}>
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{ border: "1px solid #e6efea", background: "#fff", color: "#123b52" }}
                  placeholder="you@example.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg py-2.5 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
                style={{ background: "#123b52", color: "#78f5cd" }}
              >
                {loading ? "Sending…" : "Send Reset Link"}
              </button>

              <button
                type="button"
                onClick={() => { setShowForgot(false); setStatus(null); }}
                className="w-full text-sm underline"
                style={{ color: "#5b6e7a" }}
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" style={{ color: "#123b52" }}>
                  Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{ border: "1px solid #e6efea", background: "#fff", color: "#123b52" }}
                  placeholder="you@example.com"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium" style={{ color: "#123b52" }}>
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setShowForgot(true); setForgotEmail(email); setStatus(null); }}
                    className="text-xs underline"
                    style={{ color: "#5b6e7a" }}
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2"
                  style={{ border: "1px solid #e6efea", background: "#fff", color: "#123b52" }}
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg py-2.5 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
                style={{ background: "#123b52", color: "#78f5cd" }}
              >
                {loading ? "Signing in…" : "Sign In"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm" style={{ color: "#5b6e7a" }}>Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
