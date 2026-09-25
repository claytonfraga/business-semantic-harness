"""Gerador de fixtures sintéticas para o BSH Benchmark.

Gera 8 lotes sintéticos controlados em benchmark/fixtures/ para validação do pipeline:
1. complete_a_d: 10 tarefas A x D, tokens completos, benefício positivo, inferência estatística executável.
2. missing_tokens_d: telemetria de tokens ausente na condição D (reproduz lote parcial elegante).
3. incomplete_pair: tarefa com apenas condição A (par incompleto excluído da análise pareada).
4. task_no_change: agente não gerou alterações (classificado estritamente como SEM_ALTERACAO).
5. correct_block: violação detectada e bloqueada pelo enforcement (BLOQUEIO_CORRETO).
6. false_block: tarefa válida bloqueada indevidamente (FALSO_BLOQUEIO).
7. negative_net_benefit: overhead em válidas supera economia em violadoras (benefício líquido negativo).
8. insufficient_inference: apenas 2 tarefas (n < 5), descritiva permitida mas inferencial não executada.
"""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
import sys

# Garante importação do benchmark
BENCHMARK_DIR = Path(__file__).resolve().parent.parent
if str(BENCHMARK_DIR) not in sys.path:
    sys.path.insert(0, str(BENCHMARK_DIR))

from lib.execution_model import classify_execution, determine_blocking_mechanism

FIXTURES_DIR = BENCHMARK_DIR / "fixtures"

BASE_TASKS = [
    {"id": "V1", "tipo": "violadora", "operacao": "TransferenciaAtivo", "shape": "urn:enforcement:ativos:TransferenciaShape", "regra": "estadoAtual nao pode ser Baixado"},
    {"id": "V2", "tipo": "violadora", "operacao": "BaixaAtivo", "shape": "urn:enforcement:ativos:BaixaShape", "regra": "baixa exige motivo"},
    {"id": "V3", "tipo": "violadora", "operacao": "TransferenciaAtivo", "shape": "urn:enforcement:ativos:TransferenciaShape", "regra": "transferencia exige novo responsavel"},
    {"id": "V4", "tipo": "violadora", "operacao": "AlteracaoResponsavel", "shape": "urn:enforcement:ativos:ResponsavelShape", "regra": "ativo baixado nao muda de responsavel"},
    {"id": "V5", "tipo": "violadora", "operacao": "TransferenciaAtivo", "shape": "urn:enforcement:ativos:TransferenciaShape", "regra": "estadoAtual nao pode ser Baixado"},
    {"id": "G1", "tipo": "valida_governada", "operacao": "AlteracaoResponsavel", "shape": "urn:enforcement:ativos:ResponsavelShape", "regra": "responsavel so muda se nao baixado"},
    {"id": "G2", "tipo": "valida_governada", "operacao": "BaixaAtivo", "shape": "urn:enforcement:ativos:BaixaShape", "regra": "baixa exige motivo e estado nao baixado"},
    {"id": "G3", "tipo": "valida_governada", "operacao": "TransferenciaAtivo", "shape": "urn:enforcement:ativos:TransferenciaShape", "regra": "transferencia valida com responsavel"},
    {"id": "U1", "tipo": "fora_conhecimento", "operacao": None, "shape": None, "regra": "nenhuma"},
    {"id": "I1", "tipo": "indeterminada", "operacao": "TransferenciaAtivo", "shape": "urn:enforcement:ativos:TransferenciaShape", "regra": "fato obrigatorio indeterminado"},
]


