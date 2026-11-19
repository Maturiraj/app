"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import HeroCountdown from "@/components/landing/HeroCountdown";
import { useAuth } from "@/lib/hooks/useAuth";
import { createClient } from "@/lib/supabase/client";
import { getNavigation, getPrimaryDestination, isWorkScreen, NAV_PATHS, signInPath } from "./navigation";
import styles from "./Nav.module.css";

export default function Nav({ onHome, onPlan, noCountdown = false, sitewide = false, flags = {} }) {
  const pathname = usePathname() ?? NAV_PATHS.home;
  if (isWorkScreen(pathname) || (sitewide && pathname.startsWith("/roditelji/"))) return null;

  // The Skripte layout already mounts Nav for its countdown. The root owns the menu.
  if (!sitewide && (pathname === "/skripte" || pathname.startsWith("/skripte/"))) {
    return noCountdown ? null : <HeroCountdown />;
  }

  return <NavigationBar {...{ pathname, onHome, onPlan, noCountdown, flags }} />;
}

function NavigationBar({ pathname, onHome, onPlan, noCountdown, flags }) {
  const { user, loading, planResolved, userTier, isPaid, isPro } = useAuth();
  const router = useRouter();
  const [adminId, setAdminId] = useState(null);
  const [menu, setMenu] = useState(null);
  const navRef = useRef(null);
  const triggerRef = useRef(null);
  const userId = user?.id;
  const openMenu = menu?.pathname === pathname ? menu.id : null;
  const role = !loading && userId && adminId === userId
    ? "admin"
    : user?.user_metadata?.role === "parent" ? "parent" : "student";
  const groups = getNavigation({ user, role, flags, loading, planResolved, pathname, tier: userTier, isPaid, isPro });
  const learning = groups.find(group => group.id === "learn");
  const admissions = groups.find(group => group.id === "admissions");
  const more = groups.filter(group => group.id !== "learn" && group.id !== "admissions");

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;

    async function readRole() {
      try {
        const { data, error } = await createClient()
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .maybeSingle();
        if (active) setAdminId(!error && data?.role === "admin" ? userId : null);
      } catch {
        if (active) setAdminId(null);
      }
    }

    readRole();
    return () => { active = false; };
  }, [userId]);

  useEffect(() => {
    if (!openMenu) return undefined;
    const dismiss = event => {
      if (!navRef.current?.contains(event.target)) setMenu(null);
    };
    const onKeyDown = event => {
      if (event.key !== "Escape") return;
      setMenu(null);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  function toggleMenu(event, id) {
    triggerRef.current = event.currentTarget;
    setMenu(openMenu === id ? null : { id, pathname });
  }

  function followDestination(event, guestOnly) {
    setMenu(null);
    if (!guestOnly || event.defaultPrevented || event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const { search, hash } = window.location;
    if (!search && !hash) return;
    event.preventDefault();
    router.push(signInPath(pathname + search + hash));
  }

  async function logOut() {
    setMenu(null);
    try {
      await createClient().auth.signOut();
    } finally {
      router.push(NAV_PATHS.home);
      router.refresh();
    }
  }

  function renderGroup(group, menuId, className) {
    if (!group) return null;
    const panelId = `nav-${menuId}`;
    return (
      <div className={className} key={menuId}>
        <button
          type="button"
          className={styles.trigger}
          aria-expanded={openMenu === menuId}
          aria-controls={openMenu === menuId ? panelId : undefined}
          onClick={event => toggleMenu(event, menuId)}
        >
          {group.label}
        </button>
        {openMenu === menuId && (
          <div id={panelId} className={styles.panel}>
            {group.groups
              ? group.groups.map(section => (
                  <div key={section.id}>
                    <p className={styles.heading}>{section.label}</p>
                    {renderLinks(section)}
                  </div>
                ))
              : renderLinks(group)}
          </div>
        )}
      </div>
    );
  }

  function renderLinks(group) {
    return (
      <ul className={styles.list}>
        {group.destinations.map(({ href, path, label, hint, reload, guestOnly }) => (
          <li key={path}>
            {reload ? (
              <a className={styles.link} href={href} onClick={() => setMenu(null)}>{label}</a>
            ) : (
              <Link
                className={styles.link}
                href={href}
                aria-label={hint ? `${label} · ${hint === "Prijava" ? "potrebna prijava" : `potreban paket ${hint}`}` : undefined}
                aria-current={!hint && pathname === path ? "page" : undefined}
                onClick={event => followDestination(event, guestOnly)}
              >
                {label}
                {hint && <span className={styles.hint}>{hint}</span>}
              </Link>
            )}
          </li>
        ))}
        {group.id === "account" && user && (
          <li><button type="button" className={styles.link} onClick={logOut}>Odjava</button></li>
        )}
      </ul>
    );
  }

  const primary = getPrimaryDestination({ user, role, flags });

  return (
    <>
      {!noCountdown && <HeroCountdown />}
      <nav ref={navRef} className={`nav ${styles.bar}`} aria-label="Glavna navigacija">
        {onHome ? (
          <button className={styles.brand} type="button" onClick={onHome}>
            <span className="nav-logo-dot" aria-hidden="true" />maturiraj
          </button>
        ) : (
          <Link
            href={NAV_PATHS.home}
            className={styles.brand}
            aria-current={pathname === NAV_PATHS.home ? "page" : undefined}
            onClick={() => setMenu(null)}
          >
            <span className="nav-logo-dot" aria-hidden="true" />maturiraj<span className={styles.srOnly}> · Početna</span>
          </Link>
        )}

        <div className={styles.desktop}>
          {groups.map(group => renderGroup(group, `desktop-${group.id}`, styles.group))}
        </div>

        <div className={styles.mobile}>
          {renderGroup(learning, "mobile-learn", styles.group)}
          {renderGroup(admissions, "mobile-admissions", styles.group)}
          {renderGroup({ label: "Više", groups: more }, "mobile-more", styles.group)}
        </div>

        {!loading && (
          onPlan && user ? (
            <button type="button" className={styles.primary} onClick={onPlan}>Moj plan</button>
          ) : (
            <Link
              href={primary.href}
              className={styles.primary}
              aria-label={primary.label}
              onClick={() => setMenu(null)}
            >
              <span className={styles.primaryFull}>{primary.label}</span>
              <span className={styles.primaryShort}>{primary.shortLabel}</span>
            </Link>
          )
        )}
      </nav>
    </>
  );
}
