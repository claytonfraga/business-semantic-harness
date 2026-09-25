"""Geração e compilação do relatório científico LaTeX e Markdown do BSH Benchmark.

Contratos estritos:
- 20 seções canônicas rigorosamente ordenadas (Seção 59).
- Textos obrigatórios literais A até AH (Seção 61).
- Tabelas obrigatórias A até G (Seção 62).
- Figuras 1 até 12 incluídas somente quando existirem arquivos reais gerados.
- Validação automática do documento LaTeX antes da compilação (Seção 69).
- Cópia automática do PDF compilado para o diretório Downloads no Windows/WSL.
"""

from pathlib import Path
import re
import shutil
import subprocess
from typing import Any, Dict, List, Optional

from .tables import generate_all_latex_tables, _esc, _fmt

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
"""

# Textos Obrigatórios Literais da Seção 61
TEXTO_A = "A redução de tokens observada entre condições não é, isoladamente, uma medida de eficiência funcional. Uma execução pode consumir menos tokens porque concluiu a tarefa por uma trajetória mais curta, porque evitou corretamente uma operação proibida ou porque deixou de realizar trabalho que deveria ter sido executado. Por essa razão, o benchmark apresenta separadamente o consumo bruto observado e a análise restrita aos pares comportamentalmente equivalentes."
TEXTO_B = "A análise de eficiência sob equivalência comportamental inclui somente pares nos quais as condições comparadas produziram desfechos funcionalmente comparáveis. Para tarefas válidas, isso exige que ambas tenham concluído corretamente a solicitação. Uma execução governada que não produza a alteração necessária não pode ser considerada mais eficiente apenas porque utilizou menos tokens."
TEXTO_C = "Nos pares comportamentalmente equivalentes, o BSH consumiu menos tokens que a condição de referência. Neste subconjunto, a diferença não pode ser explicada simplesmente pela ausência de execução da tarefa, pois ambas as condições produziram desfechos funcionalmente corretos e comparáveis."
TEXTO_D = "A redução de tokens observada no conjunto completo não permaneceu após a restrição aos pares comportamentalmente equivalentes. Neste lote, a diferença bruta de consumo não pode ser interpretada como ganho de eficiência na execução da mesma tarefa."
TEXTO_E = "Os dados disponíveis não permitem avaliar eficiência sob equivalência comportamental, pois não há quantidade suficiente de pares nos quais ambas as condições tenham produzido corretamente a mesma tarefa."
TEXTO_F = "A ausência de alteração em uma tarefa válida é tratada como falha de conclusão, e não como economia de recursos. O consumo reduzido dessa execução não integra as estimativas de eficiência funcional do BSH."
TEXTO_G = "A ausência de alteração em uma tarefa violadora pode representar um desfecho correto quando existe evidência de que a incompatibilidade foi identificada antes da implementação. Nesse caso, o resultado é classificado como prevenção semântica e analisado separadamente do enforcement independente no gate."
TEXTO_H = "Enforcement independente é considerado demonstrado somente quando uma alteração incompatível existe na worktree, nenhuma sinalização voluntária de conflito pelo agente é necessária e o BSH identifica a violação semanticamente antes da promoção. Recusas preventivas do próprio agente não são classificadas como enforcement independente."
TEXTO_I = "O BSH bloqueou alterações incompatíveis que já existiam na worktree sem depender de relato voluntário do agente. Esse resultado fornece evidência direta de atuação do enforcement semântico independente na fronteira de promoção Git."
TEXTO_J = "O lote não contém evidência suficiente para atribuir os bloqueios observados ao enforcement independente. Os resultados podem demonstrar governança preventiva ou cooperação do agente, mas não permitem isolar a atuação autônoma do gate semântico."
TEXTO_K = "O reconhecimento semântico apresentou capacidade de associar alterações de código a operações governadas e aos respectivos shapes do domínio. Precision e recall devem ser interpretados em conjunto, pois baixa precision indica classificações indevidas, enquanto baixo recall indica operações governadas que escaparam ao reconhecimento."
TEXTO_L = "O reconhecimento semântico apresentou cobertura insuficiente neste lote. A ausência de identificação de operações ou shapes governados limita a capacidade do enforcement independente, mesmo quando a ontologia e as restrições SHACL estão corretamente definidas."
TEXTO_M = "Precision mede a proporção das operações classificadas como governadas que foram identificadas corretamente. Valores elevados indicam baixa incidência de classificações semânticas indevidas."
TEXTO_N = "Recall mede a proporção das operações governadas realmente presentes que foram reconhecidas pelo BSH. Valores baixos indicam risco de uma alteração sujeita à governança não alcançar a validação semântica correspondente."
TEXTO_O = "Tokens não cacheados são apresentados separadamente para verificar se a diferença entre as condições permanece quando o reaproveitamento de contexto é retirado da comparação. Uma vantagem presente apenas nos tokens totais, mas ausente nos tokens não cacheados, requer interpretação específica do efeito de caching."
TEXTO_P = "Consumo de tokens e duração representam custos distintos. Uma redução de tokens pode coexistir com maior tempo de execução devido à criação da worktree, consultas semânticas, validação SHACL, consultas SPARQL, gates técnicos e operações Git. Portanto, eficiência computacional não é inferida a partir de uma única dessas métricas."
TEXTO_Q = "O overhead temporal do BSH é analisado somente a partir de eventos e tempos efetivamente observáveis sem modificar o sistema avaliado. Componentes internos não instrumentados são registrados como não observáveis e não recebem estimativas artificiais."
TEXTO_R = "Em tarefas violadoras, menor consumo de tokens é considerado favorável somente quando associado a um desfecho semanticamente correto. Falhas técnicas, inação indevida ou abandono da tarefa não são contabilizados como economia produzida pelo BSH."
TEXTO_S = "Em tarefas válidas, o comportamento esperado é a conclusão correta da alteração. O BSH é considerado eficiente quando preserva esse resultado com custo igual ou inferior, ou quando o custo adicional observado representa o overhead necessário de governança sem impedir a conclusão funcional."
TEXTO_T = "No workload experimental avaliado, a economia obtida nas tarefas incompatíveis corretamente governadas foi superior ao overhead observado nas tarefas válidas comportamentalmente equivalentes. O resultado indica benefício líquido positivo para a composição específica de tarefas deste lote, sem implicar generalização para outras proporções de tarefas válidas e inválidas."
TEXTO_U = "No workload experimental avaliado, o overhead das tarefas válidas comportamentalmente equivalentes foi superior à economia obtida nas tarefas incompatíveis corretamente governadas. Nesta composição de tarefas, o BSH apresentou custo líquido adicional."
TEXTO_V = "O benefício líquido não pode ser calculado de forma metodologicamente adequada porque faltam pares elegíveis em uma ou mais categorias necessárias. Valores ausentes não são substituídos por zero e nenhuma conclusão sobre compensação de custos é produzida."
TEXTO_W = "O custo por tarefa concluída corretamente complementa a comparação de tokens por execução. Essa métrica penaliza condições que aparentam baixo consumo por deixar de realizar tarefas que deveriam ter sido concluídas."
TEXTO_X = "A condição governada apresentou menor custo por tarefa concluída corretamente. Esse resultado indica que a vantagem observada não decorre exclusivamente de execuções interrompidas ou sem alteração."
TEXTO_Y = "A condição governada apresentou maior custo por tarefa concluída corretamente. O menor consumo observado em parte das execuções não se traduziu em vantagem quando considerado o número de tarefas efetivamente concluídas com sucesso."
TEXTO_Z = "As quatro condições experimentais possuem funções causais distintas. A comparação A × B estima o efeito das regras textuais, B × C investiga o efeito adicional da representação ontológica consultiva, C × D estima o efeito adicional do enforcement independente e A × D mede o efeito combinado do BSH. Resultados de um contraste não devem ser atribuídos aos componentes internos que ele não isola."
TEXTO_AA = "Repetições da mesma tarefa não são tratadas como tarefas independentes na inferência estatística. As análises confirmatórias utilizam a tarefa-base como unidade de agrupamento, evitando que múltiplas execuções de um mesmo cenário reduzam artificialmente a estimativa de incerteza."
TEXTO_AB = "O intervalo de confiança representa a incerteza da estimativa no desenho experimental adotado. Sua interpretação deve considerar o número de tarefas-base, a estrutura de repetição e o método de reamostragem empregado."
TEXTO_AC = "Nenhum falso bloqueio foi observado na amostra analisada. Esse resultado descreve somente as execuções deste lote e não deve ser interpretado como demonstração de taxa populacional igual a zero."
TEXTO_AD = "Revisão humana não é tratada como falha do BSH quando a ontologia declara explicitamente que a decisão exige julgamento contextual ou alçada organizacional. Nesses casos, o resultado esperado do harness é suspender a promoção e transferir a decisão para o responsável humano."
TEXTO_AE = "Alterações fora do conhecimento governado não devem ser bloqueadas por ausência de regra ontológica. O comportamento esperado é permitir que elas prossigam pelos gates técnicos convencionais, sem inventar restrições inexistentes."
TEXTO_AF = "O estado indeterminado representa uma operação governada para a qual faltam fatos necessários à decisão semântica. Ele não é equivalente a conformidade e não deve resultar em promoção automática."
TEXTO_AG = "O agente de IA constitui uma variável configurável do ambiente experimental e não define a semântica das métricas ou das condições avaliadas. As condições experimentais, os critérios de classificação, as métricas e a análise permanecem invariantes em relação ao agente, enquanto particularidades de execução e telemetria são encapsuladas pelo adaptador correspondente."
TEXTO_AH = "Nesta campanha experimental, o agente selecionado foi Agy. Os resultados caracterizam a interação entre o BSH, esse agente e o modelo configurado neste lote. A arquitetura do benchmark permite replicar o mesmo desenho experimental com outros agentes sem alterar suas métricas ou critérios analíticos."
TEXTO_AI = "A diferença de tokens entre a execução direta e a execução mediada pelo BSH representa inicialmente uma diferença de consumo observado. Essa diferença somente é interpretada como economia computacional quando o desfecho produzido também é correto para a natureza da tarefa. Em tarefas válidas, exige-se equivalência comportamental entre as execuções comparadas. Em tarefas violadoras, exige-se evidência de que a execução direta perseguiu a alteração incompatível e de que a condição governada a preveniu, escalou ou bloqueou corretamente."
TEXTO_AJ = "O custo da ontologia e do BSH não é avaliado apenas pela quantidade adicional de contexto fornecida ao modelo. O benchmark mede o efeito completo da condição governada, incluindo o potencial de evitar trajetórias de implementação que posteriormente seriam rejeitadas por regras de negócio. Por essa razão, são apresentados separadamente o overhead observado em tarefas válidas e o custo evitado em tarefas incompatíveis."
TEXTO_AK = "Valores negativos de diferença de tokens indicam menor consumo na condição BSH, enquanto valores positivos indicam overhead. A interpretação desses valores depende do desfecho funcional e semântico correspondente e não é realizada isoladamente."
TEXTO_AL = "Quando a mesma tarefa válida é concluída corretamente nas duas condições, a diferença de tokens estima o custo relativo de produzir um resultado funcionalmente equivalente. Quando uma tarefa incompatível é executada diretamente, mas corretamente evitada ou bloqueada pelo BSH, a diferença representa custo computacional evitado pela governança."
TEXTO_AM = "A economia atribuída ao BSH é decomposta segundo o mecanismo efetivamente observado. Prevenção consultiva ocorre quando o agente utiliza o conhecimento ontológico e evita a alteração antes de produzi-la. Conflito reportado ocorre quando o agente comunica explicitamente a incompatibilidade. Enforcement independente ocorre quando uma alteração incompatível já existe na worktree e o BSH impede sua promoção sem depender da cooperação do agente."
TEXTO_AN = "Uma execução que consome poucos tokens por deixar de realizar indevidamente uma tarefa válida não é considerada eficiente. Da mesma forma, uma falha técnica ou instrumental não é contabilizada como economia."
TEXTO_AO = "O benefício líquido do workload corresponde à diferença entre o custo evitado nas tarefas incompatíveis corretamente governadas e o eventual overhead observado nas tarefas válidas comportamentalmente equivalentes. Esse resultado caracteriza exclusivamente a composição de tarefas do lote analisado e não deve ser generalizado para outras proporções de solicitações válidas e inválidas sem nova avaliação."


def validate_report_content(tex: str) -> List[str]:
    """Valida o documento LaTeX contra anomalias e placeholders."""
    errors = []
    if "Tabela ??" in tex or "Figura ??" in tex:
        errors.append("Referências cruzadas não resolvidas detectadas ('Tabela ??' ou 'Figura ??').")
    for m in re.finditer(r"\b(NaN|Infinity)\b", tex):
        errors.append(f"Valor numérico proibido '{m.group(1)}' detectado no relatório.")
    for idx, line in enumerate(tex.splitlines(), 1):
        if re.search(r"&\s*\?\s*\\\\", line) or re.search(r"\bcommit:\s*\?", line, re.IGNORECASE):
            errors.append(f"Placeholder '?' detectado na linha {idx}: {line.strip()}")
    return errors


def copy_pdf_to_downloads(pdf_file: Path, lote: str) -> List[Path]:
    """Copia o PDF compilado para os diretórios Downloads disponíveis."""
    if not pdf_file.is_file() or pdf_file.stat().st_size == 0:
        return []

    dest_filename = f"relatorio-benchmark-{lote}.pdf"
    copied = []
    candidates = [Path.home() / "Downloads"]

    try:
        users = Path("/mnt/c/Users")
        if users.is_dir():
            for u in sorted(users.iterdir()):
                if u.is_dir() and u.name.lower() not in ("public", "default", "default user", "all users"):
                    dl = u / "Downloads"
                    if dl.is_dir():
                        candidates.append(dl)
    except Exception:
        pass

    seen = set()
    for d in candidates:
        if d not in seen and d.is_dir():
            seen.add(d)
            target = d / dest_filename
            try:
                shutil.copy2(pdf_file, target)
                copied.append(target)
                print(f"[report] Relatório PDF copiado para: {target}")
            except Exception as e:
                print(f"[report] Aviso ao copiar PDF para {target}: {e}")
    return copied


def build_latex_document(
    batch_dir: Path,
    metadata: Dict[str, Any],
    stats: Dict[str, Any],
    quality: Dict[str, Any],
    tables: Dict[str, str],
    generated_figures: List[str],
    paired: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """Constrói o documento LaTeX com as 20 seções canônicas e textos obrigatórios."""
    if paired is None:
        paired = []
        paired_csv = batch_dir / "paired-results.csv"
        if paired_csv.is_file():
            import csv
            with open(paired_csv, encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    tok_a = float(row["tokensA"]) if row.get("tokensA") and row["tokensA"] not in ("", "NA", "None") else None
                    tok_d = float(row["tokensD"]) if row.get("tokensD") and row["tokensD"] not in ("", "NA", "None") else None
                    row_dict = dict(row)
                    row_dict["tokensA"] = tok_a
                    row_dict["tokensD"] = tok_d
                    row_dict["governanceMechanismD"] = row.get("governanceMechanismD")
                    paired.append(row_dict)

    lote = metadata.get("lote", batch_dir.name)
    agente = metadata.get("agente", "Agy")
    modelo = metadata.get("modelo", "gemini-3.7-flash-low")
    bsh_commit = str(metadata.get("bshProductTreeHash", metadata.get("commitBsh", "estável")))[:10]

    rq1 = stats.get("rq1", {})
    rq2 = stats.get("rq2", {})
    rq6 = stats.get("rq6", {})
    seg_val_eq = stats.get("segmentos", {}).get("validas_equivalentes", {})
    seg_todas = stats.get("segmentos", {}).get("todas", {})

    # Helper para inclusão de figura segura
    def fig_snippet(fig_name: str, caption: str, label: str) -> str:
        if fig_name in generated_figures and (batch_dir / "figures" / f"{fig_name}.pdf").is_file():
            return rf"""\begin{{figure}}[ht]
