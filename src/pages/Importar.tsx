// Importar datos (coach principal): subir la hoja, revisarla SIN escribir y cargarla por etapas.
// Las contraseñas no pasan por la hoja ni por el registro: las cuentas nuevas salen con su ficha, aquí mismo.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import readXlsxFile from 'read-excel-file/browser';
import writeXlsxFile from 'write-excel-file/browser';
import { LayoutCoach } from '../components/Coach';
import { Icon } from '../components/Icon';
import { Boton, Cargando, EmptyState, Sheet, useToast } from '../components/ui';
import { Fichas } from './Cuentas';
import { admin, type Ficha } from '../lib/datos';
import { COLUMNAS, PESTANAS, conteo, filasDe, idEstable, pestanaDe, revisar, type Existentes, type Hoja, type Plan } from '../lib/importar';
import { ejecutar, type Avance, type Resultado } from '../lib/importar-ejecutar';
import { useSesion } from '../lib/sesion';
import { supabase } from '../lib/supabase';

async function leerExistentes(): Promise<Existentes> {
  const [a, p, m, t, ta] = await Promise.all([
    supabase.from('areas').select('id, nombre'),
    supabase.from('profiles').select('id, usuario, nombre_visible, rol_global, activo'),
    supabase.from('membresias').select('usuario_id, area_id, es_lider'),
    supabase.from('tutores_alumnos').select('tutor_id, alumno_id'),
    supabase.from('tareas').select('id, titulo, area_id'),
  ]);
  const e = a.error ?? p.error ?? m.error ?? t.error ?? ta.error;
  if (e) throw new Error(e.message);
  return { areas: a.data!, perfiles: p.data!, membresias: m.data!, tutorias: t.data!, tareas: ta.data! };
}

const EJEMPLO: Record<keyof Hoja, string[][]> = {
  areas: [['PROG', 'Programación', 'Código y autonomía'], ['MEC', 'Mecánica', '']],
  cuentas: [['ALU-01', 'Ana López', 'ana.l', 'alumno'], ['ALU-02', 'Diego Pérez', '', 'alumno'], ['TUT-01', 'Familia de Ana', '', 'tutor']],
  asignaciones: [['ALU-01', 'PROG', 'lider'], ['ALU-02', 'MEC', '']],
  tutorias: [['TUT-01', 'ALU-01']],
  tareas: [['TAR-01', 'Calibrar el sensor de color', 'PROG', 'ALU-01', '2026-12-05', 'VEX', 'Para el autónomo', 'Medir; Ajustar; Probar'], ['TAR-02', 'Armar el chasis', 'MEC', 'ALU-02', '2026-12-10 18:00', 'Ambos', '', '']],
};

async function descargarPlantilla() {
  const hojas = (Object.keys(COLUMNAS) as (keyof Hoja)[]).map((k) => ({
    sheet: PESTANAS[k],
    data: [COLUMNAS[k].map((c) => ({ value: c, fontWeight: 'bold' as const })), ...EJEMPLO[k].map((r) => r.map((v) => ({ value: v })))],
    columns: COLUMNAS[k].map(() => ({ width: 22 })),
  }));
  await writeXlsxFile(hojas).toFile('plantilla-tablero-zero.xlsx');
}

const nuevas = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;

const ETAPA: Record<Avance['etapa'], string> = { areas: 'Áreas', cuentas: 'Cuentas y asignaciones', tutorias: 'Tutores', tareas: 'Tareas' };

