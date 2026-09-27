"""Módulo de Inventário de Capacidade dos Artefatos (Etapa E0 - Seção 0).

Inspeciona os registros brutos e medições para determinar o status de cada campo:
PRESENTE, PARCIAL, AUSENTE ou INDETERMINADO.
Exporta:
- artifact-capability-inventory.json
- artifact-capability-inventory.csv
- artifact-capability-inventory.md
"""

import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from benchmark.core.enums import CapabilityStatus


FIELD_SPECIFICATIONS = [
    {
        "field": "totalTokens",
        "category": "TELEMETRIA_TOKENS",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita cálculo de economia e benefício líquido",
    },
    {
        "field": "inputTokens",
        "category": "TELEMETRIA_TOKENS",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita decomposição de tokens de entrada",
    },
    {
        "field": "outputTokens",
        "category": "TELEMETRIA_TOKENS",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita decomposição de tokens de saída",
    },
    {
        "field": "cachedInputTokens",
        "category": "TELEMETRIA_TOKENS",
        "required": False,
        "impactIfMissing": "AVISO - Análise de cache suprimida (registrada como null)",
    },
    {
        "field": "reasoningTokens",
        "category": "TELEMETRIA_TOKENS",
        "required": False,
        "impactIfMissing": "AVISO - Análise de raciocínio suprimida (registrada como null)",
    },
    {
        "field": "nonCachedTokens",
        "category": "TELEMETRIA_TOKENS",
        "required": False,
        "impactIfMissing": "SUPRESSÃO - RQ1 de tokens não-cacheados é suprimida formalmente com justificativa",
    },
    {
        "field": "durationSeconds",
        "category": "LATENCIA",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita avaliação de impacto temporal (RQ5)",
    },
    {
        "field": "modifiedFiles",
        "category": "CHANGESET",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita verificação de changeset e abstenção",
    },
    {
        "field": "addedLines",
        "category": "CHANGESET",
        "required": True,
        "impactIfMissing": "AVISO - Impossibilita verificação detalhada de volume de diff",
    },
    {
        "field": "removedLines",
        "category": "CHANGESET",
        "required": True,
        "impactIfMissing": "AVISO - Impossibilita verificação detalhada de volume de diff",
    },
    {
        "field": "testsPassed",
        "category": "QUALIDADE_TECNICA",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita verificação de gates técnicos",
    },
    {
        "field": "technicalGatesPassed",
        "category": "QUALIDADE_TECNICA",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita verificação de conformidade de código",
    },
    {
        "field": "ontologyQueried",
        "category": "GOVERNANCA_SEMANTICA",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita rastreamento de consulta preventiva",
    },
    {
        "field": "reportConflictCalled",
        "category": "GOVERNANCA_SEMANTICA",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita rastreamento de conflito ontológico",
    },
    {
        "field": "identifiedOperation",
        "category": "RECONHECIMENTO_SEMANTICO",
        "required": False,
        "impactIfMissing": "AVISO - Requer inferência a partir do catálogo ou registro como ausente",
    },
    {
        "field": "identifiedShapes",
        "category": "RECONHECIMENTO_SEMANTICO",
        "required": False,
        "impactIfMissing": "AVISO - Requer inferência a partir do catálogo ou registro como ausente",
    },
    {
        "field": "promoted",
        "category": "CICLO_DE_VIDA_PRODUTO",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita determinação de promoção para branch principal",
    },
    {
        "field": "originChanged",
        "category": "CICLO_DE_VIDA_PRODUTO",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita auditoria de integridade do repositório base",
    },
    {
        "field": "enforcementObserved",
        "category": "GOVERNANCA_SEMANTICA",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita auditoria de disparo de barreira SHACL",
    },
    {
        "field": "enforcementStatus",
        "category": "GOVERNANCA_SEMANTICA",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita caracterização de enforcement",
    },
    {
        "field": "classification",
        "category": "CLASSIFICACAO_EXPERIMENTO",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita taxonomia dos desfechos",
    },
    {
        "field": "governanceMechanism",
        "category": "GOVERNANCA_SEMANTICA",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita atribuição de mecanismo causal",
    },
    {
        "field": "taskOutcomeCorrect",
        "category": "CORRECAO_EXPERIMENTAL",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Impossibilita cálculo de desfecho experimental correto",
    },
    {
        "field": "dataOrigin",
        "category": "PROVENIENCIA",
        "required": True,
        "impactIfMissing": "HARD_FAIL - Violação de integridade empírica (REAL vs SYNTHETIC)",
    },
]


