import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parseShapes } from '../../dist/ontology/rdf.js';
import { validateData } from '../../dist/ontology/validate.js';
import { validarOperacao } from '../../dist/enforcement/validadorSemantico.js';
import { createOntologySnapshot } from '../../dist/ontology/query.js';

const pilot = new URL('../../pilot/asset-management/', import.meta.url);
const pilotPath = fileURLToPath(pilot);
async function graph(path) { return parseShapes(await readFile(new URL(path, pilot), 'utf8')); }
const ex = '@prefix ex: <urn:bsh:pilot:ativos:> .\n@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n';
async function check(facts) { return validateData(await graph('.bsh/domains/ativos/shapes.ttl'), parseShapes(ex + facts)); }

// =============================================================================
// 1. Preservação dos Casos Históricos do Piloto
// =============================================================================

test('Given the pilot transfer shape, when a valid transfer graph is checked, then it conforms', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-valid.ttl'));
  assert.equal(report.conforms, true);
});

test('Given a retired asset, when its transfer graph is checked, then SHACL rejects its state', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-retired.ttl'));
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('baixado')));
});

test('Given no new responsible, when a transfer graph is checked, then SHACL reports the missing fact', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-no-responsible.ttl'));
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('responsável')));
});

test('Given no new location, when a transfer graph is checked, then SHACL reports the missing location', async () => {
  const report = await check('ex:a a ex:TransferenciaAtivo; ex:estadoAtual ex:EmUso; ex:novoResponsavel ex:Ana .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('localização')));
});

test('Given an active asset and a retirement reason, when its retirement graph is checked, then SHACL conforms', async () => {
  const report = await check('ex:a a ex:BaixaAtivo; ex:estadoAtual ex:EmUso; ex:motivoBaixa "Irrecuperável" .');
  assert.equal(report.conforms, true);
});

test('Given no retirement reason, when a retirement graph is checked, then SHACL reports the missing reason', async () => {
  const report = await check('ex:a a ex:BaixaAtivo; ex:estadoAtual ex:EmUso .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('motivo')));
});

test('Given a retired asset, when another retirement graph is checked, then SHACL rejects the terminal state', async () => {
  const report = await check('ex:a a ex:BaixaAtivo; ex:estadoAtual ex:Baixado; ex:motivoBaixa "Outra" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('nova baixa')));
});

test('Given a retired asset, when a responsible change graph is checked, then SHACL rejects the terminal state', async () => {
  const report = await check('ex:a a ex:AlteracaoResponsavel; ex:estadoAtual ex:Baixado; ex:novoResponsavel ex:Ana .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('responsável')));
});

test('Given a retired asset, when a location change graph is checked, then SHACL rejects the terminal state', async () => {
  const report = await check('ex:a a ex:AtualizacaoLocalizacao; ex:estadoAtual ex:Baixado; ex:novaLocalizacao "Recife" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('localização')));
});

test('Given domain baseline entities fixture, when checked against shapes, then they conform', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/ativos-cenarios.ttl'));
  assert.equal(report.conforms, true);
});

// =============================================================================
// 2. Padronização de Identificação Patrimonial
// =============================================================================

test('Given a valid patrimonial code, when checked against identification shape, then it conforms', async () => {
  const report = await check('ex:item a ex:Ativo ; ex:codigoPatrimonio "PAT-000123" .');
  assert.equal(report.conforms, true);
});

test('Given an invalid patrimonial code format, when checked against identification shape, then SHACL rejects the pattern', async () => {
  const report = await check('ex:item a ex:Ativo ; ex:codigoPatrimonio "PAT-99" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('PAT-NNNNNN')));
});

test('Given an asset with no patrimonial code, when checked against identification shape, then SHACL reports missing code', async () => {
  const report = await check('ex:item a ex:Ativo ; ex:descricao "Cadeira sem plaqueta" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('PAT-NNNNNN')));
});

// =============================================================================
// 3. Tipagem de Ativos (TI e Veículos)
// =============================================================================

test('Given an IT asset with serial number and patrimonial code, when checked, then it conforms', async () => {
  const report = await check('ex:item a ex:AtivoTI ; ex:codigoPatrimonio "PAT-000124" ; ex:numeroSerie "SN-987654" .');
  assert.equal(report.conforms, true);
});

test('Given an IT asset missing serial number, when checked, then SHACL rejects the missing serial number', async () => {
  const report = await check('ex:item a ex:AtivoTI ; ex:codigoPatrimonio "PAT-000125" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('número de série')));
});

test('Given a vehicle with valid plate, renavam, chassi and code, when checked, then it conforms', async () => {
  const report = await check('ex:car a ex:AtivoVeiculo ; ex:codigoPatrimonio "PAT-000302" ; ex:placa "ABC1D23" ; ex:renavam "12345678901" ; ex:chassi "9BWCA4110FP000002" .');
  assert.equal(report.conforms, true);
});

test('Given a vehicle with invalid plate, when checked, then SHACL rejects the plate format', async () => {
  const report = await check('ex:car a ex:AtivoVeiculo ; ex:codigoPatrimonio "PAT-000303" ; ex:placa "PLACA-INVALIDA" ; ex:renavam "12345678901" ; ex:chassi "9BWCA4110FP000003" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('placa')));
});

// =============================================================================
// 4. Segregação de Funções na Transferência
// =============================================================================

test('Given distinct requester and approver, when checked against segregation rule, then it conforms', async () => {
  const report = await check('ex:t a ex:TransferenciaAtivo ; ex:estadoAtual ex:Disponivel ; ex:novoResponsavel ex:Ana ; ex:novaLocalizacao "SP" ; ex:solicitante ex:Carlos ; ex:aprovador ex:Beatriz .');
  assert.equal(report.conforms, true);
});

test('Given identical requester and approver, when checked against segregation rule, then SHACL rejects with exact violation message', async () => {
  const report = await check('ex:t a ex:TransferenciaAtivo ; ex:estadoAtual ex:Disponivel ; ex:novoResponsavel ex:Ana ; ex:novaLocalizacao "SP" ; ex:solicitante ex:Carlos ; ex:aprovador ex:Carlos .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('O solicitante da transferência não pode ser o aprovador da movimentação.')));
});

// =============================================================================
// 5. Ciclo de Vida: Alocação a Usuário
// =============================================================================

test('Given an available asset with signed responsibility term, when allocated, then it conforms', async () => {
  const report = await check('ex:op a ex:AlocacaoUsuario ; ex:estadoAtual ex:Disponivel ; ex:novoResponsavel ex:Lucas ; ex:termoResponsabilidadeAssinado true .');
  assert.equal(report.conforms, true);
});

test('Given an asset in maintenance, when allocation is attempted, then SHACL rejects the state', async () => {
  const report = await check('ex:op a ex:AlocacaoUsuario ; ex:estadoAtual ex:EmManutencao ; ex:novoResponsavel ex:Lucas ; ex:termoResponsabilidadeAssinado true .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('manutenção')));
});

test('Given an available asset without signed term, when allocation is attempted, then SHACL rejects missing signed term', async () => {
  const report = await check('ex:op a ex:AlocacaoUsuario ; ex:estadoAtual ex:Disponivel ; ex:novoResponsavel ex:Lucas ; ex:termoResponsabilidadeAssinado false .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('termo de responsabilidade')));
});

// =============================================================================
// 6. Ciclo de Vida: Reserva de Ativos
// =============================================================================

test('Given an available asset with complete reservation parameters, when checked, then it conforms', async () => {
  const report = await check('ex:res a ex:ReservaAtivo ; ex:estadoAtual ex:Disponivel ; ex:solicitanteReserva ex:Carla ; ex:dataInicioReserva "2026-10-01"^^xsd:date ; ex:dataFimReserva "2026-10-15"^^xsd:date ; ex:motivoReserva "Auditoria" .');
  assert.equal(report.conforms, true);
});

test('Given an asset in maintenance, when reservation is attempted, then SHACL rejects the state', async () => {
  const report = await check('ex:res a ex:ReservaAtivo ; ex:estadoAtual ex:EmManutencao ; ex:solicitanteReserva ex:Carla ; ex:dataInicioReserva "2026-10-01"^^xsd:date ; ex:dataFimReserva "2026-10-15"^^xsd:date ; ex:motivoReserva "Auditoria" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('disponível')));
});

// =============================================================================
// 7. Ciclo de Vida: Manutenção e Calibração
// =============================================================================

test('Given an asset in maintenance with technical report, when maintenance conclusion is checked, then it conforms', async () => {
  const report = await check('ex:fim a ex:ConclusaoManutencao ; ex:estadoAtual ex:EmManutencao ; ex:laudoManutencao "Laudo técnico #881" .');
  assert.equal(report.conforms, true);
});

test('Given an available asset, when maintenance conclusion is checked without being in maintenance, then SHACL rejects', async () => {
  const report = await check('ex:fim a ex:ConclusaoManutencao ; ex:estadoAtual ex:Disponivel ; ex:laudoManutencao "Laudo #881" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('Conclusão de manutenção')));
});

test('Given equipment with up-to-date maintenance, when checked, then it conforms', async () => {
  const report = await check('ex:eq a ex:AtivoEquipamento ; ex:codigoPatrimonio "PAT-000502" ; ex:statusManutencao ex:EmDia .');
  assert.equal(report.conforms, true);
});

test('Given equipment with expired maintenance, when checked, then SHACL rejects expired status', async () => {
  const report = await check('ex:eq a ex:AtivoEquipamento ; ex:codigoPatrimonio "PAT-000503" ; ex:statusManutencao ex:Vencida .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('manutenção periódica vencida')));
});

test('Given instrumentation asset with valid calibration and certificate, when checked, then it conforms', async () => {
  const report = await check('ex:inst a ex:AtivoInstrumentacao ; ex:codigoPatrimonio "PAT-000602" ; ex:statusCalibracao ex:CalibracaoEmDia ; ex:certificadoCalibracao "CERT-2026" .');
  assert.equal(report.conforms, true);
});

test('Given instrumentation asset with expired calibration, when checked, then SHACL rejects expired status', async () => {
  const report = await check('ex:inst a ex:AtivoInstrumentacao ; ex:codigoPatrimonio "PAT-000603" ; ex:statusCalibracao ex:CalibracaoVencida ; ex:certificadoCalibracao "CERT-2026" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('calibração vencida')));
});

// =============================================================================
// 8. Ciclo de Vida: Movimentação (Envio e Recebimento)
// =============================================================================

test('Given asset shipping with distinct origin and destination, when checked, then it conforms', async () => {
  const report = await check('ex:env a ex:EnvioAtivo ; ex:estadoAtual ex:Disponivel ; ex:origem "Matriz-SP" ; ex:destino "Filial-RJ" ; ex:transportador "Expresso" .');
  assert.equal(report.conforms, true);
});

test('Given asset shipping where origin equals destination, when checked, then SHACL rejects identical locations', async () => {
  const report = await check('ex:env a ex:EnvioAtivo ; ex:estadoAtual ex:Disponivel ; ex:origem "Matriz-SP" ; ex:destino "Matriz-SP" ; ex:transportador "Expresso" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('origem distinta da localização de destino')));
});

test('Given asset receiving for asset in transit with reference, when checked, then it conforms', async () => {
  const report = await check('ex:rec a ex:RecebimentoAtivo ; ex:estadoAtual ex:EmTransito ; ex:movimentacaoReferenciada "DOC-2026-001" .');
  assert.equal(report.conforms, true);
});

test('Given asset receiving for asset not in transit, when checked, then SHACL rejects the state', async () => {
  const report = await check('ex:rec a ex:RecebimentoAtivo ; ex:estadoAtual ex:Disponivel ; ex:movimentacaoReferenciada "DOC-2026-001" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('trânsito')));
});

// =============================================================================
// 9. Ciclo de Vida: Extravio e Recuperação
// =============================================================================

test('Given loss registration with valid incident protocol, when checked, then it conforms', async () => {
  const report = await check('ex:loss a ex:RegistroExtravio ; ex:estadoAtual ex:EmUso ; ex:protocoloSinistro "SIN-2026/001234" .');
  assert.equal(report.conforms, true);
});

test('Given loss registration with malformed incident protocol, when checked, then SHACL rejects the format', async () => {
  const report = await check('ex:loss a ex:RegistroExtravio ; ex:estadoAtual ex:EmUso ; ex:protocoloSinistro "SIN-123" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('SIN-AAAA/NNNNNN')));
});

test('Given recovery operation on lost asset with recovery report, when checked, then it conforms', async () => {
  const report = await check('ex:rec a ex:RecuperacaoAtivo ; ex:estadoAtual ex:Extraviado ; ex:laudoRecuperacao "Laudo de devolução #99" .');
  assert.equal(report.conforms, true);
});

test('Given recovery operation on asset not lost, when checked, then SHACL rejects the state', async () => {
  const report = await check('ex:rec a ex:RecuperacaoAtivo ; ex:estadoAtual ex:Disponivel ; ex:laudoRecuperacao "Laudo #99" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('Extraviado')));
});

// =============================================================================
// 10. Auditoria e Rastreabilidade
// =============================================================================

test('Given an audited patrimonial event with registeredBy and valid dateTime, when checked, then it conforms', async () => {
  const report = await check('ex:audit a ex:EventoPatrimonial ; ex:registradoPor "usuario.auditor" ; ex:dataHoraRegistro "2026-09-24T18:00:00Z"^^xsd:dateTime .');
  assert.equal(report.conforms, true);
});

test('Given an audited patrimonial event missing registeredBy, when checked, then SHACL rejects missing fact', async () => {
  const report = await check('ex:audit a ex:EventoPatrimonial ; ex:dataHoraRegistro "2026-09-24T18:00:00Z"^^xsd:dateTime .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('usuário que registrou')));
});

test('Given an audited patrimonial event with invalid dateTime datatype, when checked, then SHACL rejects datatype', async () => {
  const report = await check('ex:audit a ex:EventoPatrimonial ; ex:registradoPor "usuario.auditor" ; ex:dataHoraRegistro "ontem" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('xsd:dateTime')));
});

// =============================================================================
// 11. Governança e Políticas Humanas (validadorSemantico)
// =============================================================================

test('Given an operation governed by human review policy, when validated semantically, then status is revisao_humana', async () => {
  const snapshot = await createOntologySnapshot(pilotPath);
  const resultado = await validarOperacao(pilotPath, snapshot, {
    id: 'op-1',
    dominio: 'ativos',
    operacao: 'TransferenciaAtivo',
    fatos: [
      { propriedade: 'estadoAtual', valor: 'EmUso', determinacao: 'observado', origem: 'diff' },
      { propriedade: 'novoResponsavel', valor: 'Ana', determinacao: 'observado', origem: 'diff' },
      { propriedade: 'novaLocalizacao', valor: 'Recife', determinacao: 'observado', origem: 'diff' },
      { propriedade: 'solicitante', valor: 'Carlos', determinacao: 'observado', origem: 'diff' },
      { propriedade: 'aprovador', valor: 'Beatriz', determinacao: 'observado', origem: 'diff' },
    ],
    proveniencia: { origem: 'diff', descricao: 'Teste de governança' },
    alteracoesRelacionadas: [],
  });
  assert.equal(resultado.status, 'revisao_humana');
  assert.equal(resultado.requerRevisaoHumana, true);
  assert.ok(resultado.politicas.length > 0);
});

test('Given a retirement operation governed by human policy, when validated semantically, then status is revisao_humana', async () => {
  const snapshot = await createOntologySnapshot(pilotPath);
  const resultado = await validarOperacao(pilotPath, snapshot, {
    id: 'op-2',
    dominio: 'ativos',
    operacao: 'BaixaAtivo',
    fatos: [
      { propriedade: 'estadoAtual', valor: 'EmUso', determinacao: 'observado', origem: 'diff' },
      { propriedade: 'motivoBaixa', valor: 'Desgaste irreversível comprovado', determinacao: 'observado', origem: 'diff' },
    ],
    proveniencia: { origem: 'diff', descricao: 'Teste de baixa' },
    alteracoesRelacionadas: [],
  });
  assert.equal(resultado.status, 'revisao_humana');
  assert.equal(resultado.requerRevisaoHumana, true);
});

// =============================================================================
// 12. Estado Indeterminado (validadorSemantico)
// =============================================================================

test('Given an operation with mandatory property marked indeterminado, when validated semantically, then status is indeterminado', async () => {
  const snapshot = await createOntologySnapshot(pilotPath);
  const resultado = await validarOperacao(pilotPath, snapshot, {
    id: 'op-3',
    dominio: 'ativos',
    operacao: 'TransferenciaAtivo',
    fatos: [
      { propriedade: 'estadoAtual', valor: null, determinacao: 'indeterminado', origem: 'diff' },
      { propriedade: 'novoResponsavel', valor: 'Ana', determinacao: 'observado', origem: 'diff' },
      { propriedade: 'novaLocalizacao', valor: 'Recife', determinacao: 'observado', origem: 'diff' },
    ],
    proveniencia: { origem: 'diff', descricao: 'Teste fato indeterminado' },
    alteracoesRelacionadas: [],
  });
  assert.equal(resultado.status, 'indeterminado');
  assert.ok(resultado.evidencia.some(e => e.includes('indeterminado')));
});

// =============================================================================
// 13. Regras SHACL-SPARQL (shacl-engine + Comunica)
// =============================================================================

test('Given a transfer where new responsible belongs to destination department, when checked with SHACL-SPARQL, then it conforms', async () => {
  const report = await check(`
    ex:Ana a ex:Responsavel ; ex:lotadoEmDepartamento ex:DeptoTI .
    ex:transf a ex:TransferenciaAtivo ;
      ex:estadoAtual ex:Disponivel ;
      ex:novoResponsavel ex:Ana ;
      ex:departamentoDestino ex:DeptoTI ;
      ex:novaLocalizacao "Recife" .
  `);
  assert.equal(report.conforms, true);
});

test('Given a transfer where new responsible does not belong to destination department, when checked with SHACL-SPARQL, then SHACL reports organizational incompatibility', async () => {
  const report = await check(`
    ex:Ana a ex:Responsavel ; ex:lotadoEmDepartamento ex:DeptoTI .
    ex:transf a ex:TransferenciaAtivo ;
      ex:estadoAtual ex:Disponivel ;
      ex:novoResponsavel ex:Ana ;
      ex:departamentoDestino ex:DeptoFinanceiro ;
      ex:novaLocalizacao "Recife" .
  `);
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('departamento de destino')));
});

test('Given a retirement with positive residual value and technical report, when checked with SHACL-SPARQL, then it conforms', async () => {
  const report = await check(`
    ex:b a ex:BaixaAtivo ;
      ex:estadoAtual ex:EmUso ;
      ex:motivoBaixa "Sucateamento" ;
      ex:valorResidual 4500.00 ;
      ex:laudoTecnicoDescarte "Laudo pericial #44" .
  `);
  assert.equal(report.conforms, true);
});

test('Given a retirement with positive residual value but missing technical report, when checked with SHACL-SPARQL, then SHACL rejects missing report', async () => {
  const report = await check(`
    ex:b a ex:BaixaAtivo ;
      ex:estadoAtual ex:EmUso ;
      ex:motivoBaixa "Sucateamento" ;
      ex:valorResidual 4500.00 .
  `);
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('laudo técnico de descarte')));
});
