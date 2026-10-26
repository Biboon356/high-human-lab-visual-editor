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
uniform float u_density, u_movement, u_distortion, u_thickness, u_glow, u_green, u_seed, u_transparent, u_growth;
uniform int u_style;
vec2 warp(vec2 p, float t){
  vec2 q = vec2(fbm(p*.9+vec2(0.,t)+u_seed), fbm(p*.9+vec2(5.2,1.3)-t+u_seed));
  return p + (q-.5)*u_distortion*3.2;
}
vec2 vor(vec2 p){ vec2 ip=floor(p), fp=fract(p); float d1=8., d2=8.;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(i,j);
    vec2 h = hash22(ip+g); h = .5+.5*sin(u_time*u_movement*.8 + 6.2831*h);
    float d = length(g+h-fp); if(d<d1){ d2=d1; d1=d; } else if(d<d2) d2=d; }
  return vec2(d1,d2); }
// Crisp iso-line: f is zero on the line; fwidth turns it into a pixel distance, so widths stay constant on screen.
vec2 iso(float f, float wpx){
  float d = abs(f)/max(fwidth(f), 1e-5);
  return vec2(1.-smoothstep(wpx-.75, wpx+.75, d), d);
}
void main(){
  vec2 uv = v_uv; float asp = u_res.x/u_res.y;
  vec2 p = (uv-.5)*vec2(asp,1.)*u_density*3.;
  float t = u_time*u_movement*.35;
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
  } else { // cell membrane: voronoi edges, two scales
    vec2 w = warp(p*.8, t*.5);
    vec2 v1 = vor(w*1.2); float e1 = v1.y - v1.x;
    vec2 v2 = vor(w*2.9+3.7); float e2 = v2.y - v2.x;
    float d1 = e1/max(fwidth(e1),1e-5)*.5, d2 = e2/max(fwidth(e2),1e-5)*.5;
    m = max(1.-smoothstep(W*.8-.75, W*.8+.75, d1), (1.-smoothstep(W*.45-.75, W*.45+.75, d2))*.6);
    dmin = min(d1, d2);
  }
  // growth front expands from the bottom-centre, ragged edge, bright tip
  float age = length((uv-vec2(.5,-.1))*vec2(asp,1.)) + (fbm(p*.6+u_seed)-.5)*.6;
  float g = u_growth*2.4 - age;
  float reveal = smoothstep(0., .05, g);
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
