// =====================================================================
// DOMINIO: HORARIOS DE LAS CLASES
// ---------------------------------------------------------------------
// El campus tiene tres clases (Software, Inglés y SER) con horarios fijos que se repiten cada semana. Cada una
// es un "bloque": una sala, una hora de inicio y fin, ciertos días y un grupo (db.horarios). Aquí viven las
// reglas sobre ellos; cargarlos desde un CSV está en src/domain/horarios-importar.js.
// Reglas:
//   1. Una sala con clase no se puede reservar a esa hora (409 SALA_CON_CLASE), igual que una ya reservada.
//   2. SOLO bloquean los bloques con días confirmados. Un bloque sin días (dias = null) se guarda y se
//      revisa, pero no cierra la sala: no se bloquea con un dato que no se sabe, porque si estuviera mal
//      dejaría la sala inservible para todos.
//   3. Una sala con clase en curso se muestra como ocupada ahora.
//   4. analizarHorarios() encuentra los problemas de planeación: cruces de sala, de docente y de cohorte,
//      aforo excedido, cohortes sin contraparte, módulos intercambiados y datos incompletos.
// Funciones puras: reciben `db` (db.horarios puede faltar: se trata como vacío) y no tocan la base.
// =====================================================================

import { REGLAS } from '../config/reglas.js';
import { diaDeLaSemana, minutosDelDia, minutosEntre } from './fechas.js';
import { buscarSala, plano } from './salas.js';

export const TIPOS_CLASE = ['software', 'ingles', 'ser'];
export const ETIQUETAS_CLASE = { software: 'Software', ingles: 'Inglés', ser: 'SER' };
// Título de cada tipo de hallazgo, en el orden en que se muestran (informe de terminal y pantalla de horarios)
export const TITULOS_HALLAZGO = {
  'cruce-sala': 'Salas con dos clases a la vez',
  'cruce-docente': 'Docentes en dos lugares a la vez',
  'cruce-cohorte': 'Cohortes con dos clases a la vez',
  aforo: 'Aforo excedido',
  'sin-contraparte': 'Cohortes que están en una clase y no en la otra',
  modulo: 'Módulos que no cuadran con su sala',
  incompleto: 'Datos incompletos',
  'sin-dias': 'Días de la semana',
};
export const NOMBRES_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// ---------- horas y días ----------

/** "7:00", "07:00" o "07:00:00" -> "07:00". null si no es una hora válida. */
export function normalizarHora(texto) {
  const m = String(texto ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

export const minutosDeHora = (hora) => Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));

const DIA = {
  l: 1, lu: 1, lun: 1, lunes: 1,
  ma: 2, mar: 2, martes: 2,
  x: 3, mi: 3, mie: 3, miercoles: 3,
  j: 4, ju: 4, jue: 4, jueves: 4,
  v: 5, vi: 5, vie: 5, viernes: 5,
  s: 6, sa: 6, sab: 6, sabado: 6,
  d: 7, do: 7, dom: 7, domingo: 7,
};

/**
 * Los días de un bloque, escritos como sea que los escriba Coordinación -> {dias: [1..7] | null} o {error}.
 * Vacío = todavía sin confirmar (dias null). Entiende "L-V", "lunes a viernes", "lun, mie, vie", "L X V", "todos".
 * La letra "M" sola es ambigua (¿martes o miércoles?) y se rechaza: ahí un error vale más que adivinar mal.
 */
export function parsearDias(texto) {
  const t = String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s,;/-]/g, ' ').trim();
  if (!t) return { dias: null };
  if (/^(todos|todos los dias|diario|a diario)$/.test(t)) return { dias: [1, 2, 3, 4, 5, 6, 7] };
  // El rango pide guion, o la palabra "a"/"hasta" entre espacios: si no, "sabado" se leería como "sab a do"
  const rango = t.match(/^([a-z]+)(?:\s*-\s*|\s+(?:a|hasta)\s+)([a-z]+)$/);
  if (rango && DIA[rango[1]] && DIA[rango[2]]) {
    const [desde, hasta] = [DIA[rango[1]], DIA[rango[2]]];
    if (desde > hasta) return { error: `el rango de días "${texto}" va al revés` };
    return { dias: Array.from({ length: hasta - desde + 1 }, (_, i) => desde + i) };
  }
  const dias = new Set();
  for (const ficha of t.split(/[\s,;/-]+|\by\b/).filter(Boolean)) {
    if (ficha === 'm') return { error: `en "${texto}" la "M" es ambigua (¿martes o miércoles?): escribe "mar" o "mie", o usa X para miércoles` };
    if (DIA[ficha]) { dias.add(DIA[ficha]); continue; }
    // Letras pegadas ("LXV"): cada letra es un día; con "M" no se puede saber cuál es
    if (/^[lxjvsd]{2,}$/.test(ficha)) { [...ficha].forEach((c) => dias.add(DIA[c])); continue; }
    return { error: `no se entienden los días "${texto}" (escribe por ejemplo "L-V", "lunes a viernes" o "lun, mie, vie")` };
  }
  return { dias: [...dias].sort((a, b) => a - b) };
}

