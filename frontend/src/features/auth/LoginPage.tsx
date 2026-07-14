import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../../layouts/AuthLayout";
import { useAuth } from "../../context/AuthContext";
import { apiErrorMessage } from "../../api/client";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email, password);
      navigate("/documents");
    } catch (err) {
      setError(apiErrorMessage(err, "Login failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back to your document workspace.">
      <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
        <div>
          <label className="field-label">Email</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div>
          <label className="field-label">Password</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ justifyContent: "center" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <div className="row" style={{ justifyContent: "space-between", fontSize: 13 }}>
          <Link to="/reset-password">Forgot password?</Link>
        </div>
      </form>
    </AuthLayout>
  );
}
