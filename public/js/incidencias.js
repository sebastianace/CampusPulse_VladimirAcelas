// Flujo vertical de incidencias:
//   texto libre -> POST /api/ia/triaje -> tarjeta editable "Sugerido por IA"
//   -> la persona confirma -> (¿hay una incidencia abierta parecida? -> "¿es la misma?")
//   -> POST /api/incidencias -> el plano se actualiza.
// Si la IA falla, se muestra el motivo y se abre el mismo formulario
// para llenarlo a mano (origen "manual"). La IA nunca guarda nada sola.
// Si la persona confirma que es la misma de una incidencia que ya existe, su reporte se suma a esa
// (POST /api/incidencias/:id/reportes) en vez de crear un duplicado. Si buscar parecidas falla, se
// crea la incidencia normalmente: la sugerencia es opcional.

import { pedir } from './api.js';
import { el, conCarga } from './dom.js';
import { CATEGORIAS, PRIORIDADES, etiqueta } from './catalogos.js';
import { obtenerEstado } from './estado.js';
import { puede } from './sesion.js';
import * as toasts from './toasts.js';
import { agregarDictado } from './voz.js';

let refrescar = async () => {};
let mostrarPestana = () => {};

const contenedorSugerencia = () => document.getElementById('sugerencia-ia');
const contenedorManual = () => document.getElementById('incidencia-manual');

export function iniciarIncidencias(opciones) {
  refrescar = opciones.refrescar;
  mostrarPestana = opciones.mostrarPestana;

  const form = document.getElementById('form-triaje');
  form.addEventListener('submit', clasificarConIA);
  form.descripcion.addEventListener('input', () => form.descripcion.removeAttribute('aria-invalid'));
  // Dictado por voz: solo aparece si el navegador lo soporta. Escribe en el campo; la persona revisa y envía.
  agregarDictado(form.descripcion, form.descripcion, { conTexto: true });
  document.getElementById('btn-manual').addEventListener('click', () => {
    abrirFormulario({ modo: 'manual', descripcion: form.descripcion.value.trim() });
  });
}

// ---------- 1. Pedir la clasificación a la IA ----------

async function clasificarConIA(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const descripcion = form.descripcion.value.trim();
  if (!descripcion) {
    form.descripcion.setAttribute('aria-invalid', 'true');
    form.descripcion.focus();
    toasts.error('Describe qué está pasando para poder clasificarlo.');
    return;
  }

  cerrarFormularios();
  const boton = form.querySelector('button[type="submit"]');
  try {
    const sugerencia = await conCarga(boton, 'La IA está clasificando…', () =>
      pedir('/api/ia/triaje', { metodo: 'POST', cuerpo: { descripcion } }));
    abrirFormulario({ modo: 'ia', descripcion, sugerencia });
  } catch (error) {
    // Sin IA el flujo sigue: formulario manual con el motivo visible
    toasts.error(error);
    abrirFormulario({ modo: 'manual', descripcion, motivoFallo: error.message });
  }
}

// ---------- 2. Tarjeta editable (IA) o formulario manual ----------

/**
 * modo "ia": tarjeta con la sugerencia precargada y la razón de la IA.
 * modo "manual": mismos campos vacíos, para cuando la IA no está disponible.
 */
