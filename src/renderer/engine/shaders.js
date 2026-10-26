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
uniform float u_density, u_movement, u_distortion, u_thickness, u_glow, u_green, u_seed, u_transparent;
uniform int u_style;
float ridge(vec2 p){ return 1. - abs(fbm(p)*2.-1.); }
vec2 warp(vec2 p, float t){
  vec2 q = vec2(fbm(p*.9+vec2(0.,t)+u_seed), fbm(p*.9+vec2(5.2,1.3)-t+u_seed));
  return p + (q-.5)*u_distortion*3.2;
}
vec2 vor(vec2 p){ vec2 ip=floor(p), fp=fract(p); float d1=8., d2=8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(i,j);
    vec2 h = hash22(ip+g); h = .5+.5*sin(u_time*u_movement*.8 + 6.2831*h);
    float d = length(g+h-fp); if(d<d1){ d2=d1; d1=d; } else if(d<d2) d2=d; }
  return vec2(d1,d2); }
void main(){
  vec2 uv = v_uv; float asp = u_res.x/u_res.y;
  vec2 p = (uv-.5)*vec2(asp,1.)*u_density*3.;
  float t = u_time*u_movement*.35;
  float v;
  if(u_style == 0){ // root network: layered ridged noise in domain-warped space
    vec2 w = warp(p, t);
    float r1 = ridge(w), r2 = ridge(w*2.1+vec2(3.7,1.9)+t*.6), r3 = ridge(w*4.3+vec2(9.1,4.4)-t);
    float th = u_thickness;
    float main_ = smoothstep(1.-th*.55, 1., r1);
    float sub = smoothstep(1.-th*.4, 1., r2)*.7;
    float hair = smoothstep(1.-th*.3, 1., r3)*.4;
    v = clamp(main_ + sub*(1.-main_*.6) + hair*.6, 0., 1.);
    v += pow(r1, 9.)*u_glow*.55;
  } else if(u_style == 1){ // fluid bands
    vec2 w = warp(p*.7, t);
    float f = fbm(w + t*.4);
    float bands = .5+.5*sin(f*(8.+u_density*10.) + t*3.);
    v = smoothstep(.5-u_thickness, .5+u_thickness*.3, bands)*(.35+.65*f);
    v += pow(bands, 6.)*u_glow*.4;
  } else { // cell membrane
    vec2 w = warp(p*.8, t*.5);
    vec2 d = vor(w*1.2);
    float edge = d.y - d.x;
    v = smoothstep(u_thickness*.9, 0., edge);
    v += exp(-edge*8.)*u_glow*.35 + (1.-smoothstep(0.,.35,d.x))*.12;
  }
  v = clamp(v, 0., 1.);
  float tone = fbm(p*.6 + u_seed*1.7 + t);
  vec3 tint = mix(vec3(1.), mix(FOREST*2.0, vec3(.35,.95,.55), tone), u_green);
  vec3 col = v * tint;
  col += FOREST*.35*u_green*(1.-v)*fbm(p*.4 - t)*.5;
  vec3 c = clamp(col, 0., 1.);
  if(u_transparent < .5) o = vec4(c, 1.);
  else o = vec4(c, max(c.r, max(c.g, c.b))); // premultiplied: colour never exceeds alpha
}`;
