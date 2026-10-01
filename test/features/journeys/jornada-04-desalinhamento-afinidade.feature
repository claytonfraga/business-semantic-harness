# language: pt
Funcionalidade: Jornada 4 - Alerta Proativo de Desalinhamento de Domínio
  Como um desenvolvedor iniciando o BSH em um projeto com ontologia divergente
  Eu quero receber um alerta preventivo de desalinhamento de vocabulário
  Para que eu possa trocar a ontologia ou desabilitar o harness sem interrupções

  Cenário: Detecção preventiva de incompatibilidade entre ontologia e código
    Dado que o projeto é um microserviço matemático sem vocabulário de patrimônio
    E o BSH é iniciado com o domínio "ativos" configurado
    Quando o analisador de afinidade conceitual executa a varredura preventiva
    Então a afinidade semântica é calculada abaixo do limiar mínimo
    E o BSH exibe o badge "[!] Domain Mismatch" em amarelo
    E o feed inicial apresenta o alerta "[!] [Semantic Domain Alert]"
    E o usuário pode digitar "/ungoverned" para operar livremente ou "/domain" para trocar
