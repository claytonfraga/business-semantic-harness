"""Compilação do relatório científico experimental do BSH Benchmark.

Contratos estritos:
- Sequência canônica de seções (Requirement 46).
- Geração textual estritamente condicionada às evidências observadas (Requirement 32).
- Status explícito para cada RQ: RESPONDIDA, PARCIALMENTE_RESPONDIDA, NAO_AVALIADA, DADOS_INSUFICIENTES.
- Validação automática do relatório contra placeholders '?', 'Tabela ??', 'Figura ??', NaN (Requirement 41).
- Exportação de report.md, report.tex, report.pdf e cópia automática para Downloads no WSL.
"""

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List

from .load_data import load_dataset, compute_paired_dataset, export_paired_csv
from .validation import validate_benchmark_batch
from .statistics import compute_statistics
from .figures import generate_all_figures
from .tables import generate_latex_tables, _esc, _fmt

REFERENCES_BIB = r"""@book{wohlin2012,
  title={Experimentation in Software Engineering},
  author={Wohlin, Claes and Runeson, Per and H{\"o}st, Martin and Ohlsson, Magnus C and Regnell, Bj{\"o}rn and Wessl{\'e}n, Anders},
  year={2012},
  publisher={Springer Science \& Business Media}
}

@article{kitchenham2002,
  title={Preliminary guidelines for empirical research in software engineering},
  author={Kitchenham, Barbara A and Pfleeger, Shari Lawrence and Pickard, Lesley M and Jones, Peter W and Hoaglin, David C and El Emam, Khaled and Rosenberg, Jarrett},
  journal={IEEE Transactions on Software Engineering},
  volume={28},
  number={8},
  pages={721--734},
  year={2002},
  publisher={IEEE}
}

@techreport{knublauch2017,
  title={{Shapes Constraint Language (SHACL)}},
  author={Knublauch, Holger and Kontokostas, Dimitris},
  institution={W3C},
  type={W3C Recommendation},
  year={2017},
  note={\url{https://www.w3.org/TR/shacl/}}
}

@techreport{sporny2020,
  title={{JSON-LD 1.1: A JSON-based Serialization for Linked Data}},
  author={Sporny, Manu and Longley, Dave and Kellogg, Gregg},
  institution={W3C},
  type={W3C Recommendation},
  year={2020},
  note={\url{https://www.w3.org/TR/json-ld11/}}
}

@book{cohen1988,
  title={Statistical Power Analysis for the Behavioral Sciences},
  author={Cohen, Jacob},
  edition={2nd},
  year={1988},
  publisher={Lawrence Erlbaum Associates}
}

@article{wilcoxon1945,
  title={Individual comparisons by ranking methods},
  author={Wilcoxon, Frank},
  journal={Biometrics Bulletin},
  volume={1},
  number={6},
  pages={80--83},
  year={1945}
}
"""


def copy_pdf_to_downloads(pdf_file: Path, lote: str) -> List[Path]:
    """Copia o PDF compilado para os diretórios Downloads disponíveis no WSL."""
    if not pdf_file.is_file() or pdf_file.stat().st_size == 0:
        return []

    dest_filename = f"relatorio-benchmark-{lote}.pdf"
    copied_paths: List[Path] = []
    candidates: List[Path] = []

    try:
        users_dir = Path("/mnt/c/Users")
        if users_dir.is_dir():
            for u in sorted(users_dir.iterdir()):
                try:
                    if u.is_dir() and u.name.lower() not in ("public", "default", "default user", "all users", "usuário padrão"):
                        dl = u / "Downloads"
                        if dl.is_dir():
                            candidates.append(dl)
                except Exception:
                    continue
    except Exception:
        pass

    try:
        home_dl = Path.home() / "Downloads"
        home_dl.mkdir(parents=True, exist_ok=True)
        candidates.append(home_dl)
    except Exception:
        pass

    seen = set()
    unique_candidates: List[Path] = []
    for c in candidates:
        try:
            resolved = c.resolve()
            if resolved not in seen:
                seen.add(resolved)
                unique_candidates.append(c)
        except Exception:
            pass

    for target_dir in unique_candidates:
        try:
            target_path = target_dir / dest_filename
            shutil.copy2(pdf_file, target_path)
            copied_paths.append(target_path)
            print(f"[report] Relatório PDF copiado para Downloads: {target_path}")
        except Exception as e:
            print(f"[report] Aviso ao copiar PDF para {target_dir}: {e}")

    return copied_paths


