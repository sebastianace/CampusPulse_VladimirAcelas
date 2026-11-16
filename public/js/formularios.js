// Formularios de reserva (crear, editar y cancelar) y solicitud de un salón ocupado.
// El navegador solo revisa que los campos estén completos; las reglas
// del campus (aforo, solapamiento, horario, límites…) las decide el
// backend y su mensaje se muestra tal cual.

import { pedir } from './api.js';
import { el, conCarga } from './dom.js';
import { ESTADOS_ESPACIO, etiqueta } from './catalogos.js';
import { ahoraBogota, cambiarFecha, obtenerEstado } from './estado.js';
import { puedeTocarReserva, sesionActual } from './sesion.js';
import * as toasts from './toasts.js';

let refrescar = async () => {};
let mostrarPestana = () => {};

// Id de la reserva que se está editando; null = el formulario crea una reserva nueva
let editandoId = null;

// Formulario "Solicitar este salón" abierto (se conserva al redibujar la lista, con lo que ya se escribió)
let solicitando = null; // { reservaId, form }

/** Conecta los formularios. Recibe funciones de app.js para no depender de él en círculo. */
export function iniciarFormularios(opciones) {
  refrescar = opciones.refrescar;
  mostrarPestana = opciones.mostrarPestana;

  const formReserva = document.getElementById('form-reserva');

  formReserva.fecha.value = obtenerEstado().fecha;
  // El responsable por defecto es quien inició sesión; las sugerencias son las cuentas reales
  formReserva.responsable.value = sesionActual()?.nombre ?? '';
  cargarResponsables();
  formReserva.addEventListener('submit', enviarReserva);
  document.getElementById('btn-descartar-edicion').addEventListener('click', terminarEdicion);

  // Clic en un bloque de la línea de tiempo -> editar esa reserva
  document.addEventListener('reserva-seleccionada', ({ detail }) => empezarEdicion(detail));

  // Al editar un campo se limpian sus errores
  formReserva.addEventListener('input', (evento) => {
    limpiarErrorCampo(evento.target);
    mostrarAviso(formReserva, null);
  });

  // Clic en una sala del plano o en una franja de la línea de tiempo
  // -> preseleccionar sala (y fecha/hora si vienen) para reservar
  document.addEventListener('espacio-seleccionado', ({ detail }) => {
    mostrarPestana('p-reservar');
    formReserva.espacioId.value = detail.id;
    if (detail.fecha) formReserva.fecha.value = detail.fecha;
    if (detail.horaInicio) formReserva.horaInicio.value = detail.horaInicio;
    if (detail.horaFin) formReserva.horaFin.value = detail.horaFin;
    ['espacioId', 'fecha', 'horaInicio', 'horaFin'].forEach((campo) => limpiarErrorCampo(formReserva[campo]));
    mostrarAviso(formReserva, null);
    formReserva.responsable.focus();
  });
}

/** Redibuja el select de espacios y la lista de reservas con los datos nuevos. */
export function actualizarFormularios({ espacios, reservas, fecha }) {
  llenarSelectEspacios(espacios);
  dibujarReservas(reservas, fecha);
}

// ---------- Reserva ----------

// Llena las sugerencias del campo "Responsable" con los nombres de las cuentas (GET /api/usuarios/nombres).
// Sigue siendo texto libre: se puede reservar a nombre de alguien sin cuenta.
async function cargarResponsables() {
  try {
    const personas = await pedir('/api/usuarios/nombres');
    document.getElementById('lista-responsables').replaceChildren(...personas.map((p) => el('option', { value: p.nombre })));
  } catch {
    // Sin sugerencias se puede escribir el nombre igual
  }
}

