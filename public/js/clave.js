// "Cambiar mi contraseña" (POST /api/auth/clave).
// Si la contraseña es temporal (la puso un admin o npm run restablecer-admin), el diálogo
// se abre solo y no se puede cerrar: el servidor bloquea el resto de la app (403) hasta cambiarla.

import { pedir } from './api.js';
import { conCarga } from './dom.js';
import * as toasts from './toasts.js';

export function iniciarClave({ obligatorio = false } = {}) {
  const dialogo = document.getElementById('dialogo-clave');
  const form = document.getElementById('form-clave');
  const cancelar = document.getElementById('cancelar-clave');

  document.getElementById('btn-clave').addEventListener('click', () => abrir(false));
  cancelar.addEventListener('click', () => dialogo.close());
  // Con contraseña temporal, Esc no cierra el diálogo
  dialogo.addEventListener('cancel', (e) => { if (dialogo.dataset.obligatorio === 'true') e.preventDefault(); });
  form.addEventListener('submit', enviar);
  if (obligatorio) abrir(true);

  function abrir(esObligatorio) {
    form.reset();
    dialogo.dataset.obligatorio = String(esObligatorio);
    document.getElementById('nota-clave').hidden = !esObligatorio;
    cancelar.hidden = esObligatorio;
    if (!dialogo.open) dialogo.showModal();
    form.claveActual.focus();
  }

  async function enviar(evento) {
    evento.preventDefault();
    const { claveActual, claveNueva, repetir } = form;
    if (!claveActual.value || claveNueva.value.length < 8) {
      toasts.error('Escribe tu contraseña actual y una nueva de al menos 8 caracteres.');
      return;
    }
    if (claveNueva.value !== repetir.value) {
      toasts.error('Las dos contraseñas nuevas no coinciden.');
      repetir.focus();
      return;
    }
    try {
      await conCarga(form.querySelector('button[type="submit"]'), 'Cambiando…', () =>
        pedir('/api/auth/clave', { metodo: 'POST', cuerpo: { claveActual: claveActual.value, claveNueva: claveNueva.value } }));
      const eraObligatorio = dialogo.dataset.obligatorio === 'true';
      dialogo.close();
      toasts.exito('Contraseña cambiada. Se cerraron tus otras sesiones.');
      if (eraObligatorio) window.location.reload(); // ahora sí carga todo el tablero
    } catch (error) {
      toasts.error(error);
    }
  }
}
