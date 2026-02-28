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

/** Cross-browser unique ID (crypto.randomUUID is unavailable in older Safari/iOS). */
export function uniqueId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
