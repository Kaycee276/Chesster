import { describe, it, expect, beforeEach } from "vitest";
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

  it("translates tournament and gameResult strings across supported languages", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("gameResult.titleWin")).toBe("You Win!");
    expect(i18n.t("gameResult.victoryCheckmate")).toBe("Victory by Checkmate");
    expect(i18n.t("tournament.roundOf64")).toBe("Round of 64");
    expect(i18n.t("tournament.finals")).toBe("Grand Finals");
    expect(i18n.t("tournament.findMyMatch")).toBe("Find My Match");

    await i18n.changeLanguage("es");
    expect(i18n.t("gameResult.titleWin")).toBe("¡Has ganado!");
    expect(i18n.t("gameResult.victoryCheckmate")).toBe("Victoria por jaque mate");
    expect(i18n.t("tournament.roundOf64")).toBe("Ronda de 64");
    expect(i18n.t("tournament.finals")).toBe("Gran Final");
    expect(i18n.t("tournament.findMyMatch")).toBe("Buscar mi partida");

    await i18n.changeLanguage("fr");
    expect(i18n.t("gameResult.titleWin")).toBe("Vous avez gagné !");
    expect(i18n.t("gameResult.victoryCheckmate")).toBe("Victoire par échec et mat");
    expect(i18n.t("tournament.roundOf64")).toBe("64es de finale");
    expect(i18n.t("tournament.finals")).toBe("Grande finale");
    expect(i18n.t("tournament.findMyMatch")).toBe("Trouver mon match");
  });
});
