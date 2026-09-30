#!/usr/bin/env python3
"""Gerador da Base Semântica Enriquecida do Domínio de Gestão Patrimonial.

Produz instâncias RDF, relações realistas, eventos históricos e fixtures de validação
com semente pseudoaleatória fixa (fixedSeed = 20260926).
"""

import json
from pathlib import Path
import random
from typing import Any, Dict, List

SEED = 20260926
random.seed(SEED)

HERE = Path(__file__).resolve().parent
PROJECT_ROOT = HERE.parent
DOMAIN_DIR = PROJECT_ROOT / ".bsh" / "domains" / "ativos"
FIXTURES_DIR = DOMAIN_DIR / "semantic-test-fixtures"
FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

DEPARTAMENTOS = [
    {"id": "ex:depto-ti", "nome": "Tecnologia da Informação"},
    {"id": "ex:depto-operacoes", "nome": "Operações e Logística"},
    {"id": "ex:depto-financeiro", "nome": "Financeiro e Contabilidade"},
    {"id": "ex:depto-juridico", "nome": "Jurídico e Compliance"},
    {"id": "ex:depto-rh", "nome": "Recursos Humanos"},
    {"id": "ex:depto-engenharia", "nome": "Engenharia e Manutenção"},
    {"id": "ex:depto-administrativo", "nome": "Administração Geral"},
    {"id": "ex:depto-comercial", "nome": "Comercial e Vendas"},
]

CENTROS_DE_CUSTO = [
    {"id": "ex:cc-1001", "codigo": "CC-1001", "nome": "Infraestrutura Corporativa"},
    {"id": "ex:cc-1002", "codigo": "CC-1002", "nome": "Desenvolvimento de Sistemas"},
    {"id": "ex:cc-2001", "codigo": "CC-2001", "nome": "Operações Industriais"},
    {"id": "ex:cc-3001", "codigo": "CC-3001", "nome": "Controladoria e Finanças"},
    {"id": "ex:cc-4001", "codigo": "CC-4001", "nome": "Gestão de Pessoas"},
    {"id": "ex:cc-5001", "codigo": "CC-5001", "nome": "Engenharia de Campo"},
    {"id": "ex:cc-6001", "codigo": "CC-6001", "nome": "Frota e Logística"},
    {"id": "ex:cc-7001", "codigo": "CC-7001", "nome": "Administração e Facilities"},
]

NOMES_PESSOAS = [
    "Ana Silva", "Bruno Santos", "Carla Souza", "Daniel Oliveira", "Eduardo Pereira",
    "Fernanda Lima", "Gabriel Costa", "Helena Rodrigues", "Igor Almeida", "Juliana Ribeiro",
    "Lucas Carvalho", "Mariana Gomes", "Nicolas Martins", "Olivia Barbosa", "Paulo Ferreira",
    "Quintino Rocha", "Rafael Moreira", "Sabrina Castro", "Thiago Mendes", "Ursula Nunes",
    "Vinicius Cardoso", "Wagner Correia", "Xavier Dias", "Yasmin Ramos", "Zuleica Teixeira",
    "Alexandre Barros", "Beatriz Cavalcanti", "Caio Guimaraes", "Debora Farias", "Elias Pires",
    "Flavia Freitas", "Gustavo Viana", "Henrique Aragao", "Isabela Borges", "Joao Pedro Moura",
    "Karina Prado", "Leonardo Bezerra", "Melissa Assis", "Norberto Siqueira", "Patricia Meireles"
]

CIDADES_LOCAIS = [
    ("São Paulo - Sede Central - Andar 4", "ex:depto-ti"),
    ("São Paulo - Sede Central - Andar 5", "ex:depto-financeiro"),
    ("São Paulo - Sede Central - Andar 6", "ex:depto-juridico"),
    ("São Paulo - Sede Central - Andar 2", "ex:depto-rh"),
    ("São Paulo - Datacenter Principal", "ex:depto-ti"),
    ("Campinas - Centro Tecnológico - Lab 1", "ex:depto-ti"),
    ("Campinas - Centro Tecnológico - Lab 2", "ex:depto-engenharia"),
    ("Campinas - Almoxarifado Central", "ex:depto-operacoes"),
    ("Santos - Terminal Portuário - Escritório", "ex:depto-operacoes"),
    ("Santos - Terminal Portuário - Armazém", "ex:depto-operacoes"),
    ("Rio de Janeiro - Filial Centro - Sala 301", "ex:depto-comercial"),
    ("Rio de Janeiro - Filial Centro - Sala 302", "ex:depto-administrativo"),
    ("Belo Horizonte - Filial Savassi", "ex:depto-comercial"),
    ("Curitiba - Centro Operacional Sul", "ex:depto-operacoes"),
    ("Porto Alegre - Filial Moinhos", "ex:depto-comercial"),
    ("Brasília - Escritório de Relações Governamentais", "ex:depto-juridico"),
    ("Recife - Hub Nordeste - Sala 10", "ex:depto-ti"),
    ("Recife - Hub Nordeste - Sala 12", "ex:depto-comercial"),
    ("Salvador - Filial Bahia", "ex:depto-operacoes"),
    ("Manaus - Polo Industrial - Fábrica", "ex:depto-engenharia"),
]

MODELOS_TI = [
    ("Notebook Corporativo Dell Latitude 5430", "Dell", 6500.0),
    ("Notebook Alta Performance Lenovo ThinkPad T14", "Lenovo", 8200.0),
    ("Desktop HP EliteDesk 800 G9", "HP", 5800.0),
    ("Servidor Rack Dell PowerEdge R750", "Dell", 45000.0),
    ("Switch Gerenciável Cisco Catalyst 9200", "Cisco", 14500.0),
    ("Monitor Profissional 27' Dell UltraSharp", "Dell", 2200.0),
    ("Storage All-Flash HPE Nimble HF20", "HPE", 89000.0),
]

