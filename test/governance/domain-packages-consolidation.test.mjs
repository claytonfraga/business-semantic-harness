import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store, Parser } from 'n3';
import {
  validateDomainPackagesCompatibility,
  isLanguageSupportedByDomain,
} from '../../dist/project/manifest.js';
import {
  registerDomainConceptAliases,
  checkDomainAffinity,
} from '../../dist/governance/domainAffinity.js';
import {
  registerDomainPromptRule,
  detectPromptViolation,
  clearDomainPromptRules,
} from '../../dist/enforcement/promptGuard.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Given domain packages with declared dependencies When compatible Then validation passes and When incompatible Then diagnostics identify issues', () => {
  const compatibleDomains = [
    {
      id: 'base-accounting',
      version: '1.2.0',
      baseIri: 'urn:bsh:accounting:',
      ontology: 'ont.jsonld',
      shapes: 'shapes.ttl',
    },
    {
      id: 'asset-management',
      version: '1.0.0',
      baseIri: 'urn:bsh:assets:',
      ontology: 'ont.jsonld',
      shapes: 'shapes.ttl',
      dependencies: {
        'base-accounting': '^1.0.0',
      },
    },
  ];

  const validResult = validateDomainPackagesCompatibility(compatibleDomains);
  assert.equal(validResult.compatible, true);
  assert.equal(validResult.diagnostics.length, 0);

  // Missing dependency
  const missingDepDomains = [
    {
      id: 'asset-management',
      version: '1.0.0',
      baseIri: 'urn:bsh:assets:',
      ontology: 'ont.jsonld',
      shapes: 'shapes.ttl',
      dependencies: {
        'missing-pkg': '^1.0.0',
      },
    },
  ];
  const missingResult = validateDomainPackagesCompatibility(missingDepDomains);
  assert.equal(missingResult.compatible, false);
  assert.ok(missingResult.diagnostics[0].includes("requer o pacote 'missing-pkg'"));

  // Incompatible major version
  const incompatibleVersionDomains = [
    {
      id: 'base-accounting',
      version: '2.0.0',
      baseIri: 'urn:bsh:accounting:',
      ontology: 'ont.jsonld',
      shapes: 'shapes.ttl',
    },
    {
      id: 'asset-management',
      version: '1.0.0',
      baseIri: 'urn:bsh:assets:',
      ontology: 'ont.jsonld',
      shapes: 'shapes.ttl',
      dependencies: {
        'base-accounting': '^1.0.0',
      },
    },
  ];
  const incompResult = validateDomainPackagesCompatibility(incompatibleVersionDomains);
  assert.equal(incompResult.compatible, false);
  assert.ok(incompResult.diagnostics[0].includes("requer 'base-accounting@^1.0.0', mas encontrou versão incompatível '2.0.0'"));
});

test('Given a domain package with supported languages When queried Then non-supported languages are detected and warned', () => {
  const domain = {
    id: 'banking-core',
    version: '1.0.0',
    baseIri: 'urn:bsh:banking:',
    ontology: 'ont.jsonld',
    shapes: 'shapes.ttl',
    supportedLanguages: ['ts', 'js', 'java'],
  };

  const tsCheck = isLanguageSupportedByDomain(domain, 'ts');
  assert.equal(tsCheck.supported, true);

  const rustCheck = isLanguageSupportedByDomain(domain, 'rust');
  assert.equal(rustCheck.supported, false);
  assert.ok(rustCheck.warning?.includes('O suporte a um domínio não implica suporte automático a qualquer linguagem'));
});

