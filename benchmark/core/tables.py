"""Geração das Tabelas Obrigatórias do BSH Benchmark (Seções 44, 45, 46, 47, 62, 63)."""

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
    """Tabela de equivalência (Seção 47).
    Colunas: Tarefa, Resultado A, Resultado D, Testes A, Testes D, Equivalência, Motivo, Tokens A, Tokens D, Percentual economizado ou gasto a mais.
    """
    linhas = []
    for p in paired:
        tid = _esc(p.get("taskId"))
        res_a = _esc(p.get("classificationA"))
        res_d = _esc(p.get("classificationD"))
        t_a = "Aprovados" if p.get("testsPassedA") is True else ("Reprovados" if p.get("testsPassedA") is False else "NA")
        t_d = "Aprovados" if p.get("testsPassedD") is True else ("Reprovados" if p.get("testsPassedD") is False else "NA")
        eq = _esc(p.get("behavioralEquivalence"))
        motivo = _esc("Ambas concluídas com sucesso" if eq == "EQUIVALENTE" else (p.get("exclusionReason") or "Desfechos divergentes"))
        tok_a = _fmt(p.get("tokensA"), 0)
        tok_d = _fmt(p.get("tokensD"), 0)

        # Percentual economizado ou gasto a mais
        if p.get("tokensA") is not None and p.get("tokensD") is not None and p["tokensA"] > 0:
            if p["tokensD"] < p["tokensA"]:
                pct_str = f"-{_fmt(p.get('tokensSavedPercentage'), 1)}\\% (econ.)"
            elif p["tokensD"] > p["tokensA"]:
                pct_str = f"+{_fmt(p.get('tokensExtraPercentage'), 1)}\\% (overhead)"
            else:
                pct_str = "0.0\\%"
        else:
            pct_str = "NA"

        linhas.append(f"{tid} & {res_a} & {res_d} & {t_a} & {t_d} & {eq} & {motivo} & {tok_a} & {tok_d} & {pct_str} \\\\")

    return r"""\begin{table}[ht]
\centering
\scriptsize
\caption{Avaliação de Equivalência Comportamental e Desempenho (Seção 47)}
\label{tab:behavioral-equivalence}
\resizebox{\textwidth}{!}{
\begin{tabular}{lccccccccc}
\toprule
Tarefa & Res. A & Res. D & Testes A & Testes D & Equivalência & Motivo & Tokens A & Tokens D & Variação (\% economizado / gasto) \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
}
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
\resizebox{\textwidth}{!}{
\begin{tabular}{lccccc}
\toprule
Tarefa & Operação Esperada & Operação Identificada & Shape Esperado & Shape Identificado & Resultado \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
}
\end{table}"""


def table_d_governance_mechanisms(paired: List[Dict[str, Any]]) -> str:
    """Tabela D — Mecanismo de Governança."""
    linhas = []
    for p in paired:
        tid = _esc(p.get("taskId"))
        q_ont = "Sim" if p.get("ontologyQueried") or p.get("dOntologyQueried") else "Não"
        rep_c = "Sim" if p.get("reportConflictCalled") or p.get("dConflictReported") else "Não"
        wt_ch = "Sim" if p.get("changeSetDetected") or p.get("dChangeSetDetected") else "Não"
        enf_obs = "Sim" if p.get("enforcementObserved") or p.get("dEnforcementObserved") else "Não"
        hum_rev = "Sim" if p.get("classificationD") == "REVISAO_HUMANA" else "Não"
        mech = _esc(p.get("governanceMechanismD"))
        res = _esc(p.get("classificationD"))
        linhas.append(f"{tid} & {q_ont} & {rep_c} & {wt_ch} & {enf_obs} & {hum_rev} & {mech} & {res} \\\\")

    return r"""\begin{table}[ht]
\centering
\small
\caption{Mecanismos de Governança Observados por Tarefa (Condição D)}
\label{tab:governance-mechanisms}
\resizebox{\textwidth}{!}{
\begin{tabular}{lccccccc}
\toprule
Tarefa & Consulta Ont. & Report Conflito & Alteração Worktree & Enforcement & Revisão Humana & Mecanismo & Resultado \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
}
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
\resizebox{\textwidth}{!}{
\begin{tabular}{lccccccc}
\toprule
Tarefa & Tokens Cond. A & Tokens Cond. D & Diferença & Variação (\%) & Fator de Custo & Tempo A (s) & Tempo D (s) \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
}
\end{table}"""


