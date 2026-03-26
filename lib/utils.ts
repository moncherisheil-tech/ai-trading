import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Generate a safe UUID-like string that works in all environments.
 * Falls back to timestamp + random base36 when crypto.randomUUID() is unavailable (HTTP contexts).
 */
export function generateSafeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Fall through to fallback
    }
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
