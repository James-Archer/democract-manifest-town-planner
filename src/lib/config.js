export const GRID_ROWS = 21
export const GRID_COLS = 21

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
  'High density residential',
  'Commercial',
  'Industrial',
  'Park',
  'Mixed use',
  'Conservation',
]

export const DEFAULT_ZONE = 'Residential'

export const ZONE_COLORS = {
  Any: '#d1d5db',
  Residential: '#ff5ca0',
  'High density residential': '#ee2d4b',
  Commercial: '#f5e15e',
  Industrial: '#22a0d0',
  Park: '#bde34c',
  'Mixed use': '#ffa258',
  Conservation: '#36a321',
}

export const STRUCTURE_RULE_TEXT = 'All other mixed use buildings, when both are zoned as mixed use'

export const NULL_LIKE_VALUES = new Set(['', '0', 'null', 'none', 'n/a'])
