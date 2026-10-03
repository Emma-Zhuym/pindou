/** Which column a table is sorted by, and which way. */
export interface SortBy<K extends string> {
  key: K
  desc: boolean
}

/** A column heading that sorts by its column: once descending, again ascending. */
export function SortHead<K extends string>({ k, label, sort, onSort, first = 'desc' }: { k: K; label: string; sort: SortBy<K>; onSort: (s: SortBy<K>) => void; first?: 'asc' | 'desc' }) {
  const on = sort.key === k
  return (
    <button
      className={on ? 'sorthead on' : 'sorthead'}
      aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}
      onClick={() => onSort({ key: k, desc: on ? !sort.desc : first === 'desc' })}
    >
      {label}
      <span className="arrow">{on ? (sort.desc ? '↓' : '↑') : '↕'}</span>
    </button>
  )
}
