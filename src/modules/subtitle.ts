import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Config } from '../config.js';
import { getCookieArgs, getGlobalArgs } from '../config.js';
import { _spawnPromise, validateUrl, assertPublicUrl, cleanSubtitleToTranscript } from "./utils.js";

type SubtitleKind = "manual" | "automatic";
type SubtitleLanguage = {
  code: string;
  name: string;
  formats: string[];
};

/**
 * Turn yt-dlp's potentially enormous --list-subs table into a bounded
 * language catalog. Never return raw yt-dlp output to MCP clients: YouTube
 * automatic-caption tables can exceed a transport's single-message limit.
 *
 * Manual subtitles appear before automatic captions so a large auto-caption
 * catalog cannot hide the user's more useful manually authored languages.
 */
export function formatSubtitleLanguageList(raw: string, requestedLimit = 25000): string {
  const limit = Math.min(25000, Math.max(512, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 25000));
  const subtitles: Record<SubtitleKind, Map<string, SubtitleLanguage>> = {
    manual: new Map(),
    automatic: new Map(),
  };
  let section: SubtitleKind | undefined;

  for (const line of raw.split(/\r?\n/)) {
    if (/Available automatic captions for\b/i.test(line)) {
      section = "automatic";
      continue;
    }
    if (/Available subtitles for\b/i.test(line)) {
      section = "manual";
      continue;
    }
    if (!section || /^\s*Language\s+Name\s+Formats\s*$/i.test(line)) {
      continue;
    }
    // Progress, debug and video-info lines are not subtitle-language rows.
    if (/^\s*\[/.test(line)) {
      continue;
    }
    const columns = line.trim().split(/\s{2,}/);
    if (columns.length < 2) {
      continue;
    }
    const code = columns[0];
    if (!/^[a-z][\w-]{0,31}$/i.test(code)) {
      continue;
    }
    const name = (columns.length > 2 ? columns.slice(1, -1).join(" ") : columns[1]).trim();
    const formatText = columns.length > 2 ? columns[columns.length - 1] : "";
    const formats = [...new Set(formatText.split(",").map(value => value.trim())
      .filter(value => /^[a-z0-9][a-z0-9._-]{0,15}$/i.test(value)))];
    subtitles[section].set(code, { code, name, formats });
  }

  const manual = [...subtitles.manual.values()];
  const automatic = [...subtitles.automatic.values()];
  const total = manual.length + automatic.length;
  if (!total) {
    return /\bno (?:subtitles|automatic captions)\b|\bhas no subtitles\b/i.test(raw)
      ? "Language catalog: yt-dlp reports no available subtitle languages."
      : "Language catalog: yt-dlp returned no parseable subtitle rows.";
  }

  let result = `Language catalog: ${manual.length} manual, ${automatic.length} automatic caption languages.`;
  let omitted = 0;
  for (const [heading, rows] of [
    ["Manual subtitles", manual],
    ["Automatic captions", automatic],
  ] as const) {
    if (!rows.length) continue;
    const header = `\n\n${heading}:`;
    if (result.length + header.length + 100 > limit) {
      omitted += rows.length;
      continue;
    }
    result += header;
    for (const item of rows) {
      const name = item.name.slice(0, 90);
      const formats = item.formats.slice(0, 8).join(", ");
      const more = item.formats.length > 8 ? `, +${item.formats.length - 8} formats` : "";
      const row = `\n${item.code}: ${name}${formats ? ` [${formats}${more}]` : ""}`;
      // Reserve room for the final omission notice.
      if (result.length + row.length + 100 > limit) {
        omitted += 1;
      } else {
        result += row;
      }
    }
  }
  if (omitted) {
    result += `\n... ${omitted} additional languages omitted to keep the response bounded.`;
  }
  return result;
}

/**
 * Lists all available subtitles for a video.
 *
 * @param url - The URL of the video
 * @param config - Configuration object (optional, for cookie support)
 * @returns Promise resolving to a string containing the list of available subtitles
 * @throws {Error} When URL is invalid or subtitle listing fails
 *
 * @example
 * ```typescript
 * try {
 *   const subtitles = await listSubtitles('https://youtube.com/watch?v=...', config);
 *   console.log('Available subtitles:', subtitles);
 * } catch (error) {
 *   console.error('Failed to list subtitles:', error);
 * }
 * ```
 */
export async function listSubtitles(url: string, config?: Config): Promise<string> {
  if (!validateUrl(url)) {
    throw new Error('Invalid or unsupported URL format. Please provide a valid video URL (e.g., https://youtube.com/watch?v=...)');
  }
  await assertPublicUrl(url, config);

  try {
    const args = [
      ...(config ? getGlobalArgs(config) : []),
      '--no-download-archive',
      '--list-subs',
      '--write-auto-sub',
      '--skip-download',
      '--no-warnings',
      ...(config ? getCookieArgs(config) : []),
      url
    ];
    const output = await _spawnPromise('yt-dlp', args);
    return formatSubtitleLanguageList(output, config?.limits.characterLimit);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Unsupported URL") || error.message.includes("not supported")) {
        throw new Error(`Unsupported platform or video URL: ${url}. Ensure the URL is from a supported platform like YouTube.`);
      }
      if (error.message.includes("Video unavailable") || error.message.includes("private")) {
        throw new Error(`Video is unavailable or private: ${url}. Check the URL and video privacy settings.`);
      }
      if (error.message.includes("network") || error.message.includes("Connection")) {
        throw new Error("Network error while fetching subtitles. Check your internet connection and retry.");
      }
    }
    // _spawnPromise includes stderr and stdout on failures. Never forward
    // that unbounded diagnostic blob through MCP or reveal cookie/proxy data.
    throw new Error("Unable to list subtitles: yt-dlp failed. Check access and server logs.");
  }
}

