"""Sincroniza um batch concluído da worktree experimental para a worktree original.

Persistência apenas: não reexecuta, reclassifica, regenera nem normaliza dados.
"""

import hashlib
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

WT = Path("/home/clayton/projetos/bsh-codebase-change-observability")
ORIGINAL = Path("/home/clayton/projetos/oracle")


def aggregate(root):
    digest = hashlib.sha256()
    count = 0
    total = 0
    files = sorted(path for path in root.rglob("*") if path.is_file() and path.name != "batch-sync-manifest.json")
    for path in files:
        rel = path.relative_to(root).as_posix()
        data = path.read_bytes()
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(str(len(data)).encode("utf-8"))
        digest.update(b"\0")
        digest.update(data)
        count += 1
        total += len(data)
    return {"fileCount": count, "totalBytes": total, "treeHash": digest.hexdigest()}


def commit():
    result = subprocess.run(["git", "-C", str(WT), "rev-parse", "HEAD"],
                            capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def file_hashes(root):
    result = {}
    for path in sorted(path for path in root.rglob("*") if path.is_file() and path.name != "batch-sync-manifest.json"):
        result[path.relative_to(root).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def dest_is_subset(source, dest):
    """True se todo arquivo do destino existe idêntico na origem (origem pode ter mais: progresso)."""
    src_files = file_hashes(source)
    dst_files = file_hashes(dest)
    if len(dst_files) > len(src_files):
        return False
    return all(src_files.get(rel) == digest for rel, digest in dst_files.items())


def sync(batch_id, status):
    source = WT / "benchmark" / "results" / batch_id
    dest = ORIGINAL / "benchmark" / "results" / batch_id
    if not source.is_dir():
        print("HARD_FAIL: batch de origem inexistente: " + str(source))
        return 2
    src = aggregate(source)
    if dest.is_dir():
        dst = aggregate(dest)
        if src == dst:
            print("ja sincronizado e identico: " + batch_id)
            return 0
        if not dest_is_subset(source, dest):
            print("HARD_FAIL: destino existente difere da origem: " + batch_id)
            return 2
        shutil.rmtree(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, dest)
    dst = aggregate(dest)
    ok = src == dst
    manifest = {
        "batchId": batch_id, "status": status,
        "sourceWorktree": str(WT), "sourceCommit": commit(),
        "destinationWorktree": str(ORIGINAL),
        "syncedAt": datetime.now(timezone.utc).isoformat(),
        "fileCount": dst["fileCount"], "totalBytes": dst["totalBytes"],
        "sourceTreeHash": src["treeHash"], "destinationTreeHash": dst["treeHash"],
        "status_sync": "SYNCHRONIZED" if ok else "HARD_FAIL",
    }
    (dest / "batch-sync-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    journal = ORIGINAL / "diario_de_bordo.md"
    line = ("- {time} | batch={batch} | status={status} | origem={src} | commit={commit} | destino={dst} "
            "| arquivos={files} | hash={hash} | resultado={result}\n").format(
        time=manifest["syncedAt"], batch=batch_id, status=status, src=WT, commit=manifest["sourceCommit"],
        dst=ORIGINAL, files=dst["fileCount"], hash=dst["treeHash"][:16], result=manifest["status_sync"])
    header = "# Diario de bordo - incorporacao de batches experimentais\n\n" if not journal.is_file() else ""
    journal.write_text((journal.read_text(encoding="utf-8") if journal.is_file() else header) + line, encoding="utf-8")
    print(("OK sincronizado: " if ok else "HARD_FAIL: ") + batch_id)
    return 0 if ok else 2


if __name__ == "__main__":
    batch = sys.argv[1]
    status = sys.argv[2] if len(sys.argv) > 2 else "DIAGNOSTIC"
    sys.exit(sync(batch, status))
