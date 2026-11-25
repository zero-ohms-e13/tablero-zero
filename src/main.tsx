import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { aplicarPrefs, leerPrefs } from './lib/preferencias';

aplicarPrefs(leerPrefs());
import App from './App';
import { SesionProvider } from './lib/sesion';
import { ToastProvider } from './components/ui';

// Sin conexión: se muestra lo último guardado y los cambios esperan a que vuelva la red.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 7 * 86400_000, networkMode: 'offlineFirst', retry: 1 },
    mutations: { networkMode: 'online' },
  },
});

// SEG-003: la caché persistente se activa por usuario en lib/cache-privada.ts (desde SesionProvider).
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SesionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SesionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
