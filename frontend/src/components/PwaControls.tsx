import { Link } from "react-router-dom";
import { Download, WifiOff } from "lucide-react";
import { usePwaInstall } from "../hooks/usePwaInstall";
import { useOfflineDetection } from "../hooks/useOfflineDetection";

export default function PwaControls() {
  const { canInstall, installing, error, install } = usePwaInstall();
  const offline = useOfflineDetection();
  if (!canInstall && !installing && !error && !offline) return null;

  return (
    <aside aria-label="Chesster app" className="fixed bottom-3 left-3 z-40 max-w-[calc(100vw-1.5rem)] rounded-xl border border-(--border) bg-(--bg-secondary) p-3 shadow-lg">
      {offline && <p className="mb-2 flex items-center gap-2 text-sm"><WifiOff size={16} /> Offline play is available here.</p>}
      <div className="flex flex-wrap gap-2">
        {(canInstall || installing) && (
          <button type="button" disabled={installing} onClick={() => void install()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-(--accent-dark) px-3 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-(--accent-primary) disabled:opacity-50">
            <Download size={16} /> {installing ? "Installing…" : "Install Chesster"}
          </button>
        )}
        {offline && <Link to="/offline-play" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-(--accent-primary)">Play Stockfish</Link>}
      </div>
      {error && <p role="alert" className="mt-2 max-w-xs text-sm text-red-700 [.dark_&]:text-red-400">{error}</p>}
    </aside>
  );
}
