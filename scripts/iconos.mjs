// Genera los íconos de la PWA con el isotipo oficial (crema sobre vino).
// Uso: node scripts/iconos.mjs
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const iso = readFileSync('src/assets/marca/isotipo.svg', 'utf8');
const vb = iso.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number); // 0 0 w h
const interior = iso.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/currentColor/g, '#F3E2C1');

function icono(lado, ancho, redondeo) {
  const s = (lado * ancho) / vb[2];
  const x = (lado - vb[2] * s) / 2;
  const y = (lado - vb[3] * s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}" width="${lado}" height="${lado}">
<rect width="${lado}" height="${lado}" rx="${redondeo}" fill="#590202"/>
<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${s.toFixed(4)})">${interior}</g></svg>`;
}

// Icono normal (72 % de ancho) y "maskable" (60 %, dentro de la zona segura)
for (const [lado, nombre] of [[192, 'icono-192.png'], [512, 'icono-512.png']]) {
  writeFileSync(`public/${nombre}`, new Resvg(icono(lado, 0.72, 0)).render().asPng());
}
writeFileSync('public/icono-maskable-512.png', new Resvg(icono(512, 0.6, 0)).render().asPng());
writeFileSync('public/apple-touch-icon.png', new Resvg(icono(180, 0.72, 0)).render().asPng());
writeFileSync('public/icono.svg', icono(512, 0.78, 96));
console.log('Íconos generados.');
