export interface PageHandle {
  show(): void | Promise<void>;
  hide(): void;
  reloadPattern?(): void;
}

export interface PageDeps {
  studio: import('../core/patterns').PatternStudio;
  settings: import('../config').SimSettings;
  onPatternChange: () => void;
}
