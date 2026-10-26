// test/probabilidad.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearBaseSalarial, probabilidadApto } from '../src/juez/probabilidad.mjs';
import { cargarConfig } from '../src/config.mjs';

const config = cargarConfig();
const PISO = config.duros.salario_piso_Q;

// Muestra calculable a mano (piso Q4,000 para números redondos):
// computacion/entrada 3 ok de 4; administrativa/entrada 1 ok de 1; 1 sin parsear.
const muestras = [
  { area: 'computacion', nivel: 'entrada', salarioTag: 'Q5,000 mensuales' },
  { area: 'computacion', nivel: 'entrada', salarioTag: 'Q6,000 mensuales' },
  { area: 'computacion', nivel: 'entrada', salarioTag: 'Q4,500 mensuales' },
  { area: 'computacion', nivel: 'entrada', salarioTag: 'Q3,000 mensuales' },
  { area: 'administrativa', nivel: 'entrada', salarioTag: 'Q5,000 mensuales' },
  { area: 'ventas', nivel: 'entrada', salarioTag: 'A convenir' }, // no parsea → se salta
];
const base = crearBaseSalarial(muestras, 4000, 20);
const cerca = (a, b) => Math.abs(a - b) < 1e-9;

test('crearBaseSalarial: suavizado jerárquico global → área → celda', () => {
  // g = 4/5 = 0.8
  // pa_computacion = (3 + 20·0.8)/(4+20) = 19/24
  // celda computacion|entrada = (3 + 20·(19/24))/24
  const paComp = 19 / 24;
  const celdaComp = (3 + 20 * paComp) / 24;
  const r1 = base('computacion', 'entrada');
  assert.ok(cerca(r1.p, celdaComp), `${r1.p} ≠ ${celdaComp}`);
  assert.equal(r1.n, 4);

  // celda administrativa|entrada = (1 + 20·(17/21))/21
  const paAdm = 17 / 21;
  const celdaAdm = (1 + 20 * paAdm) / 21;
  assert.ok(cerca(base('administrativa', 'entrada').p, celdaAdm));
});

test('crearBaseSalarial: celda desconocida cae al área; área desconocida cae al global', () => {
  const paComp = 19 / 24;
  const sinNivel = base('computacion', 'intermedio'); // celda inexistente
  assert.ok(cerca(sinNivel.p, paComp));
  assert.equal(sinNivel.n, 0);
  const sinArea = base('ventas', 'entrada'); // área sin muestras parseables
  assert.ok(cerca(sinArea.p, 0.8));          // global g = 4/5
  assert.equal(sinArea.n, 0);
});

test('crearBaseSalarial: sin muestras → base neutra 0.5', () => {
  const vacia = crearBaseSalarial([], PISO);
  assert.deepEqual(vacia('computacion', 'entrada'), { p: 0.5, n: 0 });
});

const baseStub = () => ({ p: 0.6, n: 10 });
const flagsBase = { area: 'administrativa', nivel: 'entrada', modalidad: 'remoto' };
const llamar = (extra = {}) => probabilidadApto({ baseSalarial: baseStub, config, ...extra });

test('probabilidadApto: APTO → p=1 sin dudas; DESCARTADO → null', () => {
  assert.deepEqual(llamar({ veredicto: 'APTO', motivos: [], flags: flagsBase }), { p: 1, dudas: [] });
  assert.equal(llamar({ veredicto: 'DESCARTADO', motivos: ['universidad'], flags: flagsBase }), null);
});

test('probabilidadApto: salario_no_publicado usa la base empírica', () => {
  const r = llamar({ veredicto: 'REVISAR', motivos: ['salario_no_publicado'], flags: flagsBase });
  assert.equal(r.p, 0.6);
  assert.equal(r.dudas.length, 1);
  assert.ok(r.dudas[0].texto.includes('60%'));
  assert.ok(r.dudas[0].texto.includes('administrativa/entrada'));
  assert.ok(r.dudas[0].texto.includes('n=10'));
  assert.ok(r.dudas[0].texto.includes(`Q${PISO}`));
  assert.equal(r.dudas[0].accion, 'Pregunta el salario antes de la entrevista');
});

test('probabilidadApto: experiencia_2 = flexible + 0.5·no_dice, con piso 0.1', () => {
  const r = llamar({
    veredicto: 'REVISAR', motivos: ['experiencia_2'],
    flags: { ...flagsBase, probabilidades: { experienciaExigencia: { flexible: 0.6, no_dice: 0.2, estricta: 0.2 } } },
  });
  assert.equal(r.p, 0.7); // 0.6 + 0.5·0.2
  assert.ok(r.dudas[0].texto.includes('70%'));
  assert.ok(r.dudas[0].texto.includes('tú <1'));

  const estricta = llamar({
    veredicto: 'REVISAR', motivos: ['experiencia_2'],
    flags: { ...flagsBase, probabilidades: { experienciaExigencia: { estricta: 1 } } },
  });
  assert.equal(estricta.p, 0.1); // piso, aunque flexible+0.5·no_dice = 0

  const sinProb = llamar({ veredicto: 'REVISAR', motivos: ['experiencia_2'], flags: flagsBase });
  assert.equal(sinProb.p, 0.5); // sin probabilidades de Jev → neutro
});

