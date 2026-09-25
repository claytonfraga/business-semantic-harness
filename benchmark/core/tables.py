"""Geração das Tabelas Obrigatórias A a G em LaTeX para o BSH Benchmark (Seção 62)."""

from typing import Any, Dict, List, Optional


def _esc(txt: Any) -> str:
    """Escapa caracteres especiais para LaTeX."""
    if txt is None:
        return "NA"
    s = str(txt)
    return s.replace("_", r"\_").replace("%", r"\%").replace("&", r"\&").replace("#", r"\#")


def _fmt(val: Any, dec: int = 1) -> str:
    if val is None or str(val).lower() in ("none", "null", "na", "nan"):
        return "NA"
    try:
        return f"{float(val):,.{dec}f}"
    except Exception:
        return str(val)


def table_a_data_quality(quality: Dict[str, Any], measurements: List[Dict[str, Any]], paired: List[Dict[str, Any]]) -> str:
    """Tabela A — Qualidade dos Dados."""
    conds = sorted({str(m.get("condicao") or m.get("condition") or "") for m in measurements if (m.get("condicao") or m.get("condition"))})
    linhas = []
    for c in conds:
        c_runs = [m for m in measurements if (m.get("condicao") or m.get("condition")) == c]
        tot_execs = len(c_runs)
        complete_tel = sum(1 for m in c_runs if (m.get("totalTokens") is not None or m.get("totais") is not None) and m.get("classification") != "FALHA_TECNICA")
        changes = sum(1 for m in c_runs if m.get("changeSetDetected") or (m.get("arquivos", 0) > 0))
        success = sum(1 for m in c_runs if (m.get("functionalSuccess") is True) or (m.get("classification") in ("ALTERACAO_CORRETA", "BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA")))
        failures = sum(1 for m in c_runs if m.get("classification") in ("FALHA_TECNICA", "FALHA_INSTRUMENTACAO"))
        elig = quality.get("completeTokenPairs", 0) if c in ("A", "D") else "NA"
        linhas.append(f"Condição {c} & {tot_execs} & {complete_tel} & {changes} & {success} & {failures} & {elig} \\\\")

    return r"""\begin{table}[ht]
\centering
\small
\caption{Qualidade dos Dados Experimentais por Condição}
\label{tab:data-quality}
\begin{tabular}{lcccccc}
\toprule
Condição & Execuções & Telemetria Completa & Alterações Observadas & Sucessos Funcionais & Falhas & Pares Elegíveis \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
\end{table}"""


def table_b_behavioral_equivalence(paired: List[Dict[str, Any]]) -> str:
    """Tabela B — Equivalência Comportamental."""
    linhas = []
    for p in paired:
        tid = _esc(p.get("taskId"))
        res_a = _esc(p.get("classificationA"))
        res_d = _esc(p.get("classificationD"))
        eq = _esc(p.get("behavioralEquivalence"))
        motivo = "Ambas concluídas com sucesso" if eq == "EQUIVALENTE" else (_esc(p.get("exclusionReason")) or "Desfechos divergentes")
        linhas.append(f"{tid} & {res_a} & {res_d} & {eq} & {motivo} \\\\")

    return r"""\begin{table}[ht]
\centering
\small
\caption{Avaliação de Equivalência Comportamental entre as Condições A e D}
\label{tab:behavioral-equivalence}
\begin{tabular}{lcccc}
\toprule
Tarefa & Resultado Condição A & Resultado Condição D & Equivalência & Motivo \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
\end{table}"""


