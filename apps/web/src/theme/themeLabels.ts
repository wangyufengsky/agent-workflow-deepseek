import type { ThemeIdValue } from '@agent-workflow/shared';

/**
 * Theme names exactly as the design authority writes them in the appearance
 * area (`originals/main/pages/settings.html:108`): deepseek 风 / claude 风 /
 * SPDB / GitHub 白. `THEMES[id].label` stays the product/brand name used
 * elsewhere; the appearance picker must use the design wording (GLB-09).
 */
export const DESIGN_THEME_LABELS: Readonly<Record<ThemeIdValue, string>> = {
  deepseek: 'deepseek 风',
  warm: 'claude 风',
  spdb: 'SPDB',
  'github-white': 'GitHub 白',
};

export function designThemeLabel(theme: ThemeIdValue): string {
  return DESIGN_THEME_LABELS[theme];
}
