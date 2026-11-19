// Avisos flotantes: verde para éxito, rojo para error, ámbar para avisos (algo que le pasó a otra persona o a ti).

const DURACION_EXITO_MS = 4000;
const DURACION_ERROR_MS = 6000; // los errores se leen con más calma (clic para cerrar antes)
const DURACION_AVISO_MS = 9000; // los avisos llegan sin que la persona los espere: duran más

const contenedor = () => document.getElementById('toasts');

export function exito(mensaje) {
  mostrar({ mensaje, tipo: 'exito', duracion: DURACION_EXITO_MS });
}

// Aviso de algo que pasó (una solicitud nueva, una decisión): no es un error ni un éxito propio
export function aviso(mensaje) {
  mostrar({ mensaje, tipo: 'aviso', duracion: DURACION_AVISO_MS });
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