function abrirFormulario({ modo, descripcion, sugerencia = {}, motivoFallo }) {
  cerrarFormularios();
  const { espacios, recursos } = obtenerEstado();
  const esIA = modo === 'ia';

  const form = el('form', { className: esIA ? 'tarjeta-ia' : 'tarjeta-manual', noValidate: true },
    esIA
      ? el('p', { className: 'sello-ia' }, 'Sugerido por IA',
        el('span', { className: 'sello-ia__modelo' }, sugerencia.modelo ? ` · ${sugerencia.modelo}` : ''))
      : el('p', { className: 'tarjeta-manual__titulo' }, 'Registrar incidencia a mano'),
    motivoFallo ? el('p', { className: 'aviso', role: 'alert' }, motivoFallo) : null,
    esIA && sugerencia.razon ? el('p', { className: 'razon-ia' }, sugerencia.razon) : null,
    campoTexto('descripcion', 'Descripción', descripcion),
    el('div', { className: 'fila' },
      campoSelect('categoria', 'Categoría', opcionesDe(CATEGORIAS), sugerencia.categoria, esIA),
      campoSelect('prioridad', 'Prioridad', opcionesDe(PRIORIDADES), sugerencia.prioridad, esIA)),
    campoSelect('espacioId', 'Espacio afectado', espacios.map((e) => [e.id, e.nombre]), sugerencia.espacioId, false, 'Ninguno'),
    campoSelect('recursoId', 'Equipo afectado', recursos.map((r) => [r.id, r.nombre]), sugerencia.recursoId, false, 'Ninguno'),
    campoFueraDeServicio(sugerencia),
    el('p', { className: 'nota' }, 'La atiende Soporte TI: es el equipo que resuelve los problemas técnicos y de infraestructura del campus.'),
    el('p', { className: 'nota' }, 'Según las reglas del campus, algunas prioridades dejan fuera de servicio el equipo afectado (o la sala, si no hay equipo) aunque elijas "Nada".'),
    el('div', { className: 'item__acciones' },
      el('button', { type: 'submit', className: 'btn btn--primario' }, esIA ? 'Confirmar y registrar' : 'Registrar incidencia'),
      el('button', { type: 'button', className: 'btn btn--secundario', onClick: cerrarFormularios }, 'Descartar')),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    registrar(form, esIA ? sugerencia : null);
  });
  form.addEventListener('change', (e) => {
    e.target.closest('.campo')?.classList.remove('campo--pendiente');
    if (e.target.name === 'espacioId' || e.target.name === 'recursoId') ajustarFueraDeServicio(form);
  });
  ajustarFueraDeServicio(form);

  const destino = esIA ? contenedorSugerencia() : contenedorManual();
  destino.replaceChildren(form);
  destino.hidden = false;
  form.querySelector('select, textarea')?.focus();
}

function cerrarFormularios() {
  [contenedorSugerencia(), contenedorManual()].forEach((c) => {
    c.replaceChildren();
    c.hidden = true;
  });
}

// ---------- 3. Confirmar: POST /api/incidencias ----------

async function registrar(form, sugerencia, { omitirParecidas = false } = {}) {
  const datos = Object.fromEntries(new FormData(form));
  const faltantes = ['descripcion', 'categoria', 'prioridad'].filter((campo) => !String(datos[campo] ?? '').trim());
  if (faltantes.length) {
    faltantes.forEach((campo) => form[campo].setAttribute('aria-invalid', 'true'));
    form[faltantes[0]].focus();
    toasts.error('Completa descripción, categoría y prioridad antes de registrar.');
    return;
  }

  const cuerpo = {
    descripcion: datos.descripcion.trim(),
    categoria: datos.categoria,
    prioridad: datos.prioridad,
    espacioId: datos.espacioId || null,
    recursoId: datos.recursoId || null,
    // "Solo el equipo" -> inhabilitar; "Toda la sala" -> inhabilitar y inhabilitarEspacio (ver src/domain/incidencias.js)
    inhabilitar: form.alcance.value !== 'ninguno',
    inhabilitarEspacio: form.alcance.value === 'espacio',
    origen: sugerencia ? 'ia' : 'manual',
    // Trazabilidad: qué propuso la IA y si la persona lo cambió
    ia: sugerencia ? {
      razon: sugerencia.razon ?? null,
      modelo: sugerencia.modelo ?? null,
      sugerencia: {
        categoria: sugerencia.categoria, prioridad: sugerencia.prioridad,
        espacioId: sugerencia.espacioId, recursoId: sugerencia.recursoId, inhabilitar: sugerencia.inhabilitar,
      },
      editadaPorPersona: ['categoria', 'prioridad', 'espacioId', 'recursoId']
        .some((c) => (sugerencia[c] ?? null) !== (c.endsWith('Id') ? datos[c] || null : datos[c])),
    } : null,
  };

  const boton = form.querySelector('button[type="submit"]');
  const destino = form.parentElement; // donde se muestra el formulario, por si hay que reemplazarlo un momento

  // Antes de crear: ¿ya hay una incidencia abierta que sea la misma?
  if (!omitirParecidas) {
    const parecidas = await conCarga(boton, 'Revisando si ya existe…', () => buscarParecidas(cuerpo));
    if (parecidas.length) {
      preguntarSiEsLaMisma({ form, destino, cuerpo, sugerencia, parecidas });
      return;
    }
  }

  try {
    const incidencia = await conCarga(boton, 'Registrando…', () => pedir('/api/incidencias', { metodo: 'POST', cuerpo }));
    toasts.exito(mensajeRegistro(incidencia));
    terminarRegistro();
    await refrescar();
    mostrarPestana('p-incidencias');
  } catch (error) {
    toasts.error(error);
  }
}

