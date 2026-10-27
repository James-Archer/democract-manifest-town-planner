import { DEPARTMENTS, STRUCTURE_RULE_TEXT } from './config'
import { arePlacementsOrthogonallyAdjacent } from './gridEngine'

function isStructureAdjacencyMet(sourcePlacement, targetBuildingName, placements) {
  if (!targetBuildingName) {
    return false
  }

  for (const candidate of placements) {
    if (candidate.id === sourcePlacement.id) {
      continue
    }
    if (candidate.name !== targetBuildingName) {
      continue
    }
    if (arePlacementsOrthogonallyAdjacent(sourcePlacement, candidate)) {
      return true
    }
  }

  return false
}

function isZonedMixedUse(placement, zonesGrid) {
  return placement.occupiedCells.every((cell) => zonesGrid?.[cell.row]?.[cell.col] === 'Mixed use')
}

function isMixedUseAdjacencyMet(sourcePlacement, placements, zonesGrid) {
  if (!isZonedMixedUse(sourcePlacement, zonesGrid)) {
    return false
  }

  for (const candidate of placements) {
    if (candidate.id === sourcePlacement.id) {
      continue
    }
    if (!isZonedMixedUse(candidate, zonesGrid)) {
      continue
    }
    if (arePlacementsOrthogonallyAdjacent(sourcePlacement, candidate)) {
      return true
    }
  }

  return false
}

function isStructureConditionMet(sourcePlacement, targetBuildingName, placements, zonesGrid) {
  if (targetBuildingName === STRUCTURE_RULE_TEXT) {
    return isMixedUseAdjacencyMet(sourcePlacement, placements, zonesGrid)
  }
  return isStructureAdjacencyMet(sourcePlacement, targetBuildingName, placements)
}

export function calculateDepartmentScores(placements, zonesGrid) {
  const baseScores = Object.fromEntries(DEPARTMENTS.map((department) => [department, 0]))
  const adjustedScores = Object.fromEntries(DEPARTMENTS.map((department) => [department, 0]))

  for (const placement of placements) {
    const positiveActive = isStructureConditionMet(
      placement,
      placement.positiveStructure,
      placements,
      zonesGrid
    )
    const negativeActive = isStructureConditionMet(
      placement,
      placement.negativeStructure,
      placements,
      zonesGrid
    )

    let multiplier = 1
    if (positiveActive) {
      multiplier *= 2
    }
    if (negativeActive) {
      multiplier *= 0.5
    }

    const footprintArea = (placement.footprint?.width ?? 1) * (placement.footprint?.height ?? 1)

    for (const department of DEPARTMENTS) {
      const value = (placement.departmentScores[department] ?? 0) * footprintArea
      baseScores[department] += value
      adjustedScores[department] += value * multiplier
    }
  }

  return {
    baseScores,
    adjustedScores,
  }
}