MODELOS_VEICULOS = [
    ("Furgão Renault Master 2.3 dCi", "Renault", 185000.0),
    ("Caminhonete Toyota Hilux 4x4 Cabine Dupla", "Toyota", 240000.0),
    ("Van de Carga Fiat Ducato MaxiCargo", "Fiat", 195000.0),
    ("Sedan Executivo Toyota Corolla Altis Hybrid", "Toyota", 175000.0),
    ("Utilitário Leve Fiat Strada Endurance", "Fiat", 95000.0),
]

MODELOS_MOBILIARIO = [
    ("Estação de Trabalho Modular 4 Lugares", "Cavaletti", 3800.0),
    ("Cadeira Ergonômica Presidente NR17", "Flexform", 1450.0),
    ("Armário de Aço Deslizante Arquivo Morto", "Biccateca", 8500.0),
    ("Mesa de Reunião Executiva Oval 10 Lugares", "Giroflex", 5200.0),
    ("Gaveteiro Volante 3 Gavetas com Tranca", "Cavaletti", 680.0),
]

MODELOS_EQUIPAMENTOS = [
    ("Grupo Gerador Diesel Stemac 150kVA", "Stemac", 125000.0),
    ("Sistema de Ar-Condicionado Central VRF Daikin", "Daikin", 95000.0),
    ("Nobreak Trifásico Modular Schneider 40kVA", "Schneider", 68000.0),
    ("Empilhadeira Elétrica Retrátil Toyota 2.0T", "Toyota", 160000.0),
    ("Transformador a Seco WEG 500kVA", "WEG", 85000.0),
]

MODELOS_INSTRUMENTACAO = [
    ("Osciloscópio Digital 4 Canais Tektronix TBS2000B", "Tektronix", 18500.0),
    ("Multímetro Digital de Bancada True-RMS Fluke 8846A", "Fluke", 12800.0),
    ("Calibrador de Processos Multifunção Fluke 754", "Fluke", 42000.0),
    ("Analisador de Qualidade de Energia Fluke 435 Series II", "Fluke", 56000.0),
    ("Termômetro e Higrômetro Padrão Calibrado Novus", "Novus", 4500.0),
]


