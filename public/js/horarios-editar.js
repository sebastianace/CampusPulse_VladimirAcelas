// Editar los horarios desde la pantalla: SOLO el admin (Coordinación). Dos diálogos:
//   1. "Nueva clase" / "Editar clase": un formulario con todos los datos de un bloque
//      (POST /api/horarios y PATCH /api/horarios/:id).
//   2. "Subir Excel": el archivo de Coordinación (.xlsx o .csv). Primero un ENSAYO (POST /api/horarios/importar) que
//      muestra qué se guardaría, con los errores y los hallazgos, sin escribir nada; el botón "Guardar" repite la
//      llamada con aplicar=true. Es el mismo informe y las mismas reglas de npm run importar-horarios.
// Quien de verdad impide a los demás es el servidor (403): aquí solo se ocultan los botones.
// Los errores van DENTRO del diálogo: un <dialog> modal tapa los avisos flotantes (toasts).

import { pedir } from './api.js';
import { DIAS_CORTOS, ETIQUETAS_CLASE, NOMBRES_DIA, soloReservables } from './catalogos.js';
import { conCarga, el } from './dom.js';
import { obtenerEstado } from './estado.js';
import * as toasts from './toasts.js';

let refrescar = async () => {};

const porId = (id) => document.getElementById(id);
const DIAS_HABILES = [1, 2, 3, 4, 5];

export function iniciarEdicionHorarios(dependencias) {
  ({ refrescar } = dependencias);
  iniciarFormulario();
  iniciarSubida();
}

// Lo que Coordinación necesita saber al guardar: las reservas que quedan encima de una clase (no se borran solas)
function avisarConflictos(reservas) {
  if (!reservas?.length) return;
  const lista = reservas.slice(0, 3).map((r) => `${r.responsable} (${r.inicio.slice(0, 10)} ${r.inicio.slice(11, 16)}–${r.fin.slice(11, 16)})`).join(', ');
  toasts.aviso(`Ojo: ${reservas.length === 1 ? '1 reserva futura queda' : `${reservas.length} reservas futuras quedan`} encima de la clase: ${lista}${reservas.length > 3 ? ` y ${reservas.length - 3} más` : ''}. No se cancelaron: hay que reubicarlas.`);
}

/** Casillas de los días (Lun a Dom). Devuelve el contenedor con los <input type="checkbox" value="1..7">. */
function crearCasillasDeDias(contenedor, nombre) {
  contenedor.replaceChildren(...[1, 2, 3, 4, 5, 6, 7].map((d) => el('label', { className: 'dia-casilla' },
    el('input', { type: 'checkbox', name: nombre, value: String(d) }),
    el('span', {}, DIAS_CORTOS[d]))));
}
const diasMarcados = (contenedor) => [...contenedor.querySelectorAll('input:checked')].map((c) => Number(c.value));
const marcarDias = (contenedor, dias) => contenedor.querySelectorAll('input').forEach((c) => { c.checked = dias.includes(Number(c.value)); });

// ---------- 1. nueva clase / editar clase ----------

function iniciarFormulario() {
  const dialogo = porId('dialogo-horario');
  crearCasillasDeDias(porId('horario-dias'), 'dias');
  porId('cancelar-horario').addEventListener('click', () => dialogo.close());
  porId('form-horario').addEventListener('submit', guardarClase);
}

