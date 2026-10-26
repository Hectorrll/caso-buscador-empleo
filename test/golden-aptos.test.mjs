// test/golden-aptos.test.mjs
// Regresión dorada: los 9 APTO de la corrida del 2026-09-25 re-juzgados con los flags
// que un clasificador correcto debería dar (fixtures/aptos-2026-09-25.json, etiquetado
// a mano — NO modificar el fixture; si un caso falla, el bug está en el juez).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { juzgarOferta } from '../src/juez/criterios.mjs';
import { cargarConfig } from '../src/config.mjs';

const casos = JSON.parse(readFileSync(new URL('./fixtures/aptos-2026-09-25.json', import.meta.url), 'utf8'));
const config = cargarConfig(); // config.perfil.json real

// Jev mínimo: el escudo pasa sin inyección y jev_extract no encuentra nada
// (el salario sale de salarioTag). juzgarOferta no llama classify ni verify.
const jevFake = {
  call: async (herr) => {
    if (herr === 'jev_screen') return { probabilities: { injection: 0.01 } };
    if (herr === 'jev_extract') return { results: [] };
    throw new Error('herramienta inesperada ' + herr);
  },
};

// Casos cuya etiqueta de modalidad contradice el texto (fuente 'contradiccion'):
// deben llevar la razón "La etiqueta del sitio dice ..." en r.razon.
const CONTRADICCION = new Set([
  '3D339CF0F9944B1A61373E686DCF3405',
  'BD95552EB28E18D561373E686DCF3405',
  '10482F00ECE1195861373E686DCF3405',
  'E27B7B64B3696D0F61373E686DCF3405',
]);

for (const c of casos) {
  test(`golden ${c.id.slice(0, 5)} — ${c.nota}`, async () => {
    const r = await juzgarOferta(jevFake, { card: c.card, detalle: c.detalle, flags: c.flagsCorrectos, config });
    assert.equal(r.veredicto, c.esperado.veredicto, `motivos: [${r.motivos.join(', ')}] razón: ${r.razon.join(' | ')}`);
    for (const motivo of c.esperado.motivosIncluye) {
      assert.ok(r.motivos.includes(motivo), `falta motivo '${motivo}' en [${r.motivos.join(', ')}]`);
    }
    if (CONTRADICCION.has(c.id)) {
      assert.ok(
        r.razon.some((x) => x.includes('La etiqueta del sitio dice')),
        `sin razón de contradicción en: ${r.razon.join(' | ')}`,
      );
    }
    // B4C6: la descripción ("Experiencia mínima de 2 años") gana a la ficha (1 año)
    if (c.id === 'B4C689A0C95F47AC61373E686DCF3405') assert.equal(r.experiencia.anios, 2);
  });
}
