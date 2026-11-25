export type Rol = 'coach' | 'coach_aux' | 'alumno' | 'tutor';
export type Estado = 'por_hacer' | 'en_proceso' | 'en_revision' | 'hecha';
export type Robot = 'VEX' | 'FTC' | 'Ambos';

export type Perfil = {
  id: string;
  usuario: string;
  nombre_visible: string;
  iniciales: string;
  color: string;
  rol_global: Rol;
  activo: boolean;
  debe_cambiar_password: boolean;
  password_temporal_vence: string | null;
  acepto_privacidad_at: string | null;
  creado_at: string;
};

export type Area = { id: string; nombre: string; color: string; color_claro: string; icono: string; orden: number };
export type Membresia = { usuario_id: string; area_id: string; es_lider: boolean };

export type Meta = {
  id: string;
  titulo: string;
  robot: Robot;
  competencia_id: string | null;
  fecha: string | null;
  areas: string[];
};
export type Competencia = { id: string; nombre: string; fecha_inicio: string; fecha_fin: string; equipo: string | null };

export type Paso = { id: string; tarea_id: string; orden: number; texto: string; hecho: boolean };

export type Tarea = {
  id: string;
  titulo: string;
  para_que_sirve: string;
  area_id: string;
  meta_id: string | null;
  robot: Robot;
  estado: Estado;
  pide_ayuda: boolean;
  mensaje_ayuda: string | null;
  herramienta_url: string | null;
  fecha_limite: string | null;
  creada_por: string | null;
  creada_at: string;
  actualizada_at: string;
  aprobada_por: string | null;
  aprobada_at: string | null;
  tarea_responsables: { usuario_id: string }[];
  tarea_pasos: Paso[];
  evidencias?: { id: string; tipo: 'foto' | 'enlace' }[];
};

export type Evidencia = { id: string; tarea_id: string; tipo: 'foto' | 'enlace'; url: string; subida_por: string | null; creado_at: string };
export type Comentario = { id: string; tarea_id: string; autor_id: string | null; texto: string; creado_at: string };
export type Historial = { id: number; tarea_id: string; actor_id: string | null; accion: string; detalle: string | null; creado_at: string };

export type AvanceArea = {
  area_id: string; nombre: string; color: string; color_claro: string;
  hechas: number; total: number; por_revisar: number; piden_ayuda: number; vencidas: number;
};
export type AvanceMeta = { meta_id: string; hechas: number; total: number };

export const ACTIVAS: Estado[] = ['por_hacer', 'en_proceso', 'en_revision'];

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  por_hacer: 'Por hacer',
  en_proceso: 'En proceso',
  en_revision: 'En revisión',
  hecha: 'Hecho',
};

export const ROBOT_NOMBRE: Record<Robot, string> = { VEX: 'VEX · Override', FTC: 'FTC · BioBuzz', Ambos: 'Ambos robots' };