/** Abre el formulario vacío (clase nueva) o con los datos de `bloque` (editar). `inicial`: {tipo} para una clase nueva. */
export function abrirFormularioHorario(bloque = null, inicial = {}) {
  const form = porId('form-horario');
  form.reset();
  form.dataset.id = bloque?.id ?? '';
  porId('titulo-horario').textContent = bloque ? 'Editar clase' : 'Nueva clase';
  porId('horario-error').hidden = true;

  const salas = soloReservables(obtenerEstado().espacios).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  form.espacioId.replaceChildren(el('option', { value: '' }, 'Elige una sala'), ...salas.map((s) => el('option', { value: s.id }, `${s.nombre}${Number.isFinite(s.aforo) ? ` (aforo ${s.aforo})` : ''}`)));

  form.tipo.value = bloque?.tipo ?? inicial.tipo ?? '';
  form.espacioId.value = bloque?.espacioId ?? '';
  form.horaInicio.value = bloque?.horaInicio ?? '';
  form.horaFin.value = bloque?.horaFin ?? '';
  form.grupo.value = bloque?.grupo ?? '';
  form.estudiantes.value = bloque?.estudiantes ?? '';
  form.docente.value = bloque?.docente ?? '';
  form.nivel.value = bloque?.nivel ?? '';
  form.modulo.value = bloque?.modulo ?? '';
  form.observacion.value = bloque?.observacion ?? '';
  // Una clase nueva abre en lunes a viernes (así son las del campus); una guardada sin días se muestra sin marcar
  marcarDias(porId('horario-dias'), bloque ? (bloque.dias ?? []) : DIAS_HABILES);

  const dialogo = porId('dialogo-horario');
  if (!dialogo.open) dialogo.showModal();
  form.tipo.focus();
}

async function guardarClase(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const id = form.dataset.id;
  const datos = {
    tipo: form.tipo.value,
    espacioId: form.espacioId.value,
    horaInicio: form.horaInicio.value,
    horaFin: form.horaFin.value,
    dias: diasMarcados(porId('horario-dias')),
    grupo: form.grupo.value,
    estudiantes: form.estudiantes.value,
    docente: form.docente.value,
    nivel: form.nivel.value,
    modulo: form.modulo.value,
    observacion: form.observacion.value,
  };
  try {
    const resultado = await conCarga(form.querySelector('button[type="submit"]'), 'Guardando…', () => (id
      ? pedir(`/api/horarios/${encodeURIComponent(id)}`, { metodo: 'PATCH', cuerpo: datos })
      : pedir('/api/horarios', { metodo: 'POST', cuerpo: datos })));
    porId('dialogo-horario').close();
    toasts.exito(id ? 'Clase actualizada.' : 'Clase agregada.');
    avisarConflictos(resultado.reservasEnConflicto);
    await refrescar();
  } catch (error) {
    const caja = porId('horario-error');
    caja.textContent = error.message;
    caja.hidden = false;
  }
}

/** Quita una clase (con confirmación). Las reservas que existan no se tocan. */
export async function quitarClase(bloque) {
  const sala = obtenerEstado().espacios.find((e) => e.id === bloque.espacioId)?.nombre ?? bloque.espacioId;
  if (!window.confirm(`¿Quitar la clase ${bloque.grupo} (${ETIQUETAS_CLASE[bloque.tipo]}, ${sala}, ${bloque.horaInicio}–${bloque.horaFin})? La sala quedará libre en esa franja.`)) return;
  try {
    await pedir(`/api/horarios/${encodeURIComponent(bloque.id)}`, { metodo: 'DELETE' });
    toasts.exito('Clase quitada.');
    await refrescar();
  } catch (error) {
    toasts.error(error);
  }
}

// ---------- 2. subir el Excel ----------

let archivo = null;      // el File elegido
let alias = {};          // nombre de sala del archivo -> id de sala, según lo que eligió la persona
let informe = null;      // último ensayo
let peticion = 0;        // para ignorar respuestas viejas si se cambia algo mientras se revisa

function iniciarSubida() {
  const dialogo = porId('dialogo-subir');
  crearCasillasDeDias(porId('subir-dias'), 'diasPorDefecto');
  porId('subir-dias').addEventListener('change', revisar);
  porId('subir-lunes-viernes').addEventListener('click', () => { marcarDias(porId('subir-dias'), DIAS_HABILES); revisar(); });
  porId('subir-archivo').addEventListener('change', (evento) => {
    archivo = evento.target.files[0] ?? null;
    alias = {};
    revisar();
  });
  porId('cancelar-subir').addEventListener('click', () => dialogo.close());
  porId('subir-guardar').addEventListener('click', guardarArchivo);
}

export function abrirSubidaHorarios() {
  archivo = null;
  alias = {};
  informe = null;
  peticion++;
  porId('form-subir').reset();
  marcarDias(porId('subir-dias'), []);
  dibujarSubida();
  const dialogo = porId('dialogo-subir');
  if (!dialogo.open) dialogo.showModal();
}

