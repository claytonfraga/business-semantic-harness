import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aplicarRegras,
  paraRegex,
  limparComentarios,
  isLinhaApenasMensagemOuLog,
  linhaContemPadrao,
  avaliarQuando,
} from '../../dist/enforcement/extratorOperacoes.js';

test('Given a glob When matched Then it is strictly anchored and rejects invalid suffixes', () => {
  const regexExact = paraRegex('src/index.js');
  assert.equal(regexExact.test('src/index.js'), true);
  assert.equal(regexExact.test('src/index.js.bak'), false, 'Must reject .bak suffix');
  assert.equal(regexExact.test('src/index.js.old'), false, 'Must reject .old suffix');
  assert.equal(regexExact.test('src/index.json'), false, 'Must reject .json suffix');

  const regexSingleStar = paraRegex('src/*.ts');
  assert.equal(regexSingleStar.test('src/app.ts'), true);
  assert.equal(regexSingleStar.test('src/app.ts.bak'), false, 'Must reject suffix on wildcard');
  assert.equal(regexSingleStar.test('src/nested/app.ts'), false, 'Single star must not cross directory boundaries');

  const regexDoubleStar = paraRegex('src/**/service.ts');
  assert.equal(regexDoubleStar.test('src/service.ts'), true);
  assert.equal(regexDoubleStar.test('src/a/b/service.ts'), true);
  assert.equal(regexDoubleStar.test('src/a/b/service.ts.backup'), false, 'Double star must not match invalid suffix');
});

test('Given comments or log messages When inspected Then they do NOT prove operation execution', () => {
  // 1. Single line and block comments
  assert.equal(limparComentarios('// transferAsset(id)'), '');
  assert.equal(limparComentarios('/* transferAsset(id) */'), '');
  assert.equal(limparComentarios('* transferAsset(id)'), '');
  assert.equal(limparComentarios('const x = 1; // comment'), 'const x = 1;');

  // 2. Log messages and exceptions
  assert.equal(isLinhaApenasMensagemOuLog('console.log("transferAsset")'), true);
  assert.equal(isLinhaApenasMensagemOuLog('logger.info("transferAsset")'), true);
  assert.equal(isLinhaApenasMensagemOuLog('throw new Error("transferAsset failed")'), true);
  assert.equal(isLinhaApenasMensagemOuLog('const res = transferAsset(id);'), false);

  // 3. Pattern matcher rejects comment-only lines and log-only lines when configured
  const commentLine = '  // transferAsset(id)';
  assert.equal(linhaContemPadrao(commentLine, 'transferAsset', { ignorarComentarios: true }), false);

  const logLine = '  console.log("transferAsset called");';
  assert.equal(linhaContemPadrao(logLine, 'transferAsset', { ignorarMensagens: true }), false);

  const codeLine = '  const result = transferAsset(id);';
  assert.equal(linhaContemPadrao(codeLine, 'transferAsset', { ignorarComentarios: true }), true);
});

test('Given equivalent refactorings with varying whitespace When evaluated Then recognition succeeds', () => {
  const originalPattern = 'transferAsset(from, to)';

  // Refactoring with spaced arguments
  const spacedLine = '  const r = transferAsset( from , to );';
  assert.equal(linhaContemPadrao(spacedLine, originalPattern), true);

  // Refactoring with tabs and extra indentation
  const tabbedLine = '\t\ttransferAsset(  from,   to  );';
  assert.equal(linhaContemPadrao(tabbedLine, originalPattern), true);
});

