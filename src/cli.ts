#!/usr/bin/env node

export async function main(argv: string[]): Promise<number> {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('oracle: init | domain add | ontology validate | ontology show\n');
    return 0;
  }

  process.stderr.write('Comando desconhecido. Use oracle --help.\n');
  return 2;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exitCode = await main(process.argv.slice(2));
}
