// Pestaña "Usuarios" (solo admin): crear cuentas (profesor, soporte técnico u otro admin;
// POST /api/usuarios), ver quién creó cada una (GET /api/usuarios), darle una contraseña
// temporal a quien olvidó la suya (POST /api/usuarios/:usuario/clave) y poner el correo al
// que le llegan los avisos de sus reservas y solicitudes (PATCH /api/usuarios/:usuario) y definir quién atiende
// cada categoría de incidencia (PUT /api/responsables/:categoria): el reparto automático.

import { pedir } from './api.js';
import { el, conCarga } from './dom.js';
import { CATEGORIAS } from './catalogos.js';
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
    dibujarResponsables(usuarios);
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
        el('span', { className: 'item__meta' }, u.correo ? `Avisos a ${u.correo}` : 'Sin correo: los avisos le llegan solo en la app.'),
        u.debeCambiarClave ? el('span', { className: 'item__meta' }, 'Tiene una contraseña temporal sin cambiar.') : null);
      item.append(el('div', { className: 'item__acciones' },
        el('button', { type: 'button', className: 'btn btn--secundario btn--chico', onClick: () => editarCorreo(u, item) },
          u.correo ? 'Cambiar correo' : 'Agregar correo'),
        u.usuario !== yo
          ? el('button', { type: 'button', className: 'btn btn--secundario btn--chico', onClick: (e) => restablecer(u, item, e.currentTarget) },
            'Contraseña temporal')
          : null));
      return item;
    }));
  } catch (error) {
    lista.replaceChildren(el('li', { className: 'aviso', role: 'alert' }, `No se pudo cargar la lista: ${error.message}`));
  }
}

const fecha = (fechaHora) => (fechaHora ? `${fechaHora.slice(8, 10)}/${fechaHora.slice(5, 7)}/${fechaHora.slice(0, 4)}` : '');

// Abre, dentro de la cuenta, un campo para el correo de avisos. Vacío = quitarlo.
function editarCorreo(cuenta, item) {
  if (item.querySelector('.form-correo')) return;
  const entrada = el('input', { name: 'correo', type: 'email', value: cuenta.correo ?? '', autocomplete: 'off', autocapitalize: 'none',
    placeholder: 'ej. ana.gomez@campuslands.com', 'aria-label': `Correo de ${cuenta.nombre}` });
  const form = el('form', { className: 'formulario form-correo', noValidate: true },
    el('label', { className: 'campo' }, el('span', {}, 'Correo para avisos (vacío para quitarlo)'), entrada),
    el('div', { className: 'item__acciones' },
      el('button', { type: 'submit', className: 'btn btn--primario btn--chico' }, 'Guardar correo'),
      el('button', { type: 'button', className: 'btn btn--secundario btn--chico', onClick: () => form.remove() }, 'Cancelar')));
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    try {
      const { correo } = await conCarga(form.querySelector('button[type="submit"]'), 'Guardando…', () =>
        pedir(`/api/usuarios/${encodeURIComponent(cuenta.usuario)}`, { metodo: 'PATCH', cuerpo: { correo: entrada.value.trim() } }));
      toasts.exito(correo ? `Los avisos de ${cuenta.nombre} llegarán a ${correo}.` : `${cuenta.nombre} ya no recibe avisos por correo.`);
      await cargarUsuarios();
    } catch (error) {
      toasts.error(error);
      entrada.focus();
    }
  });
  item.append(form);
  entrada.focus();
}

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
    document.dispatchEvent(new CustomEvent('cuentas-cambiaron')); // las sugerencias de responsable la incluyen
    await cargarUsuarios();
  } catch (error) {
    toasts.error(error);
  }
}

// ---------- Reparto de incidencias por categoría ----------

// Una fila por categoría con la lista de quienes pueden atender (soporte técnico y admins). Guarda al cambiar.
async function dibujarResponsables(usuarios) {
  const contenedor = document.getElementById('responsables');
  let actuales;
  try {
    actuales = await pedir('/api/responsables');
  } catch (error) {
    contenedor.replaceChildren(el('p', { className: 'aviso', role: 'alert' }, `No se pudo cargar el reparto: ${error.message}`));
    return;
  }
  const quienes = usuarios.filter((u) => ['soporte_tecnico', 'admin'].includes(u.rol));
  contenedor.replaceChildren(...Object.entries(CATEGORIAS).map(([categoria, texto]) => {
    const actual = actuales.find((r) => r.categoria === categoria)?.usuario ?? '';
    const selector = el('select', { name: categoria },
      el('option', { value: '', selected: !actual }, 'Sin responsable'),
      quienes.map((u) => el('option', { value: u.usuario, selected: u.usuario === actual }, `${u.nombre} (${nombreDeRol(u.rol)})`)));
    selector.addEventListener('change', () => guardarResponsable(categoria, texto, selector));
    return el('label', { className: 'campo' }, el('span', {}, texto), selector);
  }));
}

async function guardarResponsable(categoria, texto, selector) {
  selector.disabled = true;
  try {
    const { nombre, asignadas } = await pedir(`/api/responsables/${encodeURIComponent(categoria)}`, {
      metodo: 'PUT', cuerpo: { usuario: selector.value || null },
    });
    toasts.exito(nombre
      ? `${nombre} atiende ${texto.toLowerCase()}.${asignadas ? ` ${asignadas} incidencia${asignadas === 1 ? '' : 's'} abierta${asignadas === 1 ? '' : 's'} sin responsable ${asignadas === 1 ? 'pasó' : 'pasaron'} a su nombre.` : ''}`
      : `${texto} ya no tiene responsable: las incidencias nuevas quedan sin asignar.`);
  } catch (error) {
    toasts.error(error);
    await cargarUsuarios(); // vuelve a mostrar lo que de verdad quedó guardado
  } finally {
    selector.disabled = false;
  }
}