function rutaImportar(aplicar) {
  const params = new URLSearchParams();
  if (aplicar) params.set('aplicar', 'true');
  if (Object.keys(alias).length) params.set('alias', JSON.stringify(alias));
  const dias = diasMarcados(porId('subir-dias'));
  if (dias.length) params.set('dias', dias.map((d) => DIAS_CORTOS[d].toLowerCase()).join(','));
  return `/api/horarios/importar?${params}`;
}

/** El ENSAYO: pide el informe sin guardar nada. */
async function revisar() {
  informe = null;
  if (!archivo) return dibujarSubida();
  const esta = ++peticion;
  dibujarSubida({ revisando: true });
  try {
    const resultado = await pedir(rutaImportar(false), { metodo: 'POST', archivo, tiempoMs: 60000 });
    if (esta !== peticion) return;
    informe = resultado;
    dibujarSubida();
  } catch (error) {
    if (esta !== peticion) return;
    dibujarSubida({ fallo: error.message });
  }
}

async function guardarArchivo(evento) {
  const boton = evento.currentTarget;
  try {
    const resultado = await conCarga(boton, 'Guardando…', () => pedir(rutaImportar(true), { metodo: 'POST', archivo, tiempoMs: 60000 }));
    if (!resultado.aplicado) { // un error que el ensayo no vio (alguien cambió algo): no se guardó nada
      informe = resultado;
      dibujarSubida();
      return;
    }
    porId('dialogo-subir').close();
    toasts.exito(`Se guardaron ${resultado.bloques} clases.`);
    avisarConflictos(resultado.reservasEnConflicto);
    await refrescar();
  } catch (error) {
    dibujarSubida({ fallo: error.message });
  }
}

/** Los errores que dicen lo mismo (siete filas con "Sala Nueva") se muestran como uno solo: [{mensaje, lineas}]. */
function agruparErrores(errores) {
  const grupos = new Map();
  for (const { linea, mensaje } of errores) {
    if (!grupos.has(mensaje)) grupos.set(mensaje, { mensaje, lineas: [] });
    grupos.get(mensaje).lineas.push(linea);
  }
  return [...grupos.values()];
}

const aviso = (clase, ...hijos) => el('div', { className: `subir__aviso subir__aviso--${clase}`, role: clase === 'error' ? 'alert' : undefined }, ...hijos);

