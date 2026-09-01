/**
 * Pull the video id out of whatever someone pasted.
 *
 * Strict on purpose. Anything accepted here is eventually handed to yt-dlp
 * on the server, and yt-dlp will happily fetch from a thousand other sites —
 * including hosts inside a home network. Only a YouTube video id gets
 * through, and the URL that reaches the tool is rebuilt from that id rather
 * than passed along as typed.
 */
const ID = /^[A-Za-z0-9_-]{11}$/;

const PATTERNS = [
  /youtube\.com\/watch\?(?:.*&)?v=([A-Za-z0-9_-]{11})/,
  /youtu\.be\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  /youtube\.com\/live\/([A-Za-z0-9_-]{11})/,
];

export function parseYouTubeId(input: string): string | null {
  const text = String(input || "").trim();
  if (ID.test(text)) return text;

  for (const pattern of PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  return null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