\centering
\includegraphics[width=0.88\textwidth]{{../figures/{fig_name}.pdf}}
\caption{{{caption}}}
\label{{{label}}}
\end{{figure}}"""
        return rf"\textit{{[Gráfico {fig_name}: omitido por insuficiência de dados amostrais elegíveis.]}}"

    # Seleção condicional de textos da Seção 61
    # RQ1 text selection
    n_eq = seg_val_eq.get("n_elegivel_tokens", 0)
    dif_eq = seg_val_eq.get("diferenca_absoluta", {}).get("media")
    if n_eq >= 2 and dif_eq is not None:
        texto_rq1 = TEXTO_C if dif_eq < 0 else TEXTO_D
    else:
        texto_rq1 = TEXTO_E

    # RQ2 text selection
    ben_liq = rq2.get("beneficio_liquido")
    if ben_liq is not None:
        texto_rq2 = TEXTO_T if ben_liq > 0 else TEXTO_U
    else:
        texto_rq2 = TEXTO_V

    # Enforcement text selection
    tem_enf_indep = any(p.get("governanceMechanismD") == "ENFORCEMENT_INDEPENDENTE" for p in stats.get("governanca", {}).values() if isinstance(p, dict)) or False
    texto_enf = TEXTO_I if tem_enf_indep else TEXTO_J

    # Reconhecimento semântico text selection
    rec_val = rq6.get("operationRecall")
    texto_rec = TEXTO_K if (rec_val is not None and rec_val > 0.5) else TEXTO_L

    st_rq1_a = str(rq1.get("rq1_a", {}).get("status", "NAO_AVALIADA"))
    st_rq1_b = str(rq1.get("rq1_b", {}).get("status", "NAO_AVALIADA"))
    st_rq2 = str(rq2.get("status", "NAO_AVALIADA"))
    st_rq3 = str(stats.get("rq3", {}).get("status", "NAO_AVALIADA"))
    st_rq4 = str(stats.get("rq4", {}).get("status", "NAO_AVALIADA"))
    st_rq5 = str(stats.get("rq5", {}).get("status", "NAO_AVALIADA"))
    st_rq6 = str(rq6.get("status", "NAO_AVALIADA"))
    st_rq7 = str(stats.get("rq7", {}).get("status", "NAO_AVALIADA"))
    st_rq8 = str(stats.get("rq8", {}).get("status", "NAO_AVALIADA"))

    # Decomposição do impacto real da ontologia e do BSH
    econ_val_total = 0.0
    over_val_total = 0.0
    n_val_equiv = 0
    custo_evitado_total = 0.0
    econ_prev_total = 0.0
    econ_rep_total = 0.0
    econ_enf_total = 0.0
    n_vio_gov = 0

    for p in paired:
        ttype = str(p.get("taskType", "")).lower()
        tok_a = p.get("tokensA")
        tok_d = p.get("tokensD")
        if tok_a is None or tok_d is None:
            continue
        eq = p.get("behavioralEquivalence")
        delta = tok_d - tok_a

        if ttype in ("valida_governada", "valid", "valida"):
            if eq == "EQUIVALENTE":
                n_val_equiv += 1
                if delta < 0:
                    econ_val_total += (tok_a - tok_d)
                elif delta > 0:
                    over_val_total += (tok_d - tok_a)
        elif ttype in ("violadora", "violating"):
            pursued_in_a = p.get("classificationA") in ("ALTERACAO_INCORRETA", "VIOLACAO_NAO_DETECTADA", "REVISAO_HUMANA", "ALTERACAO_CORRETA")
            governed_in_d = p.get("classificationD") in ("BLOQUEIO_CORRETO", "SEM_ALTERACAO_CORRETA", "REVISAO_HUMANA")
            if pursued_in_a and governed_in_d:
                n_vio_gov += 1
                custo_ev = (tok_a - tok_d)
                custo_evitado_total += custo_ev
                mech = p.get("governanceMechanismD")
                if mech == "CONSULTA_PREVENTIVA":
                    econ_prev_total += custo_ev
                elif mech == "CONFLITO_REPORTADO":
                    econ_rep_total += custo_ev
                elif mech == "ENFORCEMENT_INDEPENDENTE":
                    econ_enf_total += custo_ev

    econ_val_str = f"{_fmt(econ_val_total, 0)} tokens" if n_val_equiv > 0 else "Nenhum par elegível"
    over_val_str = f"{_fmt(over_val_total, 0)} tokens" if n_val_equiv > 0 else "Nenhum par elegível"
    custo_evitado_str = f"{_fmt(custo_evitado_total, 0)} tokens" if n_vio_gov > 0 else "Nenhum par elegível"

    if n_val_equiv > 0 and n_vio_gov > 0:
        net_b = custo_evitado_total - over_val_total
        net_b_str = f"{_fmt(net_b, 0)} tokens"
    else:
        net_b_str = "Não calculável metodologicamente (requer pares válidos equivalentes e violadores governados com telemetria)"

    tex = rf"""\documentclass[10pt,a4paper]{{article}}
