import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles/ds.css';
import './styles/app.css';
import { App } from './app/App.tsx';
import { createAppQueryClient } from './app/queryClient.ts';
import { ThemeProvider } from './theme/ThemeProvider.tsx';
import { applyTheme, resolveInitialTheme } from './theme/theme.ts';

/**
 * Minimal render-time error boundary: a page-level exception must not leave a
 * blank white window. It intentionally renders plain shell markup (no page
 * components/query hooks) so it keeps working even when the failing subtree —
 * including providers — is unusable.
 */
class AppErrorBoundary extends Component<{ readonly children: ReactNode }, { readonly error?: Error }> {
  override state: { readonly error?: Error } = {};

  static getDerivedStateFromError(error: Error): { readonly error: Error } {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[web] render error', error, info.componentStack);
  }

  override render() {
    const error = this.state.error;
    if (error === undefined) return this.props.children;
    return (
      <div className="page narrow">
        <div className="card pad" role="alert">
          <h2>页面渲染出错</h2>
          <p className="hint">
            这个页面遇到了未预期的异常，其他本地数据没有被修改。可以重新加载；如果问题持续出现，请把下面的错误信息交给维护者。
          </p>
          <p className="hint mono" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {error.message}
          </p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn secondary md" onClick={() => window.location.reload()}>
              重新加载
            </button>
            <a className="btn ghost md" href="/">
              返回首页
            </a>
          </div>
        </div>
      </div>
    );
  }
}

// Apply the persisted theme before the first React render so the shell never
// paints with the wrong tokens.
applyTheme(resolveInitialTheme());

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');
const queryClient = createAppQueryClient();

createRoot(container).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
