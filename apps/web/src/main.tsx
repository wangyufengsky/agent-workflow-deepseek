import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import './styles/ds.css';
import './styles/app.css';
import { App } from './app/App.tsx';
import { createAppQueryClient } from './app/queryClient.ts';
import { ThemeProvider } from './theme/ThemeProvider.tsx';
import { applyTheme, resolveInitialTheme } from './theme/theme.ts';

// Apply the persisted theme before the first React render so the shell never
// paints with the wrong tokens.
applyTheme(resolveInitialTheme());

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');
const queryClient = createAppQueryClient();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
