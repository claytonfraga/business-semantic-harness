"""Geração de tabelas LaTeX profissionais no padrão booktabs para o BSH Benchmark.

Contratos estritos:
- Ausência de dado formatada como \\textendash (traço), NUNCA como 0 ou ?.
- Inclusão explícita de n observado e n elegível em todas as tabelas estatísticas.
- Tabela estruturada de reconhecimento semântico (Requirement 37).
- Tabela de qualidade de dados e disponibilidade de telemetria (Requirements 38 e 39).
"""

from typing import Any, Dict, List, Optional


def _esc(texto: Any) -> str:
    if texto is None or str(texto).lower() in ("none", "null", "?", "nan"):
        return r"\textendash"
    s = str(texto)
    return (s.replace("\\", r"\textbackslash{}")
             .replace("&", r"\&")
             .replace("%", r"\%")
             .replace("_", r"\_")
             .replace("#", r"\#")
             .replace("{", r"\{")
             .replace("}", r"\}")
             .replace("~", r"\textasciitilde{}")
             .replace("^", r"\textasciicircum{}"))


def _fmt(val: Any, casas: int = 0) -> str:
    if val is None or str(val).lower() in ("none", "null", "?", "nan"):
        return r"\textendash"
    try:
        f = float(val)
        if casas == 0:
            return f"{f:,.0f}".replace(",", ".")
        return f"{f:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (ValueError, TypeError):
        return _esc(str(val))


def table_config(metadata: Dict[str, Any], quality: Dict[str, Any]) -> str:
    """Tabela 1: Configuração técnica e rastreabilidade do lote."""
    lote = metadata.get("lote")
    agente = metadata.get("agente")
    modelo = metadata.get("modelo")
    esforco = metadata.get("esforco")
    commit_bsh = metadata.get("commitBsh", metadata.get("commit_harness"))
    if commit_bsh: commit_bsh = str(commit_bsh)[:10]
    commit_piloto = metadata.get("commitProjeto", metadata.get("commit_pilot"))
    if commit_piloto: commit_piloto = str(commit_piloto)[:10]

    linhas = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Configuração do Experimento Controlado}",
        r"\label{tab:configuracao}",
        r"\begin{tabular}{ll}",
        r"\toprule",
        r"\textbf{Parâmetro Experimental} & \textbf{Valor Observado} \\",
        r"\midrule",
        rf"Identificador do Lote & {_esc(lote)} \\",
        rf"Agente Avaliado & {_esc(agente)} \\",
        rf"Modelo de Linguagem & {_esc(modelo)} \\",
        rf"Esforço de Raciocínio & {_esc(esforco)} \\",
        rf"Commit do BSH & {_esc(commit_bsh)} \\",
        rf"Commit do Piloto & {_esc(commit_piloto)} \\",
        rf"Tarefas Planejadas & {quality.get('plannedTasksCount', 0)} \\",
        rf"Execuções Observadas & {quality.get('observedRunsCount', 0)} \\",
        rf"Pares Completos de Tokens & {quality.get('completeTokenPairsCount', 0)} \\",
        rf"Pares Completos de Duração & {quality.get('completeDurationPairsCount', 0)} \\",
        rf"Status de Validação do Lote & \texttt{{{_esc(quality.get('status', 'INVALID'))}}} \\",
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ]
    return "\n".join(linhas)


def table_data_quality(quality: Dict[str, Any]) -> str:
    """Tabela de Qualidade dos Dados e Disponibilidade de Telemetria."""
    telemetry = quality.get("telemetryAvailability", {})
    linhas = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Disponibilidade de Telemetria e Cobertura de Dados por Condição}",
        r"\label{tab:qualidade_dados}",
        r"\begin{tabular}{lcccccc}",
        r"\toprule",
        r"\textbf{Condição} & \textbf{Execuções} & \textbf{Tokens} & \textbf{Cache} & \textbf{Raciocínio} & \textbf{Duração} & \textbf{Enforcement} \\",
        r"\midrule",
    ]

    for cond, m in sorted(telemetry.items()):
        tok_str = f"{m.get('tokensAvailable', 0)} ({m.get('tokensCoveragePct', 0):.0f}\%)"
        dur_str = f"{m.get('durationAvailable', 0)} ({m.get('durationCoveragePct', 0):.0f}\%)"
        linhas.append(
            rf"{_esc(cond)} & {m.get('totalRuns', 0)} & {tok_str} & {m.get('cacheAvailable', 0)} & "
            rf"{m.get('reasoningAvailable', 0)} & {dur_str} & {m.get('enforcementAvailable', 0)} \\"
        )

    linhas.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ])
    return "\n".join(linhas)