/**
 * Downloads subtitles for a video in the specified language.
 * 
 * @param url - The URL of the video
 * @param language - Language code (e.g., 'en', 'zh-Hant', 'ja')
 * @param config - Configuration object
 * @returns Promise resolving to the subtitle content
 * @throws {Error} When URL is invalid, language is not available, or download fails
 * 
 * @example
 * ```typescript
 * try {
 *   // Download English subtitles
 *   const enSubs = await downloadSubtitles('https://youtube.com/watch?v=...', 'en', config);
 *   console.log('English subtitles:', enSubs);
 * 
 *   // Download Traditional Chinese subtitles
 *   const zhSubs = await downloadSubtitles('https://youtube.com/watch?v=...', 'zh-Hant', config);
 *   console.log('Chinese subtitles:', zhSubs);
 * } catch (error) {
 *   if (error.message.includes('No subtitle files found')) {
 *     console.warn('No subtitles available in the requested language');
 *   } else {
 *     console.error('Failed to download subtitles:', error);
 *   }
 * }
 * ```
 */
export async function downloadSubtitles(
  url: string,
  language: string,
  config: Config
): Promise<string> {
  if (!validateUrl(url)) {
    throw new Error('Invalid or unsupported URL format. Please provide a valid video URL (e.g., https://youtube.com/watch?v=...)');
  }
  await assertPublicUrl(url, config);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), config.file.tempDirPrefix));

  try {
    await _spawnPromise('yt-dlp', [
      ...getGlobalArgs(config),
      '--no-download-archive',
      '--write-sub',
      '--write-auto-sub',
      '--sub-lang', language,
      // Pin the output format: the .vtt filter below would otherwise miss the
      // files whenever the user's config file sets --convert-subs.
      '--convert-subs', 'vtt',
      '--skip-download',
      '--output', path.join(tempDir, '%(title)s.%(ext)s'),
      ...getCookieArgs(config),
      url
    ]);

    const subtitleFiles = fs.readdirSync(tempDir)
      .filter(file => file.endsWith('.vtt'));

    if (subtitleFiles.length === 0) {
      throw new Error(`No subtitle files found for language '${language}'. Use ytdlp_list_subtitle_languages to check available options.`);
    }

    let output = '';
    for (const file of subtitleFiles) {
      output += fs.readFileSync(path.join(tempDir, file), 'utf8');
    }

    // Check character limit
    if (output.length > config.limits.characterLimit) {
      output = output.substring(0, config.limits.characterLimit);
      output += "\n\n⚠️ Subtitle content truncated due to size. Consider using ytdlp_download_transcript for plain text.";
    }

    return output;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Unsupported URL") || error.message.includes("not supported")) {
        throw new Error(`Unsupported platform or video URL: ${url}. Ensure the URL is from a supported platform like YouTube.`);
      }
      if (error.message.includes("Video unavailable") || error.message.includes("private")) {
        throw new Error(`Video is unavailable or private: ${url}. Check the URL and video privacy settings.`);
      }
      if (error.message.includes("network") || error.message.includes("Connection")) {
        throw new Error("Network error while downloading subtitles. Check your internet connection and retry.");
      }
    }
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Downloads and cleans subtitles to produce a plain text transcript.
 * 
 * @param url - The URL of the video
 * @param language - Language code (e.g., 'en', 'zh-Hant', 'ja')
 * @param config - Configuration object
 * @returns Promise resolving to the cleaned transcript text
 * @throws {Error} When URL is invalid, language is not available, or download fails
 * 
 * @example
 * ```typescript
 * try {
 *   const transcript = await downloadTranscript('https://youtube.com/watch?v=...', 'en', config);
 *   console.log('Transcript:', transcript);
 * } catch (error) {
 *   console.error('Failed to download transcript:', error);
 * }
 * ```
 */
