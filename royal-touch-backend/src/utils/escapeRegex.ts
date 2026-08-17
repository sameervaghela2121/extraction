/**
 * Escapes regex metacharacters so a user's search string is matched literally.
 *
 * Without this a search for "a+++++++++b" becomes a catastrophically backtracking
 * pattern, and one for "." matches every row — user input must never reach the regex
 * engine as syntax.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