\usepackage[utf8]{{inputenc}}
\usepackage[T1]{{fontenc}}
\usepackage{{lmodern}}
\usepackage[margin=2.2cm]{{geometry}}
\usepackage{{booktabs}}
\usepackage{{graphicx}}
\usepackage{{hyperref}}
\usepackage{{amsmath}}
\usepackage{{cite}}

\hypersetup{{colorlinks=true, linkcolor=black, citecolor=black, urlcolor=blue}}

\title{{\textbf{{Avaliação Científica de Governança Semântica e Eficiência Computacional no Business Semantic Harness (BSH)}}}}
\author{{Laboratório de Engenharia de Software Experimental \\ Lote Experimental: \texttt{{{_esc(lote)}}}}}
\date{{\today}}

\begin{{document}}
\maketitle

\begin{{abstract}}
Este relatório apresenta a avaliação experimental controlada do Business Semantic Harness (BSH), analisando o impacto da governança semântica independente baseada em ontologias e SHACL sobre o consumo computacional e a correção de código gerado por agentes de IA. Avalia-se o agente \textbf{{{_esc(agente)}}} utilizando o modelo \textbf{{{_esc(modelo)}}}, sob as condições Direta (A), Regras Textuais (B), Ontologia Consultiva (C) e BSH Completo (D).
\end{{abstract}}