function dibujarSubida({ revisando = false, fallo = null } = {}) {
  const caja = porId('subir-informe');
  const guardar = porId('subir-guardar');
  guardar.disabled = true;
  guardar.textContent = 'Guardar';

  if (revisando) { caja.replaceChildren(el('p', { className: 'nota' }, 'Revisando el archivo…')); return; }
  if (fallo) { caja.replaceChildren(aviso('error', fallo)); return; }
  if (!informe) { caja.replaceChildren(el('p', { className: 'nota' }, 'Elige el archivo de horarios. Primero se revisa y se te muestra qué se guardaría: todavía no se guarda nada.')); return; }

  const i = informe;
  const porTipo = Object.entries(i.porTipo).map(([t, n]) => `${ETIQUETAS_CLASE[t]} ${n}`).join(' · ');
  const partes = [
    el('p', { className: 'subir__resumen' },
      el('strong', {}, `${i.bloques} clases listas`), porTipo ? ` (${porTipo})` : '',
      el('span', { className: 'nota' }, ` · ${i.formato === 'xlsx' ? `Excel, hoja "${i.hoja}"` : 'CSV'} · ${i.total} filas`)),
  ];

  // Errores de formato: impiden guardar. Una sala con otro nombre se resuelve eligiendo cuál es.
  if (i.errores.length) {
    partes.push(aviso('error',
      el('strong', {}, `${i.errores.length} ${i.errores.length === 1 ? 'fila tiene un error' : 'filas tienen errores'}: no se puede guardar todavía.`),
      el('ul', {}, agruparErrores(i.errores).slice(0, 12).map((g) => el('li', {}, `${g.lineas.length === 1 ? 'Fila' : 'Filas'} ${g.lineas.join(', ')}: ${g.mensaje}`))),
      agruparErrores(i.errores).length > 12 ? el('p', { className: 'nota' }, `…y ${agruparErrores(i.errores).length - 12} más.`) : null));
  }
  for (const sala of i.salasSinReconocer) partes.push(selectorDeSala(sala));
  for (const [nombre, id] of Object.entries(alias)) partes.push(chipDeAlias(nombre, id));

  if (i.diasPorDefecto) partes.push(el('p', { className: 'nota' }, `A ${i.diasPorDefecto} filas que no traían días se les puso: ${diasMarcados(porId('subir-dias')).map((d) => NOMBRES_DIA[d]).join(', ')}.`));
  if (i.sinDias) {
    partes.push(aviso('aviso', `${i.sinDias} clases no traen los días de la semana: se guardan, pero NO bloquean reservas hasta que tengan días. Si todas son de lunes a viernes, marca los días arriba.`));
  }
  const tiposDelArchivo = i.reemplaza.tipos.map((t) => ETIQUETAS_CLASE[t]).join(', ');
  partes.push(el('p', { className: 'nota' }, !i.reemplaza.tipos.length ? 'No hay clases válidas para guardar.'
    : i.reemplaza.bloquesActuales ? `Al guardar se reemplazan las ${i.reemplaza.bloquesActuales} clases que hay hoy de ${tiposDelArchivo}.`
      : `Todavía no hay clases guardadas de ${tiposDelArchivo}: se agregan todas.`));

  if (i.reservasEnConflicto.length) {
    partes.push(aviso('aviso',
      el('strong', {}, `${i.reservasEnConflicto.length} ${i.reservasEnConflicto.length === 1 ? 'reserva futura queda' : 'reservas futuras quedan'} encima de una clase.`),
      ' No se cancelan al guardar: habrá que reubicarlas.'));
  }
  if (i.hallazgos.length) {
    const grupos = [...new Set(i.hallazgos.map((h) => h.titulo))];
    partes.push(el('details', { className: 'hallazgos' },
      el('summary', {}, `Para revisar con Coordinación (${i.hallazgos.length})`),
      el('p', { className: 'nota' }, 'No impiden guardar: son datos que conviene confirmar.'),
      ...grupos.map((titulo) => el('div', { className: 'hallazgos__grupo' },
        el('h3', { className: 'subtitulo' }, titulo),
        el('ul', { className: 'hallazgos__lista' }, i.hallazgos.filter((h) => h.titulo === titulo).map((h) => el('li', {}, h.mensaje)))))));
  }
  caja.replaceChildren(...partes);

  if (!i.errores.length && i.bloques > 0) {
    guardar.disabled = false;
    guardar.textContent = `Guardar ${i.bloques} clases${i.reemplaza.bloquesActuales ? ` y reemplazar las ${i.reemplaza.bloquesActuales} actuales` : ''}`;
  }
}

// "«Sala Nueva» no existe en el campus. ¿Qué sala es?" -> al elegir, se repite el ensayo con ese alias
function selectorDeSala({ nombre, sugerencia }) {
  const salas = soloReservables(obtenerEstado().espacios).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const parecida = salas.find((s) => s.id === sugerencia)?.nombre;
  const select = el('select', {
    onChange: (evento) => { if (evento.target.value) { alias = { ...alias, [nombre]: evento.target.value }; revisar(); } },
  }, el('option', { value: '' }, 'Elige la sala…'), ...salas.map((s) => el('option', { value: s.id }, s.nombre)));
  return el('label', { className: 'campo subir__sala' },
    el('span', {}, `«${nombre}» no es una sala del campus${parecida ? ` (¿será ${parecida}?)` : ''}. ¿Cuál es?`),
    select);
}

function chipDeAlias(nombre, id) {
  const sala = obtenerEstado().espacios.find((e) => e.id === id)?.nombre ?? id;
  return el('p', { className: 'nota' }, `«${nombre}» se guardará como ${sala}. `,
    el('button', { type: 'button', className: 'enlace', onClick: () => { const { [nombre]: _, ...resto } = alias; alias = resto; revisar(); } }, 'Deshacer'));
}
