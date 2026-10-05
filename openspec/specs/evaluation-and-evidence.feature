# language: pt
# Fontes: AGENTS.md; openspec/changes/e2e-feature-and-video-rule; src/git/usage.ts; scripts/gate-exposure.mjs; test/support/record_bsh_e2e_video.py; test/support/tmux-screenshot.py; pilot/asset-management/evaluation; pilot/asset-management/scripts/generate_semantic_reports.py
@bsh @eval
Funcionalidade: Avaliação funcional, métricas e evidências

  Como um avaliador do BSH
  Eu quero planejar jornadas e preservar provas de execução
  Para distinguir conformidade real de demonstração ou validação isolada

  @BSH-EVAL-001
  Cenário: Planejar E2E em Gherkin antes da execução
    Dado uma nova jornada E2E
    Quando seu plano é preparado
    Então deve existir previamente um arquivo em "test/features/journeys" com "# language: pt"
    E deve conter funcionalidade, narrativa, cenários e passos Dado, Quando e Então

  @BSH-EVAL-002
  Cenário: Executar produto empacotado
    Dado um teste funcional ou E2E do BSH
    Quando a sessão é iniciada
    Então deve usar o binário global "bsh" empacotado e instalado via npm
    E scripts TypeScript diretos como tsx, ts-node ou node src não devem substituir o produto distribuído

  @BSH-EVAL-015
  Cenário: Instalar a versão atual globalmente e testar somente o binário
    Dado um teste funcional ou E2E do BSH
    Quando o teste é preparado
    Então a versão atual do pacote deve ser construída e instalada globalmente via npm antes da primeira sessão
    E a versão reportada por "bsh --version" deve coincidir com a versão de "package.json"
    E o teste deve exercitar exclusivamente o binário global "bsh" e nunca o código-fonte
    E se a versão instalada divergir da versão atual, o caso deve ser marcado como bloqueado antes do primeiro turno

  @BSH-EVAL-003
  Cenário: Validar ontologia da cópia de projeto
    Dado uma cópia limpa do piloto selecionada para teste
    Quando a sessão governada será aberta
    Então a cópia deve conter sua própria ontologia em ".bsh/domains"
    E essa ontologia deve ser validada antes da sessão

  @BSH-EVAL-004 @agent_nativo
  Cenário: Executar casos positivos e negativos reais
    Dado dois casos definidos previamente, um conforme e outro contrário a uma regra
    Quando um teste funcional do agente nativo BSH é executado
    Então deve abrir a sessão interativa "bsh" na pasta do piloto em sessão persistente tmux ou herdr
    E o processo deve receber solicitações reais e interagir sobre o workspace do piloto
    E chamadas HTTP diretas não devem substituir a sessão do agente

  @BSH-EVAL-005
  Cenário: Classificar bloqueio antes do primeiro turno
    Dado que "bsh" recusa iniciar ou falha na validação ontológica
    Quando a avaliação registra o resultado
    Então ambos os casos devem ser marcados como bloqueados antes do primeiro turno
    E o diagnóstico deve ser preservado
    E execuções não governadas não devem produzir aprovação funcional indevida

  @BSH-EVAL-006
  Cenário: Comparar estado e decisões
    Dado uma execução funcional real
    Quando suas evidências são coletadas
    Então devem comparar estado inicial, ações propostas, perguntas humanas, decisões, arquivos finais e auditoria
    E devem identificar expectativas, observações e limitações

  @BSH-EVAL-007
  Cenário: Registrar relatório datado
    Dado uma avaliação concluída ou bloqueada
    Quando o relatório é salvo
    Então deve residir em "pilot/asset-management/evaluation" com data
    E deve incluir prompts, procedimento, evidências, resultados esperados e observados, limitações e correções propostas
    E a sessão persistente deve ser encerrada após a coleta

  @BSH-EVAL-008
  Cenário: Gravar vídeo e captura final
    Dado qualquer teste E2E ou de fumaça
    Quando é executado
    Então deve registrar captura tmux com nome descritivo em "evaluation/screenshots" ou "screenshots"
    E o vídeo deve incluir slide inicial com fundo preto e letras brancas apresentando objetivos em português
    E deve apresentar gravação contínua e realista da sessão tmux e card final de veredito comparando o esperado e o observado
    E os demais relatórios e artefatos de auditoria externos a ".feature" devem estar em inglês

  @BSH-EVAL-009
  Cenário: Preservar legibilidade do vídeo
    Dado a gravação de uma jornada
    Quando o vídeo é produzido
    Então o slide inicial deve permanecer por tempo suficiente para leitura, conforme o plano de 6 a 8 segundos
    E a captura deve atender ao mínimo previsto de 120 por 32 caracteres ou 1280 por 720 pixels
    E deve haver repouso final para inspeção e captura correspondente

  @BSH-EVAL-010
  Cenário: Relatar custo adicional do harness
    Dado métricas de entrada, saída, cache, raciocínio e total da sessão
    Quando o relatório de uso é apresentado
    Então deve informar tokens adicionais atribuídos à verificação ontológica em valor absoluto e percentual do total
    E deve informar consultas ontológicas e conflitos
    E ausência de métricas deve aparecer como indisponível

  @BSH-EVAL-011
  Cenário: Relatar economia com baseline comparável
    Dado tokens de execução desgovernada e tokens do BSH governado medidos em casos comparáveis
    Quando o impacto do harness é calculado
    Então a sobrecarga ou economia deve ser calculada a partir de medições empíricas
    E ausência de baseline medido não deve produzir economia fictícia

  @BSH-EVAL-012
  Cenário: Distinguir ensaio de gate de execução do agente
    Dado candidatos RDF conformes e incompatíveis submetidos ao validador independente
    Quando o ensaio de exposição do gate é relatado
    Então deve registrar candidatos, oportunidades, ativações, falsos bloqueios e incompatibilidades escapadas
    E deve identificar fixtures ausentes e operação não reconhecida
    E esse ensaio isolado não deve ser declarado uma jornada funcional do agente

  @BSH-EVAL-013
  Cenário: Copiar artefatos finais com integridade
    Dado PDFs, vídeos e capturas finais de um lote
    Quando são entregues ao usuário
    Então devem ser copiados para "/mnt/c/Users/clayt/Downloads/bsh"
    E o PDF científico deve usar "relatorio-benchmark-<lote>.pdf"
    E o PDF técnico deve usar "relatorio-tecnico-execucao-<batchId>.pdf"
    E nomes devem conter o identificador do lote e hashes SHA-256 devem coincidir com as cópias locais
    E o nome duplicado de relatório experimental descontinuado não deve ser gerado

  @BSH-EVAL-014
  Cenário: Produzir tabelas e figuras acadêmicas legíveis
    Dado um relatório com tabelas ou figuras em TeX
    Quando os elementos são produzidos ou revisados
    Então deve usar a skill "academic-latex-diagrams-and-tables"
    E tabelas devem usar colunas com quebra automática e booktabs
    E figuras vetoriais devem usar fontes legíveis e legendas descritivas
    E diagramas devem usar roteamento ortogonal por barra perimetral
    E as páginas devem ser rasterizadas com pdftoppm e inspecionadas visualmente antes da conclusão
