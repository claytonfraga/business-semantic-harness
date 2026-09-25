"""Carga, validação e estruturação dos dados experimentais do BSH benchmark.

Contratos estritos:
- Separação explícita entre dado ausente (None/NA) e zero real.
- Purificação de artefatos legados (ex: telemetria ausente gravada como 0 em sessões ativas).
- Geração formal do conjunto pareado com critérios rígidos de elegibilidade.
- Exportação de paired-results.csv auditável.
"""

import csv
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional


def _safe_float(val: Any) -> Optional[float]:
    if val is None or val == "" or val == "None" or val == "null" or str(val).lower() == "na":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _safe_int(val: Any) -> Optional[int]:
    if val is None or val == "" or val == "None" or val == "null" or str(val).lower() == "na":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def _sanitize_record(reg: Dict[str, Any]) -> Dict[str, Any]:
    """Saneia registros para garantir que ausência de telemetria seja estritamente None."""
    r = dict(reg)
    # Converte números
    for k in ("entrada", "cache", "saida", "raciocinio", "totais", "tokensNaoCache",
              "inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens",
              "totalTokens", "nonCachedTokens", "tempo", "durationSeconds",
              "arquivos", "adicionadas", "removidas", "modifiedFiles", "addedLines", "removedLines"):
        if k in r:
            r[k] = _safe_float(r[k])

    # Normalização de nomes de campos
    if r.get("totalTokens") is not None and r.get("totais") is None:
        r["totais"] = r["totalTokens"]
    if r.get("totais") is not None and r.get("totalTokens") is None:
        r["totalTokens"] = r["totais"]

    if r.get("inputTokens") is not None and r.get("entrada") is None:
        r["entrada"] = r["inputTokens"]
    if r.get("entrada") is not None and r.get("inputTokens") is None:
        r["inputTokens"] = r["entrada"]

    if r.get("outputTokens") is not None and r.get("saida") is None:
        r["saida"] = r["outputTokens"]
    if r.get("saida") is not None and r.get("outputTokens") is None:
        r["outputTokens"] = r["saida"]

    if r.get("durationSeconds") is not None and r.get("tempo") is None:
        r["tempo"] = r["durationSeconds"]
    if r.get("tempo") is not None and r.get("durationSeconds") is None:
        r["durationSeconds"] = r["tempo"]

    # CORREÇÃO METODOLÓGICA CRUCIAL:
    # Se uma execução ativa durou > 0 segundos mas foi gravada com 0 tokens de entrada, saída e totais
    # (artefato legado de telemetria não instrumentada no modo TUI do Agy), purifica para None!
    # Um modelo LLM executando uma tarefa não consome 0 tokens brutos de entrada e saída.
    cond = str(r.get("condicao", ""))
    dur = r.get("tempo") or r.get("durationSeconds") or r.get("duracao") or 0
    tot = r.get("totais")
    ent = r.get("entrada")
    sai = r.get("saida")

    if tot == 0 and ent == 0 and sai == 0 and (dur > 0 or cond in ("D", "com-harness", "com-contexto-sem-enforcement", "B", "C")):
        r["totais"] = None
        r["totalTokens"] = None
        r["entrada"] = None
        r["inputTokens"] = None
        r["saida"] = None
        r["outputTokens"] = None
        r["cache"] = None
        r["cachedInputTokens"] = None
        r["raciocinio"] = None
        r["reasoningTokens"] = None
        r["tokensNaoCache"] = None
        r["nonCachedTokens"] = None

    return r


