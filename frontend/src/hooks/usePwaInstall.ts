import { useEffect, useRef, useState } from "react";

interface InstallOffer extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isStandalone() {
  return Boolean(window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone);
}

/** A browser install offer is one-use and must be prompted from a user gesture. */
export function usePwaInstall() {
  const [offer, setOffer] = useState<InstallOffer | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const inFlight = useRef(false);

  useEffect(() => {
    active.current = true;
    const beforeInstall = (event: Event) => {
      const candidate = event as InstallOffer;
      if (typeof candidate.prompt !== "function") return;
      event.preventDefault();
      setOffer(candidate);
      setError("");
    };
    const didInstall = () => {
      setInstalled(true);
      setOffer(null);
      setError("");
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", didInstall);
    return () => {
      active.current = false;
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", didInstall);
    };
  }, []);

  async function install() {
    if (!offer || inFlight.current || installed) return;
    inFlight.current = true;
    setOffer(null);
    setInstalling(true);
    setError("");
    try {
      await offer.prompt();
      const choice = await offer.userChoice;
      if (active.current && choice.outcome === "accepted") setInstalled(true);
    } catch {
      if (active.current) setError("Could not install Chesster. Try again when your browser offers installation.");
    } finally {
      inFlight.current = false;
      if (active.current) setInstalling(false);
    }
  }

  return { canInstall: Boolean(offer) && !installed, installed, installing, error, install };
}
