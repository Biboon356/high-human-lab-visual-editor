// All GLSL (WebGL2 / GLSL ES 3.00). Effects share a prelude; each effect body defines `vec4 effect(vec2 uv)`.
// Textures are premultiplied-alpha; src() un-premultiplies, emit() re-premultiplies.

export const VERT_QUAD = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.,1.); }`;

// Placed layer: a quad of half-size u_half (px) rotated/offset in pixel space.
export const VERT_LAYER = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
uniform vec2 u_res, u_half, u_offset; uniform float u_rot;
void main(){
  v_uv = a_pos*0.5+0.5;
  float c=cos(u_rot), s=sin(u_rot);
  vec2 p = a_pos*u_half; p = vec2(c*p.x - s*p.y, s*p.x + c*p.y) + u_offset;
  gl_Position = vec4(p/(u_res*0.5), 0., 1.);
}`;

export const FRAG_LAYER = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D u_tex; uniform float u_opacity;
void main(){ o = texture(u_tex, v_uv)*u_opacity; }`;

export const FRAG_BLIT = FRAG_LAYER;

const PRELUDE = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_time;
const vec3 FOREST = vec3(0.10, 0.36, 0.22);
vec4 src(vec2 uv){ vec4 c = texture(u_tex, uv); if(c.a > 1e-4) c.rgb /= c.a; return c; }
vec4 emit(vec3 rgb, float a){ return vec4(clamp(rgb,0.,1.)*a, a); }
float hash11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float a=.5, s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.7); a*=.5; } return s; }
float luma(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
vec3 hueRot(vec3 c, float deg){ float a=radians(deg), co=cos(a), si=sin(a);
  mat3 m = mat3(.299,.299,.299,.587,.587,.587,.114,.114,.114)
    + co*mat3(.701,-.299,-.300,-.587,.413,-.588,-.114,-.114,.886)
    + si*mat3(.168,.328,-.497,.330,.035,-.028,-.497,.292,-.806);
  return m*c; }
`;

const wrap = (body) => `${PRELUDE}\n${body}\nvoid main(){ o = effect(v_uv); }`;

