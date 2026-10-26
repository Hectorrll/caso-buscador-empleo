import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankear, sanityFind, porqueDe, scoreCompuesto } from '../src/juez/rank.mjs';
import { cargarConfig } from '../src/config.mjs';

const config = cargarConfig();

test('rankear puntúa con jev_rerank', async () => {
  const jevFake = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_rerank');
      return { ranked: args.candidates.map((c, i) => ({ rank: i + 1, id: c.id, relevance: 0.9 - i * 0.4 })) };
    },
  };
  const scores = await rankear(jevFake, [{ id: 'A', texto: 'x' }, { id: 'B', texto: 'y' }], config);
  assert.equal(scores.get('A'), 90);
  assert.equal(scores.get('B'), 50);
});

test('rankear manda requerimientos completos + cola de descripción dentro del tope de 2,000', async () => {
  const capturado = [];
  const jevFake = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_rerank');
      capturado.push(...args.candidates);
      return { ranked: args.candidates.map((c, i) => ({ rank: i + 1, id: c.id, relevance: 0.5 })) };
    },
  };
  const candidatas = [
    { id: 'A', requerimientos: ['Idiomas: Inglés', 'Educación mínima: Bachillerato'], descripcion: 'd'.repeat(3000) + ' cierre-A' },
    { id: 'B', texto: 'e'.repeat(3000) + ' Idiomas: Inglés requerido' },
  ];
  await rankear(jevFake, candidatas, config);
  const a = capturado.find((c) => c.id === 'A');
  assert.ok(a.text.includes('Idiomas: Inglés'));
  assert.ok(a.text.includes('Educación mínima: Bachillerato'));
  assert.ok(a.text.includes('cierre-A'));
  assert.ok(a.text.length <= 2000);
  const b = capturado.find((c) => c.id === 'B'); // forma {id, texto}: la cola trae los requisitos
  assert.ok(b.text.includes('Idiomas: Inglés requerido'));
  assert.ok(b.text.length <= 2000);
});

test('rankear parte en lotes de ≤20, reintenta un lote sin ranked y lo degrada si persiste', async () => {
  // lote que responde ranked:null una vez y luego sí → el reintento único lo rescata
  let llamadas = 0;
  const jevIntermitente = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_rerank');
      llamadas++;
      if (llamadas === 1) return { status: 'invalid_response', ranked: null };
      return { ranked: args.candidates.map((c, i) => ({ rank: i + 1, id: c.id, relevance: 0.7 })) };
    },
  };
  const logMudo = { error: () => { throw new Error('no debía loguear: el reintento rescató el lote'); } };
  const scores = await rankear(jevIntermitente, [{ id: 'A', texto: 'x' }], config, logMudo);
  assert.equal(llamadas, 2); // llamada + un reintento
  assert.equal(scores.get('A'), 70);
  assert.equal(scores._degradado, undefined);

  // lote sordo (ranked ausente también tras el reintento): sin scores, _degradado + log.error;
  // el lote sano sí puntúa. 21 candidatas → 2 llamadas por el tope de 20.
  const errores = [];
  const tamanos = [];
  let llamadasSordas = 0;
  const jevSordo = {
    call: async (herr, args) => {
      assert.equal(herr, 'jev_rerank');
      tamanos.push(args.candidates.length);
      if (args.candidates[0].id.startsWith('P')) { llamadasSordas++; return { status: 'invalid_response', ranked: null }; }
      return { ranked: args.candidates.map((c, i) => ({ rank: i + 1, id: c.id, relevance: 0.6 })) };
    },
  };
  const candidatas = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `P${i}`, texto: 'x' })), // lote 1 (20) — sordo
    { id: 'OK', texto: 'y' },                                               // lote 2 (1) — responde
  ];
  const scores2 = await rankear(jevSordo, candidatas, config, { error: (m) => errores.push(m) });
  assert.equal(llamadasSordas, 2); // llamada + un reintento, no más
  assert.ok(tamanos.every((n) => n <= 20));
  assert.equal(scores2.size, 1); // la bandera _degradado no es una entrada del Map
  assert.equal(scores2.get('OK'), 60);
  assert.equal(scores2._degradado, true);
  assert.equal(errores.length, 1);
  assert.match(errores[0], /jev_rerank sin 'ranked'/);
});

