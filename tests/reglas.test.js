// =====================================================================
// TESTS DE REGLAS DE NEGOCIO (node:test)
// ---------------------------------------------------------------------
// Un caso válido y uno inválido por regla. Los casos se construyen a
// partir de los valores de src/config/reglas.js, así que si el jurado
// cambia una regla (por ejemplo MAX_HORAS_RESERVA: 2) los tests siguen
// verificando la regla nueva sin tener que reescribirlos.
// Cada test usa una base en memoria: no hay base de datos de por medio.
// =====================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REGLAS } from '../src/config/reglas.js';
import { buscarEspaciosDisponibles, cancelarReserva, capacidadMaxima, crearReserva, editarReserva } from '../src/domain/reservas.js';
import { crearPrestamo, devolverPrestamo } from '../src/domain/prestamos.js';
import { crearIncidencia, resolverIncidencia } from '../src/domain/incidencias.js';
import { ahoraBogota } from '../src/domain/fechas.js';

// ---------- datos de prueba ----------

// Base mínima en memoria. Se crea de nuevo en cada test.
function crearDB() {
  return {
    espacios: [
      { id: 'grande', nombre: 'Grande', tipo: 'sala', aforo: 40, estado: 'disponible' },
      { id: 'mediana', nombre: 'Mediana', tipo: 'sala', aforo: 20, estado: 'disponible' },
      { id: 'pequena', nombre: 'Pequeña', tipo: 'sala', aforo: 10, estado: 'disponible' },
      { id: 'cerrada', nombre: 'Cerrada', tipo: 'sala', aforo: 30, estado: 'inhabilitado' },
    ],
    recursos: [
      { id: 'vb', nombre: 'Video beam', tipo: 'video_beam', espacioId: 'grande', estado: 'disponible' },
      { id: 'pc1', nombre: 'Portátil 1', tipo: 'portatil', espacioId: null, estado: 'disponible' },
      { id: 'pc2', nombre: 'Portátil 2', tipo: 'portatil', espacioId: null, estado: 'disponible' },
      { id: 'pc3', nombre: 'Portátil 3', tipo: 'portatil', espacioId: null, estado: 'disponible' },
      { id: 'roto', nombre: 'Portátil roto', tipo: 'portatil', espacioId: null, estado: 'danado' },
    ],
    reservas: [],
    prestamos: [],
    incidencias: [],
  };
}

// Fechas de la semana que viene (siempre en el futuro, para no chocar con la regla
// de no reservar en el pasado): fechaDelDia(0) = próximo domingo, fechaDelDia(1) = lunes...
const HOY = new Date(`${ahoraBogota().slice(0, 10)}T00:00:00Z`);
const PROXIMO_DOMINGO = HOY.getTime() + (7 - HOY.getUTCDay()) * 86_400_000;
const fechaDelDia = (dia) => new Date(PROXIMO_DOMINGO + dia * 86_400_000).toISOString().slice(0, 10);
const DIA_HABIL = fechaDelDia(REGLAS.DIAS_HABILES[0]);
const DIA_NO_HABIL = [0, 1, 2, 3, 4, 5, 6].find((dia) => !REGLAS.DIAS_HABILES.includes(dia));

// "YYYY-MM-DDTHH:00" para una hora entera.
const a = (fecha, hora) => `${fecha}T${String(hora).padStart(2, '0')}:00`;
const APERTURA = REGLAS.HORA_APERTURA;

// Reserva válida de 1 hora al abrir el campus; se sobrescriben los campos que cada test necesite.
function reserva(cambios = {}) {
  return { espacioId: 'mediana', responsable: 'Ana', asistentes: 5, inicio: a(DIA_HABIL, APERTURA), fin: a(DIA_HABIL, APERTURA + 1), ...cambios };
}

// Incidencia válida que no inhabilita; se sobrescriben los campos necesarios.
const PRIORIDAD_QUE_NO_INHABILITA = ['baja', 'media', 'alta', 'critica'].find((p) => !REGLAS.PRIORIDADES_QUE_INHABILITAN.includes(p));
function incidencia(cambios = {}) {
  return { descripcion: 'No funciona', categoria: 'tecnologia', prioridad: PRIORIDAD_QUE_NO_INHABILITA, area: 'Soporte TI', espacioId: 'grande', recursoId: null, inhabilitar: false, origen: 'manual', ia: null, ...cambios };
}

