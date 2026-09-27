"""Report model, provenance, LaTeX rendering and publication layout gate.

The renderer receives only report-model.json.  It performs formatting, never
statistical calculation or inference from raw runs.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any

from .experimental_execution import canonical_json, read_json, sha256_file, write_json


TITLE = "Avaliação Experimental de Governança Semântica no Business Semantic Harness"
SECTION_TITLES = [
    "Introdução", "Fundamentação", "Arquitetura do BSH", "Desenho Experimental",
    "Condições Experimentais", "Questões de Pesquisa", "Variáveis e Estimandos",
    "Ground Truth e Oracles", "Instrumentação", "Integridade da Execução Experimental",
    "Qualidade e Completude dos Dados", "Pareabilidade", "Resultados Funcionais",
    "RQ1-A: Consumo Bruto", "RQ1-B: Eficiência sob Equivalência", "RQ2: Benefício Computacional",
    "RQ3: Regras Textuais", "RQ4: Ontologia Consultiva", "RQ5: BSH Completo",
    "RQ6: Reconhecimento Semântico", "RQ7: Mecanismos de Governança",
    "RQ8: Tokens versus Tempo", "RQ9: Distribuição", "RQ10: Testes versus Semântica",
    "RQ11: Independência do Harness", "Falsos Bloqueios", "Violações Não Detectadas",
    "Enforcement Independente", "Matriz de Evidências", "Respostas às Questões de Pesquisa",
    "Discussão", "Ameaças à Validade", "Reprodutibilidade", "Conclusão",
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


def _conclusion_paragraphs(stats: dict[str, Any], verdicts: dict[str, Any]) -> list[str]:
    questions = stats.get("researchQuestions", {}) if isinstance(stats, dict) else {}

    def verdict(rq_id: str) -> str:
        try:
            return verdicts["researchQuestions"][rq_id]["verdict"]
        except (KeyError, TypeError):
            return "NAO_AVALIADO"

    def status(rq_id: str) -> str:
        entry = questions.get(rq_id, {})
        return str(entry.get("status", "NAO_AVALIADA"))

    c_metric = questions.get("RQ4", {}).get("metric") or {}
    d_metric = questions.get("RQ5", {}).get("metric") or {}
    independent = d_metric.get("independentEnforcementActivated")
    return [
        "A conclusão distingue o valor do BSH consultivo do valor adicional do enforcement independente "
        "e não trata C e D como equivalentes.",
        "1) Regras textuais (A × B): veredito " + verdict("RQ3") + " (" + status("RQ3") + ").",
        "2) Introdução do BSH consultivo (B × C): veredito " + verdict("RQ4") + " (" + status("RQ4") + "). "
        "Se C já evita alterações por consulta semântica, isso representa utilidade do BSH mesmo sem o gate.",
        "3) Enforcement independente (C × D): veredito " + verdict("RQ5") + " (" + status("RQ5") + "); "
        "ativações independentes observadas em D: " + str(independent) + ". Se o benefício adicional de D "
        "sobre C não aparecer claramente, isso é declarado objetivamente, sem concluir equivalência entre C e D.",
        "4) Efeito global do BSH completo (A × D): veredito " + verdict("RQ1_A") + " (" + status("RQ1_A") + ").",
        "Esta conclusão é construída apenas a partir dos resultados observados nesta campanha; não antecipa "
        "superioridade de nenhuma condição.",
    ]


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
        "Desenho Experimental": "A unidade de execução é a run; a unidade conceitual de generalização é a tarefa-base. Réplicas repetem uma tarefa e não aumentam nBaseTasks. Ordem, bloqueamento e parâmetros são lidos exclusivamente do plano e dos metadados congelados nesta Execução Experimental.",
        "Condições Experimentais": "A executa o agente diretamente; B adiciona regras textuais; C adiciona ontologia consultiva; D usa o BSH completo. A × D mede efeito conjunto; A × B, B × C e C × D exploram componentes progressivos sem presumir causalidade.",
        "Variáveis e Estimandos": "Condição é a variável independente. Consumo de tokens, duração, correção funcional, correção de governança e desfecho da tarefa são variáveis dependentes distintas. WORKLOAD_TOKEN_REDUCTION é 1 menos a razão entre a soma de tokens D e a soma de tokens A, somente em pares com contabilidade comparável e denominador positivo.",
        "Ground Truth e Oracles": "expectedOperation e expectedShapes são lidos do manifesto de tarefas congelado no batch. identifiedOperation e identifiedShapes são lidos das evidências da execução. Precision e recall são publicados somente se as fontes independentes forem verificáveis.",
        "Instrumentação": "O adapter registra runtime, telemetria de tokens, duração, diff, testes, consultas MCP, conflitos e status de enforcement. Valor ausente permanece nulo; zero indica medição explícita de zero. Tokens não cacheados não são derivados sem garantia documentada da semântica do runtime.",
        "Resultados Funcionais": "Cumprimento do pedido, correção funcional, correção de governança e correção do desfecho são dimensões independentes. Uma violação evitada pode ter desfecho correto sem entregar o pedido literal.",
        "Discussão": "Os resultados favoráveis, desfavoráveis e não calculáveis são apresentados separadamente. Diferenças de tokens após bloqueio não equivalem a maior eficiência na entrega da mesma funcionalidade. Mecanismos não observados não recebem atribuição causal.",
        "Ameaças à Validade": "Validade interna: mecanismos podem não estar isolados. Validade externa: um único domínio, agente ou modelo restringe generalização. Validade de construto: testes técnicos não provam conformidade semântica. Validade de conclusão: tarefas-base e oportunidades podem ser insuficientes para inferência populacional.",
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
    sections.append({"title": "Conclusão", "paragraphs": _conclusion_paragraphs(stats, verdicts)})
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
        fig, ax = plt.subplots(figsize=(7.2, 4.2))
        x = range(len(data))
        ax.plot(x, [row["leftTokens"] for row in data], "o-", color="black", label="A: direto")
        ax.plot(x, [row["rightTokens"] for row in data], "s--", color="#555555", label="D: BSH")
        ax.set_xticks(list(x), [row["baseTaskId"] for row in data], rotation=45, ha="right")
        ax.set_ylabel("Tokens totais observados")
        ax.legend()
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
    figures_by_section = {item["section"]: item for item in model["figures"]}
    for index, section in enumerate(model["sections"], 1):
        label = f"sec:{index:02d}"
        latex.append(r"\section{" + _latex(section["title"]) + r"}\label{" + label + "}")
        latex.extend(_citation_text(paragraph) for paragraph in section["paragraphs"])
        for table_number, table in table_sections.get(section["title"], []):
            columns = len(table["headers"])
            latex.extend([r"\begin{longtable}{@{}" + ("p{" + f"{0.82 / columns:.3f}" + r"\textwidth}") * columns + "@{}}",
                          r"\caption{" + _latex(table["title"]) + "; unidades: " + _latex(table["units"]) + "; n=" + str(table["n"]) + "; fonte: " + _latex(table["source"]) + r"}\label{tab:" + str(table_number) + r"}\\",
                          r"\toprule " + " & ".join(_table_cell(header) for header in table["headers"]) + r"\\\midrule\endfirsthead"])
            for row in table["rows"]:
                latex.append(" & ".join(_table_cell(value) for value in row) + r"\\")
            latex.extend([r"\bottomrule", r"\end{longtable}"])
        if section["title"] in figures_by_section:
            figure = figures_by_section[section["title"]]
            latex.extend(["A Figura~\\ref{fig:" + figure["id"] + "} apresenta os pares elegíveis desta questão.",
                          r"\begin{figure}[H]\centering\includegraphics[width=0.84\textwidth]{../figures/" + figure["id"] + r".pdf}",
                          r"\caption{" + _latex(figure["title"]) + "; n=" + str(figure["n"]) + "; fonte: " + _latex(figure["source"]) + r"}\label{fig:" + figure["id"] + r"}\end{figure}",
                          "Os pontos mostram o consumo observado por tarefa-base; linhas conectam medidas dentro de cada condição. Não representam intervalo de confiança."])
    latex.append(r"\section*{Referências}\addcontentsline{toc}{section}{Referências}")
    latex.append(r"\begin{thebibliography}{99}")
    for item in model["references"]:
        latex.append(r"\bibitem[" + _latex(item["author"]) + "(" + _latex(item["year"]) + ")]{" + item["key"] + "}" + _latex(item["entry"]))
    latex.append(r"\end{thebibliography}")
    latex.extend(_appendix_prompts(batch_dir))
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