/** [1,2,3,4,5] -> "lunes a viernes"; [1,3,5] -> "lunes, miércoles, viernes"; null -> "días sin confirmar". */
export function describirDias(dias) {
  if (!dias?.length) return 'días sin confirmar';
  if (dias.length > 2 && dias.every((d, i) => i === 0 || d === dias[i - 1] + 1)) return `${NOMBRES_DIA[dias[0]]} a ${NOMBRES_DIA[dias.at(-1)]}`;
  return dias.map((d) => NOMBRES_DIA[d]).join(', ');
}

// ---------- ocupación de las salas (reservas y tablero) ----------

const bloquesDe = (db) => db.horarios ?? [];
const diaIso = (texto) => diaDeLaSemana(texto) || 7; // 0 (domingo) -> 7

/** Texto para los mensajes: "clase de Software (J1 Dic-25) de 06:00 a 09:30". */
export function describirBloque(b) {
  return `clase de ${ETIQUETAS_CLASE[b.tipo]} (${b.grupo}) de ${b.horaInicio} a ${b.horaFin}`;
}

/**
 * El bloque con días confirmados que ocupa la sala en esa franja ("YYYY-MM-DDTHH:mm"), o undefined.
 * La franja se mira en el día en que empieza (las reservas duran horas y no cruzan de día).
 */
export function claseQueOcupa(db, espacioId, inicio, fin) {
  const dia = diaIso(inicio);
  const desde = minutosDelDia(inicio);
  const hasta = desde + minutosEntre(inicio, fin);
  return bloquesDe(db).find((b) => b.espacioId === espacioId && b.dias?.includes(dia)
    && desde < minutosDeHora(b.horaFin) && minutosDeHora(b.horaInicio) < hasta);
}

/** El bloque con días confirmados que está ocurriendo en la sala en el instante `ahora`, o undefined. */
export function claseEnCurso(db, espacioId, ahora) {
  const dia = diaIso(ahora);
  const minuto = minutosDelDia(ahora);
  return bloquesDe(db).find((b) => b.espacioId === espacioId && b.dias?.includes(dia)
    && minutosDeHora(b.horaInicio) <= minuto && minuto < minutosDeHora(b.horaFin));
}

// ---------- análisis de planeación (para Coordinación) ----------

const cruzanHoras = (a, b) => minutosDeHora(a.horaInicio) < minutosDeHora(b.horaFin) && minutosDeHora(b.horaInicio) < minutosDeHora(a.horaFin);

/** 'si' si comparten algún día, 'quiza' si a alguno le faltan los días, 'no' si seguro no coinciden. */
function compartenDias(a, b) {
  if (!a.dias || !b.dias) return 'quiza';
  return a.dias.some((d) => b.dias.includes(d)) ? 'si' : 'no';
}

const etiqueta = (b) => `${ETIQUETAS_CLASE[b.tipo]} ${b.grupo} (${b.horaInicio}-${b.horaFin})`;
const lineasDe = (...bloques) => bloques.map((b) => b.linea).filter(Boolean);
const nota = (certeza) => (certeza === 'quiza' ? ' Puede que no: a alguno le faltan los días.' : '');

// "D1 Oct-25" -> {codigo: "D1", texto}; null si el grupo no tiene ese formato (un "Grupo 4" de inglés).
// La fecha (Oct-25) es cuándo ENTRÓ la cohorte: no la identifica ni se compara. La identifica el código (D1).
function cohorte(grupo) {
  const m = String(grupo).trim().match(/^([A-Za-z]\d)\s+([A-Za-zñÑ]+)\.?[\s-]*(\d{2,4})$/);
  if (!m) return null;
  return { codigo: m[1].toUpperCase(), texto: grupo.trim() };
}

/**
 * Busca los problemas de planeación de un conjunto de bloques ({tipo, espacioId, horaInicio, horaFin, dias,
 * grupo, estudiantes, docente, modulo, linea?}). Devuelve [{tipo, mensaje, lineas}], en español, listos para
 * mostrar. `linea` (opcional) es la fila del archivo de donde salió cada bloque.
 */
