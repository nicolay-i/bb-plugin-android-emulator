/** App chrome tokens, resolved by BB before crossing the iframe boundary. */
export const themeTokens = {
  surface:'--background', fg:'--foreground', muted:'--muted-foreground',
  line:'--border', stage:'--muted', popover:'--popover',
  'popover-fg':'--popover-foreground', field:'--background',
  hover:'--accent', blue:'--primary', 'on-blue':'--primary-foreground',
  active:'--accent', 'active-fg':'--accent-foreground',
} as const;
