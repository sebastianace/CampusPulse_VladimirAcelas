// Estado compartido de la interfaz: lo último que respondió la API.
// Los módulos (mapa, timeline, listas…) se suscriben y se redibujan
// cada vez que llegan datos nuevos.

import { pedir } from './api.js';
import { nombreEnPlano } from './mapa/plano.js';

const estado = {
  espacios: [],
  recursos: [],
  reservas: [],
  horarios: [],           // clases fijas (Software, Inglés, SER); solo las que tienen días confirmados bloquean reservas
  incidencias: [],
  solicitudes: [],        // solicitudes de salón que le tocan a quien inició sesión
  fecha: hoyISO(),        // día que muestra la línea de tiempo
  actualizado: null,      // hora de la última carga exitosa
};

const suscriptores = new Set();

// Último "hoy" conocido: si el tablero queda abierto pasada la medianoche y se estaba viendo el día de hoy,
// la línea de tiempo pasa sola al día nuevo (si se estaba viendo otro día, se respeta)
let ultimoHoy = estado.fecha;

// Huella de los últimos datos dibujados: si una recarga trae exactamente
// lo mismo, no se redibuja (así no se cierran selects ni se reinician animaciones)
let ultimaHuella = '';

export function obtenerEstado() {
  return estado;
}

// Registra una función que se llama con el estado tras cada carga
export function suscribir(funcion) {
  suscriptores.add(funcion);
  return () => suscriptores.delete(funcion);
}

export function cambiarFecha(fecha) {
  estado.fecha = fecha;
  return cargarTodo();
}

/**
 * Pide todo a la API en paralelo. Si una ruta falla se conserva el dato
 * anterior de esa ruta y se devuelve el error, así una ruta caída
 * no deja la pantalla en blanco.
 */
export async function cargarTodo() {
  const hoy = hoyISO();
  if (hoy !== ultimoHoy) {
    if (estado.fecha === ultimoHoy) estado.fecha = hoy;
    ultimoHoy = hoy;
  }
  const consultas = {
    espacios: '/api/espacios',
    recursos: '/api/recursos',
    reservas: `/api/reservas?fecha=${estado.fecha}`,
    horarios: '/api/horarios',
    incidencias: '/api/incidencias',
    solicitudes: '/api/solicitudes',
  };

  const claves = Object.keys(consultas);
  const resultados = await Promise.allSettled(claves.map((clave) => pedir(consultas[clave])));

  const errores = [];
  resultados.forEach((resultado, i) => {
    if (resultado.status === 'fulfilled') estado[claves[i]] = Array.isArray(resultado.value) ? resultado.value : [];
    else errores.push(resultado.reason);
  });

  // Las salas renombradas en el campus (Sputnik, Sala de reuniones…) se muestran con su
  // nombre nuevo en todo el tablero; el de la API queda en nombreApi
  estado.espacios = estado.espacios.map((e) => {
    if (e.nombreApi !== undefined) return e; // ya traducido (la ruta falló y se conservó)
    const nombre = nombreEnPlano(e.id);
    return { ...e, nombreApi: e.nombre, nombre: nombre ?? e.nombre };
  });

  if (errores.length < claves.length) estado.actualizado = new Date();

  // La hora (al minuto) entra en la huella para que la línea "ahora" avance
  const huella = JSON.stringify([ahoraBogota(), ...claves.map((c) => estado[c]), estado.fecha]);
  const cambio = huella !== ultimaHuella;
  if (cambio) {
    ultimaHuella = huella;
    suscriptores.forEach((funcion) => funcion(estado));
  }
  return { errores, cambio };
}

// Fecha y hora actuales en Bogotá con formato YYYY-MM-DDTHH:mm, igual que el backend
// (así coincide aunque el navegador tenga otra zona horaria)
export function ahoraBogota(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha);
  const valor = (tipo) => partes.find((p) => p.type === tipo).value;
  return `${valor('year')}-${valor('month')}-${valor('day')}T${valor('hour')}:${valor('minute')}`;
}

// Fecha de hoy en Bogotá: YYYY-MM-DD
export function hoyISO(fecha = new Date()) {
  return ahoraBogota(fecha).slice(0, 10);
}