def validate_report_content(tex_content: str) -> List[str]:
    """Valida automaticamente o conteúdo do relatório contra anomalias e placeholders (Requirement 41)."""
    errors: List[str] = []

    # Procura referências LaTeX não resolvidas
    if "Tabela ??" in tex_content or "Figura ??" in tex_content:
        errors.append("Referências pendentes detectadas ('Tabela ??' ou 'Figura ??').")

    # Procura placeholders desconhecidos '?' em seções técnicas
    # Permite '?' apenas em pontuação interrogativa
    linhas = tex_content.split("\n")
    for idx, l in enumerate(linhas, 1):
        if re.search(r"&\s*\?\s*\\\\", l) or re.search(r"\bcommit:\s*\?", l, re.IGNORECASE) or re.search(r"\bversão:\s*\?", l, re.IGNORECASE):
            errors.append(f"Placeholder '?' detectado na linha {idx}: {l.strip()}")

    # Procura NaN ou Infinity literais em tabelas ou texto
    for m in re.finditer(r"\b(NaN|Infinity)\b", tex_content):
        errors.append(f"Valor numérico inválido '{m.group(1)}' detectado no relatório.")

    return errors


def _build_tex(data: Dict[str, Any], paired: List[Dict[str, Any]], stats: Dict[str, Any],
               quality: Dict[str, Any], figures_geradas: List[str], tables: Dict[str, str]) -> str:
    """Monta o documento LaTeX completo autossuficiente com narrativa estritamente condicional."""
    metadata = data.get("metadata", {})
    lote = metadata.get("lote", data.get("batch_dir", Path()).name)
    agente = metadata.get("agente")
    modelo = metadata.get("modelo")
    commit_bsh = metadata.get("commitBsh", metadata.get("commit_harness"))
    if commit_bsh: commit_bsh = str(commit_bsh)[:10]
    data_ref = metadata.get("timestamp") or metadata.get("data") or (lote.split("-", 1)[1] if "-" in lote else None)

    rq1 = stats.get("rq1", {})
    rq2 = stats.get("rq2", {})
    rq3 = stats.get("rq3", {})
    rq4 = stats.get("rq4", {})
    rq5 = stats.get("rq5", {})
    rq6 = stats.get("rq6", {})


    def has_fig(nome: str) -> bool:
        return nome in figures_geradas

    # 1. Resumo e Metadados
    tex = rf"""\documentclass[10pt,a4paper]{{article}}
\usepackage[utf8]{{inputenc}}
\usepackage[T1]{{fontenc}}
\usepackage{{lmodern}}
\usepackage[margin=2.2cm]{{geometry}}
\usepackage{{booktabs}}
\usepackage{{graphicx}}
\usepackage{{hyperref}}
\usepackage{{amsmath}}
\usepackage[protrusion=true,expansion=false]{{microtype}}
\usepackage{{cite}}

\hypersetup{{
    colorlinks=true,
    linkcolor=black,
    citecolor=black,
    urlcolor=blue
}}

\title{{\textbf{{Avaliação Empírica de Governança Semântica e Consumo Computacional: Relatório Experimental do Business Semantic Harness (BSH)}}}}
\author{{Business Semantic Harness --- Módulo Experimental de Avaliação}}
\date{{\today}}

\begin{{document}}
\maketitle

\begin{{abstract}}
Este relatório apresenta a avaliação experimental do \emph{{Business Semantic Harness}} (BSH) operando sobre o agente autônomo de codificação \texttt{{{_esc(agente)}}} (modelo \texttt{{{_esc(modelo)}}}). O experimento investiga a viabilidade, custos computacionais e eficácia de governança de alterações de código mediadas por ontologias formais em worktrees Git herméticas, submetidas a validação determinística via W3C SHACL e Comunica SPARQL. Todos os dados, tabelas, gráficos e conclusões deste documento derivam exclusivamente de evidências efetivamente medidas no lote experimental \texttt{{{_esc(lote)}}}, registrando ausências de telemetria estritamente como nulas e condicionando as inferências à completude dos dados observados.
\end{{abstract}}

\section{{Caracterização Técnica do Benchmark e Metadados}}
A parametrização técnica do lote experimental é apresentada na Tabela~\ref{{tab:configuracao}}. O ambiente opera com repositórios cópia e isolamento em nível de sistema de arquivos.

\begin{{itemize}}
  \item \textbf{{Identificador do Lote:}} \texttt{{{_esc(lote)}}}
  \item \textbf{{Agente Avaliado:}} \texttt{{{_esc(agente)}}}
  \item \textbf{{Modelo / Esforço:}} \texttt{{{_esc(modelo)}}}
  \item \textbf{{Commit do Harness (BSH):}} \texttt{{{_esc(commit_bsh)}}}
  \item \textbf{{Data / Referência:}} \texttt{{{_esc(data_ref)}}}
  \item \textbf{{Status de Integridade do Lote:}} \texttt{{{_esc(quality.get('status', 'INVALID'))}}} ({quality.get('completeTokenPairsCount', 0)} pares completos de tokens de {quality.get('plannedTasksCount', 0)} planejados).
\end{{itemize}}

{tables.get("config", "")}

\section{{Caracterização do Projeto e do Domínio Semântico}}
O experimento adota o sistema de gestão patrimonial organizacional \texttt{{pilot/asset-management}}, modelado formalmente no domínio semântico \texttt{{ativos}} (\texttt{{.bsh/domains/ativos/}}).

A ontologia formaliza as entidades centrais \texttt{{Ativo}} e \texttt{{Responsavel}}, bem como o ciclo de vida completo do patrimônio através dos estados \texttt{{Disponivel}}, \texttt{{EmUso}}, \texttt{{Baixado}} (estado estritamente terminal para mutações convencionais), \texttt{{EmManutencao}} (incompatível com alocação a usuário final), \texttt{{EmTransito}} (bloqueia retransferência sem confirmação prévia de recebimento), \texttt{{Reservado}} e \texttt{{Extraviado}} (bloqueia transferências e baixas normais; exige protocolo formal no padrão \texttt{{SIN-AAAA/NNNNNN}}).

O mecanismo de governança atua no gate Git de uma worktree hermética, interceptando commits ou propostas de alteração, extraindo os diffs sintáticos para fatos RDF e submetendo-os deterministamente às regras SHACL via SHACL Engine e Comunica SPARQL antes da promoção para a branch de origem.

\section{{Perguntas de Pesquisa}}
O experimento visa responder a seis perguntas de pesquisa (\emph{{Research Questions}}):
\begin{{itemize}}
  \item \textbf{{RQ1:}} O BSH usa menos tokens do que a execução direta para as mesmas tarefas?
  \item \textbf{{RQ2:}} O custo adicional introduzido pelo BSH em tarefas válidas é compensado pelo custo evitado em tarefas inválidas?
  \item \textbf{{RQ3:}} Qual é o efeito de fornecer as regras apenas textualmente no prompt?
  \item \textbf{{RQ4:}} Qual é o efeito adicional da representação ontológica formal?
  \item \textbf{{RQ5:}} Qual é o efeito específico do enforcement independente no gate Git?
  \item \textbf{{RQ6:}} Com que precisão o BSH reconhece operações governadas e associa as alterações aos shapes esperados?
\end{{itemize}}

\section{{Desenho Experimental}}
O experimento segue desenho pareado intra-tarefa, confrontando as condições experimentais previstas:
\begin{{itemize}}
  \item \textbf{{Condição A (Direta):}} Agente operando livremente sem mediação de harness semântico.
  \item \textbf{{Condição B (Regras Textuais):}} Agente com regras corporativas fornecidas no prompt em linguagem natural.
  \item \textbf{{Condição C (Ontologia Consultiva):}} Agente com acesso a ferramentas ontológicas, sem gate de bloqueio.
  \item \textbf{{Condição D (BSH Completo):}} Agente governado com inspeção determinística e enforcement no gate Git.
\end{{itemize}}

A Tabela~\ref{{tab:tarefas}} detalha as tarefas do domínio patrimonial submetidas à avaliação.

{tables.get("tasks", "")}

\section{{Qualidade dos Dados e Disponibilidade de Telemetria}}
Em conformidade com as diretrizes metodológicas de Kitchenham et al.~\cite{{kitchenham2002}}, nenhum dado ausente foi preenchido com zero ou interpolado. A Tabela~\ref{{tab:qualidade_dados}} documenta a disponibilidade de telemetria por condição.

{tables.get("quality", "")}
"""

    # Texto condicional sobre qualidade dos dados
    status_lote = quality.get("status", "INVALID")
    if status_lote == "VALID":
        tex += r"""
O lote atende integralmente aos critérios de completude: todas as tarefas previstas foram observadas com pares completos de telemetria.
"""
    elif status_lote == "PARTIALLY_VALID":
        tex += rf"""
\textbf{{Nota de Auditoria sobre Parcialidade:}} O lote é classificado como \texttt{{PARTIALLY\_VALID}}. Das {quality.get('plannedTasksCount', 0)} tarefas previstas, {quality.get('observedTasksCount', 0)} foram observadas ({quality.get('observedRunsCount', 0)} execuções no total). Registraram-se {quality.get('completeTokenPairsCount', 0)} pares completos de tokens. As análises a seguir restringem-se estritamente às observações elegíveis, declarando ausência de dados nas demais.
"""
    else:
        tex += r"""
\textbf{{Alerta de Invalidação:}} O lote apresenta dados insuficientes ou ausentes, inviabilizando análises comparativas robustas.
"""

    # 6. Resultados Experimentais
    tex += rf"""
\section{{Resultados Experimentais}}

\subsection{{Resultados Pareados por Tarefa}}
A Tabela~\ref{{tab:resultados_pareados}} apresenta os resultados observados em cada tarefa, indicando explicitamente sua elegibilidade para comparação pareada de tokens e o motivo de exclusão quando aplicável.

{tables.get("paired", "")}

\subsection{{Governança Semântica}}
A classificação de desfechos baseia-se estritamente em evidências observadas (Tabela~\ref{{tab:governanca}}). Tarefas sem modificação de arquivos na worktree são classificadas como \texttt{{SEM\_ALTERACAO}}, não sendo contabilizadas como bloqueio correto.
"""

    if has_fig("figure-08-governance-outcomes"):
        tex += r"""
\begin{figure}[htbp]
\centering
\includegraphics[width=0.85\linewidth]{../figures/figure-08-governance-outcomes.pdf}
\caption{Classificação dos desfechos de governança por condição experimental.}
\label{fig:governance_outcomes}
\end{figure}
"""
    else:
        tex += r"""
\textit{Figura de governança não gerada porque não foram observadas classificações suficientes no lote.}
"""

    tex += rf"""
{tables.get("governance", "")}

\subsection{{Reconhecimento Semântico}}
A Tabela~\ref{{tab:reconhecimento_semantico}} documenta a extração independente de operações e shapes a partir dos diffs Git da worktree governada.

{tables.get("semantic_rec", "")}
"""

    if has_fig("figure-09-semantic-recognition"):
        tex += r"""
\begin{figure}[htbp]
\centering
\includegraphics[width=0.55\linewidth]{../figures/figure-09-semantic-recognition.pdf}
\caption{Precision e Recall no reconhecimento semântico independente (Condição D).}
\label{fig:semantic_rec}
\end{figure}
"""

    tex += r"""
\subsection{Consumo de Tokens (RQ1)}
A Tabela~\ref{tab:estatisticas_agregadas} sumariza o consumo de tokens nas observações elegíveis.
""" + tables.get("statistics", "")

    if has_fig("figure-01-paired-total-tokens"):
        tex += r"""
\begin{figure}[htbp]
\centering
\includegraphics[width=0.88\linewidth]{../figures/figure-01-paired-total-tokens.pdf}
\caption{Consumo total de tokens pareado por tarefa (Dumbbell plot).}
\label{fig:paired_tokens}
\end{figure}
"""
    else:
        tex += r"""
\textit{Figura 1 (Consumo total pareado) não gerada: pares completos de tokens insuficientes ($n_{elig} < 2$).}
"""

    if has_fig("figure-02-token-difference"):
        tex += r"""
\begin{figure}[htbp]
\centering
\includegraphics[width=0.88\linewidth]{../figures/figure-02-token-difference.pdf}
\caption{Variação percentual relativa de tokens ($\Delta\%$) por tarefa.}
\label{fig:token_difference}
\end{figure}
"""
    else:
        tex += r"""
\textit{Figura 2 (Variação percentual) não gerada: pares completos de tokens insuficientes ($n_{elig} < 2$).}
"""

    if has_fig("figure-05-cost-factor"):
        tex += r"""
\begin{figure}[htbp]
\centering
\includegraphics[width=0.88\linewidth]{../figures/figure-05-cost-factor.pdf}
\caption{Fator de custo ($T_{BSH} / T_{Direto}$) por tarefa.}
\label{fig:cost_factor}
\end{figure}
"""

    tex += r"""
\subsection{Tokens Não Cacheados}
"""
    if has_fig("figure-03-paired-uncached-tokens"):
        tex += r"""
\begin{figure}[htbp]
\centering
\includegraphics[width=0.88\linewidth]{../figures/figure-03-paired-uncached-tokens.pdf}
\caption{Tokens não cacheados pareados por tarefa.}
\label{fig:uncached_tokens}
\end{figure}
"""
    else:
        tex += r"""
\textit{Figura 3 (Tokens não cacheados) não gerada: pares completos de tokens não cacheados insuficientes ($n_{elig} < 2$).}
"""

    tex += r"""
\subsection{Tempo de Execução}
"""
    if has_fig("figure-07-paired-execution-time"):
        tex += r"""
\begin{figure}[htbp]
\centering
\includegraphics[width=0.88\linewidth]{../figures/figure-07-paired-execution-time.pdf}
\caption{Tempo de execução pareado por tarefa (segundos).}
\label{fig:execution_time}
\end{figure}
"""
    else:
        tex += r"""
\textit{Figura 7 (Tempo de execução pareado) não gerada: pares completos de duração insuficientes ($n < 2$).}
"""

    tex += rf"""
\subsection{{Overhead em Tarefas Válidas, Economia em Tarefas Violadoras e Benefício Líquido (RQ2)}}
Para o cálculo do benefício líquido ($B = \text{{Economia}}_{{\text{{violadoras}}}} - \text{{Overhead}}_{{\text{{válidas}}}}$), exige-se que a economia provenha exclusivamente de tarefas violadoras com \texttt{{BLOQUEIO\_CORRETO}} e que o overhead provenha de tarefas válidas com \texttt{{ALTERACAO\_CORRETA}} em ambas as condições.

\begin{{itemize}}
  \item \textbf{{Pares Violadores com BLOQUEIO\_CORRETO:}} {rq2.get('n_violadoras_bloqueio_correto', 0)}
  \item \textbf{{Pares Válidos com ALTERACAO\_CORRETA:}} {rq2.get('n_validas_alteracao_correta', 0)}
  \item \textbf{{Economia Total em Violadoras:}} {_fmt(rq2.get('economia_total_violadoras'), 0)} tokens
  \item \textbf{{Overhead Total em Válidas:}} {_fmt(rq2.get('overhead_total_validas'), 0)} tokens
  \item \textbf{{Benefício Líquido:}} {_fmt(rq2.get('beneficio_liquido'), 0)} tokens ({_fmt(rq2.get('beneficio_liquido_percentual'), 1)}\%)
\end{{itemize}}
"""

    if has_fig("figure-04-net-benefit"):
        tex += r"""
\begin{figure}[htbp]
\centering
\includegraphics[width=0.72\linewidth]{../figures/figure-04-net-benefit.pdf}
\caption{Trade-off entre economia em tarefas violadoras e overhead em tarefas válidas.}
\label{fig:net_benefit}
\end{figure}
"""
    else:
        tex += rf"""
\textit{{Figura 4 (Trade-off e Benefício Líquido) não gerada: {_esc(rq2.get('motivo_incompletude')) or 'dados insuficientes'}.}}
"""

    # 7. Respostas às Perguntas de Pesquisa (Requirement 46 & 32)
    tex += rf"""
\section{{Respostas às Perguntas de Pesquisa}}

\subsection{{RQ1: Consumo de Tokens (Status: \texttt{{{_esc(rq1.get('status'))}}})}}
"""
    if rq1.get("status") == "RESPONDIDA":
        dif_media = rq1.get("diferenca_media_tokens", 0)
        pct_media = rq1.get("diferenca_percentual_media", 0)
        fat_medio = rq1.get("fator_custo_medio", 1.0)
        tex += rf"""
Com base nas {rq1.get('n_elegivel')} tarefas com pares completos de telemetria de tokens, o BSH apresentou uma diferença média de {_fmt(dif_media, 0)} tokens ({_fmt(pct_media, 1)}\%, fator de custo médio de {_fmt(fat_medio, 2)}).
"""
    else:
        tex += r"""
\textbf{Dados Insuficientes:} A pergunta RQ1 não pode ser respondida neste lote porque não foram obtidos pares completos de telemetria de tokens entre a execução direta e a execução governada pelo BSH.
"""

    tex += rf"""
\subsection{{RQ2: Trade-off e Benefício Líquido (Status: \texttt{{{_esc(rq2.get('status'))}}})}}
"""
    if rq2.get("status") == "RESPONDIDA":
        b_liq = rq2.get("beneficio_liquido", 0)
        if b_liq > 0:
            tex += rf"""
\textbf{{Benefício Líquido Positivo:}} Observou-se uma economia de {_fmt(rq2.get('economia_total_violadoras'), 0)} tokens em tarefas violadoras bloqueadas corretamente frente a um overhead de {_fmt(rq2.get('overhead_total_validas'), 0)} tokens em tarefas válidas, gerando um benefício líquido de {_fmt(b_liq, 0)} tokens ({_fmt(rq2.get('beneficio_liquido_percentual'), 1)}\%).
"""
        elif b_liq < 0:
            tex += rf"""
\textbf{{Custo Líquido Adicional:}} O overhead em tarefas válidas ({_fmt(rq2.get('overhead_total_validas'), 0)} tokens) superou a economia em tarefas violadoras ({_fmt(rq2.get('economia_total_violadoras'), 0)} tokens), resultando em um custo adicional líquido de {_fmt(abs(b_liq), 0)} tokens.
"""
        else:
            tex += r"""
\textbf{Paridade de Custo:} O overhead em tarefas válidas igualou exatamente a economia obtida em tarefas violadoras.
"""
    else:
        tex += rf"""
\textbf{{Dados Insuficientes:}} A pergunta RQ2 não pode ser respondida neste lote. {_esc(rq2.get('motivo_incompletude'))}
"""

    tex += rf"""
\subsection{{RQ3: Efeito de Regras Textuais (Status: \texttt{{{_esc(rq3.get('status'))}}})}}
"""
    if rq3.get("status") == "RESPONDIDA":
        tex += r"""
A condição B foi avaliada em contraste com a condição A.
"""
    else:
        tex += rf"""
\textbf{{Não Avaliada:}} {_esc(rq3.get('motivo'))}
"""

    tex += rf"""
\subsection{{RQ4: Efeito Adicional da Representação Ontológica (Status: \texttt{{{_esc(rq4.get('status'))}}})}}
"""
    if rq4.get("status") == "RESPONDIDA":
        tex += r"""
O contraste B $\times$ C permitiu isolar a contribuição da ontologia consultiva frente a regras no prompt.
"""
    else:
        tex += rf"""
\textbf{{Não Avaliada:}} {_esc(rq4.get('motivo'))}
"""

    tex += rf"""
\subsection{{RQ5: Efeito Específico do Enforcement Independente (Status: \texttt{{{_esc(rq5.get('status'))}}})}}
"""
    if rq5.get("status") == "RESPONDIDA":
        tex += r"""
O contraste C $\times$ D permitiu isolar o impacto do gate estrito de bloqueio na worktree.
"""
    else:
        tex += rf"""
\textbf{{Não Isolada Causalmente:}} {_esc(rq5.get('motivo'))}
"""

    tex += rf"""
\subsection{{RQ6: Reconhecimento Semântico Independente (Status: \texttt{{{_esc(rq6.get('status'))}}})}}
"""
    if rq6.get("status") == "RESPONDIDA":
        tex += rf"""
O reconhecimento semântico independente alcançou \emph{{Recall}} de {_fmt(rq6.get('recall') * 100, 1)}\% e \emph{{Precision}} de {_fmt(rq6.get('precision') * 100, 1)}\% na condição D.
"""
    else:
        tex += rf"""
\textbf{{Dados Insuficientes:}} {_esc(rq6.get('motivo'))}
"""

    # 8. Ameaças à Validade
    tex += r"""
\section{Ameaças à Validade}
\begin{itemize}
  \item \textbf{Validade de Construto:} Telemetria de tokens depende da instrumentação exposta pelo agente. Quando um runtime não disponibiliza métricas estruturadas de tokens em tempo real no modo TUI, o benchmark preserva o dado como nulo, evitando construir inferências sobre valores espúrios.
  \item \textbf{Validade Interna:} O pareamento intra-tarefa atenua a variabilidade natural de geração dos LLMs, mas requer amostras completas em ambas as condições para permitir inferência causal.
  \item \textbf{Validade Externa:} Os resultados referem-se ao domínio patrimonial \texttt{ativos} do projeto piloto \texttt{pilot/asset-management}; generalizações para outros domínios requerem replicações adicionais.
  \item \textbf{Validade de Conclusão:} A ausência de poder estatístico em lotes parciais impede afirmações de significância.
\end{itemize}

\section{Reprodutibilidade e Auditoria}
Para reproduzir e auditar as medições deste lote:
\begin{itemize}
  \item \textbf{Commit do BSH:} \texttt{""" + _esc(commit_bsh) + r"""}.
  \item \textbf{Artefatos Estruturados Gerados:} \texttt{data-quality.json}, \texttt{paired-results.csv}, \texttt{statistics.json} e \texttt{statistics.md}.
  \item \textbf{Relatório Auditável:} O relatório Markdown intermediário está disponível em \texttt{report.md}, e o PDF compilado foi copiado para a pasta Downloads como \texttt{relatorio-benchmark-""" + _esc(lote) + r""".pdf}.
\end{itemize}

\bibliographystyle{plain}
\bibliography{references}

\end{document}
"""
    return tex