function terminarRegistro() {
  document.getElementById('form-triaje').reset();
  cerrarFormularios();
}

// ---------- 3b. ¿Es la misma incidencia? ----------

/**
 * Incidencias abiertas parecidas (POST /api/ia/similares). Si el servicio falla, está caído o se pasó
 * el límite de consultas a la IA, devuelve [] y la incidencia se crea sin la sugerencia.
 */
async function buscarParecidas(cuerpo) {
  try {
    const { candidatas } = await pedir('/api/ia/similares', {
      metodo: 'POST',
      cuerpo: { descripcion: cuerpo.descripcion, espacioId: cuerpo.espacioId, recursoId: cuerpo.recursoId },
    });
    return candidatas;
  } catch {
    return [];
  }
}

// Reemplaza el formulario por la pregunta. "Volver" lo restaura con lo que la persona ya había editado.
function preguntarSiEsLaMisma({ form, destino, cuerpo, sugerencia, parecidas }) {
  const panel = el('div', { className: 'parecidas', role: 'group', 'aria-labelledby': 'parecidas-titulo' },
    el('p', { className: 'tarjeta-manual__titulo', id: 'parecidas-titulo' }, '¿Es la misma incidencia?'),
    el('p', { className: 'nota' }, 'Ya hay incidencias abiertas muy parecidas. Si es el mismo problema, suma tu reporte a esa en lugar de crear una nueva.'),
    el('ul', { className: 'lista' }, parecidas.map((p) => itemParecido(p, cuerpo, destino))),
    el('div', { className: 'item__acciones' },
      el('button', {
        type: 'button', className: 'btn btn--secundario',
        onClick: () => { destino.replaceChildren(form); },
      }, 'Volver y editar'),
      el('button', {
        type: 'button', className: 'btn btn--secundario',
        onClick: (e) => conCarga(e.currentTarget, 'Registrando…', () => registrar(form, sugerencia, { omitirParecidas: true })),
      }, 'No, es distinta: crear una nueva')));
  destino.replaceChildren(panel);
  panel.querySelector('button')?.focus();
}

function itemParecido(parecida, cuerpo) {
  const lugar = [nombreEspacio(parecida.espacioId), nombreRecurso(parecida.recursoId)].filter(Boolean).join(' · ');
  const otros = parecida.reportesAdicionales;
  return el('li', { className: 'item' },
    el('div', { className: 'item__cabeza' },
      el('span', { className: 'item__titulo' }, parecida.descripcion),
      el('span', { className: 'etiqueta', title: 'Qué tan parecido es el significado del texto (similitud coseno)' }, `Parecido ${Math.round(parecida.similitud * 100)} %`)),
    el('span', { className: 'item__meta' }, [lugar, otros ? `${otros} reporte${otros > 1 ? 's' : ''} más` : null].filter(Boolean).join(' · ')),
    el('div', { className: 'item__acciones' },
      el('button', {
        type: 'button', className: 'btn btn--primario btn--chico',
        onClick: (e) => sumarAExistente(parecida, cuerpo, e.currentTarget),
      }, 'Es la misma: sumar mi reporte')));
}

async function sumarAExistente(parecida, cuerpo, boton) {
  try {
    await conCarga(boton, 'Sumando…', () => pedir(`/api/incidencias/${encodeURIComponent(parecida.id)}/reportes`, {
      metodo: 'POST', cuerpo: { descripcion: cuerpo.descripcion },
    }));
    toasts.exito('Tu reporte se sumó a la incidencia que ya existía. No se creó un duplicado.');
    terminarRegistro();
    await refrescar();
    mostrarPestana('p-incidencias');
  } catch (error) {
    toasts.error(error); // por ejemplo, si justo la resolvieron (409): puede volver y crear una nueva
  }
}

function mensajeRegistro(incidencia) {
  const afectados = fueraDeServicio(incidencia);
  if (!afectados.length) return 'Incidencia registrada.';
  return `Incidencia registrada. Fuera de servicio: ${afectados.join(' y ')}.`;
}

