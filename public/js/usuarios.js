// Pestaña "Usuarios" (solo admin): crear cuentas (profesor, soporte técnico u otro admin;
// POST /api/usuarios), ver quién creó cada una (GET /api/usuarios) y darle una contraseña
// temporal a quien olvidó la suya (POST /api/usuarios/:usuario/clave).

import { pedir } from './api.js';
import { el, conCarga } from './dom.js';
import { nombreDeRol, puede, sesionActual } from './sesion.js';
import * as toasts from './toasts.js';

export function iniciarUsuarios() {
  if (!puede('gestionarUsuarios')) return; // la pestaña sigue oculta
  document.getElementById('p-usuarios').hidden = false;
  document.getElementById('form-usuario').addEventListener('submit', crear);
  // Recargar la lista cada vez que se abre la pestaña
  document.getElementById('p-usuarios').addEventListener('click', cargarUsuarios);
}

async function cargarUsuarios() {
  const lista = document.getElementById('lista-usuarios');
  try {
    const usuarios = await pedir('/api/usuarios');
    const yo = sesionActual()?.usuario;
    lista.replaceChildren(...usuarios.map((u, i) => {
      // creadoPor null: la primera cuenta (se registró sola) o una cuenta anterior a este registro
      const origen = u.creadoPor
        ? `Creada por ${u.creadoPorNombre ?? u.creadoPor}`
        : i === 0 ? 'Primera cuenta: se registró desde la pantalla de inicio' : 'Cuenta anterior: no se registró quién la creó';
      const item = el('li', { className: 'item' },
        el('div', { className: 'item__cabeza' },
          el('span', { className: 'item__titulo' }, u.nombre),
          el('span', { className: 'etiqueta' }, nombreDeRol(u.rol))),
        el('span', { className: 'item__meta dato' }, u.usuario),
        el('span', { className: 'item__meta' }, `${origen} · ${fecha(u.creado)}`),
        u.debeCambiarClave ? el('span', { className: 'item__meta' }, 'Tiene una contraseña temporal sin cambiar.') : null);
      if (u.usuario !== yo) {
        item.append(el('div', { className: 'item__acciones' },
          el('button', { type: 'button', className: 'btn btn--secundario btn--chico', onClick: (e) => restablecer(u, item, e.currentTarget) },
            'Contraseña temporal')));
      }
      return item;
    }));
  } catch (error) {
    lista.replaceChildren(el('li', { className: 'aviso', role: 'alert' }, `No se pudo cargar la lista: ${error.message}`));
  }
}

const fecha = (fechaHora) => (fechaHora ? `${fechaHora.slice(8, 10)}/${fechaHora.slice(5, 7)}/${fechaHora.slice(0, 4)}` : '');

// Para quien olvidó su contraseña: el servidor genera una temporal, cierra sus sesiones y la obliga a cambiarla.
async function restablecer(cuenta, item, boton) {
  if (!window.confirm(`¿Darle una contraseña temporal a ${cuenta.nombre}? Su contraseña actual dejará de servir y se cerrarán sus sesiones.`)) return;
  try {
    const { claveTemporal } = await conCarga(boton, 'Generando…', () =>
      pedir(`/api/usuarios/${encodeURIComponent(cuenta.usuario)}/clave`, { metodo: 'POST' }));
    item.querySelector('.clave-temporal')?.remove();
    item.append(el('div', { className: 'clave-temporal', role: 'status' },
      el('span', { className: 'item__meta' }, `Contraseña temporal de ${cuenta.usuario} (se muestra solo esta vez):`),
      el('code', {}, claveTemporal),
      el('span', { className: 'item__meta' }, 'Entrégala en persona. Al entrar, Campus Pulse le pedirá cambiarla.')));
  } catch (error) {
    toasts.error(error);
  }
}

async function crear(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const vacio = [...form.querySelectorAll('[required]')].find((campo) => !campo.value.trim());
  if (vacio) {
    toasts.error('Completa todos los campos.');
    vacio.focus();
    return;
  }
  const cuerpo = Object.fromEntries(new FormData(form));
  try {
    const nueva = await conCarga(form.querySelector('button[type="submit"]'), 'Creando…',
      () => pedir('/api/usuarios', { metodo: 'POST', cuerpo }));
    toasts.exito(`Cuenta creada: ${nueva.usuario} (${nombreDeRol(nueva.rol)}).`);
    form.reset();
    await cargarUsuarios();
  } catch (error) {
    toasts.error(error);
  }
}
