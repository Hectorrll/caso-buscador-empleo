import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  textoDe, clasificarIngles, clasificarEstudios, clasificarFinDeSemana, clasificarHorarioFlexible,
  clasificarModalidad, clasificarArea, clasificarPerfilContable, clasificarPalancaIA, clasificarNivel,
  clasificarExperienciaExigencia, clasificarVehiculo, clasificarOferta, relevanciaLocal, crearJevLocal,
} from '../src/juez/local.mjs';
import { clasificarCriterios, CAMPOS_EXTRACT, extraerCampos } from '../src/juez/criterios.mjs';
import { claimsDe, verificarClaims, ajustarPorClaims } from '../src/juez/verify.mjs';

const t = (descripcion, requerimientos = []) => textoDe({ descripcion, requerimientos });

test('inglés: requisito, deseable, ficha "Idiomas: Inglés" y sin mención', () => {
  assert.equal(clasificarIngles(t('Inglés intermedio indispensable')), 'requerido');
  assert.equal(clasificarIngles(t('Se busca agente bilingüe')), 'requerido');
  assert.equal(clasificarIngles(t('Inglés deseable, no indispensable')), 'deseable');
  assert.equal(clasificarIngles(t('Excel básico', ['Idiomas: Inglés'])), 'requerido');
  assert.equal(clasificarIngles(t('Atención a clientes en español')), 'no_pide');
});

test('estudios: la ficha manda; "universidad" de la empresa no cuenta', () => {
  assert.equal(clasificarEstudios(t('', ['Educación mínima: Universidad'])), 'universitario_o_mas');
  assert.equal(clasificarEstudios(t('', ['Educación mínima: Bachillerato / Educación Media'])), 'bachillerato_o_tecnico');
  assert.equal(clasificarEstudios(t('Requisitos: estudiante universitario de 3er año')), 'universitario_o_mas');
  assert.equal(clasificarEstudios(t('Somos aliados de la Universidad Galileo. Graduado de diversificado.')), 'bachillerato_o_tecnico');
  assert.equal(clasificarEstudios(t('Buena actitud')), 'ambiguo');
});

test('fin de semana: sábado gana a lunes a viernes; "sábados libres" no; bot de fines de semana no es horario', () => {
  assert.equal(clasificarFinDeSemana(t('Horario de lunes a viernes y sábado medio día')), 'no');
  assert.equal(clasificarFinDeSemana(t('Horario de lunes a viernes, sábados y domingos libres')), 'si');
  assert.equal(clasificarFinDeSemana(t('Horario de lunes a viernes de 8 a 17')), 'si');
  assert.equal(clasificarFinDeSemana(t('Turnos rotativos')), 'rotativo');
  assert.equal(clasificarFinDeSemana(t('Crear un chatbot que conteste incluso los fines de semana')), 'no_dice');
});

test('horario flexible: para el trabajador sí; exigido al candidato no', () => {
  assert.equal(clasificarHorarioFlexible(t('Ofrecemos horario flexible y prestaciones')), 'si');
  assert.equal(clasificarHorarioFlexible(t('Cumple tus horas semanales a cumplir entre 7 y 20 h')), 'si');
  assert.equal(clasificarHorarioFlexible(t('Requisitos: disponibilidad de horario flexible')), 'no');
  assert.equal(clasificarHorarioFlexible(t('Horario de 8:00 a 17:00')), 'no');
  assert.equal(clasificarHorarioFlexible(t('Buen ambiente laboral')), 'no_dice');
  // "trabajar bajo metas" no es horario flexible (Jev lo confundía).
  assert.equal(clasificarHorarioFlexible(t('Que sepa trabajar bajo metas y resultados')), 'no_dice');
});

test('modalidad: híbrido, remoto, presencial y negación', () => {
  assert.equal(clasificarModalidad(t('Modalidad híbrida, 3 días en oficina')), 'hibrido');
  assert.equal(clasificarModalidad(t('Trabajo 100% remoto desde casa')), 'remoto');
  assert.equal(clasificarModalidad(t('Home office. Conoce nuestras oficinas en zona 10')), 'remoto');
  assert.equal(clasificarModalidad(t('Home office 2 días, presencial el resto')), 'hibrido');
  assert.equal(clasificarModalidad(t('Disponibilidad para trabajar en sede zona 4')), 'presencial');
  assert.equal(clasificarModalidad(t('Este puesto no es remoto')), 'presencial');
  assert.equal(clasificarModalidad(t('Buen salario')), 'no_dice');
});

test('área: el título manda (call center gana aunque mencione Excel)', () => {
  assert.equal(clasificarArea(t('Uso de Excel y reportes'), 'Agente de Call Center'), 'call_center');
  assert.equal(clasificarArea(t(''), 'Asistente administrativo'), 'administrativa');
  assert.equal(clasificarArea(t(''), 'Community Manager'), 'computacion');
  assert.equal(clasificarArea(t('Realizar llamadas salientes'), 'Agente'), 'call_center');
});

test('contable: funciones centrales sí; facturación o IVA de una factura no', () => {
  assert.equal(clasificarPerfilContable(t('Perito contador. Conciliaciones bancarias y estados financieros')), 'contable');
  assert.equal(clasificarPerfilContable(t('Facturación y cobros, incluye IVA')), 'administrativo_con_numeros');
  assert.equal(clasificarPerfilContable(t('Atención al cliente')), 'no_contable');
});

