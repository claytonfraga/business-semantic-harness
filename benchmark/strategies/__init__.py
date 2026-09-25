"""Estratégias de condições experimentais do BSH Benchmark."""

from .base import ExperimentalConditionStrategy, evaluate_workspace_changes
from .direct import DirectConditionStrategy
from .text_rules import TextRulesConditionStrategy
from .ontology_consultive import OntologyConsultiveConditionStrategy
from .full_bsh import FullBshConditionStrategy

CONDITION_STRATEGIES = {
    "A": DirectConditionStrategy(),
    "B": TextRulesConditionStrategy(),
    "C": OntologyConsultiveConditionStrategy(),
    "D": FullBshConditionStrategy(),
}

__all__ = [
    "ExperimentalConditionStrategy",
    "evaluate_workspace_changes",
    "DirectConditionStrategy",
    "TextRulesConditionStrategy",
    "OntologyConsultiveConditionStrategy",
    "FullBshConditionStrategy",
    "CONDITION_STRATEGIES",
]
