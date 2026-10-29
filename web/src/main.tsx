import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/queryClient';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { ShellProvider } from './lib/shell';
import { DialogProvider } from './components/Dialog';
import { ToastProvider } from './components/Toast';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <ToastProvider>
        <DialogProvider>
          <AuthProvider>
            <ShellProvider>
              <App />
            </ShellProvider>
          </AuthProvider>
        </DialogProvider>
      </ToastProvider>
    </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
