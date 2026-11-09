import { ArchEntity, BaseEntity } from '../types/model';

export type WindowOperation =
  | 'Fixed'
  | 'Single Hung'
  | 'Double Hung'
  | 'Casement Left'
  | 'Casement Right'
  | 'Sliding'
  | 'Awning';

export type GlassType = 'Single' | 'Double' | 'Triple';

export interface WindowTypeDefinition {
  id: string;
  name: string;
  width: number;       // default width in inches (e.g. 48" = 1200mm)
  height: number;      // default height in inches (e.g. 60" = 1500mm)
  sillHeight: number;  // default sill height in inches (e.g. 36" = 900mm)
  frameWidth: number;  // inches (e.g. 2.4" ~ 60mm)
  frameDepth: number;  // inches (e.g. 3.5" ~ 90mm)
  sashWidth: number;   // inches (e.g. 2.0" ~ 50mm)
  mullionWidth: number;// inches (e.g. 1.6" ~ 40mm)
  operation: WindowOperation;
  glass: GlassType;
  glassThickness: number; // inches (e.g. 0.25")
  glassTint: string;      // hex color
  glassTransparency: number; // 0..1
  muntinRows: number;
  muntinCols: number;
  muntinWidth: number;
  eqSpacing: boolean;     // EQ toggle for muntin/sash redistribution
  frameMaterial: string;
  sashMaterial: string;
  sillMaterial: string;
  glassMaterial: string;
}

export interface WindowInstanceEntity extends BaseEntity {
  type: 'window';
  windowTypeId: string;
  wallId: string;
  offset: number;         // parametric 0..1 along host wall
  width: number;          // instance override
  height: number;         // instance override
  sillHeight: number;     // instance override
  flipHand: boolean;      // mirror swing left/right
  flipFacing: boolean;    // mirror interior/exterior facing
  mark: string;           // auto-numbered e.g. W1, W2
  comments: string;
  lockedDims?: {
    distToStart?: number; // locked distance to wall start
    locked?: boolean;
  };
  showRefPlanes?: boolean;
  isOpen?: boolean;       // for operation animation
}

export function createDefaultWindowTypes(): WindowTypeDefinition[] {
  return [
    {
      id: 'wt-win-fixed-600',
      name: 'Fixed 600x600',
      width: 24,       // 600mm
      height: 24,      // 600mm
      sillHeight: 36,  // 900mm
      frameWidth: 2.4,
      frameDepth: 3.5,
      sashWidth: 2.0,
      mullionWidth: 1.6,
      operation: 'Fixed',
      glass: 'Double',
      glassThickness: 0.25,
      glassTint: '#38bdf8',
      glassTransparency: 0.4,
      muntinRows: 1,
      muntinCols: 1,
      muntinWidth: 1.0,
      eqSpacing: true,
      frameMaterial: '#1c1917',
      sashMaterial: '#292524',
      sillMaterial: '#78716c',
      glassMaterial: '#38bdf8',
    },
    {
      id: 'wt-win-doublehung-1200',
      name: 'Double Hung 1200x1500',
      width: 48,       // 1200mm
      height: 60,      // 1500mm
      sillHeight: 36,  // 900mm
      frameWidth: 2.4,
      frameDepth: 3.5,
      sashWidth: 2.0,
      mullionWidth: 1.6,
      operation: 'Double Hung',
      glass: 'Double',
      glassThickness: 0.25,
      glassTint: '#38bdf8',
      glassTransparency: 0.4,
      muntinRows: 2,
      muntinCols: 2,
      muntinWidth: 1.0,
      eqSpacing: true,
      frameMaterial: '#f5f5f4',
      sashMaterial: '#e7e5e4',
      sillMaterial: '#a8a29e',
      glassMaterial: '#38bdf8',
    },
    {
      id: 'wt-win-sliding-1800',
      name: 'Sliding 1800x1200',
      width: 72,       // 1800mm
      height: 48,      // 1200mm
      sillHeight: 36,  // 900mm
      frameWidth: 2.4,
      frameDepth: 3.5,
      sashWidth: 2.0,
      mullionWidth: 1.6,
      operation: 'Sliding',
      glass: 'Double',
      glassThickness: 0.25,
      glassTint: '#38bdf8',
      glassTransparency: 0.4,
      muntinRows: 1,
      muntinCols: 2,
      muntinWidth: 1.0,
      eqSpacing: true,
      frameMaterial: '#334155',
      sashMaterial: '#475569',
      sillMaterial: '#64748b',
      glassMaterial: '#38bdf8',
    },
  ];
}
