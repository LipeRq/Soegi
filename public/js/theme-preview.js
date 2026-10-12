/* 配色の見本を切り替える（比べるための一時的なもの）。/?theme=green|blue|teal。選んだ色は、このタブの間だけ覚える */
(() => {
  let t = '';
  try { t = new URLSearchParams(location.search).get('theme') || sessionStorage.getItem('soegi-theme') || ''; sessionStorage.setItem('soegi-theme', t); } catch { /* 覚えられなくても動く */ }
  if (t === 'blue' || t === 'teal') {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `/css/theme-${t}.css`; document.head.append(l);
  }
})();
