import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BoardThemeKey = "classic" | "wood" | "neon" | "marble";
export type PieceSetKey = "standard" | "neo" | "wood" | "pixel";

export interface PieceSet {
	key: PieceSetKey;
	name: string;
	pieces: Record<string, string>;
}

export const PIECE_SETS: PieceSet[] = [
	{
		key: "standard",
		name: "Standard",
		pieces: {
			K: "\u2654", Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
			k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
		},
	},
	{
		key: "neo",
		name: "Neo",
		pieces: {
			K: "\u2654", Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
			k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
		},
	},
	{
		key: "wood",
		name: "Wood",
		pieces: {
			K: "\u2654", Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
			k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
		},
	},
	{
		key: "pixel",
		name: "Pixel",
		pieces: {
			K: "\u2654", Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
			k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
		},
	},
];

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

export type ColorMode = "system" | "dark" | "light";

export function getResolvedColorMode(mode: ColorMode): "dark" | "light" {
	if (mode === "system") {
		if (typeof window !== "undefined" && window.matchMedia) {
			return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
		}
		return "dark";
	}
	return mode;
}

export function applyColorMode(mode: ColorMode) {
	if (typeof document === "undefined") return;
	const resolved = getResolvedColorMode(mode);
	if (resolved === "dark") {
		document.documentElement.classList.add("dark");
	} else {
		document.documentElement.classList.remove("dark");
	}
}

function applyBoardTheme(key: BoardThemeKey) {
	if (typeof document === "undefined") return;
	const theme = BOARD_THEMES.find((t) => t.key === key) ?? BOARD_THEMES[0];
	document.documentElement.dataset.theme = theme.key;
	document.documentElement.style.setProperty("--sq-light", theme.light);
	document.documentElement.style.setProperty("--sq-dark", theme.dark);
}

interface ThemeState {
	boardTheme: BoardThemeKey;
	pieceSet: PieceSetKey;
	colorMode: ColorMode;
	setBoardTheme: (key: BoardThemeKey) => void;
	setPieceSet: (key: PieceSetKey) => void;
	setColorMode: (mode: ColorMode) => void;
}

export const useThemeStore = create<ThemeState>()(
	persist(
		(set) => ({
			boardTheme: DEFAULT_BOARD_THEME,
			pieceSet: "standard" as PieceSetKey,
			colorMode: "system" as ColorMode,
			setBoardTheme: (key) => {
				applyBoardTheme(key);
				set({ boardTheme: key });
			},
			setPieceSet: (key) => set({ pieceSet: key }),
			setColorMode: (mode) => {
				applyColorMode(mode);
				set({ colorMode: mode });
			},
		}),
		{
			name: "chesster_theme",
			partialize: (state) => ({
				boardTheme: state.boardTheme,
				pieceSet: state.pieceSet,
				colorMode: state.colorMode,
			}),
		},
	),
);

// Apply the persisted (or default) board theme and color mode as soon as the module loads.
applyBoardTheme(useThemeStore.getState().boardTheme);
applyColorMode(useThemeStore.getState().colorMode);