def build_and_compile_report(data: Dict[str, Any], paired: List[Dict[str, Any]], stats: Dict[str, Any],
                             quality: Dict[str, Any], figures_geradas: List[str], tables: Dict[str, str]) -> Path:
    """Gera report.md, report.tex, valida o conteúdo, compila report.pdf e copia para Downloads."""
    batch_dir = data.get("batch_dir", Path())
    report_dir = batch_dir / "report"
    report_dir.mkdir(parents=True, exist_ok=True)

    metadata = data.get("metadata", {})
    lote = metadata.get("lote", batch_dir.name)

    # 1. Escreve references.bib
    bib_file = report_dir / "references.bib"
    bib_file.write_text(REFERENCES_BIB, encoding="utf-8")

    # 2. Escreve report.md (Requirement 40)
    md_file = batch_dir / "report.md"
    _export_report_markdown(data, paired, stats, quality, md_file)

    # 3. Constrói benchmark-report.tex (e cria link simbólico report.tex se conveniente)
    tex_file = report_dir / "benchmark-report.tex"
    tex_content = _build_tex(data, paired, stats, quality, figures_geradas, tables)
    tex_file.write_text(tex_content, encoding="utf-8")

    # Também salva como report.tex no lote para aderência estrita ao Requirement 40
    try:
        (batch_dir / "report.tex").write_text(tex_content, encoding="utf-8")
    except Exception:
        pass

    # 4. Validação automática pré-compilação (Requirement 41)
    val_errors = validate_report_content(tex_content)
    if val_errors:
        print("[report] Aviso de validação no código TeX:")
        for err in val_errors:
            print(f"  - {err}")

    # 5. Compilação do PDF
    compiler = shutil.which("latexmk") or shutil.which("pdflatex")
    pdf_file = report_dir / "benchmark-report.pdf"

    if compiler and "latexmk" in compiler:
        cmd = ["latexmk", "-pdf", "-interaction=nonstopmode", "-halt-on-error", tex_file.name]
        subprocess.run(cmd, cwd=report_dir, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    elif compiler and "pdflatex" in compiler:
        subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", tex_file.name],
                       cwd=report_dir, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        if shutil.which("bibtex"):
            subprocess.run(["bibtex", "benchmark-report"], cwd=report_dir, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=30)
        subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", tex_file.name],
                       cwd=report_dir, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
        subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", tex_file.name],
                       cwd=report_dir, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)

    # 6. Salva cópia como report.pdf no lote
    if pdf_file.is_file() and pdf_file.stat().st_size > 0:
        try:
            shutil.copy2(pdf_file, batch_dir / "report.pdf")
        except Exception:
            pass
        print(f"[report] Relatório PDF compilado com sucesso: {pdf_file} ({pdf_file.stat().st_size} bytes)")
        copy_pdf_to_downloads(pdf_file, lote)
    else:
        print(f"[report] Aviso: PDF não compilado ou vazio. Código TeX gerado em {tex_file}")

    return pdf_file if pdf_file.is_file() else tex_file


