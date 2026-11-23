// @ts-nocheck
// @jest-environment node
import { describe, expect, test } from "@jest/globals";
import { formatSubtitleLanguageList } from "../modules/subtitle.js";

describe("bounded subtitle language catalog", () => {
  test("groups manual subtitles before automatic captions and retains formats", () => {
    const input = [
      "[youtube] Extracting URL: https://www.youtube.com/watch?v=example",
      "[info] Available automatic captions for example:",
      "Language Name                  Formats",
      "en       English               vtt, ttml, srv3, srv2, srv1, json3",
      "es       Spanish               vtt, ttml, json3",
      "[info] Available subtitles for example:",
      "Language Name                  Formats",
      "fr       French (France)       vtt, srt",
      "pt-BR    Portuguese (Brazil)   vtt, srt",
      "",
    ].join("\n");

    const result = formatSubtitleLanguageList(input);
    expect(result).toContain("2 manual, 2 automatic");
    expect(result).toContain("fr: French (France) [vtt, srt]");
    expect(result).toContain("pt-BR: Portuguese (Brazil)");
    expect(result).toContain("en: English [vtt, ttml, srv3, srv2, srv1, json3]");
    expect(result.indexOf("Manual subtitles:")).toBeLessThan(result.indexOf("Automatic captions:"));
    expect(result).not.toContain("Extracting URL");
  });

  test("never exceeds transport-safe limit for giant automatic-caption tables", () => {
    const automatic = Array.from({ length: 1200 }, (_, i) =>
      `auto-${i.toString().padStart(4, "0")}   Language ${i}   ${"json3, vtt, ttml, ".repeat(150)}`
    );
    const input = [
      "[debug] " + "SECRET_NOT_FOR_RESPONSE".repeat(1000),
      "[info] Available automatic captions for movie:",
      "Language Name Formats",
      ...automatic,
      "[info] Available subtitles for movie:",
      "Language Name Formats",
      "en       English      vtt, srt",
    ].join("\n");

    const result = formatSubtitleLanguageList(input, 25000);
    expect(result.length).toBeLessThanOrEqual(25000);
    expect(result).toContain("1 manual, 1200 automatic");
    expect(result).toContain("en: English [vtt, srt]");
    expect(result).toContain("languages omitted");
    expect(result).not.toContain("SECRET_NOT_FOR_RESPONSE");
  });

  test("honors a smaller caller limit and includes an explicit omission notice", () => {
    const input = [
      "[info] Available automatic captions for movie:",
      "Language Name Formats",
      ...Array.from({ length: 40 }, (_, i) =>
        `a-${i}    Language ${i}    vtt, ttml, json3`
      ),
    ].join("\n");

    const result = formatSubtitleLanguageList(input, 512);
    expect(result.length).toBeLessThanOrEqual(512);
    expect(result).toContain("Language catalog:");
    expect(result).toContain("languages omitted");
  });

  test("does not forward unrecognized output, debug lines or raw URLs", () => {
    const input = "[debug] https://localhost:8181/secret\n[info] Extracting URL\n";
    expect(formatSubtitleLanguageList(input)).toBe(
      "Language catalog: yt-dlp returned no parseable subtitle rows."
    );
  });

  test("reports a video with no subtitle languages", () => {
    const input = "[info] There are no subtitles for this video";
    expect(formatSubtitleLanguageList(input)).toContain("no available subtitle languages");
  });
});