// ---------- RESERVAS ----------

describe('Reservas', () => {
  test('aforo: se acepta justo la capacidad máxima (aforo x MARGEN_AFORO)', () => {
    const db = crearDB();
    const tope = capacidadMaxima(db.espacios[1]);
    assert.equal(crearReserva(db, reserva({ asistentes: tope })).asistentes, tope);
  });

  test('aforo: se rechaza una persona más de la capacidad máxima', () => {
    const db = crearDB();
    const tope = capacidadMaxima(db.espacios[1]);
    assert.throws(() => crearReserva(db, reserva({ asistentes: tope + 1 })), { codigo: 'AFORO_EXCEDIDO', status: 409 });
  });

  test('solapamiento: una reserva pegada a otra (fin = inicio) se acepta', () => {
    const db = crearDB();
    crearReserva(db, reserva());
    assert.ok(crearReserva(db, reserva({ responsable: 'Luis', inicio: a(DIA_HABIL, APERTURA + 1), fin: a(DIA_HABIL, APERTURA + 2) })));
  });

  test('solapamiento: una reserva que se cruza con otra se rechaza', () => {
    const db = crearDB();
    crearReserva(db, reserva({ fin: a(DIA_HABIL, APERTURA + 2) }));
    assert.throws(() => crearReserva(db, reserva({ responsable: 'Luis', inicio: a(DIA_HABIL, APERTURA + 1), fin: a(DIA_HABIL, APERTURA + 2) })),
      { codigo: 'RESERVA_SOLAPADA' });
  });

  test('espacio asignable: un espacio disponible se puede reservar', () => {
    assert.equal(crearReserva(crearDB(), reserva()).espacioId, 'mediana');
  });

  test('espacio no asignable: un espacio en ESTADOS_NO_ASIGNABLES se rechaza', () => {
    assert.throws(() => crearReserva(crearDB(), reserva({ espacioId: 'cerrada' })), { codigo: 'ESPACIO_NO_ASIGNABLE' });
  });

  test('horario: una reserva que termina justo a HORA_CIERRE se acepta', () => {
    const fin = a(DIA_HABIL, REGLAS.HORA_CIERRE);
    assert.equal(crearReserva(crearDB(), reserva({ inicio: a(DIA_HABIL, REGLAS.HORA_CIERRE - 1), fin })).fin, fin);
  });

  test('horario: antes de HORA_APERTURA o después de HORA_CIERRE se rechaza', () => {
    const db = crearDB();
    assert.throws(() => crearReserva(db, reserva({ inicio: a(DIA_HABIL, APERTURA - 1), fin: a(DIA_HABIL, APERTURA) })), { codigo: 'FUERA_DE_HORARIO' });
    assert.throws(() => crearReserva(db, reserva({ inicio: a(DIA_HABIL, REGLAS.HORA_CIERRE - 1), fin: `${DIA_HABIL}T${REGLAS.HORA_CIERRE}:30` })), { codigo: 'FUERA_DE_HORARIO' });
  });

  test('días hábiles: un día de DIAS_HABILES se acepta', () => {
    assert.ok(crearReserva(crearDB(), reserva()));
  });

  test('días hábiles: un día fuera de DIAS_HABILES se rechaza', { skip: DIA_NO_HABIL === undefined && 'todos los días son hábiles' }, () => {
    const fecha = fechaDelDia(DIA_NO_HABIL);
    assert.throws(() => crearReserva(crearDB(), reserva({ inicio: a(fecha, APERTURA), fin: a(fecha, APERTURA + 1) })), { codigo: 'DIA_NO_HABIL' });
  });

  test('duración: exactamente MAX_HORAS_RESERVA se acepta', () => {
    assert.ok(crearReserva(crearDB(), reserva({ fin: a(DIA_HABIL, APERTURA + REGLAS.MAX_HORAS_RESERVA) })));
  });

  test('duración: un minuto más de MAX_HORAS_RESERVA se rechaza', () => {
    const fin = `${DIA_HABIL}T${String(APERTURA + REGLAS.MAX_HORAS_RESERVA).padStart(2, '0')}:01`;
    assert.throws(() => crearReserva(crearDB(), reserva({ fin })), { codigo: 'DURACION_EXCEDIDA' });
  });

  test('límite por persona: hasta MAX_RESERVAS_POR_PERSONA_DIA se acepta y la siguiente se rechaza', () => {
    const db = crearDB();
    const unaHora = (i) => reserva({ inicio: a(DIA_HABIL, APERTURA + i), fin: a(DIA_HABIL, APERTURA + i + 1) });
    for (let i = 0; i < REGLAS.MAX_RESERVAS_POR_PERSONA_DIA; i++) crearReserva(db, unaHora(i));
    assert.equal(db.reservas.length, REGLAS.MAX_RESERVAS_POR_PERSONA_DIA);
    assert.throws(() => crearReserva(db, { ...unaHora(REGLAS.MAX_RESERVAS_POR_PERSONA_DIA), responsable: 'ANA' }), { codigo: 'LIMITE_RESERVAS_PERSONA' });
  });

  test('anticipación: una reserva en el futuro se acepta', () => {
    assert.ok(crearReserva(crearDB(), reserva()));
  });

  test('anticipación: una reserva en el pasado se rechaza', () => {
    // 6 de enero de 2020: un lunes ya pasado, dentro del horario.
    const pasado = reserva({ inicio: a('2020-01-06', APERTURA), fin: a('2020-01-06', APERTURA + 1) });
    assert.throws(() => crearReserva(crearDB(), pasado), { codigo: 'RESERVA_EN_PASADO', status: 409 });
  });

  test('datos: cuerpo mal formado responde 422 y espacio inexistente 404', () => {
    const db = crearDB();
    assert.throws(() => crearReserva(db, reserva({ asistentes: 0 })), { status: 422 });
    assert.throws(() => crearReserva(db, reserva({ inicio: '19/10/2026 07:00' })), { status: 422 });
    assert.throws(() => crearReserva(db, reserva({ espacioId: 'no-existe' })), { status: 404 });
  });

  test('una reserva rechazada no se guarda', () => {
    const db = crearDB();
    assert.throws(() => crearReserva(db, reserva({ espacioId: 'cerrada' })));
    assert.equal(db.reservas.length, 0);
  });
});

