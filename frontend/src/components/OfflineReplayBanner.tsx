import { WifiOff } from "lucide-react";

interface OfflineReplayBannerProps {
  visible: boolean;
}

/**
 * Banner shown when user is replaying a cached game offline.
 * Provides clear notification that the game is loaded from local cache.
 */
export default function OfflineReplayBanner({ visible }: OfflineReplayBannerProps) {
  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Playing from local cache"
      className="fixed top-0 left-0 right-0 z-40 bg-amber-600 text-white px-4 py-3 flex items-center justify-center gap-2"
    >
      <WifiOff size={18} className="shrink-0" />
      <span className="text-sm font-semibold">Playing from local cache</span>
    </div>
  );
}
