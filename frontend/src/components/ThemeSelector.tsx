import { useEffect, useState } from "react";
import { Palette, Check } from "lucide-react";
import {
	BOARD_THEMES,
	useThemeStore,
	type BoardThemeKey,
} from "../store/themeStore";

// Re-apply the persisted theme whenever this component mounts (covers cases
// where the store module was re-evaluated and the on-load application was missed).
function useApplyThemeOnMount() {
	const boardTheme = useThemeStore((s) => s.boardTheme);
	useEffect(() => {
		const theme =
			BOARD_THEMES.find((t) => t.key === boardTheme) ?? BOARD_THEMES[0];
		if (typeof document !== "undefined") {
			document.documentElement.style.setProperty("--sq-light", theme.light);
			document.documentElement.style.setProperty("--sq-dark", theme.dark);
		}
	}, [boardTheme]);
}

export default function ThemeSelector() {
	const boardTheme = useThemeStore((s) => s.boardTheme);
	const setBoardTheme = useThemeStore((s) => s.setBoardTheme);
	const [open, setOpen] = useState(false);

	useApplyThemeOnMount();

	const handleSelect = (key: BoardThemeKey) => {
		setBoardTheme(key);
		setOpen(false);
	};

	return (
		<>
			{/* Floating trigger button (bottom-right, above other UI) */}
			<button
				type="button"
				onClick={() => setOpen(true)}
				title="Board theme"
				aria-label="Open board theme picker"
				className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-2 rounded-full bg-(--bg-secondary) border border-(--border) text-(--text-secondary) hover:text-(--text) shadow-lg hover:border-(--accent-primary)/60 transition-colors"
			>
				<Palette size={16} />
				<span className="hidden sm:inline text-xs font-semibold">Theme</span>
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
								<Palette size={16} className="text-(--accent-primary)" />
								Board Theme
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

						<p className="text-xs text-(--text-secondary)">
							Pick a colour scheme for the chessboard. Your choice is saved
							locally and applied instantly.
						</p>

						<div className="grid grid-cols-2 gap-3">
							{BOARD_THEMES.map((theme) => {
								const active = theme.key === boardTheme;
								return (
									<button
										type="button"
										key={theme.key}
										onClick={() => handleSelect(theme.key)}
										className={`relative flex flex-col gap-2 rounded-xl border p-2 text-left transition-colors ${
											active
												? "border-(--accent-primary) ring-1 ring-(--accent-primary)/50"
												: "border-(--border) hover:border-(--accent-primary)/40"
										}`}
										aria-pressed={active}
									>
										<div
											className="h-14 w-full rounded-lg border border-black/10"
											style={{ background: theme.preview }}
										/>
										<div className="flex items-center justify-between">
											<span className="text-sm font-semibold">
												{theme.name}
											</span>
											{active && (
												<Check
													size={16}
													className="text-(--accent-primary)"
												/>
											)}
										</div>
									</button>
								);
							})}
						</div>
					</div>
				</div>
			)}
		</>
	);
}