describe('Editar y cancelar reservas', () => {
  // Reserva de 1 hora a mitad de jornada, para poder moverla sin salirse del horario.
  const MEDIO = APERTURA + 2;
  const base = (cambios = {}) => reserva({ inicio: a(DIA_HABIL, MEDIO), fin: a(DIA_HABIL, MEDIO + 1), ...cambios });

  test('editar: cambiar asistentes y horario conserva el id y los demás campos', () => {
    const db = crearDB();
    const { id } = crearReserva(db, base());
    const editada = editarReserva(db, id, { asistentes: 8, fin: a(DIA_HABIL, MEDIO + 2) });
    assert.deepEqual([editada.id, editada.asistentes, editada.fin, editada.responsable], [id, 8, a(DIA_HABIL, MEDIO + 2), 'Ana']);
    assert.equal(db.reservas.length, 1);
  });

  test('editar: la reserva no choca consigo misma ni cuenta dos veces en el límite por persona', () => {
    const db = crearDB();
    const reservas = [];
    for (let i = 0; i < REGLAS.MAX_RESERVAS_POR_PERSONA_DIA; i++) {
      reservas.push(crearReserva(db, base({ inicio: a(DIA_HABIL, APERTURA + i), fin: a(DIA_HABIL, APERTURA + i + 1) })));
    }
    assert.ok(editarReserva(db, reservas[0].id, { asistentes: 6 }));
  });

  test('editar: pasa por las reglas (aforo, solapamiento, espacio no asignable)', () => {
    const db = crearDB();
    const otra = crearReserva(db, base({ responsable: 'Luis', inicio: a(DIA_HABIL, MEDIO + 1), fin: a(DIA_HABIL, MEDIO + 2) }));
    const { id } = crearReserva(db, base());
    assert.throws(() => editarReserva(db, id, { asistentes: capacidadMaxima(db.espacios[1]) + 1 }), { codigo: 'AFORO_EXCEDIDO' });
    assert.throws(() => editarReserva(db, id, { fin: otra.fin }), { codigo: 'RESERVA_SOLAPADA' });
    assert.throws(() => editarReserva(db, id, { espacioId: 'cerrada' }), { codigo: 'ESPACIO_NO_ASIGNABLE' });
    assert.equal(db.reservas.find((r) => r.id === id).fin, a(DIA_HABIL, MEDIO + 1)); // nada cambió
  });

  test('cancelar: una reserva futura se elimina', () => {
    const db = crearDB();
    const { id } = crearReserva(db, base());
    assert.equal(cancelarReserva(db, id).id, id);
    assert.equal(db.reservas.length, 0);
  });

  test('editar o cancelar una reserva que ya empezó se rechaza, y un id inexistente da 404', () => {
    const db = crearDB();
    db.reservas.push({ id: 'vieja', espacioId: 'mediana', responsable: 'Ana', asistentes: 5, inicio: a('2020-01-06', APERTURA), fin: a('2020-01-06', APERTURA + 1) });
    assert.throws(() => editarReserva(db, 'vieja', { asistentes: 6 }), { codigo: 'RESERVA_YA_INICIADA', status: 409 });
    assert.throws(() => cancelarReserva(db, 'vieja'), { codigo: 'RESERVA_YA_INICIADA', status: 409 });
    assert.throws(() => cancelarReserva(db, 'no-existe'), { status: 404 });
    assert.equal(db.reservas.length, 1);
  });
});

