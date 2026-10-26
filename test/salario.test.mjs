// test/salario.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSalario, salarioMensual } from '../src/juez/salario.mjs';

test('parseSalario entiende formatos guatemaltecos', () => {
  assert.deepEqual(parseSalario('4,500.00 Q (Mensual)'), { minQ: 4500, maxQ: 4500, periodo: 'mensual' });
  assert.deepEqual(parseSalario('Q150 diarios'), { minQ: 150, maxQ: 150, periodo: 'diario' });
  assert.deepEqual(parseSalario('Q 2,200 quincenales'), { minQ: 2200, maxQ: 2200, periodo: 'quincenal' });
  assert.deepEqual(parseSalario('Q4,500 - Q5,500 al mes'), { minQ: 4500, maxQ: 5500, periodo: 'mensual' });
});

test('parseSalario no adivina', () => {
  assert.equal(parseSalario('A convenir'), null);
  assert.equal(parseSalario('Según capacidades'), null);
  assert.equal(parseSalario('Salario no publicado'), null);
  assert.equal(parseSalario('Q4,500'), null); // sin periodicidad → null
  assert.equal(parseSalario(null), null);
});

test('salarioMensual normaliza a mes', () => {
  assert.equal(salarioMensual(parseSalario('Q150 diarios')), 4500);
  assert.equal(salarioMensual(parseSalario('Q 2,200 quincenales')), 4400);
  assert.equal(salarioMensual(parseSalario('Q4,500 al mes')), 4500);
  assert.equal(salarioMensual(null), null);
});

test('parseSalario solo captura cifras de dinero (no años, vacantes ni teléfonos)', () => {
  assert.deepEqual(parseSalario('Q4,500 mensuales, 2 años de experiencia, 5 vacantes'), { minQ: 4500, maxQ: 4500, periodo: 'mensual' });
  assert.deepEqual(parseSalario('Teléfono 2233-4455, salario Q4,500 al mes'), { minQ: 4500, maxQ: 4500, periodo: 'mensual' });
});

test('parseSalario toma la periodicidad ADYACENTE a la cifra, no la global', () => {
  // "diarias" pertenece a la jornada, no al salario → 'mensual' (prohibido inflar ×30)
  assert.deepEqual(parseSalario('Q4,500 mensuales. Jornada de 8 horas diarias.'), { minQ: 4500, maxQ: 4500, periodo: 'mensual' });
});

test('salarioMensual cubre semanal, anual y por_hora', () => {
  assert.equal(salarioMensual(parseSalario('Q100 semanales')), 433.33);
  assert.equal(salarioMensual(parseSalario('Q60,000 anuales')), 5000);
  assert.equal(salarioMensual(parseSalario('Q20 por hora')), 4800);
});

test('salarioMensual devuelve null con periodo desconocido o ausente', () => {
  assert.equal(salarioMensual({ minQ: 4500, maxQ: 4500, periodo: 'catorcenal' }), null);
  assert.equal(salarioMensual({ minQ: 4500, maxQ: 4500 }), null);
});
