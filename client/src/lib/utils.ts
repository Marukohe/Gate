import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Strip Read-tool line number prefixes (e.g. "     1→", "   100→") from text.
 * Preserves legitimate uses of → that don't start a line after digits.
 */
export function stripLineNumbers(text: string): string {
  return text.replace(/^ *\d+→/gm, '');
}
