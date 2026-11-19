"use client";

import { useEffect, useState } from "react";

import HeroCountdown from "@/components/landing/HeroCountdown";
import Footer from "@/components/layout/Footer";
import Hero from "@/components/landing/Hero";
import KakoFunkcionira from "@/components/landing/KakoFunkcionira";
import Funkcije from "@/components/landing/Funkcije";
import Testimonijali from "@/components/landing/Testimonijali";
import Compare from "@/components/landing/Compare";
import PlanUcenjaTeaser from "@/components/landing/PlanUcenjaTeaser";
import DanasUcim from "@/components/landing/DanasUcim";
import PredmetiPrijemni from "@/components/landing/PredmetiPrijemni";
import RoditeljiUrgency from "@/components/landing/RoditeljiUrgency";
import Cijene from "@/components/landing/Cijene";
import FAQ from "@/components/landing/FAQ";
import CTA from "@/components/landing/CTA";
import TrialPopup from "@/components/shared/TrialPopup";
import TrialBanner from "@/components/shared/TrialBanner";

const INTRO_SEEN = "maturiraj_intro_seen";
const TRIAL_DISMISSED = "maturiraj_trial_dismissed";

function readPreference(key, fallback = null) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return fallback;
  }
}

function savePreference(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The current page still remembers the choice when persistence is unavailable.
  }
}

function clearIntroRequest() {
  if (new URLSearchParams(window.location.search).get("intro") === "1") {
    window.history.replaceState(window.history.state, "", "/");
  }
}

export default function Page() {
  const [introRequested, setIntroRequested] = useState(false);
  const [IntroScreen, setIntroScreen] = useState(null);
  const [trial, setTrial] = useState("initial");
  const trialDismissed = trial === "dismissed";
  const showIntro = introRequested && IntroScreen !== null;

  useEffect(() => {
    if (readPreference(TRIAL_DISMISSED)) {
      setTrial("dismissed");
      return;
    }
    setTrial("banner");
    const timer = window.setTimeout(() => {
      setTrial(current => current === "banner" ? "popup" : current);
    }, 30000);
    return () => window.clearTimeout(timer);
  }, []);

  function trialDismiss() {
    setTrial("dismissed");
    savePreference(TRIAL_DISMISSED, "1");
  }

  function startTrial() {
    trialDismiss();
    window.location.href = "/discere";
  }

  useEffect(() => {
    if (showIntro) {
      document.body.classList.add('intro-active');
    } else {
      document.body.classList.remove('intro-active');
    }
    return () => document.body.classList.remove('intro-active');
  }, [showIntro]);

  useEffect(() => {
    const forceIntro = new URLSearchParams(window.location.search).get("intro") === "1";
    if (!forceIntro && readPreference(INTRO_SEEN, "true") === "true") return;
    const frame = window.requestAnimationFrame(() => {
      setIntroRequested(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!introRequested) return;
    let cancelled = false;
    import("@/app/components/IntroScreen").then(
      ({ default: Screen }) => {
        if (!cancelled) setIntroScreen(() => Screen);
      },
      () => {
        if (cancelled) return;
        setIntroRequested(false);
        clearIntroRequest();
      }
    );
    return () => { cancelled = true; };
  }, [introRequested]);

  useEffect(() => {
    if (showIntro) return;

    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );

    document.querySelectorAll(".reveal").forEach((el) => obs.observe(el));

    return () => obs.disconnect();
  }, [showIntro]);

  const handleFinishIntro = () => {
    setIntroRequested(false);
    savePreference(INTRO_SEEN, "true");
    clearIntroRequest();
  };

  const goPro = (billing) => {
    const q = billing === "god" || billing === "yearly" ? "god" : "mj";
    window.location.href = `/pro?billing=${q}`;
  };

  const skipIntro = introRequested && (
    <button
      type="button"
      onClick={handleFinishIntro}
      style={{
        position: "fixed", bottom: "max(1rem, env(safe-area-inset-bottom))",
        right: "1rem", zIndex: 10000, padding: "0.65rem 1rem",
        border: "1px solid currentColor", borderRadius: "0.5rem",
        background: "#fff", color: "#182039", cursor: "pointer",
      }}
    >
      Preskoči uvod
    </button>
  );

  if (showIntro) {
    return <>{skipIntro}<IntroScreen onFinish={handleFinishIntro} /></>;
  }

  return (
    <>
      {skipIntro}
      {trial === "popup" && (
        <TrialPopup onStart={startTrial} onDismiss={trialDismiss} />
      )}

      {(trial === "banner" || trial === "popup") && (
        <TrialBanner onStart={startTrial} onDismiss={trialDismiss} />
      )}

      <HeroCountdown />

      <Hero
        onSkripte={() => (window.location.href = "/skripte")}
        onPlan={() => goPro("mj")}
        onChat={() => (window.location.href = "/ai-profesor")}
        onPrijemni={() => (window.location.href = "/prijemni")}
        onKalkulator={() => (window.location.href = "/kalkulator")}
        onTermini={() => (window.location.href = "/termini")}
        trialDismissed={trialDismissed}
        onStartTrial={startTrial}
      />

      <KakoFunkcionira />

      <Funkcije />

      <Testimonijali />

      <Compare onPlan={() => goPro("mj")} />

      <PlanUcenjaTeaser
        onPlanUcenja={() => (window.location.href = "/plan-ucenja")}
        onPlan={() => goPro("mj")}
      />

      <DanasUcim />

      <PredmetiPrijemni
        onSkripte={() => (window.location.href = "/skripte")}
        onPrijemni={() => (window.location.href = "/prijemni")}
      />

      <RoditeljiUrgency
        onRoditelji={() => (window.location.href = "/roditelji")}
        onPlan={() => goPro("mj")}
        onSkripte={() => (window.location.href = "/skripte")}
      />

      <Cijene
        onSkripte={() => (window.location.href = "/skripte")}
        onPlan={goPro}
      />

      <FAQ />

      <CTA
        onSkripte={() => (window.location.href = "/skripte")}
        onPlan={() => goPro("mj")}
      />

      <Footer
        onSkripte={() => (window.location.href = "/skripte")}
        onPlan={() => goPro("mj")}
        onPrijemni={() => (window.location.href = "/prijemni")}
        onKalkulator={() => (window.location.href = "/kalkulator")}
        onTermini={() => (window.location.href = "/termini")}
      />
    </>
  );
}
