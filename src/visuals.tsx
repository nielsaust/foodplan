import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  "person-minus": <><circle cx="9" cy="7" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4m2-11h5"/></>,
  upload: <path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>,
  link: <><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/></>,
  unlink: <><path d="m3 3 18 18M8 15l-1 1a4 4 0 0 1-6-6l3-3m9 2 1-1a4 4 0 0 1 6 6l-2 2M9 3l1-2m11 20 1-2"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
  settings: <><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
  generate: <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3ZM20 2v4m-2-2h4"/>,
  filter: <><path d="M4 7h16M7 12h10m-7 5h4"/><circle cx="8" cy="7" r="2" fill="var(--paper)"/><circle cx="15" cy="12" r="2" fill="var(--paper)"/></>,
  edit: <path d="m14 6 4 4M4 20l4-1 12-12-4-4L4 15v5Z"/>,
  leaf: <><path d="M19 4c-8 0-13 3-13 9a5 5 0 0 0 5 5c6 0 8-6 8-14Z"/><path d="M4 20 15 9"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 15h2m4 0h2"/></>,
  book: <><path d="M4 19V5a2 2 0 0 1 2-2h14v18H6a2 2 0 1 1 0-4h14M8 7h8m-8 4h5"/></>,
  basket: <><path d="m6 9 4-6m8 6-4-6M3 9h18l-2 11H5L3 9Zm6 4v3m6-3v3"/></>,
  people: <><circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  left: <path d="m14 6-6 6 6 6"/>,
  right: <path d="m10 6 6 6-6 6"/>,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H6a2 2 0 0 0-2 2v10"/></>,
  search: <><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/></>,
  printer: <><path d="M6 8V3h12v5M6 17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 13h12v8H6zM6 11h1"/></>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  dots: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
}

export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

const palettes = {
  gold: ['#edcf83', '#f7e5ac', '#f1ab35', '#506a36', '#c86b26', '#eac16b'],
  rose: ['#e9ada0', '#f4d5c5', '#ae4e38', '#557344', '#d8893c', '#f6c87d'],
  green: ['#bdc999', '#e1e4b6', '#758b49', '#37633e', '#d26d35', '#e8bd63'],
}

export function Plate({ theme, hero = false }: { theme: string; hero?: boolean }) {
  const [bg, rim, sauce, leaf, carrot, tofu] = palettes[theme as keyof typeof palettes]
  return <svg className={hero ? 'hero-plate' : 'plate'} viewBox="0 0 340 170" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    {!hero && <rect width="340" height="170" fill={bg}/>}
    <g stroke={hero ? '#abc098' : rim} opacity=".55" fill="none">
      <ellipse cx="169" cy="87" rx="133" ry="104"/>
      <ellipse cx="169" cy="87" rx="145" ry="113"/>
      <path d="M23 135q22 5 34 26m228-135q20 4 33 26M17 42q16-12 33-14m232 103q20 4 33 25"/>
    </g>
    <g transform="rotate(-12 170 85)">
      <ellipse cx="176" cy="96" rx="106" ry="71" fill="#3c291a" opacity=".14"/>
      <ellipse cx="170" cy="83" rx="107" ry="72" fill="#fcf6e2"/>
      <ellipse cx="170" cy="83" rx="92" ry="59" fill={rim} stroke="#fff8e6" strokeWidth="3"/>
      <ellipse cx="170" cy="83" rx="83" ry="51" fill={sauce}/>
      {Array.from({ length: 44 }, (_, i) => {
        const radius = Math.sqrt((i + 0.5) / 44)
        const x = 170 + Math.cos(i * 2.39996) * radius * 79
        const y = 83 + Math.sin(i * 2.39996) * radius * 48
        const rotate = (i * 43) % 180
        const color = [leaf, tofu, carrot, rim, leaf][i % 5]
        return i % 5 === 0 || i % 5 === 4
          ? <path key={i} d="M-10 0Q-1-12 10 0Q1 9-10 0Z" transform={`translate(${x} ${y}) rotate(${rotate})`} fill={color} stroke={rim} strokeWidth=".5"/>
          : <rect key={i} x="-5" y="-4" width={i % 2 ? 12 : 8} height="8" rx={theme === 'rose' ? 3 : 1.5} fill={color} stroke={sauce} strokeWidth=".5" transform={`translate(${x} ${y}) rotate(${rotate})`}/>
      })}
      <path d="M98 83Q110 39 156 39M184 131q48-8 63-42" fill="none" stroke={rim} strokeWidth="2" opacity=".7"/>
    </g>
    {hero && <g fill="none" stroke="#d5e2aa" strokeWidth="1.6">
      <path d="m39 53 0 16m-8-8h16m249 41v20m-10-10h20M57 113v10m-5-5h10m235-85v12m-6-6h12"/>
      <path d="M263 150q25-2 32-23-26 4-32 23Zm-198-115Q47 27 50 11q16 10 15 24Z" fill="#a8bd77"/>
    </g>}
  </svg>
}