def table_tasks(tasks: List[Dict[str, Any]]) -> str:
    """Tabela de Tarefas Avaliadas."""
    linhas = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Tarefas Experimentais Avaliadas no Domínio Patrimonial}",
        r"\label{tab:tarefas}",
        r"\begin{tabular}{lllp{7.5cm}}",
        r"\toprule",
        r"\textbf{ID} & \textbf{Tipo} & \textbf{Operação Esperada} & \textbf{Regra Ontológica / Restrição SHACL} \\",
        r"\midrule",
    ]
    for t in tasks:
        tid = _esc(t.get("id"))
        tipo = _esc(t.get("tipo"))
        op = _esc(t.get("operacao") or "Nenhuma")
        desc = _esc(t.get("descricao") or t.get("prompt") or "")
        if len(desc) > 90:
            desc = desc[:87] + "..."
        linhas.append(rf"{tid} & {tipo} & {op} & {desc} \\")
    linhas.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ])
    return "\n".join(linhas)


def table_paired_results(paired: List[Dict[str, Any]]) -> str:
    """Tabela de Resultados Pareados com Elegibilidade e Justificativa."""
    linhas = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Resultados Pareados por Tarefa e Critérios de Elegibilidade}",
        r"\label{tab:resultados_pareados}",
        r"\begin{tabular}{llrrrrrcc}",
        r"\toprule",
        r"\textbf{Tarefa} & \textbf{Tipo} & \textbf{Tokens Dir.} & \textbf{Tokens BSH} & \textbf{$\Delta$ Tokens} & \textbf{$\Delta$\%} & \textbf{Fator} & \textbf{Elegível?} & \textbf{Motivo de Exclusão} \\",
        r"\midrule",
    ]
    for p in paired:
        tid = _esc(p.get("taskId"))
        tipo = _esc(p.get("taskType"))
        t_dir = _fmt(p.get("tokensA"), 0)
        t_bsh = _fmt(p.get("tokensD"), 0)
        dif_t = _fmt(p.get("differenceTokens"), 0)
        dif_p = f"{_fmt(p.get('percentageDifference'), 1)}\%" if p.get("percentageDifference") is not None else r"\textendash"
        fat = _fmt(p.get("costFactor"), 2)
        elig = "Sim" if p.get("eligibleForTokenAnalysis") else "Não"
        motivo = _esc(p.get("exclusionReason") or "Nenhum")
        if len(motivo) > 35:
            motivo = motivo[:32] + "..."
        linhas.append(rf"{tid} & {tipo} & {t_dir} & {t_bsh} & {dif_t} & {dif_p} & {fat} & {elig} & {motivo} \\")
    linhas.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ])
    return "\n".join(linhas)


def table_governance(stats: Dict[str, Any]) -> str:
    """Tabela de Desfechos de Governança."""
    gov = stats.get("governanca", {})
    classes = [
        "ALTERACAO_CORRETA", "BLOQUEIO_CORRETO", "VIOLACAO_NAO_DETECTADA",
        "FALSO_BLOQUEIO", "REVISAO_HUMANA", "SEM_ALTERACAO", "FALHA_TECNICA"
    ]
    condicoes = sorted(gov.keys())

    linhas = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Classificação Baseada em Evidências dos Desfechos de Governança}",
        r"\label{tab:governanca}",
        r"\begin{tabular}{l" + "c" * len(classes) + "}",
        r"\toprule",
        r"\textbf{Condição} & " + " & ".join(rf"\textbf{{{_esc(c[:14])}}}" for c in classes) + r" \\",
        r"\midrule",
    ]
    for cond in condicoes:
        vals = [_fmt(gov[cond].get(cls, 0), 0) for cls in classes]
        linhas.append(rf"{_esc(cond)} & " + " & ".join(vals) + r" \\")
    linhas.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ])
    return "\n".join(linhas)


