// Texto libre con formato sencillo, sin HTML: "# " y "## " son títulos, "- " o "* " viñetas,
// "1. " listas numeradas y una línea vacía separa párrafos. Todo se pinta como texto (React escapa).
import type { ReactNode } from 'react';

export function TextoLibre({ texto }: { texto: string }) {
  const bloques: ReactNode[] = [];
  let lista: { tipo: 'ul' | 'ol'; items: string[] } | null = null;
  let parrafo: string[] = [];
  const cerrarParrafo = () => {
    if (parrafo.length) bloques.push(<p key={bloques.length} className="m-0 whitespace-pre-line">{parrafo.join('\n')}</p>);
    parrafo = [];
  };
  const cerrarLista = () => {
    if (!lista) return;
    const Tag = lista.tipo;
    bloques.push(
      <Tag key={bloques.length} className={`m-0 flex flex-col gap-1 pl-5 ${lista.tipo === 'ul' ? 'list-disc' : 'list-decimal'}`}>
        {lista.items.map((t, i) => <li key={i}>{t}</li>)}
      </Tag>,
    );
    lista = null;
  };
  for (const linea of texto.replace(/\r/g, '').split('\n')) {
    const h = /^(#{1,2})\s+(.*)$/.exec(linea);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(linea);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(linea);
    if (h) {
      cerrarParrafo();
      cerrarLista();
      bloques.push(h[1].length === 1
        ? <h3 key={bloques.length} className="m-0 font-titulo text-[17px] font-bold text-vino">{h[2]}</h3>
        : <h4 key={bloques.length} className="m-0 font-titulo text-[15px] font-bold text-vino">{h[2]}</h4>);
    } else if (ul || ol) {
      cerrarParrafo();
      const tipo = ul ? 'ul' : 'ol';
      if (lista && lista.tipo !== tipo) cerrarLista();
      lista ??= { tipo, items: [] };
      lista.items.push((ul ?? ol)![1]);
    } else if (!linea.trim()) {
      cerrarParrafo();
      cerrarLista();
    } else {
      cerrarLista();
      parrafo.push(linea);
    }
  }
  cerrarParrafo();
  cerrarLista();
  return <div className="flex flex-col gap-2.5 text-sm leading-[1.5] text-tinta">{bloques}</div>;
}
