import { describe, expect, it } from "vitest";
import { matchLocale, pickLocale } from "./pick-locale";
import type { LocaleAdapter } from "./types";

function makeAdapter(overrides: Partial<LocaleAdapter> = {}): LocaleAdapter {
  return {
    getUserChoice: () => null,
    getSystemPreferences: () => [],
    persist: () => {},
    ...overrides,
  };
}

describe("matchLocale", () => {
  it("returns DEFAULT_LOCALE when given an empty list", () => {
    expect(matchLocale([])).toBe("zh-Hans");
  });

  it("matches a clean supported tag", () => {
    expect(matchLocale(["zh-Hans"])).toBe("zh-Hans");
    expect(matchLocale(["ko"])).toBe("ko");
    expect(matchLocale(["ja"])).toBe("ja");
    expect(matchLocale(["en"])).toBe("en");
    expect(matchLocale(["fr"])).toBe("fr");
    expect(matchLocale(["es"])).toBe("es");
  });

  it("collapses region-tagged BCP-47 to the supported base", () => {
    expect(matchLocale(["en-US"])).toBe("en");
    expect(matchLocale(["zh-Hans-CN"])).toBe("zh-Hans");
    expect(matchLocale(["ko-KR"])).toBe("ko");
    expect(matchLocale(["ja-JP"])).toBe("ja");
    expect(matchLocale(["fr-FR"])).toBe("fr");
    expect(matchLocale(["fr-CA"])).toBe("fr");
    expect(matchLocale(["es-ES"])).toBe("es");
    expect(matchLocale(["es-MX"])).toBe("es");
  });

  it("falls back to DEFAULT_LOCALE when no candidate matches", () => {
    expect(matchLocale(["pt", "de"])).toBe("zh-Hans");
  });

  it("Traditional-script and TW/HK tags resolve to zh-Hant, mainland tags to zh-Hans", () => {
    expect(matchLocale(["zh-Hant"])).toBe("zh-Hant");
    expect(matchLocale(["zh-TW"])).toBe("zh-Hant");
    expect(matchLocale(["zh-HK"])).toBe("zh-Hant");
    expect(matchLocale(["zh-CN"])).toBe("zh-Hans");
  });

  it("uses the first supported candidate when multiple appear", () => {
    expect(matchLocale(["pt", "zh-Hans", "en"])).toBe("zh-Hans");
    expect(matchLocale(["pt", "ko-KR", "en"])).toBe("ko");
    expect(matchLocale(["pt", "ja-JP", "en"])).toBe("ja");
  });

  it("returns DEFAULT_LOCALE for malformed BCP-47 tags rather than throwing", () => {
    expect(matchLocale(["----"])).toBe("zh-Hans");
    expect(matchLocale(["x-private-only"])).toBe("zh-Hans");
  });
});

describe("pickLocale", () => {
  it("prefers explicit user choice over system signal", () => {
    const adapter = makeAdapter({
      getUserChoice: () => "zh-Hans",
      getSystemPreferences: () => ["en-US"],
    });
    expect(pickLocale(adapter)).toBe("zh-Hans");
  });

  it("defaults to simplified Chinese even when the system uses English", () => {
    const adapter = makeAdapter({
      getSystemPreferences: () => ["en-US"],
    });
    expect(pickLocale(adapter)).toBe("zh-Hans");
  });

  it("returns DEFAULT_LOCALE without a saved choice", () => {
    const adapter = makeAdapter({
      getUserChoice: () => null,
      getSystemPreferences: () => ["pt", "de"],
    });
    expect(pickLocale(adapter)).toBe("zh-Hans");
  });

  it("ignores empty-string user choice and uses the default", () => {
    const adapter = makeAdapter({
      getUserChoice: () => "",
      getSystemPreferences: () => ["zh-Hans"],
    });
    expect(pickLocale(adapter)).toBe("zh-Hans");
  });

  it("preserves an explicitly selected English interface", () => {
    expect(pickLocale(makeAdapter({ getUserChoice: () => "en" }))).toBe("en");
  });
});