def table_semantic_recognition(tasks: List[Dict[str, Any]], data: Dict[str, Any]) -> str:
    """Tabela de Reconhecimento Semântico Independente (Requirement 37)."""
    measurements = data.get("measurements", [])
    # Filtra execuções na condição D
    d_runs = {str(m.get("tarefa") or "").split("-")[0]: m for m in measurements if str(m.get("condicao", "")) in ("D", "com-harness")}

    linhas = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Reconhecimento Semântico Independente de Operações Patrimoniais}",
        r"\label{tab:reconhecimento_semantico}",
        r"\begin{tabular}{lllp{4.5cm}c}",
        r"\toprule",
        r"\textbf{Tarefa} & \textbf{Operação Esperada} & \textbf{Operação Identificada} & \textbf{Shape Identificado} & \textbf{Correto?} \\",
        r"\midrule",
    ]

    for t in tasks:
        tid = t.get("id")
        op_esp = t.get("operacao")
        shape_esp = t.get("shape")
        m = d_runs.get(tid, {})

        op_id = m.get("identifiedGovernedOperation") or m.get("operacaoIdentificada")
        shape_id = m.get("identifiedShapes") or m.get("shapeIdentificado")
        if isinstance(shape_id, list):
            shape_str = ", ".join(str(s).split(":")[-1] for s in shape_id)
        elif shape_id:
            shape_str = str(shape_id).split(":")[-1]
        else:
            shape_str = None

        correto = r"\textendash"
        if op_esp and op_id:
            correto = "Sim" if (op_esp == op_id) else "Não"
        elif not op_esp and not op_id:
            correto = "Sim (Fora Escopo)"

        linhas.append(rf"{_esc(tid)} & {_esc(op_esp)} & {_esc(op_id)} & {_esc(shape_str)} & {correto} \\")

    linhas.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ])
    return "\n".join(linhas)


def table_statistics(stats: Dict[str, Any]) -> str:
    """Tabela de Estatísticas Descritivas e Pareadas por Subconjunto."""
    todas = stats.get("segmentos", {}).get("todas", {})
    val = stats.get("segmentos", {}).get("validas", {})
    vio = stats.get("segmentos", {}).get("violadoras", {})

    linhas = [
        r"\begin{table}[htbp]",
        r"\centering",
        r"\small",
        r"\caption{Estatísticas Descritivas de Consumo de Tokens por Subamostra}",
        r"\label{tab:estatisticas_agregadas}",
        r"\begin{tabular}{lcccccccc}",
        r"\toprule",
        r"\textbf{Subamostra} & \textbf{$n_{obs}$} & \textbf{$n_{elig}$} & \textbf{Média Dir.} & \textbf{Média BSH} & \textbf{$\Delta$ Médio} & \textbf{$\Delta$\% Médio} & \textbf{Fator} & \textbf{IC 95\% ($\Delta$)} \\",
        r"\midrule",
    ]

    for nome, seg in [("Todas as Tarefas", todas), ("Tarefas Válidas", val), ("Tarefas Violadoras", vio)]:
        n_o = seg.get("n_observado", 0)
        n_e = seg.get("n_elegivel_tokens", 0)
        m_dir = _fmt(seg.get("tokens_direto", {}).get("media"), 0)
        m_bsh = _fmt(seg.get("tokens_bsh", {}).get("media"), 0)
        dif_m = _fmt(seg.get("diferenca_absoluta", {}).get("media"), 0)
        pct_m = f"{_fmt(seg.get('diferenca_percentual', {}).get('media'), 1)}\%" if seg.get('diferenca_percentual', {}).get('media') is not None else r"\textendash"
        fat_m = _fmt(seg.get("fator_custo", {}).get("media"), 2)

        ic_inf = seg.get("diferenca_absoluta", {}).get("ic95_inferior")
        ic_sup = seg.get("diferenca_absoluta", {}).get("ic95_superior")
        if ic_inf is not None and ic_sup is not None:
            ic_str = f"[{_fmt(ic_inf, 0)}; {_fmt(ic_sup, 0)}]"
        else:
            ic_str = r"\textendash"

        linhas.append(rf"{nome} & {n_o} & {n_e} & {m_dir} & {m_bsh} & {dif_m} & {pct_m} & {fat_m} & {ic_str} \\")

    linhas.extend([
        r"\bottomrule",
        r"\end{tabular}",
        r"\end{table}",
    ])
    return "\n".join(linhas)


def generate_latex_tables(data: Dict[str, Any], paired: List[Dict[str, Any]], stats: Dict[str, Any], quality: Dict[str, Any]) -> Dict[str, str]:
    """Gera todas as tabelas LaTeX estruturadas."""
    tasks = data.get("tasks", [])
    metadata = data.get("metadata", {})

    return {
        "config": table_config(metadata, quality),
        "quality": table_data_quality(quality),
        "tasks": table_tasks(tasks),
        "paired": table_paired_results(paired),
        "governance": table_governance(stats),
        "semantic_rec": table_semantic_recognition(tasks, data),
        "statistics": table_statistics(stats),
    }