def load_dataset(batch_dir: Path) -> Dict[str, Any]:
    """Carrega todos os artefatos estruturados do lote experimental."""
    batch_dir = Path(batch_dir)
    meta_file = batch_dir / "metadata.json"
    metadata = json.loads(meta_file.read_text(encoding="utf-8")) if meta_file.is_file() else {}

    tasks_file = batch_dir / "tasks.json"
    if not tasks_file.is_file():
        default_tasks = Path(__file__).resolve().parent.parent / "tasks.json"
        if default_tasks.is_file():
            try:
                shutil.copy2(default_tasks, tasks_file)
            except Exception:
                pass
    tasks_raw = json.loads(tasks_file.read_text(encoding="utf-8")) if tasks_file.is_file() else {}
    tasks_list = tasks_raw.get("tarefas", []) if isinstance(tasks_raw, dict) else (tasks_raw if isinstance(tasks_raw, list) else [])

    measurements: List[Dict[str, Any]] = []
    measurements_json = batch_dir / "measurements.json"
    measurements_csv = batch_dir / "measurements.csv"

    if measurements_json.is_file():
        try:
            raw_m = json.loads(measurements_json.read_text(encoding="utf-8"))
            measurements = [_sanitize_record(m) for m in raw_m]
        except Exception:
            measurements = []

    if not measurements and measurements_csv.is_file():
        try:
            with open(measurements_csv, encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    measurements.append(_sanitize_record(dict(row)))
        except Exception:
            measurements = []

    # Se ainda estiver vazio, carrega a partir de pastas de execuções (executions/ ou 1/, 2/)
    if not measurements:
        exec_dir = batch_dir / "executions"
        if exec_dir.is_dir():
            for run_dir in sorted(exec_dir.iterdir()):
                res_file = run_dir / "result.json"
                if res_file.is_file():
                    try:
                        d = json.loads(res_file.read_text(encoding="utf-8"))
                        measurements.append(_sanitize_record(d))
                    except Exception:
                        pass
        else:
            for sub in sorted(batch_dir.iterdir()):
                if not sub.is_dir() or sub.name in ("charts", "figures", "report", "aquecimento"):
                    continue
                res_file = sub / "result.json"
                if res_file.is_file():
                    try:
                        d = json.loads(res_file.read_text(encoding="utf-8"))
                        for cond_key, val in d.items():
                            if isinstance(val, dict):
                                measurements.append(_sanitize_record({
                                    **val,
                                    "tarefa": sub.name,
                                    "runId": f"{sub.name}-{cond_key}"
                                }))
                    except Exception:
                        pass

    # Carrega dados de reconhecimento semântico
    sem_file = batch_dir / "semantic-recognition.json"
    semantic_rec = json.loads(sem_file.read_text(encoding="utf-8")) if sem_file.is_file() else {}

    # Enriquece metadata com base nas medições ou no diretório
    if measurements:
        first_m = measurements[0]
        if "agente" not in metadata and "agente" in first_m:
            metadata["agente"] = first_m["agente"]
        if "modelo" not in metadata and "modelo" in first_m:
            metadata["modelo"] = first_m["modelo"]
        if "lote" not in metadata and "lote" in first_m:
            metadata["lote"] = first_m["lote"]
    if "lote" not in metadata:
        metadata["lote"] = batch_dir.name
    if "agente" not in metadata:
        if batch_dir.name.startswith("agy-"):
            metadata["agente"] = "agy"
        elif batch_dir.name.startswith("codex-"):
            metadata["agente"] = "codex"
    if "commitBsh" not in metadata:
        try:
            git_root = Path(__file__).resolve().parent.parent.parent
            res = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, cwd=git_root)
            if res.returncode == 0 and res.stdout.strip():
                metadata["commitBsh"] = res.stdout.strip()
        except Exception:
            pass

    if metadata and not meta_file.is_file():
        try:
            meta_file.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    # Sincroniza measurements.json saneado
    if measurements:
        try:
            (batch_dir / "measurements.json").write_text(json.dumps(measurements, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    return {
        "batch_dir": batch_dir,
        "metadata": metadata,
        "tasks": tasks_list,
        "tasks_raw": tasks_raw,
        "measurements": measurements,
        "semantic_rec": semantic_rec,
    }


def compute_paired_dataset(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Gera pares entre a condição direta (A / sem-harness) e governada (D / com-harness) com elegibilidade estrita."""
    measurements = data.get("measurements", [])
    tasks_list = data.get("tasks", [])
    tasks_map = {t["id"]: t for t in tasks_list if isinstance(t, dict) and "id" in t}

    # Se tasks_map estiver vazio, adota padrão conhecido de 10 tarefas do piloto
    default_ids = ["V1", "V2", "V3", "V4", "V5", "G1", "G2", "G3", "I1", "U1"]
    all_task_ids = list(tasks_map.keys()) if tasks_map else default_ids

    # Também adiciona tarefas que foram observadas nas medições mas não estavam no manifesto
    for m in measurements:
        tid = str(m.get("tarefa") or "").split("-")[0]
        if tid and tid not in all_task_ids:
            all_task_ids.append(tid)

    # Mapeia observações por tarefa e condição, suportando múltiplas rodadas (rounds)
    counts: Dict[str, Dict[str, int]] = {}
    by_task: Dict[str, Dict[str, Any]] = {}
    ordered_pair_keys: List[str] = []

    for m in measurements:
        raw_tid = str(m.get("tarefa") or "").split("-")[0]
        cond = str(m.get("condicao", ""))
        counts.setdefault(raw_tid, {})
        curr_rep = counts[raw_tid].get(cond, 0) + 1
        counts[raw_tid][cond] = curr_rep
        pair_key = f"{raw_tid}#{curr_rep}" if curr_rep > 1 else raw_tid
        if pair_key not in ordered_pair_keys:
            ordered_pair_keys.append(pair_key)
        by_task.setdefault(pair_key, {})[cond] = m

    # Garante que tarefas do manifesto sem execuções também apareçam como não executadas
    for tid in all_task_ids:
        if tid not in ordered_pair_keys:
            ordered_pair_keys.append(tid)

    paired: List[Dict[str, Any]] = []

    for pair_id in ordered_pair_keys:
        raw_tid = pair_id.split("#")[0]
        conds = by_task.get(pair_id, {})
        direto = conds.get("A") or conds.get("sem-harness") or {}
        bsh = conds.get("D") or conds.get("com-harness") or {}

        tinfo = tasks_map.get(raw_tid, {})
        tipo = tinfo.get("tipo") or direto.get("tipo") or bsh.get("tipo") or "desconhecido"

        tok_dir = _safe_float(direto.get("totais") if direto.get("totais") is not None else direto.get("totalTokens"))
        tok_bsh = _safe_float(bsh.get("totais") if bsh.get("totais") is not None else bsh.get("totalTokens"))

        dur_dir = _safe_float(direto.get("tempo") if direto.get("tempo") is not None else direto.get("durationSeconds"))
        dur_bsh = _safe_float(bsh.get("tempo") if bsh.get("tempo") is not None else bsh.get("durationSeconds"))

        nc_dir = _safe_float(direto.get("tokensNaoCache") if direto.get("tokensNaoCache") is not None else direto.get("nonCachedTokens"))
        nc_bsh = _safe_float(bsh.get("tokensNaoCache") if bsh.get("tokensNaoCache") is not None else bsh.get("nonCachedTokens"))

        cls_dir = direto.get("classificacao") or direto.get("classification")
        cls_bsh = bsh.get("classificacao") or bsh.get("classification")

        # Critérios estritos de elegibilidade para comparação de tokens (Requirement 8)
        eligible_tokens = False
        exclusion_reason = ""

        if not direto and not bsh:
            exclusion_reason = "Tarefa não executada"
        elif not direto:
            exclusion_reason = "Condição direta (A) não executada"
        elif not bsh:
            exclusion_reason = "Condição governada (D) não executada"
        elif direto.get("erro") or bsh.get("erro") or cls_dir == "FALHA_TECNICA" or cls_bsh == "FALHA_TECNICA":
            exclusion_reason = "Falha técnica na execução"
        elif cls_bsh == "FALHA_INSTRUMENTACAO":
            exclusion_reason = "Falha de instrumentação"
        elif tok_dir is None and tok_bsh is None:
            exclusion_reason = "Telemetria de tokens ausente em ambas as condições"
        elif tok_dir is None:
            exclusion_reason = "Telemetria de tokens ausente na condição direta (A)"
        elif tok_bsh is None:
            exclusion_reason = "Telemetria de tokens ausente na condição governada (D)"
        elif tok_dir <= 0:
            exclusion_reason = "Tokens da condição direta inválidos (<= 0)"
        else:
            eligible_tokens = True

        eligible_gov = (cls_bsh is not None) and (cls_bsh not in ("FALHA_TECNICA", "FALHA_INSTRUMENTACAO"))

        dif_abs = (tok_bsh - tok_dir) if (eligible_tokens and tok_bsh is not None and tok_dir is not None) else None
        dif_pct = (((tok_bsh - tok_dir) / tok_dir) * 100.0) if (eligible_tokens and tok_bsh is not None and tok_dir is not None and tok_dir > 0) else None
        fator_custo = (tok_bsh / tok_dir) if (eligible_tokens and tok_bsh is not None and tok_dir is not None and tok_dir > 0) else None

        paired.append({
            "taskId": pair_id,
            "tarefa": pair_id,
            "taskType": tipo,
            "tipo": tipo,
            "tokensA": tok_dir,
            "tokensD": tok_bsh,
            "tokens_direto": tok_dir,
            "tokens_bsh": tok_bsh,
            "nonCachedTokensA": nc_dir,
            "nonCachedTokensD": nc_bsh,
            "tokens_nao_cache_direto": nc_dir,
            "tokens_nao_cache_bsh": nc_bsh,
            "durationA": dur_dir,
            "durationD": dur_bsh,
            "tempo_direto": dur_dir,
            "tempo_bsh": dur_bsh,
            "classificationA": cls_dir,
            "classificationD": cls_bsh,
            "classificacao_direto": cls_dir,
            "classificacao_bsh": cls_bsh,
            "differenceTokens": dif_abs,
            "diferenca_absoluta": dif_abs,
            "percentageDifference": dif_pct,
            "diferenca_percentual": dif_pct,
            "costFactor": fator_custo,
            "fator_custo": fator_custo,
            "eligibleForTokenAnalysis": eligible_tokens,
            "eligibleForGovernanceAnalysis": eligible_gov,
            "exclusionReason": exclusion_reason,
            "blocked": bsh.get("bloqueado", False),
            "promoted": bsh.get("promovido", False),
            "originChanged": bsh.get("origemAlterada", False),
            "changeSetDetected": bsh.get("changeSetDetected", bsh.get("arquivos", 0) > 0),
        })

    return paired


def export_paired_csv(paired: List[Dict[str, Any]], out_path: Path) -> None:
    """Exporta o arquivo estruturado paired-results.csv conforme especificação (Requirement 7)."""
    fields = [
        "taskId", "taskType", "tokensA", "tokensD", "nonCachedTokensA", "nonCachedTokensD",
        "durationA", "durationD", "classificationA", "classificationD", "differenceTokens",
        "percentageDifference", "costFactor", "eligibleForTokenAnalysis",
        "eligibleForGovernanceAnalysis", "exclusionReason"
    ]
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for p in paired:
            # Formata None explicitamente como string vazia (padrão CSV)
            row = {}
            for k in fields:
                val = p.get(k)
                row[k] = "" if val is None else val
            writer.writerow(row)
