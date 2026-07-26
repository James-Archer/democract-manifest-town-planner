<script>
  import { onMount } from 'svelte'

  import csvText from './data/buildingData.csv?raw'
  import { DEFAULT_ZONE, DEPARTMENTS, GRID_COLS, GRID_ROWS, ZONES, ZONE_COLORS } from './lib/config'
  import { parseBuildingsCsv } from './lib/csv'
  import { buildOccupancyGrid, canPlaceBuilding, cellKey, createZoneGrid } from './lib/gridEngine'
  import { calculateDepartmentScores } from './lib/scoring'

  const STORAGE_KEY = 'town-planner-state-v1'
  const SNAPSHOT_VERSION = 1

  const { buildings: parsedBuildings, issues } = parseBuildingsCsv(csvText)
  const rowIndices = Array.from({ length: GRID_ROWS }, (_, index) => index)
  const colIndices = Array.from({ length: GRID_COLS }, (_, index) => index)

  let zones = [...ZONES]
  let zoneColors = { ...ZONE_COLORS }
  let buildingsCatalog = [...parsedBuildings]

  let zonesGrid = createZoneGrid(GRID_ROWS, GRID_COLS, DEFAULT_ZONE)
  let placements = []
  let nextPlacementId = 1

  let activeZone = DEFAULT_ZONE
  let selectedBuildingName = null
  let selectedFootprintIndex = 0
  let isRotated = false
  let editorMode = 'zone'
  let placementMode = false
  let selectedPlacementId = null
  let hoveredCell = null
  let showBuildings = true
  let overrideZoning = false

  let zoningPaintMode = 'single'
  let rectangleStart = null

  let newZoneName = ''
  let newBuildingName = ''
  let newBuildingWidth = 1
  let newBuildingHeight = 1
  let newBuildingPositive = ''
  let newBuildingNegative = ''
  let newBuildingAllowedZones = []
  let newBuildingScores = makeEmptyDepartmentScores()

  let planFileInput
  let isHydrated = false

  let statusMessage = 'Pick a zone to paint, or select a building to place.'
  let showScoreModal = false
  let showDataModal = false

  $: selectedBuilding =
    buildingsCatalog.find((building) => building.name === selectedBuildingName) ?? null

  $: selectedFootprint =
    selectedBuilding?.footprints[
      Math.min(selectedFootprintIndex, (selectedBuilding?.footprints.length ?? 1) - 1)
    ] ?? null

  $: placementFootprint = selectedFootprint
    ? isRotated
      ? {
          width: selectedFootprint.height,
          height: selectedFootprint.width,
          label: `${selectedFootprint.height}x${selectedFootprint.width}`,
        }
      : selectedFootprint
    : null

  $: occupancy = buildOccupancyGrid(placements, GRID_ROWS, GRID_COLS)

  $: placementPreview =
    placementMode && hoveredCell && selectedBuilding && selectedFootprint
      ? canPlaceBuilding({
          startRow: hoveredCell.row,
          startCol: hoveredCell.col,
          footprint: placementFootprint,
          allowedZones: selectedBuilding.allowedZones,
          zonesGrid,
          occupancy,
          rows: GRID_ROWS,
          cols: GRID_COLS,
          ignoreZoning: overrideZoning,
        })
      : null

  $: previewCellKeys = new Set(
    (placementPreview?.occupiedCells ?? []).map((cell) => cellKey(cell.row, cell.col))
  )
  $: scoreSummary = calculateDepartmentScores(placements)

  $: zoneRegions = placementMode ? [] : computeZoneRegions(zonesGrid)

  $: if (
    selectedBuildingName !== null &&
    !buildingsCatalog.some((building) => building.name === selectedBuildingName)
  ) {
    selectedBuildingName = null
    placementMode = false
  }

  $: if (isHydrated) {
    persistToLocalStorage()
  }

  onMount(() => {
    hydrateFromLocalStorage()
    isHydrated = true
  })

  function makeEmptyDepartmentScores() {
    return Object.fromEntries(DEPARTMENTS.map((department) => [department, 0]))
  }

  function formatScore(value) {
    return Number.isInteger(value) ? `${value}` : value.toFixed(1)
  }

  function getNameHash(name) {
    let hash = 0
    for (let index = 0; index < name.length; index += 1) {
      hash = (hash * 31 + name.charCodeAt(index)) >>> 0
    }
    return hash
  }

  function getBuildingVibeBaseHue(name, allowedZones) {
    const lower = name.toLowerCase()

    if (/(fire|firetruck|hydrant)/.test(lower)) return 10
    if (/(police|security|forensic)/.test(lower)) return 220
    if (/(medical|doctor|chemist|vet|health)/.test(lower)) return 168
    if (/(park|garden|pond|beehive|reserve|habitat|gym|sports)/.test(lower)) return 126
    if (/(bus|taxi|subway|exchange|carpark|charger)/.test(lower)) return 205
    if (/(school|library|museum|maker|news)/.test(lower)) return 46
    if (/(casino|cafe|restaurant|grocer|hair|business)/.test(lower)) return 28
    if (/(warehouse|mechanic|sub-station|water|industrial)/.test(lower)) return 255

    const primaryZone = allowedZones.find((zone) => zone !== 'Any') ?? allowedZones[0] ?? 'Any'
    const zoneHue = {
      Residential: 203,
      Commercial: 35,
      Industrial: 255,
      Park: 126,
      'Mixed use': 278,
      Conservation: 148,
      Any: 215,
    }

    return zoneHue[primaryZone] ?? 210
  }

  function getBuildingColors(name, allowedZones) {
    const hash = getNameHash(name)
    const baseHue = getBuildingVibeBaseHue(name, allowedZones)
    const hue = (baseHue + (hash % 28) - 14 + 360) % 360
    const saturation = 62 + (hash % 11)
    const lightness = 52 + ((hash >> 5) % 8)

    return {
      fill: `hsl(${hue}deg ${saturation}% ${lightness}%)`,
      border: `hsl(${hue}deg ${Math.max(45, saturation - 14)}% ${Math.max(25, lightness - 22)}%)`,
      text: lightness > 56 ? '#1f1f1f' : '#ffffff',
    }
  }

  function getZoneColor(zoneName) {
    const hash = getNameHash(zoneName)
    const hue = hash % 360
    return `hsl(${hue}deg 60% 84%)`
  }

  function computeZoneRegions(grid) {
    const rows = grid.length
    const cols = grid[0]?.length ?? 0
    const visited = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))
    const regions = []

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (visited[row][col]) {
          continue
        }

        const zone = grid[row][col]
        const stack = [[row, col]]
        visited[row][col] = true
        const cells = []

        while (stack.length > 0) {
          const [currentRow, currentCol] = stack.pop()
          cells.push({ row: currentRow, col: currentCol })

          const neighbours = [
            [currentRow - 1, currentCol],
            [currentRow + 1, currentCol],
            [currentRow, currentCol - 1],
            [currentRow, currentCol + 1],
          ]

          for (const [nextRow, nextCol] of neighbours) {
            if (
              nextRow >= 0 &&
              nextRow < rows &&
              nextCol >= 0 &&
              nextCol < cols &&
              !visited[nextRow][nextCol] &&
              grid[nextRow][nextCol] === zone
            ) {
              visited[nextRow][nextCol] = true
              stack.push([nextRow, nextCol])
            }
          }
        }

        const avgRow = cells.reduce((sum, cell) => sum + cell.row, 0) / cells.length
        const avgCol = cells.reduce((sum, cell) => sum + cell.col, 0) / cells.length
        let labelCell = cells[0]
        let bestDistance = Infinity

        for (const cell of cells) {
          const distance = (cell.row - avgRow) ** 2 + (cell.col - avgCol) ** 2
          if (distance < bestDistance) {
            bestDistance = distance
            labelCell = cell
          }
        }

        regions.push({
          id: `${zone}-${labelCell.row}-${labelCell.col}`,
          zone,
          size: cells.length,
          labelRow: labelCell.row,
          labelCol: labelCell.col,
        })
      }
    }

    return regions
  }

  function normalizeBuilding(rawBuilding) {
    if (!rawBuilding || typeof rawBuilding !== 'object') {
      return null
    }

    const name = `${rawBuilding.name ?? ''}`.trim()
    if (!name) {
      return null
    }

    const rawAllowedZones = Array.isArray(rawBuilding.allowedZones) ? rawBuilding.allowedZones : []
    const allowedZones = Array.from(
      new Set(rawAllowedZones.map((zone) => `${zone}`.trim()).filter(Boolean))
    )

    const rawFootprints = Array.isArray(rawBuilding.footprints) ? rawBuilding.footprints : []
    const footprints = rawFootprints
      .map((footprint) => {
        const width = Number(footprint?.width)
        const height = Number(footprint?.height)

        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          return null
        }

        return {
          width: Math.max(1, Math.floor(width)),
          height: Math.max(1, Math.floor(height)),
          label:
            typeof footprint?.label === 'string' && footprint.label.trim()
              ? footprint.label.trim()
              : `${Math.max(1, Math.floor(width))}x${Math.max(1, Math.floor(height))}`,
        }
      })
      .filter(Boolean)

    if (footprints.length === 0) {
      return null
    }

    const departmentScores = {}
    for (const department of DEPARTMENTS) {
      const value = Number(rawBuilding.departmentScores?.[department] ?? 0)
      departmentScores[department] = Number.isFinite(value) ? value : 0
    }

    const positiveStructure =
      typeof rawBuilding.positiveStructure === 'string' && rawBuilding.positiveStructure.trim()
        ? rawBuilding.positiveStructure.trim()
        : null

    const negativeStructure =
      typeof rawBuilding.negativeStructure === 'string' && rawBuilding.negativeStructure.trim()
        ? rawBuilding.negativeStructure.trim()
        : null

    return {
      name,
      allowedZones: allowedZones.length > 0 ? allowedZones : ['Any'],
      footprints,
      departmentScores,
      positiveStructure,
      negativeStructure,
    }
  }

  function getSnapshot() {
    return {
      version: SNAPSHOT_VERSION,
      zones,
      zoneColors,
      buildingsCatalog,
      zonesGrid,
      placements,
      nextPlacementId,
      showBuildings,
      overrideZoning,
    }
  }

  function applySnapshot(snapshot, sourceLabel) {
    if (!snapshot || typeof snapshot !== 'object') {
      return false
    }

    const nextZonesRaw = Array.isArray(snapshot.zones) ? snapshot.zones : [...ZONES]
    const nextZones = Array.from(
      new Set(nextZonesRaw.map((zone) => `${zone}`.trim()).filter(Boolean))
    )
    if (!nextZones.includes(DEFAULT_ZONE)) {
      nextZones.unshift(DEFAULT_ZONE)
    }

    const nextZoneColors = { ...ZONE_COLORS, ...(snapshot.zoneColors ?? {}) }
    for (const zone of nextZones) {
      if (!nextZoneColors[zone]) {
        nextZoneColors[zone] = getZoneColor(zone)
      }
    }

    const rawBuildings = Array.isArray(snapshot.buildingsCatalog)
      ? snapshot.buildingsCatalog
      : [...parsedBuildings]
    const nextBuildings = rawBuildings.map(normalizeBuilding).filter(Boolean)

    if (nextBuildings.length === 0) {
      return false
    }

    const rawGrid = Array.isArray(snapshot.zonesGrid) ? snapshot.zonesGrid : null
    const nextGrid = createZoneGrid(GRID_ROWS, GRID_COLS, DEFAULT_ZONE)
    if (rawGrid) {
      for (let row = 0; row < GRID_ROWS; row += 1) {
        for (let col = 0; col < GRID_COLS; col += 1) {
          const cellValue = rawGrid?.[row]?.[col]
          if (typeof cellValue === 'string' && nextZones.includes(cellValue)) {
            nextGrid[row][col] = cellValue
          }
        }
      }
    }

    const loadedPlacements = []
    let placementOccupancy = buildOccupancyGrid([], GRID_ROWS, GRID_COLS)
    const rawPlacements = Array.isArray(snapshot.placements) ? snapshot.placements : []

    for (const rawPlacement of rawPlacements) {
      const name = `${rawPlacement?.name ?? ''}`.trim()
      if (!name) {
        continue
      }

      const buildingDef =
        nextBuildings.find((building) => building.name === name) ??
        normalizeBuilding({
          name,
          allowedZones: ['Any'],
          footprints: [rawPlacement?.footprint ?? { width: 1, height: 1, label: '1x1' }],
          departmentScores: rawPlacement?.departmentScores ?? makeEmptyDepartmentScores(),
          positiveStructure: rawPlacement?.positiveStructure,
          negativeStructure: rawPlacement?.negativeStructure,
        })

      if (!buildingDef) {
        continue
      }

      const footprint = normalizeBuilding({
        name: 'temp',
        allowedZones: ['Any'],
        footprints: [rawPlacement?.footprint ?? { width: 1, height: 1, label: '1x1' }],
        departmentScores: makeEmptyDepartmentScores(),
      })?.footprints?.[0]

      if (!footprint) {
        continue
      }

      const row = Number(rawPlacement?.row)
      const col = Number(rawPlacement?.col)
      if (!Number.isInteger(row) || !Number.isInteger(col)) {
        continue
      }

      const placementCheck = canPlaceBuilding({
        startRow: row,
        startCol: col,
        footprint,
        allowedZones: ['Any'],
        zonesGrid: nextGrid,
        occupancy: placementOccupancy,
        rows: GRID_ROWS,
        cols: GRID_COLS,
        ignoreZoning: true,
      })

      if (!placementCheck.ok) {
        continue
      }

      const colors = getBuildingColors(buildingDef.name, buildingDef.allowedZones)
      const placementId = Number(rawPlacement?.id)

      loadedPlacements.push({
        id: Number.isInteger(placementId) ? placementId : loadedPlacements.length + 1,
        name: buildingDef.name,
        row,
        col,
        footprint,
        occupiedCells: placementCheck.occupiedCells,
        departmentScores: { ...buildingDef.departmentScores },
        positiveStructure: buildingDef.positiveStructure,
        negativeStructure: buildingDef.negativeStructure,
        fillColor: rawPlacement?.fillColor ?? colors.fill,
        borderColor: rawPlacement?.borderColor ?? colors.border,
        textColor: rawPlacement?.textColor ?? colors.text,
      })

      placementOccupancy = buildOccupancyGrid(loadedPlacements, GRID_ROWS, GRID_COLS)
    }

    zones = nextZones
    zoneColors = nextZoneColors
    buildingsCatalog = nextBuildings
    zonesGrid = nextGrid
    placements = loadedPlacements
    nextPlacementId =
      Number.isInteger(Number(snapshot.nextPlacementId)) && Number(snapshot.nextPlacementId) > 0
        ? Number(snapshot.nextPlacementId)
        : loadedPlacements.reduce((max, placement) => Math.max(max, placement.id), 0) + 1
    showBuildings = snapshot.showBuildings ?? true
    overrideZoning = snapshot.overrideZoning ?? false
    rectangleStart = null

    if (!zones.includes(activeZone)) {
      activeZone = zones[0] ?? DEFAULT_ZONE
    }

    statusMessage = `Loaded planner state from ${sourceLabel}.`
    return true
  }

  function persistToLocalStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getSnapshot()))
    } catch {
      statusMessage = 'Could not save planner state to local storage.'
    }
  }

  function hydrateFromLocalStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) {
        return
      }
      const parsed = JSON.parse(stored)
      applySnapshot(parsed, 'local storage')
    } catch {
      statusMessage = 'Local storage data was invalid and was skipped.'
    }
  }

  function beginPlacement(buildingName) {
    editorMode = 'building'
    selectedBuildingName = buildingName
    selectedFootprintIndex = 0
    isRotated = false
    selectedPlacementId = null
    placementMode = true
    statusMessage = `Placing ${buildingName}. Click inside the grid to place.`
  }

  function setEditorMode(mode) {
    editorMode = mode

    if (mode !== 'zone') {
      rectangleStart = null
    }

    if (mode === 'zone' && placementMode) {
      cancelPlacement('Switched to Zone Editor.')
    }

    if (mode === 'building') {
      statusMessage =
        selectedBuildingName && !placementMode
          ? `Building Placer active. Select ${selectedBuildingName} again to place.`
          : 'Building Placer active. Select a building to begin placement.'
    }

    if (mode === 'data') {
      statusMessage = 'Data Editor active. Add zones or buildings.'
    }
  }

  function setZoningPaintMode(mode) {
    zoningPaintMode = mode
    rectangleStart = null
    statusMessage =
      mode === 'rectangle'
        ? 'Rectangle fill mode active. Click the first corner.'
        : 'Single-cell paint mode active.'
  }

  function rotateFootprint() {
    if (!selectedFootprint) {
      return
    }
    isRotated = !isRotated
    if (selectedBuildingName) {
      statusMessage = `Placing ${selectedBuildingName} (${placementFootprint?.label ?? ''}).`
    }
  }

  function cancelPlacement(message = 'Placement canceled.') {
    placementMode = false
    hoveredCell = null
    statusMessage = message
  }

  function clearPlan() {
    if (!window.confirm('Clear all placed buildings from this plan?')) {
      return
    }

    placements = []
    selectedPlacementId = null
    statusMessage = 'Plan cleared.'
  }

  function paintZone(row, col) {
    if (showBuildings && occupancy[row][col] !== null) {
      statusMessage = 'Cannot re-zone a cell occupied by a building.'
      return
    }

    zonesGrid = zonesGrid.map((zoneRow, rowIndex) =>
      rowIndex === row
        ? zoneRow.map((zone, colIndex) => (colIndex === col ? activeZone : zone))
        : zoneRow
    )
  }

  function fillZoneRectangle(start, end) {
    const minRow = Math.min(start.row, end.row)
    const maxRow = Math.max(start.row, end.row)
    const minCol = Math.min(start.col, end.col)
    const maxCol = Math.max(start.col, end.col)

    let painted = 0
    let skipped = 0

    const nextGrid = zonesGrid.map((rowValues) => [...rowValues])

    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        if (showBuildings && occupancy[row][col] !== null) {
          skipped += 1
          continue
        }

        if (nextGrid[row][col] !== activeZone) {
          painted += 1
        }
        nextGrid[row][col] = activeZone
      }
    }

    zonesGrid = nextGrid

    if (skipped > 0) {
      statusMessage = `Filled rectangle: ${painted} cells painted, ${skipped} occupied cells skipped.`
      return
    }

    statusMessage = `Filled rectangle: ${painted} cells painted.`
  }

  function toggleBuildingsVisibility() {
    showBuildings = !showBuildings
    selectedPlacementId = null

    if (showBuildings) {
      statusMessage = 'Buildings are visible.'
      return
    }

    statusMessage = 'Buildings hidden. You can now repaint any zone under buildings.'
  }

  function placeBuilding(row, col) {
    if (!selectedBuilding || !placementFootprint) {
      return
    }

    const result = canPlaceBuilding({
      startRow: row,
      startCol: col,
      footprint: placementFootprint,
      allowedZones: selectedBuilding.allowedZones,
      zonesGrid,
      occupancy,
      rows: GRID_ROWS,
      cols: GRID_COLS,
      ignoreZoning: overrideZoning,
    })

    if (!result.ok) {
      const reasonMap = {
        'out-of-bounds': 'Footprint is outside the grid.',
        overlap: 'Footprint overlaps an existing building.',
        'zone-mismatch': 'This building cannot be placed on the selected zones.',
      }
      statusMessage = reasonMap[result.reason] ?? 'Cannot place building here.'
      return
    }

    const colors = getBuildingColors(selectedBuilding.name, selectedBuilding.allowedZones)

    placements = [
      ...placements,
      {
        id: nextPlacementId,
        name: selectedBuilding.name,
        row,
        col,
        footprint: placementFootprint,
        occupiedCells: result.occupiedCells,
        departmentScores: selectedBuilding.departmentScores,
        positiveStructure: selectedBuilding.positiveStructure,
        negativeStructure: selectedBuilding.negativeStructure,
        fillColor: colors.fill,
        borderColor: colors.border,
        textColor: colors.text,
      },
    ]
    nextPlacementId += 1
    selectedPlacementId = null
    statusMessage = overrideZoning
      ? `Placed ${selectedBuilding.name} with zoning override.`
      : `Placed ${selectedBuilding.name}.`
  }

  function handleCellClick(row, col) {
    selectedPlacementId = null

    if (placementMode) {
      placeBuilding(row, col)
      return
    }

    if (editorMode !== 'zone') {
      statusMessage = 'Zone Editor is not active.'
      return
    }

    if (zoningPaintMode === 'rectangle') {
      if (!rectangleStart) {
        rectangleStart = { row, col }
        statusMessage = `Rectangle start set at (${row + 1}, ${col + 1}). Click opposite corner.`
        return
      }

      fillZoneRectangle(rectangleStart, { row, col })
      rectangleStart = null
      return
    }

    paintZone(row, col)
  }

  function removePlacement(placementId) {
    placements = placements.filter((placement) => placement.id !== placementId)
    if (selectedPlacementId === placementId) {
      selectedPlacementId = null
    }
    statusMessage = 'Building removed.'
  }

  function selectPlacement(placementId) {
    selectedPlacementId = placementId
    const selectedPlacement = placements.find((placement) => placement.id === placementId)
    if (selectedPlacement) {
      statusMessage = `Selected ${selectedPlacement.name}. Press Delete or Backspace to remove.`
    }
  }

  function handleRootPointerDown(event) {
    if (!placementMode) {
      return
    }

    const target = event.target instanceof Element ? event.target : null
    if (!target) {
      return
    }

    if (target.closest('[data-grid-root="true"]')) {
      return
    }

    cancelPlacement()
  }

  function handleGlobalContextMenu(event) {
    if (!placementMode) {
      return
    }

    event.preventDefault()
    cancelPlacement()
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && placementMode) {
      cancelPlacement()
      return
    }

    if ((event.key === 'r' || event.key === 'R') && placementMode) {
      event.preventDefault()
      rotateFootprint()
      return
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedPlacementId !== null) {
      event.preventDefault()
      removePlacement(selectedPlacementId)
    }
  }

  function addZone() {
    const zoneName = newZoneName.trim()
    if (!zoneName) {
      statusMessage = 'Zone name cannot be empty.'
      return
    }

    if (zones.includes(zoneName)) {
      statusMessage = `Zone ${zoneName} already exists.`
      return
    }

    zones = [...zones, zoneName]
    zoneColors = {
      ...zoneColors,
      [zoneName]: getZoneColor(zoneName),
    }
    newZoneName = ''
    statusMessage = `Added zone ${zoneName}.`
  }

  function toggleNewBuildingZone(zone, checked) {
    if (checked) {
      newBuildingAllowedZones = Array.from(new Set([...newBuildingAllowedZones, zone]))
      return
    }

    newBuildingAllowedZones = newBuildingAllowedZones.filter(
      (selectedZone) => selectedZone !== zone
    )
  }

  function updateNewBuildingScore(department, value) {
    const parsed = Number(value)
    newBuildingScores = {
      ...newBuildingScores,
      [department]: Number.isFinite(parsed) ? parsed : 0,
    }
  }

  function addBuilding() {
    const name = newBuildingName.trim()
    if (!name) {
      statusMessage = 'Building name is required.'
      return
    }

    if (buildingsCatalog.some((building) => building.name.toLowerCase() === name.toLowerCase())) {
      statusMessage = `Building ${name} already exists.`
      return
    }

    const width = Math.max(1, Math.floor(Number(newBuildingWidth) || 1))
    const height = Math.max(1, Math.floor(Number(newBuildingHeight) || 1))
    const allowedZones = newBuildingAllowedZones.length > 0 ? [...newBuildingAllowedZones] : ['Any']

    const building = normalizeBuilding({
      name,
      allowedZones,
      footprints: [{ width, height, label: `${width}x${height}` }],
      departmentScores: newBuildingScores,
      positiveStructure: newBuildingPositive.trim() || null,
      negativeStructure: newBuildingNegative.trim() || null,
    })

    if (!building) {
      statusMessage = 'Could not add building. Check values and try again.'
      return
    }

    buildingsCatalog = [...buildingsCatalog, building]
    newBuildingName = ''
    newBuildingWidth = 1
    newBuildingHeight = 1
    newBuildingPositive = ''
    newBuildingNegative = ''
    newBuildingAllowedZones = []
    newBuildingScores = makeEmptyDepartmentScores()
    statusMessage = `Added building ${building.name}.`
  }

  function renameZone(oldName, rawNewName) {
    const newName = `${rawNewName}`.trim()
    if (!newName || newName === oldName) {
      return
    }

    if (zones.includes(newName)) {
      statusMessage = `Zone ${newName} already exists.`
      return
    }

    zones = zones.map((zone) => (zone === oldName ? newName : zone))

    const color = zoneColors[oldName]
    const { [oldName]: _removed, ...restColors } = zoneColors
    zoneColors = { ...restColors, [newName]: color ?? getZoneColor(newName) }

    zonesGrid = zonesGrid.map((rowValues) =>
      rowValues.map((zone) => (zone === oldName ? newName : zone))
    )

    buildingsCatalog = buildingsCatalog.map((building) => ({
      ...building,
      allowedZones: building.allowedZones.map((zone) => (zone === oldName ? newName : zone)),
    }))

    if (activeZone === oldName) {
      activeZone = newName
    }

    statusMessage = `Renamed zone ${oldName} to ${newName}.`
  }

  function setZoneColor(zoneName, color) {
    zoneColors = { ...zoneColors, [zoneName]: color }
  }

  function deleteZone(zoneName) {
    if (zoneName === DEFAULT_ZONE) {
      statusMessage = `Cannot delete the default zone (${DEFAULT_ZONE}).`
      return
    }

    if (!window.confirm(`Delete zone ${zoneName}? Its cells revert to ${DEFAULT_ZONE}.`)) {
      return
    }

    zones = zones.filter((zone) => zone !== zoneName)

    const { [zoneName]: _removed, ...restColors } = zoneColors
    zoneColors = restColors

    zonesGrid = zonesGrid.map((rowValues) =>
      rowValues.map((zone) => (zone === zoneName ? DEFAULT_ZONE : zone))
    )

    buildingsCatalog = buildingsCatalog.map((building) => {
      const filtered = building.allowedZones.filter((zone) => zone !== zoneName)
      return { ...building, allowedZones: filtered.length > 0 ? filtered : ['Any'] }
    })

    if (activeZone === zoneName) {
      activeZone = DEFAULT_ZONE
    }

    statusMessage = `Deleted zone ${zoneName}.`
  }

  function renameBuilding(oldName, rawNewName) {
    const newName = `${rawNewName}`.trim()
    if (!newName || newName === oldName) {
      return
    }

    if (
      buildingsCatalog.some(
        (building) =>
          building.name !== oldName && building.name.toLowerCase() === newName.toLowerCase()
      )
    ) {
      statusMessage = `Building ${newName} already exists.`
      return
    }

    buildingsCatalog = buildingsCatalog.map((building) => {
      const base = building.name === oldName ? { ...building, name: newName } : building
      return {
        ...base,
        positiveStructure: base.positiveStructure === oldName ? newName : base.positiveStructure,
        negativeStructure: base.negativeStructure === oldName ? newName : base.negativeStructure,
      }
    })

    placements = placements.map((placement) => ({
      ...placement,
      name: placement.name === oldName ? newName : placement.name,
      positiveStructure:
        placement.positiveStructure === oldName ? newName : placement.positiveStructure,
      negativeStructure:
        placement.negativeStructure === oldName ? newName : placement.negativeStructure,
    }))

    if (selectedBuildingName === oldName) {
      selectedBuildingName = newName
    }

    statusMessage = `Renamed building ${oldName} to ${newName}.`
  }

  function updateBuildingFootprint(name, dimension, value) {
    const parsed = Math.max(1, Math.floor(Number(value) || 1))

    buildingsCatalog = buildingsCatalog.map((building) => {
      if (building.name !== name) {
        return building
      }

      const current = building.footprints[0] ?? { width: 1, height: 1 }
      const width = dimension === 'width' ? parsed : current.width
      const height = dimension === 'height' ? parsed : current.height

      return {
        ...building,
        footprints: [
          { width, height, label: `${width}x${height}` },
          ...building.footprints.slice(1),
        ],
      }
    })
  }

  function toggleBuildingAllowedZone(name, zone, checked) {
    buildingsCatalog = buildingsCatalog.map((building) => {
      if (building.name !== name) {
        return building
      }

      const set = new Set(building.allowedZones)
      if (checked) {
        set.add(zone)
      } else {
        set.delete(zone)
      }

      const allowedZones = Array.from(set)
      return { ...building, allowedZones: allowedZones.length > 0 ? allowedZones : ['Any'] }
    })
  }

  function updateBuildingStructure(name, field, value) {
    const structure = value || null
    buildingsCatalog = buildingsCatalog.map((building) =>
      building.name === name ? { ...building, [field]: structure } : building
    )
  }

  function updateBuildingScore(name, department, value) {
    const parsed = Number(value)
    const score = Number.isFinite(parsed) ? parsed : 0

    buildingsCatalog = buildingsCatalog.map((building) =>
      building.name === name
        ? { ...building, departmentScores: { ...building.departmentScores, [department]: score } }
        : building
    )

    placements = placements.map((placement) =>
      placement.name === name
        ? { ...placement, departmentScores: { ...placement.departmentScores, [department]: score } }
        : placement
    )
  }

  function deleteBuilding(name) {
    if (!window.confirm(`Delete building ${name}? Placed instances are removed.`)) {
      return
    }

    buildingsCatalog = buildingsCatalog
      .filter((building) => building.name !== name)
      .map((building) => ({
        ...building,
        positiveStructure: building.positiveStructure === name ? null : building.positiveStructure,
        negativeStructure: building.negativeStructure === name ? null : building.negativeStructure,
      }))

    placements = placements.filter((placement) => placement.name !== name)

    if (selectedBuildingName === name) {
      selectedBuildingName = null
      placementMode = false
    }

    statusMessage = `Deleted building ${name}.`
  }

  function downloadPlanJson() {
    try {
      const serialized = JSON.stringify(getSnapshot(), null, 2)
      const blob = new Blob([serialized], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'town-plan.json'
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      statusMessage = 'Plan JSON downloaded.'
    } catch {
      statusMessage = 'Could not download plan JSON.'
    }
  }

  function triggerLoadPlanJson() {
    planFileInput?.click()
  }

  async function loadPlanJson(event) {
    const input = event.currentTarget
    const file = input?.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const snapshot = JSON.parse(text)
      const loaded = applySnapshot(snapshot, 'JSON file')
      if (!loaded) {
        statusMessage = 'JSON file format is invalid for this planner.'
      }
    } catch {
      statusMessage = 'Could not load JSON file.'
    } finally {
      input.value = ''
    }
  }
