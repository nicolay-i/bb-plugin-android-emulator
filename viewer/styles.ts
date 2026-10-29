/** Panel styles on BB theme tokens; every selector is scoped under `.bbae`. */
export const styles = `
.bbae{--line:var(--border);display:flex;flex-direction:column;height:100%;min-height:0;background:var(--background);color:var(--foreground);font-size:14px;position:relative}
.bbae *{box-sizing:border-box}
.bbae button,.bbae select,.bbae textarea{font:inherit;color:inherit}
.bbae button{cursor:pointer;border:0;background:transparent;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:36px;padding:0 10px}
.bbae button:hover:not(:disabled){background:var(--accent)}
.bbae button:disabled{opacity:.45;cursor:default}
.bbae button:focus-visible,.bbae select:focus-visible,.bbae textarea:focus-visible,.bbae-screen:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
.bbae button[aria-expanded=true]{background:var(--accent);color:var(--accent-foreground)}
.bbae svg{width:18px;height:18px;flex:none}
.bbae-header{display:flex;align-items:center;gap:2px;padding:6px 8px;border-bottom:1px solid var(--line);min-height:49px;flex:none;position:relative;z-index:2}
.bbae-chip{min-width:0;max-width:45%}
.bbae-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bbae-icon{width:40px;padding:0!important;color:var(--muted-foreground)}
.bbae-spacer{flex:1}
.bbae-dot{width:8px;height:8px;border-radius:50%;background:#a0a3a8;flex:none}
.bbae-dot.online{background:#2da44e}
.bbae-popover{position:absolute;top:52px;right:12px;width:min(366px,calc(100% - 24px));padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--popover);color:var(--popover-foreground);box-shadow:0 12px 32px #14141e29;z-index:3;display:flex;flex-direction:column;gap:10px}
.bbae-popover{transform-origin:top right;animation:bbae-pop .16s cubic-bezier(.2,.9,.3,1)}
.bbae-left{left:12px;right:auto;transform-origin:top left}
@keyframes bbae-pop{from{opacity:0;transform:translateY(-6px) scale(.97)}}
.bbae-chip span+svg{transition:transform .16s}
.bbae-chip[aria-expanded=true] span+svg{transform:rotate(180deg)}
@media (prefers-reduced-motion:reduce){.bbae-popover{animation:none}.bbae-chip span+svg{transition:none}}
.bbae-menu{width:240px;padding:6px;gap:0}
.bbae-menu button{justify-content:flex-start;width:100%}
.bbae-menu button[aria-current=true]{font-weight:600}
.bbae-label{font-size:12px;font-weight:600;color:var(--muted-foreground)}
.bbae select{width:100%;min-width:0;min-height:40px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--background)}
.bbae textarea{width:100%;min-height:88px;max-height:240px;resize:vertical;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--background);line-height:1.5}
.bbae form{display:flex;flex-direction:column;gap:10px}
.bbae-row{display:flex;align-items:center;gap:8px}
.bbae-hint{margin:0;font-size:12px;color:var(--muted-foreground)}
.bbae .bbae-primary{background:var(--primary);color:var(--primary-foreground);padding:0 14px;font-weight:500;flex:none}
.bbae .bbae-primary:hover:not(:disabled){background:color-mix(in srgb,var(--primary) 85%,var(--foreground))}
.bbae-confirm{margin:0;line-height:1.5}
.bbae .bbae-danger{background:#cf222e;color:#fff}
.bbae .bbae-danger:hover:not(:disabled){background:#a40e26}
.bbae-link{color:var(--primary);font-size:13px;min-height:24px!important}
.bbae-stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--muted);overflow:hidden}
.bbae-screen{max-width:100%;max-height:100%;border:5px solid #1f2023;border-radius:24px;background:#000;box-shadow:0 12px 32px #14141e2e;touch-action:none;cursor:default}
.bbae-empty{display:flex;flex-direction:column;align-items:center;gap:14px;max-width:420px;text-align:center}
.bbae-empty h1{font-size:18px;font-weight:600;margin:0}
.bbae-empty p{margin:0;color:var(--muted-foreground);line-height:1.5}
.bbae-empty-icon{width:56px;height:56px;display:flex;align-items:center;justify-content:center;border-radius:14px;background:var(--background);border:1px solid var(--line);color:var(--muted-foreground)}
.bbae-checks{text-align:left;width:100%}
.bbae-checks ul{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}
.bbae-checks li{display:flex;gap:10px;align-items:flex-start}
.bbae-checks li.ok svg{color:#2da44e}
.bbae-checks li.fail svg{color:#cf222e}
.bbae-checks p{margin:2px 0}
.bbae-checks code{display:block;font-size:11px;color:var(--muted-foreground);word-break:break-all}
.bbae-status{margin:0;padding:7px 12px;font-size:12px;line-height:1.4;color:var(--muted-foreground);background:var(--muted);flex:none}
.bbae-nav{display:flex;justify-content:center;padding:8px 12px 12px;background:var(--muted);flex:none}
.bbae-nav>div{display:flex;gap:4px;padding:4px;background:var(--background);border:1px solid var(--line);border-radius:12px}
.bbae-nav .bbae-icon{width:72px;color:var(--foreground)}
.bbae-nav svg{width:16px;height:16px}
`;