def table_f_violating_tasks(paired: List[Dict[str, Any]]) -> str:
    """Tabela das tarefas violadoras (Seção 46).
    Colunas: Tarefa, Resultado A, Violação implementada em A, Testes passaram em A, Resultado D,
    Consulta à ontologia, Conflito reportado, Alteração candidata em D, Enforcement independente,
    Promoção, Tokens A, Tokens D, Tokens economizados, Percentual economizado.
    """
    vios = [p for p in paired if str(p.get("taskType", "")).lower() in ("violadora", "violating")]
    linhas = []
    for p in vios:
        tid = _esc(p.get("taskId"))
        res_a = _esc(p.get("classificationA"))
        vio_impl = "Sim" if p.get("aImplementedViolation") else "Não"
        tests_a = "Sim" if p.get("aTestsPassed") else "Não"
        res_d = _esc(p.get("classificationD"))
        ont_q = "Sim" if p.get("dOntologyQueried") else "Não"
        conf_rep = "Sim" if p.get("dConflictReported") else "Não"
        cand_d = "Sim" if p.get("dChangeSetDetected") else "Não"
        enf_ind = "Sim" if p.get("dEnforcementObserved") else "Não"
        prom_d = "Sim" if p.get("dPromoted") else "Não"
        tok_a = _fmt(p.get("tokensA"), 0)
        tok_d = _fmt(p.get("tokensD"), 0)
        tok_saved = _fmt(p.get("tokensSaved"), 0)
        pct_saved = f"{_fmt(p.get('tokensSavedPercentage'), 1)}\\%" if p.get("tokensSavedPercentage") is not None else "NA"

        linhas.append(
            f"{tid} & {res_a} & {vio_impl} & {tests_a} & {res_d} & {ont_q} & {conf_rep} & {cand_d} & {enf_ind} & {prom_d} & {tok_a} & {tok_d} & {tok_saved} & {pct_saved} \\\\"
        )

    return r"""\begin{table}[ht]
\centering
\scriptsize
\caption{Tarefas Violadoras: Mecanismos, Desfechos e Custo Evitado (Seção 46)}
\label{tab:violating-tasks}
\resizebox{\textwidth}{!}{
\begin{tabular}{lccccccccccccc}
\toprule
Tarefa & Res. A & Vio. Impl. A & Testes A & Res. D & Cons. Ont. & Conf. Rep. & Alt. Cand. D & Enforc. & Prom. & Tokens A & Tokens D & Economizados & Economia (\%) \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
}
\end{table}"""


def table_g_agent_capabilities(capabilities: Dict[str, Any], metadata: Dict[str, Any]) -> str:
    """Tabela G — Capacidades de Telemetria do Agente."""
    ag = _esc(capabilities.get("agentName", metadata.get("agente", "Agy")))
    mod = _esc(metadata.get("modelo", "gemini-3.7-flash-medium"))
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