test('Given conjunction and disjunction operators When avaliarQuando runs Then logical combinations are respected', () => {
  const diffModified = {
    caminho: 'src/services/asset.ts',
    tipo: 'modificado',
    removido: false,
    adicionadas: ['transferAsset(id);'],
    removidas: ['retireAsset(id);'],
  };

  // 1. Conjunction (AND) requires both adicionou and removeu
  const andRuleAllTrue = {
    caminho: 'src/services/**',
    operador: 'AND',
    adicionou: 'transferAsset',
    removeu: 'retireAsset',
  };
  assert.equal(avaliarQuando(andRuleAllTrue, diffModified), true);

  const andRuleOneFalse = {
    caminho: 'src/services/**',
    operador: 'AND',
    adicionou: 'transferAsset',
    removeu: 'nonExistentMethod',
  };
  assert.equal(avaliarQuando(andRuleOneFalse, diffModified), false);

  // 2. Disjunction (OR) succeeds if either condition holds
  const orRuleOneMatches = {
    caminho: 'src/services/**',
    operador: 'OR',
    adicionou: 'transferAsset',
    removeu: 'nonExistentMethod',
  };
  assert.equal(avaliarQuando(orRuleOneMatches, diffModified), true);

  const orRuleNeitherMatches = {
    caminho: 'src/services/**',
    operador: 'OR',
    adicionou: 'nonExistentMethod1',
    removeu: 'nonExistentMethod2',
  };
  assert.equal(avaliarQuando(orRuleNeitherMatches, diffModified), false);

  // 3. Compound 'todas' and 'qualquer'
  const compoundAny = {
    caminho: 'src/services/**',
    qualquer: [
      { adicionou: 'nonExistentMethod' },
      { adicionou: 'transferAsset' },
    ],
  };
  assert.equal(avaliarQuando(compoundAny, diffModified), true);

  const compoundAll = {
    caminho: 'src/services/**',
    todas: [
      { adicionou: 'transferAsset' },
      { removeu: 'nonExistentMethod' },
    ],
  };
  assert.equal(avaliarQuando(compoundAll, diffModified), false);
});

test('Given purely textual diff matching When aplicarRegras runs Then operation is marked heuristic and facts inferred', () => {
  const regra = {
    id: 'rule-textual-heuristic',
    dominio: 'test-domain',
    operacao: 'TransferAsset',
    quando: { caminho: 'src/services/**', adicionou: 'transferAsset' },
    fatos: [
      { propriedade: 'state', valor: 'TRANSFERRED', determinacao: 'observado', origem: 'code' },
    ],
    // No mandatory structural evidence required
    evidenciasRequeridas: [],
  };

  const diff = {
    caminho: 'src/services/asset.ts',
    tipo: 'adicionado',
    removido: false,
    adicionadas: ['export function transferAsset() {}'],
    removidas: [],
  };

  const operacoes = aplicarRegras([regra], [diff]);
  assert.equal(operacoes.length, 1);

  const op = operacoes[0];
  // Proveniência must declare heuristic origin
  assert.equal(op.proveniencia.origem, 'diff_textual_heuristico');
  assert.match(op.proveniencia.descricao, /Reconhecimento heurístico/);

  // Fact must not claim 'observado' certainty without structural proof
  assert.equal(op.fatos[0].determinacao, 'inferido');
  assert.equal(op.fatos[0].origem, 'diff_textual_heuristico');
});

test('Given diff with only comments or dead code When aplicarRegras runs Then NO operation is recognized', () => {
  const regra = {
    id: 'rule-strict-behavior',
    dominio: 'test-domain',
    operacao: 'TransferAsset',
    quando: {
      caminho: 'src/services/**',
      adicionou: 'transferAsset',
      ignorarComentarios: true,
      ignorarMensagens: true,
    },
    fatos: [{ propriedade: 'state', valor: 'TRANSFERRED', determinacao: 'observado', origem: 'code' }],
  };

  // Diff containing ONLY commented out code
  const commentDiff = {
    caminho: 'src/services/asset.ts',
    tipo: 'modificado',
    removido: false,
    adicionadas: [
      '// transferAsset(id);',
      '/* TODO: call transferAsset() later */',
      'console.log("transferAsset");',
    ],
    removidas: [],
  };

  const operacoes = aplicarRegras([regra], [commentDiff]);
  assert.equal(operacoes.length, 0, 'Comment-only or log-only matches must not recognize operation');
});
