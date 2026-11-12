export const API_DOC = `
## Runtime (what your script can use)
Your script is plain JavaScript (no import/require/fetch/Date/Math.random). These are in scope as globals:
- Canvas: S (S.c is the current 2D context, Skia via @napi-rs/canvas: fillRect, arc, roundRect, drawImage, createLinearGradient, clip, save/restore, setLineDash, globalAlpha, Path2D, letterSpacing). W=1080, H=1920. 24 fps.
- COL: { ink:'#0b0b0e', ink2:'#16161b', bone:'#ece8dc', lime:'#c8f751', coral:'#ff5b3a', dim:'#8c8c95', white:'#f6f4ee' }
- Easing: clamp(v,a=0,b=1), pr(t,a,d) progress of t through [a,a+d] 0..1, eo expo-out (house ease), eo3, eo4, ei4 (power4 in), eio, eb(p, s=1.7) back-out (stamps/markers only), mix(a,b,p)
- Fonts (family names): 'BrikX' (Bricolage Grotesque 800, display), 'BrikB' (700), 'MonoM'/'MonoB' (JetBrains Mono 500/700), 'SerifI' (Instrument Serif italic), 'Geist' (UI). Latin only; other scripts fall back.
- font(fam,size,ls), measure(str,fam,size,ls) -> px, fit(str,fam,maxW,max,min=20,ls) -> size, wrap(str,fam,size,maxW,ls) -> lines
- text(str,x,y,fam,size,color,{ls,align,alpha}) baseline-aligned
- rise(str,x,base,size,fam,color,t,t0,{dur,ls,align,dist,out,outDur}) masked rise-in at t0 (optional masked exit at 'out'); returns width
- riseChars(str,x,base,size,fam,color,t,t0,{step,dur,ls,align})
- rrect(x,y,w,h,r) path only (then S.c.fill()/stroke()); bg(color) fills the frame
- icon(name,x,y,size,prog,color,lw=2) Lucide line icon drawn on by prog 0..1. ICON_NAMES lists the available names.
- stroke(points,prog,color,lw,{dx,dy,close}) polyline draw-on; polyLen(points)
- mk(w,h,g=>{...}) offscreen canvas drawn once (inside it the global S.c is that canvas). Build sprites ONCE (lazily, module scope), never per frame.
- cover(img,k=1,fx=.5,fy=.5,box?) cover-fit image/video frame into box (default full frame) zoomed k about focus; contain(img,box) whole image, returns drawn rect; blurred(img) full-frame blurred+dimmed copy (cached)
- sourceGlyph(source,x,y,size,light), sourceChip(source,label,x,y,size=1.6,light) -> width
- DATA: the reel data object below (title, images, broll, words...).
Scene fn(t, lt, X): t = absolute seconds (match against word start times), lt = seconds since scene start.
X.vid() -> current frame (720x1280 canvas, already graded) of this scene's stock clip if the scene declared vid, else null. Draw with cover(X.vid(), k).
X.img(i) -> decoded DATA.images[i] (or null). X.backdrop(i) = blurred(X.img(i)).

## Engine (done for you, do not draw these)
- Header at y 150-300: scene progress segments, source chip, reelset wordmark. Keep y < 310 empty.
- Captions: if a scene has cap:true the engine draws karaoke captions of the narration at baseline y=1530 (keep y 1420-1600 clear of important content). Use cap:false only when your scene's big type IS the spoken words.
- Phone UI covers y > 1600 and the right 150 px: keep text and key shapes inside x 96..929, y 310..1600.
- Seams between scenes: the engine pushes the outgoing scene left and the next one in (cut-the-curve). One scene may set exit:'up' (the reserved vector, for the conclusion).
- Grain, vignette and audio are added by the engine.

## Output contract
Return ONE \`\`\`js block: a script that defines helpers/sprites and ends with
  return [ { t0, t1, fn, cap, tone, vid, exit? }, ... ]
- Scenes are contiguous, sorted, first t0 = 0, last t1 = DATA.duration; 6-12 scenes, each about 2-6 s, cut on narration beats (word start times).
- tone: 'ink' (dark), 'bone' (light paper) or 'lime' page: the engine colors header/captions to match.
- vid: { clip: <index into DATA.broll>, grade: 'lime'|'warm'|'dim'|'none' } or null.
- fn must never throw: guard every image/video (they may be null). Keep per-frame work cheap (a 1-vCPU box renders this): no per-frame mk()/createCanvas, no filter blur, shadowBlur only on sprites.
`

export const KIT_NAMES = [
  'S',
  'W',
  'H',
  'COL',
  'clamp',
  'pr',
  'eo',
  'eo3',
  'eo4',
  'ei4',
  'eio',
  'eb',
  'mix',
  'font',
  'measure',
  'fit',
  'wrap',
  'text',
  'rise',
  'riseChars',
  'rrect',
  'bg',
  'icon',
  'ICON_NAMES',
  'stroke',
  'polyLen',
  'mk',
  'cover',
  'contain',
  'blurred',
  'sourceGlyph',
  'sourceChip',
  'Path2D',
] as const