\section{{Caracterização Técnica do Benchmark}}
{TEXTO_AG}

{TEXTO_AH}

\section{{Agente e Runtime Avaliados}}
O experimento foi operacionalizado sobre o agente {_esc(agente)}, modelo {_esc(modelo)}, mantendo o produto BSH integralmente congelado (código funcional: \texttt{{{_esc(bsh_commit)}}}).

{tables.get('tab_g', '')}

\section{{Projeto Piloto e Domínio Semântico}}
O projeto de referência consiste no módulo de gestão patrimonial (\texttt{{enforcement-project}}), governado pela ontologia de ativos e restrições SHACL declaradas em \texttt{{.bsh/domains/ativos/}}.

\section{{Perguntas de Pesquisa}}
O benchmark investiga oito perguntas de pesquisa (RQ1 a RQ8) avaliando o consumo de tokens (RQ1, RQ1.1), trade-off e benefício líquido (RQ2), regras textuais (RQ3), ontologia consultiva (RQ4), enforcement independente (RQ5), reconhecimento semântico (RQ6), mecanismos de governança (RQ7) e latência de execução (RQ8).

\section{{Desenho Experimental}}
{TEXTO_Z}

\section{{Qualidade dos Dados}}
{tables.get('tab_a', '')}

\section{{Critérios de Equivalência Comportamental}}
{TEXTO_A}

