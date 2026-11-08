import { describe, expect, test } from '@jest/globals';
import { pageSubtitleCues } from '../modules/subtitle-pages.js';

const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.000
first cue

00:20:00.000 --> 00:20:01.000
second cue

00:20:02.000 --> 00:20:03.000
third cue

03:18:51.000 --> 03:18:52.000
last cue`;

const srt = `1
00:00:01,000 --> 00:00:02,000
first cue

2
00:20:00,000 --> 00:20:01,000
second cue

3
00:20:02,000 --> 00:20:03,000
third cue

4
03:18:51,000 --> 03:18:52,000
last cue`;

describe('subtitle pagination', () => {
  test('time windows include start and exclude end, without losing boundary cues', () => {
    const first = pageSubtitleCues([vtt], 'vtt', 1000, { endTime: '00:20:00' });
    const second = pageSubtitleCues([vtt], 'vtt', 1000, { startTime: '00:20:00', endTime: '00:20:03' });
    expect(first).toContain('first cue');
    expect(first).not.toContain('second cue');
    expect(second).not.toContain('first cue');
    expect(second).toContain('second cue');
    expect(second).toContain('third cue');
    expect(second).toContain('hasMore: false');
  });

  test('nextOffset resumes at a whole cue in the same window', () => {
    const options = { startTime: '00:20:00', endTime: '03:18:52' };
    const first = pageSubtitleCues([srt], 'transcript', 131, options);
    expect(first).toContain('second cue');
    expect(first).not.toContain('third cue');
    expect(first).toContain('hasMore: true; nextOffset: 1');
    const second = pageSubtitleCues([srt], 'transcript', 131, { ...options, offset: 1 });
    expect(second).toContain('third cue');
    expect(second).not.toContain('second cue');
    expect(second).toContain('hasMore: true; nextOffset: 2');
    const third = pageSubtitleCues([srt], 'transcript', 131, { ...options, offset: 2 });
    expect(third).toContain('last cue');
    expect(third).toContain('hasMore: false');
  });

  test('keeps the VTT page valid and rejects invalid ranges and offsets', () => {
    const page = pageSubtitleCues([vtt], 'vtt', 1000, { startTime: '03:18:51' });
    expect(page).toMatch(/^WEBVTT\n\n/);
    expect(page).toContain('NOTE hasMore: false');
    expect(() => pageSubtitleCues([vtt], 'vtt', 1000, { startTime: '00:30:00', endTime: '00:20:00' })).toThrow();
    expect(() => pageSubtitleCues([vtt], 'vtt', 1000, { offset: 5 })).toThrow();
    expect(() => pageSubtitleCues([vtt], 'vtt', 1000, { startTime: '00:99:00' })).toThrow();
  });

  test('VTT pagination resumes after a complete cue', () => {
    const first = pageSubtitleCues([vtt], 'vtt', 180);
    expect(first).toContain('first cue');
    expect(first).not.toContain('second cue');
    expect(first).toContain('NOTE hasMore: true; nextOffset: 1');
    const second = pageSubtitleCues([vtt], 'vtt', 180, { offset: 1 });
    expect(second).toContain('second cue');
    expect(second).not.toContain('first cue');
  });

  test('retrieves a long transcript without dropping or splitting any cue', () => {
    const longSrt = Array.from({ length: 12000 }, (_, index) => {
      const hour = String(Math.floor(index / 3600)).padStart(2, '0');
      const minute = String(Math.floor(index / 60) % 60).padStart(2, '0');
      const second = String(index % 60).padStart(2, '0');
      return `${index + 1}\n${hour}:${minute}:${second},000 --> ${hour}:${minute}:${second},500\ncue-${index}`;
    }).join('\n\n');
    const seen: string[] = [];
    let offset = 0;
    for (;;) {
      const page = pageSubtitleCues([longSrt], 'transcript', 1500, { offset });
      expect(page.length).toBeLessThanOrEqual(1500);
      seen.push(...page.match(/cue-\d+/g)!);
      const next = /nextOffset: (\d+)/.exec(page);
      if (!next) break;
      expect(Number(next[1])).toBeGreaterThan(offset);
      offset = Number(next[1]);
    }
    expect(seen).toEqual(Array.from({ length: 12000 }, (_, index) => `cue-${index}`));
  });
});
