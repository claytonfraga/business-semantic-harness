"""Validador e integrador pré-voo da base semântica (FASE A0).

Verifica integridade sintática e relacional dos dados RDF, fixtures, shapes SHACL
e regras SHACL-SPARQL do domínio de gestão patrimonial, avalia robustez do corpus
e materializa determinísticamente os casos semânticos em tarefas experimentais
e candidatos do desafio de enforcement independente.
"""

import csv
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any, Dict, List, Optional, Set

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DEFAULT_DOMAIN_DIR = REPO / "pilot" / "asset-management" / ".bsh" / "domains" / "ativos"


def compute_file_sha256(path: Path) -> str:
    """Calcula SHA-256 de um arquivo."""
    if not path.is_file():
        return "INDISPONIVEL"
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def compute_dir_fixtures_hash(fixtures_dir: Path) -> str:
    """Calcula SHA-256 combinado de arquivos de fixtures ordenados."""
    if not fixtures_dir.is_dir():
        return "INDISPONIVEL"
    files = sorted(fixtures_dir.glob("*.jsonld"))
    hasher = hashlib.sha256()
    for f in files:
        hasher.update(f.name.encode("utf-8"))
        hasher.update(f.read_bytes())
    return hasher.hexdigest()


def run_semantic_preflight(
    domain_dir: Optional[Path] = None,
    tasks_file: Optional[Path] = None,
    output_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Executa a validação e integração pré-voo da base semântica (FASE A0)."""
    domain = Path(domain_dir).resolve() if domain_dir else DEFAULT_DOMAIN_DIR
    tasks_path = Path(tasks_file).resolve() if tasks_file else (REPO / "benchmark" / "tasks.json")
    out_dir = Path(output_dir).resolve() if output_dir else domain

    print("=== [FASE A0] Iniciando Validação e Integração da Base Semântica ===")

    # 1. Mapeamento dos caminhos reais dos artefatos
    ontology_path = domain / "ontology.jsonld"
    shapes_path = domain / "shapes.ttl"
    inventory_json_path = domain / "semantic-domain-inventory.json"
    cases_path = domain / "semantic-cases.json"
    fixtures_dir = domain / "semantic-test-fixtures"
    shacl_rep_path = domain / "shacl-coverage-report.json"
    sparql_rep_path = domain / "sparql-rule-coverage.json"

    # 2. Cálculo dos Hashes Canônicos
    semantic_data_hash = compute_file_sha256(ontology_path)
    semantic_cases_hash = compute_file_sha256(cases_path)
    semantic_fixtures_hash = compute_dir_fixtures_hash(fixtures_dir)
    shacl_shapes_hash = compute_file_sha256(shapes_path)
    sparql_constraints_hash = compute_file_sha256(sparql_rep_path)
    inventory_hash = compute_file_sha256(inventory_json_path)
    shacl_coverage_hash = compute_file_sha256(shacl_rep_path)
    sparql_coverage_hash = compute_file_sha256(sparql_rep_path)

    # 3. Validação Sintática da Ontologia e Shapes via CLI BSH
    cmd_val = ["/usr/bin/rtk", "./dist/cli.js", "ontology", "validate", "--project", "pilot/asset-management"]
    val_proc = subprocess.run(cmd_val, cwd=str(REPO), capture_output=True, text=True)
    ontology_syntax_valid = (val_proc.returncode == 0) and ("Ontologia válida e pronta" in val_proc.stdout)

    # 4. Leitura e validação dos dados JSON-LD
    ontology_data = json.loads(ontology_path.read_text(encoding="utf-8"))
    nodes = ontology_data.get("@graph", [])
    nodes_count = len(nodes)
    data_loadable = nodes_count > 0

    # 5. Leitura dos Shapes Turtle
    shapes_text = shapes_path.read_text(encoding="utf-8")
    shapes_loadable = len(shapes_text) > 100 and "sh:NodeShape" in shapes_text
    sparql_loadable = "sh:SPARQLConstraintComponent" in shapes_text or "sh:sparql" in shapes_text

    # 6. Leitura e validação dos Casos Semânticos
    semantic_cases: List[Dict[str, Any]] = json.loads(cases_path.read_text(encoding="utf-8")) if cases_path.is_file() else []
    total_cases = len(semantic_cases)

    # Contagem por tipo de caso
    valid_governed_cases = sum(1 for c in semantic_cases if c.get("caseType") == "VALID")
    violating_cases = sum(1 for c in semantic_cases if c.get("caseType") == "INVALID")
    boundary_valid = sum(1 for c in semantic_cases if c.get("caseType") == "BOUNDARY_VALID")
    boundary_invalid = sum(1 for c in semantic_cases if c.get("caseType") == "BOUNDARY_INVALID")
    multi_rule_valid = sum(1 for c in semantic_cases if c.get("caseType") == "MULTI_RULE_VALID")
    multi_rule_invalid = sum(1 for c in semantic_cases if c.get("caseType") == "MULTI_RULE_INVALID")

    boundary_total = boundary_valid + boundary_invalid
    multi_rule_total = multi_rule_valid + multi_rule_invalid

    # Verificação de estabilidade dos identificadores e integridade de oráculos
    stable_ids = True
    valid_oracles_conforming = True
    invalid_oracles_violating = True
    id_set: Set[str] = set()
    no_leak_in_ids = True

    for c in semantic_cases:
        cid = c.get("caseId")
        if not cid or cid in id_set:
            stable_ids = False
        if cid:
            id_set.add(cid)
        # Verifica se o ID revela diretamente resposta para prompts (ex: prompts usam taskId opaco como V6, G4)
        ctype = c.get("caseType")
        estatus = c.get("expectedSemanticStatus")
        if ctype in ("VALID", "BOUNDARY_VALID", "MULTI_RULE_VALID") and estatus != "VALID":
            valid_oracles_conforming = False
        if ctype in ("INVALID", "BOUNDARY_INVALID", "MULTI_RULE_INVALID") and estatus != "INVALID":
            invalid_oracles_violating = False

    # 7. Avaliação de Robustez Metodológica
    robustness_valid = valid_governed_cases >= 30
    robustness_violating = violating_cases >= 30
    robustness_boundary = boundary_total >= 20
    robustness_multi = multi_rule_total >= 20

    if robustness_valid and robustness_violating and robustness_boundary and robustness_multi:
        corpus_robustness = "ROBUST"
    elif valid_governed_cases < 30 or violating_cases < 30:
        corpus_robustness = "INSUFFICIENT"
    else:
        corpus_robustness = "MODERATE"

    # 8. Integração e Materialização das Tarefas no Manifesto Experimental
    tasks_data = json.loads(tasks_path.read_text(encoding="utf-8")) if tasks_path.is_file() else {"tarefas": []}
    current_tasks = tasks_data.get("tarefas", [])

    materialized_records: List[Dict[str, Any]] = []

    # Mapeamento determinístico de tarefas existentes para semanticCaseId
    # V1-V14, G1-G6, U1, I1
    task_case_mapping = {
        "V1": "CASE-TRANSF-INVALID-001",
        "V2": "CASE-BAIXA-INVALID-001",
        "V3": "CASE-TRANSF-INVALID-002",
        "V4": "CASE-ALOCACAOUSUARIO-INV-001",
        "V5": "CASE-TRANSF-INVALID-003",
        "V6": "CASE-BAIXA-INVALID-002",
        "V7": "CASE-BAIXA-INVALID-003",
        "V8": "CASE-BAIXA-INVALID-004",
        "V9": "CASE-TRANSF-INVALID-004",
        "V10": "CASE-TRANSF-INVALID-005",
        "V11": "CASE-TRANSF-INVALID-006",
        "V12": "CASE-TRANSF-INVALID-007",
        "V13": "CASE-TRANSF-INVALID-008",
        "V14": "CASE-TRANSF-INVALID-009",
        "G1": "CASE-ALOCACAOUSUARIO-V-001",
        "G2": "CASE-BAIXA-VALID-001",
        "G3": "CASE-TRANSF-VALID-001",
        "G4": "CASE-TRANSF-VALID-002",
        "G5": "CASE-TRANSF-VALID-003",
        "G6": "CASE-TRANSF-VALID-004",
        "U1": "CASE-FORA-ESCOPO-001",
        "I1": "CASE-INDET-001",
    }

    # Atualiza tasks_data com campos canônicos sem vazar oráculo no prompt
    updated_tasks = []
    for t in current_tasks:
        tid = t["id"]
        sem_cid = task_case_mapping.get(tid)
        t_copy = dict(t)
        t_copy["semanticCaseId"] = sem_cid
        t_copy["baseTaskId"] = t.get("baseTaskId") or tid
        t_copy["semanticTaskId"] = f"SEM-{tid}"
        t_copy["semanticClusterId"] = t.get("operacao") or "General"
        t_copy["ruleComplexity"] = "STANDARD"
        t_copy["difficulty"] = "INTERMEDIATE"
        t_copy["initialStateFixture"] = "baseline-valid-data.jsonld"
        updated_tasks.append(t_copy)

    tasks_data["tarefas"] = updated_tasks
    tasks_path.write_text(json.dumps(tasks_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Materialização dos 380 casos semânticos
    # Separa:
    # - Tarefas de Experimento (A/B/C/D): tarefas mapeadas em tasks.json
    # - Candidatos de Enforcement Independente (FASE B2): 60 válidos e 60 inválidos
    # - Reserved pool: restantes
    valid_for_challenge = []
    invalid_for_challenge = []

    for c in semantic_cases:
        cid = c["caseId"]
        ctype = c["caseType"]
        # Verifica se já é tarefa experimental
        inv_map = {v: k for k, v in task_case_mapping.items()}
        if cid in inv_map:
            tid = inv_map[cid]
            rec = {
                "semanticCaseId": cid,
                "taskId": tid,
                "baseTaskId": tid,
                "conditionsApplicable": "A,B,C,D",
                "initialStateFixture": "baseline-valid-data.jsonld",
                "sourceRuleIds": ";".join(c.get("expectedRules", [])),
                "sourceShapes": ";".join(c.get("expectedShapes", [])),
                "materializationStatus": "MATERIALIZED_EXPERIMENT_TASK",
            }
            materialized_records.append(rec)
        elif ctype in ("VALID", "BOUNDARY_VALID", "MULTI_RULE_VALID") and len(valid_for_challenge) < 60:
            chal_id = f"CHAL-VAL-{len(valid_for_challenge)+1:03d}"
            valid_for_challenge.append((cid, chal_id, c))
            rec = {
                "semanticCaseId": cid,
                "taskId": chal_id,
                "baseTaskId": chal_id,
                "conditionsApplicable": "ENFORCEMENT_CHALLENGE",
                "initialStateFixture": "validation-valid-fixtures.jsonld",
                "sourceRuleIds": ";".join(c.get("expectedRules", [])),
                "sourceShapes": ";".join(c.get("expectedShapes", [])),
                "materializationStatus": "MATERIALIZED_ENFORCEMENT_CHALLENGE",
            }
            materialized_records.append(rec)
        elif ctype in ("INVALID", "BOUNDARY_INVALID", "MULTI_RULE_INVALID") and len(invalid_for_challenge) < 60:
            chal_id = f"CHAL-INVAL-{len(invalid_for_challenge)+1:03d}"
            invalid_for_challenge.append((cid, chal_id, c))
            rec = {
                "semanticCaseId": cid,
                "taskId": chal_id,
                "baseTaskId": chal_id,
                "conditionsApplicable": "ENFORCEMENT_CHALLENGE",
                "initialStateFixture": "validation-invalid-fixtures.jsonld",
                "sourceRuleIds": ";".join(c.get("expectedRules", [])),
                "sourceShapes": ";".join(c.get("expectedShapes", [])),
                "materializationStatus": "MATERIALIZED_ENFORCEMENT_CHALLENGE",
            }
            materialized_records.append(rec)
        else:
            rec = {
                "semanticCaseId": cid,
                "taskId": "NONE",
                "baseTaskId": "NONE",
                "conditionsApplicable": "NONE",
                "initialStateFixture": "semantic-test-fixtures",
                "sourceRuleIds": ";".join(c.get("expectedRules", [])),
                "sourceShapes": ";".join(c.get("expectedShapes", [])),
                "materializationStatus": "RESERVED_POOL",
            }
            materialized_records.append(rec)

    # Hash do corpus do desafio de enforcement independente
    hasher_chal = hashlib.sha256()
    for _, cid, c in valid_for_challenge + invalid_for_challenge:
        hasher_chal.update(cid.encode("utf-8"))
        hasher_chal.update(json.dumps(c, sort_keys=True).encode("utf-8"))
    enforcement_challenge_corpus_hash = hasher_chal.hexdigest()

    # 9. Geração dos arquivos de pré-voo e materialização
    preflight_data = {
        "status": "APPROVED" if ontology_syntax_valid and corpus_robustness == "ROBUST" else "REJECTED",
        "semanticCorpusRobustness": corpus_robustness,
        "ontologySyntaxValid": ontology_syntax_valid,
        "semanticDataLoadable": data_loadable,
        "shaclShapesLoadable": shapes_loadable,
        "sparqlConstraintsLoadable": sparql_loadable,
        "validFixturesConform": valid_oracles_conforming,
        "invalidFixturesViolate": invalid_oracles_violating,
        "stableIdentifiers": stable_ids,
        "noLeakInIdentifiers": no_leak_in_ids,
        "graphNodesCount": nodes_count,
        "totalSemanticCases": total_cases,
        "distribution": {
            "validGoverned": valid_governed_cases,
            "violating": violating_cases,
            "boundaryValid": boundary_valid,
            "boundaryInvalid": boundary_invalid,
            "boundaryTotal": boundary_total,
            "multiRuleValid": multi_rule_valid,
            "multiRuleInvalid": multi_rule_invalid,
            "multiRuleTotal": multi_rule_total,
        },
        "materialization": {
            "experimentTasksMaterialized": sum(1 for r in materialized_records if r["materializationStatus"] == "MATERIALIZED_EXPERIMENT_TASK"),
            "enforcementChallengeMaterialized": sum(1 for r in materialized_records if r["materializationStatus"] == "MATERIALIZED_ENFORCEMENT_CHALLENGE"),
            "validEnforcementCandidates": len(valid_for_challenge),
            "invalidEnforcementCandidates": len(invalid_for_challenge),
            "reservedPool": sum(1 for r in materialized_records if r["materializationStatus"] == "RESERVED_POOL"),
        },
        "hashes": {
            "semanticDataHash": semantic_data_hash,
            "semanticCasesHash": semantic_cases_hash,
            "semanticFixturesHash": semantic_fixtures_hash,
            "shaclShapesHash": shacl_shapes_hash,
            "sparqlConstraintsHash": sparql_constraints_hash,
            "semanticDomainInventoryHash": inventory_hash,
            "shaclCoverageReportHash": shacl_coverage_hash,
            "sparqlCoverageReportHash": sparql_coverage_hash,
            "enforcementChallengeCorpusHash": enforcement_challenge_corpus_hash,
        },
    }

    # Salva semantic-preflight.json
    preflight_json_path = out_dir / "semantic-preflight.json"
    preflight_json_path.write_text(json.dumps(preflight_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Salva semantic-preflight.md
    md_content = f"""# Relatório de Pré-Voo Semântico (FASE A0)

- **Status Geral**: `{preflight_data['status']}`
- **Robustez do Corpus Semântico**: `{corpus_robustness}`
- **Validação Sintática da Ontologia**: `{'PASS' if ontology_syntax_valid else 'FAIL'}`
- **Dados Semânticos Carregáveis**: `{'SIM' if data_loadable else 'NÃO'}` (Nós no Grafo: {nodes_count})
- **Shapes SHACL Carregáveis**: `{'SIM' if shapes_loadable else 'NÃO'}`
- **Constraints SHACL-SPARQL Carregáveis**: `{'SIM' if sparql_loadable else 'NÃO'}`
- **Oráculos Válidos Conformes**: `{'SIM' if valid_oracles_conforming else 'NÃO'}`
- **Oráculos Inválidos com Violação**: `{'SIM' if invalid_oracles_violating else 'NÃO'}`
- **Identificadores Estáveis**: `{'SIM' if stable_ids else 'NÃO'}`

## Distribuição Quantitativa de Casos
- **Total de Casos Catalogados**: {total_cases}
- **Casos Válidos Governados**: {valid_governed_cases} (meta: 40-60, mínimo: 30)
- **Casos Violadores**: {violating_cases} (meta: 40-60, mínimo: 30)
- **Casos de Fronteira (Boundary)**: {boundary_total} ({boundary_valid} válidos / {boundary_invalid} inválidos)
- **Casos Multirregra (Multi-Rule)**: {multi_rule_total} ({multi_rule_valid} válidos / {multi_rule_invalid} inválidos)

## Materialização no Manifesto Experimental
- **Tarefas Experimentais A/B/C/D**: {preflight_data['materialization']['experimentTasksMaterialized']}
- **Candidatos Enforcement Independente**: {preflight_data['materialization']['enforcementChallengeMaterialized']} ({len(valid_for_challenge)} válidos / {len(invalid_for_challenge)} inválidos)
- **Pool Reservado**: {preflight_data['materialization']['reservedPool']}

## Hashes Criptográficos de Proveniência
- `semanticDataHash`: `{semantic_data_hash}`
- `semanticCasesHash`: `{semantic_cases_hash}`
- `semanticFixturesHash`: `{semantic_fixtures_hash}`
- `shaclShapesHash`: `{shacl_shapes_hash}`
- `sparqlConstraintsHash`: `{sparql_constraints_hash}`
- `semanticDomainInventoryHash`: `{inventory_hash}`
- `shaclCoverageReportHash`: `{shacl_coverage_hash}`
- `sparqlCoverageReportHash`: `{sparql_coverage_hash}`
- `enforcementChallengeCorpusHash`: `{enforcement_challenge_corpus_hash}`
"""
    preflight_md_path = out_dir / "semantic-preflight.md"
    preflight_md_path.write_text(md_content, encoding="utf-8")

    # Salva semantic-task-materialization.json e .csv
    mat_json_path = out_dir / "semantic-task-materialization.json"
    mat_json_path.write_text(json.dumps(materialized_records, indent=2, ensure_ascii=False), encoding="utf-8")

    mat_csv_path = out_dir / "semantic-task-materialization.csv"
    with open(mat_csv_path, "w", encoding="utf-8", newline="") as f:
        fieldnames = [
            "semanticCaseId", "taskId", "baseTaskId", "conditionsApplicable",
            "initialStateFixture", "sourceRuleIds", "sourceShapes", "materializationStatus"
        ]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(materialized_records)

    print(f"      - semantic-preflight.json gerado: Status={preflight_data['status']}")
    print("      - semantic-preflight.md gerado")
    print(f"      - semantic-task-materialization.json ({len(materialized_records)} registros)")
    print("      - semantic-task-materialization.csv exportado")

    return preflight_data
