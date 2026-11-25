import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Cargando, SinInternet } from './components/ui';
import { useSesion } from './lib/sesion';
import Entrar from './pages/Entrar';

const Bienvenida = lazy(() => import('./pages/Bienvenida'));
const MiTablero = lazy(() => import('./pages/MiTablero'));
const TareaDetalle = lazy(() => import('./pages/TareaDetalle'));
const TareaForm = lazy(() => import('./pages/TareaForm'));
const MiArea = lazy(() => import('./pages/MiArea'));
const Coach = lazy(() => import('./pages/Coach'));
const Cuentas = lazy(() => import('./pages/Cuentas'));
const TableroArea = lazy(() => import('./pages/TableroArea'));
const Fichas = lazy(() => import('./pages/Fichas'));
const Varias = import('./pages/Varias');
const Perfil = lazy(() => import('./pages/Perfil'));
const Avisos = lazy(() => Varias.then((m) => ({ default: m.Avisos })));
const Logros = lazy(() => import('./pages/Logros'));
const Metas = lazy(() => import('./pages/Metas'));
const Materiales = lazy(() => import('./pages/Materiales'));
const BitacoraMeta = lazy(() => import('./pages/Metas').then((m) => ({ default: m.BitacoraMeta })));
const Familia = lazy(() => Varias.then((m) => ({ default: m.Familia })));
const Estados = lazy(() => Varias.then((m) => ({ default: m.Estados })));

type Rol = 'coach' | 'alumno' | 'tutor';

/** Pide sesión, obliga el primer ingreso y filtra por rol. La RLS es la protección real. */
function Protegida({ children, roles }: { children: ReactNode; roles?: Rol[] }) {
  const { cargando, sesion, perfil, esCoach, esTutor } = useSesion();
  const loc = useLocation();
  if (cargando) return <Cargando />;
  if (!sesion) return <Navigate to="/entrar" replace state={{ desde: loc.pathname }} />;
  if (!perfil) return <Cargando texto="Preparando tu cuenta…" />;
  if (!perfil.activo) return <Navigate to="/entrar" replace />;
  if (perfil.debe_cambiar_password && loc.pathname !== '/bienvenida') return <Navigate to="/bienvenida" replace />;
  const rol: Rol = esCoach ? 'coach' : esTutor ? 'tutor' : 'alumno';
  if (roles && !roles.includes(rol)) return <Navigate to={rol === 'coach' ? '/coach' : rol === 'tutor' ? '/familia' : '/'} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <SinInternet />
      <Suspense fallback={<Cargando />}>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route path="/bienvenida" element={<Protegida><Bienvenida /></Protegida>} />
          <Route path="/" element={<Protegida roles={['alumno']}><MiTablero /></Protegida>} />
          <Route path="/area" element={<Protegida roles={['alumno']}><MiArea /></Protegida>} />
          <Route path="/tarea/nueva" element={<Protegida roles={['alumno', 'coach']}><TareaForm /></Protegida>} />
          <Route path="/tarea/:id/editar" element={<Protegida roles={['alumno', 'coach']}><TareaForm /></Protegida>} />
          <Route path="/tarea/:id" element={<Protegida><TareaDetalle /></Protegida>} />
          <Route path="/coach" element={<Protegida roles={['coach']}><Coach /></Protegida>} />
          <Route path="/coach/area" element={<Protegida roles={['coach']}><TableroArea modo="coach" /></Protegida>} />
          <Route path="/coach/area/:id" element={<Protegida roles={['coach']}><TableroArea modo="coach" /></Protegida>} />
          <Route path="/area/tablero" element={<Protegida roles={['alumno']}><TableroArea modo="lider" /></Protegida>} />
          <Route path="/area/tablero/:id" element={<Protegida roles={['alumno']}><TableroArea modo="lider" /></Protegida>} />
          <Route path="/coach/fichas" element={<Protegida roles={['coach']}><Fichas /></Protegida>} />
          <Route path="/coach/cuentas" element={<Protegida roles={['coach']}><Cuentas /></Protegida>} />
          <Route path="/familia" element={<Protegida roles={['tutor']}><Familia /></Protegida>} />
          <Route path="/perfil" element={<Protegida><Perfil /></Protegida>} />
          <Route path="/avisos" element={<Protegida><Avisos /></Protegida>} />
          <Route path="/logros" element={<Protegida roles={['alumno', 'coach']}><Logros /></Protegida>} />
          <Route path="/coach/logros" element={<Protegida roles={['coach']}><Logros /></Protegida>} />
          <Route path="/materiales" element={<Protegida roles={['alumno', 'coach']}><Materiales /></Protegida>} />
          <Route path="/coach/metas" element={<Protegida roles={['coach']}><Metas /></Protegida>} />
          <Route path="/coach/metas/:id" element={<Protegida roles={['coach']}><BitacoraMeta /></Protegida>} />
          <Route path="/estados" element={<Estados />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
