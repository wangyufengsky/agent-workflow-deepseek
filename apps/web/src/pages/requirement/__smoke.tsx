import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '../../styles/ds.css';
import '../../styles/app.css';
import { createAppQueryClient } from '../../app/queryClient.ts';
import { StartPage } from '../start/StartPage.tsx';
import { RequirementCanvasPage } from './RequirementCanvasPage.tsx';
import { TaskCanvasPage } from '../task/TaskCanvasPage.tsx';

const errors = document.getElementById('errors');
const log = (message: string) => {
  if (errors !== null) errors.textContent = `${errors.textContent ?? ''}\n${message}`;
};
window.addEventListener('error', (event) => log(`window.error: ${event.message} @ ${event.filename ?? ''}:${String(event.lineno)}`));
window.addEventListener('unhandledrejection', (event) => log(`unhandledrejection: ${String((event.reason as Error | undefined)?.message ?? event.reason)}`));
const originalError = console.error;
console.error = (...args: unknown[]) => {
  log(`console.error: ${args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ')}`);
  originalError(...args);
};

const path = new URLSearchParams(window.location.search).get('path') ?? '/start';
const container = document.getElementById('root');
if (container === null) throw new Error('no root');
createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={createAppQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/start" element={<StartPage />} />
          <Route path="/requirement/:requirementId" element={<RequirementCanvasPage />} />
          <Route path="/tasks/:taskId" element={<TaskCanvasPage />} />
          <Route path="*" element={<div>no route</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  </StrictMode>,
);
