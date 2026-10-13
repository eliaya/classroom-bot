/**
 * Side-by-side columns for blocks that overlap in time: id -> left and width as
 * fractions of the column. `start` and `duration` are in minutes; an item
 * without a duration of its own lasts `duration`.
 */
export function layoutColumns(
  items: { id: string; start: number; duration?: number }[],
  duration: number
) {
  const out = new Map<string, { left: number; width: number }>()
  let cluster: { id: string; col: number }[] = []
  let colEnds: number[] = []
  const flush = () => {
    for (const c of cluster) out.set(c.id, { left: c.col / colEnds.length, width: 1 / colEnds.length })
    cluster = []
    colEnds = []
  }
  for (const item of [...items].sort((a, b) => a.start - b.start)) {
    // Nothing still running: the overlapping group is complete.
    if (cluster.length && colEnds.every((end) => end <= item.start)) flush()
    let col = colEnds.findIndex((end) => end <= item.start)
    if (col === -1) col = colEnds.length
    colEnds[col] = item.start + (item.duration ?? duration)
    cluster.push({ id: item.id, col })
  }
  flush()
  return out
}

/** The days a month grid shows: whole weeks, from the week of the 1st to the week of the last day. */
export function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay())
  const count = first.getDay() + last.getDate() + (6 - last.getDay())
  return Array.from(
    { length: count },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
  )
}

/** Pixels from the top of a grid of `firstHour`…`lastHour` to `minutes` into the day; null outside it. */
export function gridOffset(minutes: number, firstHour: number, lastHour: number, hourHeight: number) {
  if (minutes < firstHour * 60 || minutes > lastHour * 60) return null
  return ((minutes - firstHour * 60) / 60) * hourHeight
}