export const EFFECT_FRAG = {
  glitch: wrap(`
uniform float u_amount, u_blocks, u_split, u_rate;
vec4 effect(vec2 uv){
  float tick = floor(u_time*u_rate);
  float rows = max(1., 1./u_blocks);
  float row = floor(uv.y*rows);
  float r = hash12(vec2(row, tick));
  float active_ = step(1.-u_amount*0.6, r);
  float shift = (hash12(vec2(row+11., tick)) - .5) * 2. * u_amount * .25 * active_;
  float colBlock = floor(uv.x*rows*.7);
  float blk = step(1.-u_amount*.25, hash12(vec2(colBlock,row+tick*3.)));
  vec2 p = uv + vec2(shift, 0.) + vec2(0., blk*(hash12(vec2(row,tick+4.))-.5)*u_blocks);
  float s = u_split * (0.4 + active_*2.2) * (0.3 + u_amount);
  vec4 a = src(p+vec2(s,0.)), g = src(p), b = src(p-vec2(s,0.));
  return emit(vec3(a.r, g.g, b.b), max(a.a, max(g.a, b.a)));
}`),
  grain: wrap(`
uniform float u_amount, u_size, u_color;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  vec2 px = floor(uv*u_res/u_size);
  float f = floor(u_time*24.);
  float n = hash12(px + f*37.1) - .5;
  vec3 cn = vec3(hash12(px+f*11.3+1.), hash12(px+f*7.7+2.), hash12(px+f*5.1+3.)) - .5;
  float l = luma(c.rgb);
  float k = u_amount * (1.1 - abs(l-.5));
  return emit(c.rgb + (n + cn*u_color*2.)*k, c.a);
}`),
  noise: wrap(`
uniform float u_amount, u_scale, u_speed, u_green;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  vec2 p = uv*vec2(u_res.x/u_res.y,1.)*u_scale;
  float n = fbm(p + vec2(u_time*u_speed, -u_time*u_speed*.6));
  n = smoothstep(.25,.85,n);
  vec3 tint = mix(vec3(n), mix(vec3(n), FOREST*2.2*n + n*.2, 1.), u_green);
  vec3 screen = 1. - (1.-c.rgb)*(1.-tint*u_amount);
  return emit(mix(c.rgb, screen, u_amount), c.a);
}`),
  distort: wrap(`
uniform float u_amount, u_freq, u_speed, u_angle;
vec4 effect(vec2 uv){
  float a = radians(u_angle);
  vec2 dir = vec2(cos(a), sin(a)), nrm = vec2(-dir.y, dir.x);
  float ph = dot(uv, dir)*u_freq*6.2831 + u_time*u_speed*6.2831;
  vec2 p = uv + nrm*sin(ph)*u_amount + dir*sin(ph*.7+1.3)*u_amount*.4;
  return src(p);
}`),
  fluid: wrap(`
uniform float u_amount, u_scale, u_speed;
vec4 effect(vec2 uv){
  vec2 p = uv*vec2(u_res.x/u_res.y,1.)*u_scale; float t = u_time*u_speed;
  vec2 q = vec2(fbm(p+vec2(0.,t)), fbm(p+vec2(5.2,1.3)-t));
  vec2 r = vec2(fbm(p+3.*q+vec2(1.7,9.2)+t*.5), fbm(p+3.*q+vec2(8.3,2.8)-t*.4));
  return src(uv + (r-.5)*2.*u_amount);
}`),
  blur: wrap(`
uniform float u_radius, u_mix;
vec4 effect(vec2 uv){
  vec4 base = src(uv);
  float r = u_radius * (u_res.y/1080.);
  if(r < .25) return texture(u_tex, uv);
  vec4 acc = vec4(0.); float wsum = 0.;
  const int N = 40;
  for(int i=0;i<N;i++){
    float fi = float(i)+.5;
    float rad = sqrt(fi/float(N)); float ang = fi*2.39996323;
    vec2 off = vec2(cos(ang), sin(ang))*rad*r/u_res;
    vec4 t = texture(u_tex, uv+off); acc += t; wsum += 1.;
  }
  vec4 b = acc/wsum;
  return mix(texture(u_tex, uv), b, u_mix);
}`),
  color: wrap(`
uniform float u_brightness, u_contrast, u_saturation, u_hue, u_tint, u_levels, u_invert;
vec4 effect(vec2 uv){
  vec4 c = src(uv); vec3 v = c.rgb;
  v = hueRot(v, u_hue);
  float l = luma(v); v = mix(vec3(l), v, u_saturation);
  v = (v-.5)*u_contrast + .5 + u_brightness;
  float l2 = clamp(luma(v),0.,1.);
  vec3 forest = mix(vec3(0.01,.04,.02), mix(FOREST*1.6, vec3(.92,1.,.94), pow(l2,2.2)), l2);
  v = mix(v, forest, u_tint);
  if(u_levels < 31.5) v = floor(clamp(v,0.,1.)*u_levels + .5)/u_levels;
  if(u_invert > .5) v = 1.-clamp(v,0.,1.);
  return emit(v, c.a);
}`),
  chroma: wrap(`
uniform float u_amount, u_radial, u_angle;
vec4 effect(vec2 uv){
  vec2 c = (uv-.5)*2.;
  vec2 lin = vec2(cos(radians(u_angle)), sin(radians(u_angle)));
  vec2 dir = mix(lin, c, u_radial) * u_amount;
  vec3 acc = vec3(0.), ws = vec3(0.); float a = 0.;
  const int N = 12;
  for(int i=0;i<N;i++){
    float t = float(i)/float(N-1);
    vec4 s = src(uv + dir*(t-.5)*2.);
    vec3 w = vec3(1.-t, 1.-abs(2.*t-1.), t);
    acc += s.rgb*w; ws += w; a = max(a, s.a);
  }
  return emit(acc/ws, a);
}`),
  bloom: wrap(`
uniform float u_threshold, u_intensity, u_radius;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float r = u_radius*(u_res.y/1080.);
  float rot = hash12(floor(gl_FragCoord.xy))*6.2831;
  vec3 acc = vec3(0.);
  const int N = 40;
  for(int i=0;i<N;i++){
    float fi = float(i)+.5; float rad = sqrt(fi/float(N)); float ang = fi*2.39996323 + rot;
    vec3 s = src(uv + vec2(cos(ang), sin(ang))*rad*r/u_res).rgb;
    float b = max(0., luma(s)-u_threshold)/max(1.-u_threshold, .05);
    acc += s*b;
  }
  return emit(c.rgb + acc/float(N)*u_intensity*3., c.a);
}`),
  glints: wrap(`
uniform float u_threshold, u_length, u_intensity, u_points, u_rotation, u_twinkle;
uniform vec3 u_tint;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float len = u_length*(u_res.y/1080.);
  float aspect = u_res.x/u_res.y;
  vec3 acc = vec3(0.);
  const int N = 16;
  for(int l=0;l<3;l++){
    if(float(l) >= u_points) break;
    float a = radians(u_rotation) + float(l)*3.14159265/u_points;
    vec2 dir = vec2(cos(a), sin(a));
    for(int sgn=0;sgn<2;sgn++){
      float sg = sgn==0 ? 1. : -1.;
      for(int i=1;i<=N;i++){
        float d = pow(float(i)/float(N), 1.6);
        vec2 q = uv + sg*dir*d*len/u_res;
        vec3 s = src(q).rgb;
        float b = max(0., luma(s)-u_threshold)/max(1.-u_threshold, .02);
        float ph = hash12(floor(q*vec2(26.*aspect, 26.)));
        float tw = 1. - u_twinkle*(.5+.5*sin(u_time*(3.+ph*5.)+ph*40.));
        float fall = (1.-d); fall *= fall;
        acc += b*fall*tw*mix(s, u_tint, .6)/float(N)*2.2;
      }
    }
  }
  return emit(c.rgb + acc*u_intensity, c.a);
}`),
  veins: wrap(`
uniform float u_mode, u_origin, u_growth, u_density, u_thickness, u_warp, u_flow, u_glow, u_seed, u_mix, u_cling;
uniform vec3 u_color;
// ridged, domain-warped noise: 1 on the crest of a vein, falling off to 0 either side
float vfield(vec2 p, float t){
  vec2 q = p + u_seed*3.7;
  vec2 w = vec2(fbm(q*.7 + vec2(0., t)), fbm(q*.7 + vec2(5.2, 1.3) - vec2(t, 0.)));
  q += (w-.5)*2.4*u_warp;
  float big = 1. - abs(2.*fbm(q*.9)-1.);
  float small = 1. - abs(2.*vnoise(q*3.1+13.)-1.);
  return max(pow(big, 2.2), .55*pow(small, 3.)*smoothstep(.2,.9,big));
}
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float asp = u_res.x/u_res.y;
  vec2 p = vec2(uv.x*asp, uv.y)*u_density*1.6;
  float t = u_time*.05*u_flow;
  float f = vfield(p, t);
  if(u_cling > .001){                                  // veins are drawn to the picture's own edges, so they read as part of the scene
    vec2 px1 = 1.5/u_res;
    float e = length(vec2(luma(src(uv+vec2(px1.x,0.)).rgb)-luma(src(uv-vec2(px1.x,0.)).rgb), luma(src(uv+vec2(0.,px1.y)).rgb)-luma(src(uv-vec2(0.,px1.y)).rgb)))*3.2;
    f = max(f, u_cling*smoothstep(.04, .35, e)*(.55 + .45*vnoise(p*2.+t)) * 1.15);
  }
  // growth front: a distance field from the chosen origin, roughened so it creeps rather than wipes
  float d;
  int o = int(u_origin + .5);
  if(o==0) d = 1.-uv.y; else if(o==1) d = uv.y; else if(o==2) d = uv.x; else if(o==3) d = 1.-uv.x;
  else if(o==4) d = length((uv-.5)*vec2(asp,1.))*1.15;
  else d = min(min(uv.x,1.-uv.x), min(uv.y,1.-uv.y))*2.;   // all edges: 0 at the frame edge, 1 in the middle
  float rough = fbm(p*.6+3.1);
  float reach = u_growth*1.45 - .08;
  float grown = smoothstep(reach, reach-.22, d + (rough-.5)*.45);
  float th = clamp(u_thickness, .02, .6);
  float line = smoothstep(1.-th, 1.-th*.35, f) * grown;
  // slope of the field = which way the vein wall faces; used to bend the picture through it
  const float h = .03;
  vec2 g = vec2(vfield(p+vec2(h,0.), t)-f, vfield(p+vec2(0.,h), t)-f)/h;
  float pulse = .5+.5*sin(d*18. - u_time*u_flow*3. + f*6.);
  vec3 outc = c.rgb;
  if(u_mode < .5){                                   // Glow: light drawn from the picture's own colour
    vec3 lit = mix(u_color, c.rgb*1.8+.1, .35);
    outc = c.rgb*(1.-.25*line) + lit*line*u_glow*(.55+.45*pulse);
  } else if(u_mode < 1.5){                           // Refract: the veins are glass lenses over the footage
    vec2 off = g*(.9*u_warp+.3)*grown*.0035*vec2(1./asp,1.);
    vec3 r = src(uv + off*(1.+line*3.)).rgb;
    float rim = smoothstep(.0,.6,line)*(.5+.5*pulse);
    outc = mix(c.rgb, r, grown*smoothstep(0.,.5,line+.25)) + u_color*rim*u_glow*.35;
  } else if(u_mode < 2.5){                           // Invert inside: the veins are negative-film cuts
    outc = mix(c.rgb, 1.-c.rgb, line);
    outc += u_color*smoothstep(.0,.2,line)*(1.-line)*u_glow*.4*pulse;
  } else {                                           // Cutout: the veins burn dark channels with a lit edge
    float edge = smoothstep(.3,.9,line)*(1.-smoothstep(.9,1.,line));
    outc = c.rgb*(1.-line*.92) + u_color*edge*u_glow*.8*(.6+.4*pulse);
  }
  return emit(mix(c.rgb, outc, u_mix), c.a);
}`),
  dither: wrap(`
uniform float u_palette, u_levels, u_size, u_mix;
uniform vec3 u_ink, u_paper;
float bayer8(vec2 p){
  vec2 q = floor(mod(p, 8.)); float v = 0.;
  for(int i=0;i<3;i++){
    vec2 b = mod(floor(q/exp2(float(i))), 2.);
    float m = b.x < .5 ? (b.y < .5 ? 0. : 3.) : (b.y < .5 ? 2. : 1.);
    v = v*4. + m;
  }
  return (v+.5)/64.;
}
vec3 pal(float t){
  if(u_palette < .5) return vec3(t);
  if(u_palette < 1.5){
    vec3 a = vec3(.059,.22,.059), b = vec3(.188,.384,.188), c = vec3(.545,.675,.059), d = vec3(.608,.737,.059);
    return t < .333 ? mix(a,b,t*3.) : t < .666 ? mix(b,c,(t-.333)*3.) : mix(c,d,(t-.666)*3.);
  }
  if(u_palette < 2.5) return mix(vec3(.05,.02,0.), vec3(1.,.69,0.), t);
  return mix(u_ink, u_paper, t);
}
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  vec2 cell = floor(gl_FragCoord.xy/max(1., u_size*(u_res.y/1080.)));
  float th = bayer8(cell) - .5;
  float L = max(2., u_levels) - 1.;
  vec3 outc;
  if(u_palette > 3.5){
    outc = floor((c.rgb + th/L)*L + .5)/L;
  } else {
    float q = floor((luma(c.rgb) + th/L)*L + .5)/L;
    outc = pal(clamp(q,0.,1.));
  }
  return emit(mix(c.rgb, outc, u_mix), c.a);
}`),
  holo: wrap(`
uniform float u_strength, u_scale, u_angle, u_warp, u_shimmer, u_pastel, u_sparkle;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float asp = u_res.x/u_res.y;
  vec2 p = vec2(uv.x*asp, uv.y);
  float a = radians(u_angle);
  vec2 dir = vec2(cos(a), sin(a));
  float l = luma(c.rgb);
  float w = fbm(p*1.7 + u_time*u_shimmer*.4) - .5;
  float h = dot(p, dir)*u_scale + w*u_warp*2.2 + l*1.6 + u_time*u_shimmer;
  vec3 foil = .5 + .5*cos(6.28318*(fract(h) + vec3(0., .33, .67)));
  foil = mix(foil, vec3(1.), u_pastel*.55);
  float mids = 1. - abs(l*2.-1.)*.7;                 // foil reads strongest in the mid-tones, like real film
  float body = .35 + .65*smoothstep(.02, .3, l);      // black stays mostly black; foil lives on the picture
  vec3 outc = c.rgb + ((foil - .5)*u_strength*(.35 + .9*mids) + foil*u_strength*.15*smoothstep(.5,1.,l))*body;
  float sp = hash12(floor(gl_FragCoord.xy/2.) + floor(u_time*8.));
  outc += u_sparkle*step(.9975, sp)*foil*1.5*(.4+l);
  return emit(outc, c.a);
}`),
  kaleido: wrap(`
uniform float u_segments, u_rotation, u_spin, u_zoom, u_cx, u_cy, u_mix;
vec4 effect(vec2 uv){
  float asp = u_res.x/u_res.y;
  vec2 p = (uv - vec2(u_cx,u_cy))*vec2(asp,1.);
  float r = length(p);
  float a = atan(p.y, p.x) + radians(u_rotation + u_spin*u_time);
  float seg = 6.28318/max(2., floor(u_segments + .5));
  a = abs(mod(a, seg) - seg*.5);                     // fold into one mirrored wedge
  vec2 q = vec2(cos(a), sin(a))*r/max(.05, u_zoom);
  vec2 s = vec2(q.x/asp, q.y) + vec2(u_cx,u_cy);
  s = abs(mod(s + 1., 2.) - 1.);                     // mirror-repeat so the sample never leaves the frame
  vec4 c = src(uv), k = src(s);
  return emit(mix(c.rgb, k.rgb, u_mix), c.a);
}`),
  spores: wrap(`
uniform float u_density, u_size, u_speed, u_glow, u_flicker, u_lit;
uniform vec3 u_color;
vec3 layer(vec2 p, float depth, float t){
  float sc = mix(5., 15., depth)*u_density;           // far layers: many small dots; near: few big soft ones
  vec2 q = p*sc + vec2(depth*17., -t*(.15+depth*.5));
  vec2 id = floor(q), f = fract(q);
  vec3 acc = vec3(0.);
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i), float(j)), cid = id + g;
    vec2 h = hash22(cid + depth*31.);
    float ph = hash12(cid*1.7 + depth);
    vec2 pos = g + .5 + (h-.5)*.7 + .18*vec2(sin(t*.9+ph*40.), cos(t*.7+ph*30.));
    float r = (.05 + .09*h.x)*u_size*mix(.7, 2.2, depth);
    float d = length(f - pos);
    float soft = mix(.35, 1.3, depth);
    float tw = 1. - u_flicker*(.5+.5*sin(t*(2.+ph*4.) + ph*50.));
    float on = step(.45, hash12(cid + 9.1*depth));     // only some cells hold a spore
    acc += on*tw*exp(-pow(d/(r*soft), 2.))*vec3(1.) * (.4+.6*h.y);
  }
  return acc;
}
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float asp = u_res.x/u_res.y, t = u_time*u_speed*3.;
  vec2 p = vec2(uv.x*asp, uv.y);
  vec3 s = layer(p, 0., t)*.7 + layer(p, .5, t)*.9 + layer(p, 1., t);
  float lit = mix(1., .25 + 1.6*luma(c.rgb), u_lit);   // spores catch the light that is already in the picture
  vec3 outc = c.rgb + s*u_color*u_glow*.55*lit;
  return emit(outc, c.a);
}`),
  cells: wrap(`
uniform float u_scale, u_lens, u_edge, u_glow, u_nucleus, u_drift, u_mix;
uniform vec3 u_color;
vec3 voro(vec2 p, float t){                            // returns F1, F2 and a cell id
  vec2 i = floor(p), f = fract(p);
  float d1 = 9., d2 = 9.; vec2 c1 = vec2(0.);
  for(int j=-1;j<=1;j++) for(int k=-1;k<=1;k++){
    vec2 g = vec2(float(k), float(j));
    vec2 o = hash22(i + g);
    o = .5 + .5*sin(t*u_drift + 6.2831*o);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if(d < d1){ d2 = d1; d1 = d; c1 = r; } else if(d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), hash12(c1*13.7+i));
}
vec4 effect(vec2 uv){
  vec4 c0 = src(uv);
  float asp = u_res.x/u_res.y;
  vec2 p = vec2(uv.x*asp, uv.y)*u_scale;
  vec2 i = floor(p);
  vec3 v = voro(p, u_time);
  // pull the picture toward each cell's centre: every cell is a little lens
  vec2 e = vec2(.02, 0.);
  vec2 grad = vec2(voro(p+e.xy, u_time).x - voro(p-e.xy, u_time).x, voro(p+e.yx, u_time).x - voro(p-e.yx, u_time).x)/(2.*e.x);
  vec2 s = uv - grad*u_lens*.035*vec2(1./asp, 1.)*(1.+.0*v.z);
  vec3 col = src(s).rgb;
  float edge = 1. - smoothstep(0., u_edge*2., v.y - v.x);
  float rim = smoothstep(.25, .75, v.x);               // cells are slightly darker toward their wall
  col *= 1. - .18*rim*u_lens;
  col += u_color*edge*u_glow*(.5 + .5*luma(col)*1.6);
  float nuc = 1. - smoothstep(.04, .13, v.x);
  col = mix(col, col*.55 + u_color*.35, nuc*u_nucleus*step(.5, v.z));
  return emit(mix(c0.rgb, col, u_mix), c0.a);
}`),
  hud: wrap(`
uniform float u_style, u_scale, u_rec, u_timecode, u_grid;
uniform vec3 u_color, u_alert;
float box(vec2 p, vec2 c, vec2 h){ vec2 d = abs(p - c) - h; return 1. - smoothstep(-.6, .6, max(d.x, d.y)); }
// 7-segment digit: bits a(top) b c d e f g(mid), drawn from boxes in a 6x10 cell
float seg7(vec2 p, int n){
  int m = n==0?63 : n==1?6 : n==2?91 : n==3?79 : n==4?102 : n==5?109 : n==6?125 : n==7?7 : n==8?127 : 111;
  float v = 0.;
  if((m&1)!=0)  v = max(v, box(p, vec2(3.,9.),  vec2(2.4,.7)));
  if((m&2)!=0)  v = max(v, box(p, vec2(5.5,7.),  vec2(.7,2.)));
  if((m&4)!=0)  v = max(v, box(p, vec2(5.5,3.),  vec2(.7,2.)));
  if((m&8)!=0)  v = max(v, box(p, vec2(3.,1.),  vec2(2.4,.7)));
  if((m&16)!=0) v = max(v, box(p, vec2(.5,3.),  vec2(.7,2.)));
  if((m&32)!=0) v = max(v, box(p, vec2(.5,7.),  vec2(.7,2.)));
  if((m&64)!=0) v = max(v, box(p, vec2(3.,5.),  vec2(2.4,.7)));
  return v;
}
float glyph(vec2 p, int g){                              // R, E, C as 5x7 bitmaps (one int per row, bit 4 = left)
  if(p.x < 0. || p.x >= 5. || p.y < 0. || p.y >= 7.) return 0.;
  int row = 6 - int(floor(p.y)), col = 4 - int(floor(p.x));
  int r;
  if(g==0){ int R[7] = int[7](30,17,17,30,20,18,17); r = R[row]; }
  else if(g==1){ int E[7] = int[7](31,16,16,30,16,16,31); r = E[row]; }
  else { int C[7] = int[7](14,17,16,16,16,17,14); r = C[row]; }
  return float((r >> col) & 1);
}
float digits(vec2 p, float val, int count){            // right-aligned run of digits, 8 units per digit
  float v = 0.;
  for(int k=0;k<4;k++){
    if(k >= count) break;
    float place = pow(10., float(count-1-k));
    int dgt = int(mod(floor(val/place), 10.));
    v = max(v, seg7(p - vec2(float(k)*8., 0.), dgt));
  }
  return v;
}
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float k = (u_res.y/1080.)*u_scale;
  vec2 P = (gl_FragCoord.xy)/k;                         // pixel space of a 1080p frame, y up
  vec2 R = u_res/k;
  vec3 col = vec3(0.); float a = 0.;
  float m = 60., arm = 70., th = 2.5;
  // corner brackets
  for(int ix=0;ix<2;ix++) for(int iy=0;iy<2;iy++){
    vec2 corner = vec2(ix==0 ? m : R.x-m, iy==0 ? m : R.y-m);
    vec2 sx = vec2(ix==0 ? 1. : -1., iy==0 ? 1. : -1.);
    a = max(a, box(P, corner + vec2(sx.x*arm*.5, 0.), vec2(arm*.5, th)));
    a = max(a, box(P, corner + vec2(0., sx.y*arm*.5), vec2(th, arm*.5)));
  }
  vec2 mid = R*.5;
  if(u_style < 1.5){
    // centre focus frame + cross ticks
    float ft = 1.;
    if(u_style > .5) ft = 2.;
    float fs = u_style < .5 ? 46. : 90.;
    vec2 d = abs(P - mid);
    float frame = u_style < .5 ? step(max(d.x,d.y), fs+th)*step(fs-th, max(d.x,d.y)) * step(min(d.x,d.y), fs*.35) : 0.;
    a = max(a, frame);
    a = max(a, box(P, mid, vec2(12., th*.5))*step(u_style, .5)); a = max(a, box(P, mid, vec2(th*.5, 12.))*step(u_style, .5));
    if(u_style > .5){                                    // target lock: rotating square with notches and range ticks
      float rot = u_time*.8;
      vec2 q = mat2(cos(rot), -sin(rot), sin(rot), cos(rot))*(P - mid);
      vec2 dq = abs(q);
      float sq = step(max(dq.x,dq.y), fs+th)*step(fs-th, max(dq.x,dq.y))*step(min(dq.x,dq.y), fs*.55);
      a = max(a, sq);
      a = max(a, box(P, mid, vec2(26., th*.5))*.9); a = max(a, box(P, mid, vec2(th*.5, 26.))*.9);
      for(int t=0;t<5;t++) a = max(a, box(P, vec2(R.x-m-8., mid.y - 80. + float(t)*40.), vec2(float(t==2?18:10), 1.5)));
    }
  }
  // thirds grid (faint)
  float g = 0.;
  for(int t=1;t<3;t++){
    g = max(g, box(P, vec2(R.x*float(t)/3., R.y*.5), vec2(.7, R.y*.5)));
    g = max(g, box(P, vec2(R.x*.5, R.y*float(t)/3.), vec2(R.x*.5, .7)));
  }
  col = u_color*a;
  vec3 outc = c.rgb + col + u_color*g*u_grid;
  if(u_style < 1.5){
    float blink = step(.5, fract(u_time*.9));
    if(u_rec > .5){                                      // REC dot (blinking) or PLAY triangle
      vec2 rp = vec2(m + 6., R.y - m - 40.);
      float dot_ = (1. - smoothstep(13., 15., length(P - rp - vec2(14.,14.))))*blink;
      outc = mix(outc, u_alert, dot_);
      float bars = 0.;                                    // 'REC' in a 5x7 pixel face
      vec2 gp = (P - (rp + vec2(40., 2.)))/4.2;
      bars = max(glyph(gp, 0), max(glyph(gp - vec2(6.,0.), 1), glyph(gp - vec2(12.,0.), 2)));
      outc = mix(outc, u_color, bars);
    }
    if(u_timecode > .5){                                  // MM:SS:FF counting up with the clip's own time
      float t = u_time, mm = floor(t/60.), ss = floor(mod(t,60.)), ff = floor(fract(t)*30.);
      vec2 o = vec2(R.x - m - 6.*8. - 7.*8. - 30., R.y - m - 34.);
      vec2 q = (P - o)/1.55;
      float dg = max(digits(q, mm, 2), max(digits(q - vec2(24.,0.), ss, 2), digits(q - vec2(48.,0.), ff, 2)));
      dg = max(dg, max(box(q, vec2(19.,6.), vec2(.9,.9)), max(box(q, vec2(19.,3.5), vec2(.9,.9)), max(box(q, vec2(43.,6.), vec2(.9,.9)), box(q, vec2(43.,3.5), vec2(.9,.9))))));
      outc = mix(outc, u_color, dg);
    }
  }
  return emit(outc, c.a);
}`),
  film: wrap(`
uniform float u_grain, u_halation, u_contrast, u_lift, u_vignette, u_weave;
vec4 effect(vec2 uv){
  float f = floor(u_time*24.);
  vec2 p = uv + (vec2(hash11(f), hash11(f+7.))-.5)*u_weave*.004;
  vec4 c = src(p); vec3 col = c.rgb;
  float r = 16.*(u_res.y/1080.);
  float rot = hash12(floor(gl_FragCoord.xy)+f)*6.2831;
  vec3 h = vec3(0.);
  const int N = 28;
  for(int i=0;i<N;i++){
    float fi = float(i)+.5; float rad = sqrt(fi/float(N)); float ang = fi*2.39996323 + rot;
    vec3 s = src(p + vec2(cos(ang), sin(ang))*rad*r/u_res).rgb;
    h += smoothstep(.5, 1., luma(s))*vec3(1., .5, .3);
  }
  col += h/float(N)*u_halation*3.2;
  col = mix(col, col*col*(3.-2.*clamp(col,0.,1.)), u_contrast);
  col = col*(1.-u_lift) + u_lift*.09;
  vec2 gp = floor(uv*u_res/1.3);
  float g = (hash12(gp+f*13.)+hash12(gp*1.7+f*31.)+hash12(gp*.6+f*5.))/3. - .5;
  col += g*u_grain*.55*(1.25-abs(luma(col)-.5)*1.5);
  col *= 1. - u_vignette*smoothstep(.3,.95,length((uv-.5)*vec2(u_res.x/u_res.y,1.)));
  return emit(col, c.a);
}`),
  vhs: wrap(`
uniform float u_jitter, u_bleed, u_noise, u_tracking;
vec4 effect(vec2 uv){
  float t = u_time;
  float row = floor(uv.y*u_res.y/2.);
  float f30 = floor(t*30.);
  float band = fract(uv.y*.9 - t*.13);
  float bandMask = smoothstep(0.,.03,band)*(1.-smoothstep(.03,.11,band));
  float bot = smoothstep(.07,0.,uv.y);
  float x = uv.x + (hash12(vec2(row,f30))-.5)*u_jitter*.012
          + bandMask*u_tracking*.03*sin(uv.y*90.+t*25.)
          + bot*u_tracking*(hash12(vec2(row,floor(t*60.)))-.5)*.14;
  vec2 p = vec2(x, uv.y);
  vec4 s0 = src(p); float l = luma(s0.rgb);
  vec3 cs = vec3(0.);
  for(int i=-4;i<=4;i++) cs += src(p + vec2(float(i)*u_bleed/4., 0.)).rgb;
  cs /= 9.;
  vec3 col = vec3(l) + (cs - luma(cs))*1.15;
  float n = hash12(vec2(floor(uv.x*u_res.x/3.)+row*7., f30));
  col += (n-.5)*u_noise*.22 + (bandMask+bot)*u_tracking*n*.35;
  return emit(col, s0.a);
}`),
  mosh: wrap(`
uniform float u_amount, u_block, u_hold, u_smear;
vec4 effect(vec2 uv){
  float bs = u_block*(u_res.y/1080.);
  vec2 cell = floor(uv*u_res/bs);
  float tick = floor(u_time*u_hold);
  float act = step(1.-u_amount, hash12(cell*1.3 + tick*17.));
  vec2 v = (hash22(cell + tick*3.1)-.5)*2.*.14*act;
  v.y *= .6;
  vec4 acc = vec4(0.); float ws = 0.;
  const int N = 12;
  for(int i=0;i<N;i++){ float t = float(i)/float(N-1); float w = 1.-t*.65; acc += src(uv - v*t*u_smear)*w; ws += w; }
  vec4 r = acc/ws;
  return emit(r.rgb, r.a);
}`),
  halftone: wrap(`
uniform float u_size, u_angle, u_contrast, u_mix;
vec4 effect(vec2 uv){
  vec4 c0 = src(uv);
  float a = radians(u_angle); mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  float cell = u_size*(u_res.y/1080.);
  vec2 q = R*(uv*u_res)/cell; vec2 g = floor(q)+.5;
  vec2 centre = (transpose(R)*(g*cell))/u_res;
  vec4 s = src(centre);
  float l = clamp(luma(s.rgb)*u_contrast, 0., 1.);
  float d = length(fract(q)-.5);
  float rad = .72*sqrt(l);
  float aa = .75/cell*1.4;
  float dot_ = 1. - smoothstep(rad-aa, rad+aa, d);
  vec3 ht = s.rgb/max(luma(s.rgb),.05)*l*dot_;
  return emit(mix(c0.rgb, ht, u_mix), c0.a);
}`),
  pixel: wrap(`
uniform float u_size, u_mix;
vec4 effect(vec2 uv){
  float s = max(1., u_size*(u_res.y/1080.));
  vec2 p = (floor(uv*u_res/s)+.5)*s/u_res;
  return mix(texture(u_tex, uv), texture(u_tex, p), u_mix);
}`),
  shake: wrap(`
uniform float u_amount, u_speed, u_zoom, u_roll;
vec4 effect(vec2 uv){
  float t = u_time*u_speed; float asp = u_res.x/u_res.y;
  vec2 o = vec2(vnoise(vec2(t*3.,1.3))-.5, vnoise(vec2(t*3.,7.9))-.5)*2.*u_amount;
  float r = (vnoise(vec2(t*2.,3.1))-.5)*2.*radians(u_roll);
  vec2 c = (uv-.5)*vec2(asp,1.);
  c = vec2(cos(r)*c.x - sin(r)*c.y, sin(r)*c.x + cos(r)*c.y)/vec2(asp,1.);
  return src(c/u_zoom + .5 + o);
}`),
  flash: wrap(`
uniform float u_amount, u_rate, u_decay, u_hue, u_white;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float pulse = pow(1.-fract(u_time*u_rate), u_decay);
  vec3 hue = .5+.5*cos(6.2831*(u_hue+vec3(0.,.33,.67)));
  vec3 tint = mix(hue, vec3(1.), u_white);
  return emit(1.-(1.-c.rgb)*(1.-tint*pulse*u_amount), c.a);
}`),
  gradmap: wrap(`
uniform vec3 u_shadow, u_mid, u_high; uniform float u_midpos, u_contrast, u_mix;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float l = clamp((luma(c.rgb)-.5)*u_contrast+.5, 0., 1.);
  vec3 col = l < u_midpos ? mix(u_shadow, u_mid, l/u_midpos) : mix(u_mid, u_high, (l-u_midpos)/(1.-u_midpos));
  return emit(mix(c.rgb, col, u_mix), c.a);
}`),
  threshold: wrap(`
uniform vec3 u_ink, u_paper; uniform float u_level, u_soft, u_noise, u_invert;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  vec2 g = floor(gl_FragCoord.xy/max(1., u_res.y/1080.));
  float n = (hash12(g + floor(u_time*12.)*7.1) + hash12(g*.7 + 3.3) - 1.)*u_noise*.5;
  float t = smoothstep(u_level-u_soft, u_level+u_soft, luma(c.rgb)+n);
  if(u_invert > .5) t = 1.-t;
  return emit(mix(u_ink, u_paper, t), c.a);
}`),
  solarize: wrap(`
uniform float u_threshold, u_amount, u_rotate, u_hue;
vec4 effect(vec2 uv){
  vec4 c = src(uv); vec3 v = mix(c.rgb, c.rgb.gbr, u_rotate);
  vec3 sol = mix(v, 1.-v, step(vec3(u_threshold), v));
  v = hueRot(mix(v, sol, u_amount), u_hue);
  return emit(v, c.a);
}`),
  slices: wrap(`
uniform float u_bands, u_shift, u_black, u_rate, u_split;
vec4 effect(vec2 uv){
  float tick = floor(u_time*u_rate);
  float band = floor(uv.y*u_bands);
  float on = step(.45, hash12(vec2(band+31., tick)));
  float sh = (hash12(vec2(band, tick))-.5)*2.*u_shift*on;
  float blk = step(1.-u_black*.6, hash12(vec2(band+7., tick+3.)))*on;
  vec2 p = vec2(uv.x+sh, uv.y); float sp = u_split*on;
  vec4 a = src(p+vec2(sp,0.)), g = src(p), b = src(p-vec2(sp,0.));
  return emit(vec3(a.r, g.g, b.b)*(1.-blk), max(a.a, max(g.a, b.a)));
}`),
  mask: wrap(`
uniform float u_shape, u_x, u_y, u_size, u_aspect, u_rotate, u_feather, u_wobble, u_invert;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float asp = u_res.x/u_res.y;
  vec2 p = (uv-.5)*vec2(asp,1.) - vec2(u_x*asp*.5, u_y*.5);
  float r = radians(u_rotate); p = vec2(cos(r)*p.x + sin(r)*p.y, -sin(r)*p.x + cos(r)*p.y);
  p.x /= u_aspect;
  float d;
  if(u_shape < .5) d = length(p) - u_size;
  else if(u_shape < 1.5){ vec2 q = abs(p) - vec2(u_size*.85); float rr = u_size*.18; d = length(max(q+rr, 0.)) + min(max(q.x+rr, q.y+rr), 0.) - rr; }
  else if(u_shape < 2.5) d = (abs(p.x)+abs(p.y))*.7071 - u_size;
  else { float a = atan(p.y, p.x); float wob = vnoise(vec2(cos(a), sin(a))*1.7 + u_time*.35)*2.-1.; d = length(p) - u_size*(1. + u_wobble*wob*.55); }
  float f = max(u_feather*u_size, 1.5/u_res.y);
  float m = 1.-smoothstep(-f, f, d);
  m = mix(m, 1.-m, u_invert);
  return emit(c.rgb, c.a*m);
}`),
  outline: wrap(`
uniform vec3 u_ink; uniform float u_width, u_soft;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float r = u_width*(u_res.y/1080.);
  float mx = c.a;
  if(r > .25){
    for(int k=1;k<=3;k++){
      float rad = r*float(k)/3.;
      for(int i=0;i<24;i++){
        float ang = (float(i)+.5*float(k))/24.*6.2831853;
        mx = max(mx, texture(u_tex, uv + vec2(cos(ang), sin(ang))*rad/u_res).a);
      }
    }
  }
  float oa = smoothstep(0., mix(.5, .98, u_soft), mx);
  vec3 prem = c.rgb*c.a + u_ink*oa*(1.-c.a);
  return vec4(prem, c.a + oa*(1.-c.a));
}`),
  crt: wrap(`
uniform float u_scan, u_lines, u_bleed, u_curve, u_vignette, u_flicker;
vec4 effect(vec2 uv){
  vec2 cc = uv*2.-1.;
  cc *= 1. + u_curve*dot(cc,cc)*.5;
  vec2 p = cc*.5+.5;
  float inside = step(0.,p.x)*step(p.x,1.)*step(0.,p.y)*step(p.y,1.);
  float bl = u_bleed;
  vec4 a = src(p+vec2(bl,0.)), g = src(p), b = src(p-vec2(bl,0.));
  vec3 col = vec3(a.r, g.g, b.b);
  float sl = .5+.5*sin((p.y*u_lines + u_time*.5)*6.2831);
  col *= 1. - u_scan*(1.-sl)*.6;
  col *= 1. + (hash11(floor(u_time*60.))-.5)*u_flicker;
  float vg = 1. - u_vignette*dot(cc,cc)*.5;
  col *= vg;
  return emit(col*inside, g.a*inside);
}`),
};