export async function downloadTranscript(
  url: string,
  language: string,
  config: Config
): Promise<string> {
  if (!validateUrl(url)) {
    throw new Error('Invalid or unsupported URL format. Please provide a valid video URL (e.g., https://youtube.com/watch?v=...)');
  }
  await assertPublicUrl(url, config);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), config.file.tempDirPrefix));

  try {
    await _spawnPromise('yt-dlp', [
      ...getGlobalArgs(config),
      '--no-download-archive',
      '--skip-download',
      '--write-subs',
      '--write-auto-subs',
      '--sub-lang', language,
      '--sub-format', 'ttml',
      '--convert-subs', 'srt',
      '--output', path.join(tempDir, 'transcript.%(ext)s'),
      ...getCookieArgs(config),
      url
    ]);

    const srtFiles = fs.readdirSync(tempDir)
      .filter(file => file.endsWith('.srt'));

    if (srtFiles.length === 0) {
      throw new Error(`No subtitle files found for transcript generation in language '${language}'. Use ytdlp_list_subtitle_languages to check available options.`);
    }

    let transcriptContent = '';
    for (const file of srtFiles) {
      const srtContent = fs.readFileSync(path.join(tempDir, file), 'utf8');
      transcriptContent += cleanSubtitleToTranscript(srtContent) + ' ';
    }

    transcriptContent = transcriptContent.trim();

    // Transcripts can be larger than standard limit
    if (transcriptContent.length > config.limits.maxTranscriptLength) {
      const truncated = transcriptContent.substring(0, config.limits.maxTranscriptLength);
      transcriptContent = truncated + "\n\n⚠️ Transcript truncated due to length. This is a partial transcript.";
    }

    return transcriptContent;
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Unsupported URL") || error.message.includes("not supported")) {
        throw new Error(`Unsupported platform or video URL: ${url}. Ensure the URL is from a supported platform like YouTube.`);
      }
      if (error.message.includes("Video unavailable") || error.message.includes("private")) {
        throw new Error(`Video is unavailable or private: ${url}. Check the URL and video privacy settings.`);
      }
      if (error.message.includes("network") || error.message.includes("Connection")) {
        throw new Error("Network error while downloading transcript. Check your internet connection and retry.");
      }
    }
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
} 
