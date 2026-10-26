import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ajustarPorClaims, claimsDe, verificarClaims } from '../src/juez/verify.mjs';

test('claimsDe solo afirma lo que el flag sostiene', () => {
  const flags = { ingles: 'no_pide', estudios: 'bachillerato_o_tecnico', finDeSemana: 'si', horarioFlexible: 'no_dice', modalidad: 'remoto', area: 'administrativa' };
  const claims = claimsDe(flags, { salarioMensualQ: 5000, piso: 4252.28 });
  assert.ok(claims.includes('El puesto descansa el fin de semana'));
  assert.ok(claims.includes('El puesto es 100% remoto'));
  assert.ok(claims.includes('El puesto no requiere inglés'));
  assert.ok(claims.includes('El puesto no exige estudios universitarios'));
  assert.ok(claims.includes('El salario mensual es de al menos Q4252.28'));
  assert.ok(!claims.some((c) => c.includes('su propio horario'))); // no_dice → no se afirma
});

test('claimsDe afirma el horario flexible como autonomía del trabajador', () => {
  const flags = { ingles: 'no_pide', estudios: 'bachillerato_o_tecnico', finDeSemana: 'no_dice', horarioFlexible: 'si', modalidad: 'remoto', area: 'administrativa' };
  const claims = claimsDe(flags, { salarioMensualQ: 5000, piso: 4252.28 });
  assert.ok(claims.includes('El puesto permite al trabajador elegir o ajustar su propio horario (no que el trabajador deba adaptarse al horario que necesite la empresa)'));
});

test('claimsDe con estudios ambiguo NO afirma que no exige universidad', () => {
  const flags = { ingles: 'ambiguo', estudios: 'ambiguo', finDeSemana: 'no_dice', horarioFlexible: 'no_dice', modalidad: 'no_dice', area: 'otro' };
  const claims = claimsDe(flags, { salarioMensualQ: null, piso: 4252.28 });
  // el flag 'ambiguo' NO sostiene la afirmación
  assert.ok(!claims.some((c) => c.includes('universitarios')));
  assert.ok(!claims.some((c) => c.toLowerCase().includes('universidad')));
});

test('verificarClaims parte la evidencia de descripción en trozos de 45,000', async () => {
  let evidencia = null;
  const jevFake = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_verify');
      evidencia = args.evidence;
      return { results: args.claims.map((c) => ({ claim: c, verdict: 'verified', probabilities: { supports: 0.9 } })) };
    },
  };
  const descripcion = 'a'.repeat(52000) + 'FIN';
  await verificarClaims(jevFake, ['x'], { descripcion, requerimientos: ['R1'], salarioTag: 'Q4,500', otrosTags: ['Remoto', 'Tiempo Completo'] });
  const descItems = evidencia.filter((e) => e.id.startsWith('descripcion-'));
  assert.deepEqual(descItems.map((e) => e.id), ['descripcion-1', 'descripcion-2']);
  assert.ok(descItems.every((e) => e.text.length <= 45000));
  assert.equal(descItems.map((e) => e.text).join(''), descripcion); // jev_verify ve todo, sin truncar
  assert.ok(evidencia.some((e) => e.id === 'requerimientos' && e.text === 'R1'));
  const ficha = evidencia.find((e) => e.id === 'ficha');
  assert.ok(ficha.text.includes('Salario publicado: Q4,500'));
  assert.ok(ficha.text.includes('Tiempo Completo')); // las etiquetas no-modales siguen siendo evidencia
});

test('verificarClaims excluye la etiqueta de modalidad de la evidencia (no se auto-cita)', async () => {
  let ficha = null;
  const jevFake = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_verify');
      ficha = args.evidence.find((e) => e.id === 'ficha');
      return { results: args.claims.map((c) => ({ claim: c, verdict: 'verified' })) };
    },
  };
  // El claim "híbrido" viene de la etiqueta 'Presencial y remoto': si la etiqueta entrara
  // como evidencia, jev_verify la citaría a sí misma (call centers falsos pasaban así).
  await verificarClaims(jevFake, ['El puesto es híbrido'], { otrosTags: ['Presencial y remoto', 'Tiempo Completo'] });
  assert.ok(!ficha.text.includes('Presencial y remoto'));
  assert.ok(ficha.text.includes('Tiempo Completo'));
  await verificarClaims(jevFake, ['El puesto es 100% remoto'], { otrosTags: ['Remoto'] });
  assert.ok(!ficha.text.includes('Remoto'));
  assert.ok(ficha.text.includes('Etiquetas: ninguna'));
});

test('verificarClaims traduce los veredictos de jev_verify', async () => {
  const jevFake = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_verify');
      assert.equal(args.claims.length, 2);
      return { results: [
        { claim: args.claims[0], verdict: 'verified', probabilities: { supports: 0.99 } },
        { claim: args.claims[1], verdict: 'unsupported', probabilities: { says_nothing: 0.9 } },
      ] };
    },
  };
  const r = await verificarClaims(jevFake, ['a', 'b'], { descripcion: 'texto', requerimientos: [], salarioTag: null });
  assert.equal(r[0].ok, true);
  assert.equal(r[1].ok, false);
  assert.equal(r[1].veredicto, 'unsupported');
});