export function analizarHorarios(bloques, espacios) {
  const hallazgos = [];
  const sala = (b) => espacios.find((e) => e.id === b.espacioId)?.nombre ?? b.espacioId;
  const agregar = (tipo, mensaje, ...conLinea) => hallazgos.push({ tipo, mensaje, lineas: lineasDe(...conLinea) });

  for (let i = 0; i < bloques.length; i++) {
    for (let j = i + 1; j < bloques.length; j++) {
      const [a, b] = [bloques[i], bloques[j]];
      if (!cruzanHoras(a, b)) continue;
      const dias = compartenDias(a, b);
      if (dias === 'no') continue;
      if (a.espacioId === b.espacioId) {
        agregar('cruce-sala', `${sala(a)} tiene dos clases a la vez: ${etiqueta(a)} y ${etiqueta(b)}.${nota(dias)}`, a, b);
      }
      if (a.docente && b.docente && plano(a.docente) === plano(b.docente)) {
        agregar('cruce-docente', `${a.docente} está en dos lugares a la vez: ${etiqueta(a)} en ${sala(a)} y ${etiqueta(b)} en ${sala(b)}.${nota(dias)}`, a, b);
      }
      const [ca, cb] = [cohorte(a.grupo), cohorte(b.grupo)];
      if (ca && cb && ca.codigo === cb.codigo && a.tipo !== b.tipo) {
        agregar('cruce-cohorte', `La cohorte ${ca.texto} tiene ${ETIQUETAS_CLASE[a.tipo]} y ${ETIQUETAS_CLASE[b.tipo]} al mismo tiempo: ${etiqueta(a)} y ${etiqueta(b)}.${nota(dias)}`, a, b);
      }
    }
  }

  for (const b of bloques) {
    const espacio = espacios.find((e) => e.id === b.espacioId);
    if (espacio?.aforo && b.estudiantes > Math.floor(espacio.aforo * REGLAS.MARGEN_AFORO)) {
      agregar('aforo', `${sala(b)} admite ${Math.floor(espacio.aforo * REGLAS.MARGEN_AFORO)} personas y ${etiqueta(b)} tiene ${b.estudiantes} estudiantes.`, b);
    }
    if (b.tipo !== 'ser' && !b.docente) agregar('incompleto', `${etiqueta(b)} en ${sala(b)} no tiene docente.`, b);
    if (b.tipo === 'software' && !b.estudiantes) agregar('incompleto', `${etiqueta(b)} en ${sala(b)} tiene ${b.estudiantes ?? 'sin'} estudiantes: ¿es una cohorte terminada o falta el dato?`, b);
    // El módulo de Software se llama como la sala ("Apolo 1"): si nombra otra sala, algo está intercambiado
    if (b.tipo === 'software' && b.modulo) {
      const nombreDelModulo = b.modulo.replace(/\s*\d+\s*$/, '');
      const { espacio: otra } = buscarSala(nombreDelModulo, espacios);
      if (otra && otra.id !== b.espacioId) agregar('modulo', `${etiqueta(b)} está en ${sala(b)} pero su módulo dice "${b.modulo}" (${otra.nombre}): ¿están intercambiados?`, b);
    }
  }

  // Software y SER son de la misma cohorte (los mismos campers): si una tiene una y la otra no, se avisa.
  // El mes y el año que acompañan al código son la fecha de ingreso y pueden diferir: no se marcan.
  const porCodigo = new Map();
  for (const b of bloques.filter((x) => x.tipo === 'software' || x.tipo === 'ser')) {
    const c = cohorte(b.grupo);
    if (!c) continue;
    if (!porCodigo.has(c.codigo)) porCodigo.set(c.codigo, []);
    porCodigo.get(c.codigo).push({ b, c });
  }
  for (const lista of porCodigo.values()) {
    const tipos = new Set(lista.map(({ b }) => b.tipo));
    if (tipos.size === 1) {
      const [falta, tiene] = tipos.has('software') ? ['SER', 'Software'] : ['Software', 'SER'];
      agregar('sin-contraparte', `La cohorte ${lista[0].c.texto} tiene ${tiene} pero no aparece en ${falta}.`, ...lista.map(({ b }) => b));
    }
  }

  const sinDias = bloques.filter((b) => !b.dias);
  if (sinDias.length) {
    agregar('sin-dias', `${sinDias.length} de ${bloques.length} bloques no traen los días de la semana: se guardan, pero no bloquean reservas hasta confirmarlos.`);
  }
  return hallazgos;
}
