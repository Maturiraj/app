"use client";
import Link from "next/link";
import { useAuth } from "@/lib/hooks/useAuth";
import { NAV_PATHS } from "./navigation";

/**
 * NavUserChip — kompaktni indikator prijavljenog korisnika.
 * Koristiti se u inline <nav> elementima (checklist, formule, termini, itd.)
 * Otvara početni pregled korisnikova računa.
 */
export default function NavUserChip() {
  const { user, loading } = useAuth();
  if (loading || !user) return null;

  const name =
    user.user_metadata?.full_name?.split(" ")[0] ||
    user.email?.split("@")[0] ||
    "Račun";
  const initial = name[0]?.toUpperCase() || "?";

  return (
    <Link
      href={user.user_metadata?.role === "parent" ? NAV_PATHS.parent : NAV_PATHS.dashboard}
      aria-label={`Otvori pregled računa · ${name}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px 4px 4px",
        borderRadius: 99,
        border: "1px solid rgba(75,123,255,0.3)",
        background: "rgba(75,123,255,0.08)",
        textDecoration: "none",
        color: "var(--text)",
        fontSize: 12,
        fontWeight: 600,
        flexShrink: 0,
        transition: "background .15s",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "linear-gradient(135deg, var(--blue), var(--violet))",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 800,
          flexShrink: 0,
        }}
      >
        {initial}
      </span>
      {name}
    </Link>
  );
}
