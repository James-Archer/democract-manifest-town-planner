export const GRID_ROWS = 20
export const GRID_COLS = 20

export const DEPARTMENTS = [
  'Parks and Rec',
  'Health',
  'Transportation',
  'Library',
  'Police',
  'Fire',
  'Education',
  'Animal Control',
  'Business',
  'Resident',
]

export const ZONES = [
  'Any',
  'Residential',
  'Commercial',
  'Industrial',
  'Park',
  'Mixed use',
  'Conservation',
]

export const DEFAULT_ZONE = 'Residential'

export const ZONE_COLORS = {
  Any: '#d1d5db',
  Residential: '#bfdbfe',
  Commercial: '#fde68a',
  Industrial: '#fecaca',
  Park: '#bbf7d0',
  'Mixed use': '#ddd6fe',
  Conservation: '#a7f3d0',
}

export const STRUCTURE_RULE_TEXT = 'All other mixed use buildings, when both are zoned as mixed use'

export const NULL_LIKE_VALUES = new Set(['', '0', 'null', 'none', 'n/a'])
