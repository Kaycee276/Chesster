import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import zh from "./locales/zh.json";

const resources = {
	en: { translation: en },
	es: { translation: es },
	fr: { translation: fr },
	zh: { translation: zh },
};

const detectorOptions = {
	order: ["localStorage", "navigator", "htmlTag", "path", "subdomain"],
	lookupLocalStorage: "i18nextLng",
	caches: ["localStorage"],
	checkWhitelist: true,
};

i18n
	.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		resources,
		supportedLngs: ["en", "es", "fr", "zh"],
		nonExplicitSupportedLngs: true,
		fallbackLng: "en",
		defaultNS: "translation",
		ns: ["translation"],
		interpolation: {
			escapeValue: false,
		},
		detection: detectorOptions,
		react: {
			useSuspense: false,
		},
		returnEmptyString: false,
	});

export default i18n;
