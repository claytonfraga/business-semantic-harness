import math
import statistics

T_95 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
    9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
    16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086, 21: 2.080, 22: 2.074,
    23: 2.069, 24: 2.064, 25: 2.060, 26: 2.056, 27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042,
}


def describe(values):
    valores = [valor for valor in values if valor is not None]
    n = len(valores)
    if n == 0:
        return {"n": 0, "media": 0.0, "mediana": 0.0, "desvio": 0.0, "min": 0.0, "max": 0.0, "ic95": 0.0, "cv": 0.0}
    media = statistics.mean(valores)
    desvio = statistics.stdev(valores) if n > 1 else 0.0
    erro_padrao = desvio / math.sqrt(n) if n > 1 else 0.0
    t = T_95.get(n - 1, 1.96)
    return {
        "n": n, "media": media, "mediana": statistics.median(valores), "desvio": desvio,
        "min": min(valores), "max": max(valores), "ic95": t * erro_padrao,
        "cv": (desvio / media * 100) if media else 0.0,
    }


def cohen_d(grupo_a, grupo_b):
    a = [valor for valor in grupo_a if valor is not None]
    b = [valor for valor in grupo_b if valor is not None]
    if len(a) < 2 or len(b) < 2:
        return 0.0
    pooled = math.sqrt(((len(a) - 1) * statistics.variance(a) + (len(b) - 1) * statistics.variance(b)) / (len(a) + len(b) - 2))
    if pooled == 0:
        return 0.0
    return (statistics.mean(a) - statistics.mean(b)) / pooled