</script>

<svelte:window on:keydown={handleKeyDown} on:contextmenu={handleGlobalContextMenu} />

<main class="planner" on:pointerdown={handleRootPointerDown}>
  <aside class="sidebar">
    <h1>Town Planner</h1>

    <section class="panel editor-mode-panel">
      <h2>Editor Mode</h2>
      <div class="editor-mode-toggle" role="tablist" aria-label="Editor mode">
        <button
          type="button"
          class="mode-button {editorMode === 'zone' ? 'active' : ''}"
          aria-pressed={editorMode === 'zone'}
          on:click={() => setEditorMode('zone')}
        >
          Zone Editor
        </button>
        <button
          type="button"
          class="mode-button {editorMode === 'building' ? 'active' : ''}"
          aria-pressed={editorMode === 'building'}
          on:click={() => setEditorMode('building')}
        >
          Building Placer
        </button>
        <button
          type="button"
          class="mode-button {editorMode === 'data' ? 'active' : ''}"
          aria-pressed={editorMode === 'data'}
          on:click={() => setEditorMode('data')}
        >
          Data Editor
        </button>
      </div>
    </section>

    {#if editorMode === 'zone'}
      <section class="panel">
        <h2>Zone Painter</h2>
        <label class="field-label" for="zone-select">Active zone</label>
        <select id="zone-select" bind:value={activeZone}>
          {#each zones as zone (zone)}
            <option value={zone}>{zone}</option>
          {/each}
        </select>

        <div class="mode-row">
          <button
            type="button"
            class="small-button {zoningPaintMode === 'single' ? 'active' : ''}"
            on:click={() => setZoningPaintMode('single')}
          >
            Single Cell
          </button>
          <button
            type="button"
            class="small-button {zoningPaintMode === 'rectangle' ? 'active' : ''}"
            on:click={() => setZoningPaintMode('rectangle')}
          >
            Rectangle Fill
          </button>
        </div>

        {#if zoningPaintMode === 'rectangle' && rectangleStart}
          <p class="hint">
            First corner at ({rectangleStart.row + 1}, {rectangleStart.col + 1}). Click second
            corner.
          </p>
        {/if}
      </section>
    {/if}

    {#if editorMode === 'building'}
      <section class="panel">
        <h2>Buildings</h2>
        <label class="toggle-row">
          <input type="checkbox" bind:checked={overrideZoning} />
          <span>Override zoning requirements</span>
        </label>

        <div class="building-list">
          {#each buildingsCatalog as building (building.name)}
            <button
              type="button"
              class="building-button {selectedBuildingName === building.name ? 'active' : ''}"
              on:click={() => beginPlacement(building.name)}
            >
              <strong>{building.name}</strong>
              <span>Zones: {building.allowedZones.join(', ')}</span>
              <span
                >Footprint: {building.footprints
                  .map((footprint) => footprint.label)
                  .join(' / ')}</span
              >
            </button>
          {/each}
        </div>

        {#if selectedBuilding && selectedBuilding.footprints.length > 1}
          <label class="field-label" for="footprint-select">Footprint variation</label>
          <select id="footprint-select" bind:value={selectedFootprintIndex}>
            {#each selectedBuilding.footprints as footprint, index (`${footprint.label}-${index}`)}
              <option value={index}>{footprint.label}</option>
            {/each}
          </select>
        {/if}

        {#if selectedBuilding}
          <div class="rotation-controls">
            <p class="hint">Current orientation: {placementFootprint?.label ?? 'N/A'}</p>
            <button type="button" class="secondary" on:click={rotateFootprint}>Rotate 90 deg</button
            >
          </div>
        {/if}
      </section>
    {/if}

    {#if editorMode === 'data'}
      <section class="panel">
        <h2>Data Editor</h2>

        <h3>Add Zone</h3>
        <div class="inline-form">
          <input type="text" placeholder="Zone name" bind:value={newZoneName} />
          <button type="button" class="secondary" on:click={addZone}>Add Zone</button>
        </div>

        <button type="button" class="secondary" on:click={() => (showDataModal = true)}>
          Manage Zones &amp; Buildings
        </button>

        <h3>Add Building</h3>
        <label class="field-label" for="new-building-name">Name</label>
        <input id="new-building-name" type="text" bind:value={newBuildingName} />

        <div class="two-col-inputs">
          <label>
            <span class="field-label">Width</span>
            <input type="number" min="1" max={GRID_COLS} bind:value={newBuildingWidth} />
          </label>
          <label>
            <span class="field-label">Height</span>
            <input type="number" min="1" max={GRID_ROWS} bind:value={newBuildingHeight} />
          </label>
        </div>

        <label class="field-label">Allowed zones</label>
        <div class="checkbox-grid">
          {#each ['Any', ...zones.filter((zone) => zone !== 'Any')] as zoneOption (zoneOption)}
            <label class="checkbox-item">
              <input
                type="checkbox"
                checked={newBuildingAllowedZones.includes(zoneOption)}
                on:change={(event) =>
                  toggleNewBuildingZone(zoneOption, event.currentTarget.checked)}
              />
              <span>{zoneOption}</span>
            </label>
          {/each}
        </div>

        <div class="two-col-inputs">
          <label>
            <span class="field-label">Positive structure</span>
            <select bind:value={newBuildingPositive}>
              <option value="">None</option>
              {#each buildingsCatalog as building (building.name)}
                <option value={building.name}>{building.name}</option>
              {/each}
            </select>
          </label>
          <label>
            <span class="field-label">Negative structure</span>
            <select bind:value={newBuildingNegative}>
              <option value="">None</option>
              {#each buildingsCatalog as building (building.name)}
                <option value={building.name}>{building.name}</option>
              {/each}
            </select>
          </label>
        </div>

        <label class="field-label">Department scores</label>
        <div class="score-grid">
          {#each DEPARTMENTS as department (department)}
            <label class="score-item">
              <span>{department}</span>
              <input
                type="number"
                value={newBuildingScores[department]}
                on:input={(event) => updateNewBuildingScore(department, event.currentTarget.value)}
              />
            </label>
          {/each}
        </div>

        <button type="button" class="secondary" on:click={addBuilding}>Add Building</button>
      </section>
    {/if}

    <section class="panel actions">
      <button type="button" on:click={() => (showScoreModal = true)}>Open Score Summary</button>
      <button type="button" class="secondary" on:click={downloadPlanJson}>Download Plan JSON</button
      >
      <button type="button" class="secondary" on:click={triggerLoadPlanJson}>Load Plan JSON</button>
      <input
        bind:this={planFileInput}
        class="hidden-file-input"
        type="file"
        accept="application/json"
        on:change={loadPlanJson}
      />
      <button type="button" class="secondary" on:click={toggleBuildingsVisibility}
        >{showBuildings ? 'Hide Buildings' : 'Show Buildings'}</button
      >
      <button type="button" class="secondary" on:click={clearPlan}>Clear Plan</button>
      {#if placementMode}
        <button type="button" class="secondary" on:click={() => cancelPlacement()}
          >Cancel Placement</button
        >
      {/if}
      <p class="status">{statusMessage}</p>
      <p class="hint">
        Shortcuts: R rotates while placing. Delete/Backspace removes selected building.
      </p>
    </section>

    {#if issues.length > 0}
      <section class="panel warnings">
        <h2>CSV Warnings</h2>
        <ul>
          {#each issues as issue, index (`${issue}-${index}`)}
            <li>{issue}</li>
          {/each}
        </ul>
      </section>
    {/if}
  </aside>

  <section class="workspace">
    <div class="board {placementMode ? 'placing' : ''}" data-grid-root="true">
      <div class="zoning-grid" on:mouseleave={() => (hoveredCell = null)}>
        {#each rowIndices as row (row)}
          {#each colIndices as col (col)}
            {@const previewing = previewCellKeys.has(cellKey(row, col))}
            {@const rectActive =
              editorMode === 'zone' && zoningPaintMode === 'rectangle' && !placementMode}
            {@const isRectStart =
              rectActive && rectangleStart?.row === row && rectangleStart?.col === col}
            {@const isRectHover =
              rectActive && hoveredCell?.row === row && hoveredCell?.col === col}
            <button
              type="button"
              class="cell {previewing
                ? placementPreview?.ok
                  ? 'preview-valid'
                  : 'preview-invalid'
                : ''} {isRectStart ? 'rect-start' : ''} {isRectHover ? 'rect-hover' : ''}"
              style={`--zone-color: ${zoneColors[zonesGrid[row][col]] ?? '#e5e7eb'}`}
              on:mouseenter={() => (hoveredCell = { row, col })}
              on:focus={() => (hoveredCell = { row, col })}
              on:click={() => handleCellClick(row, col)}
              title={`(${row + 1}, ${col + 1}) ${zonesGrid[row][col]}`}
            />
          {/each}
        {/each}
      </div>

      {#if !placementMode}
        <div class="zone-labels-layer">
          {#each zoneRegions as region (region.id)}
            <span
              class="zone-region-label"
              style={`grid-column: ${region.labelCol + 1}; grid-row: ${region.labelRow + 1};`}
            >
              {region.zone}
            </span>
          {/each}
        </div>
      {/if}

      {#if showBuildings}
        <div class="buildings-layer">
          {#each placements as placement (placement.id)}
            <article
              class="placed-building {selectedPlacementId === placement.id ? 'selected' : ''}"
              tabindex="0"
              style={`grid-column: ${placement.col + 1} / span ${placement.footprint.width}; grid-row: ${placement.row + 1} / span ${placement.footprint.height}; --building-fill: ${placement.fillColor}; --building-border: ${placement.borderColor}; --building-text: ${placement.textColor};`}
              on:click|stopPropagation={() => selectPlacement(placement.id)}
              on:keydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  selectPlacement(placement.id)
                }
              }}
            >
              <div class="placed-building-content">
                <span class="placed-building-name">{placement.name}</span>
                <button
                  type="button"
                  class="remove-building"
                  on:click|stopPropagation={() => removePlacement(placement.id)}
                >
                  Remove
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </section>
</main>

{#if showScoreModal}
  <div class="modal-backdrop" role="presentation" on:click={() => (showScoreModal = false)}>
    <section
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Score summary"
      on:click|stopPropagation
    >
      <header>
        <h2>Department Score Summary</h2>
        <button type="button" class="secondary" on:click={() => (showScoreModal = false)}
          >Close</button
        >
      </header>

      <p class="hint">
        Positive and negative structure modifiers apply only when buildings are orthogonally
        adjacent.
      </p>

      <table>
        <thead>
          <tr>
            <th>Department</th>
            <th>Base</th>
            <th>Adjusted</th>
          </tr>
        </thead>
        <tbody>
          {#each DEPARTMENTS as department (department)}
            <tr>
              <td>{department}</td>
              <td>{formatScore(scoreSummary.baseScores[department])}</td>
              <td>{formatScore(scoreSummary.adjustedScores[department])}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  </div>
{/if}

{#if showDataModal}
  <div class="modal-backdrop" role="presentation" on:click={() => (showDataModal = false)}>
    <section
      class="modal wide"
      role="dialog"
      aria-modal="true"
      aria-label="Manage zones and buildings"
      on:click|stopPropagation
    >
      <header>
        <h2>Manage Zones &amp; Buildings</h2>
        <button type="button" class="secondary" on:click={() => (showDataModal = false)}
          >Close</button
        >
      </header>

      <h3>Zones</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Color</th>
            <th>Cells</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each zones as zone (zone)}
            <tr>
              <td>
                <input
                  type="text"
                  value={zone}
                  on:change={(event) => renameZone(zone, event.currentTarget.value)}
                />
              </td>
              <td>
                <input
                  type="color"
                  value={zoneColors[zone] ?? '#e5e7eb'}
                  on:input={(event) => setZoneColor(zone, event.currentTarget.value)}
                />
              </td>
              <td
                >{zoneRegions.reduce(
                  (sum, region) => (region.zone === zone ? sum + region.size : sum),
                  0
                )}</td
              >
              <td>
                <button
                  type="button"
                  class="danger-button"
                  disabled={zone === DEFAULT_ZONE}
                  on:click={() => deleteZone(zone)}
                >
                  Delete
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>

      <h3>Buildings</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>W</th>
            <th>H</th>
            <th>Allowed zones</th>
            <th>Positive</th>
            <th>Negative</th>
            <th>Scores</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each buildingsCatalog as building (building.name)}
            <tr>
              <td>
                <input
                  type="text"
                  value={building.name}
                  on:change={(event) => renameBuilding(building.name, event.currentTarget.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="1"
                  max={GRID_COLS}
                  value={building.footprints[0]?.width ?? 1}
                  on:change={(event) =>
                    updateBuildingFootprint(building.name, 'width', event.currentTarget.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="1"
                  max={GRID_ROWS}
                  value={building.footprints[0]?.height ?? 1}
                  on:change={(event) =>
                    updateBuildingFootprint(building.name, 'height', event.currentTarget.value)}
                />
              </td>
              <td>
                <div class="zone-checkboxes">
                  {#each ['Any', ...zones.filter((zone) => zone !== 'Any')] as zoneOption (zoneOption)}
                    <label class="checkbox-item">
                      <input
                        type="checkbox"
                        checked={building.allowedZones.includes(zoneOption)}
                        on:change={(event) =>
                          toggleBuildingAllowedZone(
                            building.name,
                            zoneOption,
                            event.currentTarget.checked
                          )}
                      />
                      <span>{zoneOption}</span>
                    </label>
                  {/each}
                </div>
              </td>
              <td>
                <select
                  value={building.positiveStructure ?? ''}
                  on:change={(event) =>
                    updateBuildingStructure(
                      building.name,
                      'positiveStructure',
                      event.currentTarget.value
                    )}
                >
                  <option value="">None</option>
                  {#each buildingsCatalog as option (option.name)}
                    <option value={option.name}>{option.name}</option>
                  {/each}
                </select>
              </td>
              <td>
                <select
                  value={building.negativeStructure ?? ''}
                  on:change={(event) =>
                    updateBuildingStructure(
                      building.name,
                      'negativeStructure',
                      event.currentTarget.value
                    )}
                >
                  <option value="">None</option>
                  {#each buildingsCatalog as option (option.name)}
                    <option value={option.name}>{option.name}</option>
                  {/each}
                </select>
              </td>
              <td>
                <details>
                  <summary>Edit</summary>
                  <div class="score-edit-grid">
                    {#each DEPARTMENTS as department (department)}
                      <label class="score-item">
                        <span>{department}</span>
                        <input
                          type="number"
                          value={building.departmentScores[department] ?? 0}
                          on:change={(event) =>
                            updateBuildingScore(
                              building.name,
                              department,
                              event.currentTarget.value
                            )}
                        />
                      </label>
                    {/each}
                  </div>
                </details>
              </td>
              <td>
                <button
                  type="button"
                  class="danger-button"
                  on:click={() => deleteBuilding(building.name)}
                >
                  Delete
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  </div>
{/if}
