import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Eye, LoaderCircle, Trophy, X } from "lucide-react";
import {
  fetchTournamentById,
  type Tournament,
  type TournamentBracketMatch,
} from "../api/tournamentApi";

const ROUND_LABELS = ["Quarterfinals", "Semifinals", "Finals"] as const;

function MatchCard({
  match,
  onReady,
}: {
  match: TournamentBracketMatch;
  onReady: (match: TournamentBracketMatch) => void;
}) {
  const isLive = match.status === "live";
  const isReady = match.status === "ready";
  const statusLabel = isLive ? "Live" : isReady ? "Match Ready" : match.status;

  return (
    <article className="flex min-h-28 flex-col gap-2 rounded-xl border border-(--border) bg-(--bg-secondary) p-3 shadow-sm">
      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-(--text-tertiary)">
        <span>Match {match.position}</span>
        <span className={isLive ? "text-(--success)" : "text-(--text-secondary)"}>
          {statusLabel}
        </span>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-1 text-sm font-semibold">
        <span className={match.winner === match.player_one ? "text-(--accent-primary)" : ""}>
          {match.player_one || "TBD"}
        </span>
        <span className="text-[10px] font-normal text-(--text-tertiary)">vs</span>
        <span className={match.winner === match.player_two ? "text-(--accent-primary)" : ""}>
          {match.player_two || "TBD"}
        </span>
      </div>
      {isLive && match.game_code && (
        <Link
          to={`/spectate/${match.game_code}`}
          className="inline-flex items-center justify-center gap-1 rounded-lg bg-(--accent-dark) px-2 py-1.5 text-xs font-bold hover:bg-(--accent-primary)"
        >
          <Eye size={13} />
          Watch as spectator
        </Link>
      )}
      {isReady && (
        <button
          type="button"
          onClick={() => onReady(match)}
          className="rounded-lg border border-(--accent-primary)/50 px-2 py-1.5 text-xs font-bold text-(--accent-primary) hover:bg-(--accent-primary)/10"
        >
          Match Ready
        </button>
      )}
    </article>
  );
}

export default function TournamentBracketPage() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<TournamentBracketMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [readyMatch, setReadyMatch] = useState<TournamentBracketMatch | null>(null);

  useEffect(() => {
    if (!tournamentId) return;
    let active = true;
    fetchTournamentById(tournamentId)
      .then((data) => {
        if (!active) return;
        setTournament(data);
        setMatches(data.bracket_matches ?? []);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Failed to load bracket");
      });
    return () => {
      active = false;
    };
  }, [tournamentId]);

  const matchesByRound = useMemo(
    () => ROUND_LABELS.map((_, index) => matches.filter((match) => match.round === index + 1)),
    [matches],
  );

  if (error) {
    return <main className="mx-auto max-w-6xl p-6"><p className="text-(--warning)">{error}</p></main>;
  }

  if (!tournament) {
    return <main className="flex min-h-screen items-center justify-center"><LoaderCircle className="animate-spin" /></main>;
  }

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
      <Link to="/tournaments" className="mb-6 inline-flex items-center gap-2 text-sm text-(--text-secondary) hover:text-(--text)">
        <ArrowLeft size={16} /> Back to tournaments
      </Link>
      <header className="mb-8 flex items-start gap-3">
        <Trophy className="mt-1 text-(--accent-primary)" />
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-(--text-tertiary)">Tournament bracket</p>
          <h1 className="text-3xl font-bold">{tournament.title}</h1>
        </div>
      </header>
      <section aria-label="Tournament bracket" className="grid gap-5 md:grid-cols-3">
        {ROUND_LABELS.map((label, index) => (
          <div key={label} className="flex flex-col gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-(--text-secondary)">{label}</h2>
            {matchesByRound[index].length === 0 ? (
              <p className="rounded-xl border border-dashed border-(--border) p-4 text-sm text-(--text-tertiary)">Matches pending</p>
            ) : (
              matchesByRound[index].map((match) => <MatchCard key={match.id} match={match} onReady={setReadyMatch} />)
            )}
          </div>
        ))}
      </section>
      {readyMatch && (
        <div role="dialog" aria-modal="true" aria-labelledby="match-ready-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-(--border) bg-(--bg-secondary) p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="match-ready-title" className="text-xl font-bold">Tournament Match Ready</h2>
                <p className="mt-2 text-sm text-(--text-secondary)">{readyMatch.player_one || "TBD"} vs {readyMatch.player_two || "TBD"}</p>
              </div>
              <button type="button" aria-label="Close" onClick={() => setReadyMatch(null)}><X size={18} /></button>
            </div>
            <button type="button" onClick={() => setReadyMatch(null)} className="mt-6 w-full rounded-xl bg-(--accent-dark) py-2.5 font-bold hover:bg-(--accent-primary)">Continue</button>
          </div>
        </div>
      )}
    </main>
  );
}
