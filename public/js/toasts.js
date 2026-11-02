// Avisos flotantes: verde para éxito, rojo para error.

const DURACION_EXITO_MS = 4000;
const DURACION_ERROR_MS = 6000; // los errores se leen con más calma (clic para cerrar antes)

const contenedor = () => document.getElementById('toasts');

export function exito(mensaje) {
  mostrar({ mensaje, tipo: 'exito', duracion: DURACION_EXITO_MS });
}

// Acepta un texto o un Error (si es ErrorApi, muestra también su código)
export function error(errorOMensaje) {
  const esError = errorOMensaje instanceof Error;
  mostrar({
    mensaje: esError ? errorOMensaje.message : String(errorOMensaje),
    codigo: esError ? errorOMensaje.codigo : undefined,
    tipo: 'error',
    duracion: DURACION_ERROR_MS,
  });
}

function mostrar({ mensaje, codigo, tipo, duracion }) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${tipo}`;
  toast.setAttribute('role', tipo === 'error' ? 'alert' : 'status');

  // textContent: el mensaje nunca se interpreta como HTML
  toast.textContent = mensaje;

  if (codigo) {
    const etiqueta = document.createElement('span');
    etiqueta.className = 'toast__codigo';
    etiqueta.textContent = codigo;
    toast.append(etiqueta);
  }

  const cerrar = () => toast.remove();
  toast.addEventListener('click', cerrar);
  setTimeout(cerrar, duracion);

  contenedor().append(toast);
}