export default function Importar() {
  const { esCoachPrincipal } = useSesion();
  const toast = useToast();
  const [archivo, setArchivo] = useState<string | null>(null);
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [avance, setAvance] = useState<Avance | null>(null);
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [fichas, setFichas] = useState<Ficha[] | null>(null);

  if (!esCoachPrincipal) {
    return <LayoutCoach><EmptyState titulo="Solo el coach principal" texto="La carga de datos la hace el coach principal." /></LayoutCoach>;
  }

  async function abrir(f: File | undefined) {
    if (!f) return;
    setError(null);
    setResultado(null);
    setLeyendo(true);
    try {
      const hojas = await readXlsxFile(f);
      const h: Hoja = { areas: [], cuentas: [], asignaciones: [], tutorias: [], tareas: [] };
      const reconocidas: string[] = [];
      for (const s of hojas) {
        const k = pestanaDe(s.sheet);
        if (!k) continue;
        h[k] = filasDe(s.data as unknown[][]);
        reconocidas.push(s.sheet);
      }
      if (!reconocidas.length) throw new Error('No encontré pestañas Áreas, Cuentas, Asignaciones, Tutorías ni Tareas. Usa la plantilla.');
      setArchivo(f.name);
      setHoja(h);
      setPlan(revisar(h, await leerExistentes(), { coachPrincipal: true }));
    } catch (e) {
      setError((e as Error).message.includes('zip') ? 'El archivo no es un Excel (.xlsx). En Google Sheets: Archivo → Descargar → Microsoft Excel.' : (e as Error).message);
      setPlan(null);
    } finally {
      setLeyendo(false);
    }
  }

  async function revisarOtraVez() {
    if (!hoja) return;
    setPlan(revisar(hoja, await leerExistentes(), { coachPrincipal: true }));
  }

  async function cargar() {
    if (!plan || !hoja) return;
    setConfirmar(false);
    setCargando(true);
    try {
      const lote = await idEstable(`lote|${archivo}|${JSON.stringify(hoja)}`);
      const r = await ejecutar(plan, {
        crearArea: async (a) => {
          const { data, error: e } = await supabase.from('areas').insert(a).select('id').single();
          if (e || !data?.id) throw new Error(e?.message ?? 'No se pudo crear el área.');
          return data.id as string;
        },
        crearCuenta: (cuerpo) => admin<{ fichas: Ficha[]; ya_creadas?: { usuario: string }[] }>(cuerpo),
        asignar: async (usuario_id, area_id, es_lider) => {
          const { error: e } = await supabase.from('membresias').upsert({ usuario_id, area_id, es_lider });
          if (e) throw new Error(e.message);
        },
        vincularTutor: async (tutor_id, alumno_id) => {
          const { error: e } = await supabase.from('tutores_alumnos').upsert({ tutor_id, alumno_id });
          if (e) throw new Error(e.message);
        },
        guardarTarea: async (p) => {
          const { error: e } = await supabase.rpc('guardar_tarea', { p });
          if (e) throw new Error(e.message);
        },
        existentes: leerExistentes,
        registrar: async (etapa, resumen) => {
          const { error: e } = await supabase.rpc('registrar_importacion', { p_id: lote, p_archivo: archivo ?? 'hoja', p_etapa: etapa, p_resumen: resumen });
          if (e) throw new Error(e.message);
        },
      }, setAvance);
      setResultado(r);
      if (r.fichas.length) setFichas(r.fichas);
      toast(r.fallos.length ? { tipo: 'error', titulo: 'Carga con pendientes.', texto: 'Revisa las filas que fallaron y vuelve a cargar: no se duplica nada.' } : { titulo: 'Carga terminada.' });
      await revisarOtraVez();
    } catch (e) {
      toast({ tipo: 'error', titulo: 'No se pudo cargar.', texto: (e as Error).message });
    } finally {
      setCargando(false);
      setAvance(null);
    }
  }

  const n = plan ? conteo(plan) : null;
  const porCrear = n ? n.areas.nueva + n.cuentas.nueva + n.tutorias.nueva + n.tareas.nueva : 0;
  const graves = plan?.problemas.filter((p) => p.grave) ?? [];
  const avisos = plan?.problemas.filter((p) => !p.grave) ?? [];

  return (
    <LayoutCoach>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-[11px] tracking-[.06em] text-tinta-3 md:text-xs">CARGA DE DATOS REALES</span>
        <h1 className="m-0 font-titulo text-[24px] font-bold text-vino md:text-[30px]">Importar desde una hoja</h1>
      </div>

      <section className="flex max-w-3xl flex-col gap-3 rounded-tarjeta border border-linea bg-white p-4">
        <ol className="m-0 flex flex-col gap-1.5 pl-5 text-sm leading-[1.45] text-tinta-2">
          <li>Descarga la plantilla y llénala (o usa tu Google Sheets con las mismas pestañas y columnas). <strong>No pongas contraseñas.</strong></li>
          <li>Súbela aquí: primero se <strong>revisa sin escribir nada</strong> y te dice qué es nuevo, qué ya existe y qué hay que corregir.</li>
          <li>Empieza con un grupo pequeño. Cuando esté bien, carga el resto: repetir la misma hoja no duplica nada.</li>
        </ol>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Boton variante="fantasma" onClick={() => void descargarPlantilla()}><Icon name="descargar" size={18} /> Descargar plantilla</Boton>
          <label className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-campo bg-vino px-4 text-[15px] font-semibold text-crema">
            <Icon name="documento" size={18} /> {archivo ? 'Subir otra hoja' : 'Subir hoja (.xlsx)'}
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => { void abrir(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <span className="text-xs text-tinta-3">Fechas como 2026-12-05 (o 2026-12-05 18:30). Varios responsables separados por coma. Pasos separados por punto y coma.</span>
      </section>

      {leyendo && <Cargando texto="Revisando la hoja…" />}
      {error && <p role="alert" className="m-0 max-w-3xl rounded-campo bg-[#F6D6D6] px-3 py-2.5 text-sm font-semibold text-vino">{error}</p>}

      {plan && n && !leyendo && (
        <section className="flex max-w-3xl flex-col gap-3" aria-label="Revisión">
          <h2 className="m-0 font-titulo text-[19px] font-bold text-vino">Revisión de «{archivo}»</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([['Áreas', n.areas], ['Cuentas', n.cuentas], ['Tutorías', n.tutorias], ['Tareas', n.tareas]] as const).map(([t, c]) => (
              <div key={t} className="flex flex-col gap-0.5 rounded-campo border border-linea bg-white px-3 py-2.5">
                <strong className="text-sm text-vino">{t}</strong>
                <span className="text-xs text-tinta-2">{nuevas(c.nueva, 'nueva', 'nuevas')} · {c.existente} ya {c.existente === 1 ? 'existe' : 'existen'}</span>
                {c.error > 0 && <span className="text-xs font-semibold text-urgente">{c.error} con error</span>}
              </div>
            ))}
          </div>

          {graves.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-tarjeta border-2 border-ambar bg-white p-3.5">
              <strong className="text-sm text-vino">Corrige esto en la hoja y vuelve a subirla ({graves.length})</strong>
              <ul className="m-0 flex flex-col gap-1 pl-5 text-sm">
                {graves.map((p, i) => <li key={i}><span className="font-semibold">{p.hoja}, fila {p.fila}:</span> {p.mensaje}</li>)}
              </ul>
            </div>
          ) : porCrear === 0 ? (
            <p className="m-0 rounded-campo bg-atiempo-fondo px-3 py-2.5 text-sm font-semibold text-atiempo">Todo lo de esta hoja ya está en la app. No hay nada nuevo que cargar.</p>
          ) : (
            <p className="m-0 rounded-campo bg-atiempo-fondo px-3 py-2.5 text-sm font-semibold text-atiempo">Lista para cargar: no hay errores.</p>
          )}
          {avisos.length > 0 && (
            <div className="flex flex-col gap-1 rounded-campo bg-kanban p-3 text-sm">
              <strong className="text-vino">Para revisar (no impiden cargar)</strong>
              <ul className="m-0 flex flex-col gap-1 pl-5">{avisos.map((p, i) => <li key={i}><span className="font-semibold">{p.hoja}, fila {p.fila}:</span> {p.mensaje}</li>)}</ul>
            </div>
          )}

          {cargando && avance && (
            <div className="flex flex-col gap-1.5 rounded-campo border border-linea bg-white p-3" aria-live="polite">
              <span className="text-sm font-semibold text-vino">Cargando {ETAPA[avance.etapa]}… {avance.hechas} de {avance.total}</span>
              <div className="h-2 overflow-hidden rounded-full bg-vacio"><div className="h-full bg-vino transition-[width] duration-300" style={{ width: `${avance.total ? (avance.hechas / avance.total) * 100 : 100}%` }} /></div>
            </div>
          )}
          {!graves.length && porCrear > 0 && (
            <Boton disabled={cargando} onClick={() => setConfirmar(true)}>{cargando ? 'Cargando…' : `Cargar ${porCrear} ${porCrear === 1 ? 'registro nuevo' : 'registros nuevos'}`}</Boton>
          )}

          {resultado && (
            <div className="flex flex-col gap-2 rounded-tarjeta border border-linea bg-white p-3.5 text-sm">
              <strong className="text-vino">Resultado de la carga</strong>
              <span>Áreas: {resultado.creados.areas.length} · Cuentas: {resultado.creados.cuentas.length} · Asignaciones: {resultado.creados.asignaciones.length} · Tutorías: {resultado.creados.tutorias.length} · Tareas: {resultado.creados.tareas.length}</span>
              {resultado.fallos.length > 0 && (
                <>
                  <strong className="text-urgente">No se cargaron ({resultado.fallos.length}):</strong>
                  <ul className="m-0 pl-5">{resultado.fallos.map((f, i) => <li key={i}>{ETAPA[f.etapa]} · {f.clave}: {f.mensaje}</li>)}</ul>
                  <span className="text-xs text-tinta-3">Vuelve a tocar Cargar: lo que ya se creó no se repite.</span>
                </>
              )}
              {resultado.fichas.length > 0 && <Boton variante="fantasma" onClick={() => setFichas(resultado.fichas)}><Icon name="imprimir" size={18} /> Ver fichas de las cuentas nuevas</Boton>}
              <Link to="/coach/cuentas" className="text-sm font-semibold">Revisar cuentas creadas</Link>
            </div>
          )}
        </section>
      )}

      <Sheet abierto={confirmar} onCerrar={() => setConfirmar(false)} titulo="Cargar a la app">
        {n && (
          <ul className="m-0 flex flex-col gap-1 pl-5 text-sm">
            <li>{nuevas(n.areas.nueva, 'área nueva', 'áreas nuevas')}</li>
            <li>{nuevas(n.cuentas.nueva, 'cuenta nueva', 'cuentas nuevas')} (con su ficha y contraseña temporal)</li>
            <li>{nuevas(n.tutorias.nueva, 'vínculo de tutoría', 'vínculos de tutoría')}</li>
            <li>{nuevas(n.tareas.nueva, 'tarea nueva', 'tareas nuevas')}</li>
          </ul>
        )}
        <p className="m-0 text-sm text-tinta-2">Lo que ya existe no se toca. Al terminar verás las fichas para imprimirlas: es la única vez que se muestran.</p>
        <div className="flex gap-2">
          <Boton variante="secundario" onClick={() => setConfirmar(false)}>Cancelar</Boton>
          <Boton className="flex-grow" onClick={() => void cargar()}>Sí, cargar</Boton>
        </div>
      </Sheet>
      <Fichas fichas={fichas} onCerrar={() => setFichas(null)} />
    </LayoutCoach>
  );
}