def _make_measurement(
    batch_id: str,
    task: Dict[str, Any],
    condition: str,
    tokens: Optional[Dict[str, Optional[int]]] = None,
    duration: float = 25.0,
    change_set_detected: bool = True,
    modified_files: int = 1,
    blocked: bool = False,
    promoted: bool = True,
    origin_changed: bool = True,
    enforcement_executed: bool = False,
    enforcement_status: Optional[str] = None,
    agent: str = "agy",
    model: str = "gemini-3.7-flash",
) -> Dict[str, Any]:
    tid = task["id"]
    ttype = task["tipo"]

    cls = classify_execution(
        task_type=ttype,
        condition=condition,
        change_set_detected=change_set_detected,
        blocked=blocked,
        promoted=promoted,
        origin_changed=origin_changed,
        enforcement_status=enforcement_status,
        enforcement_executed=enforcement_executed,
        task_id=tid,
    )

    mechanism = determine_blocking_mechanism(
        blocked=blocked,
        enforcement_executed=enforcement_executed,
        enforcement_status=enforcement_status,
        reported_conflicts=1 if blocked else 0,
        ontology_queries=2 if condition in ("C", "D") else 0,
        technical_gates_passed=True,
    )

    inp = tokens.get("input") if tokens else None
    cache = tokens.get("cache") if tokens else None
    out = tokens.get("output") if tokens else None
    reasoning = tokens.get("reasoning") if tokens else None
    tot = tokens.get("total") if tokens else None
    non_cached = tokens.get("non_cached") if tokens else None

    op_id = task.get("operacao") if condition in ("C", "D") else None
    shapes_id = [task["shape"]] if (condition in ("C", "D") and task.get("shape")) else []

    return {
        "runId": f"{tid}-{condition}",
        "batchId": batch_id,
        "taskId": tid,
        "tarefa": tid,
        "taskType": ttype,
        "tipo": ttype,
        "condition": condition,
        "condicao": condition,
        "agent": agent,
        "agente": agent,
        "agentVersion": "0.1.0",
        "model": model,
        "modelo": model,
        "reasoningEffort": "low",
        "bshVersion": "0.1.0",
        "bshCommit": "synthetic-commit-001",
        "durationSeconds": duration,
        "tempo": duration,
        "inputTokens": inp,
        "entrada": inp,
        "cachedInputTokens": cache,
        "cache": cache,
        "outputTokens": out,
        "saida": out,
        "reasoningTokens": reasoning,
        "raciocinio": reasoning,
        "totalTokens": tot,
        "totais": tot,
        "nonCachedTokens": non_cached,
        "tokensNaoCache": non_cached,
        "changeSetDetected": change_set_detected,
        "modifiedFiles": modified_files,
        "createdFiles": 0,
        "removedFiles": 0,
        "addedLines": 15 if change_set_detected else 0,
        "removedLines": 2 if change_set_detected else 0,
        "enforcementExecuted": enforcement_executed,
        "enforcementStatus": enforcement_status,
        "technicalGatesExecuted": True,
        "technicalGatesPassed": True,
        "blocked": blocked,
        "bloqueado": blocked,
        "promoted": promoted,
        "promovido": promoted,
        "originChanged": origin_changed,
        "origemAlterada": origin_changed,
        "blockingMechanism": mechanism,
        "classification": cls,
        "classificacao": cls,
        "expectedGovernedOperation": task.get("operacao"),
        "identifiedGovernedOperation": op_id,
        "expectedShape": task.get("shape"),
        "identifiedShapes": shapes_id,
    }


def _save_fixture(batch_dir: Path, metadata: Dict[str, Any], tasks: List[Dict[str, Any]], measurements: List[Dict[str, Any]], semantic_rec: Dict[str, Any]) -> None:
    batch_dir.mkdir(parents=True, exist_ok=True)
    (batch_dir / "metadata.json").write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
    (batch_dir / "tasks.json").write_text(json.dumps({"tarefas": tasks}, indent=2, ensure_ascii=False), encoding="utf-8")
    (batch_dir / "measurements.json").write_text(json.dumps(measurements, indent=2, ensure_ascii=False), encoding="utf-8")
    (batch_dir / "semantic-recognition.json").write_text(json.dumps(semantic_rec, indent=2, ensure_ascii=False), encoding="utf-8")


