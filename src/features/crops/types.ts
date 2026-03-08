export interface DebugPanelParams {
  chainBoardWidth: number;
  autoDetectPanelWidth: boolean;
  panelWidthVoteTolerance: number;
  gridStartY: number;
  scanLineX: number;
  scanStartY: number;
  scanStableVarianceThresholdFactor: number;
  colorTolerance: number;
  sustainedPixels: number;
  colorToleranceX: number;
  sustainedPixelsX: number;
  boundsWindowHeight: number;
  boundsWindowWidth: number;
  boundsVarianceThresholdRow: number;
  boundsVarianceThresholdCol: number;
  boundsStepSize: number;
  boundsMinRowHeight: number;
  boundsMinColWidth: number;
  forceSquareIcons: boolean;
  forceSquareOffsetX: number;
  forceSquareOffsetY: number;
  filterEmptyIcons: boolean;
  emptyIconVarianceThreshold: number;
  useVisionFallback: boolean;
}

export interface DetectedPanel {
  title: string;
  ocrTitle?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  total?: number;
  imageUrl: string;
  blueBox: { x: number; y: number; width: number; height: number };
  greenBox: { x: number; y: number; width: number; height: number };
  redBoxes: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    iconIndex?: number;
    row?: number;
    col?: number;
  }>;
  horizontalVoteDebug?: {
    initial?: {
      candidateYs: number[];
      voteTolerance: number;
      startMedian: number;
      endMedian: number;
      robustStart: number;
      robustEnd: number;
      usedRobustResult: boolean;
      points: Array<{
        lineIdx: number;
        scanY: number;
        rawStartX: number;
        rawEndX: number;
        startX: number;
        endX: number;
        startInlier: boolean;
        endInlier: boolean;
      }>;
    };
    refined?: {
      candidateYs: number[];
      voteTolerance: number;
      startMedian: number;
      endMedian: number;
      robustStart: number;
      robustEnd: number;
      usedRobustResult: boolean;
      points: Array<{
        lineIdx: number;
        scanY: number;
        rawStartX: number;
        rawEndX: number;
        startX: number;
        endX: number;
        startInlier: boolean;
        endInlier: boolean;
      }>;
    };
  };
}

export interface CropConfirmModalProps {
  imageUrl: string;
  isOpen: boolean;
  onClose: () => void;
  onExport: (panels: DetectedPanel[]) => void | Promise<void>;
  autoCloseOnExport?: boolean;
  disableClose?: boolean;
  batchCurrent?: number;
  batchTotal?: number;
  batchCompletedImages?: number;
  batchCompletedChains?: number;
  batchCompletedIcons?: number;
  batchProcessingLabel?: string;
}
