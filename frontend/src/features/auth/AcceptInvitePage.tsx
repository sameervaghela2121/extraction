import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import AuthLayout from "../../layouts/AuthLayout";
import { authApi } from "../../api/auth.api";
import { useAuth } from "../../context/AuthContext";
import { apiErrorMessage } from "../../api/client";

export default function AcceptInvitePage() {
  const { token = "" } = useParams();
  const { applyAuthResult } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const result = await authApi.acceptInvite(token, password);
      applyAuthResult(result);
      navigate("/documents");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not accept invite"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Accept your invite" subtitle="Set a password to activate your account.">
      <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
        <div>
          <label className="field-label">New password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        <div>
          <label className="field-label">Confirm password</label>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
          {busy ? "Activating…" : "Activate account"}
        </button>
      </form>
    </AuthLayout>
  );
}