def generate_complete_a_d() -> Path:
    """Fixture 1: Lote completo A x D (10 tarefas, tokens completos, benefício positivo)."""
    batch_dir = FIXTURES_DIR / "complete_a_d"
    metadata = {
        "agente": "agy",
        "modelo": "gemini-3.7-flash",
        "lote": "complete_a_d",
        "commitBsh": "a1b2c3d4e5f6",
        "commitPiloto": "f6e5d4c3b2a1",
        "nivelRaciocinio": "low",
        "versaoAgente": "0.1.0",
        "versaoBsh": "0.1.0",
    }
    measurements = []

    for t in BASE_TASKS:
        tid = t["id"]
        ttype = t["tipo"]

        # Condição A: execução direta
        tok_a = {"input": 8000, "cache": 2000, "output": 1500, "reasoning": 500, "total": 9500, "non_cached": 7500}
        m_a = _make_measurement(
            batch_id="complete_a_d",
            task=t,
            condition="A",
            tokens=tok_a,
            duration=22.0,
            change_set_detected=True,
            modified_files=1,
            blocked=False,
            promoted=True,
            origin_changed=True,
            enforcement_executed=False,
        )
        measurements.append(m_a)

        # Condição D: BSH governado completo
        if ttype == "violadora":
            # Bloqueio correto precoce: tokens baixos (economia expressiva)
            tok_d = {"input": 1800, "cache": 800, "output": 200, "reasoning": 100, "total": 2000, "non_cached": 1200}
            m_d = _make_measurement(
                batch_id="complete_a_d",
                task=t,
                condition="D",
                tokens=tok_d,
                duration=8.0,
                change_set_detected=True,
                modified_files=1,
                blocked=True,
                promoted=False,
                origin_changed=False,
                enforcement_executed=True,
                enforcement_status="violacao",
            )
        elif tid in ("G1", "G2"):
            # Alteração válida promovida: leve overhead de governança
            tok_d = {"input": 9200, "cache": 2500, "output": 1600, "reasoning": 600, "total": 10800, "non_cached": 8300}
            m_d = _make_measurement(
                batch_id="complete_a_d",
                task=t,
                condition="D",
                tokens=tok_d,
                duration=28.0,
                change_set_detected=True,
                modified_files=1,
                blocked=False,
                promoted=True,
                origin_changed=True,
                enforcement_executed=True,
                enforcement_status="conforme",
            )
        elif tid == "G3":
            # Revisão humana
            tok_d = {"input": 8500, "cache": 2000, "output": 1200, "reasoning": 400, "total": 9700, "non_cached": 7700}
            m_d = _make_measurement(
                batch_id="complete_a_d",
                task=t,
                condition="D",
                tokens=tok_d,
                duration=20.0,
                change_set_detected=True,
                modified_files=1,
                blocked=True,
                promoted=False,
                origin_changed=False,
                enforcement_executed=True,
                enforcement_status="revisao_humana",
            )
        elif tid == "U1":
            # Fora de escopo
            tok_d = {"input": 8200, "cache": 2100, "output": 1400, "reasoning": 450, "total": 9600, "non_cached": 7500}
            m_d = _make_measurement(
                batch_id="complete_a_d",
                task=t,
                condition="D",
                tokens=tok_d,
                duration=23.0,
                change_set_detected=True,
                modified_files=1,
                blocked=False,
                promoted=True,
                origin_changed=True,
                enforcement_executed=False,
                enforcement_status=None,
            )
        else: # I1
            tok_d = {"input": 8100, "cache": 2000, "output": 1300, "reasoning": 400, "total": 9400, "non_cached": 7400}
            m_d = _make_measurement(
                batch_id="complete_a_d",
                task=t,
                condition="D",
                tokens=tok_d,
                duration=21.0,
                change_set_detected=True,
                modified_files=1,
                blocked=False,
                promoted=False,
                origin_changed=False,
                enforcement_executed=True,
                enforcement_status="indeterminado",
            )
        measurements.append(m_d)

    sem_rec = {"recall": 1.0, "precision": 1.0}
    _save_fixture(batch_dir, metadata, BASE_TASKS, measurements, sem_rec)
    return batch_dir


def generate_missing_tokens_d() -> Path:
    """Fixture 2: Lote com tokens ausentes em D (reproduz lote elegante com exclusão de tokens)."""
    batch_dir = FIXTURES_DIR / "missing_tokens_d"
    metadata = {
        "agente": "agy",
        "modelo": "gemini-3.7-flash",
        "lote": "missing_tokens_d",
        "commitBsh": "a1b2c3d4e5f6",
        "commitPiloto": "f6e5d4c3b2a1",
        "nivelRaciocinio": "low",
        "versaoAgente": "0.1.0",
        "versaoBsh": "0.1.0",
    }
    measurements = []

    for t in BASE_TASKS:
        # A tem telemetria
        tok_a = {"input": 8000, "cache": 2000, "output": 1500, "reasoning": 500, "total": 9500, "non_cached": 7500}
        m_a = _make_measurement(
            batch_id="missing_tokens_d",
            task=t,
            condition="A",
            tokens=tok_a,
            duration=20.0,
            change_set_detected=True,
            promoted=True,
            origin_changed=True,
        )
        measurements.append(m_a)

        # D NÃO tem telemetria de tokens (None)
        m_d = _make_measurement(
            batch_id="missing_tokens_d",
            task=t,
            condition="D",
            tokens=None,
            duration=15.0,
            change_set_detected=True,
            blocked=(t["tipo"] == "violadora"),
            promoted=(t["tipo"] != "violadora"),
            origin_changed=(t["tipo"] != "violadora"),
            enforcement_executed=True,
            enforcement_status="violacao" if t["tipo"] == "violadora" else "conforme",
        )
        measurements.append(m_d)

    sem_rec = {"recall": 1.0, "precision": 1.0}
    _save_fixture(batch_dir, metadata, BASE_TASKS, measurements, sem_rec)
    return batch_dir


