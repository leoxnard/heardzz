export function parseTitle(
  title: string,
  uploader: string,
): { artist: string; song: string; confident: boolean };

export function geminiAvailable(): boolean;

export function askGemini(input: {
  title: string;
  uploader?: string;
  description?: string;
}): Promise<{ artist: string; song: string; album: string; year: number } | null>;
