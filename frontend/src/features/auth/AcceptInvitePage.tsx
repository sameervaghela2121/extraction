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
  const [notice, setNotice] = useState("");
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
      // A store manager's account is for the mobile app — the password is set, but we
      // don't start a web session or send them into pages built for other roles.
      if (result.user.role === "store_manager") {
        setNotice("Password set. Sign in from the mobile app.");
        return;
      }
      applyAuthResult(result);
      navigate(result.user.role === "staff" ? "/grn" : "/documents");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not accept invite"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Accept your invite" subtitle="Set a password to activate your account.">
      {notice ? (
        <div style={{ fontSize: 14 }}>{notice}</div>
      ) : (
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
      )}
    </AuthLayout>
  );
}
