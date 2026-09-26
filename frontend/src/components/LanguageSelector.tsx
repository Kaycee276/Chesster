import { useState } from "react";
import { Globe, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

const LANGUAGES = [
	{ code: "en", nativeName: "English", flag: "🇺🇸" },
	{ code: "es", nativeName: "Español", flag: "🇪🇸" },
	{ code: "fr", nativeName: "Français", flag: "🇫🇷" },
	{ code: "zh", nativeName: "中文", flag: "🇨🇳" },
] as const;

export default function LanguageSelector() {
	const { i18n, t } = useTranslation();
	const [open, setOpen] = useState(false);

	const currentLanguage =
		LANGUAGES.find((language) => language.code === i18n.resolvedLanguage)?.
			nativeName ?? "English";
	const currentFlag =
		LANGUAGES.find((language) => language.code === i18n.resolvedLanguage)?.flag ??
			"🇺🇸";

	const handleChangeLanguage = (languageCode: string) => {
		i18n.changeLanguage(languageCode);
		setOpen(false);
	};

	return (
		<div className="relative">
			<button
				type="button"
				aria-label={t("common.language")}
				onClick={() => setOpen((value) => !value)}
				className="flex items-center gap-2 rounded-lg border border-(--border) bg-(--bg-secondary) px-2.5 py-1.5 text-sm font-medium text-(--text-secondary) transition-colors hover:border-(--accent-primary)/60 hover:text-(--text)"
			>
				<Globe size={14} className="text-(--accent-primary)" />
				<span className="hidden sm:inline">{currentFlag}</span>
				<span className="hidden sm:inline">{currentLanguage}</span>
				<span className="sm:hidden">{currentFlag}</span>
			</button>

			{open && (
				<div className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-xl border border-(--border) bg-(--bg-secondary) shadow-2xl">
					{LANGUAGES.map((language) => {
						const active = i18n.resolvedLanguage === language.code;

						return (
							<button
								type="button"
								key={language.code}
								role="option"
								aria-selected={active}
								onClick={() => handleChangeLanguage(language.code)}
								className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
									active
										? "bg-(--accent-dark) text-(--text)"
										: "text-(--text-secondary) hover:bg-(--bg-tertiary) hover:text-(--text)"
								}`}
							>
								<span className="flex items-center gap-2">
									<span>{language.flag}</span>
									<span>{language.nativeName}</span>
								</span>
								{active && <Check size={14} className="text-(--accent-primary)" />}
							</button>
						);
						})}
				</div>
			)}
		</div>
	);
}