def table_c_semantic_recognition(measurements: List[Dict[str, Any]], tasks: Optional[List[Dict[str, Any]]] = None) -> str:
    """Tabela C — Reconhecimento Semântico."""
    t_map = {t["id"]: t for t in (tasks or []) if isinstance(t, dict) and "id" in t}
    d_runs = [m for m in measurements if (m.get("condicao") or m.get("condition")) == "D"]
    linhas = []

    for m in d_runs:
        tid = str(m.get("tarefa") or m.get("taskId") or "").split("-")[0].split("#")[0]
        tinfo = t_map.get(tid, {})
        exp_op = _esc(tinfo.get("operacao") or m.get("expectedGovernedOperation"))
        id_op = _esc(m.get("identifiedOperation"))
        exp_sh = _esc((tinfo.get("shape") or "").split(":")[-1] or m.get("expectedShape"))
        id_sh = _esc(", ".join(m.get("identifiedShapes") or []) or "Nenhum")
        res = "Correto" if (id_op != "NA" and id_op == exp_op) else "Não reconhecido"
        linhas.append(f"{_esc(m.get('taskId') or m.get('runId'))} & {exp_op} & {id_op} & {exp_sh} & {id_sh} & {res} \\\\")

    if not linhas:
        linhas.append(r"\multicolumn{6}{c}{Nenhuma execução na Condição D observada.} \\")

    return r"""\begin{table}[ht]
\centering
\small
\caption{Reconhecimento Semântico de Operações e Shapes Governados (Condição D)}
\label{tab:semantic-recognition}
\begin{tabular}{lccccc}
\toprule
Tarefa & Operação Esperada & Operação Identificada & Shape Esperado & Shape Identificado & Resultado \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
\end{table}"""


def table_d_governance_mechanisms(paired: List[Dict[str, Any]]) -> str:
    """Tabela D — Mecanismo de Governança."""
    linhas = []
    for p in paired:
        tid = _esc(p.get("taskId"))
        q_ont = "Sim" if p.get("ontologyQueried") else "Não"
        rep_c = "Sim" if p.get("reportConflictCalled") else "Não"
        wt_ch = "Sim" if p.get("changeSetDetected") else "Não"
        enf_obs = "Sim" if p.get("enforcementObserved") else "Não"
        hum_rev = "Sim" if p.get("classificationD") == "REVISAO_HUMANA" else "Não"
        mech = _esc(p.get("governanceMechanismD"))
        res = _esc(p.get("classificationD"))
        linhas.append(f"{tid} & {q_ont} & {rep_c} & {wt_ch} & {enf_obs} & {hum_rev} & {mech} & {res} \\\\")

    return r"""\begin{table}[ht]
\centering
\small
\caption{Mecanismos de Governança Observados por Tarefa (Condição D)}
\label{tab:governance-mechanisms}
\begin{tabular}{lccccccc}
\toprule
Tarefa & Consulta Ont. & Report Conflito & Alteração Worktree & Enforcement & Revisão Humana & Mecanismo & Resultado \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
\end{table}"""


def table_e_equivalent_efficiency(paired: List[Dict[str, Any]]) -> str:
    """Tabela E — Eficiência sob Equivalência Comportamental."""
    equiv = [p for p in paired if p.get("behavioralEquivalence") == "EQUIVALENTE" and p.get("eligibleForTokenAnalysis")]
    linhas = []
    for p in equiv:
        tid = _esc(p.get("taskId"))
        tok_a = _fmt(p.get("tokensA"), 0)
        tok_d = _fmt(p.get("tokensD"), 0)
        dif_abs = _fmt(p.get("differenceTokens"), 0)
        dif_pct = f"{_fmt(p.get('percentageDifference'), 1)}\\%"
        fac = _fmt(p.get("costFactor"), 2)
        tmp_a = _fmt(p.get("durationA"), 1)
        tmp_d = _fmt(p.get("durationD"), 1)
        linhas.append(f"{tid} & {tok_a} & {tok_d} & {dif_abs} & {dif_pct} & {fac} & {tmp_a} & {tmp_d} \\\\")

    if not linhas:
        linhas.append(r"\multicolumn{8}{c}{Nenhum par elegível com equivalência comportamental comprovada.} \\")

    return r"""\begin{table}[ht]
\centering
\small
\caption{Comparação de Consumo de Tokens e Tempo sob Equivalência Comportamental (RQ1.1)}
\label{tab:equivalent-efficiency}
\begin{tabular}{lccccccc}
\toprule
Tarefa & Tokens Cond. A & Tokens Cond. D & Diferença & Variação (\%) & Fator de Custo & Tempo A (s) & Tempo D (s) \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
\end{table}"""


