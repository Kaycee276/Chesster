export type OverlayTheme = "neon" | "wood" | "glass";

export interface OverlayOptions {
	transparent: boolean;
	showEvaluation: boolean;
	showClocks: boolean;
	theme: OverlayTheme;
	color: "white" | "black" | null;
}

export function parseOverlayOptions(search: string): OverlayOptions {
	const params = new URLSearchParams(search);
	const theme = params.get("theme");
	const color = params.get("color");
	return {
		transparent: params.get("chroma") === "transparent",
		showEvaluation: params.get("eval") === "true",
		showClocks: params.get("clocks") !== "false",
		theme: theme === "wood" || theme === "glass" ? theme : "neon",
		color: color === "black" || color === "white" ? color : null,
	};
}