def table_h_real_impact(paired: List[Dict[str, Any]]) -> str:
    """Tabela principal de impacto do BSH no consumo de tokens por tarefa (Seção 44).
    Colunas:
    Tarefa, Tipo, Resultado A, Resultado D, Mecanismo D, Tokens A, Tokens D,
    Tokens economizados, Tokens gastos a mais, Percentual economizado, Percentual gasto a mais,
    Variação percentual, Fator de custo, Equivalência comportamental, Interpretação econômica.
    """
    linhas = []
    for p in paired:
        tid = _esc(p.get("taskId"))
        tipo = _esc(p.get("taskType"))
        res_a = _esc(p.get("classificationA"))
        res_d = _esc(p.get("classificationD"))
        mech = _esc(p.get("governanceMechanismD"))
        tok_a = p.get("tokensA")
        tok_d = p.get("tokensD")

        if tok_a is None or tok_d is None:
            tok_a_str = "NA"
            tok_d_str = "NA"
            econ_str = "NA"
            gast_str = "NA"
            pct_econ_str = "NA"
            pct_gast_str = "NA"
            var_str = "NA"
            fac_str = "NA"
            interp = "DADOS_INSUFICIENTES"
        else:
            tok_a_str = _fmt(tok_a, 0)
            tok_d_str = _fmt(tok_d, 0)
            saved = p.get("tokensSaved") or 0.0
            extra = p.get("tokensExtra") or 0.0
            econ_str = _fmt(saved, 0)
            gast_str = _fmt(extra, 0)

            saved_pct = p.get("tokensSavedPercentage") or 0.0
            extra_pct = p.get("tokensExtraPercentage") or 0.0
            pct_econ_str = f"{_fmt(saved_pct, 1)}\\%"
            pct_gast_str = f"{_fmt(extra_pct, 1)}\\%"

            var_pct = p.get("percentageDifference")
            var_str = f"{_fmt(var_pct, 1)}\\%" if var_pct is not None else "NA"
            fac = p.get("costFactor")
            fac_str = _fmt(fac, 2) if fac is not None else "NA"
            interp = p.get("economicInterpretation", "NA")

        eq_str = _esc(p.get("behavioralEquivalence", "NA"))
        linhas.append(
            f"{tid} & {tipo} & {res_a} & {res_d} & {mech} & {tok_a_str} & {tok_d_str} & "
            f"{econ_str} & {gast_str} & {pct_econ_str} & {pct_gast_str} & {var_str} & {fac_str} & "
            f"{eq_str} & \\texttt{{{_esc(interp)}}} \\\\"
        )

    if not linhas:
        linhas.append(r"\multicolumn{15}{c}{Nenhum par disponível para análise de impacto.} \\")

    return r"""\begin{table}[ht]
\centering
\tiny
\caption{Impacto do BSH no consumo de tokens por tarefa (Seção 44)}
\label{tab:real-impact}
\resizebox{\textwidth}{!}{
\begin{tabular}{lcccccccccccccc}
\toprule
Tarefa & Tipo & Res. A & Res. D & Mec. D & Tokens A & Tokens D & Tokens Econ. & Tokens Gastos & Econ. (\%) & Gastos (\%) & Variação (\%) & Fator & Equiv. & Interpretação Econômica \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
}
\end{table}"""


def table_j_aggregated_categories(paired: List[Dict[str, Any]]) -> str:
    """Tabela agregada por categorias de tarefa (Seção 45).
    Colunas: Categoria, n, Tokens A, Tokens D, Tokens economizados, Tokens gastos a mais,
    Percentual economizado, Percentual gasto a mais.
    Categorias:
    - todas as observações elegíveis
    - tarefas válidas equivalentes
    - tarefas violadoras corretamente governadas
    - prevenção consultiva
    - conflito reportado
    - enforcement independente
    - fora do conhecimento
    - indeterminadas
    """
    eligible_all = [p for p in paired if p.get("eligibleForTokenAnalysis") and p.get("tokensA") is not None and p.get("tokensD") is not None]

    cats_def = [
        ("todas as observações elegíveis", eligible_all),
        (
            "tarefas válidas equivalentes",
            [p for p in eligible_all if str(p.get("taskType", "")).lower() in ("valida_governada", "valida", "valid") and p.get("behavioralEquivalence") == "EQUIVALENTE"]
        ),
        (
            "tarefas violadoras corretamente governadas",
            [p for p in eligible_all if str(p.get("taskType", "")).lower() in ("violadora", "violating") and p.get("dOutcomeCorrect") and p.get("aImplementedViolation")]
        ),
        (
            "prevenção consultiva",
            [p for p in eligible_all if str(p.get("taskType", "")).lower() in ("violadora", "violating") and p.get("governanceMechanismD") == "CONSULTA_PREVENTIVA" and p.get("dOutcomeCorrect")]
        ),
        (
            "conflito reportado",
            [p for p in eligible_all if str(p.get("taskType", "")).lower() in ("violadora", "violating") and p.get("governanceMechanismD") == "CONFLITO_REPORTADO" and p.get("dOutcomeCorrect")]
        ),
        (
            "enforcement independente",
            [p for p in eligible_all if str(p.get("taskType", "")).lower() in ("violadora", "violating") and p.get("governanceMechanismD") == "ENFORCEMENT_INDEPENDENTE" and p.get("dOutcomeCorrect")]
        ),
        (
            "fora do conhecimento",
            [p for p in eligible_all if str(p.get("taskType", "")).lower() == "fora_conhecimento"]
        ),
        (
            "indeterminadas",
            [p for p in eligible_all if str(p.get("taskType", "")).lower() == "indeterminada"]
        ),
    ]

    linhas = []
    for cat_name, items in cats_def:
        n = len(items)
        if n == 0:
            linhas.append(f"{_esc(cat_name)} & 0 & NA & NA & NA & NA & NA & NA \\\\")
            continue

        sum_a = sum(p["tokensA"] for p in items)
        sum_d = sum(p["tokensD"] for p in items)
        saved = max(0.0, sum_a - sum_d)
        extra = max(0.0, sum_d - sum_a)
        saved_pct = ((saved / sum_a) * 100.0) if sum_a > 0 else 0.0
        extra_pct = ((extra / sum_a) * 100.0) if sum_a > 0 else 0.0

        linhas.append(
            f"{_esc(cat_name)} & {n} & {_fmt(sum_a, 0)} & {_fmt(sum_d, 0)} & {_fmt(saved, 0)} & {_fmt(extra, 0)} & {_fmt(saved_pct, 1)}\\% & {_fmt(extra_pct, 1)}\\% \\\\"
        )

    return r"""\begin{table}[ht]
\centering
\small
\caption{Métricas Agregadas por Categoria de Tarefa (Seção 45)}
\label{tab:aggregated-categories}
\resizebox{\textwidth}{!}{
\begin{tabular}{lccccccc}
\toprule
Categoria & $n$ & Tokens A & Tokens D & Tokens Econ. & Tokens Gastos & Econ. (\%) & Gastos (\%) \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
}
\end{table}"""


