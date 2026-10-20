/**
 * "减少动态效果" preference (design: settings.html 外观 → three-option select).
 *
 * The product applies it through `<html data-motion="system|reduce|full">`:
 * - `reduce`  → app.css suppresses transitions/animations (product-level, independent of the OS);
 * - `system`  → follow `prefers-reduced-motion` (ds.css media query);
 * - `full`    → keep the design's motion even when the OS asks to reduce.
 *
 * The preference is local (appearance is device-scoped, like theme persistence);
 * an explicit local choice wins over the service `settings.ui.reducedMotion`
 * config, which itself is used as the fallback default when the user has not
 * chosen anything on this device.
 */
export type MotionPreference = 'system' | 'reduce' | 'full';

export const MOTION_STORAGE_KEY = 'agent-workflow.motion';

export interface MotionOption {
  readonly value: MotionPreference;
  readonly label: string;
}

/** Same labels/order as the design's select (跟随系统 / 始终减少 / 不减少). */
export const MOTION_OPTIONS: readonly MotionOption[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'reduce', label: '始终减少' },
  { value: 'full', label: '不减少' },
];

function isMotionPreference(value: unknown): value is MotionPreference {
  return value === 'system' || value === 'reduce' || value === 'full';
}

/** Reads the explicit local choice; `undefined` means "no local override". */
export function readStoredMotion(): MotionPreference | undefined {
  try {
    const value = window.localStorage.getItem(MOTION_STORAGE_KEY);
    return isMotionPreference(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function persistMotionPreference(preference: MotionPreference): void {
  try {
    window.localStorage.setItem(MOTION_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode); the in-memory choice still applies.
  }
}

/**
 * Effective preference: explicit local choice first, then the service config
 * (`reducedMotion: true` means "always reduce", `false` means "follow system").
 */
export function resolveMotionPreference(serviceReducedMotion: boolean | undefined): MotionPreference {
  const stored = readStoredMotion();
  if (stored !== undefined) return stored;
  return serviceReducedMotion === true ? 'reduce' : 'system';
}

/** Writes the preference to <html data-motion>; CSS consumes the attribute. */
export function applyMotionPreference(preference: MotionPreference): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.motion = preference;
}
