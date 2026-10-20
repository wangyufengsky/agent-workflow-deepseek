import type { CSSProperties } from 'react';
import { THEME_CONFIGS, THEME_ORDER, THEMES, type ThemeIdValue } from '@agent-workflow/shared';
import { Icon } from '../../components/Icon.tsx';
import { useTheme } from '../../theme/ThemeProvider.tsx';
import { designThemeLabel } from '../../theme/themeLabels.ts';

/** Preview colours come from the same shared theme tokens that drive the app. */
function previewVariables(theme: ThemeIdValue): CSSProperties {
  const tokens = THEME_CONFIGS[theme].tokens;
  return {
    '--pv-bg': tokens['--bg'] ?? 'transparent',
    '--pv-sidebar': tokens['--sidebar'] ?? 'transparent',
    '--pv-accent': tokens['--accent'] ?? 'currentColor',
  } as CSSProperties;
}

/**
 * Four theme cards (Settings → 外观). Selecting a card applies the theme
 * immediately: <html> CSS variables + data-theme + localStorage + ?theme=.
 */
export function ThemeSelector() {
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <div className="skins" role="radiogroup" aria-label="主题">
        {THEME_ORDER.map((id) => {
          const meta = THEMES[id];
          const checked = theme === id;
          return (
            <button
              key={id}
              type="button"
              className="skin"
              role="radio"
              aria-checked={checked}
              onClick={() => setTheme(id)}
            >
              <span className="pv" style={previewVariables(id)}>
                <span className="pv-side" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="pv-main" aria-hidden="true">
                  <b />
                  <b />
                  <b />
                </span>
              </span>
              <span className="nm">
                <span>
                  {designThemeLabel(id)}
                  <span className="desc" style={{ marginLeft: 6 }}>
                    {meta.description}
                  </span>
                </span>
                {checked ? (
                  <span className="picked" aria-label="当前主题">
                    <Icon name="check" size="sm" />
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      <span className="theme-current">
        <span className="status-dot-accent dot" aria-hidden="true" />
        当前主题：{designThemeLabel(theme)} · 切换立即生效，并写入 URL（?theme=）与本地存储
      </span>
    </div>
  );
}
