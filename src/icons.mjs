// Hand-written inline icons. viewBox 24, stroke currentColor (stroke styling lives in tokens.css).
const body={
  size:'<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  yaw:'<path d="M4 15c4 3 12 3 16 0"/><path d="M4.8 18.4L4 15l3.5-.2M19.2 18.4L20 15l-3.5-.2"/><circle cx="12" cy="7.5" r="3"/>',
  pitch:'<path d="M15 4c3 4 3 12 0 16"/><path d="M14.8 7.5L15 4l3.4.8M14.8 16.5L15 20l3.4-.8"/><circle cx="7.5" cy="12" r="3"/>',
  roll:'<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v4.5h-4.5"/><path d="M10 14l4-4"/>',
  blink:'<path d="M3 10c4 5 14 5 18 0"/><path d="M12 15.5V18M6.2 13.6l-1.6 2M17.8 13.6l1.6 2"/>',
  wink:'<circle cx="7" cy="11" r="3"/><path d="M14 11c1.6 3 5.4 3 7 0"/><path d="M17.5 15.5V17.5"/>',
  nod:'<circle cx="12" cy="8" r="4"/><path d="M7 16l5 4 5-4"/>',
  shake:'<circle cx="12" cy="12" r="4"/><path d="M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  happy:'<path d="M11 3.5l1.7 5L18 10l-5.3 1.5L11 16.5l-1.7-5L4 10l5.3-1.5z"/><path d="M19 15.5v4M17 17.5h4"/>',
  reset:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  follow:'<path d="M5 4l14 6.2-6.2 2.3-2.3 6.2z"/>',
  idle:'<path d="M2 12c2.5-6 5-6 7.5 0s5 6 7.5 0c1.2-2.8 2.4-3.6 5-3"/>',
  reduced:'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  dock:'<path d="M7 15a5 5 0 1 1 10 0"/><path d="M3 15h18"/><path d="M9.5 15v3.5M14.5 15v3.5"/>',
  free:'<circle cx="12" cy="9.5" r="5"/><path d="M9 20h6"/>',
  home:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  console:'<path d="M4 7h9M19 7h1M4 17h1M11 17h9"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  hide:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
  quit:'<path d="M12 3v8M6.5 6.6a8 8 0 1 0 11 0"/>',
  layers:'<path d="M12 3l9 4.5-9 4.5-9-4.5z"/><path d="M3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5"/>',
  compare:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16M15 9h2M15 12h2"/>',
  upload:'<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  play:'<path d="M7 4.5v15l12-7.5z"/>',
  chevron:'<path d="M6 9l6 6 6-6"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  brand:'<path d="M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0"/>',
  chat:'<path d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>',
  send:'<path d="M4 12l16-7-5.5 15-3-6.5z"/><path d="M11.5 13.5L20 5"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'
};
export const icons=Object.fromEntries(Object.entries(body).map(([k,v])=>[k,`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${v}</svg>`]));
// Fill every [data-icon="name"] element with its glyph.
export function hydrate(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{const svg=icons[el.dataset.icon];if(svg)el.innerHTML=svg;});}