async function enviarReserva(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  if (!validarCompletos(form)) return;

  const { fecha, horaInicio, horaFin } = form;
  if (horaFin.value <= horaInicio.value) {
    marcarErrorCampo(horaFin, 'La hora de fin debe ser posterior a la de inicio.');
    horaFin.focus();
    return;
  }

  const cuerpo = {
    espacioId: form.espacioId.value,
    responsable: form.responsable.value.trim(),
    asistentes: Number(form.asistentes.value),
    inicio: `${fecha.value}T${horaInicio.value}`,
    fin: `${fecha.value}T${horaFin.value}`,
  };

  const boton = form.querySelector('button[type="submit"]');
  try {
    if (editandoId) {
      // Editar: el backend vuelve a aplicar todas las reglas
      const ruta = `/api/reservas/${encodeURIComponent(editandoId)}`;
      const reserva = await conCarga(boton, 'Guardando…', () => pedir(ruta, { metodo: 'PATCH', cuerpo }));
      toasts.exito(`Reserva actualizada: ${nombreEspacio(reserva.espacioId)}, ${hora(reserva.inicio)}–${hora(reserva.fin)}.`);
      terminarEdicion();
      await cambiarFecha(fecha.value);
      return;
    }
    const reserva = await conCarga(boton, 'Reservando…', () => pedir('/api/reservas', { metodo: 'POST', cuerpo }));
    toasts.exito(`Reserva creada: ${nombreEspacio(reserva.espacioId)}, ${hora(reserva.inicio)}–${hora(reserva.fin)}.${avisoLlegada(reserva)}`);
    document.dispatchEvent(new CustomEvent('reserva-creada', { detail: reserva }));
    form.responsable.value = sesionActual()?.nombre ?? '';
    form.asistentes.value = '';
    // Mostrar en la línea de tiempo el día de la reserva recién creada
    await cambiarFecha(fecha.value);
  } catch (error) {
    mostrarAviso(form, error.message);
    toasts.error(error);
  }
}

// ---------- Editar y cancelar reservas ----------

// Lista de reservas del día que muestra la línea de tiempo, con sus acciones.
// Las que ya empezaron no se pueden tocar, y las de otra persona solo las toca un admin (lo valida el
// backend; aquí solo se ocultan los botones). Si una reserva de otra persona está en curso, se puede
// solicitar el salón: un admin decide (src/domain/solicitudes.js).
function dibujarReservas(reservas, fecha) {
  document.getElementById('titulo-reservas').textContent = `Reservas del ${fechaCorta(fecha)}`;
  const lista = document.getElementById('lista-reservas');
  const delDia = reservas.filter((r) => r.inicio?.startsWith(fecha)).sort((a, b) => a.inicio.localeCompare(b.inicio));

  if (!delDia.length) {
    lista.replaceChildren(el('li', { className: 'vacio' }, 'No hay reservas este día.'));
    return;
  }

  const ahora = ahoraBogota();
  const yo = sesionActual()?.usuario;
  lista.replaceChildren(...delDia.map((reserva) => {
    const empezo = reserva.inicio <= ahora;
    const enCurso = empezo && ahora < reserva.fin;
    const propia = Boolean(reserva.creadaPor) && reserva.creadaPor === yo;
    const estado = enCurso ? ' · en curso' : empezo ? ' · terminó' : '';
    const item = el('li', { className: 'item' },
      el('div', { className: 'item__cabeza' },
        el('span', { className: 'item__titulo' }, nombreEspacio(reserva.espacioId)),
        el('span', { className: 'item__meta dato' }, `${hora(reserva.inicio)}–${hora(reserva.fin)}`)),
      el('span', { className: 'item__meta' }, `${reserva.responsable} · ${reserva.asistentes} asistentes${estado}${propia ? ' · tuya' : ''}`));

    if (!empezo && puedeTocarReserva(reserva)) {
      item.append(el('div', { className: 'item__acciones' },
        el('button', { type: 'button', className: 'btn btn--secundario btn--chico', onClick: () => empezarEdicion(reserva) }, 'Editar'),
        el('button', { type: 'button', className: 'btn btn--peligro btn--chico', onClick: (e) => cancelar(reserva, e.currentTarget) }, 'Cancelar reserva')));
    } else if (enCurso && !propia) {
      item.append(el('div', { className: 'item__acciones' },
        el('button', { type: 'button', className: 'btn btn--secundario btn--chico', onClick: () => abrirSolicitud(item, reserva) }, 'Solicitar este salón')));
      if (solicitando?.reservaId === reserva.id) item.append(solicitando.form);
    }
    return item;
  }));
  if (solicitando && !delDia.some((r) => r.id === solicitando.reservaId)) solicitando = null;
}

// ---------- Solicitar un salón ocupado ----------

function campo(texto, control, clase = 'campo') {
  return el('label', { className: clase }, el('span', {}, texto), control);
}