test('sanityFind devuelve el exists global', async () => {
  const jevFake = { call: async () => ({ exists: 0.42, exists_verdict: 'weak', top: [] }) };
  assert.deepEqual(await sanityFind(jevFake, [{ id: 'A', texto: 'x' }], config), { exists: 0.42 });
});

test('scoreCompuesto: pesos del spec, acotado y con desglose', () => {
  const flags = { modalidad: 'remoto', palancaIA: 'alta', area: 'administrativa', nivel: 'entrada' };
  const max = scoreCompuesto({ relevancia: 100, flags, experiencia: { anios: 0 }, otrosTags: [], sinEvidencia: 0 });
  assert.equal(max.score, 100);
  assert.equal(max.desglose, '45 relevancia + 20 remoto + 15 IA alta + 10 entrada + 10 área');
  const r = scoreCompuesto({ relevancia: 60, flags: { modalidad: 'presencial', palancaIA: 'baja', area: 'ventas', nivel: 'intermedio' }, experiencia: { anios: 2 }, otrosTags: [], sinEvidencia: 1 });
  assert.equal(r.score, 27 + 5 + 0 + 0 + 0 - 8);
  assert.match(r.desglose, /− 8 evidencia$/);
  assert.equal(scoreCompuesto({ relevancia: 0, flags: { modalidad: 'presencial', palancaIA: 'baja', area: 'ventas' }, experiencia: { anios: null }, otrosTags: [], sinEvidencia: 3 }).score, 0);
  assert.equal(scoreCompuesto({ relevancia: 0, flags: { modalidad: 'hibrido', palancaIA: 'media', area: 'otro' }, experiencia: { anios: 5 }, otrosTags: ['Beca/Prácticas'], sinEvidencia: 0 }).score, 15 + 6 + 10 + 3);
  assert.equal(scoreCompuesto({ relevancia: 0, flags: { modalidad: 'hibrido', palancaIA: 'media', area: 'otro', nivel: 'entrada' }, experiencia: { anios: null }, otrosTags: [], sinEvidencia: 0 }).score, 15 + 6 + 5 + 3);
});

test('scoreCompuesto: fin de semana trabajado o rotativo resta 5 (no descarta)', () => {
  const flags = { modalidad: 'remoto', palancaIA: 'alta', area: 'administrativa', nivel: 'entrada' };
  const base = scoreCompuesto({ relevancia: 60, flags: { ...flags, finDeSemana: 'si' }, experiencia: { anios: 1 }, otrosTags: [], sinEvidencia: 0 });
  for (const v of ['no', 'rotativo']) {
    const r = scoreCompuesto({ relevancia: 60, flags: { ...flags, finDeSemana: v }, experiencia: { anios: 1 }, otrosTags: [], sinEvidencia: 0 });
    assert.equal(r.score, base.score - 5);
    assert.match(r.desglose, /− 5 fin de semana$/);
  }
  // 'si' y 'no_dice' no penalizan
  for (const v of ['si', 'no_dice', undefined]) {
    const r = scoreCompuesto({ relevancia: 60, flags: { ...flags, finDeSemana: v }, experiencia: { anios: 1 }, otrosTags: [], sinEvidencia: 0 });
    assert.equal(r.score, base.score);
    assert.ok(!r.desglose.includes('fin de semana'));
  }
});

test('porqueDe resume preferencias', () => {
  const s = porqueDe({ modalidad: 'remoto', finDeSemana: 'si', horarioFlexible: 'si', area: 'administrativa', ingles: 'no_pide', estudios: 'bachillerato_o_tecnico', palancaIA: 'alta', nivel: 'entrada' });
  assert.ok(s.includes('100% remoto') && s.includes('fin de semana') && s.includes('flexible'));
  assert.ok(s.includes('palanca IA alta') && s.includes('entrada'));
  const m = porqueDe({ modalidad: 'hibrido', finDeSemana: 'no_dice', horarioFlexible: 'no_dice', area: 'otro', palancaIA: 'media', nivel: 'intermedio' });
  assert.ok(m.includes('palanca IA media') && !m.includes('entrada'));
  assert.equal(porqueDe({ modalidad: 'presencial', finDeSemana: 'no_dice', horarioFlexible: 'no_dice', area: 'otro', palancaIA: 'baja', nivel: 'intermedio' }), 'cumple los requisitos duros');
});
