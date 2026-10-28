import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { ShellProvider } from './lib/shell';
import { DialogProvider } from './components/Dialog';
import { ToastProvider } from './components/Toast';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
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
  </StrictMode>,
);