// Nombres de lo que la incidencia dejó fuera de servicio: el equipo, la sala o los dos.
function fueraDeServicio(incidencia) {
  if (!incidencia.inhabilito) return [];
  return [
    incidencia.inhabilitoEspacio ? nombreEspacio(incidencia.espacioId) : '',
    nombreRecurso(incidencia.recursoId),
  ].filter(Boolean);
}

// ---------- Lista de incidencias ----------

export function dibujarIncidencias({ incidencias }) {
  const lista = document.getElementById('lista-incidencias');
  const abiertas = incidencias.filter((i) => i.estado !== 'resuelta');

  const contador = document.getElementById('contador-incidencias');
  contador.textContent = String(abiertas.length);
  contador.hidden = abiertas.length === 0;

  if (!incidencias.length) {
    lista.replaceChildren(el('li', { className: 'vacio' }, 'No hay incidencias registradas. Repórtalas desde la pestaña Reportar.'));
    return;
  }

  // Abiertas primero; dentro de cada grupo, las más recientes arriba
  const ordenadas = [...incidencias].sort((a, b) =>
    (a.estado === 'resuelta') - (b.estado === 'resuelta') || String(b.fecha ?? '').localeCompare(String(a.fecha ?? '')));

  lista.replaceChildren(...ordenadas.map(crearItemIncidencia));
}

/** Tarjeta de una incidencia. La usan esta lista y el panel de Soporte TI (extra: más líneas, como la antigüedad). */
export function crearItemIncidencia(incidencia, extra = null) {
  const resuelta = incidencia.estado === 'resuelta';
  const lugar = [nombreEspacio(incidencia.espacioId), nombreRecurso(incidencia.recursoId)].filter(Boolean).join(' · ');

  return el('li', { className: 'item', dataset: { estado: incidencia.estado } },
    el('div', { className: 'item__cabeza' },
      el('span', { className: 'item__titulo' }, incidencia.descripcion),
      el('span', { className: 'item__meta dato' }, horaCorta(incidencia.fecha))),
    el('div', { className: 'etiquetas' },
      el('span', { className: `etiqueta etiqueta--${incidencia.prioridad}` }, etiqueta(PRIORIDADES, incidencia.prioridad)),
      el('span', { className: 'etiqueta' }, etiqueta(CATEGORIAS, incidencia.categoria)),
      incidencia.origen === 'ia' ? el('span', { className: 'etiqueta etiqueta--ia', title: incidencia.ia?.razon ?? '' }, 'Clasificada por IA') : null,
      incidencia.reportesAdicionales > 0
        ? el('span', { className: 'etiqueta', title: 'Personas que confirmaron que era la misma incidencia' },
          `${incidencia.reportesAdicionales} reporte${incidencia.reportesAdicionales > 1 ? 's' : ''} más`)
        : null,
      ...(incidencia.notificaciones ?? []).map((n) => el('span', { className: 'etiqueta', title: `Aviso enviado por ${n.canal}` }, `Avisada: ${n.area}`)),
      !resuelta && incidencia.atendidaPor
        ? el('span', { className: 'etiqueta etiqueta--ia', title: `Desde las ${horaCorta(incidencia.fechaAtencion)}` }, `En atención: ${incidencia.atendidaPorNombre ?? incidencia.atendidaPor}`)
        : null,
      resuelta ? el('span', { className: 'etiqueta etiqueta--resuelta' }, 'Resuelta') : null),
    lugar ? el('span', { className: 'item__meta' }, lugar) : null,
    extra,
    !resuelta && fueraDeServicio(incidencia).length
      ? el('span', { className: 'item__alerta' }, `Fuera de servicio: ${fueraDeServicio(incidencia).join(' · ')}`)
      : null,
    resuelta || !puede('resolverIncidencias') ? null : el('div', { className: 'item__acciones' },
      incidencia.atendidaPor ? null : el('button', {
        type: 'button', className: 'btn btn--primario btn--chico',
        onClick: (e) => atender(incidencia, e.currentTarget),
      }, 'Atender'),
      el('button', {
        type: 'button', className: 'btn btn--secundario btn--chico',
        onClick: (e) => resolver(incidencia, e.currentTarget),
      }, 'Marcar como resuelta')),
  );
}

