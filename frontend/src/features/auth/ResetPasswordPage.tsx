import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AuthLayout from "../../layouts/AuthLayout";
import { authApi } from "../../api/auth.api";
import { useAuth } from "../../context/AuthContext";
import { apiErrorMessage } from "../../api/client";

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { applyAuthResult } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const requestReset = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await authApi.forgotPassword(email);
      setMessage(res.message);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const doReset = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await authApi.resetPassword(token!, password);
      applyAuthResult(result);
      navigate("/documents");
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (token) {
    return (
      <AuthLayout title="Set a new password">
        <form onSubmit={doReset} className="stack" style={{ gap: 14 }}>
          <div>
            <label className="field-label">New password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
            {busy ? "Saving…" : "Save password"}
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Reset password" subtitle="We'll email you a reset link.">
      <form onSubmit={requestReset} className="stack" style={{ gap: 14 }}>
        <div>
          <label className="field-label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {message && <div style={{ color: "var(--success)", fontSize: 13 }}>{message}</div>}
        {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
          {busy ? "Sending…" : "Send reset link"}
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate("/login")}>
          Back to sign in
        </button>
      </form>
    </AuthLayout>
  );
}
