# language: pt
# Fontes: src/client/openrouter; test/client/openrouter.test.mjs; openspec/changes/native-tui-openrouter/design.md
@bsh @or
Funcionalidade: Cliente nativo OpenRouter

  Como um cliente de modelos de linguagem
  Eu quero consumir autenticação, catálogo e respostas incrementais
  Para alimentar o agente com dados reais do provedor

  @BSH-OR-001
  Cenário: Autenticar requisições do provedor
    Dado uma chave OpenRouter
    Quando o cliente envia requisições
    Então deve usar autenticação Bearer e conteúdo JSON
    E deve fornecer metadados de referência e nome da aplicação
    E a integração nativa não deve depender de proxy local na porta 8080 nem de "OPENAI_API_BASE"

  @BSH-OR-002
  Cenário: Verificar chave e apresentar erro
    Dado uma requisição a "/auth/key"
    Quando o provedor responde
    Então sucesso deve retornar validade e metadados disponíveis
    E erro HTTP ou de rede deve retornar validade falsa com diagnóstico

  @BSH-OR-003
  Cenário: Normalizar catálogo e cache
    Dado uma resposta de "/models"
    Quando o catálogo é carregado
    Então deve preservar identificador, nome, descrição, contexto e preços disponíveis
    E o cliente atual deve manter cache em memória por uma hora
    E atualização forçada deve ignorar o cache
    E erro HTTP deve produzir diagnóstico explícito

  @BSH-OR-004 @historical @gap
  Cenário: Reutilizar cache persistente conforme o desenho histórico
    Dado um catálogo de modelos armazenado localmente há menos de 24 horas
    Quando uma nova sessão solicita o catálogo conforme o contrato histórico
    Então deve reutilizar o catálogo persistido sem nova consulta ao provedor
    E catálogo expirado deve ser atualizado

  @BSH-OR-005
  Cenário: Solicitar conclusão incremental com ferramentas
    Dado modelo, conversa e ferramentas opcionais
    Quando o cliente chama "/chat/completions"
    Então deve enviar "stream" verdadeiro, modelo e mensagens
    E deve incluir ferramentas e temperatura quando fornecidas
    E deve usar "max_tokens" explícito ou o padrão configurado

  @BSH-OR-006
  Cenário: Interpretar stream SSE
    Dado eventos SSE divididos entre blocos de rede
    Quando o cliente recebe conteúdo
    Então deve reconstruir linhas "data:" completas
    E deve ignorar comentários, pings e linhas inválidas
    E deve emitir deltas, motivo de término e uso de tokens disponíveis
    E "[DONE]" deve encerrar o stream e liberar o leitor

  @BSH-OR-007
  Cenário: Diagnosticar falha de stream e cancelar requisição
    Dado uma resposta HTTP inválida, sem corpo ou uma solicitação abortada
    Quando o stream é processado
    Então deve produzir diagnóstico em vez de resposta fictícia
    E o sinal de cancelamento deve ser encaminhado à requisição de conclusão