export const GEN_FRAG = `${PRELUDE}
uniform float u_density, u_movement, u_distortion, u_thickness, u_glow, u_green, u_seed, u_transparent, u_growth, u_boil;
uniform int u_style;
float T;
vec2 warp(vec2 p, float t){
  vec2 q = vec2(fbm(p*.9+vec2(0.,t)+u_seed), fbm(p*.9+vec2(5.2,1.3)-t+u_seed));
  return p + (q-.5)*u_distortion*3.2;
}
vec2 vor(vec2 p){ vec2 ip=floor(p), fp=fract(p); float d1=8., d2=8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(i,j);
    vec2 h = hash22(ip+g); h = .5+.5*sin(T*u_movement*.8 + 6.2831*h);
    float d = length(g+h-fp); if(d<d1){ d2=d1; d1=d; } else if(d<d2) d2=d; }
  return vec2(d1,d2); }
// Crisp iso-line: f is zero on the line; fwidth turns it into a pixel distance, so widths stay constant on screen.
vec2 iso(float f, float wpx){
  float d = abs(f)/max(fwidth(f), 1e-5);
  return vec2(1.-smoothstep(wpx-.75, wpx+.75, d), d);
}
void main(){
  // "boil": quantise time and jitter the sample point like hand-drawn animation shot on twos/threes
  float step_ = u_boil > .5 ? floor(u_time*u_boil) : 0.;
  T = u_boil > .5 ? step_/u_boil : u_time;
  vec2 uv = v_uv; float asp = u_res.x/u_res.y;
  if(u_boil > .5) uv += (hash22(vec2(step_, 3.7))-.5)*.004;
  vec2 p = (uv-.5)*vec2(asp,1.)*u_density*3.;
  float t = T*u_movement*.35;
  float px = u_res.y/1080.;
  float W = max(.35, u_thickness*12.*px);
  float m = 0., dmin = 1e3;
  if(u_style == 0){ // roots: nested noise zero-sets = trunk, branch, hair
    vec2 w = warp(p, t);
    vec2 a = iso((fbm(w)-.5)*2., W);
    vec2 b = iso((fbm(w*2.3+vec2(7.1,3.3)+t*.5)-.5)*2., W*.62);
    vec2 c = iso((fbm(w*5.1+vec2(2.2,9.1)-t)-.5)*2., W*.4);
    m = max(a.x, max(b.x*.85, c.x*.65)); dmin = min(a.y, min(b.y, c.y));
  } else if(u_style == 1){ // topographic fluid contours
    vec2 w = warp(p*.7, t);
    float f = fbm(w + t*.4)*(5.+u_density*7.);
    float d = abs(fract(f+.5)-.5)/max(fwidth(f), 1e-5);
    m = 1.-smoothstep(W*.6-.75, W*.6+.75, d); dmin = d;
  } else if(u_style == 3){ // dust & scratches: specks and vertical scratches redrawn at 12 fps
    float f = floor(u_time*12.);
    vec2 g = floor(gl_FragCoord.xy/(2.*px));
    float k = 1. - .0045*u_density;
    float speck = step(k, hash12(g + f*13.1)) * (.5 + .5*hash12(g*1.7 + f));
    float sx = floor(gl_FragCoord.x/(1.6*px));
    float on = step(1.-.006*u_density, hash12(vec2(sx, f)));
    float y0 = hash12(vec2(sx, f+9.)), len = .1 + .5*hash12(vec2(sx, f+5.));
    float scratch = on * step(y0, uv.y) * step(uv.y, y0+len) * (.35 + .65*hash12(vec2(sx, f+1.)));
    float fibre = step(1.-.0012*u_density, hash12(floor(gl_FragCoord.xy/(5.*px)) + f*3.))*.8;
    m = clamp(max(speck, max(scratch, fibre)) * (.4 + u_thickness*3.), 0., 1.); dmin = 1e3;
  } else { // cell membrane: voronoi edges, two scales
    vec2 w = warp(p*.8, t*.5);
    vec2 v1 = vor(w*1.2); float e1 = v1.y - v1.x;
    vec2 v2 = vor(w*2.9+3.7); float e2 = v2.y - v2.x;
    float d1 = e1/max(fwidth(e1),1e-5)*.5, d2 = e2/max(fwidth(e2),1e-5)*.5;
    m = max(1.-smoothstep(W*.8-.75, W*.8+.75, d1), (1.-smoothstep(W*.45-.75, W*.45+.75, d2))*.6);
    dmin = min(d1, d2);
  }
  // growth front expands from the bottom-centre, ragged edge, bright tip
  float reveal0 = u_style == 3 ? 1. : 0.;
  float age = length((uv-vec2(.5,-.1))*vec2(asp,1.)) + (fbm(p*.6+u_seed)-.5)*.6;
  float g = u_growth*2.4 - age;
  float reveal = max(reveal0, smoothstep(0., .05, g));
  float tip = exp(-abs(g)*22.)*step(u_growth, .999);
  m *= reveal;
  float halo = exp(-dmin*.2/px)*u_glow*reveal;
  vec3 lineCol = mix(vec3(1.), vec3(.84,1.,.9), u_green*.5);
  vec3 glowCol = mix(vec3(.85), vec3(.16,.62,.36), u_green);
  vec3 col = m*lineCol + halo*glowCol*.5 + tip*m*vec3(.55,1.,.7)*1.4;
  col += FOREST*.16*u_green*fbm(p*.5 - t)*reveal;
  vec3 c = clamp(col, 0., 1.);
  if(u_transparent < .5) o = vec4(c, 1.);
  else o = vec4(c, max(c.r, max(c.g, c.b))); // premultiplied: colour never exceeds alpha
}`;