// Abre, debajo de la reserva en curso, el formulario para pedirle el salón a un admin.
function abrirSolicitud(item, reserva) {
  if (solicitando?.reservaId === reserva.id) {
    solicitando.form.querySelector('textarea').focus();
    return;
  }
  const form = el('form', { className: 'formulario solicitud', noValidate: true },
    el('p', { className: 'nota' },
      `Si ${reserva.responsable} no está usando el salón, un admin puede asignártelo. Al aprobarlo, su reserva termina en ese momento y la tuya empieza.`),
    el('div', { className: 'fila' },
      campo('Responsable', el('input', { name: 'responsable', type: 'text', required: true, value: sesionActual()?.nombre ?? '', autocomplete: 'off' })),
      campo('Asistentes', el('input', { name: 'asistentes', type: 'number', min: '1', inputMode: 'numeric', required: true }), 'campo campo--corto')),
    campo('Hasta', el('input', { name: 'hasta', type: 'time', step: '900', required: true, value: hora(reserva.fin) })),
    campo('¿Por qué lo necesitas?', el('textarea', {
      name: 'motivo', rows: 2, maxLength: 300, required: true, placeholder: 'Ej.: el profesor de las 9:00 no llegó y tengo un taller con 15 personas',
    })),
    el('div', { className: 'item__acciones' },
      el('button', { type: 'submit', className: 'btn btn--primario btn--chico' }, 'Enviar solicitud'),
      el('button', { type: 'button', className: 'btn btn--secundario btn--chico', onClick: () => { solicitando = null; form.remove(); } }, 'Cancelar')));
  form.addEventListener('submit', (e) => enviarSolicitud(e, reserva));
  form.addEventListener('input', (e) => limpiarErrorCampo(e.target));
  solicitando = { reservaId: reserva.id, form };
  item.append(form);
  form.asistentes.focus();
}

async function enviarSolicitud(evento, reserva) {
  evento.preventDefault();
  const form = evento.currentTarget;
  if (!validarCompletos(form)) return;
  const cuerpo = {
    reservaId: reserva.id,
    responsable: form.responsable.value.trim(),
    asistentes: Number(form.asistentes.value),
    fin: `${reserva.inicio.slice(0, 10)}T${form.hasta.value}`,
    motivo: form.motivo.value.trim(),
  };
  try {
    await conCarga(form.querySelector('button[type="submit"]'), 'Enviando…', () => pedir('/api/solicitudes', { metodo: 'POST', cuerpo }));
    toasts.exito(`Solicitud enviada: ${nombreEspacio(reserva.espacioId)} hasta las ${form.hasta.value}. Un admin la revisará; la respuesta te llega aquí y en la pestaña Solicitudes.`);
    solicitando = null;
    form.remove();
    await refrescar();
  } catch (error) {
    mostrarAviso(form, error.message);
    toasts.error(error);
  }
}

// Carga la reserva en el formulario y lo pasa a modo edición
function empezarEdicion(reserva) {
  if (reserva.inicio <= ahoraBogota()) {
    toasts.error('Esta reserva ya empezó y no se puede editar.');
    return;
  }
  if (!puedeTocarReserva(reserva)) {
    toasts.error('Solo quien creó la reserva o un administrador puede editarla.');
    return;
  }
  mostrarPestana('p-reservar');
  const form = document.getElementById('form-reserva');
  editandoId = reserva.id;
  form.espacioId.value = reserva.espacioId;
  form.responsable.value = reserva.responsable;
  form.asistentes.value = reserva.asistentes;
  form.fecha.value = reserva.inicio.slice(0, 10);
  form.horaInicio.value = hora(reserva.inicio);
  form.horaFin.value = hora(reserva.fin);
  [...form.elements].forEach(limpiarErrorCampo);
  mostrarAviso(form, null);
  form.querySelector('button[type="submit"]').textContent = 'Guardar cambios';
  document.getElementById('btn-descartar-edicion').hidden = false;
  form.asistentes.focus();
}

// Vuelve el formulario a modo "crear reserva"
function terminarEdicion() {
  const form = document.getElementById('form-reserva');
  editandoId = null;
  form.responsable.value = sesionActual()?.nombre ?? '';
  form.asistentes.value = '';
  mostrarAviso(form, null);
  form.querySelector('button[type="submit"]').textContent = 'Reservar sala';
  document.getElementById('btn-descartar-edicion').hidden = true;
}

