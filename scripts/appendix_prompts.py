"""Gera o fragmento TeX do apendice de prompts de um batch do benchmark."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from benchmark.core.experimental_report import _appendix_prompts  # noqa: E402


def main(batch_dir: str, output: str) -> None:
    batch = Path(batch_dir)
    lines = _appendix_prompts(batch)
    Path(output).write_text("\n".join(lines) + "\n", encoding="utf-8")
    runs = len([p for p in (batch / "executions").glob("*/result.json")])
    print("apendice gerado: " + output + " | runs=" + str(runs) + " | linhas=" + str(len(lines)))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
