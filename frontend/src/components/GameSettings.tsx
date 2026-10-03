import { useState } from "react";
import { Settings, X } from "lucide-react";
import { useGameStore } from "../store/gameStore";

export default function GameSettings() {
	const isBlindfoldMode = useGameStore((s) => s.isBlindfoldMode);
	const toggleBlindfoldMode = useGameStore((s) => s.toggleBlindfoldMode);
	const isStreamerMode = useGameStore((s) => s.isStreamerMode);
	const toggleStreamerMode = useGameStore((s) => s.toggleStreamerMode);
	const [open, setOpen] = useState(false);

	return (
		<>
			{/* Floating trigger button */}
			<button
				type="button"
				onClick={() => setOpen(true)}
				title="Game settings"
				aria-label="Open game settings"
				className="fixed bottom-20 right-4 z-40 flex items-center justify-center w-10 h-10 rounded-full bg-(--bg-secondary) border border-(--border) text-(--text-secondary) hover:text-(--text) shadow-lg hover:border-(--accent-primary)/60 transition-colors"
			>
				<Settings size={16} />
			</button>

			{open && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
					onClick={() => setOpen(false)}
				>
					<div
						className="w-full max-w-sm bg-(--bg-secondary) border border-(--border) rounded-2xl p-6 flex flex-col gap-5 shadow-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-center justify-between">
							<h3 className="text-base font-bold flex items-center gap-2">
								<Settings size={16} className="text-(--accent-primary)" />
								Game Settings
							</h3>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="text-(--text-tertiary) hover:text-(--text) transition-colors text-lg leading-none"
								aria-label="Close"
							>
								×
							</button>
						</div>

						{/* Blindfold Mode Toggle */}
						<div className="flex flex-col gap-3">
							<div className="flex items-center justify-between">
								<div className="flex flex-col gap-1">
									<label className="text-sm font-semibold">
										Blindfold Mode
									</label>
									<p className="text-xs text-(--text-tertiary)">
										Hide piece positions to train calculation
									</p>
								</div>
								<button
									type="button"
									onClick={toggleBlindfoldMode}
									className={`relative flex h-6 w-11 rounded-full transition-colors ${
										isBlindfoldMode
											? "bg-(--accent-primary)"
											: "bg-(--bg-tertiary)"
									}`}
									role="switch"
									aria-checked={isBlindfoldMode}
									aria-label="Toggle blindfold mode"
								>
									<div
										className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
											isBlindfoldMode ? "translate-x-5" : "translate-x-0.5"
										}`}
									/>
								</button>
							</div>
						</div>

						<p className="text-xs text-(--text-secondary) leading-relaxed">
							When enabled, pieces appear as dots. Use the peek button (eye icon) in the action bar to reveal pieces for 2 seconds.
						</p>

						{/* Streamer Mode Toggle */}
						<div className="flex flex-col gap-3 pt-3 border-t border-(--border)">
							<div className="flex items-center justify-between">
								<div className="flex flex-col gap-1">
									<label className="text-sm font-semibold">
										Streamer Mode
									</label>
									<p className="text-xs text-(--text-tertiary)">
										Mask wallet addresses, balances, and wagers for live streaming
									</p>
								</div>
								<button
									type="button"
									onClick={toggleStreamerMode}
									className={`relative flex h-6 w-11 rounded-full transition-colors ${
										isStreamerMode
											? "bg-(--accent-primary)"
											: "bg-(--bg-tertiary)"
									}`}
									role="switch"
									aria-checked={isStreamerMode}
									aria-label="Toggle streamer mode"
								>
									<div
										className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform ${
											isStreamerMode ? "translate-x-5" : "translate-x-0.5"
										}`}
									/>
								</button>
							</div>
						</div>
					</div>
				</div>
			)}
		</>
	);
}