def table_i_reproducibility(metadata: Dict[str, Any]) -> str:
    """Tabela de Reprodutibilidade e Auditoria (Seção 63).
    15 campos obrigatórios:
    batchId, dataOrigin, timestamp, agent, agentVersion, model, reasoningEffort,
    repositoryCommit, bshProductTreeHash, benchmarkTreeHash, pilotCommit,
    ontologyHash, shapesHash, taskManifestHash, configHash.
    """
    hashes = metadata.get("hashes", {})
    items = [
        ("batchId", metadata.get("lote"), "metadata.json", "Válido" if metadata.get("lote") else "Ausente"),
        ("dataOrigin", metadata.get("dataOrigin", "REAL_EXECUTION"), "metadata.json", "Válido" if metadata.get("dataOrigin") else "Ausente"),
        ("timestamp", metadata.get("timestampInicio") or metadata.get("timestamp"), "metadata.json", "Válido" if (metadata.get("timestampInicio") or metadata.get("timestamp")) else "Ausente"),
        ("agent", metadata.get("agente"), "config.yaml", "Válido" if metadata.get("agente") else "Ausente"),
        ("agentVersion", metadata.get("agentVersion") or metadata.get("agente"), "Adapter profile", "Válido"),
        ("model", metadata.get("modelo"), "config.yaml", "Válido" if metadata.get("modelo") else "Ausente"),
        ("reasoningEffort", metadata.get("esforco") or metadata.get("reasoningEffort"), "config.yaml", "Válido" if (metadata.get("esforco") or metadata.get("reasoningEffort")) else "Ausente"),
        ("repositoryCommit", hashes.get("repositoryCommit") or metadata.get("commitBsh"), "git rev-parse HEAD", "Válido" if (hashes.get("repositoryCommit") or metadata.get("commitBsh")) else "Ausente"),
        ("bshProductTreeHash", hashes.get("bshProductTreeHash") or metadata.get("bshProductTreeHash"), "src/ SHA-256", "Válido" if (hashes.get("bshProductTreeHash") or metadata.get("bshProductTreeHash")) else "Ausente"),
        ("benchmarkTreeHash", hashes.get("benchmarkTreeHash"), "benchmark/ SHA-256", "Válido" if hashes.get("benchmarkTreeHash") else "Ausente"),
        ("pilotCommit", hashes.get("pilotCommit") or hashes.get("repositoryCommit"), "git log -1 pilot", "Válido" if (hashes.get("pilotCommit") or hashes.get("repositoryCommit")) else "Ausente"),
        ("ontologyHash", hashes.get("ontologyHash"), "ontology.jsonld SHA-256", "Válido" if hashes.get("ontologyHash") else "Ausente"),
        ("shapesHash", hashes.get("shapesHash"), "shapes.ttl SHA-256", "Válido" if hashes.get("shapesHash") else "Ausente"),
        ("taskManifestHash", hashes.get("taskManifestHash"), "tasks.json SHA-256", "Válido" if hashes.get("taskManifestHash") else "Ausente"),
        ("configHash", hashes.get("configHash"), "config.yaml SHA-256", "Válido" if hashes.get("configHash") else "Ausente"),
    ]
    linhas = []
    for art, val, orig, st in items:
        val_str = _esc(str(val)[:22] + "..." if (val and len(str(val)) > 26 and not str(val).startswith("gemini")) else val)
        linhas.append(f"{_esc(art)} & \\texttt{{{val_str}}} & {_esc(orig)} & {_esc(st)} \\\\")

    return r"""\begin{table}[ht]
\centering
\small
\caption{Metadados de Reprodutibilidade e Auditoria do Lote Experimental (Seção 63)}
\label{tab:reproducibility}
\begin{tabular}{llcc}
\toprule
Campo & Valor & Origem & Status \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
\end{table}"""