// Soporte toma la incidencia: el resto del equipo ve que ya alguien va en camino.
async function atender(incidencia, boton) {
  try {
    await conCarga(boton, 'Tomando…', () =>
      pedir(`/api/incidencias/${encodeURIComponent(incidencia.id)}/atender`, { metodo: 'POST' }));
    toasts.exito('La incidencia quedó a tu nombre: el equipo ve que ya la estás atendiendo.');
    await refrescar();
  } catch (error) {
    toasts.error(error);
  }
}

async function resolver(incidencia, boton) {
  try {
    await conCarga(boton, 'Resolviendo…', () =>
      pedir(`/api/incidencias/${encodeURIComponent(incidencia.id)}`, { metodo: 'PATCH', cuerpo: { estado: 'resuelta' } }));
    const afectados = fueraDeServicio(incidencia);
    const verbo = afectados.length > 1 ? 'vuelven' : 'vuelve';
    toasts.exito(afectados.length
      ? `Incidencia resuelta. ${afectados.join(' y ')} ${verbo} a estar en servicio.`
      : 'Incidencia resuelta.');
    await refrescar();
  } catch (error) {
    toasts.error(error);
  }
}

// ---------- Campos y utilidades ----------

function opcionesDe(catalogo) {
  return Object.entries(catalogo);
}

function campoTexto(nombre, rotulo, valor) {
  return el('label', { className: 'campo' },
    el('span', {}, rotulo),
    el('textarea', { name: nombre, rows: 2, required: true, value: valor ?? '' }));
}

/**
 * Select con la opción sugerida ya elegida. Si la IA devolvió null en un
 * campo obligatorio, se marca como pendiente para que la persona lo elija.
 */
function campoSelect(nombre, rotulo, opciones, valor, marcarSiFalta, textoNinguno) {
  const pendiente = marcarSiFalta && !valor;
  const select = el('select', { name: nombre, required: !textoNinguno },
    el('option', { value: '', disabled: !textoNinguno, defaultSelected: !valor }, textoNinguno ?? 'Elige una opción'),
    opciones.map(([id, texto]) => el('option', { value: id, defaultSelected: id === valor }, texto)));

  return el('label', { className: `campo${pendiente ? ' campo--pendiente' : ''}` },
    el('span', {}, rotulo),
    select,
    pendiente ? el('small', { className: 'campo__ayuda' }, 'La IA no pudo determinarlo. Elígelo tú.') : null);
}

/**
 * "¿Qué queda fuera de servicio?": Nada / Solo el equipo / Toda la sala.
 * Si la IA sugiere inhabilitar, se preselecciona lo más específico: el equipo si lo hay; si no, la sala.
 */
function campoFueraDeServicio(sugerencia) {
  const inicial = !sugerencia.inhabilitar ? 'ninguno' : sugerencia.recursoId ? 'equipo' : 'espacio';
  const opcion = (valor, texto) => el('label', { className: 'interruptor' },
    el('input', { type: 'radio', name: 'alcance', value: valor, checked: valor === inicial }),
    el('span', {}, texto));
  return el('fieldset', { className: 'campo opciones-alcance' },
    el('legend', {}, '¿Qué queda fuera de servicio?'),
    opcion('ninguno', 'Nada: se sigue usando mientras lo reparan'),
    opcion('equipo', 'Solo el equipo afectado'),
    opcion('espacio', 'Toda la sala (por ejemplo, si hay riesgo para las personas)'));
}

// "Solo el equipo" necesita un equipo y "Toda la sala" una sala: si falta, la opción se deshabilita.
function ajustarFueraDeServicio(form) {
  const disponibles = { ninguno: true, equipo: Boolean(form.recursoId.value), espacio: Boolean(form.espacioId.value) };
  for (const radio of form.querySelectorAll('input[name="alcance"]')) {
    radio.disabled = !disponibles[radio.value];
    if (radio.disabled && radio.checked) form.querySelector('input[name="alcance"][value="ninguno"]').checked = true;
  }
}

function nombreEspacio(id) {
  return id ? obtenerEstado().espacios.find((e) => e.id === id)?.nombre ?? id : '';
}

function nombreRecurso(id) {
  return id ? obtenerEstado().recursos.find((r) => r.id === id)?.nombre ?? id : '';
}

// "2026-10-16T14:05" -> "16/10 14:05"
function horaCorta(fechaHora) {
  if (!fechaHora) return '';
  const [fecha, hora] = fechaHora.split('T');
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes} ${hora?.slice(0, 5) ?? ''}`;
}
