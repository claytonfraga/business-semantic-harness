"""Módulo de proveniência e rastreabilidade científica do BSH Benchmark (Seções 3, 5 e 64/65)."""

import json
from pathlib import Path
from typing import Any, Dict, List


def build_provenance_data(
    runs: List[Dict[str, Any]],
    paired: List[Dict[str, Any]],
    stats: Dict[str, Any],
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    """Constrói o grafo estruturado de proveniência para todas as métricas calculadas."""
    batch_id = metadata.get("lote", "desconhecido")
    
    # 1. Identificação dos pares elegíveis por análise
    rq1_a_pairs = [p["taskId"] for p in paired if p.get("eligibleForTokenAnalysis")]
    rq2_over_pairs = [p["taskId"] for p in paired if str(p.get("taskType", "")).lower() in ("valida_governada", "valida", "valid") and p.get("behavioralEquivalence") == "EQUIVALENTE"]
    rq2_avoid_pairs = [p["taskId"] for p in paired if str(p.get("taskType", "")).lower() in ("violadora", "violating") and p.get("dOutcomeCorrect") and p.get("aImplementedViolation")]
    rq6_runs = [r["runId"] for r in runs if (r.get("condition") or r.get("condicao")) == "D" and (r.get("taskType") or r.get("tipo")) in ("valida_governada", "violadora", "valid", "violating")]

    # 2. Tabela exaustiva de elegibilidade por tarefa e análise (Seção 64/65)
    task_eligibility = []
    for p in paired:
        tid = p["taskId"]
        ttype = str(p.get("taskType", "")).lower()
        eq = p.get("behavioralEquivalence")
        
        # RQ1-A
        task_eligibility.append({
            "taskId": tid,
            "analysis": "RQ1-A (Consumo Bruto)",
            "eligible": p.get("eligibleForTokenAnalysis", False),
            "reason": "Telemetria de tokens válida em ambas as condições" if p.get("eligibleForTokenAnalysis") else (p.get("exclusionReason") or "Telemetria incompleta")
        })
        # RQ1-B
        is_rq1_b = (eq == "EQUIVALENTE" and ttype in ("valida_governada", "valida", "valid"))
        task_eligibility.append({
            "taskId": tid,
            "analysis": "RQ1-B (Eficiência Equivalente)",
            "eligible": is_rq1_b,
            "reason": "Tarefa válida com equivalência comportamental comprovada" if is_rq1_b else ("Tarefa violadora com desfechos divergentes por desenho" if ttype in ("violadora", "violating") else (p.get("exclusionReason") or "Não equivalente funcionalmente"))
        })
        # RQ2 Overhead
        task_eligibility.append({
            "taskId": tid,
            "analysis": "RQ2 (Overhead Válidas)",
            "eligible": is_rq1_b,
            "reason": "Tarefa válida equivalente avaliada para overhead" if is_rq1_b else "Excluída da análise de overhead (não equivalente ou violadora)"
        })
        # RQ2 Custo Evitado
        is_rq2_avoid = bool(ttype in ("violadora", "violating") and p.get("dOutcomeCorrect") and p.get("aImplementedViolation"))
        task_eligibility.append({
            "taskId": tid,
            "analysis": "RQ2 (Custo Evitado Violadoras)",
            "eligible": is_rq2_avoid,
            "reason": "Violação implementada em A e corretamente governada em D" if is_rq2_avoid else "Não aplicável para custo evitado (tarefa válida ou desfecho não governado)"
        })
        # RQ6 Reconhecimento
        task_eligibility.append({
            "taskId": tid,
            "analysis": "RQ6 (Reconhecimento Semântico)",
            "eligible": bool(ttype in ("valida_governada", "violadora")),
            "reason": "Operação governada pertencente ao domínio semântico" if ttype in ("valida_governada", "violadora") else "Operação fora do conhecimento ou indeterminada"
        })
        # Tokens Não Cacheados
        task_eligibility.append({
            "taskId": tid,
            "analysis": "Tokens Não Cacheados",
            "eligible": False,
            "reason": "Semântica de cache do runtime Agy não permite dedução segura de (input - cache) + output"
        })
        # Tempo
        task_eligibility.append({
            "taskId": tid,
            "analysis": "Tempo de Execução",
            "eligible": bool(p.get("durationA") is not None and p.get("durationD") is not None),
            "reason": "Duração temporal observada em ambas as condições" if (p.get("durationA") is not None and p.get("durationD") is not None) else "Duração ausente"
        })

    # 3. Mapeamento de Proveniência de Métricas Principais (Seção 3 e 5)
    rq2 = stats.get("rq2", {})
    rq6 = stats.get("rq6", {})

    provenance_map = {
        "metadata": {
            "batchId": batch_id,
            "dataOrigin": metadata.get("dataOrigin", "REAL_EXECUTION"),
            "agent": metadata.get("agente", "Agy"),
            "model": metadata.get("modelo", "gemini-3.7-flash-medium"),
            "reasoningEffort": metadata.get("esforco", "medium"),
            "totalRuns": len(runs),
            "totalPairs": len(paired),
        },
        "metricProvenance": {
            "beneficioLiquidoTokens": {
                "metricName": "Benefício Líquido Computacional (tokens)",
                "calculatedValue": rq2.get("beneficio_liquido"),
                "formulaApplied": "CustoEvitadoVioladoras + EconomiaValidasEquivalentes - OverheadValidasEquivalentes",
                "sourceFiles": ["paired-results.csv", "violating-task-analysis.csv", "behaviorally-equivalent-pairs.csv"],
                "sourceFields": ["tokensA", "tokensD", "taskType", "behavioralEquivalence", "dOutcomeCorrect"],
                "sourceTasks": rq2_avoid_pairs + rq2_over_pairs,
                "eligibilityCriteria": "Tarefas violadoras com violação em A e governança em D, e tarefas válidas equivalentes",
                "exclusionCriteria": "Tarefas com telemetria ausente ou tarefas válidas com desfecho divergente",
            },
            "beneficioLiquidoPercentual": {
                "metricName": "Benefício Líquido Percentual (%)",
                "calculatedValue": rq2.get("beneficioLiquidoPercentual"),
                "formulaApplied": "(BeneficioLiquido / CustoDiretoElegivel) * 100",
                "denominatorValue": rq2.get("beneficioLiquidoDenominadorTokens"),
                "denominatorDefinition": "Soma de TokensA das tarefas elegíveis incluídas no cálculo do benefício líquido",
                "sourceFiles": ["paired-results.csv"],
                "sourceFields": ["tokensA"],
                "sourceTasks": rq2_avoid_pairs + rq2_over_pairs,
                "eligibilityCriteria": "Pares que compõem o benefício líquido",
                "exclusionCriteria": "Pares não participantes da análise de benefício líquido",
            },
            "custoEvitadoVioladoras": {
                "metricName": "Custo Computacional Evitado em Tarefas Violadoras",
                "calculatedValue": rq2.get("economia_total_violadoras"),
                "formulaApplied": "Σ(TokensA - TokensD) para pares violadores semanticamente elegíveis",
                "sourceFiles": ["violating-task-analysis.csv"],
                "sourceFields": ["tokensA", "tokensD", "aImplementedViolation", "dOutcomeCorrect"],
                "sourceTasks": rq2_avoid_pairs,
                "eligibilityCriteria": "taskType=violadora AND aImplementedViolation=True AND dOutcomeCorrect=True",
                "exclusionCriteria": "Tarefas válidas ou violadoras sem contrafactual violador em A",
            },
            "overheadValidasEquivalentes": {
                "metricName": "Overhead Computacional em Tarefas Válidas Equivalentes",
                "calculatedValue": rq2.get("overhead_total_validas"),
                "formulaApplied": "Σ max(0, TokensD - TokensA) para pares com behavioralEquivalence=EQUIVALENTE",
                "sourceFiles": ["behaviorally-equivalent-pairs.csv"],
                "sourceFields": ["tokensA", "tokensD", "behavioralEquivalence"],
                "sourceTasks": rq2_over_pairs,
                "eligibilityCriteria": "taskType=valida_governada AND behavioralEquivalence=EQUIVALENTE AND TokensD > TokensA",
                "exclusionCriteria": "Tarefas violadoras ou tarefas válidas não equivalentes",
            },
            "operationRecall": {
                "metricName": "Recall do Reconhecimento de Operações Governadas",
                "calculatedValue": rq6.get("operationRecall"),
                "formulaApplied": "TP / (TP + FN)",
                "sourceFiles": ["semantic-recognition.json", "measurements.json"],
                "sourceFields": ["expectedOperation", "identifiedOperation"],
                "sourceRuns": rq6_runs,
                "eligibilityCriteria": "Execuções sob Condição D de tarefas governadas pelo domínio semântico",
                "exclusionCriteria": "Condições A, B, C e tarefas fora do conhecimento (U1)",
            },
            "operationPrecision": {
                "metricName": "Precision do Reconhecimento de Operações Governadas",
                "calculatedValue": rq6.get("operationPrecision"),
                "formulaApplied": "TP / (TP + FP)",
                "sourceFiles": ["semantic-recognition.json", "measurements.json"],
                "sourceFields": ["expectedOperation", "identifiedOperation"],
                "sourceRuns": rq6_runs,
                "eligibilityCriteria": "Operações classificadas como governadas na Condição D",
                "exclusionCriteria": "Execuções sem identificação positiva de operação governada",
            },
            "totalTokensWorkload": {
                "metricName": "Consumo Total de Tokens do Workload (A vs D)",
                "tokensA": sum(p["tokensA"] for p in paired if p.get("tokensA")),
                "tokensD": sum(p["tokensD"] for p in paired if p.get("tokensD")),
                "tokensSaved": max(0.0, sum(p["tokensA"] for p in paired if p.get("tokensA")) - sum(p["tokensD"] for p in paired if p.get("tokensD"))),
                "formulaApplied": "max(0, TotalTokensA - TotalTokensD)",
                "sourceFiles": ["paired-results.csv"],
                "sourceFields": ["tokensA", "tokensD"],
                "sourceTasks": rq1_a_pairs,
                "eligibilityCriteria": "Todos os pares pareados com telemetria válida",
                "exclusionCriteria": "Pares com telemetria ausente",
            },
        },
        "taskEligibilityMatrix": task_eligibility,
    }
    
    return provenance_map


def export_provenance_json(provenance_data: Dict[str, Any], batch_dir: Path) -> Path:
    """Exporta provenance.json no diretório do lote."""
    target = Path(batch_dir) / "provenance.json"
    target.write_text(json.dumps(provenance_data, indent=2, ensure_ascii=False), encoding="utf-8")
    return target
