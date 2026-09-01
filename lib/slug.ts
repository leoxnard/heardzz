/**
 * Same shape scripts/extract.mjs's slugify produces, so a recording resolves
 * to the same key everywhere it is asked about: whether an import would
 * duplicate one, and whether two entries in the list are the same record.
 */
export function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** The key that ties every clip of one tune together, whatever upload it came from. */
export function tuneKey(artist: string, song: string): string {
  return slug(`${song}-${artist}`);
}