def gerar_base_semantica():
    print(f"Iniciando geração da base semântica com semente {SEED}...")

    # 1. Responsáveis (40)
    responsaveis = []
    for i, nome in enumerate(NOMES_PESSOAS, 1):
        rid = f"ex:responsavel-{i:03d}"
        depto = DEPARTAMENTOS[i % len(DEPARTAMENTOS)]["id"]
        responsaveis.append({
            "@id": rid,
            "@type": "ex:Responsavel",
            "rdfs:label": nome,
            "ex:lotadoEmDepartamento": {"@id": depto},
        })

    # 2. Localizações (20)
    localizacoes = []
    for i, (desc, depto_assoc) in enumerate(CIDADES_LOCAIS, 1):
        lid = f"ex:localizacao-{i:03d}"
        localizacoes.append({
            "@id": lid,
            "@type": "ex:Localizacao",
            "rdfs:label": desc,
            "ex:vinculadoAUnidade": {"@id": depto_assoc},
        })

    # 3. Departamentos e Centros de Custo
    deptos_graph = [{"@id": d["id"], "@type": "ex:Departamento", "rdfs:label": d["nome"]} for d in DEPARTAMENTOS]
    cc_graph = [{"@id": c["id"], "@type": "ex:CentroDeCusto", "rdfs:label": f"{c['codigo']} - {c['nome']}"} for c in CENTROS_DE_CUSTO]

    # 4. Ativos (250)
    # Distribuição planejada de classes:
    # AtivoTI: 90 (36%)
    # AtivoMobiliario: 55 (22%)
    # AtivoEquipamento: 45 (18%)
    # AtivoVeiculo: 35 (14%)
    # AtivoInstrumentacao: 25 (10%)
    # Total = 250
    #
    # Distribuição de estados:
    # Disponivel: 50 (20.0%)
    # EmUso: 105 (42.0%)  -> Total normal = 155 (62.0%) [Target 55%-65%]
    # EmManutencao: 18 (7.2%)
    # EmTransito: 8 (3.2%)
    # Reservado: 7 (2.8%) -> Total intermediário = 33 (13.2%) [Target 10%-15%]
    # Baixado: 26 (10.4%) -> Total baixado = 26 (10.4%) [Target 8%-12%]
    # Extraviado: 6 (2.4%)
    # Total = 250

    status_pool = (
        ["ex:Disponivel"] * 55 +
        ["ex:EmUso"] * 95 +
        ["ex:EmManutencao"] * 30 +
        ["ex:EmTransito"] * 15 +
        ["ex:Reservado"] * 15 +
        ["ex:Baixado"] * 28 +
        ["ex:Extraviado"] * 12
    )
    random.shuffle(status_pool)

    # Distribuição não uniforme de responsáveis:
    # 4 responsáveis com 0 ativos
    # 12 responsáveis com 1 a 3 ativos
    # 16 responsáveis com 4 a 8 ativos
    # 8 responsáveis concentram 10 a 18 ativos
    resp_weights = [0] * 4 + [random.randint(1, 3) for _ in range(12)] + [random.randint(4, 8) for _ in range(16)] + [random.randint(10, 18) for _ in range(8)]
    resp_expanded = []
    for r_idx, w in enumerate(resp_weights):
        resp_expanded.extend([responsaveis[r_idx]["@id"]] * w)
    while len(resp_expanded) < 250:
        resp_expanded.append(random.choice(responsaveis[20:])["@id"])
    random.shuffle(resp_expanded)

    # Distribuição de localizações (não uniforme)
    loc_weights = [random.randint(5, 25) for _ in range(20)]
    loc_expanded = []
    for l_idx, w in enumerate(loc_weights):
        loc_expanded.extend([localizacoes[l_idx]["@id"]] * w)
    while len(loc_expanded) < 250:
        loc_expanded.append(random.choice(localizacoes)["@id"])
    random.shuffle(loc_expanded)

    classes_allocation = (
        ["ex:AtivoTI"] * 90 +
        ["ex:AtivoMobiliario"] * 55 +
        ["ex:AtivoEquipamento"] * 45 +
        ["ex:AtivoVeiculo"] * 35 +
        ["ex:AtivoInstrumentacao"] * 25
    )
    random.shuffle(classes_allocation)

    ativos = []
    for i in range(1, 251):
        aid = f"ex:ativo-{i:03d}"
        aclass = classes_allocation[i - 1]
        astatus = status_pool[i - 1]
        aresp = resp_expanded[i - 1]
        aloc = loc_expanded[i - 1]
        adepto = random.choice(DEPARTAMENTOS)["id"]
        acc = random.choice(CENTROS_DE_CUSTO)["id"]

        ano_acq = random.randint(2018, 2024)
        mes_acq = random.randint(1, 12)
        dia_acq = random.randint(1, 28)
        data_acq = f"{ano_acq:04d}-{mes_acq:02d}-{dia_acq:02d}"

        pat_code = f"PAT-{i:06d}"

        ativo_obj: Dict[str, Any] = {
            "@id": aid,
            "@type": aclass,
            "ex:codigoPatrimonio": pat_code,
            "ex:estadoAtual": {"@id": astatus},
            "ex:dataAquisicao": {"@value": data_acq, "@type": "xsd:date"},
            "ex:temResponsavel": {"@id": aresp},
            "ex:temLocalizacao": {"@id": aloc},
            "ex:pertenceDepartamento": {"@id": adepto},
            "ex:pertenceCentroDeCusto": {"@id": acc},
        }

        if aclass == "ex:AtivoTI":
            mod_desc, fab, val = random.choice(MODELOS_TI)
            val_acq = round(val + random.uniform(-300, 500), 2)
            deprec = round(min(100.0, (2026 - ano_acq) * 20.0), 1)
            val_res = round(max(0.0, val_acq * (1.0 - deprec / 100.0)), 2)
            ativo_obj.update({
                "ex:descricao": mod_desc,
                "ex:fabricante": fab,
                "ex:modelo": mod_desc.split()[-1],
                "ex:numeroSerie": f"SN-{fab[:3].upper()}-{i:05d}{random.randint(100, 999)}",
                "ex:valorAquisicao": {"@value": str(val_acq), "@type": "xsd:decimal"},
                "ex:valorResidual": {"@value": str(val_res), "@type": "xsd:decimal"},
                "ex:percentualDepreciacao": {"@value": str(deprec), "@type": "xsd:decimal"},
                "ex:totalmenteDepreciado": deprec >= 100.0,
                "ex:termoResponsabilidadeAssinado": True,
                "ex:enderecoMac": f"00:1A:2B:3C:{i%90:02X}:{random.randint(10, 250):02X}",
                "ex:nomeEquipamento": f"HOST-TI-{i:03d}",
            })
        elif aclass == "ex:AtivoVeiculo":
            mod_desc, fab, val = random.choice(MODELOS_VEICULOS)
            val_acq = round(val + random.uniform(-5000, 8000), 2)
            deprec = round(min(100.0, (2026 - ano_acq) * 15.0), 1)
            val_res = round(max(0.0, val_acq * (1.0 - deprec / 100.0)), 2)
            letras = f"{chr(65 + (i % 26))}{chr(65 + ((i*3) % 26))}{chr(65 + ((i*7) % 26))}"
            placa = f"{letras}{random.randint(1, 9)}{chr(65 + (i % 26))}{random.randint(10, 99)}"
            renavam = f"{10000000000 + i * 137}"[:11]
            chassi = f"9BWZZZ377VT{i:06d}"
            ativo_obj.update({
                "ex:descricao": mod_desc,
                "ex:fabricante": fab,
                "ex:modelo": mod_desc.split()[1],
                "ex:numeroSerie": chassi,
                "ex:placa": placa,
                "ex:renavam": renavam,
                "ex:chassi": chassi,
                "ex:quilometragem": (2026 - ano_acq) * 18000 + random.randint(1000, 9000),
                "ex:valorAquisicao": {"@value": str(val_acq), "@type": "xsd:decimal"},
                "ex:valorResidual": {"@value": str(val_res), "@type": "xsd:decimal"},
                "ex:percentualDepreciacao": {"@value": str(deprec), "@type": "xsd:decimal"},
                "ex:totalmenteDepreciado": deprec >= 100.0,
            })
        elif aclass == "ex:AtivoMobiliario":
            mod_desc, fab, val = random.choice(MODELOS_MOBILIARIO)
            val_acq = round(val + random.uniform(-100, 200), 2)
            deprec = round(min(100.0, (2026 - ano_acq) * 10.0), 1)
            val_res = round(max(0.0, val_acq * (1.0 - deprec / 100.0)), 2)
            ativo_obj.update({
                "ex:descricao": mod_desc,
                "ex:fabricante": fab,
                "ex:modelo": mod_desc.split()[0],
                "ex:materialPredominante": random.choice(["Aço carbono", "Madeira MDF", "Polipropileno injetado", "Couro ecológico"]),
                "ex:ambienteDestino": random.choice(["Escritório executivo", "Operacional", "Sala de reuniões", "Arquivo"]),
                "ex:valorAquisicao": {"@value": str(val_acq), "@type": "xsd:decimal"},
                "ex:valorResidual": {"@value": str(val_res), "@type": "xsd:decimal"},
                "ex:percentualDepreciacao": {"@value": str(deprec), "@type": "xsd:decimal"},
                "ex:totalmenteDepreciado": deprec >= 100.0,
            })
        elif aclass == "ex:AtivoEquipamento":
            mod_desc, fab, val = random.choice(MODELOS_EQUIPAMENTOS)
            val_acq = round(val + random.uniform(-2000, 5000), 2)
            deprec = round(min(100.0, (2026 - ano_acq) * 12.0), 1)
            val_res = round(max(0.0, val_acq * (1.0 - deprec / 100.0)), 2)
            status_manut = "ex:Isento" if "VRF" in mod_desc else "ex:EmDia"
            ativo_obj.update({
                "ex:descricao": mod_desc,
                "ex:fabricante": fab,
                "ex:modelo": mod_desc.split()[-1],
                "ex:statusManutencao": {"@id": status_manut},
                "ex:dataUltimaManutencao": {"@value": "2025-11-15", "@type": "xsd:date"},
                "ex:dataProximaManutencao": {"@value": "2026-11-15", "@type": "xsd:date"},
                "ex:laudoManutencao": f"LAUDO-MANUT-{i:04d}",
                "ex:valorAquisicao": {"@value": str(val_acq), "@type": "xsd:decimal"},
                "ex:valorResidual": {"@value": str(val_res), "@type": "xsd:decimal"},
                "ex:percentualDepreciacao": {"@value": str(deprec), "@type": "xsd:decimal"},
                "ex:totalmenteDepreciado": deprec >= 100.0,
            })
        elif aclass == "ex:AtivoInstrumentacao":
            mod_desc, fab, val = random.choice(MODELOS_INSTRUMENTACAO)
            val_acq = round(val + random.uniform(-500, 1000), 2)
            deprec = round(min(100.0, (2026 - ano_acq) * 10.0), 1)
            val_res = round(max(0.0, val_acq * (1.0 - deprec / 100.0)), 2)
            ativo_obj.update({
                "ex:descricao": mod_desc,
                "ex:fabricante": fab,
                "ex:modelo": mod_desc.split()[-2],
                "ex:statusCalibracao": {"@id": "ex:CalibracaoEmDia"},
                "ex:dataUltimaCalibracao": {"@value": "2026-01-20", "@type": "xsd:date"},
                "ex:dataProximaCalibracao": {"@value": "2027-01-20", "@type": "xsd:date"},
                "ex:certificadoCalibracao": f"CERT-CALIB-{i:04d}/RBC",
                "ex:valorAquisicao": {"@value": str(val_acq), "@type": "xsd:decimal"},
                "ex:valorResidual": {"@value": str(val_res), "@type": "xsd:decimal"},
                "ex:percentualDepreciacao": {"@value": str(deprec), "@type": "xsd:decimal"},
                "ex:totalmenteDepreciado": deprec >= 100.0,
            })

        ativos.append(ativo_obj)

    # 5. Histórico e Relações (200 eventos)
    eventos = []
    # 70 ativos com 0 eventos
    # 100 ativos com 1 evento
    # 55 ativos com 2 eventos
    # 25 ativos com 3+ eventos
    event_counts = [0] * 70 + [1] * 100 + [2] * 55 + [3] * 25
    random.shuffle(event_counts)

    ev_id = 1
    for a_idx, n_ev in enumerate(event_counts):
        at = ativos[a_idx]
        for e in range(n_ev):
            eid = f"ex:evento-{ev_id:03d}"
            ev_tipo = random.choice([
                "ex:TransferenciaAtivo", "ex:AtualizacaoLocalizacao", "ex:AlteracaoResponsavel",
                "ex:ConclusaoManutencao", "ex:AlocacaoUsuario"
            ])
            data_ev = f"2025-{random.randint(1,12):02d}-{random.randint(1,28):02d}T{random.randint(8,18):02d}:00:00Z"
            evento_obj = {
                "@id": eid,
                "@type": ev_tipo,
                "ex:codigoPatrimonio": at["ex:codigoPatrimonio"],
                "ex:registradoPor": "sistema.auditoria@empresa.com",
                "ex:dataHoraRegistro": {"@value": data_ev, "@type": "xsd:dateTime"},
                "ex:justificativa": f"Movimentação histórica autorizada no ativo {at['ex:codigoPatrimonio']}",
            }
            if ev_tipo == "ex:TransferenciaAtivo":
                evento_obj.update({
                    "ex:estadoAtual": {"@id": "ex:Disponivel"},
                    "ex:novoResponsavel": {"@id": random.choice(responsaveis)["@id"]},
                    "ex:novaLocalizacao": {"@id": random.choice(localizacoes)["@id"]},
                    "ex:solicitante": {"@id": "ex:responsavel-001"},
                    "ex:aprovador": {"@id": "ex:responsavel-002"},
                })
            elif ev_tipo == "ex:ConclusaoManutencao":
                evento_obj.update({
                    "ex:estadoAtual": {"@id": "ex:EmManutencao"},
                    "ex:laudoManutencao": f"LAUDO-HIST-{ev_id:04d}",
                })
            eventos.append(evento_obj)
            ev_id += 1
            if len(eventos) >= 200:
                break
        if len(eventos) >= 200:
            break

    print(f"Gerados: {len(ativos)} ativos, {len(responsaveis)} responsáveis, {len(localizacoes)} locais, {len(eventos)} eventos históricos.")

    # 6. Atualiza ontology.jsonld mantendo todas as classes e policies originais
    orig_onto = json.loads((DOMAIN_DIR / "ontology.jsonld").read_text(encoding="utf-8"))
    orig_graph = orig_onto["@graph"]

    # Remove instâncias antigas se houverem, mantendo apenas classes, propriedades e policies
    schema_graph = [
        item for item in orig_graph
        if item.get("@type") in (
            "bsh:Domain", "rdfs:Class", "rdf:Property", "bsh:Policy"
        ) or item.get("@id") in (
            "ex:Disponivel", "ex:EmUso", "ex:Baixado", "ex:EmManutencao",
            "ex:EmTransito", "ex:Reservado", "ex:Extraviado",
            "ex:EmDia", "ex:Vencida", "ex:Isento",
            "ex:CalibracaoEmDia", "ex:CalibracaoVencida", "ex:CalibracaoIsenta"
        )
    ]

    novo_graph = schema_graph + deptos_graph + cc_graph + localizacoes + responsaveis + ativos + eventos
    orig_onto["@graph"] = novo_graph

    (DOMAIN_DIR / "ontology.jsonld").write_text(json.dumps(orig_onto, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Salvo ontology.jsonld atualizado com {len(novo_graph)} nós no grafo.")

    # Salva baseline-valid-data.jsonld em semantic-test-fixtures
    baseline_doc = {
        "@context": orig_onto["@context"],
        "@graph": deptos_graph + cc_graph + localizacoes + responsaveis + ativos + eventos
    }
    (FIXTURES_DIR / "baseline-valid-data.jsonld").write_text(json.dumps(baseline_doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # 7. Fixtures Semânticos e Casos de Teste (semantic-cases.json)
    # Gera situações de Transferência, Baixa e demais operações:
    cases = []
    valid_fixtures = []
    invalid_fixtures = []
    boundary_fixtures = []
    multi_rule_fixtures = []

    # 7.1. Casos de Transferência (110 casos: 40 válidos, 30 inválidos, 20 fronteira, 20 multirregra)
    # A) 40 claramente transferíveis
    for i in range(1, 41):
        cid = f"CASE-TRANSF-VALID-{i:03d}"
        at = ativos[i - 1]
        resp_dest = responsaveis[(i + 5) % len(responsaveis)]
        depto_dest = resp_dest["ex:lotadoEmDepartamento"]["@id"]
        loc_dest = localizacoes[(i + 3) % len(localizacoes)]

        fix_obj = {
            "@id": f"ex:fix-transf-v-{i:03d}",
            "@type": "ex:TransferenciaAtivo",
            "ex:estadoAtual": {"@id": "ex:EmUso"},
            "ex:novoResponsavel": {"@id": resp_dest["@id"]},
            "ex:novaLocalizacao": {"@id": loc_dest["@id"]},
            "ex:departamentoDestino": {"@id": depto_dest},
            "ex:solicitante": {"@id": "ex:responsavel-001"},
            "ex:aprovador": {"@id": "ex:responsavel-002"},
            "ex:justificativa": f"Transferência operacional planejada do ativo {at['ex:codigoPatrimonio']} para expansão da equipe",
            "ex:registradoPor": "gestor.patrimonio@empresa.com",
            "ex:dataHoraRegistro": {"@value": "2026-03-10T14:30:00Z", "@type": "xsd:dateTime"}
        }
        valid_fixtures.append(fix_obj)
        cases.append({
            "caseId": cid,
            "entityIds": [fix_obj["@id"], at["@id"]],
            "operation": "TransferenciaAtivo",
            "expectedSemanticStatus": "VALID",
            "expectedShapes": ["ex:TransferenciaShape", "ex:TransferenciaCompatibilidadeOrganizacionalShape"],
            "expectedRules": ["Regra-Transf-EstadoValido", "Regra-Transf-Segregacao", "Regra-Transf-LotacaoDestino"],
            "caseType": "VALID",
            "complexity": "STANDARD",
            "description": f"Transferência válida de ativo em uso com novo responsável lotado no departamento de destino e segregação de aprovador."
        })

    # B) 30 claramente inválidos
    motivos_inval = [
        ("ex:Baixado", "ex:responsavel-005", "ex:depto-ti", "ex:responsavel-001", "ex:responsavel-002", "Ativo baixado não pode ser transferido.", "ex:TransferenciaShape"),
        ("ex:EmUso", None, "ex:depto-ti", "ex:responsavel-001", "ex:responsavel-002", "Transferência sem novo responsável especificado.", "ex:TransferenciaShape"),
        ("ex:EmUso", "ex:responsavel-005", "ex:depto-ti", "ex:responsavel-003", "ex:responsavel-003", "Solicitante e aprovador são a mesma pessoa (violação de segregação).", "ex:TransferenciaShape"),
        ("ex:EmUso", "ex:responsavel-005", "ex:depto-juridico", "ex:responsavel-001", "ex:responsavel-002", "Novo responsável não pertence ao departamento de destino.", "ex:TransferenciaCompatibilidadeOrganizacionalShape"),
    ]
    for i in range(1, 31):
        cid = f"CASE-TRANSF-INVALID-{i:03d}"
        est, resp_id, dep_dest, sol, apr, desc, exp_shape = motivos_inval[i % len(motivos_inval)]
        fix_obj = {
            "@id": f"ex:fix-transf-inv-{i:03d}",
            "@type": "ex:TransferenciaAtivo",
            "ex:estadoAtual": {"@id": est},
            "ex:novaLocalizacao": {"@id": "ex:localizacao-001"},
            "ex:departamentoDestino": {"@id": dep_dest},
            "ex:solicitante": {"@id": sol},
            "ex:aprovador": {"@id": apr},
            "ex:justificativa": "Solicitação com inconsistência semântica proposital",
            "ex:registradoPor": "auditor@empresa.com",
            "ex:dataHoraRegistro": {"@value": "2026-03-11T10:00:00Z", "@type": "xsd:dateTime"}
        }
        if resp_id:
            fix_obj["ex:novoResponsavel"] = {"@id": resp_id}
        invalid_fixtures.append(fix_obj)
        cases.append({
            "caseId": cid,
            "entityIds": [fix_obj["@id"]],
            "operation": "TransferenciaAtivo",
            "expectedSemanticStatus": "INVALID",
            "expectedShapes": [exp_shape],
            "expectedRules": ["Regra-Restricao-Transferencia"],
            "caseType": "INVALID",
            "complexity": "STANDARD",
            "description": desc
        })

    # C) 20 Casos de Fronteira (Transferência)
    for i in range(1, 21):
        cid = f"CASE-TRANSF-BOUNDARY-{i:03d}"
        is_valid = (i % 2 == 1)
        resp_dest = responsaveis[(i + 10) % len(responsaveis)]
        depto_dest = resp_dest["ex:lotadoEmDepartamento"]["@id"] if is_valid else "ex:depto-financeiro"
        fix_obj = {
            "@id": f"ex:fix-transf-bnd-{i:03d}",
            "@type": "ex:TransferenciaAtivo",
            "ex:estadoAtual": {"@id": "ex:Disponivel" if is_valid else "ex:EmManutencao"},
            "ex:novoResponsavel": {"@id": resp_dest["@id"]},
            "ex:novaLocalizacao": {"@id": "ex:localizacao-002"},
            "ex:departamentoDestino": {"@id": depto_dest},
            "ex:solicitante": {"@id": "ex:responsavel-004"},
            "ex:aprovador": {"@id": "ex:responsavel-005"},
            "ex:justificativa": "Transferência em condição limítrofe de fronteira operacional",
            "ex:registradoPor": "fronteira.teste@empresa.com",
            "ex:dataHoraRegistro": {"@value": "2026-03-12T11:00:00Z", "@type": "xsd:dateTime"}
        }
        boundary_fixtures.append(fix_obj)
        cases.append({
            "caseId": cid,
            "entityIds": [fix_obj["@id"]],
            "operation": "TransferenciaAtivo",
            "expectedSemanticStatus": "BOUNDARY_VALID" if is_valid else "BOUNDARY_INVALID",
            "expectedShapes": ["ex:TransferenciaShape"] if not is_valid else [],
            "expectedRules": ["Regra-Fronteira-Estado-Lotacao"],
            "caseType": "BOUNDARY_VALID" if is_valid else "BOUNDARY_INVALID",
            "complexity": "BOUNDARY",
            "description": "Caso de fronteira avaliando estados adjacentes e lotação departamental em transição."
        })

    # D) 20 Casos Multirregra (Transferência)
    for i in range(1, 21):
        cid = f"CASE-TRANSF-MULTIRULE-{i:03d}"
        is_valid = (i % 2 == 1)
        fix_obj = {
            "@id": f"ex:fix-transf-multi-{i:03d}",
            "@type": "ex:TransferenciaAtivo",
            "ex:estadoAtual": {"@id": "ex:EmUso" if is_valid else "ex:Baixado"},
            "ex:novoResponsavel": {"@id": "ex:responsavel-006"},
            "ex:novaLocalizacao": {"@id": "ex:localizacao-003"},
            "ex:departamentoDestino": {"@id": "ex:depto-ti" if is_valid else "ex:depto-juridico"},
            "ex:solicitante": {"@id": "ex:responsavel-007"},
            "ex:aprovador": {"@id": "ex:responsavel-008" if is_valid else "ex:responsavel-007"},
            "ex:justificativa": "Operação multirregra envolvendo estado, lotação e alçada combinadas",
            "ex:registradoPor": "multirregra@empresa.com",
            "ex:dataHoraRegistro": {"@value": "2026-03-13T16:00:00Z", "@type": "xsd:dateTime"}
        }
        multi_rule_fixtures.append(fix_obj)
        cases.append({
            "caseId": cid,
            "entityIds": [fix_obj["@id"]],
            "operation": "TransferenciaAtivo",
            "expectedSemanticStatus": "MULTI_RULE_VALID" if is_valid else "MULTI_RULE_INVALID",
            "expectedShapes": ["ex:TransferenciaShape", "ex:TransferenciaCompatibilidadeOrganizacionalShape"] if not is_valid else [],
            "expectedRules": ["Regra-Multi-Estado-Segregacao-Lotacao"],
            "caseType": "MULTI_RULE_VALID" if is_valid else "MULTI_RULE_INVALID",
            "complexity": "MULTI_RULE",
            "description": "Combinação simultânea de regras de estado de ativo, segregação de funções e compatibilidade organizacional."
        })

    # 7.2. Casos de Baixa (110 casos: 40 válidos, 30 inválidos, 20 fronteira, 20 multirregra)
    # A) 40 claramente elegíveis para baixa
    for i in range(1, 41):
        cid = f"CASE-BAIXA-VALID-{i:03d}"
        val_res = 0.0 if i <= 20 else 150.0
        fix_obj = {
            "@id": f"ex:fix-baixa-v-{i:03d}",
            "@type": "ex:BaixaAtivo",
            "ex:estadoAtual": {"@id": "ex:EmUso"},
            "ex:motivoBaixa": "Sucateamento por desgaste técnico irremediável comprovado",
            "ex:valorResidual": {"@value": str(val_res), "@type": "xsd:decimal"},
            "ex:valorAquisicao": {"@value": "4500.00", "@type": "xsd:decimal"},
            "ex:registradoPor": "gestor.patrimonio@empresa.com",
            "ex:dataHoraRegistro": {"@value": "2026-03-14T09:00:00Z", "@type": "xsd:dateTime"}
        }
        if val_res > 0:
            fix_obj["ex:laudoTecnicoDescarte"] = f"LAUDO-DESC-{i:04d}"
        valid_fixtures.append(fix_obj)
        cases.append({
            "caseId": cid,
            "entityIds": [fix_obj["@id"]],
            "operation": "BaixaAtivo",
            "expectedSemanticStatus": "VALID",
            "expectedShapes": ["ex:BaixaShape", "ex:BaixaValorResidualShape"],
            "expectedRules": ["Regra-Baixa-Motivo", "Regra-Baixa-ValorResidualLaudo"],
            "caseType": "VALID",
            "complexity": "STANDARD",
            "description": "Baixa válida com motivo justificado e laudo técnico para valor residual positivo."
        })

    # B) 30 claramente não elegíveis
    motivos_baixa_inv = [
        ("ex:Baixado", "Motivo qualquer", 0.0, "Ativo já baixado não pode sofrer nova baixa.", "ex:BaixaShape"),
        ("ex:EmUso", None, 0.0, "Baixa sem motivo obrigatório.", "ex:BaixaShape"),
        ("ex:EmUso", "Descarte", 2500.0, "Baixa com valor residual positivo sem laudo técnico de descarte.", "ex:BaixaValorResidualShape"),
    ]
    for i in range(1, 31):
        cid = f"CASE-BAIXA-INVALID-{i:03d}"
        est, mot, vr, desc, exp_shape = motivos_baixa_inv[i % len(motivos_baixa_inv)]
        fix_obj = {
            "@id": f"ex:fix-baixa-inv-{i:03d}",
            "@type": "ex:BaixaAtivo",
            "ex:estadoAtual": {"@id": est},
            "ex:valorResidual": {"@value": str(vr), "@type": "xsd:decimal"},
            "ex:valorAquisicao": {"@value": "8000.00", "@type": "xsd:decimal"},
            "ex:registradoPor": "auditor@empresa.com",
            "ex:dataHoraRegistro": {"@value": "2026-03-15T11:00:00Z", "@type": "xsd:dateTime"}
        }
        if mot:
            fix_obj["ex:motivoBaixa"] = mot
        invalid_fixtures.append(fix_obj)
        cases.append({
            "caseId": cid,
            "entityIds": [fix_obj["@id"]],
            "operation": "BaixaAtivo",
            "expectedSemanticStatus": "INVALID",
            "expectedShapes": [exp_shape],
            "expectedRules": ["Regra-Restricao-Baixa"],
            "caseType": "INVALID",
            "complexity": "STANDARD",
            "description": desc
        })

    # C) 20 Casos de Fronteira (Baixa)
    for i in range(1, 21):
        cid = f"CASE-BAIXA-BOUNDARY-{i:03d}"
        is_valid = (i % 2 == 1)
        vr = 0.0 if is_valid else 0.01  # limiar de valor residual positivo
        fix_obj = {
            "@id": f"ex:fix-baixa-bnd-{i:03d}",
            "@type": "ex:BaixaAtivo",
            "ex:estadoAtual": {"@id": "ex:EmUso"},
            "ex:motivoBaixa": "Baixa em situação limítrofe contábil de obsolescência",
            "ex:valorResidual": {"@value": str(vr), "@type": "xsd:decimal"},
            "ex:valorAquisicao": {"@value": "9999.00", "@type": "xsd:decimal"},
            "ex:registradoPor": "fronteira@empresa.com",
            "ex:dataHoraRegistro": {"@value": "2026-03-16T15:00:00Z", "@type": "xsd:dateTime"}
        }
        if is_valid and vr > 0:
            fix_obj["ex:laudoTecnicoDescarte"] = "LAUDO-BND-01"
        boundary_fixtures.append(fix_obj)
        cases.append({
            "caseId": cid,
            "entityIds": [fix_obj["@id"]],
            "operation": "BaixaAtivo",
            "expectedSemanticStatus": "BOUNDARY_VALID" if is_valid else "BOUNDARY_INVALID",
            "expectedShapes": ["ex:BaixaValorResidualShape"] if not is_valid else [],
            "expectedRules": ["Regra-Fronteira-ValorResidual-Zero"],
            "caseType": "BOUNDARY_VALID" if is_valid else "BOUNDARY_INVALID",
            "complexity": "BOUNDARY",
            "description": "Fronteira contábil exata entre valor residual nulo e valor residual positivo sem laudo."
        })

    # D) 20 Casos Multirregra (Baixa)
    for i in range(1, 21):
        cid = f"CASE-BAIXA-MULTIRULE-{i:03d}"
        is_valid = (i % 2 == 1)
        va = 15000.00
        vr = 3200.00
        fix_obj = {
            "@id": f"ex:fix-baixa-multi-{i:03d}",
            "@type": "ex:BaixaAtivo",
            "ex:estadoAtual": {"@id": "ex:Disponivel" if is_valid else "ex:Baixado"},
            "ex:valorAquisicao": {"@value": str(va), "@type": "xsd:decimal"},
            "ex:valorResidual": {"@value": str(vr), "@type": "xsd:decimal"},
            "ex:registradoPor": "multirregra@empresa.com",
            "ex:dataHoraRegistro": {"@value": "2026-03-17T17:00:00Z", "@type": "xsd:dateTime"}
        }
        if is_valid:
            fix_obj.update({
                "ex:motivoBaixa": "Descarte com laudo técnico e aprovação formal executiva",
                "ex:laudoTecnicoDescarte": f"LAUDO-EXEC-{i:04d}",
                "ex:aprovador": {"@id": "ex:responsavel-001"}
            })
        multi_rule_fixtures.append(fix_obj)
        cases.append({
            "caseId": cid,
            "entityIds": [fix_obj["@id"]],
            "operation": "BaixaAtivo",
            "expectedSemanticStatus": "MULTI_RULE_VALID" if is_valid else "MULTI_RULE_INVALID",
            "expectedShapes": ["ex:BaixaShape", "ex:BaixaValorResidualShape", "ex:BaixaAltoValorAprovacaoShape"] if not is_valid else [],
            "expectedRules": ["Regra-Multi-Baixa-Residual-Alcada"],
            "caseType": "MULTI_RULE_VALID" if is_valid else "MULTI_RULE_INVALID",
            "complexity": "MULTI_RULE",
            "description": "Interação de regras de estado de ativo, laudo de valor residual e alçada formal para alto valor (> R$ 10.000)."
        })

    # 7.3. Casos das Demais Operações (Alocação, Reserva, Manutenção, Envio/Recebimento, Extravio)
    # 10 válidos e 10 inválidos por shape
    shapes_demais = [
        ("AlocacaoUsuario", "ex:AlocacaoUsuarioShape", "ex:Disponivel", "ex:EmManutencao", {"ex:novoResponsavel": {"@id": "ex:responsavel-001"}, "ex:termoResponsabilidadeAssinado": True}, {"ex:novoResponsavel": {"@id": "ex:responsavel-001"}, "ex:termoResponsabilidadeAssinado": False}),
        ("ReservaAtivo", "ex:ReservaAtivoShape", "ex:Disponivel", "ex:EmUso", {"ex:solicitanteReserva": {"@id": "ex:responsavel-002"}, "ex:dataInicioReserva": {"@value": "2026-04-01", "@type": "xsd:date"}, "ex:dataFimReserva": {"@value": "2026-04-10", "@type": "xsd:date"}, "ex:motivoReserva": "Projeto X"}, {"ex:solicitanteReserva": {"@id": "ex:responsavel-002"}, "ex:dataInicioReserva": {"@value": "2026-04-01", "@type": "xsd:date"}, "ex:dataFimReserva": {"@value": "2026-04-10", "@type": "xsd:date"}}),
        ("InicioManutencao", "ex:InicioManutencaoShape", "ex:EmUso", "ex:Baixado", {"ex:motivoManutencao": "Tela trincada"}, {}),
        ("ConclusaoManutencao", "ex:ConclusaoManutencaoShape", "ex:EmManutencao", "ex:Disponivel", {"ex:laudoManutencao": "Reparo efetuado"}, {}),
        ("EnvioAtivo", "ex:EnvioAtivoShape", "ex:Disponivel", "ex:EmTransito", {"ex:origem": {"@id": "ex:localizacao-001"}, "ex:destino": {"@id": "ex:localizacao-002"}, "ex:transportador": "LogExpress"}, {"ex:origem": {"@id": "ex:localizacao-001"}, "ex:destino": {"@id": "ex:localizacao-001"}, "ex:transportador": "LogExpress"}),
        ("RecebimentoAtivo", "ex:RecebimentoAtivoShape", "ex:EmTransito", "ex:Disponivel", {"ex:movimentacaoReferenciada": "DOC-ENV-001"}, {}),
        ("RegistroExtravio", "ex:RegistroExtravioShape", "ex:EmUso", "ex:Baixado", {"ex:protocoloSinistro": "SIN-2026/000123"}, {"ex:protocoloSinistro": "PROTOCOLO-INVALIDO"}),
        ("RecuperacaoAtivo", "ex:RecuperacaoAtivoShape", "ex:Extraviado", "ex:Disponivel", {"ex:laudoRecuperacao": "Aparelho recuperado em vistoria policial"}, {}),
    ]

    for op_name, sh_name, est_v, est_inv, props_v, props_inv in shapes_demais:
        for k in range(1, 11):
            # Válido
            vid = f"CASE-{op_name.upper()}-V-{k:02d}"
            v_fix = {
                "@id": f"ex:fix-{op_name.lower()}-v-{k:02d}",
                "@type": f"ex:{op_name}",
                "ex:estadoAtual": {"@id": est_v},
                "ex:registradoPor": "operador@empresa.com",
                "ex:dataHoraRegistro": {"@value": "2026-03-20T10:00:00Z", "@type": "xsd:dateTime"}
            }
            v_fix.update(props_v)
            valid_fixtures.append(v_fix)
            cases.append({
                "caseId": vid,
                "entityIds": [v_fix["@id"]],
                "operation": op_name,
                "expectedSemanticStatus": "VALID",
                "expectedShapes": [sh_name],
                "expectedRules": [f"Regra-{op_name}-Conforme"],
                "caseType": "VALID",
                "complexity": "STANDARD",
                "description": f"Instância conforme para teste da operação {op_name} sob {sh_name}."
            })

            # Inválido
            invid = f"CASE-{op_name.upper()}-INV-{k:02d}"
            inv_fix = {
                "@id": f"ex:fix-{op_name.lower()}-inv-{k:02d}",
                "@type": f"ex:{op_name}",
                "ex:estadoAtual": {"@id": est_inv},
                "ex:registradoPor": "auditor@empresa.com",
                "ex:dataHoraRegistro": {"@value": "2026-03-20T10:00:00Z", "@type": "xsd:dateTime"}
            }
            inv_fix.update(props_inv)
            invalid_fixtures.append(inv_fix)
            cases.append({
                "caseId": invid,
                "entityIds": [inv_fix["@id"]],
                "operation": op_name,
                "expectedSemanticStatus": "INVALID",
                "expectedShapes": [sh_name],
                "expectedRules": [f"Regra-{op_name}-Violacao"],
                "caseType": "INVALID",
                "complexity": "STANDARD",
                "description": f"Instância violadora para teste da restrição {sh_name} na operação {op_name}."
            })

    # Salva arquivos de fixtures separados
    (FIXTURES_DIR / "validation-valid-fixtures.jsonld").write_text(
        json.dumps({"@context": orig_onto["@context"], "@graph": valid_fixtures}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (FIXTURES_DIR / "validation-invalid-fixtures.jsonld").write_text(
        json.dumps({"@context": orig_onto["@context"], "@graph": invalid_fixtures}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (FIXTURES_DIR / "boundary-fixtures.jsonld").write_text(
        json.dumps({"@context": orig_onto["@context"], "@graph": boundary_fixtures}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (FIXTURES_DIR / "multi-rule-fixtures.jsonld").write_text(
        json.dumps({"@context": orig_onto["@context"], "@graph": multi_rule_fixtures}, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    # Salva semantic-cases.json
    (DOMAIN_DIR / "semantic-cases.json").write_text(
        json.dumps(cases, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"Exportados {len(cases)} casos semânticos documentados em semantic-cases.json.")

    return {
        "ativos": len(ativos),
        "responsaveis": len(responsaveis),
        "localizacoes": len(localizacoes),
        "eventos": len(eventos),
        "casos": len(cases),
        "valid_fixtures": len(valid_fixtures),
        "invalid_fixtures": len(invalid_fixtures),
        "boundary_fixtures": len(boundary_fixtures),
        "multi_rule_fixtures": len(multi_rule_fixtures),
    }


if __name__ == "__main__":
    res = gerar_base_semantica()
    print("Resultado da geração:", res)
