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

test('Given the pilot transfer shape When a valid transfer graph is checked Then it conforms', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-valid.ttl'));
  assert.equal(report.conforms, true);
});

test('Given a retired asset When its transfer graph is checked Then SHACL rejects its state', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-retired.ttl'));
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('baixado')));
});

test('Given no new responsible When a transfer graph is checked Then SHACL reports the missing fact', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/transfer-no-responsible.ttl'));
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('responsável')));
});

test('Given no new location When a transfer graph is checked Then SHACL reports the missing location', async () => {
  const report = await check('ex:a a ex:TransferenciaAtivo; ex:estadoAtual ex:EmUso; ex:novoResponsavel ex:Ana .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('localização')));
});

test('Given an active asset and a retirement reason When its retirement graph is checked Then SHACL conforms', async () => {
  const report = await check('ex:a a ex:BaixaAtivo; ex:estadoAtual ex:EmUso; ex:motivoBaixa "Irrecuperável" .');
  assert.equal(report.conforms, true);
});

test('Given no retirement reason When a retirement graph is checked Then SHACL reports the missing reason', async () => {
  const report = await check('ex:a a ex:BaixaAtivo; ex:estadoAtual ex:EmUso .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('motivo')));
});

test('Given a retired asset When another retirement graph is checked Then SHACL rejects the terminal state', async () => {
  const report = await check('ex:a a ex:BaixaAtivo; ex:estadoAtual ex:Baixado; ex:motivoBaixa "Outra" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('nova baixa')));
});

test('Given a retired asset When a responsible change graph is checked Then SHACL rejects the terminal state', async () => {
  const report = await check('ex:a a ex:AlteracaoResponsavel; ex:estadoAtual ex:Baixado; ex:novoResponsavel ex:Ana .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('responsável')));
});

test('Given a retired asset When a location change graph is checked Then SHACL rejects the terminal state', async () => {
  const report = await check('ex:a a ex:AtualizacaoLocalizacao; ex:estadoAtual ex:Baixado; ex:novaLocalizacao "Recife" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('localização')));
});

test('Given domain baseline entities fixture When checked against shapes Then they conform', async () => {
  const report = await validateData(await graph('.bsh/domains/ativos/shapes.ttl'), await graph('evaluation/fixtures/ativos-cenarios.ttl'));
  assert.equal(report.conforms, true);
});

// =============================================================================
// 2. Padronização de Identificação Patrimonial
// =============================================================================

test('Given a valid patrimonial code When checked against identification shape Then it conforms', async () => {
  const report = await check('ex:item a ex:Ativo ; ex:codigoPatrimonio "PAT-000123" .');
  assert.equal(report.conforms, true);
});

test('Given an invalid patrimonial code format When checked against identification shape Then SHACL rejects the pattern', async () => {
  const report = await check('ex:item a ex:Ativo ; ex:codigoPatrimonio "PAT-99" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('PAT-NNNNNN')));
});

test('Given an asset with no patrimonial code When checked against identification shape Then SHACL reports missing code', async () => {
  const report = await check('ex:item a ex:Ativo ; ex:descricao "Cadeira sem plaqueta" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('PAT-NNNNNN')));
});

// =============================================================================
// 3. Tipagem de Ativos (TI e Veículos)
// =============================================================================

test('Given an IT asset with serial number and patrimonial code When checked Then it conforms', async () => {
  const report = await check('ex:item a ex:AtivoTI ; ex:codigoPatrimonio "PAT-000124" ; ex:numeroSerie "SN-987654" .');
  assert.equal(report.conforms, true);
});

test('Given an IT asset missing serial number When checked Then SHACL rejects the missing serial number', async () => {
  const report = await check('ex:item a ex:AtivoTI ; ex:codigoPatrimonio "PAT-000125" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('número de série')));
});

test('Given a vehicle with valid plate, renavam, chassi and code When checked Then it conforms', async () => {
  const report = await check('ex:car a ex:AtivoVeiculo ; ex:codigoPatrimonio "PAT-000302" ; ex:placa "ABC1D23" ; ex:renavam "12345678901" ; ex:chassi "9BWCA4110FP000002" .');
  assert.equal(report.conforms, true);
});

test('Given a vehicle with invalid plate When checked Then SHACL rejects the plate format', async () => {
  const report = await check('ex:car a ex:AtivoVeiculo ; ex:codigoPatrimonio "PAT-000303" ; ex:placa "PLACA-INVALIDA" ; ex:renavam "12345678901" ; ex:chassi "9BWCA4110FP000003" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('placa')));
});

// =============================================================================
// 4. Segregação de Funções na Transferência
// =============================================================================

test('Given distinct requester and approver When checked against segregation rule Then it conforms', async () => {
  const report = await check('ex:t a ex:TransferenciaAtivo ; ex:estadoAtual ex:Disponivel ; ex:novoResponsavel ex:Ana ; ex:novaLocalizacao "SP" ; ex:solicitante ex:Carlos ; ex:aprovador ex:Beatriz .');
  assert.equal(report.conforms, true);
});

test('Given identical requester and approver When checked against segregation rule Then SHACL rejects with exact violation message', async () => {
  const report = await check('ex:t a ex:TransferenciaAtivo ; ex:estadoAtual ex:Disponivel ; ex:novoResponsavel ex:Ana ; ex:novaLocalizacao "SP" ; ex:solicitante ex:Carlos ; ex:aprovador ex:Carlos .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('O solicitante da transferência não pode ser o aprovador da movimentação.')));
});

// =============================================================================
// 5. Ciclo de Vida: Alocação a Usuário
// =============================================================================

test('Given an available asset with signed responsibility term When allocated Then it conforms', async () => {
  const report = await check('ex:Lucas ex:lotadoEmDepartamento ex:DeptoTI . ex:op a ex:AlocacaoUsuario ; ex:estadoAtual ex:Disponivel ; ex:novoResponsavel ex:Lucas ; ex:termoResponsabilidadeAssinado true .');
  assert.equal(report.conforms, true);
});

test('Given an asset in maintenance When allocation is attempted Then SHACL rejects the state', async () => {
  const report = await check('ex:op a ex:AlocacaoUsuario ; ex:estadoAtual ex:EmManutencao ; ex:novoResponsavel ex:Lucas ; ex:termoResponsabilidadeAssinado true .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('manutenção')));
});

test('Given an available asset without signed term When allocation is attempted Then SHACL rejects missing signed term', async () => {
  const report = await check('ex:op a ex:AlocacaoUsuario ; ex:estadoAtual ex:Disponivel ; ex:novoResponsavel ex:Lucas ; ex:termoResponsabilidadeAssinado false .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('termo de responsabilidade')));
});

// =============================================================================
// 6. Ciclo de Vida: Reserva de Ativos
// =============================================================================

test('Given an available asset with complete reservation parameters When checked Then it conforms', async () => {
  const report = await check('ex:res a ex:ReservaAtivo ; ex:estadoAtual ex:Disponivel ; ex:solicitanteReserva ex:Carla ; ex:dataInicioReserva "2026-10-01"^^xsd:date ; ex:dataFimReserva "2026-10-15"^^xsd:date ; ex:motivoReserva "Auditoria" .');
  assert.equal(report.conforms, true);
});

test('Given an asset in maintenance When reservation is attempted Then SHACL rejects the state', async () => {
  const report = await check('ex:res a ex:ReservaAtivo ; ex:estadoAtual ex:EmManutencao ; ex:solicitanteReserva ex:Carla ; ex:dataInicioReserva "2026-10-01"^^xsd:date ; ex:dataFimReserva "2026-10-15"^^xsd:date ; ex:motivoReserva "Auditoria" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('disponível')));
});

// =============================================================================
// 7. Ciclo de Vida: Manutenção e Calibração
// =============================================================================

test('Given an asset in maintenance with technical report When maintenance conclusion is checked Then it conforms', async () => {
  const report = await check('ex:fim a ex:ConclusaoManutencao ; ex:estadoAtual ex:EmManutencao ; ex:laudoManutencao "Laudo técnico #881" .');
  assert.equal(report.conforms, true);
});

test('Given an available asset When maintenance conclusion is checked without being in maintenance Then SHACL rejects', async () => {
  const report = await check('ex:fim a ex:ConclusaoManutencao ; ex:estadoAtual ex:Disponivel ; ex:laudoManutencao "Laudo #881" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('Conclusão de manutenção')));
});

test('Given equipment with up-to-date maintenance When checked Then it conforms', async () => {
  const report = await check('ex:eq a ex:AtivoEquipamento ; ex:codigoPatrimonio "PAT-000502" ; ex:statusManutencao ex:EmDia .');
  assert.equal(report.conforms, true);
});

test('Given equipment with expired maintenance When checked Then SHACL rejects expired status', async () => {
  const report = await check('ex:eq a ex:AtivoEquipamento ; ex:codigoPatrimonio "PAT-000503" ; ex:statusManutencao ex:Vencida .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('manutenção periódica vencida')));
});

test('Given instrumentation asset with valid calibration and certificate When checked Then it conforms', async () => {
  const report = await check('ex:inst a ex:AtivoInstrumentacao ; ex:codigoPatrimonio "PAT-000602" ; ex:statusCalibracao ex:CalibracaoEmDia ; ex:certificadoCalibracao "CERT-2026" .');
  assert.equal(report.conforms, true);
});

test('Given instrumentation asset with expired calibration When checked Then SHACL rejects expired status', async () => {
  const report = await check('ex:inst a ex:AtivoInstrumentacao ; ex:codigoPatrimonio "PAT-000603" ; ex:statusCalibracao ex:CalibracaoVencida ; ex:certificadoCalibracao "CERT-2026" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('calibração vencida')));
});

// =============================================================================
// 8. Ciclo de Vida: Movimentação (Envio e Recebimento)
// =============================================================================

test('Given asset shipping with distinct origin and destination When checked Then it conforms', async () => {
  const report = await check('ex:env a ex:EnvioAtivo ; ex:estadoAtual ex:Disponivel ; ex:origem "Matriz-SP" ; ex:destino "Filial-RJ" ; ex:transportador "Expresso" .');
  assert.equal(report.conforms, true);
});

test('Given asset shipping where origin equals destination When checked Then SHACL rejects identical locations', async () => {
  const report = await check('ex:env a ex:EnvioAtivo ; ex:estadoAtual ex:Disponivel ; ex:origem "Matriz-SP" ; ex:destino "Matriz-SP" ; ex:transportador "Expresso" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('origem distinta da localização de destino')));
});

test('Given asset receiving for asset in transit with reference When checked Then it conforms', async () => {
  const report = await check('ex:rec a ex:RecebimentoAtivo ; ex:estadoAtual ex:EmTransito ; ex:movimentacaoReferenciada "DOC-2026-001" .');
  assert.equal(report.conforms, true);
});

test('Given asset receiving for asset not in transit When checked Then SHACL rejects the state', async () => {
  const report = await check('ex:rec a ex:RecebimentoAtivo ; ex:estadoAtual ex:Disponivel ; ex:movimentacaoReferenciada "DOC-2026-001" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('trânsito')));
});

// =============================================================================
// 9. Ciclo de Vida: Extravio e Recuperação
// =============================================================================

test('Given loss registration with valid incident protocol When checked Then it conforms', async () => {
  const report = await check('ex:loss a ex:RegistroExtravio ; ex:estadoAtual ex:EmUso ; ex:protocoloSinistro "SIN-2026/001234" .');
  assert.equal(report.conforms, true);
});

test('Given loss registration with malformed incident protocol When checked Then SHACL rejects the format', async () => {
  const report = await check('ex:loss a ex:RegistroExtravio ; ex:estadoAtual ex:EmUso ; ex:protocoloSinistro "SIN-123" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('SIN-AAAA/NNNNNN')));
});

test('Given recovery operation on lost asset with recovery report When checked Then it conforms', async () => {
  const report = await check('ex:rec a ex:RecuperacaoAtivo ; ex:estadoAtual ex:Extraviado ; ex:laudoRecuperacao "Laudo de devolução #99" .');
  assert.equal(report.conforms, true);
});

test('Given recovery operation on asset not lost When checked Then SHACL rejects the state', async () => {
  const report = await check('ex:rec a ex:RecuperacaoAtivo ; ex:estadoAtual ex:Disponivel ; ex:laudoRecuperacao "Laudo #99" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('Extraviado')));
});

// =============================================================================
// 10. Auditoria e Rastreabilidade
// =============================================================================

test('Given an audited patrimonial event with registeredBy and valid dateTime When checked Then it conforms', async () => {
  const report = await check('ex:audit a ex:EventoPatrimonial ; ex:registradoPor "usuario.auditor" ; ex:dataHoraRegistro "2026-09-24T18:00:00Z"^^xsd:dateTime .');
  assert.equal(report.conforms, true);
});

test('Given an audited patrimonial event missing registeredBy When checked Then SHACL rejects missing fact', async () => {
  const report = await check('ex:audit a ex:EventoPatrimonial ; ex:dataHoraRegistro "2026-09-24T18:00:00Z"^^xsd:dateTime .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('usuário que registrou')));
});

test('Given an audited patrimonial event with invalid dateTime datatype When checked Then SHACL rejects datatype', async () => {
  const report = await check('ex:audit a ex:EventoPatrimonial ; ex:registradoPor "usuario.auditor" ; ex:dataHoraRegistro "ontem" .');
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('xsd:dateTime')));
});

// =============================================================================
// 11. Governança e Políticas Humanas (validadorSemantico)
// =============================================================================

test('Given an operation governed by human review policy When validated semantically Then status is revisao_humana', async () => {
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

test('Given a retirement operation governed by human policy When validated semantically Then status is revisao_humana', async () => {
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

test('Given an operation with mandatory property marked indeterminado When validated semantically Then status is indeterminado', async () => {
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

test('Given a transfer where new responsible belongs to destination department When checked with SHACL-SPARQL Then it conforms', async () => {
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

test('Given a transfer where new responsible does not belong to destination department When checked with SHACL-SPARQL Then SHACL reports organizational incompatibility', async () => {
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

test('Given a retirement with positive residual value and technical report When checked with SHACL-SPARQL Then it conforms', async () => {
  const report = await check(`
    ex:b a ex:BaixaAtivo ;
      ex:estadoAtual ex:EmUso ;
      ex:motivoBaixa "Sucateamento" ;
      ex:valorResidual 4500.00 ;
      ex:laudoTecnicoDescarte "Laudo pericial #44" .
  `);
  assert.equal(report.conforms, true);
});

test('Given a retirement with positive residual value but missing technical report When checked with SHACL-SPARQL Then SHACL rejects missing report', async () => {
  const report = await check(`
    ex:b a ex:BaixaAtivo ;
      ex:estadoAtual ex:EmUso ;
      ex:motivoBaixa "Sucateamento" ;
      ex:valorResidual 4500.00 .
  `);
  assert.equal(report.conforms, false);
  assert.ok(report.results.some(item => item.message.includes('laudo técnico de descarte')));
});
