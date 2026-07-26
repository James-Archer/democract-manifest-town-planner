import { DEFAULT_ZONE } from './config'

export function cellKey(row, col) {
  return `${row}:${col}`
}

export function createZoneGrid(rows, cols, defaultZone = DEFAULT_ZONE) {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => defaultZone))
}

export function getFootprintCells(startRow, startCol, footprint) {
  const cells = []
  for (let row = startRow; row < startRow + footprint.height; row += 1) {
    for (let col = startCol; col < startCol + footprint.width; col += 1) {
      cells.push({ row, col })
    }
  }
  return cells
}

export function cellsAreInBounds(cells, rows, cols) {
  return cells.every((cell) => cell.row >= 0 && cell.row < rows && cell.col >= 0 && cell.col < cols)
}

export function buildOccupancyGrid(placements, rows, cols) {
  const occupancy = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null))
  for (const placement of placements) {
    for (const cell of placement.occupiedCells) {
      occupancy[cell.row][cell.col] = placement.id
    }
  }
  return occupancy
}

export function canPlaceBuilding({
  startRow,
  startCol,
  footprint,
  allowedZones,
  zonesGrid,
  occupancy,
  rows,
  cols,
  ignoreZoning = false,
}) {
  const occupiedCells = getFootprintCells(startRow, startCol, footprint)

  if (!cellsAreInBounds(occupiedCells, rows, cols)) {
    return { ok: false, reason: 'out-of-bounds', occupiedCells }
  }

  const overlapping = occupiedCells.some((cell) => occupancy[cell.row][cell.col] !== null)
  if (overlapping) {
    return { ok: false, reason: 'overlap', occupiedCells }
  }

  const canUseAnyZone = allowedZones.includes('Any')
  if (!ignoreZoning && !canUseAnyZone) {
    const hasInvalidZone = occupiedCells.some(
      (cell) => !allowedZones.includes(zonesGrid[cell.row][cell.col])
    )
    if (hasInvalidZone) {
      return { ok: false, reason: 'zone-mismatch', occupiedCells }
    }
  }

  return { ok: true, reason: null, occupiedCells }
}

export function arePlacementsOrthogonallyAdjacent(placementA, placementB) {
  const cellsA = new Set(placementA.occupiedCells.map((cell) => cellKey(cell.row, cell.col)))

  for (const cell of placementB.occupiedCells) {
    const neighbours = [
      [cell.row - 1, cell.col],
      [cell.row + 1, cell.col],
      [cell.row, cell.col - 1],
      [cell.row, cell.col + 1],
    ]

    for (const [row, col] of neighbours) {
      if (cellsA.has(cellKey(row, col))) {
        return true
      }
    }
  }

  return false
}
