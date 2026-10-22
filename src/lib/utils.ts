/**
 * Joins class names, leaving out the empty ones: what the Genframe Kit's components
 * (src/components/ui) ask of shadcn's `cn`. It doesn't merge conflicting Tailwind classes, as the
 * `cn` package does, for 11 KB; nothing here passes classes that conflict.
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