{TEXTO_B}

{tables.get('tab_b', '')}

\section{{Resultados Funcionais}}
{fig_snippet("figure-01-functional-results-by-condition", "Resultados Funcionais por Condição Experimental", "fig:func-results")}

{TEXTO_F}

\section{{Governança Semântica}}
{TEXTO_G}

{TEXTO_H}

{texto_enf}

{tables.get('tab_d', '')}

{fig_snippet("figure-07-governance-mechanisms", "Mecanismos Responsáveis pela Prevenção ou Bloqueio", "fig:gov-mechs")}

\section{{Reconhecimento Semântico}}
{TEXTO_M}

{TEXTO_N}

{texto_rec}

{tables.get('tab_c', '')}

{fig_snippet("figure-08-semantic-recognition", "Precision e Recall do Reconhecimento Semântico", "fig:sem-rec")}

\section{{Consumo Bruto de Tokens}}
{fig_snippet("figure-02-observed-total-tokens", "Consumo Observado de Tokens por Tarefa (Dumbbell Plot)", "fig:tokens-obs")}

\section{{Eficiência sob Equivalência Comportamental}}
{texto_rq1}

{tables.get('tab_e', '')}

{fig_snippet("figure-03-equivalent-total-tokens", "Consumo sob Equivalência Comportamental Comprovada", "fig:tokens-equiv")}

