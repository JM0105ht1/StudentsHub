import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Mostra um apontamento HTML com o design ORIGINAL (CSS, cores, tipos de letra, tabelas…),
 * isolado do resto do site:
 *  - <iframe sandbox> sem "allow-scripts": nenhum script é executado;
 *  - Content-Security-Policy dentro do documento: bloqueia scripts, formulários e ligações de rede
 *    para além de estilos, tipos de letra e imagens;
 *  - o CSS do apontamento não afeta o site e o CSS do site não afeta o apontamento.
 * A altura ajusta-se ao conteúdo, por isso não há barra de deslocamento interna.
 */
const CSP =
  "default-src 'none'; style-src 'unsafe-inline' https:; font-src https: data:; img-src https: data:; media-src https: data:";

function buildSrcDoc(html: string): string {
  return (
    '<!doctype html><html lang="pt-PT"><head>' +
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    '<base target="_blank">' +
    '<style>img,svg,video{max-width:100%;height:auto}</style>' +
    '</head><body>' +
    html +
    '</body></html>'
  );
}

export const NoteHtmlFrame: React.FC<{
  html: string;
  minHeight?: number;
  className?: string;
}> = ({ html, minHeight = 200, className = '' }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(minHeight);
  const srcDoc = useMemo(() => buildSrcDoc(html), [html]);

  const measure = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc || !doc.documentElement) return;
    // Mede a altura real do conteúdo (sem ficar presa à altura atual da moldura)
    const body = doc.body;
    const cs = body ? getComputedStyle(body) : null;
    const bodyBox = body
      ? body.offsetHeight + parseFloat(cs?.marginTop || '0') + parseFloat(cs?.marginBottom || '0')
      : 0;
    // Se o conteúdo transborda a moldura (ex.: html/body com height:100%), usa o scrollHeight
    const overflow =
      doc.documentElement.scrollHeight > iframe.clientHeight ? doc.documentElement.scrollHeight : 0;
    const h = Math.ceil(Math.max(doc.documentElement.offsetHeight, bodyBox, overflow));
    if (h > 0) setHeight((prev) => (Math.abs(prev - h) > 1 ? Math.max(h, minHeight) : prev));
  }, [minHeight]);

  const handleLoad = useCallback(() => {
    measure();
    const doc = iframeRef.current?.contentDocument;
    // Imagens e tipos de letra que carregam depois mudam a altura
    doc?.addEventListener('load', measure, true);
    setTimeout(measure, 300);
    setTimeout(measure, 1200);
  }, [measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return (
    <iframe
      ref={iframeRef}
      title="Apontamento"
      srcDoc={srcDoc}
      onLoad={handleLoad}
      // Sem "allow-scripts": o conteúdo nunca executa código
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      scrolling="no"
      className={`w-full block border-0 bg-white ${className}`}
      style={{ height }}
    />
  );
};