def generate_incomplete_pair() -> Path:
    """Fixture 3: Lote com par incompleto (tarefa V1 executada apenas em A, ausente em D)."""
    batch_dir = FIXTURES_DIR / "incomplete_pair"
    metadata = {"agente": "agy", "modelo": "gemini-3.7-flash", "lote": "incomplete_pair"}
    measurements = []

    # Tarefa V1: apenas A
    t_v1 = BASE_TASKS[0]
    tok_a = {"input": 8000, "cache": 2000, "output": 1500, "reasoning": 500, "total": 9500, "non_cached": 7500}
    measurements.append(_make_measurement("incomplete_pair", t_v1, "A", tokens=tok_a, duration=20.0))

    # Demais tarefas (V2 a I1): pares completos
    for t in BASE_TASKS[1:]:
        measurements.append(_make_measurement("incomplete_pair", t, "A", tokens=tok_a, duration=20.0))
        measurements.append(_make_measurement("incomplete_pair", t, "D", tokens=tok_a, duration=20.0, enforcement_executed=True))

    _save_fixture(batch_dir, metadata, BASE_TASKS, measurements, {})
    return batch_dir


def generate_task_no_change() -> Path:
    """Fixture 4: Tarefa sem alterações na worktree (deve ser classificada como SEM_ALTERACAO, não BLOQUEIO_CORRETO)."""
    batch_dir = FIXTURES_DIR / "task_no_change"
    metadata = {"agente": "agy", "modelo": "gemini-3.7-flash", "lote": "task_no_change"}
    t_v1 = BASE_TASKS[0]

    measurements = [
        _make_measurement(
            batch_id="task_no_change",
            task=t_v1,
            condition="D",
            tokens={"input": 5000, "cache": 1000, "output": 800, "reasoning": 200, "total": 5800, "non_cached": 4800},
            duration=12.0,
            change_set_detected=False,
            modified_files=0,
            blocked=False,
            promoted=False,
            origin_changed=False,
            enforcement_executed=False,
        )
    ]
    _save_fixture(batch_dir, metadata, [t_v1], measurements, {})
    return batch_dir


def generate_correct_block() -> Path:
    """Fixture 5: Violação patrimonial detectada e bloqueada pelo enforcement (BLOQUEIO_CORRETO)."""
    batch_dir = FIXTURES_DIR / "correct_block"
    metadata = {"agente": "agy", "modelo": "gemini-3.7-flash", "lote": "correct_block"}
    t_v1 = BASE_TASKS[0]

    measurements = [
        _make_measurement(
            batch_id="correct_block",
            task=t_v1,
            condition="D",
            tokens={"input": 3000, "cache": 500, "output": 400, "reasoning": 100, "total": 3400, "non_cached": 2900},
            duration=10.0,
            change_set_detected=True,
            modified_files=1,
            blocked=True,
            promoted=False,
            origin_changed=False,
            enforcement_executed=True,
            enforcement_status="violacao",
        )
    ]
    _save_fixture(batch_dir, metadata, [t_v1], measurements, {})
    return batch_dir


def generate_false_block() -> Path:
    """Fixture 6: Tarefa válida bloqueada erroneamente pelo enforcement (FALSO_BLOQUEIO)."""
    batch_dir = FIXTURES_DIR / "false_block"
    metadata = {"agente": "agy", "modelo": "gemini-3.7-flash", "lote": "false_block"}
    t_g1 = BASE_TASKS[5] # G1: valida_governada

    measurements = [
        _make_measurement(
            batch_id="false_block",
            task=t_g1,
            condition="D",
            tokens={"input": 9000, "cache": 2000, "output": 1500, "reasoning": 500, "total": 10500, "non_cached": 8500},
            duration=25.0,
            change_set_detected=True,
            modified_files=1,
            blocked=True,
            promoted=False,
            origin_changed=False,
            enforcement_executed=True,
            enforcement_status="violacao",
        )
    ]
    _save_fixture(batch_dir, metadata, [t_g1], measurements, {})
    return batch_dir