def evaluate_artifact_inventory(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Inspeciona as execuções e calcula o inventário de capacidade dos artefatos."""
    total_runs = len(runs)
    if total_runs == 0:
        return {
            "status": "VAZIO",
            "totalRuns": 0,
            "fields": {},
            "allRequiredPresent": False,
        }

    inventory: Dict[str, Any] = {}
    all_required_present = True

    for spec in FIELD_SPECIFICATIONS:
        fname = spec["field"]
        present_count = 0
        non_null_count = 0

        for r in runs:
            val = r.get(fname)
            # Verifica aliases legados caso aplicável
            if val is None:
                if fname == "totalTokens":
                    val = r.get("totais") or (r.get("rawTelemetry") or {}).get("total_tokens")
                elif fname == "inputTokens":
                    val = r.get("entrada") or (r.get("rawTelemetry") or {}).get("input_tokens")
                elif fname == "outputTokens":
                    val = r.get("saida") or (r.get("rawTelemetry") or {}).get("output_tokens")
                elif fname == "cachedInputTokens":
                    val = r.get("cache") or (r.get("rawTelemetry") or {}).get("cached_read_tokens")
                elif fname == "reasoningTokens":
                    val = r.get("raciocinio") or (r.get("rawTelemetry") or {}).get("thinking_tokens")
                elif fname == "durationSeconds":
                    val = r.get("tempo")
                elif fname == "modifiedFiles":
                    val = r.get("arquivos")
                elif fname == "addedLines":
                    val = r.get("adicionadas")
                elif fname == "removedLines":
                    val = r.get("removidas")
                elif fname == "classification":
                    val = r.get("classificacao")

            if val is not None:
                non_null_count += 1
                # Se for número, não pode ser negativo
                if isinstance(val, (int, float)) and val >= 0:
                    present_count += 1
                elif isinstance(val, (bool, str, list, dict)):
                    present_count += 1

        coverage = present_count / total_runs

        if coverage == 1.0:
            status = CapabilityStatus.PRESENTE.value
        elif coverage > 0.0:
            status = CapabilityStatus.PARCIAL.value
        else:
            # Se for nonCachedTokens e explicitamente excluído por telemetria
            if fname == "nonCachedTokens":
                status = CapabilityStatus.AUSENTE.value
            else:
                status = CapabilityStatus.AUSENTE.value

        if spec["required"] and status != CapabilityStatus.PRESENTE.value:
            all_required_present = False

        inventory[fname] = {
            "field": fname,
            "category": spec["category"],
            "required": spec["required"],
            "status": status,
            "coveragePct": round(coverage * 100.0, 1),
            "presentCount": present_count,
            "totalRuns": total_runs,
            "impactIfMissing": spec["impactIfMissing"],
            "analysisSuppressed": status == CapabilityStatus.AUSENTE.value,
        }

    return {
        "status": "VALID" if all_required_present else "DEGRADED",
        "totalRuns": total_runs,
        "allRequiredPresent": all_required_present,
        "fields": inventory,
    }


def export_artifact_inventory(inventory_data: Dict[str, Any], output_dir: Path) -> None:
    """Exporta o inventário nos formatos JSON, CSV e Markdown."""
    output_dir.mkdir(parents=True, exist_ok=True)

    # 1. JSON
    json_path = output_dir / "artifact-capability-inventory.json"
    json_path.write_text(json.dumps(inventory_data, indent=2, ensure_ascii=False), encoding="utf-8")

    # 2. CSV
    csv_path = output_dir / "artifact-capability-inventory.csv"
    fields_list = list(inventory_data.get("fields", {}).values())
    if fields_list:
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["field", "category", "required", "status", "coveragePct", "presentCount", "totalRuns", "impactIfMissing", "analysisSuppressed"],
            )
            writer.writeheader()
            writer.writerows(fields_list)

    # 3. Markdown
    md_path = output_dir / "artifact-capability-inventory.md"
    lines = [
        "# Inventário de Capacidade dos Artefatos Experimentais (Etapa E0 - Seção 0)",
        "",
        f"- **Status Geral do Lote**: `{inventory_data.get('status', 'DESCONHECIDO')}`",
        f"- **Total de Execuções Inspecionadas**: `{inventory_data.get('totalRuns', 0)}`",
        f"- **Todos os Campos Críticos Presentes**: `{'SIM' if inventory_data.get('allRequiredPresent') else 'NÃO'}`",
        "",
        "| Campo | Categoria | Obrigatório | Status | Cobertura | Impacto se Ausente |",
        "| :--- | :--- | :---: | :---: | :---: | :--- |",
    ]
    for item in fields_list:
        req_str = "Sim" if item["required"] else "Não"
        status_badge = f"**{item['status']}**" if item["status"] != "PRESENTE" else item["status"]
        lines.append(
            f"| `{item['field']}` | {item['category']} | {req_str} | {status_badge} | {item['coveragePct']}% | {item['impactIfMissing']} |"
        )
    lines.append("")
    md_path.write_text("\n".join(lines), encoding="utf-8")