describe('buscarEspaciosDisponibles', () => {
  test('devuelve solo los que cumplen las reglas, del mejor ajuste al peor', () => {
    const db = crearDB();
    crearReserva(db, reserva({ espacioId: 'pequena' }));
    const ids = buscarEspaciosDisponibles({ asistentes: 5, inicio: a(DIA_HABIL, APERTURA), fin: a(DIA_HABIL, APERTURA + 1) }, db).map((e) => e.id);
    // "pequena" está reservada y "cerrada" inhabilitada; quedan ordenadas por capacidad.
    assert.deepEqual(ids, ['mediana', 'grande']);
  });

  test('si el pedido necesita computadores, solo quedan las salas que los tienen', () => {
    const db = crearDB();
    const conPC = REGLAS.ESPACIOS_CON_COMPUTADORES[0];
    db.espacios.push({ id: conPC, nombre: 'Con PC', tipo: 'sala', aforo: 30, estado: 'disponible' });
    const franja = { asistentes: 5, inicio: a(DIA_HABIL, APERTURA), fin: a(DIA_HABIL, APERTURA + 1) };
    assert.deepEqual(buscarEspaciosDisponibles({ ...franja, necesitaComputadores: true }, db).map((e) => e.id), [conPC]);
    // Sin el requisito (false o sin decir) siguen apareciendo todas las libres
    assert.equal(buscarEspaciosDisponibles({ ...franja, necesitaComputadores: false }, db).length, 4);
    assert.equal(buscarEspaciosDisponibles(franja, db).length, 4);
  });

  test('si la franja viola una regla, explica cuál', () => {
    const solicitud = { asistentes: 5, inicio: a(DIA_HABIL, APERTURA), fin: a(DIA_HABIL, APERTURA + REGLAS.MAX_HORAS_RESERVA + 1) };
    assert.throws(() => buscarEspaciosDisponibles(solicitud, crearDB()), { codigo: /DURACION_EXCEDIDA|FUERA_DE_HORARIO/ });
  });
});

// ---------- PRÉSTAMOS ----------

