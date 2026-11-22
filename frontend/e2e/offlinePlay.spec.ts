import { expect, test } from "@playwright/test";

test("a cached production app reloads offline and plays a local Stockfish reply", async ({ page, context }) => {
  await page.goto("/offline-play");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      });
    }
  });
  await expect(page.getByRole("status")).not.toHaveText("Loading local Stockfish…");

  let apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests = [...apiRequests, request.url()];
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Offline Stockfish" })).toBeVisible();
  await expect(page.getByRole("status")).not.toHaveText("Loading local Stockfish…");
  await page.getByRole("gridcell", { name: /White Pawn on e2/i }).click();
  await page.getByRole("gridcell", { name: /e4, empty, legal destination/i }).click();
  await expect(page.getByRole("status")).toContainText("Stockfish played");
  expect(apiRequests).toEqual([]);

  const assets = await page.evaluate(async () => {
    const manifest = await fetch("/manifest.json").then((response) => response.json());
    const sizes: number[] = [];
    for (const icon of manifest.icons) {
      const image = new Image();
      image.src = icon.src;
      await image.decode();
      sizes.push(image.naturalWidth);
    }
    const requests = await Promise.all((await caches.keys()).map(async (name) => (await caches.open(name)).keys()));
    return { sizes, urls: requests.flat().map((request) => new URL(request.url).pathname) };
  });
  expect(assets.sizes).toEqual([192, 512]);
  expect(assets.urls).toContain("/stockfish/stockfish-19-lite-single.wasm");
  expect(assets.urls.some((url) => url.startsWith("/api/"))).toBe(false);

  await page.goto("/");
  await expect(page).toHaveURL(/\/offline-games$/);
  await expect(page.getByRole("link", { name: "Play offline against Stockfish" })).toBeVisible();
});