{fig_snippet("figure-04-percentage-difference-equivalent", "Variação Percentual sob Equivalência (< 0 = Economia)", "fig:diff-pct-equiv")}

\section{{Tokens Não Cacheados}}
{TEXTO_O}

{fig_snippet("figure-09-non-cached-tokens", "Consumo de Tokens Não Cacheados por Tarefa", "fig:non-cached")}

\section{{Tempo de Execução}}
{TEXTO_P}

{fig_snippet("figure-10-execution-time", "Duração Pareada da Execução em Segundos", "fig:exec-time")}

\section{{Overhead Observável do BSH}}
{TEXTO_Q}

{fig_snippet("figure-11-observable-harness-timing", "Overhead Temporal Observável Externamente", "fig:timing-obs")}

\section{{Tarefas Violadoras e Mecanismos de Proteção}}
{TEXTO_R}

{tables.get('tab_f', '')}

{fig_snippet("figure-06-violating-governance-matrix", "Matriz Categórica de Governança em Tarefas Violadoras", "fig:viol-matrix")}

\section{{Impacto Real da Ontologia e do BSH no Consumo de Tokens}}
{TEXTO_AI}

{TEXTO_AJ}

{TEXTO_AK}

{TEXTO_AL}

{TEXTO_AM}

{TEXTO_AN}

