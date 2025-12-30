#!/usr/bin/env node
// Validation harness for evidence packs: produces PASS/PARTIAL/FAIL per module.
require('ts-node/register/transpile-only');
const fs = require('fs');
const path = require('path');
const { loadEvidencePack, evaluateModules } = require('../src/modules/evaluator');

const packsDir = path.join(__dirname, 'evidence_packs');
const gatePath = path.join(packsDir, 'gate.json');
const reportJson = path.join(packsDir, 'report.json');
const reportMd = path.join(packsDir, 'report.md');

const MODULES = ['tagInventory', 'cmsDrift', 'publisherForensics', 'adImpression', 'injectedTelemetry', 'analyticsIntegrity'];

function loadJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function scorePack(packName) {
  const packPath = path.join(packsDir, packName);
  const pack = loadEvidencePack(packPath);
  if (!pack) {
    return { error: 'missing metadata' };
  }
  const evaluated = evaluateModules(pack);
  const statusOnly = {};
  for (const key of MODULES) {
    statusOnly[key] = evaluated[key].status;
  }
  return statusOnly;
}

function toMarkdown(results) {
  const lines = ['# Evidence Pack Validation', ''];
  for (const [pack, modules] of Object.entries(results.packs)) {
    lines.push(`## ${pack}`);
    MODULES.forEach((m) => lines.push(`- ${m}: ${modules[m]}`));
    lines.push('');
  }
  lines.push('## Summary');
  lines.push(`- total packs: ${results.summary.totalPacks}`);
  lines.push(`- gated failures: ${results.summary.gatedFailures}`);
  lines.push('');
  return lines.join('\n');
}

function main() {
  if (!fs.existsSync(packsDir)) {
    console.error('No evidence_packs directory found');
    process.exit(1);
  }
  const packNames = fs
    .readdirSync(packsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const gate = loadJsonSafe(gatePath) || { packs: {} };

  const packs = {};
  let gatedFailures = 0;

  for (const name of packNames) {
    const moduleResults = scorePack(name);
    packs[name] = moduleResults;
    const gatedModules = gate.packs?.[name] || [];
    for (const mod of gatedModules) {
      if (moduleResults[mod] !== 'PASS') gatedFailures += 1;
    }
  }

  const results = {
    packs,
    summary: {
      totalPacks: packNames.length,
      gatedFailures
    }
  };

  fs.writeFileSync(reportJson, JSON.stringify(results, null, 2));
  fs.writeFileSync(reportMd, toMarkdown(results));

  if (gatedFailures > 0) {
    console.error(`Regression gate failed: ${gatedFailures} failures`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

