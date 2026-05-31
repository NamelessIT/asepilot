/// <reference types="vite/client" />

import type { AsePilotApi } from '../shared/api';

declare global {
  interface Window {
    asepilot: AsePilotApi;
  }
}

export {};