test('sin claims no se llama a Jev', async () => {
  const jevFake = { call: async () => { throw new Error('no debía llamarse'); } };
  assert.deepEqual(await verificarClaims(jevFake, [], { descripcion: 'x' }), []);
});

const rBase = (extra = {}) => ({
  veredicto: 'APTO', motivos: [], razon: ['cumple'],
  flags: { modalidad: 'remoto' }, salarioMensualQ: 5000, ...extra,
});
const claim = (texto, veredicto) => ({ claim: texto, veredicto, ok: veredicto === 'verified' });

const CLAIM_FLEXIBLE = 'El puesto permite al trabajador elegir o ajustar su propio horario (no que el trabajador deba adaptarse al horario que necesite la empresa)';

test('ajustarPorClaims: presencial + flexible no confirmado → DESCARTADO (de APTO o REVISAR)', () => {
  const claims = [claim(CLAIM_FLEXIBLE, 'unsupported')];
  const r = ajustarPorClaims(rBase({ flags: { modalidad: 'presencial' } }), claims);
  assert.equal(r.veredicto, 'DESCARTADO');
  assert.ok(r.motivos.includes('flexible_no_confirmado'));
  assert.ok(r.razon.some((x) => x.includes('horario flexible no se confirma')));
  // desde REVISAR también descarta
  const desdeRevisar = ajustarPorClaims(rBase({ veredicto: 'REVISAR', motivos: ['salario_no_publicado'], flags: { modalidad: 'presencial' } }), claims);
  assert.equal(desdeRevisar.veredicto, 'DESCARTADO');
  // presencial con flexible confirmado no se toca
  const ok = ajustarPorClaims(rBase({ flags: { modalidad: 'presencial' } }), [claim(CLAIM_FLEXIBLE, 'verified')]);
  assert.equal(ok.veredicto, 'APTO');
  // el claim sin presencial no descarta
  const remoto = ajustarPorClaims(rBase(), claims);
  assert.equal(remoto.veredicto, 'APTO');
});

test('ajustarPorClaims: modalidad por etiqueta no confirmada → APTO baja a REVISAR', () => {
  const r = ajustarPorClaims(rBase(), [claim('El puesto es 100% remoto', 'unsupported')]);
  assert.equal(r.veredicto, 'REVISAR');
  assert.ok(r.motivos.includes('modalidad_no_confirmada'));
  assert.ok(r.razon.some((x) => x.includes('remoto') && x.includes('no lo confirma')));
  // híbrido igual
  const h = ajustarPorClaims(rBase({ flags: { modalidad: 'hibrido' } }), [claim('El puesto es híbrido', 'contradicted')]);
  assert.equal(h.veredicto, 'REVISAR');
  assert.ok(h.razon.some((x) => x.includes('híbrido')));
  // REVISAR solo acumula el motivo
  const rev = ajustarPorClaims(rBase({ veredicto: 'REVISAR', motivos: ['salario_no_publicado'] }), [claim('El puesto es 100% remoto', 'unsupported')]);
  assert.equal(rev.veredicto, 'REVISAR');
  assert.ok(rev.motivos.includes('salario_no_publicado') && rev.motivos.includes('modalidad_no_confirmada'));
  // verified no mueve nada
  const ok = ajustarPorClaims(rBase(), [claim('El puesto es 100% remoto', 'verified')]);
  assert.equal(ok.veredicto, 'APTO');
  assert.deepEqual(ok.motivos, []);
});

test('ajustarPorClaims: universidad contradicha → REVISAR; unsupported no mueve', () => {
  const r = ajustarPorClaims(rBase(), [claim('El puesto no exige estudios universitarios', 'contradicted')]);
  assert.equal(r.veredicto, 'REVISAR');
  assert.ok(r.motivos.includes('universidad_contradicha'));
  assert.ok(r.razon.some((x) => x.includes('estudios universitarios')));
  const noMueve = ajustarPorClaims(rBase(), [claim('El puesto no exige estudios universitarios', 'unsupported')]);
  assert.equal(noMueve.veredicto, 'APTO');
});

test('ajustarPorClaims: fin de semana contradicho → REVISAR; unsupported no mueve', () => {
  const r = ajustarPorClaims(rBase(), [claim('El puesto descansa el fin de semana', 'contradicted')]);
  assert.equal(r.veredicto, 'REVISAR');
  assert.ok(r.motivos.includes('finde_contradicho'));
  assert.ok(r.razon.some((x) => x.includes('fin de semana')));
  // unsupported no mueve (el texto puede simplemente no mencionar el descanso)
  const noMueve = ajustarPorClaims(rBase(), [claim('El puesto descansa el fin de semana', 'unsupported')]);
  assert.equal(noMueve.veredicto, 'APTO');
  assert.ok(!noMueve.motivos.includes('finde_contradicho'));
});

test('ajustarPorClaims: DESCARTADO se devuelve intacto (nunca se reabre)', () => {
  const r = { veredicto: 'DESCARTADO', motivos: ['ingles_requerido'], razon: ['inglés'], flags: { modalidad: 'presencial' } };
  const out = ajustarPorClaims(r, [
    claim(CLAIM_FLEXIBLE, 'verified'),
    claim('El puesto es 100% remoto', 'contradicted'),
    claim('El puesto descansa el fin de semana', 'contradicted'),
  ]);
  assert.equal(out, r); // mismo objeto, sin tocar
});