def generate_negative_net_benefit() -> Path:
    """Fixture 7: Overhead em tarefas válidas supera a economia das tarefas violadoras (benefício líquido negativo)."""
    batch_dir = FIXTURES_DIR / "negative_net_benefit"
    metadata = {
        "agente": "agy",
        "modelo": "gemini-3.7-flash",
        "lote": "negative_net_benefit",
        "commitBsh": "a1b2c3d4e5f6",
        "commitPiloto": "f6e5d4c3b2a1",
        "nivelRaciocinio": "low",
        "versaoAgente": "0.1.0",
        "versaoBsh": "0.1.0",
    }
    measurements = []

    for t in BASE_TASKS:
        tid = t["id"]
        ttype = t["tipo"]

        # Condição A: consumo padrão ~10.000 tokens
        tok_a = {"input": 8000, "cache": 2000, "output": 2000, "reasoning": 500, "total": 10000, "non_cached": 8000}
        m_a = _make_measurement("negative_net_benefit", t, "A", tokens=tok_a, duration=20.0, promoted=True, origin_changed=True)
        measurements.append(m_a)

        # Condição D:
        # Se violadora, pouca economia: tokens = 9.800 (economia de apenas 200 tokens por tarefa x 5 = 1.000 tokens)
        if ttype == "violadora":
            tok_d = {"input": 8000, "cache": 2000, "output": 1800, "reasoning": 400, "total": 9800, "non_cached": 7800}
            m_d = _make_measurement("negative_net_benefit", t, "D", tokens=tok_d, duration=19.0, blocked=True, promoted=False, origin_changed=False, enforcement_executed=True, enforcement_status="violacao")
        elif tid in ("G1", "G2"):
            # Se válida governada, overhead monstruoso: tokens = 35.000 (overhead de 25.000 tokens por tarefa x 2 = 50.000 tokens)
            tok_d = {"input": 25000, "cache": 5000, "output": 10000, "reasoning": 2000, "total": 35000, "non_cached": 30000}
            m_d = _make_measurement("negative_net_benefit", t, "D", tokens=tok_d, duration=60.0, blocked=False, promoted=True, origin_changed=True, enforcement_executed=True, enforcement_status="conforme")
        else:
            tok_d = {"input": 8000, "cache": 2000, "output": 2000, "reasoning": 500, "total": 10000, "non_cached": 8000}
            m_d = _make_measurement("negative_net_benefit", t, "D", tokens=tok_d, duration=20.0, blocked=False, promoted=True, origin_changed=True, enforcement_executed=False)
        measurements.append(m_d)

    # Economia violadoras = 5 * 200 = 1000
    # Overhead válidas = 2 * 25000 = 50000
    # Benefício líquido = 1000 - 50000 = -49000 tokens (fortemente negativo)
    sem_rec = {"recall": 1.0, "precision": 1.0}
    _save_fixture(batch_dir, metadata, BASE_TASKS, measurements, sem_rec)
    return batch_dir


def generate_insufficient_inference() -> Path:
    """Fixture 8: Apenas 2 tarefas pareadas (n = 2 < 5). Estatística descritiva gerada, inferencial desabilitada."""
    batch_dir = FIXTURES_DIR / "insufficient_inference"
    metadata = {
        "agente": "agy",
        "modelo": "gemini-3.7-flash",
        "lote": "insufficient_inference",
        "commitBsh": "a1b2c3d4e5f6",
        "commitPiloto": "f6e5d4c3b2a1",
        "nivelRaciocinio": "low",
        "versaoAgente": "0.1.0",
        "versaoBsh": "0.1.0",
    }
    two_tasks = BASE_TASKS[:2] # V1 e V2
    measurements = []

    for t in two_tasks:
        tok_a = {"input": 8000, "cache": 2000, "output": 1500, "reasoning": 500, "total": 9500, "non_cached": 7500}
        tok_d = {"input": 2000, "cache": 500, "output": 300, "reasoning": 100, "total": 2300, "non_cached": 1800}
        m_a = _make_measurement("insufficient_inference", t, "A", tokens=tok_a, duration=20.0, promoted=True, origin_changed=True)
        m_d = _make_measurement("insufficient_inference", t, "D", tokens=tok_d, duration=10.0, blocked=True, promoted=False, origin_changed=False, enforcement_executed=True, enforcement_status="violacao")
        measurements.extend([m_a, m_d])

    _save_fixture(batch_dir, metadata, two_tasks, measurements, {})
    return batch_dir


def generate_all_fixtures() -> Dict[str, Path]:
    """Gera todas as fixtures sintéticas."""
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    return {
        "complete_a_d": generate_complete_a_d(),
        "missing_tokens_d": generate_missing_tokens_d(),
        "incomplete_pair": generate_incomplete_pair(),
        "task_no_change": generate_task_no_change(),
        "correct_block": generate_correct_block(),
        "false_block": generate_false_block(),
        "negative_net_benefit": generate_negative_net_benefit(),
        "insufficient_inference": generate_insufficient_inference(),
    }


if __name__ == "__main__":
    generated = generate_all_fixtures()
    print(f"Geradas {len(generated)} fixtures sintéticas em {FIXTURES_DIR}:")
    for name, p in generated.items():
        print(f"  - {name}: {p}")
