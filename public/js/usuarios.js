// Pestaña "Usuarios" (solo admin): crear profesores y soporte técnico
// (POST /api/usuarios) y ver las cuentas existentes (GET /api/usuarios).

import { pedir } from './api.js';
import { el, conCarga } from './dom.js';
import { nombreDeRol, puede } from './sesion.js';
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
    lista.replaceChildren(...usuarios.map((u) =>
      el('li', { className: 'item' },
        el('div', { className: 'item__cabeza' },
          el('span', { className: 'item__titulo' }, u.nombre),
          el('span', { className: 'etiqueta' }, nombreDeRol(u.rol))),
        el('span', { className: 'item__meta dato' }, u.usuario))));
  } catch (error) {
    lista.replaceChildren(el('li', { className: 'aviso', role: 'alert' }, `No se pudo cargar la lista: ${error.message}`));
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
