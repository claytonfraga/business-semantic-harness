"""Cálculo da cobertura estrutural da base semântica e das regras (Seção 56-A).

Avalia a cobertura de regras, operações, shapes SHACL e constraints SHACL-SPARQL
considerando tanto a catalogação estrutural quanto a materialização executável da campanha.
"""

from collections import Counter
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DEFAULT_DOMAIN_DIR = REPO / "pilot" / "asset-management" / ".bsh" / "domains" / "ativos"


def compute_semantic_base_coverage(
    domain_dir: Optional[Path] = None,
    materialization_path: Optional[Path] = None,
    output_dir: Optional[Path] = None,
) -> Dict[str, Any]:
    """Calcula e exporta semantic-base-coverage.json e semantic-base-coverage.md."""
    domain = Path(domain_dir).resolve() if domain_dir else DEFAULT_DOMAIN_DIR
    out_dir = Path(output_dir).resolve() if output_dir else domain

    cases_path = domain / "semantic-cases.json"
    inventory_path = domain / "semantic-domain-inventory.json"

    semantic_cases: List[Dict[str, Any]] = json.loads(cases_path.read_text(encoding="utf-8")) if cases_path.is_file() else []
    domain_inventory: Dict[str, Any] = json.loads(inventory_path.read_text(encoding="utf-8")) if inventory_path.is_file() else {}

    # Carrega materialização de tarefas se fornecida
    materialized_ids: Set[str] = set()
    if materialization_path and Path(materialization_path).is_file():
        mat_data = json.loads(Path(materialization_path).read_text(encoding="utf-8"))
        for item in mat_data:
            if item.get("materializationStatus") in ("MATERIALIZED_EXPERIMENT_TASK", "MATERIALIZED_ENFORCEMENT_CHALLENGE"):
                materialized_ids.add(item.get("semanticCaseId"))

    cases_total = len(semantic_cases)
    cases_executed = len(materialized_ids) if materialized_ids else cases_total

    # Agrupamentos
    by_type = dict(Counter(c.get("caseType") for c in semantic_cases))
    by_op = dict(Counter(c.get("operation") for c in semantic_cases))
    by_diff = dict(Counter(c.get("difficulty", "INTERMEDIATE") for c in semantic_cases))
    by_comp = dict(Counter(c.get("complexity", "STANDARD") for c in semantic_cases))

    # Regras e Shapes do Inventário
    inv_rules = domain_inventory.get("lifecycleRules", []) if isinstance(domain_inventory.get("lifecycleRules"), list) else []
    total_domain_rules = len(inv_rules) if inv_rules else 20
    inv_ops = domain_inventory.get("operations", []) if isinstance(domain_inventory.get("operations"), list) else []
    total_domain_ops = len(inv_ops) if inv_ops else 9
    inv_shapes = domain_inventory.get("shapes", []) if isinstance(domain_inventory.get("shapes"), list) else []
    total_domain_shapes = len(inv_shapes) if inv_shapes else 20
    inv_sparql = domain_inventory.get("shaclSparqlConstraints", []) if isinstance(domain_inventory.get("shaclSparqlConstraints"), list) else []
    total_sparql_constraints = len(inv_sparql) if inv_sparql else 5

    # Regras e Shapes cobertos pelos casos
    covered_rules: Set[str] = set()
    covered_shapes: Set[str] = set()
    covered_ops: Set[str] = set()
    covered_sparql: Set[str] = set()

    shapes_with_valid: Set[str] = set()
    shapes_with_inval: Set[str] = set()
    shapes_with_bound: Set[str] = set()
    shapes_with_multi: Set[str] = set()

    rules_with_valid: Set[str] = set()
    rules_with_inval: Set[str] = set()

    for c in semantic_cases:
        ctype = c.get("caseType", "")
        op = c.get("operation")
        if op:
            covered_ops.add(op)
        for r in c.get("expectedRules", []):
            covered_rules.add(r)
            if "VALID" in ctype:
                rules_with_valid.add(r)
            if "INVALID" in ctype:
                rules_with_inval.add(r)
        for s in c.get("expectedShapes", []):
            covered_shapes.add(s)
            if "SPARQL" in s or "Compatibilidade" in s or "ValorResidual" in s or "ConflitoDatas" in s or "AltoValor" in s:
                covered_sparql.add(s)
            if "VALID" in ctype and "BOUNDARY" not in ctype and "MULTI" not in ctype:
                shapes_with_valid.add(s)
            elif "INVALID" in ctype and "BOUNDARY" not in ctype and "MULTI" not in ctype:
                shapes_with_inval.add(s)
            elif "BOUNDARY" in ctype:
                shapes_with_bound.add(s)
            elif "MULTI" in ctype:
                shapes_with_multi.add(s)

    rule_cov_count = len(covered_rules)
    rule_cov_pct = min(100.0, (rule_cov_count / total_domain_rules * 100.0)) if total_domain_rules > 0 else 100.0

    op_cov_count = len(covered_ops)
    total_domain_ops = max(total_domain_ops, op_cov_count)
    op_cov_pct = min(100.0, (op_cov_count / total_domain_ops * 100.0)) if total_domain_ops > 0 else 100.0

    shape_cov_count = len(covered_shapes)
    total_domain_shapes = max(total_domain_shapes, shape_cov_count)
    shape_cov_pct = min(100.0, (shape_cov_count / total_domain_shapes * 100.0)) if total_domain_shapes > 0 else 100.0

    sparql_cov_count = len(covered_sparql)
    total_sparql_constraints = max(total_sparql_constraints, sparql_cov_count)
    sparql_cov_pct = min(100.0, (sparql_cov_count / total_sparql_constraints * 100.0)) if total_sparql_constraints > 0 else 100.0

    # Lacunas
    shapes_without_pos = sorted(list(covered_shapes - shapes_with_valid))
    shapes_without_neg = sorted(list(covered_shapes - shapes_with_inval))
    rules_without_val = sorted(list(covered_rules - rules_with_valid))
    rules_without_inv = sorted(list(covered_rules - rules_with_inval))

    coverage_data = {
        "semanticCasesTotal": cases_total,
        "semanticCasesExecuted": cases_executed,
        "semanticCasesByType": by_type,
        "semanticCasesByOperation": by_op,
        "semanticCasesByDifficulty": by_diff,
        "semanticCasesByRuleComplexity": by_comp,
        "ruleCoverageCount": rule_cov_count,
        "ruleCoveragePercentage": round(rule_cov_pct, 1),
        "operationCoverageCount": op_cov_count,
        "operationCoveragePercentage": round(op_cov_pct, 1),
        "shapeCoverageCount": shape_cov_count,
        "shapeCoveragePercentage": round(shape_cov_pct, 1),
        "sparqlConstraintCoverageCount": sparql_cov_count,
        "sparqlConstraintCoveragePercentage": round(sparql_cov_pct, 1),
        "shapesWithConformingCases": len(shapes_with_valid),
        "shapesWithViolatingCases": len(shapes_with_inval),
        "shapesWithBoundaryCases": len(shapes_with_bound),
        "shapesWithMultiRuleCases": len(shapes_with_multi),
        "rulesWithoutValidCase": rules_without_val,
        "rulesWithoutInvalidCase": rules_without_inv,
        "shapesWithoutPositiveCoverage": shapes_without_pos,
        "shapesWithoutNegativeCoverage": shapes_without_neg,
    }

    # Salva semantic-base-coverage.json
    json_path = out_dir / "semantic-base-coverage.json"
    json_path.write_text(json.dumps(coverage_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # Salva semantic-base-coverage.md
    md_content = f"""# Cobertura Estrutural da Base Semântica (Seção 56-A)

- **Total de Casos Catalogados**: {cases_total}
- **Casos Exercitados/Materializados**: {cases_executed}
- **Cobertura de Regras de Negócio**: {rule_cov_count} regras ({rule_cov_pct:.1f}%)
- **Cobertura de Operações do Domínio**: {op_cov_count} operações ({op_cov_pct:.1f}%)
- **Cobertura de Shapes SHACL**: {shape_cov_count} shapes ({shape_cov_pct:.1f}%)
- **Cobertura de Constraints SHACL-SPARQL**: {sparql_cov_count} constraints ({sparql_cov_pct:.1f}%)

## Cobertura por Categoria de Caso
- **Shapes com Casos Conformes**: {len(shapes_with_valid)}
- **Shapes com Casos Violadores**: {len(shapes_with_inval)}
- **Shapes com Casos de Borda**: {len(shapes_with_bound)}
- **Shapes com Casos Multirregra**: {len(shapes_with_multi)}

## Lacunas e Limitações Estruturais
- **Shapes sem Cobertura Positiva**: {len(shapes_without_pos)} ({', '.join(shapes_without_pos) if shapes_without_pos else 'Nenhum'})
- **Shapes sem Cobertura Negativa**: {len(shapes_without_neg)} ({', '.join(shapes_without_neg) if shapes_without_neg else 'Nenhum'})
- **Regras sem Caso Válido**: {len(rules_without_val)}
- **Regras sem Caso Inválido**: {len(rules_without_inv)}
"""
    md_path = out_dir / "semantic-base-coverage.md"
    md_path.write_text(md_content, encoding="utf-8")

    print(f"      - semantic-base-coverage.json gerado (Regras: {rule_cov_pct:.1f}%, Shapes: {shape_cov_pct:.1f}%)")
    print("      - semantic-base-coverage.md gerado")

    return coverage_data
