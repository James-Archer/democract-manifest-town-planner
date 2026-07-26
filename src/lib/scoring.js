import { DEPARTMENTS } from './config'
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

export function calculateDepartmentScores(placements) {
  const baseScores = Object.fromEntries(DEPARTMENTS.map((department) => [department, 0]))
  const adjustedScores = Object.fromEntries(DEPARTMENTS.map((department) => [department, 0]))

  for (const placement of placements) {
    const positiveActive = isStructureAdjacencyMet(
      placement,
      placement.positiveStructure,
      placements
    )
    const negativeActive = isStructureAdjacencyMet(
      placement,
      placement.negativeStructure,
      placements
    )

    let multiplier = 1
    if (positiveActive) {
      multiplier *= 2
    }
    if (negativeActive) {
      multiplier *= 0.5
    }

    for (const department of DEPARTMENTS) {
      const value = placement.departmentScores[department] ?? 0
      baseScores[department] += value
      adjustedScores[department] += value * multiplier
    }
  }

  return {
    baseScores,
    adjustedScores,
  }
}
