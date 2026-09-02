import { Monitor, Moon, Sun } from "lucide-react";

import { useThemeStore, type ColorMode } from "../store/themeStore";

const MODES: { key: ColorMode; label: string; icon: typeof Sun }[] = [
	{ key: "light", label: "Light", icon: Sun },
	{ key: "dark", label: "Dark", icon: Moon },
	{ key: "system", label: "System", icon: Monitor },
];

export default function ThemeToggle() {
	const colorMode = useThemeStore((s) => s.colorMode);
	const setColorMode = useThemeStore((s) => s.setColorMode);

	return (
		<div
			role="group"
			aria-label="Color theme"
			className="inline-flex items-center gap-1 rounded-full border border-(--border) bg-(--bg-secondary) p-1"
		>
			{MODES.map(({ key, label, icon: Icon }) => {
				const active = colorMode === key;
				return (
					<button
						key={key}
						type="button"
						onClick={() => setColorMode(key)}
						aria-pressed={active}
						title={label}
						className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
							active
								? "bg-(--accent-primary) text-white"
								: "text-(--text-secondary) hover:text-(--text)"
						}`}
					>
						<Icon size={14} />
						<span className="hidden sm:inline">{label}</span>
					</button>
				);
			})}
		</div>
	);
}
