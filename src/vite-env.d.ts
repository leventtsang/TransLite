/// <reference types="vite/client" />

import type { BlurayApi } from './shared/blurayTypes';

declare global {
  interface Window {
    bluray: BlurayApi;
  }
}

export {};