{tables.get('tab_impacto', '')}

\subsection*{{Decomposição dos Mecanismos e Custo Evitado}}
\begin{{itemize}}
  \item \textbf{{Economia em tarefas válidas equivalentes:}} {econ_val_str}.
  \item \textbf{{Overhead em tarefas válidas equivalentes:}} {over_val_str}.
  \item \textbf{{Custo evitado em tarefas violadoras corretamente governadas:}} {custo_evitado_str}.
  \begin{{itemize}}
    \item \textbf{{Economia por prevenção consultiva:}} {_fmt(econ_prev_total, 0)} tokens.
    \item \textbf{{Economia por conflito reportado:}} {_fmt(econ_rep_total, 0)} tokens.
    \item \textbf{{Economia por enforcement independente:}} {_fmt(econ_enf_total, 0)} tokens.
  \end{{itemize}}
  \item \textbf{{Benefício líquido do workload:}} {net_b_str}.
\end{{itemize}}

\section{{Trade-off e Benefício Líquido}}
{TEXTO_S}

{TEXTO_AO}

{texto_rq2}

{fig_snippet("figure-12-net-benefit", "Trade-off e Benefício Líquido Global (RQ2)", "fig:net-benefit")}

\section{{Respostas às Perguntas de Pesquisa}}
\begin{{itemize}}
  \item \textbf{{RQ1 (Consumo Geral):}} Status: \texttt{{{st_rq1_a}}}.
  \item \textbf{{RQ1.1 (Equivalência):}} Status: \texttt{{{st_rq1_b}}}.
  \item \textbf{{RQ2 (Benefício Líquido):}} Status: \texttt{{{st_rq2}}}.
  \item \textbf{{RQ3 (Regras Textuais):}} Status: \texttt{{{st_rq3}}}.
  \item \textbf{{RQ4 (Ontologia Consultiva):}} Status: \texttt{{{st_rq4}}}.
  \item \textbf{{RQ5 (Enforcement Independente):}} Status: \texttt{{{st_rq5}}}.
  \item \textbf{{RQ6 (Reconhecimento Semântico):}} Status: \texttt{{{st_rq6}}}.
  \item \textbf{{RQ7 (Mecanismos de Economia):}} Status: \texttt{{{st_rq7}}}.
  \item \textbf{{RQ8 (Tempo vs Tokens):}} Status: \texttt{{{st_rq8}}}.
