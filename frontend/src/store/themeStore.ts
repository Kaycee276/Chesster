import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BoardThemeKey = "classic" | "wood" | "neon" | "marble";

export interface BoardTheme {
	key: BoardThemeKey;
	name: string;
	light: string;
	dark: string;
	/** Swatch preview gradient (CSS) used by the theme picker UI. */
	preview: string;
}

export const BOARD_THEMES: BoardTheme[] = [
	{
		key: "classic",
		name: "Classic",
		light: "#f0d9b5",
		dark: "#b58863",
		preview: "linear-gradient(135deg, #f0d9b5 50%, #b58863 50%)",
	},
	{
		key: "wood",
		name: "Wood",
		light: "#f1d7a8",
		dark: "#a9743a",
		preview: "linear-gradient(135deg, #f1d7a8 50%, #a9743a 50%)",
	},
	{
		key: "neon",
		name: "Neon",
		light: "#15c2b8",
		dark: "#0b1020",
		preview: "linear-gradient(135deg, #15c2b8 50%, #0b1020 50%)",
	},
	{
		key: "marble",
		name: "Marble",
		light: "#eceae3",
		dark: "#5c6370",
		preview: "linear-gradient(135deg, #eceae3 50%, #5c6370 50%)",
	},
];

export const DEFAULT_BOARD_THEME: BoardThemeKey = "classic";

function applyBoardTheme(key: BoardThemeKey) {
	if (typeof document === "undefined") return;
	const theme = BOARD_THEMES.find((t) => t.key === key) ?? BOARD_THEMES[0];
	document.documentElement.style.setProperty("--sq-light", theme.light);
	document.documentElement.style.setProperty("--sq-dark", theme.dark);
}

interface ThemeState {
	boardTheme: BoardThemeKey;
	setBoardTheme: (key: BoardThemeKey) => void;
}

export const useThemeStore = create<ThemeState>()(
	persist(
		(set) => ({
			boardTheme: DEFAULT_BOARD_THEME,
			setBoardTheme: (key) => {
				applyBoardTheme(key);
				set({ boardTheme: key });
			},
		}),
		{
			name: "chesster-theme",
			partialize: (state) => ({ boardTheme: state.boardTheme }),
		},
	),
);

// Apply the persisted (or default) board theme as soon as the module loads so
// the board renders with the correct colours before React mounts.
applyBoardTheme(useThemeStore.getState().boardTheme);
