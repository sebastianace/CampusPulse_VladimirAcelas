// Vista móvil (movil.html): reportar incidencias desde el celular.
// Usa el mismo flujo que el tablero (js/incidencias.js): la IA sugiere,
// la persona confirma y el backend aplica las reglas. El tablero del
// proyector lo ve en su siguiente refresco automático.

import { pedir } from './api.js';
import { cargarTodo, suscribir } from './estado.js';
import { iniciarIncidencias, dibujarIncidencias } from './incidencias.js';
import * as toasts from './toasts.js';

const INTERVALO_REFRESCO_MS = 10000;
let sinConexionAvisado = false;

async function refrescar() {
  const { errores } = await cargarTodo();
  const caido = errores.find((e) => e.codigo === 'SIN_CONEXION');
  if (caido && !sinConexionAvisado) toasts.error(caido);
  sinConexionAvisado = Boolean(caido);
}

// Resumen corto: qué salas están fuera de servicio ahora mismo
function dibujarEstadoCampus({ espacios }) {
  const fuera = espacios.filter((e) => e.estado === 'inhabilitado');
  const texto = document.getElementById('estado-campus');
  if (!espacios.length) { // todavía no llegan los datos (o el servidor no respondió): no decir "0 salas"
    texto.dataset.alerta = 'no';
    texto.textContent = 'Cargando el estado del campus…';
    return;
  }
  texto.dataset.alerta = fuera.length ? 'si' : 'no';
  texto.textContent = fuera.length
    ? `Fuera de servicio: ${fuera.map((e) => e.nombre).join(', ')}.`
    : `Las ${espacios.length} salas están en servicio.`;
}

// Con una contraseña temporal, el servidor no deja usar nada hasta cambiarla: se cambia en el tablero
// (ahí se abre sola) y después se puede volver al celular. Sin sesión, pedir() ya lleva al login.
pedir('/api/auth/yo').then((yo) => {
  if (yo.debeCambiarClave) location.href = '/';
}, () => {});

// En el celular no hay pestañas: mostrarPestana no hace nada
iniciarIncidencias({ refrescar, mostrarPestana: () => {} });
suscribir(dibujarEstadoCampus);
suscribir(dibujarIncidencias);
refrescar();

setInterval(() => {
  if (!document.hidden) refrescar();
}, INTERVALO_REFRESCO_MS);