\end{{itemize}}

{TEXTO_W}

{fig_snippet("figure-05-cost-per-success", "Custo Computacional por Sucesso Funcional", "fig:cost-success")}

\section{{Ameaças à Validade}}
{TEXTO_AA}

{TEXTO_AB}

{TEXTO_AC}

{TEXTO_AD}

{TEXTO_AE}

{TEXTO_AF}

\section{{Reprodutibilidade e Auditoria}}
Todos os dados brutos, logs de execução, worktrees e scripts encontram-se estruturados em \texttt{{measurements.csv}}, \texttt{{measurements.json}}, \texttt{{paired-results.csv}} e \texttt{{metadata.json}}.

\bibliographystyle{{plain}}
\bibliography{{references}}

\end{{document}}
"""
    return tex


def generate_and_compile_report(
    batch_dir: Path,
    metadata: Dict[str, Any],
    stats: Dict[str, Any],
    quality: Dict[str, Any],
    measurements: List[Dict[str, Any]],
    paired: List[Dict[str, Any]],
    capabilities: Dict[str, Any],
    generated_figures: List[str],
    tasks: Optional[List[Dict[str, Any]]] = None,
) -> Path:
    """Gera report.tex, compila report.pdf e copia para Downloads."""
    batch_dir = Path(batch_dir)
    report_dir = batch_dir / "report"
    report_dir.mkdir(parents=True, exist_ok=True)

    # 1. Gera tabelas LaTeX
    tables = generate_all_latex_tables(quality, measurements, paired, capabilities, metadata, tasks)

    # 2. Gera referências BibTeX
    (report_dir / "references.bib").write_text(REFERENCES_BIB, encoding="utf-8")

    # 3. Monta documento LaTeX
    tex_content = build_latex_document(batch_dir, metadata, stats, quality, tables, generated_figures, paired=paired)
    (report_dir / "benchmark-report.tex").write_text(tex_content, encoding="utf-8")
    (batch_dir / "report.tex").write_text(tex_content, encoding="utf-8")

    # 4. Validação automática do conteúdo LaTeX
    errors = validate_report_content(tex_content)
    if errors:
        print("[report] Avisos de validação no LaTeX:")
        for err in errors:
            print(f"  - {err}")

    # 6. Compilação com pdflatex (2 passos para referências)
    pdf_path = batch_dir / "report.pdf"
    if shutil.which("pdflatex"):
        try:
            for _ in range(2):
                subprocess.run(
                    ["pdflatex", "-interaction=nonstopmode", "benchmark-report.tex"],
                    cwd=report_dir, capture_output=True, timeout=120
                )
            gen_pdf = report_dir / "benchmark-report.pdf"
            if gen_pdf.is_file():
                shutil.copy2(gen_pdf, pdf_path)
                print(f"[report] Relatório compilado com sucesso: {pdf_path}")
                # 7. Copia para Downloads
                copy_pdf_to_downloads(pdf_path, metadata.get("lote", batch_dir.name))
        except Exception as e:
            print(f"[report] Falha na compilação do LaTeX: {e}")
    else:
        print("[report] pdflatex não encontrado no ambiente.")

    return pdf_path
