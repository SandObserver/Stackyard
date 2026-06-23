export const WIDGET_TYPES = {
  stats:   { label:'Stats',         sizes:['small','medium'],        src:(id,item,opts)=>{
    const sub = item?.widgetConfig?.widgetSubType || 'system-summary';
    const size = encodeURIComponent(item?.widgetSize||'medium');
    if (sub === 'disk-health') return `/widgets/stats/disk-health.html?v=30&id=${encodeURIComponent(id)}&size=${size}${opts?.mobile?'&mobile=1':''}`;
    return `/widgets/stats/system-stats.html?v=4&id=${encodeURIComponent(id)}`;
  }},
  connections:{ label:'Connections', sizes:['small','medium'],
    /* Two views (like github): 'map' (dot-matrix world map, medium only) and
       'vpn' (single-tunnel status card, small/medium). View chosen in admin. */
    views:['map','vpn'],
    src:(id,item)=>{
      const view=item?.widgetConfig?.view||'map';
      const size=encodeURIComponent(item?.widgetSize||'medium');
      if(view==='vpn') return `/widgets/connections/connections-vpn.html?v=6&id=${encodeURIComponent(id)}&size=${size}`;
      return `/widgets/connections/connections-map.html?v=11&id=${encodeURIComponent(id)}`;
    }},
  dns: { label:'DNS Server',       sizes:['small','medium'],        src:(id,item)=>`/widgets/dns/index.html?v=1&id=${encodeURIComponent(id)}&size=${encodeURIComponent(item?.widgetSize||'medium')}` },
  weather: { label:'Weather',      sizes:['small'],                 src:(id,item)=>`/widgets/weather/index.html?v=5&id=${encodeURIComponent(id)}&size=small` },
  nowplaying: { label:'Now Playing', sizes:['small'],               src:(id,item)=>`/widgets/nowplaying/index.html?v=1&id=${encodeURIComponent(id)}&size=small` },
  books:   { label:'Books',          sizes:['small'],                 src:(id,item)=>`/widgets/books/index.html?v=1&id=${encodeURIComponent(id)}&size=small` },
  github:  { label:'GitHub',        sizes:['small','medium','large','xlarge'],src:(id,item)=>{
    const view=item?.widgetConfig?.githubView||'prs';
    const file=view==='contributions'?'github/contributions':'github/pullrequests';
    return `/widgets/${file}.html?v=5&id=${encodeURIComponent(id)}&size=${encodeURIComponent(item?.widgetSize||'medium')}`;
  }},
  clock:   { label:'Clock',          sizes:['small'],                 src:(id,item)=>{
    const style=item?.widgetConfig?.clockStyle||'digital';
    return `/widgets/clock/${style}.html?v=5&id=${encodeURIComponent(id)}`;
  }},
  backup:  { label:'Backup',     sizes:['small','medium'],        src:(id,item,opts)=>`/widgets/backup/backup.html?v=14&id=${encodeURIComponent(id)}&size=${encodeURIComponent(item?.widgetSize||'small')}${opts?.mobile?'&mobile=1':''}` },
  custom:  { label:'Custom',        sizes:['small','medium','large','xlarge'],src:(_,item)=>item?.url||'' },
};

export const WIDGET_HEIGHTS = { small:150, medium:150, large:304, xlarge:456 };
/* Fixed internal render resolution per family (design canvas, in px).
   Widgets always render at these dimensions and are scaled uniformly to fit
   their card, so a family looks pixel-identical on every device/renderer.
   Aspect ratios follow Apple's widget families: small 1:1, medium ~2:1, large 1:1. */
export const WIDGET_DESIGN  = { small:[170,170], medium:[360,170], large:[360,360], xlarge:[360,540] };
export const WIDGET_COLS    = { desktop:{small:1,medium:2,large:2,xlarge:2}, mobile:{small:2,medium:4,large:4,xlarge:4} };
export const WIDGET_ROWS    = { desktop:{small:0,medium:0,large:2,xlarge:3}, mobile:{small:2,medium:2,large:4,xlarge:6} };
export const WIDGET_COST    = { desktop:{small:1,medium:2,large:4,xlarge:6}, mobile:{small:4,medium:8,large:16,xlarge:24} };

export function widgetSrc(item, opts) {
  const type = WIDGET_TYPES[item.widgetType] || WIDGET_TYPES.custom;
  return type.src(item.id, item, opts);
}
