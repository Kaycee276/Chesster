import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { I18nextProvider } from "react-i18next";
import i18n from "./index";
import LanguageSelector from "../components/LanguageSelector";

describe("i18n setup", () => {
  beforeEach(() => {
    localStorage.clear();
    i18n.changeLanguage("en");
  });

  it("loads the saved language preference and renders localized copy", async () => {
    localStorage.setItem("i18nextLng", "es");
    await i18n.changeLanguage("es");

    render(
      <I18nextProvider i18n={i18n}>
        <h1>{i18n.t("common.language")}</h1>
      </I18nextProvider>,
    );

    expect(screen.getByText("Idioma")).toBeInTheDocument();
  });

  it("switches the UI language when the selector is used", async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <LanguageSelector />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /language/i }));
    fireEvent.click(screen.getByRole("option", { name: /français/i }));

    expect(i18n.language).toBe("fr");
    expect(screen.getByText("Français")).toBeInTheDocument();
    expect(localStorage.getItem("i18nextLng")).toBe("fr");
  });
});