def _export_report_markdown(data: Dict[str, Any], paired: List[Dict[str, Any]], stats: Dict[str, Any],
                            quality: Dict[str, Any], out_path: Path) -> None:
    """Gera o relatório em Markdown estruturado para auditoria intermediária (Requirement 40)."""
    metadata = data.get("metadata", {})
    lote = metadata.get("lote", data.get("batch_dir", Path()).name)
    rq1 = stats.get("rq1", {})
    rq2 = stats.get("rq2", {})

    content = f"""# Relatório Experimental do Business Semantic Harness (BSH)

- **Lote:** `{lote}`
- **Agente:** `{metadata.get('agente', 'N/A')}`
- **Modelo:** `{metadata.get('modelo', 'N/A')}`
- **Commit BSH:** `{metadata.get('commitBsh', 'N/A')}`
- **Status do Lote:** `{quality.get('status', 'INVALID')}`

## 1. Qualidade dos Dados e Telemetria
- **Tarefas Planejadas:** {quality.get('plannedTasksCount', 0)}
- **Tarefas Observadas:** {quality.get('observedTasksCount', 0)}
- **Execuções Observadas:** {quality.get('observedRunsCount', 0)}
- **Pares Completos de Tokens:** {quality.get('completeTokenPairsCount', 0)}
- **Pares Completos de Duração:** {quality.get('completeDurationPairsCount', 0)}

## 2. Resumo de Perguntas de Pesquisa (RQs)
- **RQ1 (Consumo de Tokens):** `{rq1.get('status')}`
- **RQ2 (Trade-off e Benefício Líquido):** `{rq2.get('status')}`
  - Economia Total em Violadoras: {rq2.get('economia_total_violadoras') or 'NA'}
  - Overhead Total em Válidas: {rq2.get('overhead_total_validas') or 'NA'}
  - Benefício Líquido: {rq2.get('beneficio_liquido') or 'NA'}
- **RQ3 (Regras Textuais):** `{stats.get('rq3', {}).get('status')}` ({stats.get('rq3', {}).get('motivo') or 'Avaliada'})
- **RQ4 (Ontologia Formal):** `{stats.get('rq4', {}).get('status')}` ({stats.get('rq4', {}).get('motivo') or 'Avaliada'})
- **RQ5 (Enforcement Independente):** `{stats.get('rq5', {}).get('status')}` ({stats.get('rq5', {}).get('motivo') or 'Avaliada'})
- **RQ6 (Reconhecimento Semântico):** `{stats.get('rq6', {}).get('status')}`

## 3. Artefatos de Auditoria
- Dados brutos: `measurements.csv` e `measurements.json`
- Pares e elegibilidade: `paired-results.csv`
- Qualidade dos dados: `data-quality.json`
- Estatísticas detalhadas: `statistics.json` e `statistics.md`
- Relatório TeX: `report.tex` (ou `report/benchmark-report.tex`)
- Relatório PDF compilado: `report.pdf`
"""
    try:
        out_path.write_text(content, encoding="utf-8")
    except Exception:
        pass