describe('Préstamos', () => {
  test('transición: un recurso disponible se presta y queda "prestado"', () => {
    const db = crearDB();
    const prestamo = crearPrestamo(db, { recursoId: 'pc1', persona: 'Ana' });
    assert.equal(prestamo.estado, 'activo');
    assert.equal(db.recursos.find((r) => r.id === 'pc1').estado, 'prestado');
  });

  test('transición: un recurso dañado no se puede prestar', () => {
    assert.throws(() => crearPrestamo(crearDB(), { recursoId: 'roto', persona: 'Ana' }), { codigo: 'TRANSICION_INVALIDA', status: 409 });
  });

  test('límite: hasta MAX_PRESTAMOS_POR_PERSONA se acepta y el siguiente se rechaza', () => {
    const db = crearDB();
    const libres = ['pc1', 'pc2', 'pc3', 'vb'];
    for (let i = 0; i < REGLAS.MAX_PRESTAMOS_POR_PERSONA; i++) crearPrestamo(db, { recursoId: libres[i], persona: 'Ana' });
    assert.throws(() => crearPrestamo(db, { recursoId: libres[REGLAS.MAX_PRESTAMOS_POR_PERSONA], persona: 'ana' }), { codigo: 'LIMITE_PRESTAMOS_PERSONA' });
  });

  test('devolución: devolver como "danado" cambia el estado del recurso', () => {
    const db = crearDB();
    const { id } = crearPrestamo(db, { recursoId: 'pc1', persona: 'Ana' });
    assert.equal(devolverPrestamo(db, id, { estadoFinal: 'danado' }).estado, 'devuelto');
    assert.equal(db.recursos.find((r) => r.id === 'pc1').estado, 'danado');
  });

  test('devolución: no se puede devolver dos veces ni con un estado inválido', () => {
    const db = crearDB();
    const { id } = crearPrestamo(db, { recursoId: 'pc1', persona: 'Ana' });
    assert.throws(() => devolverPrestamo(db, id, { estadoFinal: 'roto' }), { status: 422 });
    devolverPrestamo(db, id, { estadoFinal: 'disponible' });
    assert.throws(() => devolverPrestamo(db, id, { estadoFinal: 'disponible' }), { codigo: 'PRESTAMO_YA_DEVUELTO' });
  });
});

// ---------- INCIDENCIAS ----------

describe('Incidencias', () => {
  const estadoEspacio = (db, id) => db.espacios.find((e) => e.id === id).estado;

  test('una prioridad de PRIORIDADES_QUE_INHABILITAN inhabilita el espacio', () => {
    const db = crearDB();
    crearIncidencia(db, incidencia({ prioridad: REGLAS.PRIORIDADES_QUE_INHABILITAN[0] }));
    assert.equal(estadoEspacio(db, 'grande'), 'inhabilitado');
    assert.throws(() => crearReserva(db, reserva({ espacioId: 'grande' })), { codigo: 'ESPACIO_NO_ASIGNABLE' });
  });

  test('una prioridad que no está en la lista, sin inhabilitar, no cambia el espacio', () => {
    const db = crearDB();
    crearIncidencia(db, incidencia());
    assert.equal(estadoEspacio(db, 'grande'), 'disponible');
  });

  test('inhabilitar: true inhabilita el espacio y el recurso con cualquier prioridad', () => {
    const db = crearDB();
    crearIncidencia(db, incidencia({ recursoId: 'vb', inhabilitar: true }));
    assert.equal(estadoEspacio(db, 'grande'), 'inhabilitado');
    assert.equal(db.recursos.find((r) => r.id === 'vb').estado, REGLAS.ESTADO_RECURSO_INHABILITADO);
  });

  test('resolver rehabilita, salvo que otra incidencia abierta lo mantenga inhabilitado', () => {
    const db = crearDB();
    const primera = crearIncidencia(db, incidencia({ inhabilitar: true }));
    const segunda = crearIncidencia(db, incidencia({ inhabilitar: true }));
    resolverIncidencia(db, primera.id, { estado: 'resuelta' });
    assert.equal(estadoEspacio(db, 'grande'), 'inhabilitado');
    resolverIncidencia(db, segunda.id, { estado: 'resuelta' });
    assert.equal(estadoEspacio(db, 'grande'), 'disponible');
  });

  test('valores fuera de los enums o IDs inexistentes se rechazan', () => {
    const db = crearDB();
    assert.throws(() => crearIncidencia(db, incidencia({ categoria: 'electrica' })), { status: 422 });
    assert.throws(() => crearIncidencia(db, incidencia({ area: 'TI' })), { status: 422 });
    assert.throws(() => crearIncidencia(db, incidencia({ espacioId: 'pluton' })), { status: 404 });
    assert.equal(db.incidencias.length, 0);
  });
});
