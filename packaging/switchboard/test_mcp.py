"""Container-level MCP list-tools acceptance test for the Switchboard package."""
import asyncio
import sys

from fastmcp import Client

EXPECTED = {
    "ytdlp_search_videos", "ytdlp_list_subtitle_languages",
    "ytdlp_download_video_subtitles", "ytdlp_download_transcript",
    "ytdlp_get_video_metadata", "ytdlp_get_video_metadata_summary",
    "ytdlp_get_video_comments", "ytdlp_get_video_comments_summary",
    "ytdlp_download_video", "ytdlp_download_audio",
}


async def check(url: str) -> None:
    async with Client(url, timeout=20, init_timeout=20) as client:
        names = {tool.name for tool in await client.list_tools()}
    if names != EXPECTED:
        raise SystemExit(f"Unexpected tool catalog: missing={sorted(EXPECTED - names)}, extra={sorted(names - EXPECTED)}")
    print(f"PASS: {len(names)} yt-dlp MCP tools")


if __name__ == "__main__":
    asyncio.run(check(sys.argv[1]))