def run_analysis(batch_dir: Path) -> Dict[str, Any]:
    """Fluxo completo de análise científica auditável e geração de relatório LaTeX/PDF."""
    batch_dir = Path(batch_dir)

    # 1. Carrega dados estruturados saneados
    data = load_dataset(batch_dir)

    # 2. Valida qualidade do lote e gera data-quality.json (Requirement 5)
    quality = validate_benchmark_batch(batch_dir, data)

    # 3. Computa conjunto pareado e exporta paired-results.csv com elegibilidade (Requirement 7 e 8)
    paired = compute_paired_dataset(data)
    export_paired_csv(paired, batch_dir / "paired-results.csv")

    # 4. Calcula estatísticas descritivas, inferenciais e exporta statistics.json / statistics.md
    stats = compute_statistics(data, paired)

    # 5. Gera figuras de publicação apenas para dados elegíveis (Requirement 19)
    figures_geradas = generate_all_figures(data, paired, stats)

    # 6. Gera tabelas LaTeX profissionais booktabs
    tables = generate_latex_tables(data, paired, stats, quality)

    # 7. Constrói report.md, report.tex, compila report.pdf e copia para Downloads
    build_and_compile_report(data, paired, stats, quality, figures_geradas, tables)

    return {
        "lote": batch_dir.name,
        "status": quality.get("status"),
        "planned_tasks": quality.get("plannedTasksCount"),
        "observed_tasks": quality.get("observedTasksCount"),
        "paired_count": len(paired),
        "eligible_token_pairs": quality.get("completeTokenPairsCount"),
        "figures": figures_geradas,
        "pdf": str(batch_dir / "report" / "benchmark-report.pdf"),
    }
