import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import './index.css';
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

let almacen: Storage | undefined;
try {
  almacen = window.localStorage;
} catch {
  almacen = undefined;
}
const persister = createSyncStoragePersister({ storage: almacen, key: 'tz.cache' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 7 * 86400_000, buster: 'v1' }}>
      <SesionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SesionProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);
