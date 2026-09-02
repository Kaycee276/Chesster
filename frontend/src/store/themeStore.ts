import { create } from "zustand";
import { persist } from "zustand/middleware";

export type BoardThemeKey = "classic" | "wood" | "neon" | "marble";
export type PieceSetKey = "standard" | "neo" | "wood" | "pixel";
export type ColorMode = "light" | "dark" | "system";

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
export const DEFAULT_COLOR_MODE: ColorMode = "system";

function getSystemIsDark(): boolean {
	if (typeof window === "undefined") return false;
	if (typeof window.matchMedia !== "function") return false;
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyColorMode(mode: ColorMode) {
	if (typeof document === "undefined") return;
	const isDark = mode === "dark" || (mode === "system" && getSystemIsDark());
	document.documentElement.classList.toggle("dark", isDark);
}

export function applyBoardTheme(key: BoardThemeKey) {
	if (typeof document === "undefined") return;
	const theme = BOARD_THEMES.find((t) => t.key === key) ?? BOARD_THEMES[0];
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
	isDark: () => boolean;
}

export const useThemeStore = create<ThemeState>()(
	persist(
		(set, get) => ({
			boardTheme: DEFAULT_BOARD_THEME,
			pieceSet: "standard" as PieceSetKey,
			colorMode: DEFAULT_COLOR_MODE,
			setBoardTheme: (key) => {
				applyBoardTheme(key);
				set({ boardTheme: key });
			},
			setPieceSet: (key) => set({ pieceSet: key }),
			setColorMode: (mode) => {
				applyColorMode(mode);
				set({ colorMode: mode });
			},
			isDark: () => {
				const mode = get().colorMode;
				return mode === "dark" || (mode === "system" && getSystemIsDark());
			},
		}),
		{
			name: "chesster-theme",
			partialize: (state) => ({
				boardTheme: state.boardTheme,
				pieceSet: state.pieceSet,
				colorMode: state.colorMode,
			}),
			onRehydrateStorage: () => (state) => {
				if (state) {
					applyColorMode(state.colorMode);
					applyBoardTheme(state.boardTheme);
				}
			},
		},
	),
);

applyColorMode(useThemeStore.getState().colorMode);
applyBoardTheme(useThemeStore.getState().boardTheme);

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
	window
		.matchMedia("(prefers-color-scheme: dark)")
		.addEventListener("change", () => {
			if (useThemeStore.getState().colorMode === "system") {
				applyColorMode("system");
			}
		});
}
