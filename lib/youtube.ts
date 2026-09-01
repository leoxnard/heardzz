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

/**
 * Pull a playlist id out of a link.
 *
 * Same reasoning as above: only the id travels, and the URL handed to yt-dlp
 * is rebuilt from it. Watch-later and liked-videos are personal lists that
 * cannot be read by anyone else, so they are turned away here rather than
 * failing further down. A link that carries both a video and a list resolves
 * as the video — that is what someone pasting from a playing track means.
 */
const PLAYLIST_ID = /^[A-Za-z0-9_-]{12,64}$/;
const PRIVATE_LISTS = new Set(["WL", "LL"]);

export function parseYouTubePlaylistId(input: string): string | null {
  const text = String(input || "").trim();
  if (parseYouTubeId(text)) return null;

  const match = /[?&]list=([A-Za-z0-9_-]+)/.exec(text)
    ?? /youtube\.com\/playlist\/([A-Za-z0-9_-]+)/.exec(text);
  const id = match?.[1] ?? (PLAYLIST_ID.test(text) ? text : null);

  if (!id || PRIVATE_LISTS.has(id) || !PLAYLIST_ID.test(id)) return null;
  return id;
}

export function playlistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}