test('probabilidadApto: los dos motivos de modalidad son UN solo factor', () => {
  const claims = [{ claim: 'El puesto es 100% remoto', veredicto: 'unsupported', ok: false, probabilidad: { supports: 0.7 } }];
  const r = llamar({
    veredicto: 'REVISAR',
    motivos: ['modalidad_solo_texto', 'modalidad_no_confirmada'],
    flags: flagsBase, claims,
  });
  assert.equal(r.dudas.length, 1);
  assert.equal(r.p, 0.7);
  assert.ok(r.dudas[0].texto.includes('Modalidad remoto sin confirmar'));

  const sinClaim = llamar({ veredicto: 'REVISAR', motivos: ['modalidad_solo_texto'], flags: flagsBase, claims: [] });
  assert.equal(sinClaim.p, 0.5);
});

test('probabilidadApto: hibrido_fuera_ciudad usa config.revisar.p_hibrido_fuera_metro', () => {
  const r = llamar({ veredicto: 'REVISAR', motivos: ['hibrido_fuera_ciudad'], flags: { ...flagsBase, modalidad: 'hibrido' } });
  assert.equal(r.p, 0.15);
  assert.equal(r.dudas[0].accion, 'Confirma cuántos días hay que ir a la oficina');
});

test('probabilidadApto: universidad_contradicha = 1 − contradicts del claim', () => {
  const claims = [{ claim: 'El puesto no exige estudios universitarios', veredicto: 'contradicted', ok: false, probabilidad: { contradicts: 0.8 } }];
  const r = llamar({ veredicto: 'REVISAR', motivos: ['universidad_contradicha'], flags: flagsBase, claims });
  assert.ok(cerca(r.p, 0.2));
  assert.equal(r.dudas[0].accion, 'Lee la letra chica de estudios');
  const sinClaim = llamar({ veredicto: 'REVISAR', motivos: ['universidad_contradicha'], flags: flagsBase, claims: [] });
  assert.equal(sinClaim.p, 0.5);
});

test('probabilidadApto: ingles_ambiguo y estudios_ambiguos usan las probabilidades de Jev', () => {
  const r = llamar({
    veredicto: 'REVISAR', motivos: ['ingles_ambiguo', 'estudios_ambiguos'],
    flags: {
      ...flagsBase,
      probabilidades: { ingles: { requerido: 0.3 }, estudios: { universitario_o_mas: 0.4 } },
    },
  });
  // (1−0.3) × (1−0.4) = 0.7 × 0.6 = 0.42
  assert.equal(r.p, 0.42);
  assert.equal(r.dudas.length, 2);
  assert.ok(r.dudas[0].texto.includes('70%'));
  assert.ok(r.dudas[1].texto.includes('60%'));
  // sin probabilidades → neutro 0.5 cada uno
  const sin = llamar({ veredicto: 'REVISAR', motivos: ['ingles_ambiguo'], flags: flagsBase });
  assert.equal(sin.p, 0.5);
});

test('probabilidadApto: dudas de los motivos nuevos (estricta, formación, vehículo, finde)', () => {
  // experiencia_estricta: duda fija 0.4
  const est = llamar({ veredicto: 'REVISAR', motivos: ['experiencia_estricta'], flags: flagsBase });
  assert.equal(est.p, 0.4);
  assert.equal(est.dudas[0].accion, 'Postula solo si tu experiencia se acerca a lo pedido');
  assert.ok(est.dudas[0].texto.includes('tú <1 año'));

  // formacion_especifica: 1 − p(otra_especialidad) de Jev, piso 0.1, default 0.8
  const sinProb = llamar({ veredicto: 'REVISAR', motivos: ['formacion_especifica'], flags: flagsBase });
  assert.equal(sinProb.p, 0.2); // 1 − 0.8
  assert.ok(sinProb.dudas[0].texto.includes('20%'));
  const conProb = llamar({
    veredicto: 'REVISAR', motivos: ['formacion_especifica'],
    flags: { ...flagsBase, probabilidades: { formacionEspecifica: { otra_especialidad: 0.95 } } },
  });
  assert.equal(conProb.p, 0.1); // piso: 1 − 0.95 = 0.05 → 0.1
  assert.equal(conProb.dudas[0].accion, 'Verifica si dominas la carrera/software que piden');

  // vehiculo_carro: duda fija 0.5
  const veh = llamar({ veredicto: 'REVISAR', motivos: ['vehiculo_carro'], flags: flagsBase });
  assert.equal(veh.p, 0.5);
  assert.equal(veh.dudas[0].texto, 'Pide licencia/carro');
  assert.ok(veh.dudas[0].accion.includes('sacarías licencia'));

  // finde_contradicho: 1 − contradicts del claim de fin de semana
  const claims = [{ claim: 'El puesto descansa el fin de semana', veredicto: 'contradicted', ok: false, probabilidad: { contradicts: 0.7 } }];
  const fin = llamar({ veredicto: 'REVISAR', motivos: ['finde_contradicho'], flags: flagsBase, claims });
  assert.ok(cerca(fin.p, 0.3));
  assert.equal(fin.dudas[0].accion, 'Confirma que no se trabaja sábado');
  const sinClaim = llamar({ veredicto: 'REVISAR', motivos: ['finde_contradicho'], flags: flagsBase, claims: [] });
  assert.equal(sinClaim.p, 0.5);
});

test('probabilidadApto: el producto baja con cada duda; motivo desconocido = 0.5', () => {
  const r = llamar({
    veredicto: 'REVISAR',
    motivos: ['salario_no_publicado', 'experiencia_2'],
    flags: { ...flagsBase, probabilidades: { experienciaExigencia: { flexible: 0.6, no_dice: 0.2 } } },
  });
  assert.equal(r.p, 0.42); // 0.6 × 0.7
  const raro = llamar({ veredicto: 'REVISAR', motivos: ['motivo_nuevo'], flags: flagsBase });
  assert.equal(raro.p, 0.5);
  assert.equal(raro.dudas[0].texto, 'motivo_nuevo');
});
