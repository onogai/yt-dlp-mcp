import { cleanSubtitleToTranscript } from './utils.js';

type Cue = { startMs: number; raw: string };

export type SubtitlePageOptions = {
  startTime?: string;
  endTime?: string;
  offset?: number;
};

function parseTimestamp(value: string): number {
  const match = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(value);
  if (!match || Number(match[2]) >= 60 || Number(match[3]) >= 60) {
    throw new Error('Time must be HH:MM:SS[.ms]');
  }
  return (((Number(match[1] || 0) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000 + Number(match[4]));
}

function requestedTime(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d{2,}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)) {
    throw new Error('Time must be HH:MM:SS[.ms]');
  }
  const [hours, minutes, seconds] = value.split(':');
  if (Number(minutes) >= 60 || Number(seconds) >= 60) {
    throw new Error('Minutes and seconds must be below 60');
  }
  return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000);
}

function parseCues(content: string): Cue[] {
  return content.replace(/\r\n?/g, '\n').split(/\n\s*\n/).flatMap(raw => {
    const timing = raw.split('\n').find(line => /^\s*(?:\d+:)?\d{2}:\d{2}[.,]\d{3}\s*-->/.test(line));
    if (!timing) return [];
    const start = timing.trim().split(/\s*-->\s*/)[0];
    return [{ startMs: parseTimestamp(start), raw: raw.trim() }];
  });
}

/** Offset counts cues whose start timestamp falls within the requested window. */
export function pageSubtitleCues(
  contents: string[],
  format: 'vtt' | 'transcript',
  limit: number,
  options: SubtitlePageOptions = {}
): string {
  const start = requestedTime(options.startTime) ?? 0;
  const end = requestedTime(options.endTime);
  if (end !== undefined && end <= start) throw new Error('endTime must be after startTime');
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative integer');

  const cues = contents.flatMap(parseCues).filter(cue => cue.startMs >= start && (end === undefined || cue.startMs < end));
  if (offset > cues.length) throw new Error('offset exceeds the number of subtitle cues in the selected time window');

  const prefix = format === 'vtt' ? 'WEBVTT\n\n' : '';
  const separator = format === 'vtt' ? '\n\n' : ' ';
  // Leave room for the pagination note, including a large nextOffset value.
  const contentBudget = limit - 120;
  if (contentBudget <= prefix.length) throw new Error('Subtitle response limit is too small');
  const chunks: string[] = [];
  let size = prefix.length;
  let nextOffset = offset;
  for (; nextOffset < cues.length; nextOffset++) {
    const chunk = format === 'vtt' ? cues[nextOffset].raw : cleanSubtitleToTranscript(cues[nextOffset].raw);
    if (!chunk) continue;
    const length = chunk.length + (chunks.length ? separator.length : 0);
    if (size + length > contentBudget) {
      if (!chunks.length) throw new Error('One subtitle cue exceeds the response limit');
      break;
    }
    chunks.push(chunk);
    size += length;
  }

  const hasMore = nextOffset < cues.length;
  const page = prefix + chunks.join(separator);
  const note = `hasMore: ${hasMore}${hasMore ? `; nextOffset: ${nextOffset}` : ''}`;
  return format === 'vtt' ? `${page}\n\nNOTE ${note}` : `${page}\n\n[${note}]`;
}
