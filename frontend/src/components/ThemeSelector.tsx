import { useEffect, useState } from "react";
import { Palette, Check, Crown, Sun, Moon, Laptop, Volume2 } from "lucide-react";
import {
	BOARD_THEMES,
	PIECE_SETS,
	useThemeStore,
	type BoardThemeKey,
	type ColorMode,
} from "../store/themeStore";
import { soundService, type SoundPack } from "../services/soundService";

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

const SOUND_PACKS: Array<{ key: SoundPack; name: string; description: string }> = [
	{ key: "wood", name: "Wood", description: "Classic wooden piece sounds" },
	{ key: "plastic", name: "Plastic", description: "Modern plastic piece sounds" },
	{ key: "arcade", name: "Arcade", description: "Retro arcade synth sounds" },
	{ key: "retro", name: "Retro 8-bit", description: "Classic chiptune sounds" },
];

export default function ThemeSelector() {
	const boardTheme = useThemeStore((s) => s.boardTheme);
	const setBoardTheme = useThemeStore((s) => s.setBoardTheme);
	const pieceSet = useThemeStore((s) => s.pieceSet);
	const setPieceSet = useThemeStore((s) => s.setPieceSet);
	const colorMode = useThemeStore((s) => s.colorMode);
	const setColorMode = useThemeStore((s) => s.setColorMode);
	const [open, setOpen] = useState(false);
	const [soundPack, setSoundPack] = useState<SoundPack>(soundService.getSoundPack());

	useApplyThemeOnMount();

	const handleSelect = (key: BoardThemeKey) => {
		setBoardTheme(key);
		setOpen(false);
	};

	const handleSoundPackChange = (pack: SoundPack) => {
		setSoundPack(pack);
		soundService.setSoundPack(pack);
	};

	const handleSoundPreview = (pack: SoundPack) => {
		// Temporarily play the sound with the target pack
		const originalPack = soundService.getSoundPack();
		soundService.setSoundPack(pack);
		soundService.move();
		// Restore the previous pack after a brief delay
		setTimeout(() => {
			soundService.setSoundPack(originalPack);
		}, 200);
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
								Theme Settings
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

						{/* Color Mode / Theme Switch */}
						<div className="flex flex-col gap-2">
							<span className="text-xs font-bold text-(--text-secondary) uppercase tracking-wider">
								Theme Mode
							</span>
							<div className="grid grid-cols-3 gap-2">
								{(
									[
										{ key: "system", label: "System", icon: Laptop },
										{ key: "light", label: "Light", icon: Sun },
										{ key: "dark", label: "Dark", icon: Moon },
									] as const
								).map(({ key, label, icon: Icon }) => {
									const active = colorMode === key;
									return (
										<button
											type="button"
											key={key}
											onClick={() => setColorMode(key as ColorMode)}
											className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border text-xs font-semibold transition-colors ${
												active
													? "border-(--accent-primary) bg-(--accent-primary)/10 text-(--accent-primary) ring-1 ring-(--accent-primary)/50"
													: "border-(--border) text-(--text-secondary) hover:text-(--text) hover:border-(--accent-primary)/40"
											}`}
											aria-pressed={active}
										>
											<Icon size={14} />
											<span>{label}</span>
										</button>
									);
								})}
							</div>
						</div>

						<p className="text-xs text-(--text-secondary)">
							Pick a colour scheme and piece set for the chessboard. Your choice
							is saved locally and applied instantly.
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

						<div className="flex items-center gap-2 mt-2">
							<Crown size={14} className="text-(--accent-primary)" />
							<span className="text-sm font-bold">Piece Set</span>
						</div>

						<div className="grid grid-cols-2 gap-3">
							{PIECE_SETS.map((ps) => {
								const active = ps.key === pieceSet;
								return (
									<button
										type="button"
										key={ps.key}
										onClick={() => setPieceSet(ps.key)}
										className={`relative flex flex-col items-center gap-1 rounded-xl border p-2 text-left transition-colors ${
											active
												? "border-(--accent-primary) ring-1 ring-(--accent-primary)/50"
												: "border-(--border) hover:border-(--accent-primary)/40"
										}`}
										aria-pressed={active}
									>
										<div className="flex gap-0.5 text-lg leading-none">
											<span className="text-white" style={{ textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000" }}>
												{ps.pieces.K}
											</span>
											<span className="text-white" style={{ textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000" }}>
												{ps.pieces.Q}
											</span>
											<span className="text-white" style={{ textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000" }}>
												{ps.pieces.R}
											</span>
										</div>
										<div className="flex items-center justify-between w-full">
											<span className="text-sm font-semibold">{ps.name}</span>
											{active && (
												<Check size={16} className="text-(--accent-primary)" />
											)}
										</div>
									</button>
								);
							})}
						</div>

						<div className="flex items-center gap-2 mt-2">
							<Volume2 size={14} className="text-(--accent-primary)" />
							<span className="text-sm font-bold">Sound Pack</span>
						</div>

						<div className="grid grid-cols-2 gap-3">
							{SOUND_PACKS.map((pack) => {
								const active = pack.key === soundPack;
								return (
									<button
										type="button"
										key={pack.key}
										onClick={() => handleSoundPackChange(pack.key)}
										className={`relative flex flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors ${
											active
												? "border-(--accent-primary) ring-1 ring-(--accent-primary)/50"
												: "border-(--border) hover:border-(--accent-primary)/40"
										}`}
										aria-pressed={active}
									>
										<div className="flex items-start justify-between">
											<div>
												<div className="text-sm font-semibold">{pack.name}</div>
												<div className="text-xs text-(--text-secondary) mt-0.5">{pack.description}</div>
											</div>
											{active && (
												<Check size={16} className="text-(--accent-primary) flex-shrink-0" />
											)}
										</div>
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												handleSoundPreview(pack.key);
											}}
											className="mt-1 px-2 py-1 rounded bg-(--bg-tertiary) hover:bg-(--bg-tertiary)/80 text-xs font-semibold text-(--text-secondary) hover:text-(--text) transition-colors border border-(--border) hover:border-(--accent-primary)/40"
											title="Preview this sound pack"
										>
											Test Sound
										</button>
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