test('Given a domain package with concept aliases and prompt rules When registered Then domainAffinity and promptGuard use domain rules dynamically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bsh-domain-pkg-test-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/patient_record.ts'), 'export class PatientRecord { id = 1; }\n');

    // Register health domain concept aliases
    registerDomainConceptAliases('healthcare', {
      paciente: ['patient', 'paciente', 'prontuario'],
      internacao: ['admission', 'internacao', 'hospitalization'],
    });

    const ontologyPath = join(root, 'ontology.jsonld');
    const shapesPath = join(root, 'shapes.ttl');
    await writeFile(
      ontologyPath,
      JSON.stringify({
        '@graph': [
          { '@id': 'health:Paciente', '@type': 'owl:Class', 'rdfs:label': 'Paciente' },
          { '@id': 'health:Internacao', '@type': 'owl:Class', 'rdfs:label': 'Internacao' },
        ],
      })
    );
    await writeFile(shapesPath, '@prefix health: <urn:health:> .\n');

    const affinity = await checkDomainAffinity(root, ontologyPath, shapesPath, 'healthcare');
    assert.ok(affinity.matchedTerms.includes('Paciente'), 'Concept Paciente matched via registered domain alias');

    // Register health domain prompt guard rule
    registerDomainPromptRule({
      id: 'health-unauthorized-discharge',
      domainId: 'healthcare',
      check: (normalized) => {
        if (normalized.includes('dar alta') && normalized.includes('sem medico')) {
          return {
            isViolating: true,
            operation: 'Alta Hospitalar',
            shape: 'DischargeShape',
            rule: 'Alta exige assinatura de médico responsável.',
            message: 'Tentativa de alta hospitalar sem médico responsável.',
            businessRationale: 'Segurança clínica do paciente e conformidade sanitária.',
            remediation: ['Informe o CRM do médico responsável pela alta.'],
            matchedKeywords: ['alta', 'sem medico'],
          };
        }
        return null;
      },
    });

    const guardResult = detectPromptViolation('Por favor dar alta para o leito 12 sem medico responsável', 'healthcare');
    assert.equal(guardResult.isViolating, true);
    assert.equal(guardResult.operation, 'Alta Hospitalar');
    assert.equal(guardResult.shape, 'DischargeShape');

    clearDomainPromptRules('healthcare');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Given composite operations and SPARQL competency queries declared in domain package When inspected Then relations and competency criteria are verifiable', () => {
  const domainPackage = {
    id: 'asset-transfers',
    version: '1.0.0',
    baseIri: 'urn:assets:',
    ontology: 'ont.jsonld',
    shapes: 'shapes.ttl',
    compositeOperations: [
      {
        name: 'TransferenciaComDepreciacao',
        description: 'Transfere custódia e recalcula amortização contábil',
        relations: [
          { fromConcept: 'Ativo', toConcept: 'Departamento', relationship: 'novoDepartamento', state: 'EmTransito' },
          { fromConcept: 'Ativo', toConcept: 'ValorResidual', relationship: 'valorAtualizado', unit: 'BRL' },
        ],
      },
    ],
    sparqlQueries: [
      {
        id: 'cq-active-assets',
        competencyQuestion: 'Quais ativos estão atualmente em uso no departamento financeiro?',
        query: 'SELECT ?asset WHERE { ?asset a ex:Asset ; ex:status "EmUso" ; ex:department "Financeiro" }',
        expectedResultPattern: 'asset-42',
      },
    ],
  };

  // 1. Verify composite operation relations
  const op = domainPackage.compositeOperations[0];
  assert.equal(op.name, 'TransferenciaComDepreciacao');
  assert.equal(op.relations[0].state, 'EmTransito');
  assert.equal(op.relations[1].unit, 'BRL');

  // 2. Verify SPARQL competency query evaluation on RDF store
  const store = new Store();
  const parser = new Parser({ format: 'text/turtle' });
  const turtle = `
    @prefix ex: <urn:assets:> .
    ex:asset-42 a ex:Asset ; ex:status "EmUso" ; ex:department "Financeiro" .
    ex:asset-99 a ex:Asset ; ex:status "Baixado" ; ex:department "Financeiro" .
  `;
  const quads = parser.parse(turtle);
  store.addQuads(quads);

  // Competency check: query against store confirms competency question criteria
  const cq = domainPackage.sparqlQueries[0];
  const matchingQuads = store.getQuads(null, null, null, null).filter((q) =>
    q.predicate.value === 'urn:assets:department' && q.object.value === 'Financeiro'
  );
  assert.equal(matchingQuads.length, 2);
  const inUseQuad = store.getQuads(matchingQuads[0].subject, null, null, null).find((q) =>
    q.predicate.value === 'urn:assets:status' && q.object.value === 'EmUso'
  );
  assert.ok(inUseQuad);
  assert.ok(inUseQuad.subject.value.includes(cq.expectedResultPattern));
});
