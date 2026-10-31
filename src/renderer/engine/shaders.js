// All GLSL (WebGL2 / GLSL ES 3.00). Effects share a prelude; each effect body defines `vec4 effect(vec2 uv)`.
// Textures are premultiplied-alpha; src() un-premultiplies, emit() re-premultiplies.

export const VERT_QUAD = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.,1.); }`;

// Placed layer: a quad of half-size u_half (px) rotated/offset in pixel space.
export const VERT_LAYER = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
uniform vec2 u_res, u_half, u_offset, u_flip; uniform float u_rot, u_rx, u_ry, u_persp;
void main(){
  v_uv = a_pos*0.5+0.5;
  vec2 p = a_pos*u_half*u_flip;                       // flip mirrors the picture about its own centre
  if(u_rx != 0. || u_ry != 0.){                       // 3D: turn the plane about Y then tilt about X, then look at it through a camera
    vec3 q = vec3(p, 0.);
    float cy = cos(u_ry), sy = sin(u_ry), cx = cos(u_rx), sx = sin(u_rx);
    q = vec3(cy*q.x + sy*q.z, q.y, -sy*q.x + cy*q.z);
    q = vec3(q.x, cx*q.y - sx*q.z, sx*q.y + cx*q.z);
    p = q.xy * (u_persp / max(u_persp - q.z, u_persp*0.08));
  }
  float c=cos(u_rot), s=sin(u_rot);
  p = vec2(c*p.x - s*p.y, s*p.x + c*p.y) + u_offset;
  gl_Position = vec4(p/(u_res*0.5), 0., 1.);
}`;

export const FRAG_LAYER = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D u_tex, u_mask, u_matte; uniform float u_opacity, u_hasMask, u_maskInv, u_matteMode, u_matteInv; uniform vec2 u_res;
void main(){
  vec4 c = texture(u_tex, v_uv)*u_opacity;
  if(u_hasMask > .5 || u_matteMode > .5){                // mask / matte live in frame space, whatever the layer's own transform
    vec2 s = gl_FragCoord.xy/u_res; float m = 1.;
    if(u_hasMask > .5){ float a = texture(u_mask, s).a; m *= mix(a, 1.-a, u_maskInv); }
    if(u_matteMode > .5){ vec4 t = texture(u_matte, s); float a = clamp(u_matteMode < 1.5 ? t.a : dot(t.rgb, vec3(.2126,.7152,.0722)), 0., 1.); m *= mix(a, 1.-a, u_matteInv); }
    c *= m;
  }
  o = c;
}`;

export const FRAG_BLIT = FRAG_LAYER;

// Plain copy (used to keep a smaller picture of a frame for Memory Bleed).
export const FRAG_COPY = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D u_tex;
void main(){ o = texture(u_tex, v_uv); }`;