def table_f_violating_tasks(paired: List[Dict[str, Any]]) -> str:
    """Tabela F — Tarefas Violadoras."""
    vios = [p for p in paired if str(p.get("taskType", "")).lower() in ("violadora", "violating")]
    linhas = []
    for p in vios:
        tid = _esc(p.get("taskId"))
        res_a = _esc(p.get("classificationA"))
        res_d = _esc(p.get("classificationD"))
        mech = _esc(p.get("governanceMechanismD"))
        tok_a = _fmt(p.get("tokensA"), 0)
        tok_d = _fmt(p.get("tokensD"), 0)
        econ = _fmt(p["tokensA"] - p["tokensD"], 0) if (p.get("tokensA") is not None and p.get("tokensD") is not None) else "NA"
        linhas.append(f"{tid} & {res_a} & {res_d} & {mech} & {tok_a} & {tok_d} & {econ} \\\\")

    return r"""\begin{table}[ht]
\centering
\small
\caption{Desfechos e Balanço de Consumo em Tarefas Violadoras}
\label{tab:violating-tasks}
\begin{tabular}{lcccccc}
\toprule
Tarefa & Resultado Condição A & Resultado Condição D & Mecanismo & Tokens A & Tokens D & Economia Evitada \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
\end{table}"""


def table_g_agent_capabilities(capabilities: Dict[str, Any], metadata: Dict[str, Any]) -> str:
    """Tabela G — Capacidades de Telemetria do Agente."""
    ag = _esc(capabilities.get("agentName", metadata.get("agente", "Agy")))
    mod = _esc(metadata.get("modelo", "gemini-3.7-flash-low"))
    inp = "Suportado" if capabilities.get("supportsInputTokens") else "Não suportado"
    cac = "Suportado" if capabilities.get("supportsCachedInputTokens") else "Não suportado"
    out = "Suportado" if capabilities.get("supportsOutputTokens") else "Não suportado"
    rac = "Suportado" if capabilities.get("supportsReasoningTokens") else "Não suportado"
    tot = "Suportado" if capabilities.get("supportsTotalTokens") else "Não suportado"
    mcp = "Suportado" if capabilities.get("supportsMcp") else "Não suportado"
    evt = "Suportado" if capabilities.get("supportsStructuredTelemetry") else "Não suportado"
    obs = "Telemetria direta SQLite decodificada"

    return rf"""\begin{{table}}[ht]
\centering
\small
\caption{{Perfil de Capacidades e Observabilidade do Agente Avaliado}}
\label{{tab:agent-capabilities}}
\begin{{tabular}}{{lc}}
\toprule
Propriedade / Recurso & Suporte Declarado pelo Adaptador \\
\midrule
Agente Experimental & {ag} \\
Modelo de Linguagem & {mod} \\
Telemetria de Tokens de Entrada & {inp} \\
Telemetria de Tokens Cacheados & {cac} \\
Telemetria de Tokens de Saída & {out} \\
Telemetria de Tokens de Raciocínio & {rac} \\
Tokens Totais & {tot} \\
Suporte a Model Context Protocol (MCP) & {mcp} \\
Telemetria Estruturada & {evt} \\
Método de Coleta & {obs} \\
\bottomrule
\end{{tabular}}
\end{{table}}"""


def generate_all_latex_tables(
    quality: Dict[str, Any],
    measurements: List[Dict[str, Any]],
    paired: List[Dict[str, Any]],
    capabilities: Dict[str, Any],
    metadata: Dict[str, Any],
    tasks: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, str]:
    """Gera todas as tabelas LaTeX obrigatórias A a G."""
    return {
        "tab_a": table_a_data_quality(quality, measurements, paired),
        "tab_b": table_b_behavioral_equivalence(paired),
        "tab_c": table_c_semantic_recognition(measurements, tasks),
        "tab_d": table_d_governance_mechanisms(paired),
        "tab_e": table_e_equivalent_efficiency(paired),
        "tab_f": table_f_violating_tasks(paired),
        "tab_g": table_g_agent_capabilities(capabilities, metadata),
    }
