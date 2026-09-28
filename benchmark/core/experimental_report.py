"""Report model, provenance, LaTeX rendering and publication layout gate.

The renderer receives only report-model.json.  It performs formatting, never
statistical calculation or inference from raw runs.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import subprocess
from typing import Any

from .experimental_execution import canonical_json, write_json


TITLE = "Avaliação Experimental de Governança Semântica no Business Semantic Harness"
SECTION_TITLES = [
    "Introdução", "Fundamentação", "Arquitetura do BSH", "Desenho Experimental",
    "Condições Experimentais", "Questões de Pesquisa", "Variáveis e Estimandos",
    "Instrumentação", "Integridade da Execução Experimental",
    "Qualidade e Completude dos Dados", "Pareabilidade", "Resultados Funcionais",
    "RQ1-A: Consumo Bruto", "RQ1-B: Eficiência sob Equivalência", "RQ2: Benefício Computacional",
    "RQ3: Regras Textuais", "RQ4: Ontologia Consultiva", "RQ5: BSH Completo",
    "RQ6: Reconhecimento Semântico", "RQ7: Mecanismos de Governança",
    "RQ8: Tokens versus Tempo", "RQ9: Distribuição", "RQ10: Testes versus Semântica",
    "RQ11: Independência do Harness", "Falsos Bloqueios", "Violações Não Detectadas",
    "Enforcement Independente", "Matriz de Evidências", "Respostas às Questões de Pesquisa",
    "Discussão", "Ameaças à Validade", "Reprodutibilidade",
]

RQ_TITLES = {
    "RQ1_A": "Qual é a diferença de consumo bruto de tokens entre a execução direta e o BSH?",
    "RQ1_B": "Quando A e D realizam corretamente trabalho comportamentalmente equivalente, qual é a diferença de consumo?",
    "RQ2": "Qual é o benefício computacional do workload, separando economia válida, overhead e trajetórias inválidas governadas?",
    "RQ3": "Qual é o efeito observado da inclusão de regras textuais (A × B)?",
    "RQ4": "Qual é o efeito adicional da ontologia consultiva (B × C)?",
    "RQ5": "Qual é o efeito adicional do BSH completo e há evidência de enforcement independente (C × D)?",
    "RQ6": "Qual é a qualidade do reconhecimento de operações e shapes, separadamente?",
    "RQ7": "Quais mecanismos de governança produziram os desfechos observados?",
    "RQ8": "Qual é a relação entre diferença de tokens e diferença de duração?",
    "RQ9": "Como economia e overhead se distribuem por tarefa, categoria, operação, dificuldade e workload?",
    "RQ10": "Em que medida violações implementadas escapam da suíte técnica?",
    "RQ11": "Em que medida o BSH atua independentemente da cooperação voluntária do agente?",
}

# Primary normative sources and peer-reviewed research.  Citations use an
# author/date style and entries are formatted as ABNT-like references.
REFERENCES = [
    {"key": "wohlin2012", "author": "WOHLIN et al.", "year": "2012", "entry": "WOHLIN, C. et al. Experimentation in Software Engineering. Berlin: Springer, 2012."},
    {"key": "kitchenham2002", "author": "KITCHENHAM et al.", "year": "2002", "entry": "KITCHENHAM, B. A. et al. Preliminary guidelines for empirical research in software engineering. IEEE Transactions on Software Engineering, v. 28, n. 8, p. 721–734, 2002."},
    {"key": "rdf2014", "author": "W3C", "year": "2014a", "entry": "W3C. RDF 1.1 Concepts and Abstract Syntax. W3C Recommendation, 2014. Disponível em: https://www.w3.org/TR/rdf11-concepts/."},
    {"key": "shacl2017", "author": "W3C", "year": "2017", "entry": "W3C. Shapes Constraint Language (SHACL). W3C Recommendation, 2017. Disponível em: https://www.w3.org/TR/shacl/."},
    {"key": "owl2012", "author": "W3C", "year": "2012", "entry": "W3C. OWL 2 Web Ontology Language Document Overview. Second edition. W3C Recommendation, 2012. Disponível em: https://www.w3.org/TR/owl-overview/."},
    {"key": "sparql2013", "author": "W3C", "year": "2013", "entry": "W3C. SPARQL 1.1 Query Language. W3C Recommendation, 2013. Disponível em: https://www.w3.org/TR/sparql11-query/."},
    {"key": "jsonld2020", "author": "W3C", "year": "2020", "entry": "W3C. JSON-LD 1.1: A JSON-based Serialization for Linked Data. W3C Recommendation, 2020. Disponível em: https://www.w3.org/TR/json-ld11/."},
    {"key": "yao2023", "author": "YAO et al.", "year": "2023", "entry": "YAO, S. et al. ReAct: Synergizing Reasoning and Acting in Language Models. International Conference on Learning Representations, 2023. Disponível em: https://arxiv.org/abs/2210.03629."},
]


def _safe_text(value: Any) -> str:
    return "indisponível" if value is None else str(value)


def _metric_sentence(rq_id: str, entry: dict[str, Any]) -> str:
    metric = entry.get("metric")
    if entry["status"] in {"DADOS_INSUFICIENTES", "NAO_AVALIADA"}:
        return f"{entry['status']}: os campos disponíveis não satisfazem os requisitos desta questão."
    if rq_id == "RQ1_A" and isinstance(metric, dict):
        reduction = metric.get("WORKLOAD_TOKEN_REDUCTION")
        return (f"A razão das somas A × D foi {reduction:.3f} sobre {metric['eligiblePairs']} pares elegíveis. "
                "Este contraste descreve o resultado conjunto do BSH; não isola ontologia ou enforcement.") if reduction is not None else "DADOS_INSUFICIENTES para o estimando de redução bruta."
    if rq_id == "RQ5" and isinstance(metric, dict):
        count = metric.get("independentEnforcementActivated")
        return f"Foram observadas {count} ativações de enforcement independente na condição D. O contraste C × D, sozinho, não identifica o mecanismo causal."
    if rq_id == "RQ8" and isinstance(metric, dict):
        correlation = metric.get("correlation") or {}
        if correlation.get("status") != "COMPUTABLE":
            return "A correlação não é calculável com os pares, variâncias e requisitos disponíveis."
        return f"Pearson = {correlation['pearson']:.3f}; Spearman = {correlation['spearman']:.3f}. A associação observada não estabelece causalidade."
    if rq_id == "RQ11" and isinstance(metric, dict):
        if metric.get("independentOpportunities", 0) == 0:
            return "Nenhuma alteração candidata incompatível ofereceu oportunidade de observar enforcement independente."
        return f"Houve {metric['independentOpportunities']} oportunidades e {metric['independentEnforcementActivated']} ativações comprovadas."
    return "O resultado estruturado e seus denominadores constam na tabela e na matriz de evidências."


def _table(title: str, headers: list[str], rows: list[list[Any]], units: str, source: str, n: int) -> dict[str, Any]:
    return {"title": title, "headers": headers, "rows": [[_safe_text(value) for value in row] for row in rows],
            "units": units, "source": source, "n": n}


def _metric_rows(value: Any, prefix: str = "") -> list[list[Any]]:
    if isinstance(value, dict):
        return [row for key, item in sorted(value.items())
                for row in _metric_rows(item, f"{prefix}.{key}" if prefix else key)]
    if isinstance(value, list):
        return [row for index, item in enumerate(value)
                for row in _metric_rows(item, f"{prefix}[{index}]")]
    return [[prefix, value]]


def _intro_paragraphs() -> list[str]:
    return [
        "Este relatório descreve uma avaliação experimental do Business Semantic Harness (BSH) sob "
        "quatro condições. As condições distinguem-se pela presença de BSH e pelo tipo de governança.",
        "A — Direta: não utiliza BSH. O agente atua sem ontologia e sem regras textuais.",
        "B — Regras textuais: não utiliza BSH. O agente recebe apenas regras de negócio em linguagem "
        "natural via AGENTS.md, sem ontologia e sem enforcement.",
        "C — BSH consultivo: utiliza o BSH como camada semântica consultiva, com acesso à ontologia por "
        "MCP, mas sem enforcement independente no gate de promoção. O agente consulta o conhecimento "
        "semântico e decide como agir.",
        "D — BSH completo: utiliza o mesmo BSH semântico de C e acrescenta enforcement independente no "
        "gate de promoção. Portanto, D = BSH consultivo + controle independente da promoção.",
        "Identidades: A = sem BSH; B = sem BSH, com regras textuais; C = BSH semântico consultivo; "
        "D = BSH semântico consultivo + enforcement independente. Tanto C quanto D utilizam BSH; "
        "apenas D possui enforcement independente.",
        "Os contrastes experimentais são interpretados assim: A × B, efeito das regras textuais; "
        "B × C, efeito da introdução do BSH semântico; C × D, efeito adicional do enforcement "
        "independente do BSH; A × D, efeito combinado do BSH completo em relação ao agente sem governança.",
    ]


def _conflict_summary(batch_id: str) -> dict[tuple[str, str], dict[str, int]]:
    path = Path(__file__).resolve().parents[1] / "results" / batch_id / "classified-runs.json"
    if not path.is_file():
        return {}
    try:
        runs = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return {}
    groups: dict[tuple[str, str], dict[str, int]] = {}
    for run in runs:
        condition = str(run.get("condition"))
        ttype = str(run.get("taskType") or "").lower()
        if ttype in ("violadora", "violating"):
            kind = "violadora"
        elif ttype in ("valida_governada", "valida", "valid"):
            kind = "valida"
        else:
            kind = ttype or "outra"
        group = groups.setdefault((condition, kind), {"n": 0, "conflict": 0, "queried": 0})
        group["n"] += 1
        if run.get("reportConflictCalled") is True:
            group["conflict"] += 1
        if run.get("ontologyQueried") is True:
            group["queried"] += 1
    return groups


def _conclusion_paragraphs(stats: dict[str, Any], verdicts: dict[str, Any], batch_id: str = "") -> list[str]:
    questions = stats.get("researchQuestions", {}) if isinstance(stats, dict) else {}

    def verdict(rq_id: str) -> str:
        try:
            return verdicts["researchQuestions"][rq_id]["verdict"]
        except (KeyError, TypeError):
            return "NAO_AVALIADO"

    def status(rq_id: str) -> str:
        return str(questions.get(rq_id, {}).get("status", "NAO_AVALIADA"))

    groups = _conflict_summary(batch_id)

    def line(condition: str, kind: str) -> str:
        data = groups.get((condition, kind), {"n": 0, "conflict": 0, "queried": 0})
        return (condition + " " + kind + ": conflitos " + str(data["conflict"]) + "/" + str(data["n"])
                + ", consultas " + str(data["queried"]) + "/" + str(data["n"]))

    d_metric = questions.get("RQ5", {}).get("metric") or {}
    independent = d_metric.get("independentEnforcementActivated")
    return [
        "A conclusão distingue o valor do BSH consultivo do valor adicional do enforcement independente "
        "e não trata C e D como equivalentes.",
        "1) Regras textuais (A × B): veredito " + verdict("RQ3") + " (" + status("RQ3") + ").",
        "2) Introdução do BSH consultivo (B × C): veredito " + verdict("RQ4") + " (" + status("RQ4") + "). "
        "Se C já evita alterações por consulta semântica, isso representa utilidade do BSH mesmo sem o gate. "
        "Evidência observada de seletividade consultiva — " + line("C", "violadora") + "; " + line("C", "valida") + ".",
        "3) Enforcement independente (C × D): veredito " + verdict("RQ5") + " (" + status("RQ5") + "); "
        "ativações independentes observadas em D: " + str(independent) + ". "
        "Evidência observada em D — " + line("D", "violadora") + "; " + line("D", "valida") + ". Se o benefício adicional "
        "de D sobre C não aparecer claramente, isso é declarado objetivamente, sem concluir equivalência entre C e D.",
        "4) Efeito global do BSH completo (A × D): veredito " + verdict("RQ1_A") + " (" + status("RQ1_A") + ").",
        "Limitação de proveniência: diferenças de commit/registro de origem podem aparecer com hashes de árvore "
        "iniciais e finais iguais; isso indica mudança de histórico/proveniência sem evidência de mudança do conteúdo "
        "relevante do código-base e é tratado como limitação de rastreabilidade, não como contaminação dos resultados.",
        "Limitação de métrica: a cobertura de evidência semântica fina (operação e shapes reconhecidos) e a métrica de "
        "tokens não cacheados podem ficar ausentes ou zeradas sem que isso signifique ausência de interação semântica; "
        "há consulta ontológica e relato de conflito registrados por run.",
        "Esta conclusão é construída apenas a partir dos resultados observados nesta campanha; não antecipa "
        "superioridade de nenhuma condição.",
    ]


def _audit_paragraphs(batch_id: str) -> list[str]:
    """Cadeia de auditoria por execução: tarefa, consulta, conflito, candidato, promoção, estado final."""
    path = Path(__file__).resolve().parents[1] / "results" / batch_id / "classified-runs.json"
    if not path.is_file():
        return ["Dados estruturados de auditoria indisponíveis para este batch."]
    try:
        runs = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return ["Dados estruturados de auditoria ilegíveis para este batch."]
    lines: list[str] = []
    for run in runs:
        parts = [
            str(run.get("runId")),
            "cond=" + str(run.get("condition")),
            "task=" + str(run.get("baseTaskId")),
            "tipo=" + str(run.get("taskType")),
            "consulta=" + str(run.get("ontologyQueried")),
            "conflito=" + str(run.get("reportConflictCalled")),
            "candidato=" + str(run.get("candidateCreated")),
            "changeSet=" + str(run.get("changeSetDetected")),
            "codeBase=" + str(run.get("codeBaseChanged")),
            "promovido=" + str(run.get("promoted")),
            "testes=" + str(run.get("testsPassed")),
            "classe=" + str(run.get("classification")),
        ]
        lines.append(" | ".join(parts))
    return lines


def _discussion_paragraphs() -> list[str]:
    return [
        "O relato seletivo de conflitos (violadoras com conflito; permitidas sem conflito) é tratado como "
        "evidência de utilidade consultiva, não como demonstração de precisão semântica além desta amostra.",
        "A execução de solicitações permitidas sob C/D não deve ser diluída pela contagem de violações evitadas: "
        "a dimensão 'entregar o permitido' e a dimensão 'prevenir o proibido' são avaliadas conjuntamente.",
        "Zero oportunidades de enforcement independente não é taxa de falha nem sucesso: é ausência de denominador "
        "de exposição ao gate. Testar o componente exige submissão de candidatos incompatíveis e conformes ao fluxo real.",
        "'Parcialmente sustentado' indica viabilidade da comparação, não eficácia demonstrada da propriedade.",
    ]


def _threats_paragraphs() -> list[str]:
    return [
        "Construção: as tarefas concentram-se em poucas famílias semânticas (consulta, baixa, transferência); "
        "a segunda repetição é parcial; resultados podem não generalizar para operações não exercitadas.",
        "Interna: comparabilidade de telemetria dependente de contabilidade idêntica; ausência de critérios externos "
        "de correção funcional; falhas de execução/instrumentação concentradas em condições específicas.",
        "Externa: um agente, um modelo, um domínio e uma política congelada; solicitações 'violadoras' o são apenas "
        "em relação à política congelada e sem autorização do agente para alterá-la.",
        "Construto: `semanticEvidenceCoverage` fina e tokens não cacheados podem faltar sem significar ausência de "
        "interação semântica; cobertura mede registros presentes, não qualidade do desfecho.",
    ]


def _read_classified(batch_id: str) -> list[dict[str, Any]]:
    path = Path(__file__).resolve().parents[1] / "results" / batch_id / "classified-runs.json"
    if not path.is_file():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return []


def _read_results(batch_id: str) -> dict[str, dict[str, Any]]:
    base = Path(__file__).resolve().parents[1] / "results" / batch_id / "executions"
    runs: dict[str, dict[str, Any]] = {}
    if base.is_dir():
        for result in base.glob("*/result.json"):
            try:
                data = json.loads(result.read_text(encoding="utf-8"))
            except (ValueError, OSError):
                continue
            if data.get("runId"):
                runs[str(data["runId"])] = data
    return runs


def _denial_stage(result: dict[str, Any]) -> str:
    decision = result.get("governanceDecision")
    if isinstance(decision, dict):
        stage = decision.get("failureStage")
        if stage:
            return str(stage)
        if decision.get("validationStatus") == "VIOLATION":
            return "SHACL_VIOLATION"
    return "TECHNICAL_OR_UNKNOWN"


def _g4_case_paragraphs(batch_id: str) -> list[str]:
    classified = _read_classified(batch_id)
    results = _read_results(batch_id)
    cases = [r for r in classified if str(r.get("baseTaskId")) == "G4"]
    if not cases:
        return ["Sem execuções de G4 neste batch."]
    lines: list[str] = []
    for run in cases:
        run_id = str(run.get("runId"))
        raw = results.get(run_id, {})
        gd = raw.get("governanceDecision") if isinstance(raw.get("governanceDecision"), dict) else {}
        from .classification_contract import denial_sequence, first_failed_stage
        etapa_declarada = first_failed_stage(denial_sequence(raw))
        extractor = "disponivel" if isinstance(raw.get("governanceDecision"), dict) and gd.get("candidateGraphHash") else "ausente"
        parts = [
            "runId=" + run_id, "cond=" + str(run.get("condition")),
            "solicitacaoPermitida=" + str(run.get("solicitacaoPermitida")),
            "candidato=" + str(run.get("candidateCreated")),
            "changeSet=" + str(run.get("changeSetDetected")),
            "codeBase=" + str(run.get("codeBaseChanged")),
            "consulta=" + str(run.get("ontologyQueried")),
            "conflito=" + str(run.get("reportConflictCalled")),
            "operacoesReconhecidas=" + str(gd.get("recognizedOperation")),
            "etapaFalha=" + _denial_stage(raw),
            "primeiraEtapaFalha=" + etapa_declarada,
            "extrator=" + extractor,
            "validacaoExec=" + str(run.get("validationExecuted")),
            "validacaoCompleta=" + str(run.get("validationComplete")),
            "promocao=" + str(run.get("promotionDecision")),
            "promovido=" + str(run.get("promoted")),
            "classe=" + str(run.get("classification")),
        ]
        lines.append(" | ".join(parts))
    return lines


def _glossary_paragraphs() -> list[str]:
    items = {
        "solicitação permitida": "unidade=run; valor=solicitacaoPermitida (oráculo congelado da tarefa); não é validade do candidato.",
        "candidato produzido": "unidade=run; valor=candidateCreated/changeSetDetected; numerador=1 se houve alteração material no candidato.",
        "validade semântica do candidato": "unidade=candidato; INDETERMINATE sem verificação independente do diff concreto; VALID/INVALID só com verificação independente.",
        "reconhecimento": "unidade=run; recognizedOperation não vazio; denominador=execuções com candidateEnforcementApplicable.",
        "validação executada": "unidade=run; validationExecuted=true quando SHACL rodou sobre fatos fornecidos por extrator.",
        "validação completa": "unidade=run; validationComplete=true quando todos os shapes selecionados foram executados e não há fatos ausentes.",
        "INDETERMINATE": "unidade=run; validação/estado não conclusivo; causa indicada em failureStage.",
        "DENY": "unidade=run; promotionDecision=DENY; promoção impedida.",
        "bloqueio": "unidade=run; blocked=true; nenhum mecanismo aplicou a alteração ao código-base.",
        "promoção": "unidade=run; promoted=true; candidato integrado ao origin.",
        "falso bloqueio": "unidade=candidato conforme; numerador=candidatos comprovadamente conformes com promoção negada; denominador=candidatos conformes submetidos ao gate.",
        "contenção": "unidade=run violadora; numerador=violadoras impedidas (BLOQUEIO_CORRETO/SEM_ALTERACAO_CORRETA); denominador=violadoras elegíveis.",
        "escape": "unidade=run violadora; numerador=VIOLACAO_NAO_DETECTADA (ou promoção de candidato incompatível); denominador=violadoras elegíveis.",
        "oportunidade de enforcement": "unidade=candidato incompatível submetido ao gate; denominador=execuções com candidateEnforcementApplicable e candidato material.",
        "intervenção independente": "unidade=run; independentEnforcementActivated=true com evidência completa do gate.",
        "valores ausentes": "null quando não observado; nunca convertido em false/0; INDETERMINATE quando não determinável.",
    }
    return [term + ": " + definition for term, definition in items.items()]


def _auditable_indicators(stats: dict[str, Any], batch_id: str) -> list[str]:
    from .analytics import compute_report_metrics, load_classified
    base = Path(__file__).resolve().parents[1] / "results" / batch_id if batch_id else None
    runs = load_classified(str(base)) if base else []
    metrics = compute_report_metrics(runs)

    def fmt(name: str, m: dict[str, Any]) -> str:
        valor = "indisponível" if m["valor"] is None else "{:.3f}".format(m["valor"])
        ids = ", ".join(m["idsNumerador"]) or "-"
        excl = "; ".join("{}=[{}]".format(k, ",".join(v)) for k, v in m["excluidos"].items()) or "nenhuma"
        return "{} = {}/{} = {} (unidade: {}; ids numerador: {}; exclusões: {})".format(
            name, m["numerador"], m["denominador"], valor, m["unidade"], ids, excl)

    linhas = [
        fmt("Taxa de falsos bloqueios entre candidatos conformes", metrics["falsosBloqueios"]),
        fmt("Taxa de entrega das solicitações permitidas", metrics["entregaPermitidas"]),
        fmt("Contenção de violadoras (C/D)", metrics["contencao"]),
        fmt("Escapes de violadoras (C/D)", metrics["escapes"]),
        fmt("Oportunidades de enforcement independente (D)", metrics["oportunidadesEnforcement"]),
        "Contrato de campos (origem/tipo/unidade/null): " + "; ".join(item["campo"] for item in metrics["contrato"]),
        "Invariantes: {} (violações: {}; limitações: {}).".format(
            metrics["invariantes"]["status"], len(metrics["invariantes"]["violations"]),
            len(metrics["invariantes"]["limitations"])),
        "Identidades: {} runs, {} identidades únicas.".format(
            metrics["identidades"]["n"], metrics["identidades"]["unicas"]),
    ]
    return linhas


def _denial_decomposition(batch_id: str) -> list[str]:
    results = _read_results(batch_id)
    contagem: dict[str, int] = {}
    for result in results.values():
        denied = False
        gd = result.get("governanceDecision")
        if isinstance(gd, dict) and gd.get("promotionDecision") == "DENY":
            denied = True
        if result.get("promotionDecision") == "DENY":
            denied = True
        if not denied:
            continue
        stage = _denial_stage(result)
        contagem[stage] = contagem.get(stage, 0) + 1
    if not contagem:
        return ["Nenhuma negativa de promoção registrada neste batch."]
    linhas = ["Negativas por etapa (run-level):"]
    for stage in sorted(contagem):
        linhas.append("  " + stage + ": " + str(contagem[stage]))
    return linhas


def _complementary_figures(batch_id: str) -> list[dict[str, Any]]:
    runs = _read_classified(batch_id)
    results = _read_results(batch_id)
    figuras: list[dict[str, Any]] = []
    if not runs:
        return figuras

    def violadora(run: dict[str, Any]) -> bool:
        return str(run.get("taskType") or "").lower() in ("violadora", "violating")

    labels = [cond + "-permitida" for cond in "ABCD"] + [cond + "-violadora" for cond in "ABCD"]
    values = ([sum(1 for r in runs if r.get("condition") == cond and not violadora(r)) for cond in "ABCD"]
              + [sum(1 for r in runs if r.get("condition") == cond and violadora(r)) for cond in "ABCD"])
    if any(values):
        figuras.append({"id": "fig-outcomes", "title": "Desfechos por condição e categoria",
                        "question": "Quantas execuções por condição e categoria de solicitação?",
                        "population": "todas as execuções observadas", "section": "Figura: Desfechos",
                        "source": "classified-runs.json", "n": len(runs), "data": {"labels": labels, "values": values},
                        "ylabel": "execuções",
                        "interpretation": "Painéis por categoria permitem ler contenção e entrega conjuntamente; totais por condição evitam confundir volume com desempenho."})

    etapas: dict[str, int] = {}
    for run in runs:
        if run.get("condition") != "D":
            continue
        resultado = results.get(str(run.get("runId")), {})
        gd = resultado.get("governanceDecision") if isinstance(resultado.get("governanceDecision"), dict) else {}
        if gd.get("promotionDecision") != "DENY":
            continue
        stage = gd.get("failureStage") or ("SHACL_VIOLATION" if gd.get("validationStatus") == "VIOLATION" else "DESCONHECIDA")
        etapas[str(stage)] = etapas.get(str(stage), 0) + 1
    if etapas:
        figuras.append({"id": "fig-denials", "title": "Negativas em D por etapa de falha",
                        "question": "Em que etapa a promoção foi negada em D?",
                        "population": "execuções D com promotionDecision=DENY", "section": "Figura: Negativas em D",
                        "source": "executions/*/result.json", "n": sum(etapas.values()),
                        "data": {"labels": list(etapas), "values": [etapas[k] for k in etapas]},
                        "ylabel": "negativas",
                        "interpretation": "Separa proteção semântica demonstrada de negativa por impossibilidade de provar conformidade; etapa não alcançada não recebe causalidade."})

    campos = [("tokens", "totalTokens"), ("testes", "testsPassed"), ("consulta", "ontologyQueried"),
              ("validacao", "validationComplete"), ("decisao", "promotionDecision")]
    cobertura = [sum(1 for r in runs if r.get(campo) is not None) for _, campo in campos]
    if any(cobertura):
        figuras.append({"id": "fig-coverage", "title": "Cobertura das evidências",
                        "question": "Quais evidências estão disponíveis?",
                        "population": "todas as execuções observadas", "section": "Figura: Cobertura",
                        "source": "classified-runs.json", "n": len(runs),
                        "data": {"labels": [nome for nome, _ in campos], "values": cobertura},
                        "ylabel": "execuções com campo observado",
                        "interpretation": "Cobertura mede registro presente, não qualidade do desfecho; ausência não é zero."})

    totais = [sum(r.get("totalTokens") for r in runs if r.get("condition") == cond and r.get("totalTokens") is not None) for cond in "ABCD"]
    contagens = [sum(1 for r in runs if r.get("condition") == cond and r.get("totalTokens") is not None) for cond in "ABCD"]
    if any(contagens):
        medias = [round(totais[i] / contagens[i], 1) if contagens[i] else 0 for i in range(4)]
        figuras.append({"id": "fig-tokens", "title": "Tokens por condição (média observada)", "question": "Qual o consumo de tokens por condição?",
                        "population": "execuções com totalTokens e contabilidade comparável",
                        "section": "Figura: Tokens", "source": "classified-runs.json", "n": sum(contagens),
                        "data": {"labels": [cond + " (n=" + str(contagens[i]) + ")" for i, cond in enumerate("ABCD")], "values": medias},
                        "ylabel": "tokens médios por execução",
                        "interpretation": "Média descritiva por condição; réplicas não são amostras independentes, o denominador é o número de execuções com token observado e ausência não é zero."})

    code_map = {"ALTERACAO_CORRETA": 0, "SEM_ALTERACAO_CORRETA": 1, "BLOQUEIO_CORRETO": 2,
                "SEM_ALTERACAO_INCORRETA": 3, "ALTERACAO_INCORRETA": 4, "FALSO_BLOQUEIO": 5,
                "REVISAO_HUMANA": 6, "INDETERMINADO": 7, "FALHA_INSTRUMENTACAO": 8, "FALHA_TECNICA": 9}
    bases = sorted({str(r.get("baseTaskId")) for r in runs})
    condicoes = list("ABCD")
    lookup = {(str(r.get("baseTaskId")), r.get("condition")): r.get("classification") for r in runs}
    matriz = [[code_map.get(lookup.get((base, cond)), -1) for cond in condicoes] for base in bases]
    if bases:
        figuras.append({"id": "fig-matrix", "title": "Matriz tarefa-base × condição",
                        "question": "Como cada tarefa-base se comporta em A, B, C e D?",
                        "population": "todas as execuções observadas", "section": "Figura: Matriz",
                        "source": "classified-runs.json", "n": len(runs),
                        "data": {"rows": bases, "cols": condicoes, "values": matriz, "codes": code_map},
                        "ylabel": "tarefa-base",
                        "interpretation": "Permite ver a recorrência por tarefa-base (ex.: G4) e réplica por condição, evitando que agregados ocultem comportamentos específicos."})
    return figuras


def build_report_model(batch_id: str, metadata: dict[str, Any], config: dict[str, Any],
                       completion: dict[str, Any], quality: dict[str, Any], isolation: dict[str, Any],
                       usability: dict[str, Any], ground_truth: dict[str, Any], stats: dict[str, Any],
                       evidence: list[dict[str, Any]], verdicts: dict[str, Any],
                       pairs: dict[str, list[dict[str, Any]]], hashes: dict[str, Any]) -> dict[str, Any]:
    agent_cfg = config.get("agent", {})
    domain = config.get("project", {}).get("ontologyDomain")
    sample = stats["sampleSize"]
    subtitle = " | ".join(_safe_text(value) for value in (
        batch_id, metadata.get("agente") or agent_cfg.get("id"), metadata.get("modelo") or agent_cfg.get("model"),
        metadata.get("esforco") or agent_cfg.get("reasoningEffort"), domain, metadata.get("startedAt")))
    sections: list[dict[str, Any]] = []

    static = {
        "Introdução": "Este estudo avalia governança semântica em alterações de código propostas por agentes. O objetivo é descrever diferenças observadas entre condições e os limites de inferência, seguindo princípios de experimentação em Engenharia de Software [wohlin2012; kitchenham2002].",
        "Fundamentação": "RDF representa fatos em grafos [rdf2014]; JSON-LD serializa dados ligados [jsonld2020]; OWL formaliza vocabulários [owl2012]; SHACL valida restrições [shacl2017]; SPARQL consulta grafos [sparql2013]. Agentes que raciocinam e agem podem usar ferramentas externas, mas a validação independente exige evidência separada da resposta voluntária do agente [yao2023].",
        "Arquitetura do BSH": "O agente trabalha em worktree isolada. Uma alteração candidata pode ser reconhecida como operação, materializada em grafo e verificada por SHACL antes dos gates técnicos e da promoção. Consulta ontológica é orientação consultiva; enforcement independente requer um candidato incompatível cujo gate tenha impedido a promoção sem relato voluntário.",
        "Desenho Experimental": "A unidade de execução é a run; a unidade conceitual de generalização é a tarefa-base. Réplicas repetem uma tarefa e não aumentam nBaseTasks. Ordem, bloqueamento e parâmetros são lidos exclusivamente do plano e dos metadados congelados nesta Execução Experimental. Critérios de avaliação dos resultados: o protocolo distingue (i) o resultado esperado da tarefa, definido previamente pelo protocolo (implementar uma consulta permitida ou preservar uma regra diante de uma solicitação violadora); (ii) o comportamento observado (consulta à ontologia, relato de conflito, produção de candidato, alteração da origem e decisão de promoção); e (iii) a correção do candidato e da decisão do gate, que exige examinar a alteração concreta, pois uma solicitação permitida pode resultar em implementação incorreta. expectedOperation e expectedShapes são lidos do manifesto de tarefas congelado no batch; identifiedOperation e identifiedShapes, das evidências da execução. A origem do critério de correção é explícita: SEM_ALTERACAO_CORRETA e REVISAO_HUMANA derivam da categoria da tarefa e da política congelada, não de julgamento independente; a correção semântica verificada é NOT_EVALUATED na ausência de referência independente, situação distinta da adequação ao critério operacional do experimento. A decisão do próprio BSH não serve, isoladamente, como comprovação de que o BSH decidiu corretamente.",
        "Condições Experimentais": "A executa o agente diretamente; B adiciona regras textuais; C adiciona ontologia consultiva; D usa o BSH completo. A × D mede efeito conjunto; A × B, B × C e C × D exploram componentes progressivos sem presumir causalidade.",
        "Variáveis e Estimandos": "Condição é a variável independente. Consumo de tokens, duração, correção funcional, correção de governança e desfecho da tarefa são variáveis dependentes distintas. WORKLOAD_TOKEN_REDUCTION é 1 menos a razão entre a soma de tokens D e a soma de tokens A, somente em pares com contabilidade comparável e denominador positivo.",
        "Instrumentação": "O adapter registra runtime, telemetria de tokens, duração, diff, testes, consultas MCP, conflitos e status de enforcement. Valor ausente permanece nulo; zero indica medição explícita de zero. Tokens não cacheados não são derivados sem garantia documentada da semântica do runtime. Cobertura mede registros presentes, não o desfecho: 'cobertura de testes' é o número de execuções com teste executado sobre o total elegível (não o total de runs), e a cobertura de diff distingue diff vazio confirmado (por comparação de conteúdo inicial e final), diff não coletado e medida não aplicável.",
        "Resultados Funcionais": "Cumprimento do pedido, correção funcional, correção de governança e correção do desfecho são dimensões independentes. Uma violação evitada pode ter desfecho correto sem entregar o pedido literal. Os denominadores são explícitos por condição: contagens não devem ser lidas como proporções do total de runs quando o conjunto elegível for menor.",
        "Discussão": "Os resultados favoráveis, desfavoráveis e não calculáveis são apresentados separadamente. O relato seletivo de conflitos é evidência de utilidade consultiva, não de precisão semântica além da amostra. A execução de solicitações permitidas sob C/D não deve ser diluída pela contagem de violações evitadas. Zero oportunidades de enforcement independente não é taxa de falha nem sucesso: é ausência de denominador de exposição ao gate. Diferenças de tokens após bloqueio não equivalem a maior eficiência na entrega da mesma funcionalidade. 'Parcialmente sustentado' indica viabilidade da comparação, não eficácia demonstrada. Denominadores são separados por natureza: pareamento estrutural (universo de tarefas comuns) não é o mesmo que elegibilidade analítica (pares com contabilidade comparável); o conjunto completo de D não é o mesmo que o contraste pareado C × D; 'violações implementadas' e 'violações contidas' podem ser conjuntos distintos e devem ser identificados por runId; falha de instrumentação é distinta de falha de execução.",
        "Ameaças à Validade": "Construção: tarefas concentram-se em poucas famílias (consulta, baixa, transferência) e a segunda repetição é parcial. Interna: comparabilidade de telemetria depende de contabilidade idêntica, faltam critérios externos de correção funcional e há falhas concentradas em condições específicas. Externa: um agente, um modelo, um domínio e uma política congelada; 'violadora' refere-se apenas à política congelada. Construto: cobertura mede registros presentes, não qualidade do desfecho; evidência semântica fina e tokens não cacheados podem faltar sem significar ausência de interação.",
    }
    for title in SECTION_TITLES:
        paragraph = static.get(title)
        if title == "Integridade da Execução Experimental":
            paragraph = f"Foram planejadas {completion['plannedRuns']} runs, observadas {completion['observedRuns']}, concluídas {completion['completedRuns']}, ausentes {completion['missingRuns']} e falhas {completion['failedRuns']}. O gate classificou a Execução Experimental como {completion['completionStatus']}."
        elif title == "Qualidade e Completude dos Dados":
            paragraph = "A cobertura por condição aparece na tabela correspondente como contagem observada, esperada e percentual. Ausência de medição não é convertida em zero."
        elif title == "Pareabilidade":
            paragraph = "O pareamento usa tarefa-base, índice de réplica e variante de prompt. Pares inexistentes, incompatíveis ou sem dados obrigatórios são registrados explicitamente."
        elif title == "Questões de Pesquisa":
            paragraph = "As questões RQ1-A a RQ11 são pré-definidas. Cada resposta exige campos, denominador e evidência adequados."
        elif title.startswith("RQ"):
            rq_id = title.split(":", 1)[0].replace("RQ1-A", "RQ1_A").replace("RQ1-B", "RQ1_B")
            entry = stats["researchQuestions"][rq_id]
            paragraph = f"{RQ_TITLES[rq_id]} {_metric_sentence(rq_id, entry)} Status: {entry['status']}; nRuns: {entry['nRuns']}; nBaseTasks: {entry['nBaseTasks']}. " + ("Limitações: " + "; ".join(entry["limitations"]) + "." if entry["limitations"] else "")
        elif title == "Falsos Bloqueios":
            fb = stats["falseBlocks"]
            paragraph = f"Foram observados {fb['falseBlocksObserved']} falsos bloqueios em {fb['falseBlockOpportunities']} oportunidades ({fb['nBaseTasks']} tarefas-base). O intervalo de Wilson é bilateral; zero eventos não implica risco zero."
        elif title == "Violações Não Detectadas":
            vio = stats["violations"]
            case_ids = ", ".join(case["runId"] for case in vio["escapedCases"])
            paragraph = f"Foram observados {vio['escapedViolations']} escapes entre {vio['eligibleViolatingRuns']} runs violadoras elegíveis. Casos: {case_ids or 'nenhum'}. A tabela registra cada run e sua evidência técnica e semântica disponível."
        elif title == "Enforcement Independente":
            independent = stats["researchQuestions"]["RQ11"]["metric"]
            paragraph = f"Oportunidades reais: {independent['independentOpportunities']}; ativações comprovadas: {independent['independentEnforcementActivated']}. Consultas e relatos voluntários são contabilizados separadamente."
        elif title == "Matriz de Evidências":
            paragraph = "Cada propriedade está vinculada à questão, aos requisitos, aos valores observados, ao denominador, às limitações e ao veredito. A matriz é derivada apenas de statistics.json."
        elif title == "Respostas às Questões de Pesquisa":
            paragraph = "A tabela resume status e vereditos de cada RQ. DADOS_INSUFICIENTES e NAO_AVALIADA são respostas explícitas quando faltam requisitos ou oportunidades."
        elif title == "Reprodutibilidade":
            paragraph = "Hashes da configuração, tarefas, plano, política e dados da execução, versões do agente e commit do gerador acompanham os artefatos estruturados. Campos indisponíveis são nulos."
        elif title == "Conclusão":
            counts = {name: sum(value["verdict"] == name for value in verdicts["researchQuestions"].values()) for name in {row["verdict"] for row in evidence}}
            paragraph = "Nesta Execução Experimental, os vereditos por RQ foram: " + ", ".join(f"{name}: {count}" for name, count in sorted(counts.items())) + ". A conclusão se limita ao agente, modelo, domínio, tarefas e versão do BSH registrados; nenhuma métrica ausente foi tratada como zero."
        sections.append({"title": title, "paragraphs": [paragraph or "Dados estruturados desta seção estão indisponíveis para esta execução; a questão permanece sem avaliação."]})

    tables = [
        _table("Integridade da Execução Experimental", ["Planejadas", "Observadas", "Concluídas", "Ausentes", "Falhas"],
               [[completion[key] for key in ("plannedRuns", "observedRuns", "completedRuns", "missingRuns", "failedRuns")]], "runs", "execution-validation.json", completion["observedRuns"]),
        _table("Cobertura por condição", ["Condição", "Métrica", "Observado", "Esperado", "Percentual (%)"],
               [[condition, key, data["observed"], data["expected"], data["percentage"]]
                for condition, item in quality["byCondition"].items() for key, data in item.items() if key != "runs"],
               "runs e porcentagem", "data-quality.json", sample["nRuns"]),
        _table("Pareabilidade por contraste", ["Contraste", "Pares", "Tarefas-base", "Sem match", "Dados ausentes"],
               [[contrast, sum(row["status"] == "PAIRED" for row in rows), len({row["baseTaskId"] for row in rows if row["status"] == "PAIRED"}), sum(row["status"] == "NO_MATCHING_RUN" for row in rows), sum(row["status"] == "MISSING_REQUIRED_DATA" for row in rows)] for contrast, rows in pairs.items()],
               "pares", "paired-results.csv", sample["nRuns"]),
        _table("Matriz de evidências", ["RQ", "Status", "nRuns", "nBaseTasks", "Força", "Veredito"],
               [[row["researchQuestion"], verdicts["researchQuestions"][row["researchQuestion"]]["status"], row["nRuns"], row["nBaseTasks"], row["evidenceStrength"], row["verdict"]] for row in evidence],
               "runs e tarefas-base", "evidence-matrix.json", sample["nRuns"]),
    ]
    for table, section in zip(tables, ("Integridade da Execução Experimental", "Qualidade e Completude dos Dados",
                                      "Pareabilidade", "Matriz de Evidências")):
        table["section"] = section
    for title in SECTION_TITLES:
        if not title.startswith("RQ"):
            continue
        rq_id = title.split(":", 1)[0].replace("RQ1-A", "RQ1_A").replace("RQ1-B", "RQ1_B")
        entry = stats["researchQuestions"][rq_id]
        metric_rows = _metric_rows(entry["metric"])
        if metric_rows:
            table = _table(f"Resultados observados de {rq_id}", ["Métrica", "Valor observado"],
                           metric_rows, "unidade indicada pelo nome da métrica", "statistics.json", entry["nRuns"])
            table["section"] = title
            tables.append(table)
    for title, metric, source in (
        ("Falsos Bloqueios", stats["falseBlocks"], "statistics.json"),
        ("Violações Não Detectadas", stats["violations"], "statistics.json"),
    ):
        table = _table(title, ["Métrica", "Valor observado"], _metric_rows(metric),
                       "runs, proporção ou intervalo", source, sample["nRuns"])
        table["section"] = title
        tables.append(table)
    sample_table = _table("Tamanho da amostra observada", ["Indicador", "Valor observado"],
                          _metric_rows(sample), "runs, tarefas-base, pares ou índices de réplica",
                          "statistics.json", sample["nRuns"])
    sample_table["section"] = "Desenho Experimental"
    tables.append(sample_table)
    functional_rows = [[condition, field, counts["true"], counts["false"], counts["missing"]]
                       for condition, outcomes in stats["functionalOutcomesByCondition"].items()
                       for field, counts in outcomes.items()]
    functional_table = _table("Desfechos funcionais e de governança por condição",
                              ["Condição", "Dimensão", "Verdadeiro", "Falso", "Ausente"],
                              functional_rows, "runs", "classified-runs.json", sample["nRuns"])
    functional_table["section"] = "Resultados Funcionais"
    tables.append(functional_table)
    ad_plot = [{"baseTaskId": row["baseTaskId"], "leftTokens": row["leftTokens"], "rightTokens": row["rightTokens"]}
               for row in pairs["A-D"] if row["status"] == "PAIRED" and row["tokenAccountingComparable"] == "TRUE"]
    figures = [{"id": "paired-tokens", "title": "Consumo observado de tokens por par A × D", "data": ad_plot,
                "section": "RQ1-A: Consumo Bruto", "source": "paired-a-d.csv", "n": len(ad_plot)}] if ad_plot else []
    figures.extend(_complementary_figures(batch_id))
    for figura in [item for item in figures if str(item.get("section", "")).startswith("Figura:")]:
        sections.append({"title": figura["section"],
                         "paragraphs": [figura["title"] + " — pergunta: " + figura["question"] + " População: " + figura["population"] + "."]})
    provenance = {
        "batchId": batch_id, "dataOrigin": metadata.get("dataOrigin"),
        "agent": metadata.get("agente") or agent_cfg.get("id"), "agentVersion": metadata.get("versaoAgente"),
        "model": metadata.get("modelo") or agent_cfg.get("model"),
        "reasoningEffort": metadata.get("esforco") or metadata.get("nivelRaciocinio") or agent_cfg.get("reasoningEffort"),
        "agentAdapter": agent_cfg.get("adapter"), "agentAdapterVersion": metadata.get("agentAdapterVersion"),
        "adapterCommit": metadata.get("adapterCommit"), "runtimeVersion": metadata.get("runtimeVersion"),
        "telemetrySchemaVersion": metadata.get("telemetrySchemaVersion"),
        "tokenAccountingVersion": metadata.get("tokenAccountingVersion"),
        "repositoryCommit": metadata.get("hashes", {}).get("repositoryCommit"),
        "bshProductTreeHash": metadata.get("hashes", {}).get("bshProductTreeHash"),
        "benchmarkTreeHash": metadata.get("hashes", {}).get("benchmarkTreeHash"),
        "pilotCommit": metadata.get("hashes", {}).get("pilotCommit"),
        "ontologyHash": metadata.get("hashes", {}).get("ontologyHash"),
        "shapesHash": metadata.get("hashes", {}).get("shapesHash"),
        "policyHash": metadata.get("hashes", {}).get("policyHash"),
        "taskManifestHash": hashes.get("tasks.json"), "configHash": hashes.get("config.yaml"),
        "rawMeasurementsHash": hashes.get("measurements.json"),
        "executionMetadataHash": hashes.get("metadata.json"),
        "analysisPlanHash": hashes.get("analysis-plan.yaml"), "analysisPolicyHash": hashes.get("analysis-policy.yaml"),
        "reportGeneratorCommit": hashes.get("reportGeneratorCommit"),
        "reportGeneratorTreeHash": hashes.get("reportGeneratorTreeHash"),
    }
    provenance_table = _table("Metadados de reprodutibilidade", ["Campo", "Valor"],
                              [[key, value] for key, value in provenance.items()],
                              "hash, versão ou identificador", "report-model.json", sample["nRuns"])
    provenance_table["section"] = "Reprodutibilidade"
    tables.append(provenance_table)
    sections.append({
        "title": "Escopo da Avaliação do Harness e Limite do Ground Truth",
        "paragraphs": [
            "Esta etapa avalia o BSH como harness ontológico por evidência observável do fluxo "
            "(consulta semântica, acionamento do enforcement, bloqueio, promoção e mudança no código-base). "
            "Avaliar se o harness atuou não é avaliar se cada decisão semântica estava correta: a correção de "
            "decisões específicas de enforcement requer ground truth independente e constitui uma etapa distinta. "
            "Sem esse ground truth, candidateSemanticValidity = INDETERMINATE e enforcementCorrectness = "
            "NOT_EVALUATED; DENY não implica enforcement correto e ALLOW não implica enforcement correto.",
        ],
    })
    sections.insert(0, {"title": "Introdução", "paragraphs": _intro_paragraphs()})
    sections.append({"title": "Conclusão", "paragraphs": _conclusion_paragraphs(stats, verdicts, batch_id)})
    sections.append({"title": "Auditoria por Execução", "paragraphs": _audit_paragraphs(batch_id)})
    sections.append({"title": "Análise de Caso: G4", "paragraphs": _g4_case_paragraphs(batch_id)})
    sections.append({"title": "Glossário Operacional e Regras de Cálculo", "paragraphs": _glossary_paragraphs()})
    sections.append({"title": "Indicadores Auditáveis e Decomposição das Negativas",
                     "paragraphs": _auditable_indicators(stats, batch_id) + _denial_decomposition(batch_id)})
    sections.append({"title": "Reconciliação entre Campanhas", "paragraphs": [
        "Os números de falsos bloqueios e de entrega são por campanha e não devem ser somados ou substituídos "
        "informalmente entre execuções distintas; cada afirmação identifica o batchId e as runIds.",
        "A validade do candidato é apurada por verificação independente do diff concreto; a permissão da tarefa "
        "(solicitacaoPermitida) não é prova de validade do candidato.",
        "No relatório anterior, as oportunidades de falso bloqueio pertenciam a uma única tarefa-base, o que "
        "restringe a interpretação de intervalos estatísticos que tratem as execuções como independentes.",
    ]})
    model = {"title": TITLE, "subtitle": subtitle, "batchId": batch_id, "domain": domain,
             "executionDate": metadata.get("startedAt"), "dataOrigin": metadata.get("dataOrigin"),
             "provenance": provenance, "abstract": {"objective": "Avaliar governança semântica observada no BSH",
             "design": "Quatro condições pareadas A/B/C/D", "nRuns": sample["nRuns"], "nBaseTasks": sample["nBaseTasks"],
             "mainResults": {rq: verdicts["researchQuestions"][rq]["verdict"] for rq in ("RQ1_A", "RQ1_B", "RQ5", "RQ10", "RQ11")},
             "limitations": ["Generalização limitada ao agente, modelo, domínio e tarefas observados",
                             "Escopo observacional: sem ground truth independente a correção semântica de decisões de enforcement é NOT_EVALUATED"]},
             "execution": completion, "isolation": isolation, "quality": quality,
             "usability": usability, "groundTruth": ground_truth, "statistics": stats,
             "evidenceMatrix": evidence, "verdicts": verdicts, "sections": sections,
             "tables": tables, "figures": figures, "references": REFERENCES}
    model["scientificContentHash"] = hashlib.sha256(canonical_json(model).encode("utf-8")).hexdigest()
    model["provenance"]["scientificContentHash"] = model["scientificContentHash"]
    return model


def build_number_provenance(model: dict[str, Any]) -> list[dict[str, Any]]:
    entries = []
    questions = model["statistics"]["researchQuestions"]
    all_runs = sorted({run for entry in questions.values() for run in entry.get("sourceRuns", [])})
    all_tasks = sorted({task for entry in questions.values() for task in entry.get("sourceBaseTasks", [])})
    def source_for(path: str) -> tuple[str, list[str], list[str], str]:
        match = re.search(r"(?:statistics\.researchQuestions\.|sections\[\d+\]\.)(RQ1_[AB]|RQ(?:[2-9]|10|11))", path)
        rq_id = match.group(1) if match else None
        if rq_id in questions:
            entry = questions[rq_id]
            formula = "1 - sum(TokensD)/sum(TokensA)" if "WORKLOAD_TOKEN_REDUCTION" in path else "see statistics.json"
            return "statistics.json", entry.get("sourceRuns", []), entry.get("sourceBaseTasks", []), formula
        if path.startswith("execution"):
            return "execution-validation.json", all_runs, all_tasks, "count from frozen execution plan and raw runs"
        if path.startswith("quality"):
            return "data-quality.json", all_runs, all_tasks, "observed/expected from instrumentation coverage"
        if path.startswith("figures"):
            return "paired-a-d.csv", all_runs, all_tasks, "paired observations from A and D"
        return "statistics.json", all_runs, all_tasks, "see statistics.json and report-model.json"
    def walk(value: Any, path: str) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key in {"rawTelemetry", "references"}:
                    continue
                walk(item, f"{path}.{key}" if path else key)
        elif isinstance(value, list):
            for index, item in enumerate(value):
                walk(item, f"{path}[{index}]")
        elif isinstance(value, (int, float)) and not isinstance(value, bool):
            if path.endswith(".percentage") or path.endswith(".value") or "statistics" in path or "execution" in path or "quality" in path or "tables" in path or "figures" in path or "abstract" in path:
                section = path.split(".")[0]
                artifact, source_runs, source_tasks, formula = source_for(path)
                entries.append({"value": value, "metricId": path, "batchId": model["batchId"],
                                "sourceArtifact": artifact, "sourceRuns": source_runs,
                                "sourceBaseTasks": source_tasks,
                                "formula": formula,
                                "reportSection": section})
    walk(model, "")
    for section in model.get("sections", []):
        title = section.get("title", "")
        match = re.match(r"(RQ1-[AB]|RQ(?:[2-9]|10|11))", title)
        rq_id = match.group(1).replace("-", "_") if match else None
        for paragraph_index, paragraph in enumerate(section.get("paragraphs", [])):
            for number_index, found in enumerate(re.finditer(r"(?<![A-Za-z0-9])\d+(?:[.,]\d+)?%?(?![A-Za-z0-9])", paragraph)):
                token = found.group()
                artifact, source_runs, source_tasks, formula = source_for(f"statistics.researchQuestions.{rq_id}" if rq_id else "statistics")
                entries.append({"value": token, "metricId": f"sections.{title}.paragraphs[{paragraph_index}].number[{number_index}]",
                                "batchId": model["batchId"], "sourceArtifact": artifact,
                                "sourceRuns": source_runs, "sourceBaseTasks": source_tasks,
                                "formula": formula, "reportSection": title})
    for table_index, table in enumerate(model.get("tables", [])):
        section = table.get("section", "")
        match = re.match(r"(RQ1-[AB]|RQ(?:[2-9]|10|11))", section)
        rq_id = match.group(1).replace("-", "_") if match else None
        _, source_runs, source_tasks, formula = source_for(
            f"statistics.researchQuestions.{rq_id}" if rq_id else "statistics")
        for row_index, row in enumerate(table.get("rows", [])):
            for column_index, cell in enumerate(row):
                for number_index, found in enumerate(re.finditer(r"(?<![A-Za-z0-9])\d+(?:[.,]\d+)?%?(?![A-Za-z0-9])", str(cell))):
                    entries.append({"value": found.group(),
                                    "metricId": f"tables[{table_index}].rows[{row_index}][{column_index}].number[{number_index}]",
                                    "batchId": model["batchId"], "sourceArtifact": table.get("source"),
                                    "sourceRuns": source_runs, "sourceBaseTasks": source_tasks,
                                    "formula": formula, "reportSection": section})
    return entries


def _latex(value: Any) -> str:
    text = _safe_text(value)
    escaped = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_", "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\textasciicircum{}"}
    return "".join(escaped.get(char, char) for char in text)


def _citation_text(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        return r"\citep{" + ",".join(match.group(1).split("; ")) + "}"
    return re.sub(r"\[([a-z0-9]+(?:; [a-z0-9]+)*)\]", replace, _latex(text))


def _table_cell(value: Any) -> str:
    """Allow line breaks in narrow columns without reducing font size."""
    chunks = re.sub(r"([A-Za-zÀ-ÿ0-9]{7})(?=[A-Za-zÀ-ÿ0-9])", r"\1<wbr>", _safe_text(value)).split("<wbr>")
    return r"\allowbreak{}".join(_latex(chunk).replace(r"\_", r"\_\allowbreak{}") for chunk in chunks)


def render_figures(model: dict[str, Any], batch_dir: Path) -> list[str]:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    result = []
    out_dir = batch_dir / "figures"
    if out_dir.is_dir():
        for old in out_dir.iterdir():
            if old.is_file() and old.suffix in {".pdf", ".png"}:
                old.unlink()
        manifest = out_dir / "manifest.json"
        if manifest.is_file():
            manifest.unlink()
    for figure in model["figures"]:
        data = figure["data"]
        if not data:
            continue
        out_dir.mkdir(exist_ok=True)
        plt.rcParams.update({"font.size": 14, "axes.labelsize": 14, "axes.titlesize": 15,
                             "xtick.labelsize": 13, "ytick.labelsize": 13, "legend.fontsize": 13})
        fig, ax = plt.subplots(figsize=(6.4, 3.8))
        if figure["id"] == "paired-tokens":
            x = range(len(data))
            ax.plot(x, [row["leftTokens"] for row in data], "o-", color="black", label="A: direto")
            ax.plot(x, [row["rightTokens"] for row in data], "s--", color="#555555", label="D: BSH")
            ax.set_xticks(list(x), [row["baseTaskId"] for row in data], rotation=45, ha="right")
            ax.set_ylabel("Tokens totais observados")
            ax.legend()
        elif figure["id"] == "fig-matrix":
            matriz = data["values"]
            ax.imshow(matriz, cmap="tab10", aspect="auto", vmin=0, vmax=9)
            ax.set_xticks(range(len(data["cols"])), data["cols"])
            ax.set_yticks(range(len(data["rows"])), data["rows"])
            ax.set_xlabel("condição")
            ax.set_ylabel("tarefa-base")
        else:
            labels = data.get("labels", [])
            values = data.get("values", [])
            ax.bar(range(len(labels)), values, color="#4C72B0")
            ax.set_xticks(range(len(labels)), labels, rotation=90, ha="center")
            ax.set_ylabel(figure.get("ylabel") or "execuções")
            for index, value in enumerate(values):
                ax.text(index, value, str(value), ha="center", va="bottom")
        fig.tight_layout()
        for extension in ("pdf", "png"):
            fig.savefig(out_dir / f"{figure['id']}.{extension}", dpi=300)
        plt.close(fig)
        result.append(figure["id"])
    if result:
        write_json(out_dir / "manifest.json", {"batchId": model["batchId"],
                                                "scientificContentHash": model["scientificContentHash"],
                                                "figures": result})
    return result


def _appendix_prompts(batch_dir: Path) -> list[str]:
    """Apêndice com o prompt integral efetivamente enviado ao agente em cada run do batch."""
    results: dict[str, str] = {}
    for path in sorted((batch_dir / "executions").glob("*/result.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        run_id = data.get("runId")
        if run_id:
            results[str(run_id)] = str(data.get("baseTaskId") or data.get("taskId") or "")
    tasks: dict[str, str] = {}
    tasks_path = batch_dir / "tasks.json"
    if tasks_path.is_file():
        for task in json.loads(tasks_path.read_text(encoding="utf-8")).get("tarefas", []):
            tasks[str(task.get("baseTaskId") or task.get("id"))] = str(task.get("prompt", ""))
    order: list[str] = []
    metadata_path = batch_dir / "metadata.json"
    if metadata_path.is_file():
        ordem = json.loads(metadata_path.read_text(encoding="utf-8")).get("ordemExecucao")
        if isinstance(ordem, list):
            order = [str(run_id) for run_id in ordem if str(run_id) in results]
    if not order:
        order = sorted(results)
    lines = [r"\clearpage",
             r"\section*{Apêndice --- Prompts utilizados nas execuções experimentais}",
             r"\addcontentsline{toc}{section}{Apêndice --- Prompts utilizados nas execuções experimentais}"]
    for run_id in order:
        prompt = tasks.get(results.get(run_id, ""), "")
        lines.append(r"\noindent\textbf{" + _latex(run_id) + r":}\par")
        lines.append(r"\begin{sloppypar}" + _latex(prompt) + r"\end{sloppypar}")
        lines.append(r"\par\bigskip")
    return lines


def _figure_latex(figure: dict[str, Any]) -> list[str]:
    return ["A Figura~\\ref{fig:" + figure["id"] + "} responde: " + _latex(figure.get("question", "questão desta seção")) + ".",
            r"\begin{figure}[H]\centering\includegraphics[width=0.84\textwidth]{../figures/" + figure["id"] + r".pdf}",
            r"\caption{" + _latex(figure["title"]) + "; n=" + str(figure["n"]) + "; fonte: " + _latex(figure["source"]) + r"}\label{fig:" + figure["id"] + r"}\end{figure}",
            _latex(figure.get("interpretation", "Os pontos mostram o consumo observado por tarefa-base; linhas conectam medidas dentro de cada condição. Não representam intervalo de confiança."))]


def verify_report_contract(model: dict[str, Any], tex_text: str) -> list[str]:
    violations: list[str] = []
    for table_number, table in enumerate(model.get("tables", []), 1):
        if _latex(table["title"]) not in tex_text:
            violations.append("TABELA_TITULO_AUSENTE:" + str(table_number))
        if "n=" + str(table["n"]) not in tex_text:
            violations.append("TABELA_N_AUSENTE:" + str(table_number))
        if "unidades: " + _latex(table["units"]) not in tex_text:
            violations.append("TABELA_UNIDADES_AUSENTE:" + str(table_number))
        if "fonte: " + _latex(table["source"]) not in tex_text:
            violations.append("TABELA_FONTE_AUSENTE:" + str(table_number))
    for figure in model.get("figures", []):
        if "../figures/" + figure["id"] + ".pdf" not in tex_text:
            violations.append("FIGURA_ARQUIVO_AUSENTE:" + figure["id"])
        if "=" + str(figure["n"]) not in tex_text:
            violations.append("FIGURA_N_AUSENTE:" + figure["id"])
        if "fonte: " + _latex(figure["source"]) not in tex_text:
            violations.append("FIGURA_FONTE_AUSENTE:" + figure["id"])
    for item in model.get("references", []):
        if "{" + item["key"] + "}" not in tex_text:
            violations.append("REFERENCIA_AUSENTE:" + item["key"])
    return violations


def render_latex(model: dict[str, Any], batch_dir: Path) -> Path:
    report_dir = batch_dir / "report"
    report_dir.mkdir(exist_ok=True)
    abstract_results = "; ".join(f"{rq}: {verdict}" for rq, verdict in model["abstract"]["mainResults"].items())
    latex = [r"\documentclass[11pt,a4paper]{article}", r"\usepackage[utf8]{inputenc}",
             r"\usepackage[T1]{fontenc}", r"\usepackage[brazil]{babel}",
             r"\usepackage[margin=2.5cm]{geometry}", r"\usepackage{longtable,tabularx,booktabs,array,graphicx,float}",
             r"\usepackage{hyperref}", r"\usepackage[authoryear,round]{natbib}",
             r"\setlength{\parskip}{0.55em}", r"\setlength{\parindent}{0pt}", r"\sloppy",
             r"\begin{document}", r"\begin{titlepage}\centering", r"{\LARGE\bfseries " + _latex(model["title"]) + r"\par}",
             r"\vspace{2cm}{\large " + _latex(model["subtitle"]) + r"\par}",
             r"\vfill " + _latex(model["dataOrigin"]) + r"\end{titlepage}",
             r"\section*{Resumo}", _latex(model["abstract"]["objective"]) + ". " + _latex(model["abstract"]["design"]) + ". " + f"nRuns={model['abstract']['nRuns']}; nBaseTasks={model['abstract']['nBaseTasks']}. " + "Resultados centrais: " + _latex(abstract_results) + ". " + _latex("; ".join(model["abstract"]["limitations"])),
             r"\section*{Abstract}", "Experimental semantic governance assessment of the Business Semantic Harness. " + f"Observed runs: {model['abstract']['nRuns']}; base tasks: {model['abstract']['nBaseTasks']}. " + "Main results: " + _latex(abstract_results) + ". Conclusions are limited to the observed agent, model, domain and tasks.", r"\tableofcontents", r"\clearpage"]
    table_sections: dict[str, list[tuple[int, dict[str, Any]]]] = {}
    for table_number, table in enumerate(model["tables"], 1):
        table_sections.setdefault(table["section"], []).append((table_number, table))
    figures_by_section: dict[str, list[dict[str, Any]]] = {}
    for item in model["figures"]:
        figures_by_section.setdefault(item["section"], []).append(item)
    details: list[tuple[str, str, Any]] = []
    for index, section in enumerate(model["sections"], 1):
        label = f"sec:{index:02d}"
        latex.append(r"\section{" + _latex(section["title"]) + r"}\label{" + label + "}")
        latex.extend(_citation_text(paragraph) for paragraph in section["paragraphs"])
        for table_number, table in table_sections.get(section["title"], []):
            columns = len(table["headers"])
            latex.extend([r"\begin{longtable}{@{}" + ("p{" + f"{0.82 / columns:.3f}" + r"\textwidth}") * columns + "@{}}",
                          r"\caption{" + _latex(table["title"]) + "; unidades: " + _latex(table["units"]) + "; n=" + str(table["n"]) + "; fonte: " + _latex(table["source"]) + r"}\label{tab:" + str(table_number) + r"}\\",
                          r"\toprule " + " & ".join(_table_cell(header) for header in table["headers"]) + r"\\\midrule\endfirsthead"])
            for row_number, row in enumerate(table["rows"], 1):
                cells = []
                for column_number, value in enumerate(row, 1):
                    if len(_safe_text(value)) > 600:
                        reference = "detalhe-" + str(table_number) + "-" + str(row_number) + "-" + str(column_number)
                        detail_label = "Tabela " + str(table_number) + ", linha " + str(row_number) + ", coluna " + _safe_text(table["headers"][column_number - 1])
                        details.append((reference, detail_label, value))
                        cells.append(r"\textit{[valor integral na Seção~\ref{" + reference + "}]}")
                    else:
                        cells.append(_table_cell(value))
                latex.append(" & ".join(cells) + r"\\")
            latex.extend([r"\bottomrule", r"\end{longtable}"])
        for figure in figures_by_section.get(section["title"], []):
            latex.extend(_figure_latex(figure))
    latex.append(r"\section*{Referências}\addcontentsline{toc}{section}{Referências}")
    latex.append(r"\begin{thebibliography}{99}")
    for item in model["references"]:
        latex.append(r"\bibitem[" + _latex(item["author"]) + "(" + _latex(item["year"]) + ")]{" + item["key"] + "}" + _latex(item["entry"]))
    latex.append(r"\end{thebibliography}")
    latex.extend(_appendix_prompts(batch_dir))
    if details:
        latex.append(r"\section{Detalhamento de Valores Longos}")
        latex.append("Esta seção preserva integralmente os valores cujo conteúdo excede a largura de uma célula e não pode ser exibido em uma linha de tabela sem exceder a altura da página.")
        for reference, detail_label, value in details:
            latex.append(r"\subsection{" + _latex(detail_label) + r"}\label{" + reference + "}")
            latex.append(_latex(value))
    latex.append(r"\end{document}")
    path = report_dir / "report.tex"
    path.write_text("\n\n".join(latex) + "\n", encoding="utf-8")
    return path


class PDFLayoutGate:
    def validate(self, pdf_path: Path, output_dir: Path) -> dict[str, Any]:
        import fitz
        output_dir.mkdir(exist_ok=True)
        issues: list[dict[str, Any]] = []
        with fitz.open(pdf_path) as document:
            for page_number, page in enumerate(document, 1):
                page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(output_dir / f"page-{page_number:03d}.png")
                media = page.mediabox
                crop = page.cropbox
                if not media.contains(crop):
                    issues.append({"page": page_number, "type": "INVALID_CROPBOX"})
                blocks = page.get_text("dict")["blocks"]
                for block in blocks:
                    box = fitz.Rect(block["bbox"])
                    if not crop.contains(box):
                        issues.append({"page": page_number, "type": "CLIPPING", "bbox": list(box)})
                    if box.x0 < 18 or box.x1 > crop.width - 18 or box.y0 < 18 or box.y1 > crop.height - 18:
                        issues.append({"page": page_number, "type": "MARGIN_OVERFLOW", "bbox": list(box)})
                    if block["type"] == 0:
                        for line in block.get("lines", []):
                            for span in line.get("spans", []):
                                if span["text"].strip() and span["size"] < 8:
                                    issues.append({"page": page_number, "type": "FONT_BELOW_8PT", "fontSize": span["size"]})
                for left_index, left in enumerate(blocks):
                    for right in blocks[left_index + 1:]:
                        intersection = fitz.Rect(left["bbox"]) & fitz.Rect(right["bbox"])
                        if intersection.is_empty or intersection.get_area() < 4:
                            continue
                        if left["type"] != right["type"]:
                            issues.append({"page": page_number, "type": "TEXT_IMAGE_OVERLAP", "bbox": list(intersection)})
                        elif left["type"] == right["type"] == 0:
                            left_spans = [span for line in left.get("lines", []) for span in line.get("spans", []) if span.get("text", "").strip()]
                            right_spans = [span for line in right.get("lines", []) for span in line.get("spans", []) if span.get("text", "").strip()]
                            for left_span in left_spans:
                                for right_span in right_spans:
                                    overlap = fitz.Rect(left_span["bbox"]) & fitz.Rect(right_span["bbox"])
                                    smaller = min(fitz.Rect(left_span["bbox"]).get_area(), fitz.Rect(right_span["bbox"]).get_area())
                                    if not overlap.is_empty and smaller > 0 and overlap.get_area() / smaller > 0.25:
                                        issues.append({"page": page_number, "type": "TEXT_TEXT_OVERLAP", "bbox": list(overlap)})
            count = len(document)
        return {"status": "PASS" if not issues else "PUBLICATION_BLOCK", "pagesRendered": count,
                "issues": issues, "pdfValid": count > 0 and not issues}


def compile_and_validate(tex_path: Path, model: dict[str, Any]) -> dict[str, Any]:
    report_dir = tex_path.parent
    log_text = ""
    for _ in range(3):
        result = subprocess.run(["pdflatex", "-halt-on-error", "-interaction=nonstopmode", tex_path.name],
                                cwd=report_dir, capture_output=True, text=True, errors="replace", timeout=180, check=False)
        log_text = result.stdout + result.stderr
        if result.returncode:
            return {"status": "PUBLICATION_BLOCK", "crossReferencesValid": False, "citationsValid": False,
                    "layoutValid": False, "pdfValid": False, "issues": ["LaTeX compilation failed", log_text[-2000:]]}
    log_file = tex_path.with_suffix(".log")
    if log_file.is_file():
        log_text = log_file.read_text(encoding="utf-8", errors="replace")
    cross_ok = not re.search(r"undefined references?|multiply defined|duplicate label|Overfull \\hbox|Overfull \\vbox", log_text, re.IGNORECASE)
    citations_ok = not re.search(r"undefined citations?|Citation .* undefined", log_text, re.IGNORECASE)
    layout = PDFLayoutGate().validate(tex_path.with_suffix(".pdf"), report_dir / "layout-pages")
    issues = list(layout["issues"])
    if not cross_ok:
        issues.append({"type": "CROSS_REFERENCE_OR_OVERFLOW"})
    if not citations_ok:
        issues.append({"type": "UNDEFINED_CITATION"})
    return {"status": "PASS" if not issues else "PUBLICATION_BLOCK", "crossReferencesValid": cross_ok,
            "citationsValid": citations_ok, "layoutValid": layout["status"] == "PASS", "pdfValid": layout["pdfValid"],
            "pagesRendered": layout["pagesRendered"], "issues": issues}
