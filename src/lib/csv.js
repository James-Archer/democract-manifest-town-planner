import Papa from 'papaparse'
import { DEPARTMENTS, NULL_LIKE_VALUES, STRUCTURE_RULE_TEXT, ZONES } from './config'

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
}

function isNullLike(value) {
  return NULL_LIKE_VALUES.has(normalizeText(value).toLowerCase())
}

function parseFootprintToken(token) {
  const normalized = normalizeText(token)
  const match = normalized.match(/^(\d+)\s*x\s*(\d+)$/i)
  if (!match) {
    return null
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
    label: `${Number(match[1])}x${Number(match[2])}`,
  }
}

function parseFootprints(footprint) {
  const parsed = parseFootprintToken(footprint)
  if (parsed) {
    return [parsed]
  }

  return [{ width: 1, height: 1, label: '1x1' }]
}

function parseStructureValue(value) {
  const normalized = normalizeText(value)
  if (isNullLike(normalized)) {
    return null
  }
  return normalized
}

function parseDepartmentScores(row) {
  const scores = {}
  for (const department of DEPARTMENTS) {
    const raw = normalizeText(row[department])
    const value = Number.parseInt(raw, 10)
    scores[department] = Number.isNaN(value) ? 0 : value
  }
  return scores
}

function parseAllowedZones(row) {
  const zones = [normalizeText(row['Zone 1']), normalizeText(row['Zone 2'])].filter(
    (zone) => zone.length > 0 && !isNullLike(zone)
  )

  return [...new Set(zones)]
}

export function parseBuildingsCsv(csvText) {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
    transform: (value) => normalizeText(value),
  })

  const issues = []
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      issues.push(`CSV parse error (row ${error.row}): ${error.message}`)
    }
  }

  const buildings = parsed.data.map((row, index) => {
    const name = normalizeText(row.Building)
    const footprints = parseFootprints(row.Footprint)
    const allowedZones = parseAllowedZones(row)

    if (!name) {
      issues.push(`Row ${index + 2} has no building name`)
    }

    return {
      id: `building-${index + 1}`,
      name,
      allowedZones,
      footprints,
      departmentScores: parseDepartmentScores(row),
      positiveStructure: parseStructureValue(row['Positive Structure']),
      negativeStructure: parseStructureValue(row['Negative Structure']),
      imageName: normalizeText(row['Image Name']) || null,
    }
  })

  const buildingNames = new Set(buildings.map((building) => building.name))

  for (const building of buildings) {
    if (
      building.positiveStructure &&
      building.positiveStructure !== STRUCTURE_RULE_TEXT &&
      !buildingNames.has(building.positiveStructure)
    ) {
      issues.push(
        `Positive structure reference not found for ${building.name}: ${building.positiveStructure}`
      )
    }

    if (
      building.negativeStructure &&
      building.negativeStructure !== STRUCTURE_RULE_TEXT &&
      !buildingNames.has(building.negativeStructure)
    ) {
      issues.push(
        `Negative structure reference not found for ${building.name}: ${building.negativeStructure}`
      )
    }

    for (const zone of building.allowedZones) {
      if (!ZONES.includes(zone)) {
        issues.push(`Unknown zone value for ${building.name}: ${zone}`)
      }
    }
  }

  const buildingsByName = Object.fromEntries(buildings.map((building) => [building.name, building]))

  return {
    buildings,
    buildingsByName,
    issues,
  }
}
