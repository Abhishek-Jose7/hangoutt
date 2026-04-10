#!/usr/bin/env node
/**
 * Dump all documents from the Typesense `venues` collection to CSV.
 * Usage: node scripts/dump-typesense.mjs
 */

import { writeFileSync } from 'node:fs';

const HOST = process.env.TYPESENSE_HOST || 'edzboajp2fuk0wlsp-1.a2.typesense.net';
const PROTOCOL = process.env.TYPESENSE_PROTOCOL || 'https';
const PORT = process.env.TYPESENSE_PORT || '443';
const API_KEY = process.env.TYPESENSE_ADMIN_API_KEY || process.env.TYPESENSE_API_KEY;
const COLLECTION = process.env.TYPESENSE_COLLECTION || 'venues';

if (!API_KEY) {
  console.error('Missing TYPESENSE_API_KEY or TYPESENSE_ADMIN_API_KEY');
  process.exit(1);
}

const BASE = `${PROTOCOL}://${HOST}:${PORT}`;

// ── 1. Fetch collection schema ───────────────────────────────────
async function fetchSchema() {
  const res = await fetch(`${BASE}/collections/${COLLECTION}`, {
    headers: { 'X-TYPESENSE-API-KEY': API_KEY },
  });
  if (!res.ok) {
    console.error(`Schema fetch failed: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.error(text.slice(0, 500));
    process.exit(1);
  }
  return res.json();
}

// ── 2. Fetch all documents via search (paginated) ────────────────
async function fetchAllDocuments() {
  const docs = [];
  let page = 1;
  const perPage = 250;

  while (true) {
    const params = new URLSearchParams({
      q: '*',
      query_by: 'name',
      per_page: String(perPage),
      page: String(page),
    });

    const url = `${BASE}/collections/${COLLECTION}/documents/search?${params}`;
    const res = await fetch(url, {
      headers: { 'X-TYPESENSE-API-KEY': API_KEY },
    });

    if (!res.ok) {
      console.error(`Search failed on page ${page}: ${res.status}`);
      break;
    }

    const data = await res.json();
    const hits = data.hits || [];
    if (hits.length === 0) break;

    for (const hit of hits) {
      if (hit.document) docs.push(hit.document);
    }

    console.log(`  page ${page}: ${hits.length} hits (total so far: ${docs.length})`);

    if (hits.length < perPage) break;
    page++;
  }

  return docs;
}

// ── 3. Convert to CSV ────────────────────────────────────────────
function toCsv(docs) {
  if (docs.length === 0) return '(empty collection)';

  // Collect all unique keys across documents
  const keySet = new Set();
  for (const doc of docs) {
    for (const key of Object.keys(doc)) keySet.add(key);
  }

  // Order: id, name, type, area first, then alphabetical
  const priority = ['id', 'name', 'type', 'area', 'description', 'tags', 'mood',
    'lat', 'lng', 'latitude', 'longitude', 'location',
    'estimated_cost', 'cost_for_two', 'price_per_person',
    'rating', 'google_rating', 'popularity', 'url'];
  const headers = [
    ...priority.filter((k) => keySet.has(k)),
    ...[...keySet].filter((k) => !priority.includes(k)).sort(),
  ];

  const escape = (val) => {
    if (val === null || val === undefined) return '';
    const str = Array.isArray(val) ? val.join('; ') : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [headers.join(',')];
  for (const doc of docs) {
    lines.push(headers.map((h) => escape(doc[h])).join(','));
  }
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log(`\nTypesense: ${BASE}/collections/${COLLECTION}\n`);

  // Schema
  const schema = await fetchSchema();
  console.log('=== Collection Schema ===');
  console.log(`Name: ${schema.name}`);
  console.log(`Num documents: ${schema.num_documents}`);
  console.log('Fields:');
  for (const field of schema.fields || []) {
    console.log(`  ${field.name} (${field.type})${field.facet ? ' [facet]' : ''}${field.optional ? ' [optional]' : ''}`);
  }
  console.log('');

  // Documents
  console.log('Fetching all documents...');
  const docs = await fetchAllDocuments();
  console.log(`\nTotal documents: ${docs.length}\n`);

  if (docs.length === 0) {
    console.log('Collection is empty.');
    return;
  }

  // Type breakdown
  const byType = {};
  for (const doc of docs) {
    const t = doc.type || '(no type)';
    byType[t] = (byType[t] || 0) + 1;
  }
  console.log('=== Type Breakdown ===');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
  console.log('');

  // Area breakdown
  const byArea = {};
  for (const doc of docs) {
    const a = doc.area || '(no area)';
    byArea[a] = (byArea[a] || 0) + 1;
  }
  console.log('=== Area Breakdown (top 20) ===');
  const sortedAreas = Object.entries(byArea).sort((a, b) => b[1] - a[1]).slice(0, 20);
  for (const [area, count] of sortedAreas) {
    console.log(`  ${area}: ${count}`);
  }
  console.log('');

  // Write CSV
  const csv = toCsv(docs);
  const outPath = 'scripts/typesense-venues-dump.csv';
  writeFileSync(outPath, csv, 'utf-8');
  console.log(`CSV written to: ${outPath} (${docs.length} rows)\n`);

  // Print first 10 docs as preview
  console.log('=== First 10 Documents (preview) ===');
  for (const doc of docs.slice(0, 10)) {
    const { name, type, area, estimated_cost, tags, mood } = doc;
    console.log(`  ${name || '(unnamed)'} | type=${type || '?'} | area=${area || '?'} | cost=${estimated_cost ?? '?'} | tags=${Array.isArray(tags) ? tags.join(', ') : tags || '?'} | mood=${Array.isArray(mood) ? mood.join(', ') : mood || '?'}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
