/**
 * @arcan-os/core — Utilities
 *
 * Shared utility functions used across packages.
 */

/**
 * Generate a ULID-like unique identifier.
 * Uses crypto.randomUUID for simplicity in v1.
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Current timestamp in milliseconds.
 */
export function now(): number {
  return Date.now();
}