def table_k_eligibility_and_exclusions(paired: List[Dict[str, Any]]) -> str:
    """Tabela de Elegibilidade e Exclusões Analíticas por Tarefa (Seções 64 e 65)."""
    linhas = []
    for p in paired:
        tid = _esc(p.get("taskId"))
        ttype = str(p.get("taskType", "")).lower()
        eq = p.get("behavioralEquivalence")

        # RQ1-A
        linhas.append(f"{tid} & RQ1-A (Consumo Bruto) & Sim & Telemetria válida em ambas as condições \\\\")
        # RQ1-B
        is_rq1_b = (eq == "EQUIVALENTE" and ttype in ("valida_governada", "valida", "valid"))
        st_b = "Sim" if is_rq1_b else "Não"
        mot_b = "Válida com equivalência funcional comprovada" if is_rq1_b else ("Violadora (trajetória divergente)" if ttype in ("violadora", "violating") else "Não equivalente funcionalmente")
        linhas.append(f"{tid} & RQ1-B (Equivalência) & {st_b} & {_esc(mot_b)} \\\\")
        # RQ2 Custo Evitado
        is_avoid = bool(ttype in ("violadora", "violating") and p.get("dOutcomeCorrect") and p.get("aImplementedViolation"))
        st_avoid = "Sim" if is_avoid else "Não"
        mot_avoid = "Violação executada em A e governada em D" if is_avoid else "Não aplicável para custo evitado"
        linhas.append(f"{tid} & RQ2 (Custo Evitado) & {st_avoid} & {_esc(mot_avoid)} \\\\")
        # RQ6 Reconhecimento
        is_rq6 = bool(ttype in ("valida_governada", "violadora"))
        st_6 = "Sim" if is_rq6 else "Não"
        mot_6 = "Operação governada do domínio" if is_rq6 else "Fora do conhecimento governado"
        linhas.append(f"{tid} & RQ6 (Reconhecimento) & {st_6} & {_esc(mot_6)} \\\\")

    return r"""\begin{table}[ht]
\centering
\scriptsize
\caption{Matriz de Elegibilidade Analítica e Motivos de Exclusão (Seções 64 e 65)}
\label{tab:eligibility-exclusions}
\resizebox{\textwidth}{!}{
\begin{tabular}{llcl}
\toprule
Tarefa & Dimensão Analítica & Elegível & Justificativa Metodológica \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
}
\end{table}"""