async function cancelar(reserva, boton) {
  const detalle = `${nombreEspacio(reserva.espacioId)}, ${hora(reserva.inicio)}–${hora(reserva.fin)}`;
  if (!window.confirm(`¿Cancelar la reserva de ${detalle} a nombre de ${reserva.responsable}?`)) return;
  try {
    await conCarga(boton, 'Cancelando…', () =>
      pedir(`/api/reservas/${encodeURIComponent(reserva.id)}`, { metodo: 'DELETE' }));
    if (editandoId === reserva.id) terminarEdicion();
    toasts.exito(`Reserva cancelada: ${detalle}.`);
    await refrescar();
  } catch (error) {
    toasts.error(error);
  }
}

// Si la reserva empieza más tarde, avisar que el mapa la llenará a esa hora
export function avisoLlegada(reserva) {
  return reserva.inicio > ahoraBogota() ? ` Los asistentes llegarán a la sala a las ${hora(reserva.inicio)}.` : '';
}

function llenarSelectEspacios(espacios) {
  const select = document.querySelector('#form-reserva select[name="espacioId"]');
  const opciones = [...espacios]
    .sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''))
    .map((e) => {
      // Las salas no disponibles se pueden elegir: el backend explica por qué no se reservan
      const estado = e.estado === 'disponible' ? '' : ` · ${etiqueta(ESTADOS_ESPACIO, e.estado)}`;
      const aforo = Number.isFinite(e.aforo) ? `${e.aforo} puestos` : 'aforo desconocido';
      return el('option', { value: e.id }, `${e.nombre} · ${aforo}${estado}`);
    });
  reemplazarOpciones(select, opciones, 'Elige un espacio');
}

// ---------- Utilidades de formulario ----------

// Revisa los campos obligatorios; marca el primero vacío y le da el foco
function validarCompletos(form) {
  const vacios = [...form.querySelectorAll('[required]')].filter((campo) => !String(campo.value).trim());
  vacios.forEach((campo) => marcarErrorCampo(campo, 'Este campo es obligatorio.'));

  const asistentes = form.asistentes;
  if (asistentes && asistentes.value && !(Number(asistentes.value) >= 1)) {
    marcarErrorCampo(asistentes, 'Debe ser al menos 1 persona.');
    vacios.push(asistentes);
  }

  if (vacios.length) vacios[0].focus();
  return vacios.length === 0;
}

function marcarErrorCampo(campo, mensaje) {
  const contenedor = campo.closest('.campo');
  let error = contenedor.querySelector('.campo__error');
  if (!error) {
    error = el('small', { className: 'campo__error', id: `error-${campo.name}-${campo.form.id}` });
    contenedor.append(error);
  }
  error.textContent = mensaje;
  campo.setAttribute('aria-invalid', 'true');
  campo.setAttribute('aria-describedby', error.id);
}

function limpiarErrorCampo(campo) {
  if (!campo?.closest) return;
  campo.closest('.campo')?.querySelector('.campo__error')?.remove();
  campo.removeAttribute('aria-invalid');
  campo.removeAttribute('aria-describedby');
}

// Aviso persistente debajo del botón con el motivo del rechazo del backend
function mostrarAviso(form, mensaje) {
  let aviso = form.querySelector('.aviso');
  if (!mensaje) {
    aviso?.remove();
    return;
  }
  if (!aviso) {
    aviso = el('p', { className: 'aviso', role: 'alert' });
    form.append(aviso);
  }
  aviso.textContent = mensaje;
}

// Cambia las opciones de un select conservando la que estaba elegida
function reemplazarOpciones(select, opciones, textoVacio) {
  const elegido = select.value;
  select.replaceChildren(el('option', { value: '', disabled: true, defaultSelected: true }, textoVacio), ...opciones);
  select.value = [...select.options].some((o) => o.value === elegido && elegido) ? elegido : '';
}

function nombreEspacio(id) {
  return obtenerEstado().espacios.find((e) => e.id === id)?.nombre ?? id;
}

const hora = (fechaHora) => fechaHora?.slice(11, 16) ?? '';

// "2026-10-16T14:05" -> "16/10 14:05"
function fechaCorta(fechaHora) {
  if (!fechaHora) return '';
  const [fecha, horaMin] = fechaHora.split('T');
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes}${horaMin ? ` ${horaMin.slice(0, 5)}` : ''}`;
}
