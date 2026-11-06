// Punto de entrada de la interfaz. Conecta las piezas de la página.

import { cargarTodo, obtenerEstado, suscribir } from './estado.js';
import { iniciarMapa, dibujarMapa } from './mapa.js';
import { iniciarFormularios, actualizarFormularios } from './formularios.js';
import { iniciarIncidencias, dibujarIncidencias } from './incidencias.js';
import { iniciarTimeline, dibujarTimeline } from './timeline.js';
import { iniciarCalidad, cargarCalidad } from './calidad.js';
import { iniciarComando } from './comando.js';
import { dibujarPresion } from './presion.js';
import { iniciarDemo } from './demo.js';
import { cerrarSesion, pedir } from './api.js';
import { guardarSesion, nombreDeRol } from './sesion.js';
import { iniciarUsuarios } from './usuarios.js';
import * as toasts from './toasts.js';

// Pestañas del panel de acciones
function activarPestanas() {
  const pestanas = document.querySelectorAll('.pestana');

  pestanas.forEach((pestana) => {
    pestana.addEventListener('click', () => mostrarPestana(pestana.id));
  });
}

// Muestra la pestaña indicada y oculta las demás (se usa también desde otros módulos)
export function mostrarPestana(idPestana) {
  document.querySelectorAll('.pestana').forEach((pestana) => {
    const activa = pestana.id === idPestana;
    pestana.setAttribute('aria-selected', String(activa));
    document.getElementById(pestana.getAttribute('aria-controls')).hidden = !activa;
  });
}

// Barra de comando: botón y atajo Ctrl+K
function activarComando() {
  const dialogo = document.getElementById('comando');
  const abrir = () => {
    if (!dialogo.open) dialogo.showModal();
    dialogo.querySelector('input[name="texto"]').focus();
  };

  document.getElementById('abrir-comando').addEventListener('click', abrir);
  document.addEventListener('keydown', (evento) => {
    if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
      evento.preventDefault();
      abrir();
    }
  });
}

// Indicador de conexión en la barra superior
let conectado = null;

// Texto del indicador: "En vivo · hace 3 s" o "Sin conexión · reintentando"
function actualizarIndicador() {
  const indicador = document.getElementById('conexion');
  const texto = document.getElementById('conexion-texto');
  if (conectado === null) return;
  indicador.dataset.estado = conectado ? 'en-vivo' : 'caida';
  if (!conectado) {
    texto.textContent = 'Sin conexión · reintentando';
    return;
  }
  const { actualizado } = obtenerEstado();
  const segundos = actualizado ? Math.round((Date.now() - actualizado) / 1000) : 0;
  texto.textContent = segundos < 2 ? 'En vivo' : `En vivo · hace ${segundos} s`;
}

/**
 * Recarga todos los datos y redibuja si algo cambió. Los demás módulos
 * la llaman después de crear o modificar algo.
 */
export async function refrescar() {
  const { errores, cambio } = await cargarTodo();
  const hayConexion = !errores.some((e) => e.codigo === 'SIN_CONEXION');

  // Avisar solo cuando cambia la situación, no en cada recarga
  if (hayConexion !== conectado) {
    if (!hayConexion) toasts.error(errores[0]);
    else if (conectado === false) toasts.exito('Conexión con el servidor restablecida.');
    conectado = hayConexion;
  }
  actualizarIndicador();

  // Rutas que respondieron con error (p. ej. aún no implementadas en el backend)
  if (hayConexion && errores.length && cambio) console.warn('Algunas rutas fallaron:', errores.map((e) => e.message));
}

// ---------- Refresco automático ----------
// Cada pocos segundos se vuelve a consultar la API: si alguien reporta una
// incidencia desde otro equipo (o el celular), el plano cambia solo.
const INTERVALO_REFRESCO_MS = 5000;
let refrescoEnCurso = false;

async function refrescoAutomatico() {
  if (document.hidden || refrescoEnCurso) return; // pestaña oculta o consulta anterior sin terminar
  refrescoEnCurso = true;
  try {
    await refrescar();
  } finally {
    refrescoEnCurso = false;
  }
}

function activarRefrescoAutomatico() {
  setInterval(refrescoAutomatico, INTERVALO_REFRESCO_MS);
  setInterval(actualizarIndicador, 1000);
  // Al volver a la pestaña, ponerse al día de inmediato
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refrescoAutomatico();
  });
}

// Muestra quién inició sesión y conecta el botón "Salir".
// Sin sesión, pedir() ya lleva a la pantalla de inicio.
async function mostrarSesion() {
  const datos = await pedir('/api/auth/yo');
  guardarSesion(datos); // los demás módulos consultan el rol con puede()
  document.getElementById('sesion-nombre').textContent = datos.nombre;
  document.getElementById('sesion-nombre').title = `Usuario: ${datos.usuario} · Rol: ${nombreDeRol(datos.rol)}`;
  document.getElementById('sesion').hidden = false;
  document.getElementById('cerrar-sesion').addEventListener('click', cerrarSesion);
}

function iniciarTablero() {
  activarPestanas();
  activarComando();
  iniciarMapa();
  iniciarFormularios({ refrescar, mostrarPestana });
  iniciarIncidencias({ refrescar, mostrarPestana });
  iniciarTimeline();
  iniciarCalidad({ refrescar });
  iniciarUsuarios();
  iniciarComando({ mostrarPestana });
  iniciarDemo({ mostrarPestana });
  suscribir(dibujarMapa);
  suscribir(dibujarTimeline);
  suscribir(actualizarFormularios);
  suscribir(dibujarIncidencias);
  suscribir(dibujarPresion);
  // El reporte de calidad se carga después de los espacios (los usa para nombrar los grises)
  refrescar().then(cargarCalidad);
  activarRefrescoAutomatico();
}

// Primero se comprueba la sesión y luego arranca el tablero.
// Sin sesión, pedir() ya lleva al login; si el servidor no responde,
// el tablero arranca igual y muestra "Sin conexión · reintentando".
mostrarSesion().then(iniciarTablero, (error) => {
  if (error.codigo !== 'SESION_REQUERIDA') iniciarTablero();
});
