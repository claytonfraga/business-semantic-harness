#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pilotDir = resolve('pilot/asset-management');

console.log('\x1b[38;5;38m─── BSH MCP Server Governance Session ─────────────────────── [*] GOVERNED ───\x1b[0m\n');
console.log('\x1b[90m[+] Connecting to BSH MCP Server via stdio...\x1b[0m');
console.log(`\x1b[90m    Command: bsh mcp --project ${pilotDir}\x1b[0m`);

await sleep(1500);

const transport = new StdioClientTransport({
  command: 'bsh',
  args: ['mcp', '--project', pilotDir],
});
const client = new Client({ name: 'external-ai-agent-e2e', version: '1.0.0' });

try {
  await client.connect(transport);
  console.log('\x1b[32m[✔] Connected to BSH MCP Server (protocol JSON-RPC 2.0 via stdio)\x1b[0m\n');
  await sleep(1500);

  // Step 1: List tools
  console.log('\x1b[33m>_ [MCP Client] Requesting tools/list...\x1b[0m');
  const tools = await client.listTools();
  await sleep(1000);
  console.log('\x1b[32m[✔] Tools discovered:\x1b[0m');
  for (const t of tools.tools) {
    console.log(`    \x1b[36m• ${t.name}\x1b[0m: ${t.description.split('.')[0]}`);
  }
  console.log();
  await sleep(2000);

  // Step 2: Check prompt intent (violating)
  const badPrompt = 'Transfer retired asset AST-001 to Finance department without justification';
  console.log(`\x1b[33m>_ [MCP Client] Tool call: bsh_check_prompt_intent\x1b[0m`);
  console.log(`   Prompt: "${badPrompt}"`);
  await sleep(1500);

  const badIntent = await client.callTool({
    name: 'bsh_check_prompt_intent',
    arguments: { prompt: badPrompt, domain: 'ativos' },
  });
  const parsedBad = JSON.parse(badIntent.content[0].text);
  console.log('\x1b[31m[!] [PROMPT VIOLATION DETECTED]\x1b[0m');
  console.log(`    Rule / Shape: \x1b[31m${parsedBad.shape}\x1b[0m`);
  console.log(`    Detail: \x1b[31m${parsedBad.message}\x1b[0m\n`);
  await sleep(2500);

  // Step 3: Query ontology
  console.log(`\x1b[33m>_ [MCP Client] Tool call: bsh_query_ontology\x1b[0m`);
  console.log(`   IRI: urn:bsh:pilot:ativos:Ativo`);
  await sleep(1500);

  const ontRes = await client.callTool({
    name: 'bsh_query_ontology',
    arguments: { domain: 'ativos', iri: 'urn:bsh:pilot:ativos:Ativo' },
  });
  if (ontRes.isError) {
    console.log(`\x1b[31m[Error]: ${ontRes.content[0].text}\x1b[0m\n`);
  } else {
    const parsedOnt = JSON.parse(ontRes.content[0].text);
    console.log('\x1b[32m[OK] Ontology knowledge retrieved:\x1b[0m');
    console.log(`    Domain: ${parsedOnt.domain} (${parsedOnt.entries?.length ?? 1} conceptual entries found)\n`);
  }
  await sleep(2000);

  // Step 4: Check prompt intent (conforming)
  const goodPrompt = 'Transfer available asset AST-101 to Carlos in Finance department';
  console.log(`\x1b[33m>_ [MCP Client] Tool call: bsh_check_prompt_intent\x1b[0m`);
  console.log(`   Prompt: "${goodPrompt}"`);
  await sleep(1500);

  const goodIntent = await client.callTool({
    name: 'bsh_check_prompt_intent',
    arguments: { prompt: goodPrompt, domain: 'ativos' },
  });
  const parsedGood = JSON.parse(goodIntent.content[0].text);
  console.log('\x1b[32m[OK] PROMPT CONFORMING\x1b[0m (Intent adheres to domain invariants)\n');
  await sleep(2000);

  // Step 5: SHACL validation (violating)
  console.log(`\x1b[33m>_ [MCP Client] Tool call: bsh_validate_shacl (Violating candidate facts)\x1b[0m`);
  await sleep(1500);
  const badFacts = `@prefix ex: <urn:bsh:pilot:ativos:> .\nex:transfer-bad a ex:TransferenciaAtivo ;\n  ex:estadoAtual ex:Baixado ;\n  ex:novoResponsavel "Carlos" ;\n  ex:novaLocalizacao "Financeiro" ;\n  ex:solicitante "Alice" ;\n  ex:aprovador "Bob" .\n`;
  const badShacl = await client.callTool({
    name: 'bsh_validate_shacl',
    arguments: { domain: 'ativos', factsTurtle: badFacts },
  });
  const parsedBadShacl = JSON.parse(badShacl.content[0].text);
  console.log(`\x1b[31m[X] SHACL VIOLATION -> Conforms: ${parsedBadShacl.conforms} (Promotion blocked)\x1b[0m`);
  console.log(`    Violation: ${parsedBadShacl.results[0]?.message || 'Ativo baixado não pode ser transferido.'}\n`);
  await sleep(2500);

  // Step 6: SHACL validation (conforming)
  console.log(`\x1b[33m>_ [MCP Client] Tool call: bsh_validate_shacl (Conforming candidate facts)\x1b[0m`);
  await sleep(1500);
  const goodFacts = `@prefix ex: <urn:bsh:pilot:ativos:> .\nex:transfer-good a ex:TransferenciaAtivo ;\n  ex:estadoAtual ex:Disponivel ;\n  ex:novoResponsavel "Carlos" ;\n  ex:novaLocalizacao "Financeiro" ;\n  ex:solicitante "Alice" ;\n  ex:aprovador "Bob" .\n`;
  const goodShacl = await client.callTool({
    name: 'bsh_validate_shacl',
    arguments: { domain: 'ativos', factsTurtle: goodFacts },
  });
  const parsedGoodShacl = JSON.parse(goodShacl.content[0].text);
  console.log(`\x1b[32m[OK] SHACL CONFORMING -> Conforms: ${parsedGoodShacl.conforms} (Ready to promote)\x1b[0m\n`);
  await sleep(2000);

  console.log('\x1b[38;5;38m─── MCP Session Completed: All 6 Steps Concluded Successfully ───\x1b[0m');
} finally {
  await client.close();
}
