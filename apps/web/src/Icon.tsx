const paths: Record<string, string> = {
  book: 'M4 4h6a3 3 0 0 1 2 1 3 3 0 0 1 2-1h6v15h-6a3 3 0 0 0-2 1 3 3 0 0 0-2-1H4z M12 5v15',
  grid: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18',
  flow: 'M5 3v12a4 4 0 0 0 4 4h5 M5 8h10 M15 5l3 3-3 3 M14 16l3 3-3 3',
  rules: 'M5 5h14 M5 12h14 M5 19h14 M9 3v4 M15 10v4 M9 17v4',
  edit: 'M14 5l5 5 M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14z',
  check: 'M5 12l4 4L19 6',
  alert: 'M12 3L2 21h20z M12 9v5 M12 17v1',
  folder: 'M3 6h7l2 2h9v12H3z M3 6V4h7l2 2',
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15 M16 16l5 5',
  chevron: 'M9 5l7 7-7 7', down: 'M6 9l6 6 6-6', plus: 'M12 5v14 M5 12h14',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  arrow: 'M5 12h14 M14 7l5 5-5 5', file: 'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h6',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2', refresh: 'M20 7a8 8 0 1 0 0 10 M20 3v5h-5',
  close: 'M6 6l12 12 M18 6L6 18', save: 'M4 3h14l3 3v15H3V3z M7 3v6h10V3 M7 21v-7h10v7', menu: 'M4 6h16 M4 12h16 M4 18h16',
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.file}/></svg>; }