test('palanca IA: físico baja; remoto siempre alta (salvo call center); carga de datos no es carga física', () => {
  assert.equal(clasificarPalancaIA(t('Picking de pedidos'), 'Auxiliar de Bodega', 'otro'), 'baja');
  assert.equal(clasificarPalancaIA(t('Carga de datos en Excel'), 'Asistente virtual', 'administrativa', 'remoto'), 'alta');
  assert.equal(clasificarPalancaIA(t('Excel, reportes, CRM y correo electrónico'), 'Asistente', 'administrativa'), 'alta');
  assert.equal(clasificarPalancaIA(t('Herrería en planta'), 'Herrero de planta', 'otro'), 'baja');
});

test('nivel: community manager y asistente de gerencia no son jefatura; supervisor sí', () => {
  assert.equal(clasificarNivel(t(''), 'Community Manager Jr'), 'entrada');
  assert.equal(clasificarNivel(t(''), 'Social Media Manager'), 'intermedio');
  assert.equal(clasificarNivel(t(''), 'Asistente de Gerencia'), 'entrada');
  assert.equal(clasificarNivel(t(''), 'Supervisor de ventas'), 'jefatura_o_senior');
  assert.equal(clasificarNivel(t('Con personal a cargo'), 'Analista'), 'jefatura_o_senior');
});

test('experiencia: estricta gana a flexible', () => {
  assert.equal(clasificarExperienciaExigencia(t('Experiencia comprobable de 2 años')), 'estricta');
  assert.equal(clasificarExperienciaExigencia(t('No necesitas experiencia, te capacitamos')), 'flexible');
  assert.equal(clasificarExperienciaExigencia(t('Experiencia deseable')), 'flexible');
  assert.equal(clasificarExperienciaExigencia(t('Buen ambiente')), 'no_dice');
});

test('vehículo: moto sola, moto o carro, licencia', () => {
  assert.equal(clasificarVehiculo(t('Indispensable contar con moto')), 'solo_moto');
  assert.equal(clasificarVehiculo(t('Contar con moto o carro propio')), 'carro_o_licencia');
  assert.equal(clasificarVehiculo(t('Licencia de conducir vigente')), 'carro_o_licencia');
  assert.equal(clasificarVehiculo(t('Excel')), 'no_pide');
});

test('clasificarOferta devuelve los 12 criterios con ids de los catálogos', () => {
  const f = clasificarOferta({ titulo: 'Asistente administrativo', descripcion: 'Trabajo remoto, lunes a viernes. Excel y reportes.', requerimientos: ['Educación mínima: Bachillerato / Educación Media'] });
  assert.deepEqual(Object.keys(f).sort(), ['area', 'estudios', 'experienciaExigencia', 'finDeSemana', 'formacionEspecifica', 'horarioFlexible', 'ingles', 'modalidad', 'nivel', 'palancaIA', 'perfilContable', 'vehiculo']);
  assert.equal(f.modalidad, 'remoto');
  assert.equal(f.palancaIA, 'alta');
  assert.equal(f.finDeSemana, 'si');
});

test('crearJevLocal: clasificarCriterios usa el texto completo sin red', async () => {
  const jev = crearJevLocal();
  const larga = `${'relleno '.repeat(600)} Requisito: inglés avanzado indispensable.`;
  const flags = await clasificarCriterios(jev, [{ id: 'A', titulo: 'Asistente', descripcion: larga, requerimientos: [] }]);
  assert.equal(flags.get('A').ingles, 'requerido');
  assert.equal(flags.get('A')._sinClasificar, undefined);
});

test('crearJevLocal: extract con los patrones de CAMPOS_EXTRACT', async () => {
  const r = await extraerCampos(crearJevLocal(), { descripcion: 'Salario Q4,500 al mes. Graduado de diversificado.', requerimientos: [] });
  assert.equal(r.salarioTexto, 'Q4,500');
  assert.equal(r.periodoSalario, 'al mes');
  assert.equal(r.estudiosTexto, 'diversificado');
  assert.ok(CAMPOS_EXTRACT.length === 3);
});

test('crearJevLocal: etiqueta híbrida sin respaldo en el texto queda sin confirmar (→ REVISAR)', async () => {
  const jev = crearJevLocal();
  const flags = { modalidad: 'hibrido', finDeSemana: 'si', ingles: 'no_pide', estudios: 'bachillerato_o_tecnico' };
  const claims = await verificarClaims(jev, claimsDe(flags, { salarioMensualQ: 5000, piso: 4252.28 }), { descripcion: 'Agente de llamadas, lunes a viernes', requerimientos: [] });
  const hibrido = claims.find((c) => c.claim === 'El puesto es híbrido');
  assert.equal(hibrido.veredicto, 'unsupported');
  const r = ajustarPorClaims({ veredicto: 'APTO', motivos: [], razon: [], flags }, claims);
  assert.equal(r.veredicto, 'REVISAR');
  const ok = await verificarClaims(jev, ['El puesto es 100% remoto'], { descripcion: 'Trabajo 100% remoto' });
  assert.equal(ok[0].veredicto, 'verified');
});

test('relevanciaLocal: administrativo digital con IA > call center > bodega', () => {
  const admin = relevanciaLocal('Asistente: Excel, reportes, CRM, automatización con IA');
  const call = relevanciaLocal('Call center, llamadas salientes');
  const bodega = relevanciaLocal('Bodega, carga y descarga');
  assert.ok(admin > call && call >= bodega - 0.2, `${admin} ${call} ${bodega}`);
  assert.ok(admin <= 1 && bodega >= 0);
});