// Wet / dry between the picture that went into an effect (u_a) and what came out (u_b). Both are premultiplied, so a plain mix is right.
export const FRAG_WET = `#version 300 es
precision highp float; in vec2 v_uv; out vec4 o; uniform sampler2D u_a, u_b; uniform float u_w;
void main(){ o = mix(texture(u_a, v_uv), texture(u_b, v_uv), u_w); }`;

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
  // Memory Bleed. Two passes use this one program: pass 0 updates the memory (at the small history size), pass 1 lays the memory
  // over the present picture (full size). u_prev = the memory before this frame, u_new = after it, u_aux = the previous picture
  // (Scar), u_r0..u_r3 = Echo snapshots with u_ages their ages in seconds (< 0 = empty). The memory fades by time, not by frame count,
  // so a different frame rate looks the same.
  memory: wrap(`
uniform sampler2D u_prev, u_new, u_aux, u_r0, u_r1, u_r2, u_r3;
uniform float u_pass, u_first, u_dt, u_mode, u_blend, u_length, u_decay, u_intensity, u_rate, u_spread;
uniform vec4 u_ages;
vec4 fadeMem(vec4 m){
  m *= exp(-3.9*u_dt/max(.05, u_length));                       // 2% of it is left after u_length seconds
  float e = (.4 + 1.6*u_decay)/255. * u_dt*30.;                  // plus a straight fade, so the tail really ends (8-bit buffers would stall)
  float a = max(m.a - e, 0.);
  return vec4(m.rgb * (m.a > 1e-4 ? a/m.a : 0.), a);
}
vec4 blendMem(vec4 P, vec4 M){
  if(u_blend < .5) return P + M*(1.-P.a);                                         // behind the present
  if(u_blend < 1.5) return vec4(1.-(1.-P.rgb)*(1.-M.rgb), max(P.a, M.a));          // screen
  if(u_blend < 2.5) return vec4(min(P.rgb + M.rgb, 1.), max(P.a, M.a));            // add
  return vec4(abs(P.rgb - M.rgb), max(P.a, M.a));                                  // where the present departs from the memory
}
vec4 echoFrag(sampler2D s, float age, float i, vec2 uv, float pulse){
  if(age < 0.) return vec4(0.);
  vec2 cell = floor(uv * vec2(14. + (1.-u_spread)*18., 8. + (1.-u_spread)*10.));
  float show = step(.6, hash12(cell + i*17.3 + floor(u_time*u_rate)*3.1));        // about four blocks in ten return
  vec2 off = (hash22(cell + i*5.1) - .5) * .05 * u_spread;
  return texture(s, uv + off) * (show * exp(-3.9*age/max(.05, u_length)) * pulse);
}
vec4 effect(vec2 uv){
  vec4 P = texture(u_tex, uv);
  vec4 A = u_first > .5 ? vec4(0.) : texture(u_prev, uv);
  if(u_pass < .5){                                                                 // ---- update the memory
    if(u_mode < .5) return P + fadeMem(A)*(1.-P.a);                                // GHOST: the picture over its own faded past
    if(u_mode < 1.5){                                                              // STAIN: the colour seeps outward and drifts
      vec2 fl = (vec2(vnoise(uv*3. + u_time*.07), vnoise(uv*3. + 7.3 - u_time*.05)) - .5) * .02 * (.2 + u_spread*2.);
      vec4 S = u_first > .5 ? vec4(0.) : (texture(u_prev, uv+fl) + texture(u_prev, uv-fl*1.7) + texture(u_prev, uv+fl.yx*1.3)) / 3.;
      S = fadeMem(S);
      vec3 c = P.a > 1e-3 ? P.rgb/P.a : vec3(0.);
      vec3 paint = clamp(mix(vec3(luma(c)), c, 2.2), 0., 1.);                       // the colour, not the light
      float dep = .12*P.a;
      return S + vec4(paint*dep, dep)*(1. - S.a*.6);
    }
    // SCAR: wherever the picture moved, a mark stays, and slowly changes colour
    vec4 Q = texture(u_aux, uv);
    float m = u_first > .5 ? 0. : smoothstep(.10, .35, length(P.rgb - Q.rgb) + abs(P.a - Q.a)*.5);
    vec4 S = fadeMem(A);
    if(S.a > 1e-3) S = vec4(clamp(hueRot(S.rgb/S.a, u_dt*14.), 0., 1.)*S.a, S.a);
    vec3 c = P.a > 1e-3 ? P.rgb/P.a : vec3(0.);
    return vec4(max(S.rgb, c*m), max(S.a, m));
  }
  vec4 M = vec4(0.);                                                               // ---- lay the memory over the present
  if(u_mode < .5) M = fadeMem(A);
  else if(u_mode < 2.5) M = texture(u_new, uv);
  else {                                                                           // ECHO: old fragments come back on the beat of u_rate
    float pulse = pow(1. - fract(u_time*u_rate), 2.5);
    M = echoFrag(u_r0, u_ages.x, 0., uv, pulse) + echoFrag(u_r1, u_ages.y, 1., uv, pulse) + echoFrag(u_r2, u_ages.z, 2., uv, pulse) + echoFrag(u_r3, u_ages.w, 3., uv, pulse);
  }
  return blendMem(P, M * u_intensity);
}`),
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
  crop: wrap(`
uniform float u_left, u_right, u_top, u_bottom, u_round, u_feather;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  vec2 lo = vec2(u_left, u_bottom), hi = vec2(1.-u_right, 1.-u_top);   // uv.y = 0 is the bottom edge
  float asp = u_res.x/u_res.y;
  vec2 ctr = (lo+hi)*.5*vec2(asp,1.), half_ = (hi-lo)*.5*vec2(asp,1.);
  float r = min(u_round*min(half_.x, half_.y)*2., min(half_.x, half_.y));
  vec2 d = abs(uv*vec2(asp,1.) - ctr) - half_ + r;
  float sd = length(max(d, 0.)) + min(max(d.x, d.y), 0.) - r;       // signed distance to the rounded rectangle
  float f = max(u_feather, 1.5/u_res.y);                            // at least a 1.5 px soft edge so it never aliases
  float a = 1. - smoothstep(-f, 0., sd);
  return emit(c.rgb, c.a*clamp(a,0.,1.));
}`),
  xerox: wrap(`
uniform float u_contrast, u_threshold, u_grain, u_streaks, u_dots, u_size, u_mix; uniform vec3 u_ink, u_paper;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float l = (luma(c.rgb) - .5)*u_contrast + .5;
  // an old photocopier: toner is uneven down the page (long vertical streaks) and in soft blotches
  l += (fbm(vec2(uv.x*55., 3.1)) - .5)*u_streaks*.5 + (fbm(uv*vec2(5.,8.) + 7.) - .5)*u_streaks*.4;
  l += (hash12(floor(uv*u_res*.6) + floor(u_time*10.)) - .5)*u_grain*.55;
  float hard = smoothstep(u_threshold - .05, u_threshold + .05, l);
  // halftone dots in the mid-tones, where a copier loses detail
  vec2 q = mat2(.7071,-.7071,.7071,.7071)*(uv*u_res)/max(u_size, 1.);
  float d = length(fract(q) - .5);
  float dots = 1. - smoothstep(sqrt(clamp(1.-l, 0., 1.))*.62 - .06, sqrt(clamp(1.-l, 0., 1.))*.62 + .06, d);
  float mid = 1. - abs(2.*clamp(l,0.,1.) - 1.);
  float ink = mix(1.-hard, dots, u_dots*mid);
  vec3 col = mix(u_paper, u_ink, clamp(ink, 0., 1.));
  return emit(mix(c.rgb, col, u_mix), c.a);
}`),
  fisheye: wrap(`
uniform float u_amount, u_zoom, u_chroma, u_vignette;
vec3 lens(vec2 uv, float k){
  vec2 p = (uv - .5)*vec2(u_res.x/u_res.y, 1.)*2.;
  float r2 = dot(p, p);
  vec2 s = p*(1. + k*r2)/max(u_zoom, .1);
  vec2 q = (s/(vec2(u_res.x/u_res.y, 1.)*2.)) + .5;
  if(q.x < 0. || q.x > 1. || q.y < 0. || q.y > 1.) return vec3(-1.);
  return vec3(q, 1.);
}
vec4 effect(vec2 uv){
  vec3 a = lens(uv, u_amount), b = lens(uv, u_amount*(1. + u_chroma*8.)), r = lens(uv, u_amount*(1. - u_chroma*8.));
  if(a.z < 0.) return vec4(0.);
  vec4 c = src(a.xy);
  vec3 rgb = vec3(src(r.z < 0. ? a.xy : r.xy).r, c.g, src(b.z < 0. ? a.xy : b.xy).b);
  float rr = length((uv - .5)*vec2(u_res.x/u_res.y, 1.)*2.);
  rgb *= 1. - u_vignette*smoothstep(.55, 1.5, rr);
  return emit(rgb, c.a);
}`),
  torn: wrap(`
uniform float u_amount, u_rough, u_rim, u_shadow, u_seed; uniform vec3 u_paper;
vec4 effect(vec2 uv){
  float asp = u_res.x/u_res.y;
  vec2 e = min(uv, 1. - uv)*vec2(asp, 1.);                       // distance to the nearest edge, in height units
  float d = min(e.x, e.y);
  float n = fbm(uv*vec2(asp, 1.)*u_rough + u_seed*13.7) + .35*fbm(uv*vec2(asp,1.)*u_rough*4. + 5.);
  float t = u_amount*.16*(.25 + n);                                // how far the ragged edge has eaten in
  float inside = smoothstep(t, t + 1.2/u_res.y, d);
  float rim = (1. - smoothstep(t + u_rim, t + u_rim + 1.2/u_res.y, d))*inside;
  vec4 c = src(uv);
  vec3 col = mix(c.rgb, u_paper, rim*.9);
  float sh = u_shadow*.55*(1. - smoothstep(t - .03, t + .004, d))*(1. - inside);
  float a = max(inside*c.a, sh);
  vec3 outc = mix(vec3(0.), col, inside);
  return vec4(outc*(inside*c.a) , a);
}`),
  pattern: wrap(`
uniform float u_style, u_scale, u_detail, u_rotate, u_speed, u_line, u_glow, u_fill, u_foil, u_mix; uniform vec3 u_color, u_color2;
const float PI = 3.14159265;
vec2 rot2(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
// each pattern returns: x = distance to the nearest line (pattern units), y = fill (0..1), z = a second accent (dots)
float roundCone(vec2 p, vec2 a, vec2 b, float r1, float r2){ vec2 ba = b - a; float h = clamp(dot(p - a, ba)/dot(ba, ba), 0., 1.); return length(p - a - ba*h) - mix(r1, r2, h); }
vec3 mandala(vec2 p){
  float N = max(4., floor(u_detail/2.)*2.);
  float r = length(p), a = atan(p.y, p.x), sec = PI/N;
  float af = abs(mod(a + sec*.5, 2.*sec) - sec);            // fold the plane into mirrored wedges
  vec2 q = r*vec2(cos(af), sin(af));
  float d = 1e3, fill = 0., dots = 0.;
  d = min(d, abs(r - .985)); d = min(d, abs(r - .93)); d = min(d, abs(r - .2)); d = min(d, abs(r - .52)); d = min(d, abs(r - .73));
  float leaf = max(length(q - vec2(.36, .085)) - .21, length(q - vec2(.36, -.085)) - .21);     // inner pointed petals
  d = min(d, abs(leaf)); if(leaf < 0.) fill = max(fill, .85);
  float leaf2 = max(length(q - vec2(.7, .13)) - .3, length(q - vec2(.7, -.13)) - .3);        // outer long petals
  d = min(d, abs(leaf2)); if(leaf2 < 0. && r < .9) fill = max(fill, .45);
  float scal = abs(length(q - vec2(.88, 0.)) - .09); d = min(d, scal);                        // beads between the petal tips
  dots = max(dots, 1. - smoothstep(.012, .02, length(q - vec2(.2 + .12*(.5 + .5*cos(a*N)), 0.)) - .0));
  float rose = abs(r - .1*(.55 + .45*cos(N*a))); d = min(d, rose); if(r < .1*(.55 + .45*cos(N*a))) fill = max(fill, 1.);
  if(r > 1.) d = 1e3;
  return vec3(d, fill, dots);
}
vec3 jali(vec2 g){                                          // overlapping-circle lattice: the pointed arches of a carved stone window
  vec2 c = fract(g) - .5;
  float d = abs(length(abs(c) - .5) - .5);
  float fill = step(length(abs(c) - .5), .5) * step(.5, length(c) + .12) * .0;
  vec2 g2 = fract(g*2. + .5) - .5;
  float d2 = abs(length(abs(g2) - .5) - .5)*.5; if(u_detail < 8.) d2 = 1e3;
  float lens = length(abs(c) - .5);
  fill = (lens < .5 && length(c) > .27) ? .5 : 0.;
  float dots = 1. - smoothstep(.03, .045, length(c));
  return vec3(min(d, d2), fill, dots);
}
vec3 rangoli(vec2 g){                                       // pulli kolam: a lattice of dots wrapped in loops
  vec2 f = fract(g) - .5, f2 = fract(g + .5) - .5;
  float d = min(abs(length(f) - .36), abs(length(f2) - .17));
  float fill = (length(f2) < .17) ? .7 : 0.;
  float dots = max(1. - smoothstep(.035, .05, length(f)), 1. - smoothstep(.025, .035, length(f2)));
  return vec3(d, fill, dots);
}
vec3 paisley(vec2 g){
  vec2 id = floor(g), f = fract(g) - .5;
  float flip = mod(id.x + id.y, 2.) < 1. ? 1. : -1.;
  f = rot2(f*vec2(flip, 1.), .55*flip);
  f.x += .1*sin(f.y*5. + 1.);
  float body = roundCone(f, vec2(-.02, -.16), vec2(.07, .36), .22, .012);
  float inner = roundCone(f, vec2(-.02, -.12), vec2(.05, .25), .13, .01);
  float bead = length(f - vec2(-.02, -.14)) - .05;
  float d = min(abs(body), min(abs(inner), abs(bead)));
  float fill = body < 0. ? (inner < 0. ? .9 : .45) : 0.;
  return vec3(d, fill, bead < 0. ? 1. : 0.);
}
vec3 border(vec2 uv, float asp, float w){                   // truck-art frame: a rim, then a band of scallops and flowers
  vec2 e = vec2(min(uv.x, 1. - uv.x)*asp, min(uv.y, 1. - uv.y));
  float edge = min(e.x, e.y);
  float along = e.x < e.y ? uv.y : uv.x*asp;
  float L = w*1.15, cell = floor(along/L), t = (fract(along/L) - .5)*L;
  float bw = w, y = edge;
  float d = min(abs(y - bw), abs(y - bw*.88));
  d = min(d, abs(length(vec2(t, y - bw*.42)) - L*.46));    // scallop arches
  float flower = length(vec2(t, y - bw*.42)) - L*.16; d = min(d, abs(flower));
  float fill = (y < bw && y > bw*.88) ? .6 : 0.;
  if(y < bw*.88 && length(vec2(t, y - bw*.42)) < L*.46) fill = mod(cell, 2.) < 1. ? .95 : .55;
  if(y > bw*1.02) d = 1e3;
  float dots = (y < bw*.88 && flower < 0.) ? 1. : 0.;
  return vec3(d, fill, dots);
}
vec3 lotusMandala(vec2 p){                                  // three rows of overlapping petals, folded into mirrored wedges
  float N = max(4., floor(u_detail/2.)*2.);
  float r = length(p), a = atan(p.y, p.x), sec = PI/N;
  float af = abs(mod(a + sec*.5, 2.*sec) - sec);
  vec2 q = r*vec2(cos(af), sin(af));
  float d = 1e3, fill = 0., dots = 0.;
  for(int i = 0; i < 3; i++){
    float fi = float(i), cx = .27 + .24*fi, rr = .27 + .05*fi, off = .15 + .03*fi;
    float leaf = max(length(q - vec2(cx, off)) - rr, length(q - vec2(cx, -off)) - rr);
    d = min(d, abs(leaf)); if(leaf < 0.) fill = max(fill, .85 - .25*fi);
  }
  d = min(d, abs(r - .985));
  dots = max(dots, 1. - smoothstep(.014, .024, length(q - vec2(.93, 0.))));
  if(r > 1.) d = 1e3;
  return vec3(d, fill, dots);
}
vec3 mehndi(vec2 g){                                        // henna vines: a waving stem with leaves growing from alternate sides
  vec2 id = floor(g), f = fract(g) - .5;
  float yc = .2*sin(f.x*6.2831 + id.y*1.7);
  float d = abs(f.y - yc);
  vec2 lp = vec2(fract(f.x*2. + .5) - .5, f.y - yc);
  float side = sin(floor(f.x*2. + .5)*2.4 + id.y*1.3) > 0. ? 1. : -1.;
  float leaf = roundCone(vec2(lp.x + .05*side*lp.y, lp.y*side), vec2(0., .01), vec2(0., .27), .062, .006);
  d = min(d, abs(leaf));
  float bud = length(vec2(f.x - .25, f.y - (.2*sin(.25*6.2831 + id.y*1.7)))) - .028;
  return vec3(min(d, abs(bud)), leaf < 0. ? .9 : 0., bud < 0. ? 1. : 0.);
}
vec3 diyaRow(vec2 g, float t){                              // a row of oil lamps, each flame breathing at its own pace
  vec2 id = floor(g), f = fract(g) - .5;
  float flick = 1. + .09*sin(t*7. + id.x*2.3 + id.y*1.1);
  float bowl = max(length(f*vec2(1., 1.45) + vec2(0., .05)) - .27, f.y + .08);
  vec2 fp = (f - vec2(0., -.02)) * vec2(1./flick, 1./flick);
  float flame = roundCone(fp, vec2(0., .02), vec2(.0, .34), .075, .004);
  float d = min(abs(bowl), abs(flame));
  float fill = bowl < 0. ? .65 : 0.;
  return vec3(d, fill, flame < 0. ? 1. : 0.);
}
vec3 zari(vec2 uv, float asp, float w){                     // woven sari border: a chain of diamonds between fine rules
  vec2 e = vec2(min(uv.x, 1. - uv.x)*asp, min(uv.y, 1. - uv.y));
  float y = min(e.x, e.y), along = e.x < e.y ? uv.y : uv.x*asp;
  float L = w*.95, cell = floor(along/L), t = (fract(along/L) - .5)*L, bw = w;
  float d = min(abs(y - bw), min(abs(y - bw*.84), abs(y - bw*.16)));
  float dia = abs(t)*.85 + abs(y - bw*.5)*1.15 - bw*.34;
  d = min(d, abs(dia)); float fill = dia < 0. ? (mod(cell, 2.) < 1. ? .9 : .5) : 0.;
  float dots = (length(vec2(abs(t) - L*.5, y - bw*.5)) < bw*.06) ? 1. : 0.;
  if(y > bw*1.02) d = 1e3;
  return vec3(d, fill, dots);
}
vec3 torana(vec2 uv, float asp, float w){                   // festival garland hung along the top: scallops with a tassel at every dip
  float y = 1. - uv.y, along = uv.x*asp;
  float L = w*1.3, cell = floor(along/L), t = (fract(along/L) - .5)*L;
  float arc = abs(length(vec2(t, y - w*.12)) - L*.5);
  float rope = abs(y - w*.12);
  float tas = roundCone(vec2(t, y - w*.12 - L*.5), vec2(0., 0.), vec2(0., L*.62), L*.1, L*.012);
  float d = min(arc, min(rope*(y < w*.14 ? 1. : 1e3), abs(tas)));
  float fill = tas < 0. ? (mod(cell, 2.) < 1. ? .95 : .6) : 0.;
  if(y > w*1.9) d = 1e3;
  return vec3(d, fill, length(vec2(t, y - w*.12 - L*.5)) < L*.06 ? 1. : 0.);
}
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float asp = u_res.x/u_res.y;
  vec2 p = (uv - .5)*vec2(asp, 1.);
  float tt = u_time*u_speed;
  float rad = radians(u_rotate);
  float hpx = 1./u_res.y, w = u_line*hpx;                  // line width in height units
  vec3 s; float k;                                          // k: pattern units per frame height
  int st = int(u_style + .5);
  if(st == 0){ k = 2./max(u_scale, .05); s = mandala(rot2(p, rad + tt)*k); }
  else if(st == 1){ k = u_scale*3.; s = jali(rot2(p, rad)*k + vec2(tt, tt*.5)); }
  else if(st == 2){ k = u_scale*3.; s = rangoli(rot2(p, rad)*k + vec2(tt, 0.)); }
  else if(st == 3){ k = u_scale*2.5; s = paisley(rot2(p, rad)*k + vec2(0., tt)); }
  else if(st == 4){ k = 1.; s = border(uv, asp, .09*u_scale); }
  else if(st == 5){ k = 2./max(u_scale, .05); s = lotusMandala(rot2(p, rad + tt)*k); }
  else if(st == 6){ k = u_scale*2.2; s = mehndi(rot2(p, rad)*k + vec2(tt, 0.)); }
  else if(st == 7){ k = u_scale*3.; s = diyaRow(rot2(p, rad)*k + vec2(tt*.3, 0.), u_time); }
  else if(st == 8){ k = 1.; s = zari(uv, asp, .07*u_scale); }
  else { k = 1.; s = torana(uv, asp, .1*u_scale); }
  float wp = w*k;                                           // line width in pattern units
  float line = 1. - smoothstep(wp*.5, wp*.5 + 1.4*hpx*k, s.x);
  float glow = exp(-s.x/max(wp*7., 1e-4))*u_glow*((st == 3 || st == 6) ? .12 : .5); // paisley cells are drawn one at a time, so a wide glow would show the cell edges
  float fillm = s.y*u_fill;
  vec3 col = mix(c.rgb, u_color2, fillm*(.35 + .65*step(.01, fillm)));
  float fo = fbm(uv*vec2(asp, 1.)*5. + vec2(u_time*.04, 0.)), sheen = pow(clamp(fo*1.6 - .3, 0., 1.), 2.);
  vec3 lc = mix(u_color, u_color*(.5 + .95*fo) + vec3(.18)*sheen, u_foil);     // gold-leaf: the line catches light unevenly
  col = mix(col, lc, clamp(max(line, s.z), 0., 1.));
  col += lc*glow*(1. - line);
  float a = max(c.a, max(max(line, s.z), max(fillm, glow*.6)));
  return emit(mix(c.rgb, col, u_mix), mix(c.a, a, u_mix));
}`),
  object3d: wrap(`
uniform float u_shape, u_material, u_background, u_size, u_x, u_y, u_rx, u_ry, u_rz, u_sx, u_sy, u_sz, u_shine;
uniform vec3 u_tint;
mat3 rotm(vec3 a){
  float cx=cos(a.x), sx=sin(a.x), cy=cos(a.y), sy=sin(a.y), cz=cos(a.z), sz=sin(a.z);
  mat3 mx = mat3(1.,0.,0., 0.,cx,sx, 0.,-sx,cx);
  mat3 my = mat3(cy,0.,-sy, 0.,1.,0., sy,0.,cy);
  mat3 mz = mat3(cz,sz,0., -sz,cz,0., 0.,0.,1.);
  return mx*my*mz;
}
float sdBox(vec3 p, vec3 b, float r){ vec3 q = abs(p)-b+r; return length(max(q,0.)) + min(max(q.x,max(q.y,q.z)),0.) - r; }
float sdf(vec3 p){
  float s = u_size;
  if(u_shape < .5)  return sdBox(p, vec3(s*.5), s*.03);                       // cube
  if(u_shape < 1.5) return length(p) - s*.62;                                   // sphere
  if(u_shape < 2.5){ vec2 q = vec2(length(p.xz) - s*.5, p.y); return length(q) - s*.2; }   // torus
  if(u_shape < 3.5) return sdBox(p, vec3(s*.5), s*.22);                         // rounded cube
  if(u_shape < 4.5){ p.y -= clamp(p.y, -s*.32, s*.32); return length(p) - s*.3; }          // capsule
  vec3 a = abs(p); return (a.x + a.y + a.z - s*.8)*.57735027;                   // octahedron
}
vec3 env(vec3 r){                                                               // a small studio: gradient sky, two softboxes, a hot spot
  float h = r.y*.5 + .5;
  vec3 c = mix(vec3(.04,.05,.10), vec3(.78,.88,1.), smoothstep(.05,1.,h));
  c += vec3(1.)*smoothstep(.6,.92,abs(sin(r.x*2.6 + r.z*1.7)))*smoothstep(.3,.8,h)*.85;
  c += vec3(1.,.95,.9)*smoothstep(.93,.995,dot(r, normalize(vec3(.4,.8,.5))))*1.5;
  c *= .85 + .3*smoothstep(-.2,.1,r.y);
  return c;
}
vec2 surfUV(vec3 p, vec3 n, float asp){
  if(u_shape > .5 && u_shape < 1.5){ return vec2(atan(p.x,p.z)/6.28318 + .5, asin(clamp(p.y/(u_size*.62),-1.,1.))/3.14159 + .5); }
  if(u_shape > 1.5 && u_shape < 2.5){ float u = atan(p.z,p.x)/6.28318 + .5; float v = atan(p.y, length(p.xz) - u_size*.5)/6.28318 + .5; return vec2(abs(fract(u*2.)*2.-1.), v); }
  vec3 a = abs(n); vec2 f;
  if(a.x > a.y && a.x > a.z) f = vec2(p.z*sign(n.x), p.y); else if(a.y > a.z) f = vec2(p.x, p.z*sign(n.y)); else f = vec2(p.x*-sign(n.z), p.y);
  f = f/(u_size*.9) + .5;
  return vec2(.5 + (f.x-.5)/asp*1., f.y);                                       // keep the picture's proportions on each face (centre square)
}
vec4 effect(vec2 uv){
  vec4 bg = src(uv);
  float asp = u_res.x/u_res.y;
  vec2 q = (uv - .5)*vec2(asp,1.)*2.;                                           // y in -1..1: one world unit = half the screen height
  vec3 ro = vec3(0., 0., 4.), rd = normalize(vec3(q, -4.)), off = vec3(u_x, u_y, 0.);
  mat3 R = rotm(radians(vec3(u_rx + u_sx*u_time, u_ry + u_sy*u_time, u_rz + u_sz*u_time)));
  vec3 o = (ro - off)*R, d = rd*R;                                              // into object space (R is orthonormal, v*R = Rᵀ v)
  float t = 2.2, dmin = 9.; bool hit = false;
  for(int i=0;i<64;i++){
    vec3 p = o + d*t;
    float h = sdf(p);
    dmin = min(dmin, h/max(t,1.));
    if(h < .0015){ hit = true; break; }
    t += h*.9;
    if(t > 7.) break;
  }
  float px = 2./u_res.y;
  float cover = hit ? 1. : 1. - smoothstep(0., px*1.5, dmin);
  vec3 base = bg.rgb;
  if(u_background > 1.5) base = vec3(0.); else if(u_background > .5) base = bg.rgb*.3;
  float outA = u_background > 2.5 ? cover : max(bg.a, cover);
  if(cover <= 0.001) return u_background > 2.5 ? vec4(0.) : emit(base, bg.a);
  vec3 p = o + d*t;
  vec2 e = vec2(.002, 0.);
  vec3 n = normalize(vec3(sdf(p+e.xyy)-sdf(p-e.xyy), sdf(p+e.yxy)-sdf(p-e.yxy), sdf(p+e.yyx)-sdf(p-e.yyx)));
  vec3 nw = R*n, rw = reflect(rd, nw);                                          // world-space normal / reflection
  vec3 L = normalize(vec3(.5,.8,.6));
  float diff = clamp(dot(nw, L), 0., 1.), fres = pow(1. - clamp(dot(-rd, nw), 0., 1.), 3.);
  vec2 suv = surfUV(p, n, asp);
  vec3 col;
  if(u_material < .5){                                                          // the picture itself, lit like a printed surface
    vec3 tex = src(clamp(suv, .001, .999)).rgb;
    col = tex*(.5 + .6*diff) + env(rw)*u_shine*.25*fres + vec3(1.)*pow(clamp(dot(rw, L),0.,1.), 40.)*u_shine*.6;
  } else if(u_material < 1.5){                                                  // chrome
    col = env(rw)*u_tint*1.05 + fres*.25*u_shine;
  } else if(u_material < 2.5){                                                  // glass: the picture bends through, chromatic at the rim
    vec2 k = nw.xy*.14*(.4 + fres);
    vec3 refr = vec3(src(uv + k*1.0).r, src(uv + k*1.12).g, src(uv + k*1.25).b);
    col = mix(refr*.9 + u_tint*.06, env(rw), clamp(fres*1.4 + .08, 0., 1.)*u_shine);
  } else if(u_material < 3.5){                                                  // wireframe: neon lines on a dark body, a trace of the picture inside
    vec2 g = suv*vec2(10., 10.); vec2 w = abs(fract(g) - .5);
    float ln = max(smoothstep(.43,.5,w.x), smoothstep(.43,.5,w.y));
    col = src(clamp(suv,.001,.999)).rgb*.18 + u_tint*ln*(1.2 + u_shine) + u_tint*fres*.5;
  } else {                                                                      // holo foil
    float h = dot(rw, vec3(.3,.5,.2))*1.6 + diff*.4 + u_time*.1;
    vec3 foil = .5 + .5*cos(6.28318*(h + vec3(0.,.33,.67)));
    col = mix(env(rw)*.6, foil, .65)*(.6 + .5*diff) + fres*.3;
  }
  vec3 outc = mix(base, col, cover);
  return u_background > 2.5 ? vec4(clamp(col,0.,1.)*cover, cover) : emit(outc, outA);
}`),
  grid3d: wrap(`
uniform float u_horizon, u_scale, u_speed, u_line, u_glow, u_sky, u_floor;
uniform vec3 u_color, u_color2;
vec4 effect(vec2 uv){
  vec4 c = src(uv);
  float asp = u_res.x/u_res.y;
  vec3 col = c.rgb;
  float hz = u_horizon;
  if(uv.y > hz){
    if(u_sky > .5){                                                             // sunset gradient with a banded sun
      float h = (uv.y - hz)/(1. - hz);
      vec3 sky = mix(u_color2*.9, vec3(.10,.02,.28), smoothstep(0., .7, h));
      sky = mix(sky, vec3(.02,.0,.08), smoothstep(.4, 1., h));
      vec2 sp = (uv - vec2(.5, hz + .22))*vec2(asp, 1.);
      float sun = 1. - smoothstep(.17, .175, length(sp));
      float bands = step(.0, sin((sp.y)*70. + 6.)) + step(sp.y, .02);
      sky += mix(vec3(1.,.8,.2), u_color, smoothstep(-.17,.17,sp.y))*sun*clamp(bands, 0., 1.);
      sky += u_color2*.35*exp(-h*14.);
      col = sky;
    }
  } else {
    float depth = (hz - uv.y);                                                  // 0 at the horizon, growing toward the viewer
    float z = .35/max(depth, .002);
    float x = (uv.x - .5)*asp*z*2.;
    vec2 g = vec2(x, z + u_time*u_speed*2.) / (40./u_scale);
    vec2 fw = fwidth(g)*u_line*1.2;
    vec2 gl = abs(fract(g - .5) - .5)/max(fw, vec2(1e-4));
    float line = 1. - min(min(gl.x, gl.y), 1.);
    float fade = smoothstep(.0, .12, depth);                                    // lines dissolve into the horizon haze
    vec3 floorc = mix(vec3(.02,0.,.08), u_color2*.2, exp(-depth*7.));
    col = mix(col, floorc, u_floor*fade);
    col += u_color*line*fade*(1. + u_glow*.8) + u_color*line*u_glow*.4*exp(-depth*9.);
  }
  col += u_color2*u_glow*.55*exp(-abs(uv.y - hz)*55.);                          // glow along the horizon
  return emit(col, c.a);
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
