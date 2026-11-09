// Turns the single-file Vite build into an Artifact page (no doctype/html/head/body wrapper).
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync(process.argv[2], 'utf8');
const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const links = (html.match(/<link [^>]*fonts\.googleapis[^>]*>/g) || []).join('\n');
const styles = (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join('\n');
const scripts = (html.match(/<script[^>]*>[\s\S]*?<\/script>/g) || []).join('\n');
writeFileSync(process.argv[3], `${title}\n${links}\n${styles}\n<div id="root"></div>\n${scripts}\n`);