def table_l_evidence_matrix(evidence_matrix: List[Dict[str, Any]]) -> str:
    """Tabela da Matriz de Evidências sobre as Propriedades do BSH (Seção 70)."""
    linhas = []
    for item in evidence_matrix:
        prop = _esc(item.get("property"))
        metr = _esc(item.get("metric"))
        val = _esc(item.get("value") or item.get("result") or "DADOS_INSUFICIENTES")
        n_r = item.get("nRuns", "NA")
        n_b = item.get("nBaseTasks", "NA")
        runs_str = f"{n_r} ({n_b} bases)" if (n_r != "NA" and n_r is not None) else "NA"
        st = _esc(item.get("status") or "NA")
        strg = _esc(item.get("evidenceStrength") or item.get("strength") or "NA")
        linhas.append(f"{prop} & {metr} & {val} & {runs_str} & \\texttt{{{st}}} & \\textbf{{{strg}}} \\\\")

    return r"""\begin{table}[ht]
\centering
\scriptsize
\caption{Matriz de Evidências Empíricas sobre as Propriedades do BSH (Seção 70)}
\label{tab:evidence-matrix}
\resizebox{\textwidth}{!}{
\begin{tabular}{lp{4.5cm}p{4.0cm}ccc}
\toprule
Propriedade Avaliada & Métrica de Suporte & Valor / Evidência & Runs (Bases) & Status & Força \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
}
\end{table}"""


def table_m_verdicts(verdicts: Dict[str, Any]) -> str:
    """Tabela de Vereditos Técnicos Condicionados por Dimensão (Seções 72 a 78)."""
    linhas = []
    keys = [
        ("Economia de Tokens (Seção 73)", "TOKEN_ECONOMY_VERDICT"),
        ("Governança Semântica (Seção 74)", "SEMANTIC_GOVERNANCE_VERDICT"),
        ("Utilidade da Ontologia (Seção 75)", "ONTOLOGY_UTILITY_VERDICT"),
        ("Enforcement Independente (Seção 76)", "ENFORCEMENT_VERDICT"),
        ("Comportamento de Harness (Seção 77)", "HARNESS_VERDICT"),
        ("Veredito Global do Lote (Seção 78)", "OVERALL_BSH_VERDICT"),
    ]
    for label, k in keys:
        v_data = verdicts.get(k, {})
        v_str = _esc(v_data if isinstance(v_data, str) else v_data.get("verdict", "NA"))
        desc = _esc(verdicts.get("overallDescription") if k == "OVERALL_BSH_VERDICT" else (v_data.get("description", "") if isinstance(v_data, dict) else ""))
        linhas.append(f"{_esc(label)} & \\texttt{{{v_str}}} & {desc} \\\\")

    return r"""\begin{table}[ht]
\centering
\small
\caption{Síntese dos Vereditos Técnicos Condicionados às Evidências Observadas (Seção 72)}
\label{tab:technical-verdicts}
\begin{tabular}{llp{8.5cm}}
\toprule
Dimensão Avaliada & Veredito Técnico & Fundamentação Empírica \\
\midrule
""" + "\n".join(linhas) + r"""
\bottomrule
\end{tabular}
\end{table}"""


def generate_all_latex_tables(
    quality: Dict[str, Any],
    measurements: List[Dict[str, Any]],
    paired: List[Dict[str, Any]],
    capabilities: Dict[str, Any],
    metadata: Dict[str, Any],
    tasks: Optional[List[Dict[str, Any]]] = None,
    evidence_matrix: Optional[List[Dict[str, Any]]] = None,
    verdicts: Optional[Dict[str, Any]] = None,
) -> Dict[str, str]:
    """Gera todas as tabelas LaTeX obrigatórias A a M."""
    tabs = {
        "tab_a": table_a_data_quality(quality, measurements, paired),
        "tab_b": table_b_behavioral_equivalence(paired),
        "tab_c": table_c_semantic_recognition(measurements, tasks),
        "tab_d": table_d_governance_mechanisms(paired),
        "tab_e": table_e_equivalent_efficiency(paired),
        "tab_f": table_f_violating_tasks(paired),
        "tab_g": table_g_agent_capabilities(capabilities, metadata),
        "tab_impacto": table_h_real_impact(paired),
        "tab_agregada": table_j_aggregated_categories(paired),
        "tab_reproducibility": table_i_reproducibility(metadata),
        "tab_elegibilidade": table_k_eligibility_and_exclusions(paired),
    }
    if evidence_matrix:
        tabs["tab_evidencias"] = table_l_evidence_matrix(evidence_matrix)
    if verdicts:
        tabs["tab_vereditos"] = table_m_verdicts(verdicts)
    return tabs

